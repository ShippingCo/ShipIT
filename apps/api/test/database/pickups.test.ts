import { provisionDatabase } from '../../../../packages/db/test/support.ts';
import { createOutboundService } from '../../src/modules/whatsapp/outbound-service.ts';
import { createPickupService } from '../../src/modules/pickups/service.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { auditSetup,org,A,B,otherOrg,C } from '../audit-support.ts';
import { createPricingService } from '../../src/modules/pricing/service.ts';
import { createQuotePolicyService } from '../../src/modules/customer-quotes/policy-service.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { createInboxWorker } from '../../src/modules/whatsapp/inbox-worker.ts';
import { createConsentWorker } from '../../src/modules/whatsapp/consent-worker.ts';
import { createConversationWorker } from '../../src/modules/conversations/worker.ts';
import { createOutboundWorker } from '../../src/modules/whatsapp/outbound-worker.ts';
import { openOutbound } from '../../src/modules/whatsapp/outbound-rules.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { webhookConfig,callback,inbound,signed } from '../webhook-fixture.ts';
import type { WhatsappDependencies } from '../../src/modules/whatsapp/types.ts';

async function setup(t:Parameters<typeof auditSetup>[0]) {
 const s=await auditSetup(t);await s.db.preparePickups();
 const admin=await s.grant('franchise_admin',[A]),now=Date.now(),pricing=createPricingService(s.pool,()=>new Date(now-120000));
 const rate=await pricing.create(admin.token,org,A,randomUUID(),{effective_from:new Date(now+3000).toISOString(),effective_to:new Date(now+3600000).toISOString(),
  quote_validity_seconds:600,override_tolerance_paise:0,approval_ref:'synthetic48',source_ref:'synthetic48',rules:[
   {destination_key:'DEST',service:'standard',min_weight_grams:1,max_weight_grams:null,freight_paise:10001,packing_paise:249}]},randomUUID());
 await pricing.publish(admin.token,org,A,rate.id,randomUUID(),{expected_version:1},randomUUID());
 await delay(Math.max(0,now+3001-Date.now()));
 const policies=createQuotePolicyService(s.pool),body={enabled:true,origin_key:'ORIGIN',rate_version_id:rate.id,heavy_weight_grams:2000,large_dimension_mm:1000,manual_review:false,
  lanes:[{destination_key:'DEST',service:'standard',weight_only:true}],expected_version:0};
 const configured=await policies.configure(admin.token,org,A,randomUUID(),body,randomUUID()) as {id:string;version:number};
 const binding={key:'quote48',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:quote48/v1'};
 const sends:string[]=[],logs:string[]=[],whatsapp:WhatsappDependencies={configuration:{graph_version:'v24.0',bindings:[binding],webhook:webhookConfig,
  outbound_enabled:true,customer_access_enabled:true,conversation_enabled:true,customer_quotes_enabled:true,pickup_enabled:true},provider:{validate:async()=>{},template:async()=>{throw new Error('unused');},
  send:async()=>({kind:'unavailable',reason:'unused'}),sendText:async(_b,_p,text)=>{sends.push(text);return {kind:'accepted',provider_message_id:'wamid.'+randomUUID()};}}};
 await createWhatsappService(s.pool,whatsapp).execute(admin.token,null,'connect',{organization_id:org,franchise_id:A},randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
 const app=buildServer({database:s.pool,config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'}),
  auth:{keys:s.keys,delivery:{},webhook:undefined},whatsapp,logSink:{write:x=>logs.push(x)}});t.after(()=>app.close());
 const worker=createConversationWorker(s.pool,whatsapp,s.keys.browser),outbound=createOutboundWorker(s.pool,whatsapp),phone='12025550148';
 async function message(text:string,from=phone,messageId='wamid.'+randomUUID(),channel={waba:'100001',phone:'100002'}) {
  const payload=JSON.stringify(callback([{...inbound(messageId,text),from,timestamp:String(Math.floor(Date.now()/1000))}],{...channel,kind:'messages'}));
  assert.equal((await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:signed(payload),payload})).statusCode,200);
  while(await createInboxWorker(s.pool).tick()!==null){/* signed inbox */}
  while(await createConsentWorker(s.pool,webhookConfig).tick()!==null){/* consent first */}
  const id=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.whatsapp_inbox WHERE message_id=$1',[messageId])).rows[0]!.id;
  return id;
 }
 const reply=async(id:string)=>{const m=(await s.db.adminQuery<{id:string;key_version:string;sealed_payload:string}>('SELECT id,key_version,sealed_payload FROM shipit.whatsapp_outbound WHERE conversation_inbox_id=$1',[id])).rows[0]!;
  return openOutbound(webhookConfig,m.id,m.key_version,m.sealed_payload).text!;};
 async function turn(text:string,from=phone) {const id=await message(text,from);await worker.tick();return {id,text:await reply(id)};}
 async function quote(weight='1999',dimensions='100 x 200 x 300',destination='DEST',service='standard',from=phone) {
  for(const text of ['QUOTE','ORIGIN',destination,weight,dimensions])await turn(text,from);
  return turn(service,from);
 }
 const estimate=async(id:string)=>(await s.db.adminQuery('SELECT * FROM shipit.customer_quotes WHERE inbox_id=$1',[id])).rows[0]!;
 return {...s,root:s.admin,admin,rate,policies,body,configured,whatsapp,app,worker,outbound,message,reply,turn,quote,estimate,sends,logs,phone};
}

