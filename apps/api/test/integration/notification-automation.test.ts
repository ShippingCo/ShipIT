import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { notificationConsumerId,notificationPolicies,policyActivationDocument,policyBindings,validateNotificationEvent } from '../../src/modules/automation/registry.ts';
import type { Event } from '../../src/modules/outbox/types.ts';

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
});

test('policy bindings reject unknown versions, variables and duplicate identities',()=>{
  const valid={policy_id:'booking-confirmation',policy_version:1,template_name:'booking_confirmation',template_language:'en_US',variables:['booking_id']};
  assert.equal(policyBindings([valid]).size,1);
  for(const binding of [{...valid,policy_version:2},{...valid,variables:['phone']},{...valid,policy_id:'parcel-route-overlap'}])
    assert.throws(()=>policyBindings([binding]));
  assert.throws(()=>policyBindings([valid,valid]));
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
});
