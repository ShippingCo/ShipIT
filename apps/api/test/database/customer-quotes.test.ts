import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { withTransaction } from '@shippingco/db';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import { quoteTurn } from '../../src/modules/customer-quotes/service.ts';
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
import { provisionDatabase } from '../../../../packages/db/test/support.ts';

async function setup(t:Parameters<typeof auditSetup>[0]) {
 const s=await auditSetup(t);await s.db.prepareCustomerQuotes();
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
  outbound_enabled:true,customer_access_enabled:true,conversation_enabled:true,customer_quotes_enabled:true},provider:{validate:async()=>{},template:async()=>{throw new Error('unused');},
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

await test('signed quote dialogue persists across restart, reuses rate calculation and never books or mutates rates',{timeout:40000},async t=>{
 const s=await setup(t),snapshot=JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.pricing_versions')).rows);
 await s.turn('QUOTE');await s.turn('ORIGIN');await s.turn('DEST');const weight=await s.turn('1999');assert.match(weight.text,/Dimensions are required/);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.customer_quotes')).rows[0]!.n,0);
 const invalid=await s.turn('unknown');assert.match(invalid.text,/invalid/);
 const pool=s.db.runtimePool();t.after(()=>pool.close());const restarted=createConversationWorker(pool,s.whatsapp,s.keys.browser);
 const dimension=await s.message('100 x 200 x 300');assert.equal(await restarted.tick(),'selection_required');assert.match(await s.reply(dimension),/service/);
 const id=await s.message('standard',s.phone,'wamid.quote48');
 const race=await Promise.all([restarted.tick(),s.worker.tick()]);assert.deepEqual(race.sort(),['answered',null]);
 const result=await s.estimate(id);assert.equal(result.total_paise,'10250');assert.equal(result.rate_version_id,s.rate.id);assert.equal(result.non_binding,true);
 assert.match(await s.reply(id),/non-binding estimate INR 102.50/);assert.match(await s.reply(id),/Excludes tax.*pickup.*insurance.*special handling/);
 assert.match(await s.reply(id),/Booking is not confirmed/);assert.ok(result.rule_id);
 await s.message('standard',s.phone,'wamid.quote48');assert.equal(await restarted.tick(),null);
 const repeated=await s.quote();assert.equal((await s.estimate(repeated.id)).total_paise,result.total_paise);
 while(await s.outbound.tick()!==null){/* actual synthetic dispatch */}assert.ok(s.sends.some(v=>v.includes('INR 102.50')));
 assert.equal(JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.pricing_versions')).rows),snapshot);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.bookings')).rows[0]!.n,0);
 assert.ok(!JSON.stringify(s.logs).includes(s.phone));
 const audit=JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.customer_conversation_turns')).rows);assert.ok(!audit.includes('dimensions_mm'));assert.ok(!audit.includes(s.phone));
 const owner=s.db.ownerPool();try{await assert.rejects(owner.query('UPDATE shipit.customer_quotes SET reason=reason'));await assert.rejects(s.pool.query('DELETE FROM shipit.customer_quotes'));}finally{await owner.close();}
});

await test('inclusive thresholds, unsupported inputs and dimensional policies yield durable staff referral without invented amount',{timeout:60000},async t=>{
 const s=await setup(t);
 for(const [weight,dimension,destination,service,reason] of [['2000','1 x 1 x 1','DEST','standard','heavy'],['2001','1 x 1 x 1','DEST','standard','heavy'],
  ['100','1000 x 1 x 1','DEST','standard','large'],['100','1001 x 1 x 1','DEST','standard','large'],['100','1 x 1 x 1','UNKNOWN','standard','unsupported_lane'],
  ['100','1 x 1 x 1','DEST','express','unsupported_lane']] as const) {
  const q=await s.quote(weight,dimension,destination,service),row=await s.estimate(q.id);assert.equal(row.reason,reason);assert.equal(row.total_paise,null);assert.match(q.text,/staff review/);
 }
 await s.policies.configure(s.admin.token,org,A,randomUUID(),{...s.body,expected_version:1,lanes:[{...s.body.lanes[0],weight_only:false}]},randomUUID());
 const dimensional=await s.quote('100');assert.equal((await s.estimate(dimensional.id)).reason,'dimensional_review');
 await s.turn('QUOTE');await s.turn('ORIGIN');await s.turn('DEST');assert.match((await s.turn('-1')).text,/invalid/);
});