async function submit(s:Awaited<ReturnType<typeof setup>>,weight='100') {
 const q=await s.quote(weight),estimate=await s.estimate(q.id);
 await s.turn('PICKUP '+estimate.id);await s.turn('12 Synthetic Street, Fictional City 123456');
 const start=new Date(Date.now()+3600000).toISOString(),end=new Date(Date.now()+7200000).toISOString();
 const confirmation=await s.turn(start+' | '+end),key=confirmation.text.match(/SUBMIT PICKUP ([0-9a-f-]{36})/)![1]!;
 await s.turn('SUBMIT PICKUP '+key);
 const row=(await s.db.adminQuery<{id:string;state:string;review_reason:string}>('SELECT id,state,review_reason FROM shipit.pickup_requests ORDER BY created_at DESC LIMIT 1')).rows[0]!;
 return {...row,key,start,end,estimate};
}
await test('pickup dialogue validates private inputs; explicit submission replays after restart and persists one effect',{timeout:60000},async t=>{
 const s=await setup(t),q=await s.quote(),estimate=await s.estimate(q.id);
 await s.turn('PICKUP '+estimate.id);assert.match((await s.turn('short')).text,/Address is invalid/);
 await s.turn('12 Status Road, Fictional City 123456');assert.match((await s.turn('yesterday')).text,/window is invalid/);
 const a=new Date(Date.now()+3600000).toISOString(),b=new Date(Date.now()+7200000).toISOString();
 const prompt=await s.turn(a+' | '+b),key=prompt.text.match(/SUBMIT PICKUP ([0-9a-f-]{36})/)![1]!;
 const pool=s.db.runtimePool();t.after(()=>pool.close());
 const id=await s.message('SUBMIT PICKUP '+key);assert.equal(await createConversationWorker(pool,s.whatsapp,s.keys.browser).tick(),'answered');
 assert.match(await s.reply(id),/submitted/);
 await s.turn('SUBMIT PICKUP '+key);await s.message('SUBMIT PICKUP '+key,s.phone,'wamid.pickup49');await s.worker.tick();
 await s.message('SUBMIT PICKUP '+key,s.phone,'wamid.pickup49');assert.equal(await s.worker.tick(),null);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.pickup_requests')).rows[0]!.n,1);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.pickup_events')).rows[0]!.n,1);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.bookings')).rows[0]!.n,0);
 assert.match((await s.turn('PICKUPS')).text,/submitted/);
 assert.doesNotMatch((await s.turn('PICKUPS','12025550199')).text,/submitted|Synthetic/);
 const record=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.pickup_requests')).rows[0]!;
 const foreign=await s.turn('PICKUP STATUS '+record.id,'12025550199'),unknown=await s.turn('PICKUP STATUS '+randomUUID(),'12025550199');assert.equal(foreign.text,unknown.text);
 assert.equal((await s.turn('PICKUP '+estimate.id,'12025550199')).text,(await s.turn('PICKUP '+randomUUID(),'12025550199')).text);
 assert.equal((await s.turn('CANCEL PICKUP '+record.id+' 1','12025550199')).text,(await s.turn('CANCEL PICKUP '+randomUUID()+' 1','12025550199')).text);
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.pickup_requests WHERE id=$1',[record.id])).rows[0]!.state,'submitted');
 assert.ok(!JSON.stringify(s.logs).includes('Status Road'));
 assert.ok(!JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.audit_history')).rows).includes('Status Road'));
});

