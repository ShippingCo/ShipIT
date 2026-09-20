import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { outboundSetup } from '../outbound-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createOutboundWorker } from '../../src/modules/whatsapp/outbound-worker.ts';
import { createOutboundService } from '../../src/modules/whatsapp/outbound-service.ts';
import { createConsentService } from '../../src/modules/whatsapp/consent-service.ts';
import { paymentFault } from '../payment-support.ts';
import { withTransaction } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import { enqueueMessage } from '../../src/modules/whatsapp/outbound-enqueue.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { webhookConfig,signed,callback,inbound } from '../webhook-fixture.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { createOutboxWorker } from '../../src/modules/outbox/worker.ts';

await test('concurrent enqueue/replay has one intent and one send across restart; stale callbacks never regress',{timeout:30000},async t=>{
 const s=await outboundSetup(t),results=await Promise.all([s.enqueue(),s.enqueue(),s.enqueue()]);assert.equal(new Set(results.map(r=>r.id)).size,1);const id=results[0]!.id;
 await assert.rejects(s.enqueue({...s.input,text:'Different intent'}));
 s.setSend(async()=>({kind:'accepted',provider_message_id:'wamid.delivered39'}));
 await Promise.all([s.worker.tick(),s.worker.tick()]);assert.equal(s.calls(),1);assert.equal((await s.detail(id)).message.state,'accepted');
 const worker=createOutboundWorker(s.db.runtimePool(),s.dependencies);assert.equal(await worker.tick(),null);
 await s.status('wamid.delivered39','read');await worker.tick();assert.equal((await s.detail(id)).message.state,'read');
 await s.status('wamid.delivered39','delivered');await s.status('wamid.delivered39','failed');await worker.tick();assert.equal((await s.detail(id)).message.state,'read');
 const fresh=createOutboundService(s.db.runtimePool(),s.keys.browser);assert.equal((await fresh.detail(s.local.token,id,s.query,randomUUID())).attempts.length,1);
 const saved=(await s.db.adminQuery('SELECT sealed_payload FROM shipit.whatsapp_outbound WHERE id=$1',[id])).rows[0]!;assert.equal(saved.sealed_payload,null);
});
await test('accept then timeout and expired reservation are uncertain, never blindly retried; explicit redrive is audited',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();s.setSend(async()=>{throw new Error('accepted then private transport timeout');});
 assert.equal(await s.worker.tick(),'uncertain');assert.equal(await s.worker.tick(),null);assert.equal(s.calls(),1);
 let detail=await s.detail(id);assert.equal(detail.message.state,'uncertain');
 assert.equal(await createOutboundWorker(s.db.runtimePool(),s.dependencies).attention(),true);
 await assert.rejects(s.service.redrive(s.local.token,id,s.query,randomUUID(),{expected_version:detail.message.version,reason_code:'dependency_repaired'},randomUUID()),{code:'VERSION_CONFLICT'});
 const key=randomUUID(),body={expected_version:detail.message.version,reason_code:'retry_uncertain_confirmed'};
 const result=await s.service.redrive(s.local.token,id,s.query,key,body,randomUUID());
 assert.deepEqual(await s.service.redrive(s.local.token,id,s.query,key,body,randomUUID()),result);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE action='whatsapp.redrive'")).rows[0]!.n,1);
 // Lost reservation COMMIT acknowledgement must never start HTTP.
 await assert.rejects(createOutboundWorker(paymentFault(s.pool,'COMMIT','after'),s.dependencies).tick());assert.equal(s.calls(),1);
 s.advance(31000);assert.equal(await s.worker.tick(),'uncertain');assert.equal(s.calls(),1);
 detail=await s.detail(id);assert.equal(detail.attempts.length,2);assert.equal(detail.message.id,id);
});
await test('429 waits for Retry-After and STOP during backoff suppresses the retained intent',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();s.setSend(async()=>({kind:'retryable_not_accepted',reason:'rate_limited',retry_after_seconds:120}));
 assert.equal(await s.worker.tick(),'retry_wait');s.advance(119000);assert.equal(await s.worker.tick(),null);assert.equal(s.calls(),1);
 await s.receive('STOP');s.advance(1000);assert.equal(await s.worker.tick(),'suppressed');assert.equal((await s.detail(id)).message.reason_code,'consent_revoked');assert.equal(s.calls(),1);
});
await test('five confirmed rejections dead-letter; permanent credential failure stops, redrive retains identity',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();s.setSend(async()=>({kind:'retryable_not_accepted',reason:'rate_limited'}));
 for(let n=0;n<5;n++){await s.worker.tick();s.advance(60000);}assert.equal(s.calls(),5);assert.equal(await s.worker.tick(),null);
 const detail=await s.detail(id);assert.equal(detail.message.state,'failed');assert.equal(detail.attempts.length,5);
 await s.service.redrive(s.local.token,id,s.query,randomUUID(),{expected_version:detail.message.version,reason_code:'dependency_repaired'},randomUUID());
 s.setSend(async()=>({kind:'configuration_failure',reason:'private provider body'}));assert.equal(await s.worker.tick(),'failed');assert.equal(await s.worker.tick(),null);
 assert.equal((await s.detail(id)).message.attempts,6);assert.ok(!JSON.stringify(await s.detail(id)).includes('private provider'));
});
await test('only verified disclosure delivery can support START; acceptance alone is insufficient',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue({...s.input,purpose:'consent_disclosure',text:undefined});
 s.setSend(async()=>({kind:'accepted',provider_message_id:'wamid.disclosure39'}));await s.worker.tick();
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_consent_disclosures')).rows[0]!.n,0);
 s.advance(1000);await s.status('wamid.disclosure39','delivered');await s.worker.tick();assert.equal((await s.detail(id)).message.state,'delivered');
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_consent_disclosures')).rows[0]!.n,1);
 s.advance(1000);await s.receive('START UPDATES','wamid.disclosure39');
 assert.equal((await createConsentService(s.pool,s.dependencies).policy(s.local.token,s.customer,s.query,{purpose:'updates',format:'text'},randomUUID())).allowed,true);
 await assert.rejects(s.pool.query('INSERT INTO shipit.whatsapp_consent_disclosures DEFAULT VALUES'));
});
await test('foreign IDs, roles, nested sources and contacts are denied without leaking content; HTTP history survives restart',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();
 for(const [token,franchise,organization] of [[s.sibling.token,B,org],[s.foreign.token,C,otherOrg]]) {
  await assert.rejects(s.service.detail(token!,id,{organization_id:organization,franchise_id:franchise},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  assert.deepEqual((await s.service.health(token!,{organization_id:organization,franchise_id:franchise},randomUUID())).states,[]);
 }
 const reader=await s.grant('read_only',[A]);await assert.rejects(s.service.detail(reader.token,id,s.query,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(s.enqueue({...s.input,customer_id:randomUUID()}));await assert.rejects(s.enqueue({...s.input,source_id:randomUUID()}));
 for(const [organization,franchise] of [[org,B],[otherOrg,C]]) {
  const foreignCustomer=randomUUID();await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display)
   VALUES($1,$2,$3,'Foreign synthetic customer','+15550000001','+15550000001')`,[foreignCustomer,organization,franchise]);
  await assert.rejects(s.enqueue({...s.input,customer_id:foreignCustomer}));
 }
 await assert.rejects(s.enqueue({...s.input,organization_id:otherOrg}));
 const response=await s.request('outbound/'+id);assert.equal(response.statusCode,200,response.body);
 for(const privateValue of ['15550000001',s.input.text!,'sealed_payload','contact_key','provider_message_id'])assert.ok(!response.body.includes(privateValue));
 await assert.rejects(s.pool.query('DELETE FROM shipit.whatsapp_outbound'));await assert.rejects(s.pool.query('TRUNCATE shipit.whatsapp_outbound CASCADE'));
 await assert.rejects(s.pool.query("UPDATE shipit.whatsapp_outbound SET customer_id=$1 WHERE id=$2",[randomUUID(),id]));
});
await test('rollback leaves no partial intent and expired rendering is purged without sending',{timeout:30000},async t=>{
 const s=await outboundSetup(t);await assert.rejects(s.enqueue(s.input,paymentFault(s.pool,'COMMIT','before')));
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
 const {id}=await s.enqueue();s.advance(86400001);assert.equal(await s.worker.tick(),'expired');assert.equal(s.calls(),0);
 assert.equal((await s.detail(id)).message.state,'suppressed');
});
await test('committed booking survives queue failure; event/customer ownership is checked before any intent',{timeout:30000},async t=>{
 const s=await bookingSetup(t),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);await s.db.prepareWhatsappOutbound();
 const admin=await s.grant('franchise_admin',[A]);
 const dependencies={configuration:{graph_version:'v24.0',bindings:[{key:'alpha',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:alpha/v1'}],webhook:webhookConfig},
  provider:{validate:async()=>{},template:async()=>{throw new Error();},send:async()=>({kind:'uncertain' as const,reason:'synthetic'})}};
 await createWhatsappService(s.pool,dependencies).execute(admin.token,null,'connect',{organization_id:org,franchise_id:A},randomUUID(),{binding_key:'alpha',expected_version:0},randomUUID());
 const event=(await s.db.adminQuery("SELECT event_id FROM shipit.domain_events WHERE event_type='booking.created'")).rows[0]!.event_id;
 const input={source_kind:'event',source_id:event,customer_id:s.source.id,purpose:'updates',format:'text',text:'Synthetic booking acknowledgement'};
 const queue=(pool=s.pool,value:unknown=input)=>withTransaction(pool,tx=>enqueueMessage(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:org,
  permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),dependencies,value));
 const before=await s.counts();await assert.rejects(queue(paymentFault(s.pool,'COMMIT','before')));assert.deepEqual(await s.counts(),before);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
 const first=await queue();assert.deepEqual(await queue(),first);assert.deepEqual(await s.counts(),before);
 assert.equal((await s.db.adminQuery('SELECT state FROM shipit.whatsapp_outbound WHERE id=$1',[first.id])).rows[0]!.state,'suppressed');
 const other=randomUUID();await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display)
 VALUES($1,$2,$3,'Unrelated fictional customer','+15550000008','+15550000008')`,[other,org,A]);
 await assert.rejects(queue(s.pool,{...input,customer_id:other}));
 // The real #35 receipt and enqueue effect share one transaction, with no producer rollback.
 await s.db.prepareOutbox();
 const worker=createOutboxWorker(s.pool,[{id:'synthetic.outbound39',subscriptions:{'booking.created':[1]},ordering:'H',validate:()=>true,
  apply:async scope=>{await enqueueMessage(scope,dependencies,input);}}]);
 await worker.tick();await worker.tick();assert.deepEqual(await s.counts(),before);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,1);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.outbox_receipts')).rows[0]!.n,1);
});
await test('contact changes after enqueue suppress actual provider dispatch',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();
 await s.db.adminQuery("UPDATE shipit.customers SET phone_normalized='+15550000009',phone_display='+15550000009' WHERE id=$1",[s.customer]);
 assert.equal(await s.worker.tick(),'suppressed');assert.equal(s.calls(),0);assert.equal((await s.detail(id)).message.reason_code,'contact_changed');
});
await test('current template and installation failures stop dispatch and remain recoverable after repair',{timeout:30000},async t=>{
 const s=await outboundSetup(t),registry=createWhatsappService(s.pool,s.dependencies);
 await registry.execute(s.local.token,s.installation,'sync',s.query,randomUUID(),{expected_version:1,name:'parcel_update',language:'en_US'},randomUUID());
 const {id}=await s.enqueue({...s.input,text:undefined,format:'template',template_name:'parcel_update',template_language:'en_US',variables:['Synthetic']});
 s.setStatus('PAUSED');await registry.execute(s.local.token,s.installation,'sync',s.query,randomUUID(),{expected_version:2,name:'parcel_update',language:'en_US'},randomUUID());
 assert.equal(await s.worker.tick(),'failed');assert.equal(s.calls(),0);assert.equal((await s.detail(id)).message.reason_code,'template_not_approved');
 s.setStatus('APPROVED');await registry.execute(s.local.token,s.installation,'sync',s.query,randomUUID(),{expected_version:3,name:'parcel_update',language:'en_US'},randomUUID());
 await s.service.redrive(s.local.token,id,s.query,randomUUID(),{expected_version:(await s.detail(id)).message.version,reason_code:'dependency_repaired'},randomUUID());
 assert.equal(await s.worker.tick(),'accepted');assert.equal(s.calls(),1);
 const source=await s.receive('Another synthetic request');const second=await s.enqueue({...s.input,source_id:source});
 await registry.execute(s.local.token,s.installation,'disable',s.query,randomUUID(),{expected_version:4},randomUUID());
 assert.equal(await s.worker.tick(),'failed');assert.equal((await s.detail(second.id)).message.reason_code,'installation_unavailable');assert.equal(s.calls(),1);
});
await test('callback before response persistence reconciles after acceptance; failed callback does not become delivered',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();s.setSend(async()=>{await s.status('wamid.early39','delivered');return {kind:'accepted',provider_message_id:'wamid.early39'};});
 assert.equal(await s.worker.tick(),'accepted');assert.equal(await s.worker.tick(),'delivered');assert.equal((await s.detail(id)).message.state,'delivered');
 const source=await s.receive('Another request'),second=await s.enqueue({...s.input,source_id:source});
 s.setSend(async()=>({kind:'accepted',provider_message_id:'wamid.failed39'}));await s.worker.tick();await s.status('wamid.failed39','failed');
 assert.equal(await s.worker.tick(),'failed');assert.equal((await s.detail(second.id)).message.state,'failed');assert.equal(await s.worker.tick(),null);
});
await test('accepted HTTP followed by database failure recovers uncertain without a second send',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();
 const faulty=createOutboundWorker(paymentFault(s.pool,'INSERT INTO shipit.whatsapp_outbound_attempts','before'),s.dependencies);
 await assert.rejects(faulty.tick());assert.equal(s.calls(),1);assert.equal((await s.detail(id)).message.state,'dispatching');
 s.advance(31000);assert.equal(await s.worker.tick(),'uncertain');assert.equal(await s.worker.tick(),null);assert.equal(s.calls(),1);
});
await test('redrive HTTP enforces current roles, CSRF, expected revision and same-key intent',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();s.setSend(async()=>({kind:'permanent_failure',reason:'template_rejected'}));await s.worker.tick();
 const detail=await s.detail(id),body={expected_version:detail.message.version,reason_code:'dependency_repaired'};
 assert.equal((await s.request('outbound/'+id+'/redrive',body,s.admin.token)).statusCode,403);
 for(const role of ['read_only','accountant','operator','dispatcher','delivery_agent']) {
  const actor=await s.grant(role,[A]);assert.equal((await s.request('outbound/'+id+'/redrive',body,actor.token)).statusCode,403);
 }
 const url='/api/v1/whatsapp/outbound/'+id+'/redrive?'+new URLSearchParams(s.query);
 assert.equal((await s.app.inject({method:'POST',url,cookies:s.cookies(s.local.token),payload:body})).statusCode,403);
 assert.equal((await s.request('outbound/'+id+'/redrive',{...body,expected_version:1})).statusCode,409);
 const key=randomUUID(),result=await s.request('outbound/'+id+'/redrive',body,s.local.token,A,org,key);assert.equal(result.statusCode,200,result.body);
 assert.deepEqual((await s.request('outbound/'+id+'/redrive',body,s.local.token,A,org,key)).json(),result.json());
 assert.equal((await s.request('outbound/'+id+'/redrive',{...body,reason_code:'retry_uncertain_confirmed'},s.local.token,A,org,key)).statusCode,409);
});
await test('real loopback HTTP accepts signed STOP; restarted app reads outbound state and never leaks private rendering',{timeout:30000},async t=>{
 const s=await outboundSetup(t),{id}=await s.enqueue();const logs:string[]=[];
 const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
 const make=()=>buildServer({config,database:s.db.runtimePool(),auth:{keys:s.keys,delivery:{},webhook:undefined},whatsapp:s.dependencies,logSink:{write:x=>logs.push(x)}});
 const app=make();t.after(()=>app.close());await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();assert.ok(address&&typeof address==='object');
 const body=JSON.stringify(callback([{...inbound('wamid.pendingStop39','STOP'),timestamp:String(Math.floor(Date.now()/1000))}],{kind:'messages'}));
 const response=await fetch(`http://127.0.0.1:${address.port}/webhooks/whatsapp`,{method:'POST',body,headers:signed(body)});assert.equal(response.status,200);
 assert.equal(await s.worker.tick(),'suppressed');assert.equal(s.calls(),0);await app.close();
 const fresh=make();t.after(()=>fresh.close());await fresh.listen({host:'127.0.0.1',port:0});const next=fresh.server.address();assert.ok(next&&typeof next==='object');
 const result=await fetch(`http://127.0.0.1:${next.port}/api/v1/whatsapp/outbound/${id}?`+new URLSearchParams(s.query),{headers:{cookie:`shipit_session=${s.local.token}`}});
 assert.equal(result.status,200);const text=await result.text();assert.equal(JSON.parse(text).message.reason_code,'consent_processing_pending');
 for(const secret of ['15550000001',s.input.text!,webhookConfig.encryption_key,webhookConfig.fingerprint_key,s.local.token])assert.ok(!(text+JSON.stringify(logs)).includes(secret));
});
