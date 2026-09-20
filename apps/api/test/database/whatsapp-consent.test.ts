import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { whatsappSetup } from '../whatsapp-support.ts';
import { callback,inbound,webhookConfig,signed } from '../webhook-fixture.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { paymentFault } from '../payment-support.ts';
import { normalizeBusinessWebhook } from '../../src/modules/whatsapp/webhook-payload.ts';
import { persistBusinessWebhook } from '../../src/modules/security/jobs.ts';
import { createInboxWorker } from '../../src/modules/whatsapp/inbox-worker.ts';
import { createConsentWorker,consentContactKey } from '../../src/modules/whatsapp/consent-worker.ts';
import { createConsentService } from '../../src/modules/whatsapp/consent-service.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';

async function setup(t:TestContext) {
  const s=await whatsappSetup(t);await s.db.prepareWhatsappConsent();
  const connection=await s.connect();assert.equal(connection.statusCode,200);const installation=connection.json().id as string;
  let now=new Date();const customer=randomUUID();
  await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display,contact_changed_at)
    VALUES($1,$2,$3,'Fictional customer','+15550000001','+15550000001',clock_timestamp()-interval '1 day')`,[customer,org,A]);
  const deps={...s.dependencies,configuration:{...s.dependencies.configuration,webhook:webhookConfig},clock:()=>now};
  const service=createConsentService(s.pool,deps),worker=createConsentWorker(s.pool,webhookConfig),inbox=createInboxWorker(s.pool);
  const query={organization_id:org,franchise_id:A};
  const policy=(purpose='updates',extra:Record<string,unknown>={})=>service.policy(s.local.token,customer,query,{purpose,format:'text',...extra},randomUUID());
  async function receive(text:string,options:{reply?:string;offset?:number;id?:string;phone?:string;waba?:string}={}) {
    const message={...inbound(options.id??'wamid.'+randomUUID(),text),timestamp:String(Math.floor(now.getTime()/1000)+(options.offset??0)),...(options.reply?{context:{id:options.reply}}:{})};
    await persistBusinessWebhook(s.pool,normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([message],{kind:'messages',phone:options.phone,waba:options.waba}))),webhookConfig),webhookConfig.waba_ids,randomUUID());
    await inbox.tick();return message;
  }
  async function disclose(id='wamid.disclosure',offset=-10) {
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_consent_disclosures(organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,message_id,purpose,policy_version,disclosure_hash,disclosed_at,expires_at)
      SELECT $1,$2,$3,c.id,c.contact_version,$5,$6,'updates','whatsapp-consent-v1',$7,$8::timestamptz,$8::timestamptz+interval '1 hour' FROM shipit.customers c WHERE id=$4`,
      [org,A,installation,customer,consentContactKey(webhookConfig,installation,'+15550000001'),id,'a'.repeat(64),new Date(now.getTime()+offset*1000)]);
    return id;
  }
  const history=()=>service.history(s.local.token,customer,query,randomUUID());
  return {...s,installation,customer,deps,service,worker,inbox,policy,receive,disclose,history,query,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
await test('unknown and bare START stay unconfirmed; evidenced START is durable and STOP suppresses queued work',{timeout:30000},async t=>{
  const s=await setup(t);assert.equal((await s.policy()).allowed,false);
  await s.receive('START');assert.equal(await s.worker.tick(),'disclosure_required');
  assert.equal((await s.policy()).allowed,false);
  const reply=await s.disclose();s.advance(1000);const start=await s.receive('START UPDATES',{reply});
  assert.equal(await s.worker.tick(),'granted');assert.equal((await s.policy()).allowed,true);
  await s.receive('START UPDATES',{reply,id:start.id,offset:-0}); // timestamp same: duplicate logical callback
  assert.equal(await s.worker.tick(),null);
  const fresh=createConsentService(s.db.runtimePool(),s.deps);
  assert.equal((await fresh.history(s.local.token,s.customer,s.query,randomUUID())).current.allowed,true);
  const queued=await s.policy();assert.equal(queued.allowed,true);
  s.advance(1000);await s.receive('STOP');assert.equal((await s.policy()).reason,'consent_processing_pending');
  assert.equal(await s.worker.tick(),'revoked');assert.equal((await s.policy()).reason,'consent_revoked');
  const history=await s.history();assert.equal(history.history.length,3);
  assert.ok(history.history.every(r=>r.policy_version==='whatsapp-consent-v1'&&r.source==='signed_webhook'));
  assert.ok(!JSON.stringify(history).includes('15550000001'));
});
await test('concurrent callbacks deduplicate effects; stale START and old disclosure cannot undo STOP',{timeout:30000},async t=>{
  const s=await setup(t),reply=await s.disclose();await s.receive('STOP');
  await Promise.all([s.worker.tick(),s.worker.tick(),s.worker.tick()]);
  s.advance(1000);await s.receive('START UPDATES',{reply});assert.equal(await s.worker.tick(),'source_stale');
  assert.equal((await s.policy()).reason,'consent_revoked');
  const count=(await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_consent_receipts')).rows[0]!.n;assert.equal(count,2);
  await assert.rejects(s.pool.query('DELETE FROM shipit.whatsapp_consent_receipts'));
  await assert.rejects(s.pool.query("UPDATE shipit.whatsapp_consent_state SET state='granted'"));
  await assert.rejects(s.pool.query('INSERT INTO shipit.whatsapp_consent_disclosures DEFAULT VALUES'));
});
await test('contact changes invalidate consent even when a prior number is restored; sibling identity never inherits',{timeout:30000},async t=>{
  const s=await setup(t),reply=await s.disclose();await s.receive('START UPDATES',{reply});await s.worker.tick();assert.equal((await s.policy()).allowed,true);
  await s.db.adminQuery("UPDATE shipit.customers SET phone_normalized='+15550000002',phone_display='+15550000002' WHERE id=$1",[s.customer]);
  assert.equal((await s.policy()).allowed,false);
  await s.db.adminQuery("UPDATE shipit.customers SET phone_normalized='+15550000001',phone_display='+15550000001' WHERE id=$1",[s.customer]);
  assert.equal((await s.policy()).reason,'contact_unconfirmed');
  const sibling=randomUUID();await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display)
    VALUES($1,$2,$3,'Sibling fiction','+15550000001','+15550000001')`,[sibling,org,B]);
  await s.request('installations',{binding_key:'beta_v1',expected_version:0},s.sibling.token,B);
  assert.equal((await s.service.policy(s.sibling.token,sibling,{organization_id:org,franchise_id:B},{purpose:'updates',format:'text'},randomUUID())).allowed,false);
  for(const [token,franchise,organization] of [[s.local.token,B,org],[s.local.token,C,otherOrg],[s.sibling.token,A,org],[s.foreign.token,A,org]])
    await assert.rejects(s.service.history(token!,s.customer,{organization_id:organization,franchise_id:franchise},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  const reader=await s.grant('read_only',[A]);await assert.rejects(s.service.history(reader.token,s.customer,s.query,randomUUID()),{code:'ACTION_FORBIDDEN'});
});
await test('missing decryption key fails closed without logging content; malformed policy and foreign nested customer are denied',{timeout:30000},async t=>{
  const s=await setup(t);await s.receive('START UPDATES');
  const worker=createConsentWorker(s.pool,{...webhookConfig,key_version:'different'});assert.equal(await worker.tick(),'key_unavailable');
  assert.equal((await s.policy()).reason,'consent_processing_pending');
  assert.equal(await worker.tick(),null);
  await assert.rejects(s.service.policy(s.local.token,s.customer,s.query,{purpose:'updates',format:'text',organization_id:otherOrg},randomUUID()),{code:'VALIDATION_FAILED'});
  await assert.rejects(s.service.history(s.local.token,randomUUID(),s.query,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});
await test('rollback and lost commit acknowledgement preserve atomic state, receipt and canonical audit',{timeout:30000},async t=>{
  const s=await setup(t),reply=await s.disclose();await s.receive('START UPDATES',{reply});
  await assert.rejects(createConsentWorker(paymentFault(s.pool,'COMMIT','before'),webhookConfig).tick());
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_consent_receipts')).rows[0]!.n,0);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_consent_state')).rows[0]!.n,0);
  await assert.rejects(createConsentWorker(paymentFault(s.pool,'COMMIT','after'),webhookConfig).tick());
  assert.equal(await s.worker.tick(),null);
  assert.equal((await s.policy()).allowed,true);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE action='consent.start'")).rows[0]!.n,1);
  await s.db.adminQuery(`CREATE FUNCTION shipit.synthetic_consent_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private detail'; END $$;
    CREATE TRIGGER synthetic_consent_failure BEFORE INSERT ON shipit.whatsapp_consent_receipts FOR EACH ROW EXECUTE FUNCTION shipit.synthetic_consent_fail()`);
  s.advance(1000);await s.receive('STOP');await assert.rejects(s.worker.tick());
  assert.equal((await s.db.adminQuery('SELECT state FROM shipit.whatsapp_consent_state')).rows[0]!.state,'granted');
  assert.equal((await s.policy()).allowed,false);
  await s.db.adminQuery('DROP TRIGGER synthetic_consent_failure ON shipit.whatsapp_consent_receipts');
  assert.equal(await s.worker.tick(),'revoked');assert.equal((await s.policy()).reason,'consent_revoked');
});
await test('real HTTP signed callback and restarted operator API expose safe history and current suppression',{timeout:30000},async t=>{
  const s=await setup(t);
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const logs:string[]=[];
  const make=()=>buildServer({config,database:s.db.runtimePool(),auth:{keys:s.keys,delivery:{},webhook:undefined},whatsapp:s.deps,logSink:{write:x=>logs.push(x)}});
  const app=make();t.after(()=>app.close());await app.listen({host:'127.0.0.1',port:0});
  const address=app.server.address();assert.ok(address&&typeof address==='object');
  const body=JSON.stringify(callback([{...inbound('wamid.http38','STOP'),timestamp:String(Math.floor(Date.now()/1000))}],{kind:'messages'}));
  const response=await fetch(`http://127.0.0.1:${address.port}/webhooks/whatsapp`,{method:'POST',body,headers:signed(body)});
  assert.equal(response.status,200);await s.inbox.tick();await s.worker.tick();await app.close();
  const fresh=make();t.after(()=>fresh.close());
  const url=`/api/v1/whatsapp/consent/customers/${s.customer}?`+new URLSearchParams(s.query);
  const history=await fresh.inject({url,cookies:{shipit_session:s.local.token}});assert.equal(history.statusCode,200,history.body);
  assert.equal(history.json().history[0].outcome,'revoked');
  const bootstrap=await fresh.inject('/auth/bootstrap');const browser=bootstrap.cookies[0]!;
  const policy=await fresh.inject({method:'POST',url:url.replace('?','/policy?'),cookies:{shipit_session:s.local.token,[browser.name]:browser.value},
    headers:{origin:'http://localhost:5173','x-csrf-token':bootstrap.json().csrf_token},payload:{purpose:'updates',format:'text'}});
  assert.equal(policy.statusCode,200,policy.body);assert.equal(policy.json().allowed,false);
  for(const secret of ['15550000001',webhookConfig.encryption_key,webhookConfig.fingerprint_key,'wamid.http38','STOP'])assert.ok(!JSON.stringify(logs).includes(secret));
  assert.ok(!history.body.includes('15550000001'));assert.ok(!history.body.includes('sealed_payload'));
});
await test('requested assistance is separate; current template revocation and expiry are enforced from stored evidence',{timeout:30000},async t=>{
  const s=await setup(t);await s.receive('Where is my parcel?');await s.worker.tick();
  const source=(await s.db.adminQuery('SELECT inbox_id FROM shipit.whatsapp_consent_receipts')).rows[0]!.inbox_id;
  assert.equal((await s.policy()).reason,'consent_unknown');
  assert.equal((await s.policy('requested_assistance',{requested_inbox_id:source})).allowed,true);
  assert.equal((await s.policy('requested_assistance',{requested_inbox_id:randomUUID()})).allowed,false);
  const reply=await s.disclose();s.advance(1000);await s.receive('START UPDATES',{reply});await s.worker.tick();
  s.advance(86400000);assert.equal((await s.policy()).reason,'approved_template_required');
  const registry=createWhatsappService(s.pool,s.deps);
  await registry.execute(s.local.token,s.installation,'sync',s.query,randomUUID(),{expected_version:1,name:'parcel_update',language:'en_US'},randomUUID());
  const template={format:'template',template_name:'parcel_update',template_language:'en_US',variables:['Synthetic parcel']};
  assert.equal((await s.policy('updates',template)).allowed,true);
  s.setStatus('PAUSED');await registry.execute(s.local.token,s.installation,'sync',s.query,randomUUID(),{expected_version:2,name:'parcel_update',language:'en_US'},randomUUID());
  assert.equal((await s.policy('updates',template)).reason,'template_not_approved');
});
await test('expired disclosure, shared contact ambiguity and future callbacks cannot grant permission',{timeout:30000},async t=>{
  const s=await setup(t),expired=await s.disclose('wamid.expired',-7200);
  await s.receive('START UPDATES',{reply:expired});assert.equal(await s.worker.tick(),'disclosure_required');
  const reply=await s.disclose();await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display,contact_changed_at)
    VALUES($1,$2,$3,'Shared fiction','+15550000001','+15550000001',clock_timestamp()-interval '1 day')`,[randomUUID(),org,A]);
  s.advance(1000);await s.receive('START UPDATES',{reply});assert.equal(await s.worker.tick(),'contact_ambiguous');
  assert.equal((await s.policy()).allowed,false);
  await s.receive('START UPDATES',{reply,offset:3600});assert.equal(await s.worker.tick(),'source_invalid');
  assert.equal((await s.policy()).reason,'consent_processing_pending');
});