await test('HTTP decision validates CSRF and unknown fields; durable submission cap preserves exact retries',{timeout:60000},async t=>{
 const s=await setup(t),p=await submit(s),url='/api/v1/pickups/'+p.id+'/decision?organization_id='+org+'&franchise_id='+A;
 const payload={expected_version:1,decision:'declined'};
 const csrf=await s.app.inject({method:'POST',url,cookies:{shipit_session:s.admin.token},payload});assert.equal(csrf.statusCode,403);
 const boot=await s.app.inject('/auth/bootstrap'),cookie=boot.cookies[0]!,headers={origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token,'idempotency-key':randomUUID()},cookies={shipit_session:s.admin.token,[cookie.name]:cookie.value};
 assert.equal((await s.app.inject({method:'POST',url,headers,cookies,payload:{...payload,franchise_id:B}})).statusCode,422);
 assert.equal((await s.app.inject({method:'POST',url,headers,cookies,payload})).statusCode,200);
 const detail=await s.app.inject({url:'/api/v1/pickups/'+p.id+'?organization_id='+org+'&franchise_id='+A,cookies});assert.equal(detail.statusCode,200);assert.equal(detail.json().state,'declined');
 await s.db.adminQuery(`INSERT INTO shipit.pickup_requests(id,organization_id,franchise_id,installation_id,contact_key,quote_id,inbox_id,request_key,address,window_start,window_end)
  SELECT gen_random_uuid(),organization_id,franchise_id,installation_id,contact_key,quote_id,inbox_id,gen_random_uuid(),address,window_start,window_end
  FROM shipit.pickup_requests CROSS JOIN generate_series(1,9) WHERE id=$1`,[p.id]);
 assert.match((await s.turn('SUBMIT PICKUP '+p.key)).text,/declined/);
 await s.turn('PICKUP '+p.estimate.id);await s.turn('12 Synthetic Street, Fictional City 123456');
 const prompt=await s.turn(p.start+' | '+p.end),key=prompt.text.match(/SUBMIT PICKUP ([0-9a-f-]{36})/)![1]!;
 assert.match((await s.turn('SUBMIT PICKUP '+key)).text,/limit reached/);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.pickup_requests')).rows[0]!.n,10);
});
await test('staff decision is scoped, versioned, capacity-reviewed and replayable; send failure preserves accepted state',{timeout:60000},async t=>{
 const s=await setup(t),p=await submit(s,'2000'),service=createPickupService(s.pool,s.whatsapp),query={organization_id:org,franchise_id:A};
 assert.equal(p.review_reason,'heavy');await s.memberships.bootstrapAdministrator(s.root.id,otherOrg);
 const operator=await s.grant('operator',[A]),reader=await s.grant('read_only',[A]),sibling=await s.grant('operator',[B]),foreign=await s.grant('operator',[C],otherOrg);
 const body={expected_version:1,decision:'accepted',agreed_start:p.start,agreed_end:p.end,capacity_checked:true,manual_reviewed:true},key=randomUUID();
 await assert.rejects(service.decide(reader.token,p.id,query,key,body,randomUUID()),/ACTION_FORBIDDEN/);
 for(const [staff,selection] of [[sibling,{organization_id:org,franchise_id:B}],[foreign,{organization_id:otherOrg,franchise_id:C}]] as const) {
  await assert.rejects(service.decide(staff.token,p.id,selection,randomUUID(),body,randomUUID()),/RESOURCE_NOT_FOUND/);
  await assert.rejects(service.detail(staff.token,p.id,selection,randomUUID()),/RESOURCE_NOT_FOUND/);
  assert.equal((await service.list(staff.token,selection,randomUUID())).items.length,0);
 }
 await assert.rejects(service.decide(operator.token,p.id,query,key,{...body,manual_reviewed:false},randomUUID()),/VALIDATION_FAILED/);
 const accepted=await service.decide(operator.token,p.id,query,key,body,randomUUID());assert.equal(accepted.state,'accepted');
 assert.deepEqual(JSON.parse(JSON.stringify(await service.decide(operator.token,p.id,query,key,body,randomUUID()))),JSON.parse(JSON.stringify(accepted)));
 await assert.rejects(service.decide(operator.token,p.id,query,key,{...body,expected_version:2},randomUUID()),/IDEMPOTENCY_CONFLICT/);
 await assert.rejects(service.decide(operator.token,p.id,query,randomUUID(),body,randomUUID()),/VERSION_CONFLICT/);
 const detail=await service.detail(operator.token,p.id,query,randomUUID());assert.ok(detail.assigned_staff_id);assert.match(detail.address,/Synthetic/);assert.equal(detail.contact,'+'+s.phone);assert.ok(detail.notification);
 assert.ok(!JSON.stringify(await service.list(operator.token,query,randomUUID())).includes(s.phone));
 s.whatsapp.provider.sendText=async()=>({kind:'unavailable',reason:'synthetic_outage'});
 while(await s.outbound.tick()!==null){/* existing durable sender */}
 assert.equal((await service.detail(operator.token,p.id,query,randomUUID())).state,'accepted');
 const m=(await s.db.adminQuery('SELECT id,version,state,attempts,sealed_payload FROM shipit.whatsapp_outbound WHERE source_kind=$1',['pickup'])).rows[0]!;
 assert.ok(['retry_wait','failed'].includes(String(m.state)));assert.ok(m.sealed_payload);assert.equal(m.attempts,1);
 s.whatsapp.provider.sendText=async()=>({kind:'accepted',provider_message_id:'wamid.recovered49'});
 await createOutboundService(s.pool,s.keys.browser).redrive(s.admin.token,String(m.id),query,randomUUID(),{expected_version:m.version,reason_code:'dependency_repaired'},randomUUID());
 const future=new Date(Date.now()+120000);
 const recovery=createOutboundWorker(s.pool,{...s.whatsapp,clock:()=>future});while(await recovery.tick()!==null){/* bounded retry recovers */}
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.whatsapp_outbound WHERE source_kind=$1',['pickup'])).rows[0]!.state,'accepted');
 await s.turn('CANCEL PICKUP '+p.id+' 1');assert.equal((await service.detail(operator.token,p.id,query,randomUUID())).state,'accepted');
});

