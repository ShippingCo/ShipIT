import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingSetup } from '../booking-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { contact } from '../customer-support.ts';
import { webhookConfig } from '../webhook-fixture.ts';
import { activateNotificationPolicies } from '../../src/modules/security/jobs.ts';
import { policyActivationDocument } from '../../src/modules/automation/registry.ts';
import { createAutomationReadService } from '../../src/modules/automation/read-service.ts';
import { routeMetadata } from '../route-support.ts';
import { createRouteEventService } from '../../src/modules/routes/event-service.ts';
import { createRouteDelayFanoutWorker } from '../../src/modules/automation/delay-worker.ts';
import { routeDelayBatchSize } from '../../src/modules/automation/delay-types.ts';
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

import { policies, automationSetup as setup, routeDelayFixture, applyDelaySource } from '../automation-support.ts';
type AutomationSetup=Awaited<ReturnType<typeof setup>>;
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
  assert.equal(initial.length,10);assert.ok(initial.some(row=>row.policy_id==='parcel-route-overlap'));

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

await test('history joins one logical message, decision-only cutover/blocks and immutable automation outcomes',{timeout:30000},async t=>{
 const {createHistoryService}=await import('../../src/modules/whatsapp/history-service.ts');
 const s=await setup(t);await s.worker.tick();
 const history=createHistoryService(s.pool,s.keys.browser),list=(view:'messages'|'automation')=>history.list(s.operator.token,view,s.query,randomUUID());
 const messages=await list('messages'),decisions=await list('automation');assert.equal(messages.items.length,1);assert.equal(decisions.items.length,1);
 assert.equal(messages.items[0]!.message!.id,decisions.items[0]!.message!.id);assert.equal(decisions.items[0]!.decision!.outcome,'queued');
 for(const role of ['franchise_admin','operator','dispatcher']) {
  const reader=await s.grant(role,[A]);assert.equal((await history.detail(reader.token,'automation',decisions.items[0]!.id,s.query,randomUUID())).id,decisions.items[0]!.id);
 }
 assert.equal((await history.list(s.admin.token,'automation',s.query,randomUUID())).items.length,1);
 for(const [organization,franchise] of [[org,B],[otherOrg,C]]) {
  const reader=organization===org?await s.grant('operator',[franchise!]):await s.beta('operator'),query={organization_id:organization,franchise_id:franchise};
  assert.deepEqual((await history.list(reader.token,'automation',{...query,correlation_id:decisions.items[0]!.correlation_id},randomUUID())).items,[]);
  for(const ref of [decisions.items[0]!.id,randomUUID()])await assert.rejects(history.detail(reader.token,'automation',ref,query,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 }

 await createOutboundWorker(s.pool,s.dependencies).tick();
 assert.equal((await list('messages')).items[0]!.message!.state,'accepted');assert.equal((await list('automation')).items[0]!.decision!.outcome,'queued');
});
for(const options of [{cutover:true},{blocked:true},{suppressed:true}]) {
 await test('history retains decision-only outcome '+Object.keys(options)[0],{timeout:30000},async t=>{
  const {createHistoryService}=await import('../../src/modules/whatsapp/history-service.ts');
  const fixture=await setup(t,!options.cutover,{missingBinding:options.blocked,consent:!options.suppressed});await fixture.worker.tick();
  const rows=await createHistoryService(fixture.pool,fixture.keys.browser).list(fixture.operator.token,'automation',fixture.query,randomUUID());
  assert.equal(rows.items.length,1);assert.equal(rows.items[0]!.decision!.outcome,options.cutover?'skipped':options.blocked?'blocked':'suppressed');
  if(options.cutover||options.blocked)assert.equal(rows.items[0]!.message,null);
 });
}
await test('history Route-delay root and items correlate safely; W19 eligibility, cooldown and reminder identity stay separate',{timeout:60000},async t=>{
 const {createHistoryService}=await import('../../src/modules/whatsapp/history-service.ts');
 const s=await setup(t),fixture=await routeDelayFixture(s,4);await applyDelaySource(s,fixture.delay.event_id);await createRouteDelayFanoutWorker(s.pool,s.dependencies).tick();
 const history=createHistoryService(s.pool,s.keys.browser),rows=await history.list(s.operator.token,'automation',s.query,randomUUID()),root=rows.items.find(row=>row.row_kind==='fanout')!;
 assert.ok(root);const detail=await history.detail(s.operator.token,'automation',root.id,s.query,randomUUID());assert.equal(detail.fanout_items.length,4);assert.equal(detail.reminder.eligible,true);
 assert.equal((await history.detail(s.admin.token,'automation',root.id,s.query,randomUUID())).reminder.eligible,false);
 for(const item of detail.fanout_items){const message=await history.detail(s.operator.token,'messages',item.outbound_intent_id!,s.query,randomUUID());assert.equal(message.fanout!.id,root.id);assert.equal(message.decision!.outcome,item.outcome);assert.equal(message.reminder.eligible,false);}
 const before=(await s.db.adminQuery('SELECT version,base_eta_at,total_delay_minutes FROM shipit.routes WHERE id=$1',[fixture.route.id])).rows[0];
 const key=randomUUID(),reminders=createRouteDelayReminderService(s.pool),body={original_delay_event_id:fixture.delay.event_id};
 const result=await reminders.execute(s.operator.token,fixture.route.id,s.query,key,['idempotency-key',key],body,randomUUID());
 assert.notEqual(result.id,fixture.delay.event_id);assert.notEqual(result.fanout_id,root.id);
 assert.equal((await history.detail(s.operator.token,'automation',root.id,s.query,randomUUID())).reminder.eligible,false);
 const key2=randomUUID();await assert.rejects(reminders.execute(s.operator.token,fixture.route.id,s.query,key2,['idempotency-key',key2],body,randomUUID()),{code:'RATE_LIMITED'});
 assert.deepEqual((await s.db.adminQuery('SELECT version,base_eta_at,total_delay_minutes FROM shipit.routes WHERE id=$1',[fixture.route.id])).rows[0],before);
 const sibling=await s.grant('operator',[B]);for(const id of [root.id,randomUUID()])await assert.rejects(history.detail(sibling.token,'automation',id,{organization_id:org,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});

await test('history mixed automation volume retains decision-only rows and bounds fanouts before enrichment',{timeout:60000},async t=>{
 const {createHistoryService}=await import('../../src/modules/whatsapp/history-service.ts');
 const s=await setup(t);await s.worker.tick();const fixture=await routeDelayFixture(s,4);await applyDelaySource(s,fixture.delay.event_id);await createRouteDelayFanoutWorker(s.pool,s.dependencies).tick();
 await s.db.adminQuery(`INSERT INTO shipit.notification_automation_decisions(id,organization_id,franchise_id,source_event_id,event_type,policy_id,policy_version,
 affected_type,affected_entity_id,booking_id,parcel_id,customer_id,notification_kind,semantic_key,outcome,reason_code,outbound_intent_id,correlation_id,decided_at)
 SELECT gen_random_uuid(),organization_id,franchise_id,source_event_id,event_type,'synthetic-policy-'||n,1,affected_type,affected_entity_id,booking_id,parcel_id,customer_id,
 notification_kind,semantic_key,CASE WHEN n%3=0 THEN 'blocked' WHEN n%3=1 THEN 'suppressed' ELSE 'skipped' END,'synthetic',NULL,correlation_id,decided_at-n*interval '1 second'
 FROM shipit.notification_automation_decisions CROSS JOIN generate_series(1,2000) n WHERE policy_id='booking-confirmation'`);
 await s.db.adminQuery('ANALYZE shipit.notification_automation_decisions');
 const plans:Record<string,unknown>[]=[];
 const pool={...s.pool,async connect(){const c=await s.pool.connect();return {release:(discard?:boolean)=>c.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
  if(sql.includes('WITH candidates')){const result=await c.query<Record<string,unknown>>('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,params);plans.push((result.rows[0]!['QUERY PLAN'] as Record<string,unknown>[])[0]!);}
  return c.query<Row>(sql,params);
 }};}};
 const history=createHistoryService(pool,s.keys.browser),first=await history.list(s.operator.token,'automation',{...s.query,limit:'25'},randomUUID());
 assert.equal(first.items.length,25);assert.equal(first.page.has_more,true);assert.equal(first.items.filter(r=>r.row_kind==='fanout').length,1);
 const second=await history.list(s.operator.token,'automation',{...s.query,limit:'25',cursor:first.page.next_cursor!},randomUUID());
 assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,50);assert.equal(plans.length,2);
 assert.ok(JSON.stringify(plans).includes('notification_decisions_history'),'Tenant/time decision index used');
 const blocked=await history.list(s.operator.token,'automation',{...s.query,status:'blocked',limit:'100'},randomUUID());
 assert.equal(blocked.items.length,100);assert.ok(blocked.items.every(r=>r.decision?.outcome==='blocked'&&r.message===null));
 for(const plan of plans)t.diagnostic('Automation EXPLAIN execution ms: '+plan['Execution Time']);
});
