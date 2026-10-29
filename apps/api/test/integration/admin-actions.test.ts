import {describe,it,expect} from 'vitest';
import {administrativeActions,canAdminister,type OperatorRole} from '@shippingco/shared';
import {administrativeScope,deliveryScope,parcelCommandScope,custodyScope} from '../../src/modules/memberships/policy.ts';
import type {Membership} from '../../src/modules/memberships/types.ts';
import {readFileSync} from 'node:fs';

const grant=(role:OperatorRole,franchiseIds:string[],lifecycle:'active'|'revoked'='active'):Membership=>({
 id:'synthetic',userId:'synthetic',organizationId:'A',role,franchiseIds,lifecycle,version:1,
 createdAt:new Date(0),updatedAt:new Date(0),revokedAt:null,
});
describe('#190 administrative action and scope policy',()=>{
 it('classifies every protected action against the reviewed policy fixture, so new actions require a decision',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../../../../docs/architecture/fixtures/administrative-policy.json',import.meta.url),'utf8')) as {
   administrative_actions:string[];protected_actions_without_admin:string[];owner_only_actions:string[];
  };
  expect([...administrativeActions]).toEqual(fixture.administrative_actions);
  const source=readFileSync(new URL('../../src/modules/security/scope.ts',import.meta.url),'utf8');
  const declaration=source.slice(source.indexOf('const actions:'),source.indexOf('const reference ='));
  const protectedActions=[...new Set([...declaration.matchAll(/'([a-z_]+\.[a-z_.]+)'/g)].map(m=>m[1]))].sort();
  expect([...fixture.administrative_actions,...fixture.protected_actions_without_admin].sort()).toEqual(protectedActions);
  for(const action of fixture.protected_actions_without_admin)expect(canAdminister(['org_admin','franchise_admin'],action),action).toBe(false);
  expect(administrativeActions.filter(action=>!canAdminister(['franchise_admin'],action))).toEqual(fixture.owner_only_actions);
 });
 it('covers every declared action for owners and local administrators without expanding staff roles',()=>{
  const ownerOnly=new Set(['settings.organization.read','settings.organization.update','organization.profile.update','organization.lifecycle.manage','franchise.create']);
  for(const action of administrativeActions){
   expect(administrativeScope(action,[grant('org_admin',[])],['A1','A2']),action).toEqual(['A1','A2']);
   expect(administrativeScope(action,[grant('franchise_admin',['A1'])],['A1','A2']),action).toEqual(ownerOnly.has(action)?[]:['A1']);
   expect(administrativeScope(action,[grant('franchise_admin',['A2','A1'])],['A1','A2']),action).toEqual(ownerOnly.has(action)?[]:['A1','A2']);
   for(const role of ['operator','dispatcher','delivery_agent','accountant','read_only'] as const)
    expect(canAdminister([role],action),role+':'+action).toBe(false);
   expect(administrativeScope(action,[grant('org_admin',[],'revoked')],['A1','A2']),action).toEqual([]);
  }
 });
 it('fails closed for unknown/internal and actor-bound actions, including mixed admin/agent roles',()=>{
  for(const action of ['unknown.action','organization.bootstrap','franchise.create','organization.profile.update','organization.lifecycle.manage','parcels.create','outbox.work','bookings.audit','deliveries.complete','deliveries.resend','deliveries.replace','deliveries.exception.request','parcels.fail_delivery','custody.acknowledge','custody.release']){
   expect(canAdminister(['org_admin','franchise_admin','delivery_agent'],action),action).toBe(false);
  }
  const owner=[grant('org_admin',[])],admin=[grant('franchise_admin',['A1'])];
  for(const memberships of [owner,admin]){
   expect(deliveryScope('deliveries.complete',memberships,['A1','A2'])).toEqual([]);
   expect(parcelCommandScope('parcels.fail_delivery',memberships,['A1','A2'])).toEqual([]);
   expect(custodyScope('custody.acknowledge',memberships,['A1','A2'])).toEqual([]);
  }
  expect(deliveryScope('deliveries.complete',[...owner,grant('delivery_agent',['A1'])],['A1','A2'])).toEqual(['A1']);
 });
});