await test('decision notification respects consent and service window; expired address drafts are purged',{timeout:60000},async t=>{
 const s=await setup(t),p=await submit(s),service=createPickupService(s.pool,s.whatsapp),query={organization_id:org,franchise_id:A};
 await service.decide(s.admin.token,p.id,query,randomUUID(),{expected_version:1,decision:'declined'},randomUUID());
 await s.db.adminQuery("UPDATE shipit.whatsapp_consent_state SET last_inbound_at=clock_timestamp()-interval '25 hours'");
 while(await s.outbound.tick()!==null){/* fail closed outside service window */}
 const row=(await s.db.adminQuery<{id:string;version:number;state:string;reason_code:string}>('SELECT id,version,state,reason_code FROM shipit.whatsapp_outbound WHERE source_kind=$1',['pickup'])).rows[0]!;
 assert.equal(row.state,'failed');assert.equal(row.reason_code,'customer_window_closed');
 await s.turn('PICKUPS');
 await createOutboundService(s.pool,s.keys.browser).redrive(s.admin.token,row.id,query,randomUUID(),{expected_version:row.version,reason_code:'dependency_repaired'},randomUUID());
 await s.message('STOP');await s.worker.tick();while(await s.outbound.tick()!==null){/* withdrawal suppresses queued decision */}
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.whatsapp_outbound WHERE id=$1',[row.id])).rows[0]!.state,'suppressed');
 // Purge runs even when no inbound work remains and never emits address contents.
 await s.db.adminQuery("UPDATE shipit.customer_conversations SET pickup_draft=$1,expires_at=clock_timestamp()-interval '1 second'",[{address:'12 abandoned private street'}]);
 await s.worker.tick();assert.equal((await s.db.adminQuery('SELECT pickup_draft FROM shipit.customer_conversations')).rows[0]!.pickup_draft,null);
});
await test('cancel/accept race has one terminal outcome; failed dependency rolls back decision and events',{timeout:60000},async t=>{
 const s=await setup(t),p=await submit(s),service=createPickupService(s.pool,s.whatsapp),query={organization_id:org,franchise_id:A};
 const body={expected_version:1,decision:'accepted',agreed_start:p.start,agreed_end:p.end,capacity_checked:true};
 await s.message('CANCEL PICKUP '+p.id+' 1');
 await Promise.allSettled([s.worker.tick(),service.decide(s.admin.token,p.id,query,randomUUID(),body,randomUUID())]);
 const row=(await s.db.adminQuery('SELECT state,version FROM shipit.pickup_requests WHERE id=$1',[p.id])).rows[0]!;
 assert.ok(['accepted','canceled'].includes(String(row.state)));assert.equal(row.version,2);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.pickup_events WHERE pickup_id=$1',[p.id])).rows[0]!.n,2);
 const next=await submit(s);const owner=s.db.ownerPool();t.after(()=>owner.close());
 await owner.query(`REVOKE INSERT ON shipit.whatsapp_outbound FROM "${s.db.runtimeRole}"`);
 await assert.rejects(service.decide(s.admin.token,next.id,query,randomUUID(),{...body,agreed_start:next.start,agreed_end:next.end},randomUUID()));
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.pickup_requests WHERE id=$1',[next.id])).rows[0]!.state,'submitted');
});

