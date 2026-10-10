import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auditSetup,org,A,B,otherOrg,C } from '../audit-support.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { createInboxWorker } from '../../src/modules/whatsapp/inbox-worker.ts';
import { createConsentWorker } from '../../src/modules/whatsapp/consent-worker.ts';
import { createConversationWorker } from '../../src/modules/conversations/worker.ts';
import { createOutboundWorker } from '../../src/modules/whatsapp/outbound-worker.ts';
import { createSupportService } from '../../src/modules/support/service.ts';
import { openOutbound } from '../../src/modules/whatsapp/outbound-rules.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { webhookConfig,callback,inbound,signed } from '../webhook-fixture.ts';
import type { WhatsappDependencies } from '../../src/modules/whatsapp/types.ts';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';

async function setup(t:Parameters<typeof auditSetup>[0]) {
 const s=await auditSetup(t);await s.db.prepareSupport();const admin=await s.grant('franchise_admin',[A]);
 const binding={key:'support50',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:support50/v1'};
 const sends:string[]=[],logs:string[]=[],deps:WhatsappDependencies={configuration:{graph_version:'v24.0',bindings:[binding],webhook:webhookConfig,
  outbound_enabled:true,customer_access_enabled:true,conversation_enabled:true,support_enabled:true},provider:{validate:async()=>{},template:async()=>{throw new Error('unused');},
  send:async()=>({kind:'unavailable',reason:'unused'}),sendText:async(_b,_p,text)=>{sends.push(text);return {kind:'accepted',provider_message_id:'wamid.'+randomUUID()};}}};
 await createWhatsappService(s.pool,deps).execute(admin.token,null,'connect',{organization_id:org,franchise_id:A},randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
 const app=buildServer({database:s.pool,config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'}),auth:{keys:s.keys,delivery:{},webhook:undefined},whatsapp:deps,logSink:{write:x=>logs.push(x)}});t.after(()=>app.close());
 const worker=createConversationWorker(s.pool,deps,s.keys.browser),outbound=createOutboundWorker(s.pool,deps),service=createSupportService(s.pool,deps),query={organization_id:org,franchise_id:A};
 async function turn(text:string,from='12025550150',messageId='wamid.'+randomUUID(),processor=worker) {
  const payload=JSON.stringify(callback([{...inbound(messageId,text),from,timestamp:String(Math.floor(Date.now()/1000))}],{waba:'100001',phone:'100002',kind:'messages'}));
  assert.equal((await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:signed(payload),payload})).statusCode,200);
  while(await createInboxWorker(s.pool).tick()!==null){/* signed source */}
  while(await createConsentWorker(s.pool,webhookConfig).tick()!==null){/* consent */}
  const result=await processor.tick();
  const id=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.whatsapp_inbox WHERE message_id=$1',[messageId])).rows[0]!.id;
  return {id,result};
 }
 const list=()=>service.list(admin.token,query,randomUUID());
 const detail=(id:string)=>service.detail(admin.token,id,query,randomUUID());
 const cmd=(id:string,body:unknown,token=admin.token,key=randomUUID())=>service.command(token,id,query,key,body,randomUUID());
 const drain=async()=>{for(let n=0;n<30;n++){if(await outbound.tick()===null)return;}throw new Error('Unexpected outbound loop');};
 return {...s,admin,deps,sends,logs,app,worker,outbound,service,query,turn,list,detail,cmd,drain};
}
await test('HELP deduplicates across expiry/restart, unknown intent opens a case and resolution restores tools',{timeout:60000},async t=>{
 const s=await setup(t);const first=await s.turn('HELP');assert.equal(first.result,'human_requested');
 const c=(await s.list()).items[0]!;await s.drain();assert.equal(s.sends.length,1);assert.match(s.sends[0]!,/hours are not configured/);
 await assert.rejects(s.pool.query(`INSERT INTO shipit.support_cases(id,organization_id,franchise_id,conversation_id,installation_id,contact_key,inbox_id,reason)
 SELECT $1,organization_id,franchise_id,conversation_id,installation_id,contact_key,inbox_id,reason FROM shipit.support_cases WHERE id=$2`,[randomUUID(),c.id]),{code:'DB_QUERY_FAILED',sqlState:'23505'});
 await s.turn('HELP');await s.turn('unrecognized question');await s.turn('RESUME');
 await s.db.adminQuery(`UPDATE shipit.customer_conversations SET expires_at=clock_timestamp()-interval '1 day'`);
 assert.equal((await s.turn('tracking')).result,'paused');assert.equal((await s.list()).items.length,1);
 const disabled={...s.deps,configuration:{...s.deps.configuration,support_enabled:false}};
 // A kill switch must not silently return an existing owned case to the bot.
 const pending=await s.turn('ETA','12025550150','wamid.'+randomUUID(),createConversationWorker(s.pool,disabled,s.keys.browser));assert.equal(pending.result,'paused');
 const pool=s.db.runtimePool();t.after(()=>pool.close());assert.equal((await createSupportService(pool,s.deps).detail(s.admin.token,c.id,s.query,randomUUID())).state,'open');
 await s.cmd(c.id,{action:'claim',expected_version:1});await s.cmd(c.id,{action:'resolve',expected_version:2,reason:'answered'});
 assert.equal((await s.turn('tracking')).result,'not_found');
 await s.turn('another unknown question');assert.equal((await s.list()).items.length,2);
 await assert.rejects(s.cmd(c.id,{action:'reopen',expected_version:3,reason:'needs_followup'}),{code:'VERSION_CONFLICT'});
 assert.equal((await s.detail(c.id)).history[0]!.action,'resolved');
});
await test('dispatch rechecks window expiry and never revives a reply from an earlier ownership term',{timeout:60000},async t=>{
 const s=await setup(t);await s.turn('HELP');const c=(await s.list()).items[0]!;await s.cmd(c.id,{action:'claim',expected_version:1});await s.drain();
 await s.cmd(c.id,{action:'respond',expected_version:2,text:'We are checking the route.'});
 await s.db.adminQuery(`UPDATE shipit.whatsapp_consent_state SET last_inbound_at=clock_timestamp()-interval '25 hours'`);await s.drain();
 assert.equal((await s.detail(c.id)).history[0]!.message_reason,'customer_window_closed');assert.equal(s.sends.length,0);
 await s.cmd(c.id,{action:'resolve',expected_version:3,reason:'answered'});await s.cmd(c.id,{action:'reopen',expected_version:4,reason:'needs_followup'});await s.cmd(c.id,{action:'claim',expected_version:5});await s.turn('Hello');
 // Emulate a permitted admin redrive, preserving immutable source identity.
 await s.db.adminQuery(`UPDATE shipit.whatsapp_outbound SET state='queued',version=version+1 WHERE source_kind='support'`);
 await s.drain();assert.equal(s.sends.length,0);
 assert.equal((await s.detail(c.id)).history.find(e=>e.action==='responded')!.message_state,'suppressed');
});
await test('handoff migration preserves populated conversation state and adds no implicit cases',{timeout:40000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:33}),{applied:33});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await auditSetup(t,undefined,db);await db.prepareConversations();
 const admin=await s.grant('franchise_admin',[A]),binding={key:'upgrade50',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:upgrade50/v1'};
 await createWhatsappService(s.pool,{configuration:{graph_version:'v24.0',bindings:[binding]},provider:{validate:async()=>{},template:async()=>{throw new Error('unused');},send:async()=>({kind:'unavailable',reason:'unused'})}}).execute(admin.token,null,'connect',{organization_id:org,franchise_id:A},randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
 await db.adminQuery(`INSERT INTO shipit.customer_conversations(id,organization_id,franchise_id,installation_id,contact_key,selected_docket,pending_intent,state,expires_at)
 SELECT $1,organization_id,franchise_id,id,$2,'OLD50','tracking','human_requested',clock_timestamp()+interval '15 minutes' FROM shipit.whatsapp_installations`,[randomUUID(),'a'.repeat(64)]);
 const snapshot=async()=>(await db.adminQuery('SELECT * FROM shipit.customer_conversations')).rows;
 const before=await snapshot();db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:13});assert.deepEqual(await db.migrate(),{applied:0});
 assert.deepEqual(await snapshot(),before.map(row=>({...row,locale:'en',locale_explicit:false})));assert.equal((await db.adminQuery('SELECT count(*)::integer n FROM shipit.support_cases')).rows[0]!.n,0);
});
await test('concurrent claims have one winner; command replay, private notes, assignment and reopen keep history',{timeout:60000},async t=>{
 const s=await setup(t),operator=await s.grant('operator',[A]);await s.turn('HUMAN');const c=(await s.list()).items[0]!;
 const results=await Promise.allSettled([s.cmd(c.id,{action:'claim',expected_version:1}),s.cmd(c.id,{action:'claim',expected_version:1},operator.token)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 let d=await s.detail(c.id);const token=d.assigned_staff_id===s.admin.id?s.admin.token:operator.token,key=randomUUID();
 const note={action:'note',expected_version:2,text:'Private note: verify the recorded delay.'};
 const saved=await s.cmd(c.id,note,token,key);assert.deepEqual(await s.cmd(c.id,note,token,key),saved);
 await assert.rejects(s.cmd(c.id,{...note,text:'changed'},token,key),{code:'IDEMPOTENCY_CONFLICT'});
 d=await s.detail(c.id);assert.equal(d.history[0]!.text,note.text);assert.equal(d.history[0]!.message_state,null);
 const encrypted=(await s.db.adminQuery<{sealed_payload:string}>('SELECT sealed_payload FROM shipit.support_events WHERE event_type=$1',['noted'])).rows[0]!;
 assert.ok(!encrypted.sealed_payload.includes('Private note'));await s.drain();assert.ok(s.sends.every(text=>!text.includes('Private note')));
 await s.cmd(c.id,{action:'assign',expected_version:3,assigned_staff_id:s.admin.id},operator.token);
 await s.cmd(c.id,{action:'resolve',expected_version:4,reason:'answered'});
 await s.cmd(c.id,{action:'reopen',expected_version:5,reason:'incorrect_resolution'});
 assert.equal((await s.detail(c.id)).state,'open');assert.equal((await s.turn('ETA')).result,'paused');
 assert.ok(!s.logs.join('').includes(note.text));
});
await test('case-bound staff responses obey consent/window and suppress competing bot answers',{timeout:60000},async t=>{
 const s=await setup(t);await s.turn('tracking');await s.turn('HELP');const c=(await s.list()).items[0]!;
 await s.cmd(c.id,{action:'claim',expected_version:1});await s.drain();assert.equal(s.sends.length,0);
 await s.cmd(c.id,{action:'respond',expected_version:2,text:'A staff member is reviewing your question.'});
 await assert.rejects(s.cmd(c.id,{action:'resolve',expected_version:3,reason:'answered'}),{code:'VERSION_CONFLICT'});
 await s.drain();assert.deepEqual(s.sends,['A staff member is reviewing your question.']);
 await s.db.adminQuery(`UPDATE shipit.whatsapp_consent_state SET last_inbound_at=clock_timestamp()-interval '25 hours'`);
 await s.cmd(c.id,{action:'respond',expected_version:3,text:'Please message us again when convenient.'});
 let detail=await s.detail(c.id);assert.equal(detail.history[0]!.message_reason,'customer_window_closed');assert.equal(detail.history[0]!.message_state,'failed');
 await s.turn('Hello again');await s.cmd(c.id,{action:'respond',expected_version:4,text:'We can help with your question.'});await s.turn('STOP');await s.drain();
 detail=await s.detail(c.id);assert.equal(detail.history.find(e=>e.action==='responded')!.message_state,'suppressed');assert.equal(s.sends.length,1);
});
await test('scope and nested assignment deny foreign IDs, read-only and unauthenticated callers; HTTP enforces CSRF',{timeout:60000},async t=>{
 const s=await setup(t);await s.turn('HELP');const c=(await s.list()).items[0]!;
 const sibling=await s.grant('operator',[B]),readonly=await s.grant('read_only',[A]);
 const foreignRoot=await s.user();await s.memberships.bootstrapAdministrator(foreignRoot.id,otherOrg);
 for(const [token,query] of [[sibling.token,{organization_id:org,franchise_id:B}],[foreignRoot.token,{organization_id:otherOrg,franchise_id:C}]] as const){
  assert.deepEqual((await s.service.list(token,query,randomUUID())).items,[]);
  await assert.rejects(s.service.detail(token,c.id,query,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(s.service.command(token,c.id,query,randomUUID(),{action:'claim',expected_version:1},randomUUID()));
 }
 await assert.rejects(s.service.detail(readonly.token,c.id,s.query,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(s.cmd(c.id,{action:'assign',expected_version:1,assigned_staff_id:sibling.id}),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(s.cmd(c.id,{action:'claim',expected_version:1},readonly.token),{code:'ACTION_FORBIDDEN'});
 const url='/api/v1/support/'+c.id+'/commands?'+new URLSearchParams(s.query),payload={action:'claim',expected_version:1};
 assert.equal((await s.app.inject({url:'/api/v1/support/'+c.id+'?'+new URLSearchParams(s.query)})).statusCode,401);
 assert.equal((await s.app.inject({method:'POST',url,cookies:{shipit_session:s.admin.token},payload})).statusCode,403);
 const boot=await s.app.inject('/auth/bootstrap'),cookie=boot.cookies[0]!,headers={origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token,'idempotency-key':randomUUID()},cookies={shipit_session:s.admin.token,[cookie.name]:cookie.value};
 assert.equal((await s.app.inject({method:'POST',url,headers,cookies,payload:{...payload,organization_id:otherOrg}})).statusCode,422);
 assert.equal((await s.app.inject({method:'POST',url,headers,cookies,payload})).statusCode,200);
 assert.equal((await s.detail(c.id)).version,2);
});
await test('reply reservation failure rolls back case, event and command receipt',{timeout:60000},async t=>{
 const s=await setup(t);await s.turn('HELP');const c=(await s.list()).items[0]!;await s.cmd(c.id,{action:'claim',expected_version:1});
 const owner=s.db.ownerPool();t.after(()=>owner.close());const role=(await s.pool.query<{current_user:string}>('SELECT current_user')).rows[0]!.current_user;
 assert.match(role,/^[a-z0-9_]+$/);await owner.query(`REVOKE INSERT ON shipit.whatsapp_outbound FROM "${role}"`);
 await assert.rejects(s.cmd(c.id,{action:'respond',expected_version:2,text:'Please describe your question.'}));
 assert.equal((await s.detail(c.id)).version,2);assert.equal((await s.detail(c.id)).history.length,2);
 const m=(await s.db.adminQuery<{id:string;key_version:string;sealed_payload:string}>('SELECT id,key_version,sealed_payload FROM shipit.whatsapp_outbound')).rows[0]!;
 assert.ok(!openOutbound(webhookConfig,m.id,m.key_version,m.sealed_payload).text!.includes('describe'));
});
