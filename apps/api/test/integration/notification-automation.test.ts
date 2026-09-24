import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { notificationConsumerId,notificationPolicies,policyActivationDocument,policyBindings,validateNotificationEvent } from '../../src/modules/automation/registry.ts';
import { routeDelayVariables } from '../../src/modules/automation/delay-worker.ts';
import { routeDelayBatchSize,routeDelayReminderCooldownMinutes } from '../../src/modules/automation/delay-types.ts';
import type { Event } from '../../src/modules/outbox/types.ts';
import { safeFailureReason } from '../../src/modules/automation/repository.ts';

const event=(event_type:string,aggregate_type:string,payload:Record<string,unknown>):Event=>({event_id:randomUUID(),event_type,schema_version:1,
  organization_id:randomUUID(),franchise_id:randomUUID(),aggregate_type,aggregate_id:randomUUID(),aggregate_version:1,
  occurred_at:'2026-09-21T12:00:00.000Z',actor:{type:'service',id:'synthetic'},correlation_id:randomUUID(),causation_id:randomUUID(),command_id:randomUUID(),payload});

test('notification registry has stable identity, unique versions and exact payload schemas',()=>{
  assert.equal(notificationConsumerId,'customer-notifications');
  assert.equal(new Set(notificationPolicies.map(p=>`${p.id}:${p.version}`)).size,notificationPolicies.length);
  const booking=event('booking.created','booking',{parcel_set_ref:randomUUID()});assert.equal(validateNotificationEvent(booking),true);
  for(const invalid of [{...booking,payload:{}},{...booking,payload:{...booking.payload,extra:'x'}},{...booking,schema_version:2},{...booking,aggregate_type:'parcel'}])
    assert.equal(validateNotificationEvent(invalid),false);
  const route=event('route.departed','route',{manifest_id:randomUUID(),affected_set_ref:randomUUID()});
  assert.equal(validateNotificationEvent(route),false);route.payload.affected_set_ref=route.event_id;assert.equal(validateNotificationEvent(route),true);
  const delayed=event('route.delayed','route',{manifest_id:randomUUID(),affected_set_ref:randomUUID()});
  delayed.payload.affected_set_ref=delayed.event_id;assert.equal(validateNotificationEvent(delayed),true);
  assert.equal(validateNotificationEvent({...delayed,payload:{...delayed.payload,delay_minutes:15}}),false);
  const failure=event('delivery.attempt_failed','parcel',{attempt_id:randomUUID(),failure_reason:'customer_unavailable',evidence_ref:randomUUID()});
  assert.equal(validateNotificationEvent(failure),true);
  assert.equal(validateNotificationEvent({...failure,payload:{...failure.payload,failure_reason:'raw narrative'}}),false);
  assert.equal(validateNotificationEvent({...failure,payload:{...failure.payload,extra:'x'}}),false);
  assert.equal(validateNotificationEvent({...failure,payload:{...failure.payload,failure_reason:'other_controlled',failure_subreason:'weather_disruption'}}),true);
  assert.equal(validateNotificationEvent({...failure,payload:{...failure.payload,failure_subreason:'private note'}}),false);
  const rto=event('parcel.rto_approved','parcel',{approval_ref:randomUUID(),eligibility_ref:randomUUID(),return_plan_ref:randomUUID()});
  assert.equal(validateNotificationEvent(rto),true);
  const completed=event('delivery.completed','parcel',{attempt_id:randomUUID(),proof_ref:randomUUID()});
  assert.equal(validateNotificationEvent(completed),true);
  for(const invalid of [{...rto,payload:{...rto.payload,refund_ref:randomUUID()}},{...completed,payload:{attempt_id:completed.payload.attempt_id}},
    {...completed,aggregate_type:'booking'},{...completed,schema_version:2}])assert.equal(validateNotificationEvent(invalid),false);
  assert.deepEqual(notificationPolicies.filter(p=>['delivery.attempt_failed','parcel.rto_approved','delivery.completed'].includes(p.event))
    .map(p=>`${p.id}:${p.version}`),['delivery-attempt-failed:1','parcel-rto-approved:1','delivery-completed:1']);
  assert.equal(notificationPolicies.some(p=>['delivery.attempt_started','delivery.retry_started'].includes(p.event)),false);
});

