import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { contact } from '../customer-support.ts';
import { webhookConfig } from '../webhook-fixture.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { consentContactKey } from '../../src/modules/whatsapp/consent-worker.ts';
import { createOutboxWorker } from '../../src/modules/outbox/worker.ts';
import { createNotificationConsumer } from '../../src/modules/automation/service.ts';
import { activateNotificationPolicies } from '../../src/modules/security/jobs.ts';
import { policyActivationDocument } from '../../src/modules/automation/registry.ts';
import { createAutomationReadService } from '../../src/modules/automation/read-service.ts';
import { routeMetadata } from '../route-support.ts';
import { input as pricingInput } from '../pricing-support.ts';
import { taxFacts } from '../tax-support.ts';
import { createParcelService } from '../../src/modules/parcels/service.ts';
import { createParcelBulkService } from '../../src/modules/parcels/bulk-service.ts';
import { createRouteService } from '../../src/modules/routes/service.ts';
import { createRouteEventService } from '../../src/modules/routes/event-service.ts';
import { createLotService } from '../../src/modules/lots/service.ts';
import { createRouteDelayFanoutWorker } from '../../src/modules/automation/delay-worker.ts';
import { routeDelayBatchSize } from '../../src/modules/automation/delay-types.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import { openOutbound } from '../../src/modules/whatsapp/outbound-rules.ts';
import { createOutboundWorker } from '../../src/modules/whatsapp/outbound-worker.ts';
import { normalizeBusinessWebhook } from '../../src/modules/whatsapp/webhook-payload.ts';
import { persistBusinessWebhook } from '../../src/modules/security/jobs.ts';
import { createInboxWorker } from '../../src/modules/whatsapp/inbox-worker.ts';
import { createConsentWorker } from '../../src/modules/whatsapp/consent-worker.ts';
import { callback,inbound } from '../webhook-fixture.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { createRouteDelayReminderService } from '../../src/modules/automation/reminder-service.ts';
import type { Event } from '../../src/modules/outbox/types.ts';
import type { Binding } from '../../src/modules/whatsapp/types.ts';

