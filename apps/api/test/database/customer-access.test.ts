import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { callback,inbound,signed,webhookConfig } from '../webhook-fixture.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { createInboxWorker } from '../../src/modules/whatsapp/inbox-worker.ts';
import { createCustomerAccessService } from '../../src/modules/customer-access/service.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import { draft,input } from '../pricing-support.ts';
import { taxPolicy,taxFacts } from '../tax-support.ts';
import { contact } from '../customer-support.ts';
import { automationSetup,routeDelayFixture } from '../automation-support.ts';
import { normalizeBusinessWebhook } from '../../src/modules/whatsapp/webhook-payload.ts';
import { persistBusinessWebhook } from '../../src/modules/security/jobs.ts';
import { createRouteEventService } from '../../src/modules/routes/event-service.ts';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';
import { createDeliveryService } from '../../src/modules/deliveries/service.ts';
import { deliveryProofConfiguration } from '../delivery-support.ts';

await test('forward migration preserves populated shipments and never backfills phone-based access',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:29}),{applied:29});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db);
  const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
  const snapshot=async()=>Object.fromEntries(await Promise.all(['customers','bookings','parcels'].map(async table=>
    [table,(await db.adminQuery(`SELECT * FROM shipit.${table} ORDER BY id`)).rows])));
  const before=await snapshot();db.migrate=migrate;
  assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
  for(const table of ['customer_access_bindings','customer_access_commands','customer_tracking_grants']) {
    assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);
    await assert.rejects(s.pool.query(`SELECT * FROM shipit.${table}`));
  }
  const publicExecute=await db.adminQuery(`SELECT EXISTS(SELECT 1 FROM pg_proc p,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE p.oid='shipit.customer_tracking_scope(text)'::regprocedure AND a.grantee=0 AND a.privilege_type='EXECUTE') AS allowed`);
  assert.equal(publicExecute.rows[0]!.allowed,false);
  await db.prepareCustomerAccess();
  for(const table of ['customer_access_commands','customer_tracking_grants']) {
    await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`));
    await assert.rejects(s.pool.query(`ALTER TABLE shipit.${table} DISABLE TRIGGER ALL`));
  }
});

async function setup(t:Parameters<typeof bookingSetup>[0],count=1) {
  const s=await bookingSetup(t);await s.db.prepareCustomerAccess();
  const admin=await s.grant('franchise_admin',[A]);
  const binding={key:'access_v1',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:access/v1'};
  const whatsapp={configuration:{customer_access_enabled:true,graph_version:'v24.0',bindings:[binding],webhook:webhookConfig},provider:{validate:async()=>{},
    template:async()=>{throw new Error('unused');},send:async()=>({kind:'unavailable' as const,reason:'synthetic'})}};
  const installed=await createWhatsappService(s.pool,whatsapp).execute(admin.token,null,'connect',{organization_id:org,franchise_id:A},randomUUID(),{binding_key:'access_v1',expected_version:0},randomUUID());
  const logs:string[]=[],app=buildServer({database:s.pool,config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',
    ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'}),auth:{keys:s.keys,delivery:{},webhook:undefined},whatsapp,logSink:{write:v=>logs.push(v)}});
  t.after(()=>app.close());
  const service=createCustomerAccessService(s.pool,webhookConfig,s.keys.browser),booked=await s.book({...s.body,parcels:Array.from({length:count},(_,i)=>
    ({...s.body.parcels[0],weight_grams:i===count-1?999-Math.floor(999/count)*(count-1):Math.floor(999/count)}))});assert.equal(booked.statusCode,201,booked.body);
  const parcel=booked.json().parcels[0] as {id:string;docket:string};
  async function message(phone:string,ageSeconds=0) {
    const id='wamid.'+randomUUID(),body=JSON.stringify(callback([{...inbound(id,'Where is my parcel?'),from:phone.replace('+',''),timestamp:String(Math.floor(Date.now()/1000)-ageSeconds)}],{kind:'messages'}));
    const response=await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:signed(body),payload:body});
    assert.equal(response.statusCode,200,response.body);
    await createInboxWorker(s.pool).tick();
    return (await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.whatsapp_inbox WHERE message_id=$1',[id])).rows[0]!.id;
  }
  const select=(inbox:string,docket:string|null=null)=>withTransaction(s.pool,tx=>service.select(issueTenantAccess(tx,{action:'whatsapp.inbox.work',actor:{type:'service',id:'whatsapp-inbox-worker'},
    organizationId:org,permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),inbox,docket));
  const bind=(inbox:string,relation:'sender'|'recipient'='sender',expected=0,key=randomUUID(),token=admin.token,query={organization_id:org,franchise_id:A},recipient_rebind=false)=>
    service.bind(token,parcel.id,query,key,{inbox_id:inbox,relation,expected_version:expected,evidence_ref:randomUUID(),...(recipient_rebind?{recipient_rebind:true}:{})},randomUUID());
  const phone=(await s.db.adminQuery<{phone_normalized:string}>('SELECT phone_normalized FROM shipit.customers WHERE id=$1',[s.source.id])).rows[0]!.phone_normalized;
  return {...s,root:s.admin,app,logs,whatsapp,service,parcel,parcels:booked.json().parcels as {id:string;docket:string}[],admin,message,select,bind,phone,installation:String(installed.id)};
}

await test('signed sender needs independent parcel binding; projection, uniform denial and restart persist',{timeout:30000},async t=>{
  const s=await setup(t),inbox=await s.message(s.phone);
  assert.deepEqual((await s.select(inbox)).items,[]);
  await assert.rejects(s.service.track(s.parcel.docket),{code:'RESOURCE_NOT_FOUND'});
  const key=randomUUID(),body={inbox_id:inbox,relation:'sender',expected_version:0,evidence_ref:randomUUID()},q={organization_id:org,franchise_id:A};
  const bound=await s.service.bind(s.admin.token,s.parcel.id,q,key,body,randomUUID());
  assert.deepEqual(await s.service.bind(s.admin.token,s.parcel.id,q,key,body,randomUUID()),bound);
  await assert.rejects(s.service.bind(s.admin.token,s.parcel.id,q,key,{...body,evidence_ref:randomUUID()},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
  const selection=await s.select(inbox),grant=selection.items[0]!.grant;
  assert.deepEqual(await s.select(inbox),selection);
  const rotated=createCustomerAccessService(s.pool,webhookConfig,Buffer.alloc(32,9));
  await withTransaction(s.pool,async tx=>{
    const scope=issueTenantAccess(tx,{action:'whatsapp.inbox.work',actor:{type:'service',id:'whatsapp-inbox-worker'},organizationId:org,
      permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'});
    await assert.rejects(rotated.select(scope,inbox),{code:'TEMPORARILY_UNAVAILABLE'});
  });
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.customer_tracking_grants')).rows[0]!.n,1);
  const persisted=JSON.stringify((await s.db.adminQuery(`SELECT to_jsonb(b) binding,to_jsonb(c) command,to_jsonb(g) access_grant
    FROM shipit.customer_access_bindings b JOIN shipit.customer_access_commands c ON c.binding_id=b.id
    JOIN shipit.customer_tracking_grants g ON g.binding_id=b.id`)).rows);
  for(const prohibited of [grant,s.phone,'Synthetic Recipient','21 Fictional Street','Where is my parcel?'])assert.equal(persisted.includes(prohibited),false);
  const owner=s.db.ownerPool();
  try {
    await assert.rejects(owner.query('UPDATE shipit.customer_tracking_grants SET token_digest=token_digest'));
    await assert.rejects(owner.query('DELETE FROM shipit.customer_access_commands'));
  } finally {await owner.close();}
  const result=await s.service.track(grant);assert.equal(result.docket,s.parcel.docket);assert.deepEqual(result.eta,{state:'unavailable',at:null});
  for(const forbidden of ['phone','address','recipient','sender','evidence','otp','actor','customer_id'])assert.equal(JSON.stringify(result).includes(forbidden),false);
  const denied=async(docket:string)=>(await s.app.inject({url:'/api/v1/customer-tracking?docket='+docket,headers:{authorization:'Bearer '+grant}}));
  const unknown=await denied('UNKNOWN46'),foreign=await denied('FOREIGN46');assert.equal(unknown.statusCode,404);assert.equal(foreign.statusCode,404);
  assert.equal(unknown.json().error.code,foreign.json().error.code);
  const response=await s.app.inject({url:'/api/v1/customer-tracking',headers:{authorization:'Bearer '+grant}});assert.equal(response.statusCode,200,response.body);
  assert.equal(response.headers['cache-control'],'no-store');assert.equal(JSON.stringify(s.logs).includes(grant),false);
  await s.app.listen({host:'127.0.0.1',port:0});const address=s.app.server.address();assert.ok(address&&typeof address==='object');
  const live=await fetch(`http://127.0.0.1:${address.port}/api/v1/customer-tracking`,{headers:{authorization:'Bearer '+grant}});
  assert.equal(live.status,200);assert.deepEqual(await live.json(),result);
  await s.pool.close();const restarted=createCustomerAccessService(s.db.runtimePool(),webhookConfig,s.keys.browser);
  assert.deepEqual(await restarted.track(grant),result);
});

