import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { attachmentSetup,intent as attachmentIntent,photo } from '../attachment-support.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
import { webhookConfig } from '../webhook-fixture.ts';
import { createWhatsappService } from '../../src/modules/whatsapp/service.ts';
import { consentContactKey } from '../../src/modules/whatsapp/consent-worker.ts';
import { activateNotificationPolicies } from '../../src/modules/security/jobs.ts';
import { policyActivationDocument } from '../../src/modules/automation/registry.ts';
import { createNotificationConsumer } from '../../src/modules/automation/service.ts';
import { issueTenantAccess } from '../../src/modules/security/scope.ts';
import { openOutbound } from '../../src/modules/whatsapp/outbound-rules.ts';
import { createOutboundWorker } from '../../src/modules/whatsapp/outbound-worker.ts';
import { startTestDelivery,testDeliveryCode } from '../delivery-support.ts';
import type { Event } from '../../src/modules/outbox/types.ts';
import type { Binding,SendOutcome,WhatsappDependencies } from '../../src/modules/whatsapp/types.ts';
import type { DeliveryStateDto } from '../../src/modules/deliveries/types.ts';
import * as automationRepository from '../../src/modules/automation/repository.ts';

const selector={organization_id:org,franchise_id:A};
const policies=[
  {policy_id:'delivery-attempt-failed',policy_version:1,template_name:'delivery_attempt_failed',template_language:'en_US',variables:['docket','safe_failure_reason','occurred_at']},
  {policy_id:'parcel-rto-approved',policy_version:1,template_name:'parcel_rto_approved',template_language:'en_US',variables:['docket','occurred_at']},
  {policy_id:'delivery-completed',policy_version:1,template_name:'delivery_completed',template_language:'en_US',variables:['docket','completed_at','proof_wording']},
] as const;

