import { describe,it,expect } from 'vitest';
import { reviewReason } from '../../src/modules/carriers/reconciliation-policy.ts';
import { resolution } from '../../src/modules/carriers/reconciliation-service.ts';
const parcel={status:'dispatched',updated_at:'2026-10-03T10:00:00Z',created_at:'2026-10-03T09:00:00Z'};
const record={status:'in_transit_claim' as const,occurred_at:'2026-10-03T10:01:00Z',time_reason:null,duplicate_of:null,conflict:null};
const now=new Date('2026-10-03T10:02:00Z');
describe('carrier reconciliation policy',()=>{
  it('only authorizes a current movement claim from dispatched',()=>{
    expect(reviewReason(record,parcel,now,true)).toBe('ready');
    for(const status of ['booked','checked_in','in_transit','out_for_delivery','delivered','rto'])expect(reviewReason(record,{...parcel,status},now,true)).toBe('state_conflict');
    expect(reviewReason({...record,status:'delivered_claim'},parcel,now,true)).toBe('proof_required');
  });
  it('retains unknown time, stale, future, conflict and duplicate reasons',()=>{
    expect(reviewReason({...record,occurred_at:null,time_reason:'unknown_timezone'},parcel,now,true)).toBe('unknown_timezone');
    expect(reviewReason({...record,occurred_at:'2026-10-03T09:59:59Z'},parcel,now,true)).toBe('stale');
    expect(reviewReason({...record,occurred_at:'2026-10-03T10:03:00Z'},parcel,now,true)).toBe('future_time');
    expect(reviewReason({...record,status:null},parcel,now,true)).toBe('unsupported_status');
    expect(reviewReason(record,parcel,now,false)).toBe('reference_conflict');
    expect(reviewReason({...record,duplicate_of:'id'},parcel,now,true)).toBe('duplicate');
  });
  it('rejects unbounded decisions and missing concurrency controls',()=>{
    const body={decision:'apply',reason_code:'verified_movement',expected_version:1,expected_parcel_version:3};
    expect(resolution(body)).toEqual(body);
    for(const changed of [{...body,decision:'deliver'},{...body,reason_code:'free text'},{...body,expected_parcel_version:0},{...body,paid:true}])expect(()=>resolution(changed)).toThrow();
  });
});