await test('shared-phone selection is bounded, deduplicated and exact docket selection never crosses the binding',{timeout:30000},async t=>{
  const s=await setup(t,12),inbox=await s.message(s.phone),q={organization_id:org,franchise_id:A};
  for(const parcel of s.parcels)await s.service.bind(s.admin.token,parcel.id,q,randomUUID(),
    {inbox_id:inbox,relation:'sender',evidence_ref:randomUUID(),expected_version:0},randomUUID());
  const selection=await s.select(inbox);assert.equal(selection.items.length,10);assert.equal(selection.selection_required,true);assert.equal(selection.has_more,true);
  assert.equal(new Set(selection.items.map(i=>i.docket)).size,10);
  const chosen=s.parcels[11]!,exact=await s.select(inbox,chosen.docket);assert.equal(exact.items.length,1);assert.equal(exact.selection_required,false);
  assert.equal((await s.service.track(exact.items[0]!.grant)).docket,chosen.docket);
  assert.deepEqual(await s.select(inbox,'UNKNOWN46'),{items:[],selection_required:false,has_more:false});
  // A new sender with the same franchise and typed known docket has no binding.
  const unbound=await s.message('+12025550177');assert.deepEqual(await s.select(unbound,chosen.docket),{items:[],selection_required:false,has_more:false});
});