type Base=Awaited<ReturnType<typeof bookingSetup>>;
async function installAutomation(s:Base,activation:'current'|'future'='current') {
  await s.db.prepareNotificationAutomation();
  const admin=await s.grant('franchise_admin',[A]);
  const binding={key:'final_mile_v1',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:final-mile/v1'};
  let sends=0,send:()=>Promise<SendOutcome>=async()=>({kind:'accepted',provider_message_id:`wamid.final_mile_${sends}`});
  const dependencies:WhatsappDependencies={configuration:{graph_version:'v24.0',bindings:[binding],webhook:webhookConfig,automation:{policies}},clock:s.clock,provider:{
    validate:async()=>{},template:async(_binding:Binding,name:string,language:string)=>({provider_id:'100003',name,language,status:'APPROVED',category:'UTILITY',shape_hash:'a'.repeat(64),
      variables:Array.from({length:policies.find(policy=>policy.template_name===name)?.variables.length??0},()=>({type:'text' as const})),supported:true}),
    send:async()=>{sends++;return send();},
  }};
  const registry=createWhatsappService(s.pool,dependencies);
  const installed=await registry.execute(admin.token,null,'connect',selector,randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
  let version=1;
  for(const policy of policies)await registry.execute(admin.token,String(installed.id),'sync',selector,randomUUID(),
    {expected_version:version++,name:policy.template_name,language:policy.template_language},randomUUID());
  const activations=policyActivationDocument(policies);
  if(activation==='current')await activateNotificationPolicies(s.pool,[binding],activations);
  else for(const policy of activations)await s.db.adminQuery(`INSERT INTO shipit.notification_policy_activations
    (organization_id,franchise_id,consumer_id,policy_id,policy_version,binding_hash,activated_at)
    VALUES($1,$2,'customer-notifications',$3,$4,$5,'2100-01-01T00:00:00Z')`,[org,A,policy.id,policy.version,policy.binding_hash]);
  return {admin,dependencies,installationId:String(installed.id),consumer:createNotificationConsumer(dependencies),
    worker:createOutboundWorker(s.pool,dependencies),calls:()=>sends,setSend:(value:typeof send)=>{send=value;}};
}
async function grantConsent(s:Base,installationId:string) {
  const customer=(await s.db.adminQuery<{contact_version:string;phone_normalized:string}>('SELECT contact_version,phone_normalized FROM shipit.customers WHERE id=$1',[s.source.id])).rows[0]!;
  const inbox=randomUUID(),contactKey=consentContactKey(webhookConfig,installationId,customer.phone_normalized),at=new Date();
  await s.db.adminQuery(`INSERT INTO shipit.whatsapp_inbox(id,organization_id,franchise_id,installation_id,event_key,digest,kind,message_id,occurred_at,sealed_payload,key_version,correlation_id,state,processed_at)
    VALUES($1,$2,$3,$4,$5,$6,'inbound',$7,$8,$9,$10,$11,'completed',$8)`,[inbox,org,A,installationId,'synthetic:'+inbox,'b'.repeat(64),'wamid.'+inbox,at,'A'.repeat(38),webhookConfig.key_version,randomUUID()]);
  await s.db.adminQuery(`INSERT INTO shipit.whatsapp_consent_state(organization_id,franchise_id,installation_id,contact_key,customer_id,contact_version,state,version,last_change_at,last_inbound_at,last_inbox_id,policy_version)
    VALUES($1,$2,$3,$4,$5,$6,'granted',1,$7,$7,$8,'whatsapp-consent-v1')`,[org,A,installationId,contactKey,s.source.id,customer.contact_version,at,inbox]);
  await s.db.adminQuery(`INSERT INTO shipit.whatsapp_consent_receipts
    (inbox_id,organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,intent,outcome,policy_version,occurred_at,correlation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,'start','granted','whatsapp-consent-v1',$8,$9)`,
  [inbox,org,A,installationId,s.source.id,customer.contact_version,contactKey,at,randomUUID()]);
}
async function setup(t:TestContext,activation:'current'|'future'='current') {
  const s=await bookingSetup(t),automation=await installAutomation(s,activation),booked=await s.book();
  assert.equal(booked.statusCode,201,booked.body);await grantConsent(s,automation.installationId);
  const parcel=booked.json().parcels[0] as {id:string};const agent=await s.grant('delivery_agent',[A]);
  const delivery=await startTestDelivery(s,parcel.id,agent);
  return {...s,...automation,booked,parcel,agent,...delivery};
}
async function event(s:Base,id:string) {
  return (await s.db.adminQuery<{envelope:Event}>('SELECT envelope FROM shipit.domain_events WHERE event_id=$1',[id])).rows[0]!.envelope;
}
async function apply(s:Base&{consumer:ReturnType<typeof createNotificationConsumer>},id:string) {
  const envelope=await event(s,id);
  await withTransaction(s.pool,tx=>s.consumer.apply(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:org,
    permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),envelope,false));
}
async function fail(s:Awaited<ReturnType<typeof setup>>,reason='customer_unavailable') {
  const response=await s.app.inject({method:'POST',url:`/api/v1/parcels/${s.parcel.id}/failed-attempt?`+new URLSearchParams(selector),
    cookies:s.cookies(s.agent.token),headers:{...s.headers,'idempotency-key':randomUUID()},payload:JSON.stringify({expected_version:(await s.db.adminQuery<{version:number}>('SELECT version FROM shipit.parcels WHERE id=$1',[s.parcel.id])).rows[0]!.version,
      attempt_id:(await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.delivery_attempts WHERE parcel_id=$1 AND state=\'active\'',[s.parcel.id])).rows[0]!.id,
      reason_code:reason,evidence_ref:randomUUID()})});
  assert.equal(response.statusCode,200,response.body);return response.json() as {event_id:string;version:number};
}
async function retry(s:Awaited<ReturnType<typeof setup>>) {
  const key=randomUUID(),version=(await s.db.adminQuery<{version:number}>('SELECT version FROM shipit.parcels WHERE id=$1',[s.parcel.id])).rows[0]!.version;
  return s.service.start(s.dispatcher.token,s.parcel.id,selector,key,['idempotency-key',key],{expected_version:version,agent_id:s.agent.id,handover_evidence_ref:randomUUID()},true,randomUUID());
}
async function complete(s:Awaited<ReturnType<typeof setup>>,state:DeliveryStateDto) {
  const key=randomUUID(),proof=await testDeliveryCode(s,s.parcel.id);
  return s.service.complete(s.agent.token,s.parcel.id,selector,key,['idempotency-key',key],{expected_version:state.parcel_version,
    challenge_ref:state.challenge_ref,challenge_version:state.challenge_version,proof},false,randomUUID()) as Promise<DeliveryStateDto>;
}
async function rendered(s:Base,id:string) {
  const row=(await s.db.adminQuery<{key_version:string;sealed_payload:string}>('SELECT key_version,sealed_payload FROM shipit.whatsapp_outbound WHERE id=$1',[id])).rows[0]!;
  return openOutbound(webhookConfig,id,row.key_version,row.sealed_payload);
}
async function completedEventId(s:Base,parcel:string) {
  return (await s.db.adminQuery<{event_id:string}>("SELECT event_id FROM shipit.domain_events WHERE parcel_id=$1 AND event_type='delivery.completed' ORDER BY aggregate_sequence DESC LIMIT 1",[parcel])).rows[0]!.event_id;
}