await test('quote references deny another contact, sibling franchise and unrelated organization uniformly',{timeout:60000},async t=>{
 const s=await setup(t),q=await s.quote(),ref=(await s.estimate(q.id)).id as string;
 const other=await s.turn('QUOTE '+ref,'12025550149'),unknown=await s.turn('QUOTE '+randomUUID(),'12025550149');assert.equal(other.text,unknown.text);
 for(const [organization,franchise,waba,phone] of [[org,B,'200001','200002'],[otherOrg,C,'300001','300002']] as const) {
  const root=organization===org?s.root:await s.user();if(organization!==org)await s.memberships.bootstrapAdministrator(root.id,organization);
  const owner=await s.user(),invite=await s.memberships.createInvitation(root.token,{organization_id:organization,invitee_user_id:owner.id,role:'franchise_admin',franchise_ids:[franchise]});
  await s.memberships.acceptInvitation(owner.token,{token:invite.acceptance_token});
  const pricing=createPricingService(s.pool),foreignRate=await pricing.create(owner.token,organization,franchise,randomUUID(),{
   effective_from:'2099-01-01T00:00:00Z',effective_to:'2099-01-02T00:00:00Z',quote_validity_seconds:600,override_tolerance_paise:0,
   approval_ref:'foreign48',source_ref:'foreign48',rules:[{destination_key:'DEST',service:'standard',min_weight_grams:1,max_weight_grams:null,freight_paise:999999,packing_paise:0}]},randomUUID());
  await pricing.publish(owner.token,organization,franchise,foreignRate.id,randomUUID(),{expected_version:1},randomUUID());
  await assert.rejects(s.policies.configure(s.admin.token,org,A,randomUUID(),{...s.body,expected_version:1,rate_version_id:foreignRate.id},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  const binding={key:'foreign_'+franchise.slice(0,8),organization_id:organization,franchise_id:franchise,waba_id:waba,phone_number_id:phone,credential_ref:'whatsapp:foreign48/v1'};
  await createWhatsappService(s.pool,{...s.whatsapp,configuration:{...s.whatsapp.configuration,bindings:[binding]}}).execute(owner.token,null,'connect',{organization_id:organization,franchise_id:franchise},randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
  const id=await s.message('QUOTE '+ref,s.phone,undefined,{waba,phone});assert.equal(await s.worker.tick(),'not_found');assert.equal(await s.reply(id),other.text);
 }
});

await test('policy API reauthorizes replay, rejects foreign rate IDs and serializes concurrent admin changes',{timeout:40000},async t=>{
 const s=await setup(t),reader=await s.grant('read_only',[A]),key=randomUUID(),body={...s.body,expected_version:1,heavy_weight_grams:3000};
 await assert.rejects(s.policies.configure(reader.token,org,A,key,body,randomUUID()));
 await assert.rejects(s.policies.configure(s.admin.token,org,B,key,body,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const keys=[key,randomUUID()];
 const results=await Promise.allSettled(keys.map(k=>s.policies.configure(s.admin.token,org,A,k,body,randomUUID())));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const winner=results.findIndex(r=>r.status==='fulfilled'),result=results[winner]!;assert.equal(result.status,'fulfilled');
 assert.deepEqual(await s.policies.configure(s.admin.token,org,A,keys[winner],body,randomUUID()),result.value);
 await assert.rejects(s.policies.configure(s.admin.token,org,A,randomUUID(),{...body,expected_version:2,rate_version_id:randomUUID()},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const boot=await s.app.inject('/auth/bootstrap'),cookie=boot.cookies[0]!;
 const response=await s.app.inject({method:'POST',url:'/api/v1/customer-quotes/policy?organization_id='+org+'&franchise_id='+A,
  cookies:{shipit_session:s.admin.token,[cookie.name]:cookie.value},headers:{origin:'http://localhost:5173','x-csrf-token':boot.json().csrf_token,'idempotency-key':randomUUID()},payload:{...body,expected_version:2}});
 assert.equal(response.statusCode,200,response.body);
 const csrf=await s.app.inject({method:'POST',url:'/api/v1/customer-quotes/policy?organization_id='+org+'&franchise_id='+A,cookies:{shipit_session:s.admin.token},payload:body});assert.equal(csrf.statusCode,403);
 await s.memberships.revokeMembership(s.root.token,s.admin.member.id,{expected_version:s.admin.member.version});
 await assert.rejects(s.policies.configure(s.admin.token,org,A,keys[winner],body,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});

await test('STOP/human and policy changes suppress quote work/replies; dependency failure rolls back',{timeout:60000},async t=>{
 const s=await setup(t);await s.turn('QUOTE');await s.turn('human');assert.match((await s.turn('ORIGIN')).text,/contact the franchise/);await s.turn('RESUME');
 const q=await s.quote();await s.policies.configure(s.admin.token,org,A,randomUUID(),{...s.body,expected_version:1,enabled:false},randomUUID());
 while(await s.outbound.tick()!==null){/* stale policy price must be suppressed */}assert.ok(s.sends.every(v=>!v.includes('INR 102.50')));
 assert.ok((await s.estimate(q.id)).id);
 await s.turn('QUOTE');await s.turn('ORIGIN');await s.turn('DEST');await s.turn('100');await s.turn('1 x 1 x 1');
 const owner=s.db.ownerPool();try{await owner.query('REVOKE SELECT ON shipit.customer_quote_policies FROM '+s.db.runtimeRole);}finally{await owner.close();}
 const id=await s.message('standard');assert.equal(await s.worker.tick(),'unavailable');assert.match(await s.reply(id),/retry once/);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.customer_quotes WHERE inbox_id=$1',[id])).rows[0]!.n,0);
 await s.message('STOP');assert.equal(await s.worker.tick(),'consent');await s.message('QUOTE');assert.equal(await s.worker.tick(),'consent');
});

await test('expired estimate refreshes against a newly published rate before any confirmation; old evidence stays immutable',{timeout:40000},async t=>{
 const s=await setup(t),q=await s.quote(),old=await s.estimate(q.id),future=new Date(s.rate.effective_to);
 const pricing=createPricingService(s.pool),next=await pricing.create(s.admin.token,org,A,randomUUID(),{
  effective_from:future.toISOString(),effective_to:new Date(future.getTime()+3600000).toISOString(),quote_validity_seconds:600,override_tolerance_paise:0,
  approval_ref:'synthetic48_next',source_ref:'synthetic48_next',rules:[{destination_key:'DEST',service:'standard',min_weight_grams:1,max_weight_grams:null,freight_paise:20000,packing_paise:0}]},randomUUID());
 await pricing.publish(s.admin.token,org,A,next.id,randomUUID(),{expected_version:1},randomUUID());
 await s.policies.configure(s.admin.token,org,A,randomUUID(),{...s.body,rate_version_id:next.id,expected_version:1},randomUUID());
 const text='CONFIRM QUOTE '+old.id,inbox=await s.message(text),c=(await s.db.adminQuery<{id:string;installation_id:string;contact_key:string}>('SELECT id,installation_id,contact_key FROM shipit.customer_conversations')).rows[0]!;
 // Fake evaluation clock crosses both expiry and the new published interval; no wall-clock sleep or evidence edits.
 const result=await withTransaction(s.pool,tx=>quoteTurn(issueTenantAccess(tx,{action:'whatsapp.inbox.work',actor:{type:'service',id:'whatsapp-inbox-worker'},
  organizationId:org,permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),
  {inbox,installation:c.installation_id,contact:c.contact_key,conversation:c.id,now:new Date(future.getTime()+1000)},text,null));
 assert.equal(result.outcome,'answered');assert.match(result.reply,/refreshed result/);assert.match(result.reply,/INR 200.00/);assert.match(result.reply,/Booking is not confirmed/);
 const refreshed=await s.estimate(inbox);assert.equal(refreshed.refreshed_from,old.id);assert.equal(refreshed.rate_version_id,next.id);assert.equal(refreshed.total_paise,'20000');
 assert.deepEqual(await s.estimate(q.id),old);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.bookings')).rows[0]!.n,0);
});

await test('additive quote migration preserves earlier conversation state and creates no public pricing policy',{timeout:40000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:31}),{applied:31});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await auditSetup(t,undefined,db);await db.prepareConversations();
 const admin=await s.grant('franchise_admin',[A]),binding={key:'upgrade48',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:upgrade48/v1'};
 await createWhatsappService(s.pool,{configuration:{graph_version:'v24.0',bindings:[binding]},provider:{validate:async()=>{},template:async()=>{throw new Error('unused');},send:async()=>({kind:'unavailable',reason:'unused'})}}).execute(
  admin.token,null,'connect',{organization_id:org,franchise_id:A},randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
 await db.adminQuery(`INSERT INTO shipit.customer_conversations(id,organization_id,franchise_id,installation_id,contact_key,selected_docket,pending_intent,state,expires_at)
  SELECT $1,organization_id,franchise_id,id,$2,'OLD48','tracking','human_requested',clock_timestamp()+interval '15 minutes' FROM shipit.whatsapp_installations`,[randomUUID(),'a'.repeat(64)]);
 const snapshot=async()=>(await db.adminQuery('SELECT id,selected_docket,pending_intent,state,version,expires_at FROM shipit.customer_conversations')).rows;
 const before=await snapshot();assert.equal(before.length,1);db.migrate=migrate;
 assert.deepEqual(await db.migrate(),{applied:12});assert.deepEqual(await db.migrate(),{applied:0});
 assert.deepEqual(await snapshot(),before);assert.equal((await db.adminQuery('SELECT quote_draft FROM shipit.customer_conversations')).rows[0]!.quote_draft,null);
 assert.equal((await db.adminQuery('SELECT count(*)::integer n FROM shipit.customer_quote_policies')).rows[0]!.n,0);
});

await test('feature is opt-in and the persistent hourly quote budget survives another worker',{timeout:60000},async t=>{
 const s=await setup(t),disabled=createConversationWorker(s.pool,{...s.whatsapp,configuration:{...s.whatsapp.configuration,customer_quotes_enabled:false}},s.keys.browser);
 const id=await s.message('QUOTE');assert.equal(await disabled.tick(),'unavailable');
 assert.doesNotMatch(await s.reply(id),/Send QUOTE/);
 assert.equal((await s.db.adminQuery('SELECT quote_draft FROM shipit.customer_conversations')).rows[0]!.quote_draft,null);
 // The disabled request is already a quote intent receipt, so 59 enabled turns reach 60.
 for(let i=0;i<59;i++)assert.match((await s.turn('QUOTE')).text,/non-binding/);
 const next=await s.message('QUOTE'),worker=createConversationWorker(s.pool,s.whatsapp,s.keys.browser);
 assert.equal(await worker.tick(),'unavailable');assert.match(await s.reply(next),/hourly limit/);
 assert.equal((await s.db.adminQuery('SELECT count(*)::integer n FROM shipit.customer_quotes')).rows[0]!.n,0);
});
