import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseError } from '@shippingco/db';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { createInboxWorker } from '../../src/modules/whatsapp/inbox-worker.ts';
import { persistBusinessWebhook } from '../../src/modules/security/jobs.ts';
import { normalizeBusinessWebhook,openInboxPayload } from '../../src/modules/whatsapp/webhook-payload.ts';
import { whatsappSetup } from '../whatsapp-support.ts';
import { callback,inbound,signed,status,webhookConfig } from '../webhook-fixture.ts';
import { paymentFault } from '../payment-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';

async function setup(t:TestContext) {
  const s=await whatsappSetup(t);await s.db.prepareWhatsappInbox();assert.equal((await s.connect()).statusCode,200);
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const logs:string[]=[];
  const make=(pool=s.pool)=>buildServer({config,database:pool,auth:{keys:s.keys,delivery:{},webhook:undefined},
    whatsapp:{...s.dependencies,configuration:{...s.dependencies.configuration,webhook:webhookConfig}},logSink:{write:x=>logs.push(x)}});
  const app=make();t.after(()=>app.close());
  const post=(value:unknown)=>{const body=JSON.stringify(value);return app.inject({method:'POST',url:'/webhooks/whatsapp',payload:body,headers:signed(body)});};
  const rows=async()=>(await s.db.adminQuery('SELECT * FROM shipit.whatsapp_inbox ORDER BY received_at,id')).rows;
  return {...s,webhookApp:app,make,post,rows,webhookLogs:logs,worker:createInboxWorker(s.pool)};
}
await test('signed concurrent replays persist once, survive restart and project reordered statuses monotonically',{timeout:30000},async t=>{
  const s=await setup(t),body=callback([status('read'),status('delivered'),status('sent')]);
  const responses=await Promise.all(Array.from({length:6},()=>s.post(body)));
  for(const r of responses)assert.equal(r.statusCode,200,r.body);assert.equal((await s.rows()).length,3);
  const fresh=s.db.runtimePool(),worker=createInboxWorker(fresh);
  await Promise.all([worker.tick(),s.worker.tick(),worker.tick()]);
  const observations=(await s.db.adminQuery('SELECT * FROM shipit.whatsapp_delivery_observations')).rows;
  assert.equal(observations.length,1);assert.equal(observations[0]!.progress,3);
  assert.equal((await s.rows()).filter(r=>r.state==='completed').length,3);
  assert.equal(await worker.tick(),null);assert.equal((await s.post(body)).statusCode,200);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_inbox_attempts')).rows[0]!.n,3);
  await s.post(callback([status('failed')]));await worker.tick();
  const observed=(await s.db.adminQuery('SELECT progress,failure_observed FROM shipit.whatsapp_delivery_observations')).rows[0]!;
  assert.deepEqual(observed,{progress:3,failure_observed:true});
  // Real HTTP after replacing the application instance, using the same durable database.
  const restarted=s.make(fresh);t.after(()=>restarted.close());await restarted.listen({host:'127.0.0.1',port:0});
  const address=restarted.server.address();assert.ok(address&&typeof address==='object');
  const encoded=JSON.stringify(body),response=await fetch(`http://127.0.0.1:${address.port}/webhooks/whatsapp`,{method:'POST',body:encoded,headers:signed(encoded)});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{received:true});assert.equal((await s.rows()).length,4);
});
await test('trusted app/WABA/phone binding isolates sibling and foreign installations; unknown and conflicts are quarantined',{timeout:30000},async t=>{
  const s=await setup(t);
  assert.equal((await s.request('installations',{binding_key:'beta_v1',expected_version:0},s.sibling.token,B)).statusCode,200);
  assert.equal((await s.request('installations',{binding_key:'gamma_v1',expected_version:0},s.foreign.token,C,otherOrg)).statusCode,200);
  await s.post(callback([status()]));await s.post(callback([status()],{waba:'200001',phone:'200002'}));await s.post(callback([status()],{waba:'300001',phone:'300002'}));
  assert.deepEqual(new Set((await s.rows()).map(r=>r.franchise_id)),new Set([A,B,C]));
  const unknown=callback([status()],{waba:'100001',phone:'999999'});
  const mismatch=callback([status()],{waba:'999999',phone:'100002'});
  for(const body of [unknown,unknown,mismatch,mismatch,callback([{...status(),recipient_id:'15550000002'}])])assert.equal((await s.post(body)).statusCode,200);
  assert.equal((await s.rows()).length,3);
  const quarantine=(await s.db.adminQuery('SELECT * FROM shipit.whatsapp_webhook_quarantine')).rows;
  assert.equal(quarantine.length,3);assert.deepEqual(new Set(quarantine.map(r=>r.reason_code)),new Set(['unknown_installation','app_identity_mismatch','event_conflict']));
  assert.ok(!JSON.stringify(quarantine).includes('15550000002'));
  const rows=await s.rows(),a=rows.find(r=>r.franchise_id===A)!,b=rows.find(r=>r.franchise_id===B)!,c=rows.find(r=>r.franchise_id===C)!;
  assert.equal((await s.request(`inbox/${a.id}`)).statusCode,200);
  for(const id of [b.id,c.id,randomUUID()])assert.equal((await s.request(`inbox/${id}`)).statusCode,404);
  for(const [token,franchise,organization] of [[s.local.token,B,org],[s.local.token,C,otherOrg],[s.foreign.token,A,org]]) {
    assert.equal((await s.request('inbox/health',undefined,token,franchise,organization)).statusCode,404);
  }
  const readOnly=await s.grant('read_only',[A]);assert.equal((await s.request('inbox/health',undefined,readOnly.token)).statusCode,403);
  assert.equal((await s.request('inbox/health')).json().states[0].count,1);
  assert.equal((await s.db.runtimePool().query('SELECT shipit.whatsapp_inbox_process($1,$2,$3) result',[org,A,b.id])).rows[0]!.result,'idle');
  const owner=s.db.ownerPool();
  const clone=`INSERT INTO shipit.whatsapp_inbox SELECT (jsonb_populate_record(NULL::shipit.whatsapp_inbox,
    to_jsonb(i)||$2::jsonb)).* FROM shipit.whatsapp_inbox i WHERE i.id=$1`;
  await assert.rejects(owner.query(clone,[a.id,JSON.stringify({id:randomUUID(),event_key:'status:foreign:read',franchise_id:B})]),
    e=>e instanceof DatabaseError&&e.sqlState==='23503');
  await assert.rejects(owner.query(clone,[a.id,JSON.stringify({id:randomUUID(),event_key:'status:null:read',status:null})]),
    e=>e instanceof DatabaseError&&e.sqlState==='23514');
  assert.equal((await s.rows()).length,3);
});
await test('inbound content remains encrypted; unsupported and disabled installations do not dispatch business effects',{timeout:30000},async t=>{
  const s=await setup(t);
  await s.post(callback([inbound('wamid.private','STOP 12345678 नमस्ते')],{kind:'messages'}));
  const row=(await s.rows())[0]!;assert.ok(!JSON.stringify(row).includes('12345678'));assert.ok(!JSON.stringify(row).includes('15550000001'));
  assert.deepEqual(openInboxPayload(webhookConfig,{...row,waba_id:'100001',phone_number_id:'100002'} as Parameters<typeof openInboxPayload>[1]),{from:'15550000001',type:'text',text:'STOP 12345678 नमस्ते'});
  assert.equal(await s.worker.tick(),'completed');
  const detail=await s.request(`inbox/${row.id}`);assert.equal(detail.statusCode,200);
  for(const secret of ['12345678','15550000001',row.sealed_payload,webhookConfig.app_secret,webhookConfig.verify_token])assert.ok(!(detail.body+s.webhookLogs.join('')).includes(secret));
  await s.post(callback([{...inbound('wamid.unsupported'),type:'image',image:{id:'private_media_id'}}],{kind:'messages'}));
  assert.equal((await s.rows()).find(r=>r.message_id==='wamid.unsupported')!.reason_code,'unsupported_payload');
  const installation=(await s.request('installation')).json().installation;
  assert.equal((await s.request(`installations/${installation.id}/disable`,{expected_version:1})).statusCode,200);
  await s.post(callback([status()]));assert.equal(await s.worker.tick(),'quarantined');
  assert.equal((await s.rows()).find(r=>r.kind==='status')!.reason_code,'installation_disabled');
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_delivery_observations')).rows[0]!.n,0);
});
await test('outage, lost acknowledgement and worker commit boundaries preserve durable atomic outcomes',{timeout:30000},async t=>{
  const s=await setup(t),value=callback([status()]),body=JSON.stringify(value),events=normalizeBusinessWebhook(Buffer.from(body),webhookConfig);
  const failed=s.make(paymentFault(s.pool,'SELECT shipit.whatsapp_receive','before'));t.after(()=>failed.close());
  const rejected=await failed.inject({method:'POST',url:'/webhooks/whatsapp',payload:body,headers:signed(body)});
  assert.equal(rejected.statusCode,503);assert.equal((await s.rows()).length,0);
  const batch=normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([status('read','wamid.batch1'),status('read','wamid.batch2')]))),webhookConfig);
  batch[1]!.sealed_payload='invalid';
  await assert.rejects(persistBusinessWebhook(s.pool,batch,webhookConfig.waba_ids,randomUUID()));
  assert.equal((await s.rows()).length,0,'second-item failure must roll back the first item');
  await s.db.setAvailable(false);
  try {assert.equal((await s.post(value)).statusCode,503);}finally{await s.db.setAvailable(true);}
  assert.equal((await s.rows()).length,0);
  await assert.rejects(persistBusinessWebhook(paymentFault(s.pool,'COMMIT'),events,webhookConfig.waba_ids,randomUUID()));
  assert.equal((await s.rows()).length,1);assert.equal((await s.post(value)).statusCode,200);assert.equal((await s.rows()).length,1);
  await assert.rejects(createInboxWorker(paymentFault(s.pool,'COMMIT','before')).tick());
  assert.equal((await s.rows())[0]!.state,'pending');assert.equal((await s.rows())[0]!.attempts,0);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_delivery_observations')).rows[0]!.n,0);
  await assert.rejects(createInboxWorker(paymentFault(s.pool,'COMMIT')).tick());
  assert.equal((await s.rows())[0]!.state,'completed');assert.equal(await s.worker.tick(),null);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_inbox_attempts')).rows[0]!.n,1);
});
await test('SQL effect failure retries with bounded attempts and preserves immutable evidence',{timeout:30000},async t=>{
  const s=await setup(t);await s.post(callback([status()]));
  await s.db.adminQuery(`CREATE FUNCTION shipit.synthetic_inbox_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private error'; END $$;
    CREATE TRIGGER synthetic_inbox_failure BEFORE INSERT ON shipit.whatsapp_delivery_observations FOR EACH ROW EXECUTE FUNCTION shipit.synthetic_inbox_fail()`);
  for(let n=1;n<=5;n++) {
    assert.equal(await s.worker.tick(),n===5?'quarantined':'retry_wait');
    assert.equal((await s.rows())[0]!.attempts,n);
    if(n<5){assert.equal(await s.worker.tick(),null);await s.db.adminQuery("UPDATE shipit.whatsapp_inbox SET available_at=clock_timestamp()-interval '1 second'");}
  }
  assert.equal((await s.rows())[0]!.reason_code,'attempts_exhausted');assert.equal(await s.worker.tick(),null);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_inbox_attempts')).rows[0]!.n,5);
  const pool=s.db.runtimePool();
  for(const sql of ['DELETE FROM shipit.whatsapp_inbox','TRUNCATE shipit.whatsapp_inbox',"UPDATE shipit.whatsapp_inbox SET state='pending'",
    'DELETE FROM shipit.whatsapp_inbox_attempts',"UPDATE shipit.whatsapp_delivery_observations SET progress=0",'SELECT * FROM shipit.whatsapp_webhook_quarantine'])await assert.rejects(pool.query(sql));
  assert.ok(!JSON.stringify(await s.rows()).includes('synthetic private error'));
});
