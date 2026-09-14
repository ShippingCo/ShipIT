import { expect,it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { command } from '../../src/modules/parcels/validation.ts';
import { fingerprint } from '../../src/modules/parcels/idempotency.ts';
import { parcelCommandScope } from '../../src/modules/memberships/policy.ts';
import type { Membership,Role } from '../../src/modules/memberships/types.ts';

const id=()=>randomUUID();
it('accepts only the closed evidence schema for each lifecycle command',()=>{
  expect(command('parcels.check_in',{expected_version:1,evidence_ref:id(),location_ref:id()})).toMatchObject({expected_version:1});
  expect(command('parcels.dispatch',{expected_version:2,evidence_ref:id(),manifest_id:id()})).toMatchObject({expected_version:2});
  expect(command('parcels.transit',{expected_version:3,evidence_ref:id(),route_id:id()})).toMatchObject({expected_version:3});
  expect(command('parcels.fail_delivery',{expected_version:4,evidence_ref:id(),attempt_id:id(),reason_code:'customer_unavailable'})).toMatchObject({reason_code:'customer_unavailable'});
  expect(command('parcels.fail_delivery',{expected_version:4,evidence_ref:id(),attempt_id:id(),reason_code:'other_controlled',failure_subreason_code:'weather_disruption'})).toMatchObject({failure_subreason_code:'weather_disruption'});
  expect(command('parcels.approve_rto',{expected_version:5,evidence_ref:id(),approval_ref:id(),return_plan_ref:id(),override_reason_code:'safety_risk'})).toMatchObject({override_reason_code:'safety_risk'});
});
it('rejects arbitrary status, proof flags, free-text reasons and malformed references',()=>{
  const base={expected_version:1,evidence_ref:id(),location_ref:id()};
  for(const body of [{...base,status:'delivered'},{...base,verified:true},{...base,evidence_ref:'private note'},
    {expected_version:1,evidence_ref:id(),attempt_id:id(),reason_code:'Customer said something private'}])
    expect(()=>command(body.reason_code?'parcels.fail_delivery':'parcels.check_in',body)).toThrow();
  expect(()=>command('parcels.fail_delivery',{expected_version:1,evidence_ref:id(),attempt_id:id(),reason_code:'other_controlled'})).toThrow();
  expect(()=>command('parcels.fail_delivery',{expected_version:1,evidence_ref:id(),attempt_id:id(),reason_code:'customer_unavailable',failure_subreason_code:'weather_disruption'})).toThrow();
});
it('canonical command intent includes parcel, operation, expected version and evidence',()=>{
  const parcel=id(),body=command('parcels.check_in',{expected_version:1,evidence_ref:id(),location_ref:id()});
  expect(fingerprint('parcels.check_in',parcel,body)).toBe(fingerprint('parcels.check_in',parcel,Object.fromEntries(Object.entries(body).reverse()) as never));
  expect(fingerprint('parcels.check_in',parcel,body)).not.toBe(fingerprint('parcels.check_in',id(),body));
  expect(fingerprint('parcels.check_in',parcel,body)).not.toBe(fingerprint('parcels.dispatch',parcel,{...body,manifest_id:id()}));
});
it('implements the exact W07-W09/W12/W14 role ceilings without inheritance',()=>{
  const franchise=id(),roles:readonly Role[]=['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only'];
  const membership=(role:Role)=>({role,franchiseIds:[franchise],lifecycle:'active'} as Membership);
  const expected={
    'parcels.check_in':['operator'],'parcels.dispatch':['franchise_admin','operator','dispatcher'],
    'parcels.transit':['dispatcher'],'parcels.fail_delivery':['delivery_agent'],'parcels.approve_rto':['franchise_admin'],
  } as const;
  for(const [action,allowed] of Object.entries(expected))for(const role of roles)
    expect(parcelCommandScope(action as keyof typeof expected,[membership(role)]),`${action}:${role}`).toEqual(allowed.includes(role as never)?[franchise]:[]);
  expect(parcelCommandScope('parcels.dispatch',[{...membership('dispatcher'),lifecycle:'revoked'}])).toEqual([]);
});