test('policy bindings reject unknown versions, variables and duplicate identities',()=>{
  const valid={policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id']};
  assert.equal(policyBindings([valid]).size,1);
  for(const binding of [{...valid,policy_version:2},{...valid,variables:['phone']},{...valid,policy_id:'parcel-route-overlap'}])
    assert.throws(()=>policyBindings([binding]));
  assert.throws(()=>policyBindings([valid,valid]));
});

test('route-delayed policy requires the trusted ETA variable while preserving closed optional variables',()=>{
  const delayed={policy_id:'route-delayed',policy_version:1,template_name:'route_delayed',template_language:'en_US',variables:['revised_eta_at']};
  assert.equal(policyBindings([delayed]).get('route-delayed:1'),delayed);
  for(const variables of [[],['docket'],['effective_at'],['docket','effective_at']])
    assert.throws(()=>policyBindings([{...delayed,variables}]),{message:'NOTIFICATION_POLICY_CONFIGURATION_INVALID'});
  assert.throws(()=>policyBindings([{...delayed,variables:['revised_eta_at','unknown']}]),{message:'NOTIFICATION_POLICY_CONFIGURATION_INVALID'});
  assert.throws(()=>policyBindings([{...delayed,variables:['revised_eta_at','revised_eta_at']}]),{message:'NOTIFICATION_POLICY_CONFIGURATION_INVALID'});
  const booking={policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id']};
  assert.equal(policyBindings([booking]).get('booking-confirmation:1'),booking);
  const failed={policy_id:'delivery-attempt-failed',policy_version:1,template_name:'delivery_attempt_failed',template_language:'en_US',variables:['safe_failure_reason']};
  assert.equal(policyBindings([failed]).get('delivery-attempt-failed:1'),failed);
  assert.throws(()=>policyBindings([{...failed,variables:['docket']}]),{message:'NOTIFICATION_POLICY_CONFIGURATION_INVALID'});
  const completed={policy_id:'delivery-completed',policy_version:1,template_name:'delivery_completed',template_language:'en_US',variables:['proof_wording']};
  assert.equal(policyBindings([completed]).get('delivery-completed:1'),completed);
  assert.throws(()=>policyBindings([{...completed,variables:['completed_at']}]),{message:'NOTIFICATION_POLICY_CONFIGURATION_INVALID'});
});

test('policy activation identities are deterministic, independent and sensitive to versioned semantics',()=>{
  const booking={policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id','parcel_count']};
  const route={policy_id:'route-arrived',policy_version:1,template_name:'route_arrived',template_language:'en_US',variables:['docket','route_id']};
  const hash=(bindings:readonly typeof booking[],id:string)=>policyActivationDocument(bindings).find(p=>p.id===id)!.binding_hash;
  const original=hash([booking,route],'booking-confirmation');
  assert.equal(hash([route,booking],'booking-confirmation'),original);
  assert.equal(hash([booking,{...route,template_name:'route_arrived_v2'}],'booking-confirmation'),original);
  for(const changed of [{...booking,template_name:'booking_confirmation_v2'},{...booking,template_language:'en_GB'},
    {...booking,variables:['booking_id','parcel_count','confirmed_at']},{...booking,variables:['parcel_count','booking_id']}])
    assert.notEqual(hash([changed,route],'booking-confirmation'),original);
  const suppression=policyActivationDocument([]).find(p=>p.id==='parcel-route-overlap');
  assert.ok(suppression);assert.equal(policyActivationDocument([]).find(p=>p.id==='parcel-route-overlap')!.binding_hash,suppression.binding_hash);
  assert.equal(suppression.binding_hash.length,64);
  const delayed={policy_id:'route-delayed',policy_version:1,template_name:'route_delayed',template_language:'en_US',variables:['docket','effective_at','revised_eta_at']};
  const withDelay=policyActivationDocument([booking,route,delayed]);
  assert.equal(withDelay.find(p=>p.id==='booking-confirmation')!.binding_hash,original);
  assert.equal(withDelay.find(p=>p.id==='route-delayed')!.binding_hash,'a467a19213dc812c7ee6f2d1d5ea9102f17d1b41cecaaae9a84bb9cabf70af1f');
});

test('Issue 41 preserves every previously activated policy-v1 binding hash',()=>{
  const legacy=[
    {policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id']},
    {policy_id:'parcel-checked-in',policy_version:1,template_name:'parcel_checked_in',template_language:'en_US',variables:['docket']},
    {policy_id:'parcel-dispatched',policy_version:1,template_name:'parcel_dispatched',template_language:'en_US',variables:['docket']},
    {policy_id:'route-departed',policy_version:1,template_name:'route_departed',template_language:'en_US',variables:['docket']},
    {policy_id:'route-arrived',policy_version:1,template_name:'route_arrived',template_language:'en_US',variables:['docket']},
  ];
  const legacyIds=new Set(['booking-confirmation','parcel-checked-in','parcel-dispatched','parcel-route-overlap','route-departed','route-arrived']);
  const hashes=Object.fromEntries(policyActivationDocument(legacy).filter(policy=>legacyIds.has(policy.id)).map(policy=>[policy.id,policy.binding_hash]));
  assert.deepEqual(hashes,{
    'booking-confirmation':'a69588d1d9aefec21a50a80716689b7ffec17aa150016df187136de60f7371b9',
    'parcel-checked-in':'4f0a7c17d2a3b2ecfb42588ecb199bfab816f853ba6273a1a20a457e63180f35',
    'parcel-dispatched':'2991caba2ed89845ce8dfeda408a624fb387c48e8791de01c90ea2f0e11f2e92',
    'parcel-route-overlap':'b2b0b46651b88d7b15725f45a3e0e81370e514aad3dfdb40e920093aca132e8a',
    'route-departed':'4ca2854562a68d8d6de8dbdc20d29d6346cc307823c5cc035749e12942fe1278',
    'route-arrived':'c4cdf8e580c77369c8461b73567658e4c2b290ad37893544c19d83bb8afa3362',
  });
});

test('Route-delay batch, cooldown and closed ETA representation are explicit',()=>{
  assert.equal(routeDelayBatchSize,20);assert.equal(routeDelayReminderCooldownMinutes,60);
  const values=routeDelayVariables(['docket','effective_at','revised_eta_at'],
    {docket:'SYN-41',effective_at:new Date('2099-01-01T05:00:00Z'),revised_eta_at:null});
  assert.deepEqual(values,['SYN-41','2099-01-01T05:00:00.000Z','unavailable']);
  assert.throws(()=>routeDelayVariables(['unreviewed'],{docket:'SYN-41',effective_at:new Date(),revised_eta_at:null}),
    {message:'ROUTE_DELAY_VARIABLE_UNRESOLVED'});
});

test('final-mile wording is closed, conservative and payment-independent',()=>{
  assert.equal(safeFailureReason('payment_not_collected'),'The required payment was not collected');
  assert.equal(safeFailureReason('other_controlled'),'A delivery condition prevented completion');
  assert.equal(/paid|settled|refunded/i.test(safeFailureReason('payment_not_collected')),false);
  assert.throws(()=>safeFailureReason('private operational note'),{message:'NOTIFICATION_FAILURE_REASON_UNSUPPORTED'});
});