await test('failed intent uses safe wording, suppresses before reservation after completion, and completion remains payment-independent',{timeout:60000},async t=>{
  const s=await setup(t),failed=await fail(s,'payment_not_collected');await apply(s,failed.event_id);await apply(s,failed.event_id);
  const failureDecision=(await s.db.adminQuery<{outbound_intent_id:string}>('SELECT outbound_intent_id FROM shipit.notification_automation_decisions WHERE source_event_id=$1',[failed.event_id])).rows[0]!;
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.notification_automation_decisions WHERE source_event_id=$1',[failed.event_id])).rows[0]!.n,1);
  assert.deepEqual((await rendered(s,failureDecision.outbound_intent_id)).variables?.slice(1,2),['The required payment was not collected']);
  const paymentBefore=(await s.db.adminQuery('SELECT state,total_paise,collected_paise,outstanding_paise FROM shipit.booking_obligations WHERE booking_id=$1',[s.booked.json().id])).rows[0]!;
  const retried=await retry(s),delivered=await complete(s,retried),completedEvent=await completedEventId(s,s.parcel.id);assert.equal(delivered.proof_method,'otp_verified');
  assert.equal(await s.worker.tick(),'suppressed');assert.equal(s.calls(),0);
  assert.deepEqual((await s.db.adminQuery('SELECT state,reason_code,sealed_payload FROM shipit.whatsapp_outbound WHERE id=$1',[failureDecision.outbound_intent_id])).rows[0],
    {state:'suppressed',reason_code:'source_superseded',sealed_payload:null});
  await apply(s,completedEvent);await apply(s,completedEvent);
  const completion=(await s.db.adminQuery<{outbound_intent_id:string}>('SELECT outbound_intent_id FROM shipit.notification_automation_decisions WHERE source_event_id=$1',[completedEvent])).rows[0]!;
  const variables=(await rendered(s,completion.outbound_intent_id)).variables!;
  assert.equal(variables.at(-1),'recipient verification');assert.equal(/paid|settled|collected/i.test(variables.join(' ')),false);
  assert.equal(await s.worker.tick(),'accepted');assert.equal(s.calls(),1);
  assert.deepEqual((await s.db.adminQuery('SELECT state,total_paise,collected_paise,outstanding_paise FROM shipit.booking_obligations WHERE booking_id=$1',[s.booked.json().id])).rows[0],paymentBefore);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.domain_events WHERE event_type='payment.settled'")).rows[0]!.n,0);
});

await test('a distinct second failed attempt can notify while the first queued failure is stale',{timeout:60000},async t=>{
  const s=await setup(t),first=await fail(s);await apply(s,first.event_id);await retry(s);const second=await fail(s,'address_issue');await apply(s,second.event_id);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.notification_automation_decisions WHERE notification_kind='delivery_attempt_failed' AND outcome='queued'")).rows[0]!.n,2);
  assert.equal(await s.worker.tick(),'suppressed');assert.equal(s.calls(),0);
  assert.equal(await s.worker.tick(),'accepted');assert.equal(s.calls(),1);
  assert.deepEqual((await s.db.adminQuery('SELECT state,reason_code FROM shipit.whatsapp_outbound ORDER BY created_at,id')).rows,
    [{state:'suppressed',reason_code:'source_superseded'},{state:'accepted',reason_code:'provider_accepted'}]);
});

await test('a lifecycle outcome committed only after reservation preserves the provider attempt',{timeout:60000},async t=>{
  const s=await setup(t),failed=await fail(s);await apply(s,failed.event_id);
  s.setSend(async()=>{const retried=await retry(s);await complete(s,retried);return {kind:'accepted',provider_message_id:'wamid.after_reservation'};});
  assert.equal(await s.worker.tick(),'accepted');assert.equal(s.calls(),1);
  assert.deepEqual((await s.db.adminQuery('SELECT state,reason_code FROM shipit.whatsapp_outbound WHERE source_id=$1',[failed.event_id])).rows[0],
    {state:'accepted',reason_code:'provider_accepted'});
  assert.equal((await s.db.adminQuery('SELECT status FROM shipit.parcels WHERE id=$1',[s.parcel.id])).rows[0]!.status,'delivered');
});