await test('pickup migration upgrades populated quote conversations and repeat is a no-op',{timeout:40000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:32}),{applied:32});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await auditSetup(t,undefined,db);await db.prepareConversations();
 const admin=await s.grant('franchise_admin',[A]),binding={key:'upgrade48',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:upgrade48/v1'};
 await createWhatsappService(s.pool,{configuration:{graph_version:'v24.0',bindings:[binding]},provider:{validate:async()=>{},template:async()=>{throw new Error('unused');},send:async()=>({kind:'unavailable',reason:'unused'})}}).execute(
  admin.token,null,'connect',{organization_id:org,franchise_id:A},randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
 await db.adminQuery(`INSERT INTO shipit.customer_conversations(id,organization_id,franchise_id,installation_id,contact_key,selected_docket,pending_intent,state,expires_at)
  SELECT $1,organization_id,franchise_id,id,$2,'OLD48','tracking','human_requested',clock_timestamp()+interval '15 minutes' FROM shipit.whatsapp_installations`,[randomUUID(),'a'.repeat(64)]);
 const snapshot=async()=>(await db.adminQuery('SELECT id,selected_docket,pending_intent,state,version,expires_at FROM shipit.customer_conversations')).rows;
 const before=await snapshot();assert.equal(before.length,1);db.migrate=migrate;
 assert.deepEqual(await db.migrate(),{applied:8});assert.deepEqual(await db.migrate(),{applied:0});
 assert.deepEqual(await snapshot(),before);assert.equal((await db.adminQuery('SELECT pickup_draft FROM shipit.customer_conversations')).rows[0]!.pickup_draft,null);
 assert.equal((await db.adminQuery('SELECT count(*)::integer n FROM shipit.customer_quote_policies')).rows[0]!.n,0);
});
