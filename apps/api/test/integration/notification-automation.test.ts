import { test } from 'vitest';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { notificationConsumerId,notificationPolicies,policyBindings,validateNotificationEvent } from '../../src/modules/automation/registry.ts';
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