await test('valid sibling and unrelated parcels and inbox references cannot be discovered through an A grant',{timeout:60000},async t=>{
  const s=await setup(t),inbox=await s.message(s.phone);await s.bind(inbox);const grant=(await s.select(inbox)).items[0]!.grant;
  const foreignRoot=await s.user();await s.memberships.bootstrapAdministrator(foreignRoot.id,otherOrg);const foreign=await s.user();
  const foreignAdminInvite=await s.memberships.createInvitation(foreignRoot.token,{organization_id:otherOrg,invitee_user_id:foreign.id,role:'franchise_admin',franchise_ids:[C]});
  await s.memberships.acceptInvitation(foreign.token,{token:foreignAdminInvite.acceptance_token});
  const admins=[await s.grant('franchise_admin',[B]),foreign];
  for(const [i,owner] of admins.entries()) {
    const invitation=await s.memberships.createInvitation(i===0?s.root.token:foreignRoot.token,
      {organization_id:i===0?org:otherOrg,invitee_user_id:owner.id,role:'operator',franchise_ids:[i===0?B:C]});
    await s.memberships.acceptInvitation(owner.token,{token:invitation.acceptance_token});
  }
  for(const [i,owner] of admins.entries()) {
    const organization=i===0?org:otherOrg,franchise=i===0?B:C;
    const customer=await s.customer.create(owner.token,organization,franchise,randomUUID(),contact,randomUUID());
    const rate=await s.pricing.create(owner.token,organization,franchise,randomUUID(),draft,randomUUID());
    await s.pricing.publish(owner.token,organization,franchise,rate.id,randomUUID(),{expected_version:1},randomUUID());
    const policy=await s.tax.create(owner.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());
    await s.tax.publish(owner.token,organization,franchise,policy.id,randomUUID(),{expected_version:1},randomUUID());
    const operator=owner;
    const quote=await s.pricing.quote(operator.token,organization,franchise,randomUUID(),input,randomUUID());
    const tax_intent={quote_id:quote.id,pricing_input:input,facts:taxFacts};
    const intent=await s.tax.prepare(operator.token,organization,franchise,randomUUID(),tax_intent,randomUUID());
    const calculation=await s.tax.calculate(operator.token,organization,franchise,randomUUID(),{intent_id:intent.id},randomUUID());
    const booked=await s.booking.create(operator.token,organization,franchise,randomUUID(),{customer_id:customer.id,expected_customer_version:1,
      tax_calculation_id:calculation.id,tax_intent,parcels:s.body.parcels},randomUUID());
    const parcel=booked.parcels[0]!;
    const channel={key:`access_foreign_${i}`,organization_id:organization,franchise_id:franchise,waba_id:i===0?'200001':'300001',
      phone_number_id:i===0?'200002':'300002',credential_ref:`whatsapp:foreign${i}/v1`};
    await createWhatsappService(s.pool,{...s.whatsapp,configuration:{...s.whatsapp.configuration,bindings:[channel]}}).execute(owner.token,null,'connect',
      {organization_id:organization,franchise_id:franchise},randomUUID(),{binding_key:channel.key,expected_version:0},randomUUID());
    const messageId='wamid.'+randomUUID(),body=JSON.stringify(callback([{...inbound(messageId,'Track'),from:s.phone.replace('+',''),
      timestamp:String(Math.floor(Date.now()/1000))}],{waba:channel.waba_id,phone:channel.phone_number_id,kind:'messages'}));
    const callbackResult=await s.app.inject({method:'POST',url:'/webhooks/whatsapp',headers:signed(body),payload:body});assert.equal(callbackResult.statusCode,200);
    await createInboxWorker(s.pool).tick();
    const foreignInbox=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.whatsapp_inbox WHERE message_id=$1',[messageId])).rows[0]!.id;
    // The trusted worker transaction wraps its internal not-found rejection;
    // public bind/tracking boundaries below preserve the controlled HTTP code.
    await assert.rejects(s.select(foreignInbox),{code:'DB_TRANSACTION_FAILED'});
    await assert.rejects(s.bind(foreignInbox,'sender',1),{code:'RESOURCE_NOT_FOUND'});
    await s.service.bind(owner.token,parcel.id,{organization_id:organization,franchise_id:franchise},randomUUID(),
      {inbox_id:foreignInbox,relation:'sender',expected_version:0,evidence_ref:randomUUID()},randomUUID());
    const ownSelection=await withTransaction(s.pool,tx=>s.service.select(issueTenantAccess(tx,{action:'whatsapp.inbox.work',actor:{type:'service',id:'whatsapp-inbox-worker'},
      organizationId:organization,permittedFranchiseIds:[franchise],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),foreignInbox));
    assert.equal(ownSelection.items.length,1);assert.equal((await s.service.track(ownSelection.items[0]!.grant)).docket,parcel.docket);
    await assert.rejects(s.service.track(grant,parcel.docket),{code:'RESOURCE_NOT_FOUND'});
    const foreignResponse=await s.app.inject({url:'/api/v1/customer-tracking?docket='+parcel.docket,headers:{authorization:'Bearer '+grant}});
    const absentResponse=await s.app.inject({url:'/api/v1/customer-tracking?docket=UNKNOWN46',headers:{authorization:'Bearer '+grant}});
    assert.equal(foreignResponse.statusCode,404);assert.equal(absentResponse.statusCode,404);
    assert.equal(foreignResponse.json().error.code,absentResponse.json().error.code);
    assert.equal(foreignResponse.json().error.message,absentResponse.json().error.message);
    await assert.rejects(s.service.bind(s.admin.token,parcel.id,{organization_id:org,franchise_id:A},randomUUID(),
      {inbox_id:inbox,relation:'sender',expected_version:0,evidence_ref:randomUUID()},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
    // Same canonical number exists in B/C but is never searched outside A.
    assert.equal((await s.select(inbox)).items.length,1);
  }
  assert.equal((await s.service.track(grant)).docket,s.parcel.docket);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.customer_access_commands')).rows[0]!.n,3);
});

await test('tracking reads the committed route arrival ETA, delay and arrival without making a delivery promise',{timeout:30000},async t=>{
  const s=await automationSetup(t);await s.db.prepareCustomerAccess();const route=await routeDelayFixture(s,1);
  const service=createCustomerAccessService(s.pool,webhookConfig,s.keys.browser),messageId='wamid.'+randomUUID();
  const body=Buffer.from(JSON.stringify(callback([{...inbound(messageId,'Track my parcel'),from:s.source.phone.replace('+',''),timestamp:String(Math.floor(Date.now()/1000))}],{kind:'messages'})));
  await persistBusinessWebhook(s.pool,normalizeBusinessWebhook(body,webhookConfig),webhookConfig.waba_ids,randomUUID());await createInboxWorker(s.pool).tick();
  const inbox=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.whatsapp_inbox WHERE message_id=$1',[messageId])).rows[0]!.id;
  await service.bind(s.franchiseAdmin.token,route.parcelIds[0],{organization_id:org,franchise_id:A},randomUUID(),
    {inbox_id:inbox,relation:'sender',expected_version:0,evidence_ref:randomUUID()},randomUUID());
  const selection=await withTransaction(s.pool,tx=>service.select(issueTenantAccess(tx,{action:'whatsapp.inbox.work',actor:{type:'service',id:'whatsapp-inbox-worker'},
    organizationId:org,permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),inbox));
  const grant=selection.items[0]!.grant,result=await service.track(grant);
  assert.deepEqual(result.eta,{state:'available',at:'2099-01-01T14:00:00.000Z',kind:'route_arrival'});
  assert.ok(result.timeline.some(e=>e.event==='parcel.dispatched'));
  await s.db.prepareDeliveries();const agent=await s.grant('delivery_agent',[A]),deliveryKey=randomUUID();
  await createDeliveryService(s.pool,deliveryProofConfiguration,undefined,s.clock).start(route.dispatcher.token,route.parcelIds[0],
    {organization_id:org,franchise_id:A},deliveryKey,['idempotency-key',deliveryKey],
    {expected_version:result.version,agent_id:agent.id,handover_evidence_ref:randomUUID()},false,randomUUID());
  const lastMile=await service.track(grant);assert.equal(lastMile.status,'out_for_delivery');assert.deepEqual(lastMile.eta,{state:'unavailable',at:null});
  assert.ok(lastMile.timeline.some(e=>e.event==='delivery.attempt_started'));
  const key=randomUUID();await createRouteEventService(s.pool).execute(route.dispatcher.token,route.route.id,{organization_id:org,franchise_id:A},key,['idempotency-key',key],
    {kind:'arrival',expected_version:route.delay.version,manifest_id:route.route.current_manifest_id,manifest_version:route.route.version,
      effective_at:'2099-01-01T14:00:00Z',evidence_ref:randomUUID()},randomUUID());
  assert.deepEqual((await service.track(grant)).eta,{state:'unavailable',at:null});
});

await test('sender phone changes revoke access; recipient rebind invalidates every old grant and races have one winner',{timeout:30000},async t=>{
  const s=await setup(t),sender=await s.message(s.phone);await s.bind(sender);
  const oldSender=(await s.select(sender)).items[0]!.grant;
  await s.customer.update(s.operator.token,org,A,s.source.id,randomUUID(),{name:s.source.name,phone:'+12025550199',address:s.source.address,expected_version:s.source.version},randomUUID());
  await assert.rejects(s.service.track(oldSender),{code:'RESOURCE_NOT_FOUND'});
  const recipient=await s.message('+12025550101');await s.bind(recipient,'recipient');
  const old=(await s.select(recipient)).items[0]!.grant;assert.equal((await s.service.track(old)).docket,s.parcel.docket);
  const replacement=await s.message('+12025550102');
  const selecting=s.select(replacement).then(result=>result.items.length,error=>error.code as string);
  const reading=s.service.track(old).then(()=>'allowed',error=>error.code as string);
  const [races,readOutcome,selectionCount]=await Promise.all([Promise.allSettled([s.bind(replacement,'recipient',1,randomUUID(),s.admin.token,{organization_id:org,franchise_id:A},true),
    s.bind(replacement,'recipient',1,randomUUID(),s.admin.token,{organization_id:org,franchise_id:A},true)]),reading,selecting]);
  assert.ok(['allowed','RESOURCE_NOT_FOUND'].includes(readOutcome));
  assert.ok(selectionCount===0||selectionCount===1);
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(races.filter(r=>r.status==='rejected'&&r.reason.code==='VERSION_CONFLICT').length,1);
  await assert.rejects(s.service.track(old),{code:'RESOURCE_NOT_FOUND'});assert.deepEqual((await s.select(recipient)).items,[]);
  assert.equal((await s.service.track((await s.select(replacement)).items[0]!.grant)).docket,s.parcel.docket);
  const current=(await s.select(replacement)).items[0]!.grant,key=randomUUID(),body={relation:'recipient',expected_version:2,evidence_ref:randomUUID()},q={organization_id:org,franchise_id:A};
  const revoked=await s.service.revoke(s.admin.token,s.parcel.id,q,key,body,randomUUID());
  assert.deepEqual(await s.service.revoke(s.admin.token,s.parcel.id,q,key,body,randomUUID()),revoked);
  await assert.rejects(s.service.track(current),{code:'RESOURCE_NOT_FOUND'});assert.deepEqual((await s.select(replacement)).items,[]);
});

await test('expired/altered grants, sibling/unrelated scopes, read-only, stale evidence and unavailable database fail closed',{timeout:30000},async t=>{
  const s=await setup(t),inbox=await s.message(s.phone),readonly=await s.grant('read_only',[A]),sibling=await s.grant('franchise_admin',[B]);
  await assert.rejects(s.bind(inbox,'sender',0,randomUUID(),readonly.token),{code:'ACTION_FORBIDDEN'});
  await assert.rejects(s.bind(inbox,'sender',0,randomUUID(),sibling.token,{organization_id:org,franchise_id:B}),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(s.bind(inbox,'sender',0,randomUUID(),s.admin.token,{organization_id:otherOrg,franchise_id:C}),{code:'RESOURCE_NOT_FOUND'});
  await s.bind(inbox);const grant=(await s.select(inbox)).items[0]!.grant;
  await assert.rejects(s.service.track((grant[0]==='A'?'B':'A')+grant.slice(1)),{code:'RESOURCE_NOT_FOUND'});
  const stale=await s.message(s.phone,1200);await assert.rejects(s.bind(stale,'sender',1),{code:'RESOURCE_NOT_FOUND'});
  // Move only synthetic expiry facts, never wait or expose an actual secret in diagnostics.
  await s.db.adminQuery('ALTER TABLE shipit.customer_tracking_grants DISABLE TRIGGER customer_tracking_grants_immutable');
  await s.db.adminQuery("UPDATE shipit.customer_tracking_grants SET expires_at=clock_timestamp()-interval '1 second'");
  await s.db.adminQuery('ALTER TABLE shipit.customer_tracking_grants ENABLE TRIGGER customer_tracking_grants_immutable');
  await assert.rejects(s.service.track(grant),{code:'RESOURCE_NOT_FOUND'});
  await s.db.adminQuery("UPDATE shipit.customer_access_bindings SET verified_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day'");
  await assert.rejects(s.service.track(grant),{code:'RESOURCE_NOT_FOUND'});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.customer_access_commands')).rows[0]!.n,1);
  await s.pool.close();await assert.rejects(s.service.track(grant),{code:'TEMPORARILY_UNAVAILABLE'});
  const unavailable=await s.app.inject({url:'/api/v1/customer-tracking',headers:{authorization:'Bearer '+grant}});
  assert.equal(unavailable.statusCode,503);assert.equal(unavailable.body.includes(grant),false);
});