const policies=[
  {policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id']},
  {policy_id:'parcel-checked-in',policy_version:1,template_name:'parcel_checked_in',template_language:'en_US',variables:['docket']},
  {policy_id:'parcel-dispatched',policy_version:1,template_name:'parcel_dispatched',template_language:'en_US',variables:['docket']},
  {policy_id:'route-departed',policy_version:1,template_name:'route_departed',template_language:'en_US',variables:['docket']},
  {policy_id:'route-delayed',policy_version:1,template_name:'route_delayed',template_language:'en_US',variables:['docket','effective_at','revised_eta_at']},
  {policy_id:'route-arrived',policy_version:1,template_name:'route_arrived',template_language:'en_US',variables:['docket']},
];

async function setup(t:Parameters<typeof bookingSetup>[0],activateBefore=true,options:{skipTemplate?:string;consent?:boolean}={}) {
  const s=await bookingSetup(t);await s.db.prepareNotificationAutomation();
  const admin=await s.grant('franchise_admin',[A]),binding={key:'automation_v1',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:automation/v1'};
  const configuration={graph_version:'v24.0',bindings:[binding],webhook:webhookConfig,automation:{policies}};
  const dependencies={configuration,clock:s.clock,provider:{validate:async()=>{},template:async(_binding:Binding,name:string,language:string)=>({provider_id:'100003',name,language,status:'APPROVED',category:'UTILITY',shape_hash:'a'.repeat(64),
    variables:Array.from({length:policies.find(policy=>policy.template_name===name)?.variables.length??0},()=>({type:'text' as const})),supported:true}),send:async()=>({kind:'accepted' as const,provider_message_id:'wamid.automation'})}};
  const whatsapp=createWhatsappService(s.pool,dependencies),query={organization_id:org,franchise_id:A};
  const installed=await whatsapp.execute(admin.token,null,'connect',query,randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
  const installationId=String(installed.id);
  let installationVersion=1;
  for(const policy of policies)if(policy.policy_id!==options.skipTemplate)await whatsapp.execute(admin.token,installationId,'sync',query,randomUUID(),
    {expected_version:installationVersion++,name:policy.template_name,language:policy.template_language},randomUUID());
  const activations=policyActivationDocument(policies);
  if(activateBefore)await activateNotificationPolicies(s.pool,[binding],activations);
  const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
  if(!activateBefore)for(const policy of activations)await s.db.adminQuery(`INSERT INTO shipit.notification_policy_activations
    (organization_id,franchise_id,consumer_id,policy_id,policy_version,binding_hash,activated_at)
    VALUES($1,$2,'customer-notifications',$3,$4,$5,'2100-01-01T00:00:00Z')`,[org,A,policy.id,policy.version,policy.binding_hash]);
  const customer=(await s.db.adminQuery<{contact_version:string;phone_normalized:string}>('SELECT contact_version,phone_normalized FROM shipit.customers WHERE id=$1',[s.source.id])).rows[0]!;
  if(options.consent!==false) {
    const inbox=randomUUID(),contactKey=consentContactKey(webhookConfig,installationId,customer.phone_normalized),consentAt=new Date();
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_inbox(id,organization_id,franchise_id,installation_id,event_key,digest,kind,message_id,occurred_at,sealed_payload,key_version,correlation_id,state,processed_at)
      VALUES($1,$2,$3,$4,$5,$6,'inbound',$7,$8,$9,$10,$11,'completed',$8)`,[inbox,org,A,installationId,'synthetic:'+inbox,'b'.repeat(64),'wamid.'+inbox,consentAt,'A'.repeat(38),webhookConfig.key_version,randomUUID()]);
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_consent_state(organization_id,franchise_id,installation_id,contact_key,customer_id,contact_version,state,version,last_change_at,last_inbound_at,last_inbox_id,policy_version)
      VALUES($1,$2,$3,$4,$5,$6,'granted',1,$7,$7,$8,'whatsapp-consent-v1')`,[org,A,installationId,contactKey,s.source.id,customer.contact_version,consentAt,inbox]);
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_consent_receipts
      (inbox_id,organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,intent,outcome,policy_version,occurred_at,correlation_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,'start','granted','whatsapp-consent-v1',$8,$9)`,
      [inbox,org,A,installationId,s.source.id,customer.contact_version,contactKey,consentAt,randomUUID()]);
  }
  return {...s,franchiseAdmin:admin,dependencies,booked,worker:createOutboxWorker(s.pool,[createNotificationConsumer(dependencies)]),query};
}

type AutomationSetup=Awaited<ReturnType<typeof setup>>;
async function routeDelayFixture(s:AutomationSetup,count:number,baseEta:string|null='2099-01-01T12:00:00Z',options:{overlap?:boolean;terminalBeforeDelay?:readonly ('delivered'|'rto')[]}={}) {
  const totalWeight=count*999,fixtureTag=randomUUID().slice(0,8).toUpperCase(),quoteResponse=await s.quote({...pricingInput,weight_grams:totalWeight});
  assert.equal(quoteResponse.statusCode,200,quoteResponse.body);const quote=quoteResponse.json<{id:string}>();
  const taxIntent={quote_id:quote.id,pricing_input:{...pricingInput,weight_grams:totalWeight},facts:taxFacts};
  const intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),taxIntent,randomUUID());
  const calculated=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
  const booking=await s.booking.create(s.operator.token,org,A,randomUUID(),{customer_id:s.source.id,expected_customer_version:1,
    tax_calculation_id:calculated.id,tax_intent:taxIntent,parcels:Array.from({length:count},(_,index)=>({weight_grams:999,
      docket:`F41-${fixtureTag}-${String(index+1).padStart(3,'0')}`,recipient:{name:'Synthetic recipient',phone:'+1 202-555-0101',address:'21 Fictional Street'}}))},randomUUID());
  const parcelIds=booking.parcels.map(parcel=>parcel.id),bulk=createParcelBulkService(s.pool,createParcelService(s.pool,s.clock));
  const bulkRun=(body:unknown)=>{const key=randomUUID();return bulk.execute(s.operator.token,s.query,key,['idempotency-key',key],body,randomUUID());};
  const checked=await bulkRun({action:'check_in',items:parcelIds.map(parcel_id=>({parcel_id,
    idempotency_key:randomUUID(),command:{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()}}))});
  assert.equal(checked.summary.succeeded,count);
  const routes=createRouteService(s.pool,s.keys.browser),run=(id:string|null,body:unknown,operation:Parameters<typeof routes.execute>[7])=>{
    const key=randomUUID();return routes.execute(s.operator.token,id,null,s.query,key,['idempotency-key',key],body,operation,randomUUID());};
  let route=await run(null,routeMetadata,'routes.create');
  if(options.overlap) {
    const lots=createLotService(s.pool,s.keys.browser),lotRun=(id:string|null,body:unknown,operation:Parameters<typeof lots.execute>[7])=>{
      const key=randomUUID();return lots.execute(s.operator.token,id,null,s.query,key,['idempotency-key',key],body,operation,randomUUID());};
    const lot=await lotRun(null,{name:'Fanout overlap',destination_key:'SYN_DEST'},'lots.create') as {id:string;version:number};
    await lotRun(lot.id,{expected_version:lot.version,parcel_id:parcelIds[0]},'lots.membership.add');
    const key=randomUUID();route=await routes.execute(s.operator.token,route.id,null,s.query,key,['idempotency-key',key],
      {expected_version:route.version,lot_id:lot.id},'routes.lot.attach',randomUUID());
  }
  for(const parcel_id of parcelIds)route=await run(route.id,{expected_version:route.version,parcel_id},'routes.parcel.attach');
  route=await run(route.id,{expected_version:route.version},'routes.finalize');
  const dispatched=await bulkRun({action:'dispatch',items:parcelIds.map(parcel_id=>({parcel_id,
    idempotency_key:randomUUID(),command:{expected_version:2,evidence_ref:randomUUID(),manifest_id:route.current_manifest_id}}))});
  assert.equal(dispatched.summary.succeeded,count);
  const dispatcher=await s.grant('dispatcher',[A]),events=createRouteEventService(s.pool),event=(body:unknown)=>{
    const key=randomUUID();return events.execute(dispatcher.token,route.id,s.query,key,['idempotency-key',key],body,randomUUID());};
  const departure=await event({kind:'departure',expected_version:route.version,manifest_id:route.current_manifest_id,manifest_version:route.version,
    effective_at:'2099-01-01T04:00:00Z',evidence_ref:randomUUID(),base_eta_at:baseEta});
  if(options.terminalBeforeDelay?.length) {
    await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
    for(const [index,status] of options.terminalBeforeDelay.entries())await s.db.adminQuery(
      "UPDATE shipit.parcels SET status=$2,custody=CASE WHEN $2='delivered' THEN 'recipient' ELSE 'route_dispatch' END,version=version+1,last_command_id=NULL WHERE id=$1",
      [parcelIds[index],status]);
    await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  }
  const delay=await event({kind:'delay',expected_version:departure.version,manifest_id:route.current_manifest_id,manifest_version:route.version,
    effective_at:'2099-01-01T05:00:00Z',evidence_ref:randomUUID(),total_delay_minutes:120});
  return {booking,parcelIds,route,departure,delay,dispatcher};
}
async function applyDelaySource(s:AutomationSetup,eventId:string) {
  const envelope=(await s.db.adminQuery<{envelope:Event}>('SELECT envelope FROM shipit.domain_events WHERE event_id=$1',[eventId])).rows[0]!.envelope;
  const consumer=createNotificationConsumer(s.dependencies);
  await withTransaction(s.pool,tx=>consumer.apply(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:org,
    permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),envelope,false));
}
async function stopUpdates(s:AutomationSetup) {
  const customer=(await s.db.adminQuery<{phone_normalized:string}>('SELECT phone_normalized FROM shipit.customers WHERE id=$1',[s.source.id])).rows[0]!;
  const message={...inbound('wamid.stop.'+randomUUID(),'STOP'),from:customer.phone_normalized.slice(1),timestamp:String(Math.ceil(Date.now()/1000)+1)};
  await persistBusinessWebhook(s.pool,normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([message],{kind:'messages'}))),webhookConfig),webhookConfig.waba_ids,randomUUID());
  await createInboxWorker(s.pool).tick();assert.equal(await createConsentWorker(s.pool,webhookConfig).tick(),'revoked');
}

await test('Route-delay fanout is bounded, replay-safe, crash-resumable and concurrency-safe with current ETA',{timeout:180000},async t=>{
  const s=await setup(t),fixture=await routeDelayFixture(s,45),before=(await s.db.adminQuery(
    `SELECT r.version,r.base_eta_at::text,r.total_delay_minutes,x.revised_eta_at::text FROM shipit.routes r
     JOIN shipit.route_parcel_effects x ON x.route_id=r.id AND x.event_id=$2 WHERE r.id=$1 LIMIT 1`,[fixture.route.id,fixture.delay.event_id])).rows[0];
  await applyDelaySource(s,fixture.delay.event_id);await applyDelaySource(s,fixture.delay.event_id);
  let root=(await s.db.adminQuery(`SELECT * FROM shipit.route_delay_fanouts WHERE original_event_id=$1`,[fixture.delay.event_id])).rows[0]!;
  assert.equal(root.total_count,45);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_delay_fanouts')).rows[0]!.n,1);
  const terminal=fixture.parcelIds[0]!;
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  await s.db.adminQuery("UPDATE shipit.parcels SET status='delivered',custody='recipient',version=version+1,last_command_id=NULL WHERE id=$1",[terminal]);
  await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
  const crashing=createRouteDelayFanoutWorker(s.pool,s.dependencies,{afterItem:n=>{if(n===7)throw new Error('SYNTHETIC_FANOUT_CRASH');}});
  await assert.rejects(crashing.tick(),{message:'SYNTHETIC_FANOUT_CRASH'});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_delay_fanout_items')).rows[0]!.n,7);
  root=(await s.db.adminQuery('SELECT * FROM shipit.route_delay_fanouts WHERE id=$1',[root.id])).rows[0]!;assert.equal(root.state,'running');
  const restarted=createRouteDelayFanoutWorker(s.db.runtimePool(),s.dependencies);assert.equal(await restarted.tick(),routeDelayBatchSize);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_delay_fanout_items')).rows[0]!.n,27);
  const peer=createRouteDelayFanoutWorker(s.db.runtimePool(),s.dependencies),processed=await Promise.all([restarted.tick(),peer.tick()]);
  assert.equal(processed.reduce((sum,value)=>sum+value,0),18);
  root=(await s.db.adminQuery('SELECT * FROM shipit.route_delay_fanouts WHERE id=$1',[root.id])).rows[0]!;
  assert.deepEqual({state:root.state,total:root.total_count,completed:root.completed_count,skipped:root.skipped_count,failed:root.failed_count,attempts:root.attempt_count},
    {state:'completed',total:45,completed:44,skipped:1,failed:0,attempts:45});
  assert.equal((await s.db.adminQuery('SELECT count(DISTINCT parcel_id)::int n FROM shipit.route_delay_fanout_items WHERE fanout_id=$1',[root.id])).rows[0]!.n,45);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound WHERE source_id=$1',[fixture.delay.event_id])).rows[0]!.n,44);
  assert.deepEqual((await s.db.adminQuery(`SELECT r.version,r.base_eta_at::text,r.total_delay_minutes,x.revised_eta_at::text FROM shipit.routes r
    JOIN shipit.route_parcel_effects x ON x.route_id=r.id AND x.event_id=$2 WHERE r.id=$1 LIMIT 1`,[fixture.route.id,fixture.delay.event_id])).rows[0],before);
  const outbound=(await s.db.adminQuery<{id:string;key_version:string;sealed_payload:string}>(
    'SELECT id,key_version,sealed_payload FROM shipit.whatsapp_outbound WHERE source_id=$1 AND sealed_payload IS NOT NULL LIMIT 1',[fixture.delay.event_id])).rows[0]!;
  const rendered=openOutbound(webhookConfig,outbound.id,outbound.key_version,outbound.sealed_payload);
  assert.equal(rendered.variables?.at(-1),'2099-01-01T14:00:00.000Z');
  const read=createAutomationReadService(s.pool,s.keys.browser),status=await read.fanout(s.franchiseAdmin.token,root.id,s.query,randomUUID());
  assert.equal(status.processed_count,45);assert.equal(status.items.length,45);
  for(const privateValue of [contact.phone,contact.address!,'sealed_payload','customer_id'])assert.ok(!JSON.stringify(status).includes(privateValue));
  const reader=await s.grant('read_only',[A]);await assert.rejects(read.fanout(reader.token,root.id,s.query,randomUUID()),{code:'ACTION_FORBIDDEN'});
  const sibling=await s.grant('operator',[B]);await assert.rejects(read.fanout(sibling.token,root.id,{organization_id:org,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  const foreign=await s.beta('operator');await assert.rejects(read.fanout(foreign.token,root.id,{organization_id:otherOrg,franchise_id:C},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',
    TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const api=buildServer({config,database:s.db.runtimePool(),auth:{keys:s.keys,delivery:{},webhook:undefined},whatsapp:s.dependencies,logSink:{write:()=>{}}});t.after(()=>api.close());
  const response=await api.inject({url:`/api/v1/whatsapp/automation/route-delay-fanouts/${root.id}?`+new URLSearchParams(s.query),cookies:s.cookies(s.franchiseAdmin.token)});
  assert.equal(response.statusCode,200,response.body);assert.equal(response.json().processed_count,45);
  for(const privateValue of [contact.phone,contact.address!,'sealed_payload','customer_id'])assert.ok(!response.body.includes(privateValue));
});

await test('missing ETA is explicit and STOP after enqueue suppresses before provider send',{timeout:90000},async t=>{
  const s=await setup(t),fixture=await routeDelayFixture(s,1,null);await applyDelaySource(s,fixture.delay.event_id);
  assert.equal(await createRouteDelayFanoutWorker(s.pool,s.dependencies).tick(),1);
  const outbound=(await s.db.adminQuery<{id:string;key_version:string;sealed_payload:string;state:string}>(
    'SELECT id,key_version,sealed_payload,state FROM shipit.whatsapp_outbound WHERE source_id=$1',[fixture.delay.event_id])).rows[0]!;
  assert.equal(outbound.state,'queued');assert.equal(openOutbound(webhookConfig,outbound.id,outbound.key_version,outbound.sealed_payload).variables?.at(-1),'unavailable');
  s.setNow('2099-01-01T00:01:00Z');await stopUpdates(s);let sends=0;
  const dependencies={...s.dependencies,provider:{...s.dependencies.provider,send:async()=>{sends++;return {kind:'accepted' as const,provider_message_id:'wamid.must-not-send'};}}};
  assert.equal(await createOutboundWorker(s.pool,dependencies).tick(),'suppressed');assert.equal(sends,0);
  assert.deepEqual((await s.db.adminQuery('SELECT state,reason_code,sealed_payload FROM shipit.whatsapp_outbound WHERE id=$1',[outbound.id])).rows[0],
    {state:'suppressed',reason_code:'consent_revoked',sealed_payload:null});
});

await test('STOP before unfinished fanout items creates suppressed results and no active alert',{timeout:90000},async t=>{
  const s=await setup(t),fixture=await routeDelayFixture(s,2);await applyDelaySource(s,fixture.delay.event_id);
  s.setNow('2099-01-01T00:01:00Z');await stopUpdates(s);assert.equal(await createRouteDelayFanoutWorker(s.pool,s.dependencies).tick(),2);
  const outcomes=(await s.db.adminQuery('SELECT outcome,reason_code FROM shipit.route_delay_fanout_items ORDER BY parcel_id')).rows;
  assert.deepEqual(outcomes,[{outcome:'suppressed',reason_code:'consent_revoked'},{outcome:'suppressed',reason_code:'consent_revoked'}]);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.whatsapp_outbound WHERE state<>'suppressed'")).rows[0]!.n,0);
});

await test('overlapping membership is unique and a newer delay deterministically supersedes unfinished older work',{timeout:90000},async t=>{
  const s=await setup(t),fixture=await routeDelayFixture(s,1,'2099-01-01T12:00:00Z',{overlap:true});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_manifest_parcels WHERE manifest_id=$1',[fixture.route.current_manifest_id])).rows[0]!.n,1);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_parcel_effects WHERE event_id=$1',[fixture.delay.event_id])).rows[0]!.n,1);
  await applyDelaySource(s,fixture.delay.event_id);
  const events=createRouteEventService(s.pool),key=randomUUID(),newer=await events.execute(fixture.dispatcher.token,fixture.route.id,s.query,key,['idempotency-key',key],
    {kind:'delay',expected_version:fixture.delay.version,manifest_id:fixture.route.current_manifest_id,manifest_version:fixture.route.version,
      effective_at:'2099-01-01T06:00:00Z',evidence_ref:randomUUID(),total_delay_minutes:180},randomUUID());
  await applyDelaySource(s,newer.event_id);assert.equal(await createRouteDelayFanoutWorker(s.pool,s.dependencies).tick(2),2);
  const items=(await s.db.adminQuery<{original_event_id:string;outcome:string;reason_code:string}>(
    'SELECT original_event_id,outcome,reason_code FROM shipit.route_delay_fanout_items ORDER BY decided_at')).rows;
  assert.deepEqual(items,[{original_event_id:fixture.delay.event_id,outcome:'skipped',reason_code:'state_superseded'},
    {original_event_id:newer.event_id,outcome:'queued',reason_code:'eligible'}]);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound WHERE affected_entity_id=$1',[fixture.parcelIds[0]])).rows[0]!.n,1);
});

await test('delivered and RTO source effects remain skipped and historical cutover creates no active alert',{timeout:120000},async t=>{
  await t.test('terminal source effects',async t=>{
    const s=await setup(t),fixture=await routeDelayFixture(s,2,'2099-01-01T12:00:00Z',{terminalBeforeDelay:['delivered','rto']});
    assert.deepEqual({updated:fixture.delay.updated_count,skipped:fixture.delay.skipped_count},{updated:0,skipped:2});
    await applyDelaySource(s,fixture.delay.event_id);assert.equal(await createRouteDelayFanoutWorker(s.pool,s.dependencies).tick(2),2);
    assert.deepEqual((await s.db.adminQuery('SELECT outcome,reason_code FROM shipit.route_delay_fanout_items ORDER BY parcel_id')).rows,
      [{outcome:'skipped',reason_code:'terminal'},{outcome:'skipped',reason_code:'terminal'}]);
    assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
  });
  await t.test('historical cutover',async t=>{
    const s=await setup(t,false),fixture=await routeDelayFixture(s,1);await applyDelaySource(s,fixture.delay.event_id);
    assert.equal(await createRouteDelayFanoutWorker(s.pool,s.dependencies).tick(),1);
    assert.deepEqual((await s.db.adminQuery('SELECT outcome,reason_code FROM shipit.route_delay_fanout_items')).rows[0],
      {outcome:'skipped',reason_code:'historical_cutover'});
    assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
  });
});

await test('W19 reminders are separately identified, idempotent, rate-limited and tenant/role isolated',{timeout:120000},async t=>{
  const s=await setup(t),fixture=await routeDelayFixture(s,1),before=(await s.db.adminQuery(
    `SELECT r.version,r.base_eta_at::text,r.total_delay_minutes,x.revised_eta_at::text FROM shipit.routes r
     JOIN shipit.route_parcel_effects x ON x.route_id=r.id AND x.event_id=$2 WHERE r.id=$1 LIMIT 1`,[fixture.route.id,fixture.delay.event_id])).rows[0];
  await applyDelaySource(s,fixture.delay.event_id);
  type Actor={token:string};const request=(actor:Actor,body:unknown,key=randomUUID(),route=fixture.route.id,organization=org,franchise=A,headers:Record<string,string>=s.headers)=>s.app.inject({method:'POST',
    url:`/api/v1/routes/${route}/delay-reminders?`+new URLSearchParams({organization_id:organization,franchise_id:franchise}),
    headers:{...headers,'idempotency-key':key},cookies:s.cookies(actor.token),payload:JSON.stringify(body)});
  const body={original_delay_event_id:fixture.delay.event_id},key=randomUUID(),first=await request(s.franchiseAdmin,body,key);
  assert.equal(first.statusCode,202,first.body);const initial=first.json();assert.equal(initial.event_type,'route.delay_reminder.requested');
  assert.notEqual(initial.id,fixture.delay.event_id);assert.deepEqual((await request(s.franchiseAdmin,body,key)).json(),initial);
  const changed=await request(s.franchiseAdmin,{original_delay_event_id:randomUUID()},key);assert.equal(changed.statusCode,409,changed.body);assert.equal(changed.json().error.code,'IDEMPOTENCY_CONFLICT');
  const limited=await request(s.franchiseAdmin,body);assert.equal(limited.statusCode,429,limited.body);assert.equal(limited.json().error.code,'RATE_LIMITED');
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_delay_reminder_events')).rows[0]!.n,1);
  const restartKey=randomUUID(),restarted=createRouteDelayReminderService(s.db.runtimePool(),()=>new Date('2099-01-01T00:00:30Z'));
  await assert.rejects(restarted.execute(s.franchiseAdmin.token,fixture.route.id,s.query,restartKey,['idempotency-key',restartKey],body,randomUUID()),{code:'RATE_LIMITED'});
  s.setNow('2099-01-01T01:01:00Z');const operator=await request(s.operator,body);assert.equal(operator.statusCode,202,operator.body);
  s.setNow('2099-01-01T02:02:00Z');const dispatcher=await request(fixture.dispatcher,body);assert.equal(dispatcher.statusCode,202,dispatcher.body);
  const beforeDenied=(await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_delay_reminder_events')).rows[0]!.n;
  for(const actor of [s.admin,await s.grant('read_only',[A]),await s.grant('accountant',[A]),await s.grant('delivery_agent',[A])]) {
    const denied=await request(actor,body);assert.equal(denied.statusCode,403,denied.body);assert.equal(denied.json().error.code,'ACTION_FORBIDDEN');
  }
  const noOrigin=await request(s.operator,body,randomUUID(),fixture.route.id,org,A,{'content-type':'application/json'});
  assert.equal(noOrigin.statusCode,403,noOrigin.body);
  const malformed=await request(s.operator,{original_delay_event_id:'bad'});assert.equal(malformed.statusCode,422,malformed.body);
  const sibling=await s.grant('operator',[B]),foreign=await s.beta('operator'),unknown=await request(s.operator,body,randomUUID(),randomUUID());
  const siblingResponse=await request(sibling,body,randomUUID(),fixture.route.id,org,B);
  const foreignResponse=await request(foreign,body,randomUUID(),fixture.route.id,otherOrg,C);
  for(const response of [unknown,siblingResponse,foreignResponse]){assert.equal(response.statusCode,404,response.body);assert.equal(response.json().error.code,'RESOURCE_NOT_FOUND');}
  const other=await routeDelayFixture(s,1),nested=await request(s.operator,{original_delay_event_id:other.delay.event_id});
  assert.equal(nested.statusCode,404,nested.body);assert.equal(nested.json().error.code,'RESOURCE_NOT_FOUND');
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_delay_reminder_events')).rows[0]!.n,beforeDenied);
  s.setNow('2099-01-01T03:03:00Z');const concurrentKey=randomUUID(),concurrent=await Promise.all([
    request(s.operator,body,concurrentKey),request(s.operator,body,concurrentKey)]);
  assert.ok(concurrent.every(response=>response.statusCode===202));assert.equal(new Set(concurrent.map(response=>response.json().id)).size,1);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_delay_reminder_events WHERE original_event_id=$1',[fixture.delay.event_id])).rows[0]!.n,4);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.route_delay_fanouts WHERE source_kind=\'reminder\' AND original_event_id=$1',[fixture.delay.event_id])).rows[0]!.n,4);
  const identities=(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.route_delay_reminder_events WHERE original_event_id=$1',[fixture.delay.event_id])).rows.map(row=>row.id);
  assert.equal(new Set(identities).size,4);assert.ok(identities.every(id=>id!==fixture.delay.event_id));
  const fanout=createRouteDelayFanoutWorker(s.pool,s.dependencies);assert.equal(await fanout.tick(5),5);
  assert.equal((await s.db.adminQuery('SELECT count(DISTINCT source_id)::int n FROM shipit.whatsapp_outbound WHERE affected_entity_id=$1',[fixture.parcelIds[0]])).rows[0]!.n,5);
  assert.deepEqual((await s.db.adminQuery(`SELECT r.version,r.base_eta_at::text,r.total_delay_minutes,x.revised_eta_at::text FROM shipit.routes r
    JOIN shipit.route_parcel_effects x ON x.route_id=r.id AND x.event_id=$2 WHERE r.id=$1 LIMIT 1`,[fixture.route.id,fixture.delay.event_id])).rows[0],before);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE action='route.delay_reminder.requested'")).rows[0]!.n,4);
});

await test('versioned automation resolves booking data and creates one durable outbound decision',{timeout:60000},async t=>{
  const s=await setup(t);await s.worker.tick();await s.worker.tick();
  const decisions=(await s.db.adminQuery('SELECT * FROM shipit.notification_automation_decisions')).rows;
  assert.equal(decisions.length,1);assert.equal(decisions[0]!.outcome,'queued');assert.equal(decisions[0]!.reason_code,'eligible');
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,1);
  const duplicate=`INSERT INTO shipit.notification_automation_decisions
    (id,organization_id,franchise_id,source_event_id,event_type,policy_id,policy_version,affected_type,affected_entity_id,booking_id,parcel_id,customer_id,
      notification_kind,semantic_key,outcome,reason_code,outbound_intent_id,correlation_id)
    SELECT gen_random_uuid(),organization_id,$1,source_event_id,event_type,policy_id,policy_version,affected_type,affected_entity_id,booking_id,parcel_id,customer_id,
      notification_kind,semantic_key,outcome,reason_code,outbound_intent_id,correlation_id FROM shipit.notification_automation_decisions LIMIT 1`;
  await assert.rejects(s.db.adminQuery(duplicate,[A]));
  await assert.rejects(s.db.adminQuery(duplicate,[B]));
  await s.worker.tick();assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.notification_automation_decisions')).rows[0]!.n,1);
  const service=createAutomationReadService(s.pool,s.keys.browser),result=await service.list(s.admin.token,s.query,randomUUID());
  assert.equal(result.items.length,1);assert.ok(!JSON.stringify(result).includes(s.body.parcels[0]!.recipient.phone));
  const operator=await s.grant('operator',[A]),dispatcher=await s.grant('dispatcher',[A]),reader=await s.grant('read_only',[A]);
  assert.equal((await service.list(s.franchiseAdmin.token,s.query,randomUUID())).items.length,1);
  assert.equal((await service.list(operator.token,s.query,randomUUID())).items.length,1);
  assert.equal((await service.list(dispatcher.token,s.query,randomUUID())).items.length,1);
  await assert.rejects(service.list(reader.token,s.query,randomUUID()),{code:'ACTION_FORBIDDEN'});
  await assert.rejects(service.list(operator.token,{organization_id:org,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(service.list(s.admin.token,{organization_id:otherOrg,franchise_id:C},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});

await test('activation is an immutable cutover and historical events are durably skipped',{timeout:60000},async t=>{
  const s=await setup(t,false);await s.worker.tick();await s.worker.tick();
  const decision=(await s.db.adminQuery('SELECT outcome,reason_code,outbound_intent_id FROM shipit.notification_automation_decisions')).rows[0]!;
  assert.deepEqual(decision,{outcome:'skipped',reason_code:'historical_cutover',outbound_intent_id:null});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
  await activateNotificationPolicies(s.pool,[{organization_id:org,franchise_id:A}],policyActivationDocument(policies));
  assert.equal((await s.db.adminQuery('SELECT count(DISTINCT activated_at)::int n FROM shipit.notification_policy_activations')).rows[0]!.n,1);
  await assert.rejects(s.pool.query("UPDATE shipit.notification_policy_activations SET activated_at=clock_timestamp()"));
  await assert.rejects(s.pool.query("UPDATE shipit.notification_automation_decisions SET reason_code='eligible'"));
});

await test('policy activation identities are immutable, versioned and race-safe',{timeout:60000},async t=>{
  const s=await bookingSetup(t);await s.db.prepareNotificationAutomation();
  const owners=[{organization_id:org,franchise_id:A}];
  const configured=policies.map(policy=>policy.policy_id==='booking-confirmation'?{...policy,variables:['booking_id','parcel_count']}:policy);
  const activations=policyActivationDocument(configured);
  await activateNotificationPolicies(s.pool,owners,activations);
  type Activation={policy_id:string;policy_version:number;binding_hash:string;activated_at:Date};
  const rows=()=>s.db.adminQuery<Activation>(`SELECT policy_id,policy_version,binding_hash,activated_at
    FROM shipit.notification_policy_activations WHERE organization_id=$1 AND franchise_id=$2 ORDER BY policy_id,policy_version`,[org,A]);
  const initial=(await rows()).rows;
  await activateNotificationPolicies(s.pool,owners,activations);
  assert.deepEqual((await rows()).rows,initial);
  assert.equal(initial.length,7);assert.ok(initial.some(row=>row.policy_id==='parcel-route-overlap'));

  const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
  const variants=[
    configured.map(policy=>policy.policy_id==='booking-confirmation'?{...policy,template_name:'booking_confirmation_v2'}:policy),
    configured.map(policy=>policy.policy_id==='booking-confirmation'?{...policy,template_language:'en_GB'}:policy),
    configured.map(policy=>policy.policy_id==='booking-confirmation'?{...policy,variables:['booking_id','parcel_count','confirmed_at']}:policy),
    configured.map(policy=>policy.policy_id==='booking-confirmation'?{...policy,variables:['parcel_count','booking_id']}:policy),
  ];
  for(const variant of variants)await assert.rejects(
    activateNotificationPolicies(s.pool,owners,policyActivationDocument(variant)),{message:'NOTIFICATION_POLICY_VERSION_CONFLICT'});
  assert.deepEqual((await rows()).rows,initial);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.notification_automation_decisions')).rows[0]!.n,0);

  const originalBooking=activations.find(policy=>policy.id==='booking-confirmation')!;
  await activateNotificationPolicies(s.pool,owners,[originalBooking]);
  const changedRoute=policyActivationDocument(configured.map(policy=>policy.policy_id==='route-arrived'?{...policy,template_name:'route_arrived_v2'}:policy))
    .find(policy=>policy.id==='route-arrived')!;
  await assert.rejects(activateNotificationPolicies(s.pool,owners,[changedRoute]),{message:'NOTIFICATION_POLICY_VERSION_CONFLICT'});
  assert.equal((await rows()).rows.find(row=>row.policy_id==='booking-confirmation')!.binding_hash,originalBooking.binding_hash);

  await activateNotificationPolicies(s.pool,owners,[{id:'booking-confirmation',version:2,binding_hash:'2'.repeat(64)}]);
  const versions=(await rows()).rows.filter(row=>row.policy_id==='booking-confirmation');
  assert.deepEqual(versions.map(row=>row.policy_version),[1,2]);assert.notEqual(versions[0]!.binding_hash,versions[1]!.binding_hash);

  const identical={id:'booking-confirmation',version:3,binding_hash:'3'.repeat(64)};
  await Promise.all([activateNotificationPolicies(s.pool,owners,[identical]),activateNotificationPolicies(s.pool,owners,[identical])]);
  assert.equal((await rows()).rows.filter(row=>row.policy_id==='booking-confirmation'&&row.policy_version===3).length,1);
  const raced=await Promise.allSettled([
    activateNotificationPolicies(s.pool,owners,[{id:'booking-confirmation',version:4,binding_hash:'4'.repeat(64)}]),
    activateNotificationPolicies(s.pool,owners,[{id:'booking-confirmation',version:4,binding_hash:'5'.repeat(64)}]),
  ]);
  assert.deepEqual(raced.map(result=>result.status).sort(),['fulfilled','rejected']);
  const rejected=raced.find(result=>result.status==='rejected');
  assert.equal(rejected?.status==='rejected'&&rejected.reason instanceof Error?rejected.reason.message:null,'NOTIFICATION_POLICY_VERSION_CONFLICT');
  assert.equal((await rows()).rows.filter(row=>row.policy_id==='booking-confirmation'&&row.policy_version===4).length,1);
});

await test('check-in, dispatch, departure and arrival policies create only current canonical effects',{timeout:60000},async t=>{
  const s=await setup(t),parcel=s.booked.json().parcels[0].id as string;
  const post=(path:string,body:unknown,token=s.operator.token)=>s.app.inject({method:'POST',url:'/api/v1/'+path+'?'+new URLSearchParams(s.query),
    cookies:s.cookies(token),headers:{...s.headers,'idempotency-key':randomUUID()},payload:JSON.stringify(body)});
  let response=await post(`parcels/${parcel}/check-in`,{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()});assert.equal(response.statusCode,200,response.body);
  for(let n=0;n<6;n++)await s.worker.tick();
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.notification_automation_decisions WHERE event_type='parcel.checked_in' AND outcome='queued'")).rows[0]!.n,1);
  response=await post('routes',routeMetadata);assert.equal(response.statusCode,201,response.body);let route=response.json();
  response=await post(`routes/${route.id}/parcels`,{expected_version:route.version,parcel_id:parcel});assert.equal(response.statusCode,200,response.body);route=response.json();
  response=await post(`routes/${route.id}/finalize`,{expected_version:route.version});assert.equal(response.statusCode,200,response.body);route=response.json();
  response=await post(`parcels/${parcel}/dispatch`,{expected_version:2,manifest_id:route.current_manifest_id,evidence_ref:randomUUID()});assert.equal(response.statusCode,200,response.body);
  for(let n=0;n<6;n++)await s.worker.tick();
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.notification_automation_decisions WHERE event_type='parcel.dispatched' AND outcome='queued'")).rows[0]!.n,1);
  const dispatcher=await s.grant('dispatcher',[A]);
  const routeId=route.id,manifestId=route.current_manifest_id,manifestVersion=route.version;
  response=await post(`routes/${route.id}/events`,{kind:'departure',expected_version:route.version,manifest_id:route.current_manifest_id,manifest_version:route.version,
    effective_at:'2099-01-01T04:00:00Z',evidence_ref:randomUUID(),base_eta_at:'2099-01-01T12:00:00Z'},dispatcher.token);assert.equal(response.statusCode,200,response.body);
  for(let n=0;n<12;n++)await s.worker.tick();
  const rows=(await s.db.adminQuery<{event_type:string;outcome:string;reason_code:string;semantic_key:string}>('SELECT event_type,outcome,reason_code,semantic_key FROM shipit.notification_automation_decisions ORDER BY event_type')).rows;
  const transit=rows.find(r=>r.event_type==='parcel.in_transit'),departure=rows.find(r=>r.event_type==='route.departed');
  assert.ok(transit);assert.ok(departure);
  assert.deepEqual({outcome:transit?.outcome,reason:transit?.reason_code},{outcome:'suppressed',reason:'overlapping_route_cause'});
  assert.deepEqual({outcome:departure?.outcome,reason:departure?.reason_code},{outcome:'queued',reason:'eligible'});
  assert.equal(transit?.semantic_key,departure?.semantic_key);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.whatsapp_outbound WHERE source_id=(SELECT event_id FROM shipit.domain_events WHERE event_type='route.departed')")).rows[0]!.n,1);
  const departed=response.json();
  response=await post(`routes/${routeId}/events`,{kind:'arrival',expected_version:departed.version,manifest_id:manifestId,manifest_version:manifestVersion,
    effective_at:'2099-01-01T14:00:00Z',evidence_ref:randomUUID()},dispatcher.token);assert.equal(response.statusCode,200,response.body);
  for(let n=0;n<8;n++)await s.worker.tick();
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.notification_automation_decisions WHERE event_type='route.arrived' AND outcome='queued'")).rows[0]!.n,1);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.whatsapp_outbound WHERE source_id=(SELECT event_id FROM shipit.domain_events WHERE event_type='route.arrived')")).rows[0]!.n,1);
  assert.equal((await s.db.adminQuery('SELECT status FROM shipit.parcels WHERE id=$1',[parcel])).rows[0]!.status,'in_transit');
});

await test('missing template, unknown consent and changed contact produce safe durable non-send outcomes',{timeout:60000},async t=>{
  await t.test('missing template',async t=>{
    const s=await setup(t,true,{skipTemplate:'booking-confirmation'});await s.worker.tick();await s.worker.tick();
    assert.deepEqual((await s.db.adminQuery('SELECT outcome,reason_code FROM shipit.notification_automation_decisions')).rows[0],
      {outcome:'blocked',reason_code:'template_language_missing'});
    assert.deepEqual((await s.db.adminQuery('SELECT state,reason_code FROM shipit.whatsapp_outbound')).rows[0],
      {state:'failed',reason_code:'template_language_missing'});
  });
  await t.test('unknown consent',async t=>{
    const s=await setup(t,true,{consent:false});await s.worker.tick();await s.worker.tick();
    assert.deepEqual((await s.db.adminQuery('SELECT outcome,reason_code FROM shipit.notification_automation_decisions')).rows[0],
      {outcome:'suppressed',reason_code:'contact_unconfirmed'});
    assert.deepEqual((await s.db.adminQuery('SELECT state,reason_code,sealed_payload FROM shipit.whatsapp_outbound')).rows[0],
      {state:'suppressed',reason_code:'contact_unconfirmed',sealed_payload:null});
  });
  await t.test('changed contact',async t=>{
    const s=await setup(t);await s.customer.update(s.operator.token,org,A,s.source.id,randomUUID(),
      {...contact,phone:'+1 202-555-0199',expected_version:1},randomUUID());
    await s.worker.tick();await s.worker.tick();
    assert.deepEqual((await s.db.adminQuery('SELECT outcome,reason_code FROM shipit.notification_automation_decisions')).rows[0],
      {outcome:'skipped',reason_code:'recipient_contact_changed'});
    assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
  });
});