await test('RTO sends only from committed approval and never claims return completion or refund',{timeout:60000},async t=>{
  const s=await setup(t),first=await fail(s);await apply(s,first.event_id);await retry(s);const second=await fail(s);await apply(s,second.event_id);
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.notification_automation_decisions WHERE notification_kind='rto_approved'")).rows[0]!.n,0);
  const approval=await s.app.inject({method:'POST',url:`/api/v1/parcels/${s.parcel.id}/rto?`+new URLSearchParams(selector),cookies:s.cookies(s.admin.token),
    headers:{...s.headers,'idempotency-key':randomUUID()},payload:JSON.stringify({expected_version:8,evidence_ref:randomUUID(),approval_ref:randomUUID(),return_plan_ref:randomUUID()})});
  assert.equal(approval.statusCode,200,approval.body);const approved=approval.json() as {event_id:string};await apply(s,approved.event_id);await apply(s,approved.event_id);
  const row=(await s.db.adminQuery<{outbound_intent_id:string}>('SELECT outbound_intent_id FROM shipit.notification_automation_decisions WHERE source_event_id=$1',[approved.event_id])).rows[0]!;
  const output=await rendered(s,row.outbound_intent_id);assert.equal(/returned|completed|refund|credit/i.test((output.variables??[]).join(' ')),false);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound WHERE source_id=$1',[approved.event_id])).rows[0]!.n,1);
});

await test('exceptional completion uses alternate-proof wording without protected evidence or OTP claims',{timeout:60000},async t=>{
  const s=await attachmentSetup(t),automation=await installAutomation(s);await grantConsent(s,automation.installationId);
  const agent=await s.grant('delivery_agent',[A]),started=await startTestDelivery(s,s.parcelId,agent);
  const body={...attachmentIntent(),purpose:'parcel_proof',parcel_id:s.parcelId},created=await s.request('POST','/uploads',body,agent.token);assert.equal(created.statusCode,201,created.body);
  const evidence=created.json().id as string;assert.equal((await s.request('PUT',`/uploads/${evidence}/content`,photo,agent.token)).statusCode,200);
  assert.equal((await s.request('POST',`/uploads/${evidence}/finalize`,{},agent.token)).statusCode,200);
  let key=randomUUID();const requested=await started.service.requestException(agent.token,s.parcelId,selector,key,['idempotency-key',key],
    {expected_version:5,reason_code:'provider_unavailable',evidence_id:evidence,recipient_present:true},randomUUID());
  key=randomUUID();const approved=await started.service.approveException(s.local.token,s.parcelId,selector,key,['idempotency-key',key],
    {expected_version:5,request_id:requested.exception!.request_id},randomUUID());
  key=randomUUID();const completed=await started.service.complete(agent.token,s.parcelId,selector,key,['idempotency-key',key],
    {expected_version:5,approval_ref:approved.exception!.approval_ref},true,randomUUID()) as DeliveryStateDto;
  assert.equal(completed.proof_method,'exceptional');
  const completedEvent=await completedEventId(s,s.parcelId);await apply({...s,...automation},completedEvent);
  const decision=(await s.db.adminQuery<{outbound_intent_id:string}>('SELECT outbound_intent_id FROM shipit.notification_automation_decisions WHERE source_event_id=$1',[completedEvent])).rows[0]!;
  const variables=(await rendered(s,decision.outbound_intent_id)).variables!;
  assert.equal(variables.at(-1),'approved alternate delivery proof');assert.equal(/otp|verified/i.test(variables.join(' ')),false);
  for(const protectedValue of [evidence,'provider_unavailable',s.body.parcels[0]!.recipient.phone])assert.equal(JSON.stringify(variables).includes(protectedValue),false);
});

