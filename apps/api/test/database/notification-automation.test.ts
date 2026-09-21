import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import type { Binding } from '../../src/modules/whatsapp/types.ts';

const policies=[
  {policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id']},
  {policy_id:'parcel-checked-in',policy_version:1,template_name:'parcel_checked_in',template_language:'en_US',variables:['docket']},
  {policy_id:'parcel-dispatched',policy_version:1,template_name:'parcel_dispatched',template_language:'en_US',variables:['docket']},
  {policy_id:'route-departed',policy_version:1,template_name:'route_departed',template_language:'en_US',variables:['docket']},
  {policy_id:'route-arrived',policy_version:1,template_name:'route_arrived',template_language:'en_US',variables:['docket']},
];

async function setup(t:Parameters<typeof bookingSetup>[0],activateBefore=true,options:{skipTemplate?:string;consent?:boolean}={}) {
  const s=await bookingSetup(t);await s.db.prepareNotificationAutomation();
  const admin=await s.grant('franchise_admin',[A]),binding={key:'automation_v1',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:automation/v1'};
  const configuration={graph_version:'v24.0',bindings:[binding],webhook:webhookConfig,automation:{policies}};
  const dependencies={configuration,clock:s.clock,provider:{validate:async()=>{},template:async(_binding:Binding,name:string,language:string)=>({provider_id:'100003',name,language,status:'APPROVED',category:'UTILITY',shape_hash:'a'.repeat(64),variables:[{type:'text' as const}],supported:true}),send:async()=>({kind:'accepted' as const,provider_message_id:'wamid.automation'})}};
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
    const inbox=randomUUID(),contactKey=consentContactKey(webhookConfig,installationId,customer.phone_normalized);
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_inbox(id,organization_id,franchise_id,installation_id,event_key,digest,kind,message_id,occurred_at,sealed_payload,key_version,correlation_id,state,processed_at)
      VALUES($1,$2,$3,$4,$5,$6,'inbound',$7,$8,$9,$10,$11,'completed',$8)`,[inbox,org,A,installationId,'synthetic:'+inbox,'b'.repeat(64),'wamid.'+inbox,s.clock(),'A'.repeat(38),webhookConfig.key_version,randomUUID()]);
    await s.db.adminQuery(`INSERT INTO shipit.whatsapp_consent_state(organization_id,franchise_id,installation_id,contact_key,customer_id,contact_version,state,version,last_change_at,last_inbound_at,last_inbox_id,policy_version)
      VALUES($1,$2,$3,$4,$5,$6,'granted',1,$7,$7,$8,'whatsapp-consent-v1')`,[org,A,installationId,contactKey,s.source.id,customer.contact_version,s.clock(),inbox]);
  }
  return {...s,franchiseAdmin:admin,dependencies,booked,worker:createOutboxWorker(s.pool,[createNotificationConsumer(dependencies)]),query};
}

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
  assert.equal(initial.length,6);assert.ok(initial.some(row=>row.policy_id==='parcel-route-overlap'));

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