await test('queued RTO and completion intents suppress when a newer authoritative revision wins before reservation',{timeout:90000},async t=>{
  await t.test('RTO',async t=>{
    const s=await setup(t);await fail(s);await retry(s);await fail(s);const approval=await s.app.inject({method:'POST',
      url:`/api/v1/parcels/${s.parcel.id}/rto?`+new URLSearchParams(selector),cookies:s.cookies(s.admin.token),headers:{...s.headers,'idempotency-key':randomUUID()},
      payload:JSON.stringify({expected_version:8,evidence_ref:randomUUID(),approval_ref:randomUUID(),return_plan_ref:randomUUID()})});
    assert.equal(approval.statusCode,200,approval.body);await apply(s,(approval.json() as {event_id:string}).event_id);
    await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
    await s.db.adminQuery('UPDATE shipit.parcels SET version=version+1,last_command_id=NULL WHERE id=$1',[s.parcel.id]);
    await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
    assert.equal(await s.worker.tick(),'suppressed');assert.equal(s.calls(),0);
  });
  await t.test('completion correction',async t=>{
    const s=await setup(t),delivered=await complete(s,s.state),completedEvent=await completedEventId(s,s.parcel.id);assert.equal(delivered.proof_method,'otp_verified');await apply(s,completedEvent);
    await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
    await s.db.adminQuery("UPDATE shipit.parcels SET status='held_at_office',custody='franchise_office',version=version+1,last_command_id=NULL WHERE id=$1",[s.parcel.id]);
    await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');
    assert.equal(await s.worker.tick(),'suppressed');assert.equal(s.calls(),0);
  });
});

await test('all three retained pre-activation final-mile facts become durable historical skips',{timeout:90000},async t=>{
  const s=await setup(t,'future'),first=await fail(s),retried=await retry(s),second=await fail(s),approval=await s.app.inject({method:'POST',
    url:`/api/v1/parcels/${s.parcel.id}/rto?`+new URLSearchParams(selector),cookies:s.cookies(s.admin.token),headers:{...s.headers,'idempotency-key':randomUUID()},
    payload:JSON.stringify({expected_version:8,evidence_ref:randomUUID(),approval_ref:randomUUID(),return_plan_ref:randomUUID()})});
  assert.equal(approval.statusCode,200,approval.body);for(const id of [first.event_id,second.event_id,(approval.json() as {event_id:string}).event_id])await apply(s,id);
  assert.equal(retried.parcel_version,7);
  const secondBooking=await s.book();assert.equal(secondBooking.statusCode,201,secondBooking.body);const parcel=secondBooking.json().parcels[0].id as string;
  const started=await startTestDelivery(s,parcel,s.agent,s.dispatcher),proof=await testDeliveryCode(s,parcel),key=randomUUID();
  await started.service.complete(s.agent.token,parcel,selector,key,['idempotency-key',key],{expected_version:5,challenge_ref:started.state.challenge_ref,
    challenge_version:started.state.challenge_version,proof},false,randomUUID());await apply(s,await completedEventId(s,parcel));
  const target=(await s.db.adminQuery("SELECT event_type,outcome,reason_code FROM shipit.notification_automation_decisions WHERE event_type IN ('delivery.attempt_failed','parcel.rto_approved','delivery.completed') ORDER BY event_type,source_event_id")).rows;
  assert.equal(target.length,4);assert.ok(target.every(row=>row.outcome==='skipped'&&row.reason_code==='historical_cutover'));
  assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.whatsapp_outbound WHERE source_id IN (SELECT source_event_id FROM shipit.notification_automation_decisions WHERE reason_code='historical_cutover')")).rows[0]!.n,0);
});

await test('valid sibling/foreign sources and a foreign proof reference reveal no resolver row or intent',{timeout:60000},async t=>{
  const s=await setup(t),failed=await fail(s),source=await event(s,failed.event_id);
  for(const [organization,franchise] of [[org,B],[otherOrg,C]] as const) {
    const rows=await withTransaction(s.pool,tx=>automationRepository.failedAttempt(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},
      organizationId:organization,permittedFranchiseIds:[franchise],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),source));
    assert.deepEqual(rows,[]);
  }
  const retried=await retry(s);await complete(s,retried);const completion=await event(s,await completedEventId(s,s.parcel.id));
  const tampered={...completion,payload:{...completion.payload,proof_ref:randomUUID()}};
  const rows=await withTransaction(s.pool,tx=>automationRepository.completion(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},
    organizationId:org,permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),tampered));
  assert.equal(rows.length,1);assert.equal(rows[0]!.values.proof_wording,'recipient verification');
  assert.equal(JSON.stringify(rows).includes(String(tampered.payload.proof_ref)),false);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.whatsapp_outbound')).rows[0]!.n,0);
});
