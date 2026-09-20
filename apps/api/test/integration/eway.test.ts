import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as v from '../../src/modules/eway/validation.ts';
import { evaluate,calculateEstimate,selectedPolicy,estimateLabel } from '../../src/modules/eway/rules.ts';
import { recordDto,type EwayRow,type Policy } from '../../src/modules/eway/types.ts';
import { ewayCursorCodec } from '../../src/modules/eway/cursor.ts';
import { find,reminders } from '../../src/modules/eway/repository.ts';
import type { TenantAccess } from '../../src/modules/security/scope.ts';
const now=new Date('2099-01-01T00:00:00Z'),id=randomUUID();
const policy:Policy={id,organization_id:id,franchise_id:id,version:1,approved:true,effective_from:now,source_ref:'SYN_SOURCE',approval_ref:'SYN_APPROVAL',threshold_paise:'200000',warning_seconds:60,estimate_rule:'distance_blocks_v1',block_km:10,block_seconds:100};
const row=():EwayRow=>({id,organization_id:id,franchise_id:id,booking_id:id,version:1,declared_goods_value_paise:'123456',declaration_source_ref:'SYN_DECL',issuer:'SYN_ISSUER',external_reference:'SYN-REF',source_ref:'SYN_SOURCE',source_issued_at:null,official_valid_until:null,validity_evidence_ref:null,vehicle_number:'SYN-123',distance_km:53,estimate:null,estimate_policy_id:null,actor_id:id,captured_at:now,reason_code:'initial_capture',reason_ref:null,command_id:id,correlation_id:id});
describe('external e-way authority and validation',()=>{
 it('rejects Unicode surrogates, controls, forged verification and malformed bounded corrections',()=>{
  for(const bad of ['\ud800','A\u0000','A\r','A\u202e'])expect(()=>v.reference(bad)).toThrow();
  for(const key of ['verification_state','verified_at','verification_actor','organization_id'])expect(()=>v.external({issuer:'SYN',reference:'SYN',[key]:'government_verified'})).toThrow();
  for(const reason_ref of ['',null,'a'.repeat(129),'SYN SECRET'])expect(()=>v.correction({expected_version:1,reason_code:'metadata_correction',reason_ref,external:null})).toThrow();
  for(const distance_km of [0,100001,NaN,Infinity,'1'])expect(()=>v.create({distance_km})).toThrow();
 });
 it('keeps explicit zero distinct from unknown and binds correction version and Booking to canonical intent',()=>{
  expect(v.create({declaration:{value_paise:0,source_ref:'SYN'}}).declaration?.value_paise).toBe(0);
  expect(v.create({distance_km:1}).declaration).toBeNull();
  const a=v.correction({expected_version:1,reason_code:'metadata_correction',reason_ref:'SYN',external:null});
  expect(v.fingerprint('correct',id,a)).not.toBe(v.fingerprint('correct',id,{...a,expected_version:2}));
  expect(v.fingerprint('correct',id,a)).not.toBe(v.fingerprint('correct',randomUUID(),a));
  expect(()=>v.idempotencyKey('SYN',['Idempotency-Key','SYN','Idempotency-Key','SYN'])).toThrow();
 });
 it('normalizes only ASCII surrounding space, vehicle case, UTC and key order',()=>{
  const fractional=row();fractional.official_valid_until=new Date('2099-01-01T00:00:00.120Z');
  expect(recordDto(fractional,false).external?.official_valid_until).toBe('2099-01-01T00:00:00.12Z');
  const a=v.create({external:{reference:' SYN-1\t',issuer:'SYN',issued_at:'2099-01-01T05:30:00+05:30'},vehicle_number:'syn-1'});
  const b=v.create({vehicle_number:'SYN-1',external:{issuer:'SYN',reference:'SYN-1',issued_at:'2099-01-01T00:00:00Z'}});
  expect(a).toEqual(b);expect(v.fingerprint('create',id,a)).toBe(v.fingerprint('create',id,b));expect(v.fingerprint('create',id,a)).not.toBe(v.fingerprint('correct',id,a));
  expect(v.fingerprint('create',id,a)).not.toBe(v.fingerprint('create',id,{...a,distance_km:1}));
 });
 it.each(['','a\n','ＡＢＣ','a\u200b','é','\u00a0A','A B','a'.repeat(129),'https://private.example','a?secret=1',{},null])('rejects unsafe reference %j',value=>expect(()=>v.reference(value)).toThrow());
 it.each([0,-1,1.5,2147483647,'1',null])('rejects expected version %j',value=>expect(()=>v.correction({expected_version:value,reason_code:'metadata_correction',reason_ref:'SYN',distance_km:1})).toThrow());
 it.each(['government_verified','unknown','x'.repeat(128),null])('rejects invented correction reason %j',reason=>expect(()=>v.correction({expected_version:1,reason_code:reason,reason_ref:'SYN',external:null})).toThrow());
 it.each(['organization_id','franchise_id','actor_id','captured_by','created_at','verification_state','estimate','estimate_policy_id','parcel_id','private_address'])('rejects mass assignment %s',key=>expect(()=>v.create({external:{issuer:'SYN',reference:'SYN'},[key]:'SYN_SECRET'})).toThrow());
 it.each([NaN,Infinity,1.1,-1,Number.MAX_SAFE_INTEGER+1,'100'])('rejects invalid declared paise %j',value=>expect(()=>v.create({declaration:{value_paise:value,source_ref:'SYN'}})).toThrow());
 it('requires evidence and source for official validity and validates exact instants',()=>{
  const base={issuer:'SYN',reference:'SYN',official_valid_until:'2099-01-02T00:00:00Z'};
  expect(()=>v.external(base)).toThrow();expect(()=>v.external({...base,validity_evidence_ref:'SYN'})).toThrow();
  expect(v.external({...base,validity_evidence_ref:'SYN',source_ref:'SYN'})).toMatchObject(base);
  for(const t of ['infinity','2099-02-30T00:00:00Z','2099-01-01','0000-01-01T00:00:00Z'])expect(()=>v.external({...base,official_valid_until:t})).toThrow();
  expect(()=>v.external({...base,validity_evidence_ref:'SYN',source_ref:'SYN',issued_at:base.official_valid_until})).toThrow();
  expect(()=>v.external({issuer:'X'.repeat(65),reference:'SYN'})).toThrow();
 });
 it('unknown historical declaration and unverified reference never become zero or valid',()=>{
  const current=row();current.declared_goods_value_paise=null;
  expect(evaluate(current,null,now)).toMatchObject({reference_state:'recorded',official_validity_state:'unknown',verification_state:'unverified_external',verified_at:null,applicability_state:'unknown',value_check_state:'unknown',estimate_state:'absent'});
  expect(evaluate(null,null,now).reference_state).toBe('missing');expect(evaluate(null,null,now).reminder_reasons).toContain('policy_verification_required');
 });
 it('versioned policy threshold applies at its effective boundary without mutating evidence',()=>{
  const p2={...policy,id:randomUUID(),version:2,effective_from:new Date(now.getTime()+1000),threshold_paise:'100000'},r=row(),original=structuredClone(r);
  expect(selectedPolicy([p2,policy],new Date(now.getTime()-1))).toBeNull();
  expect(evaluate(r,selectedPolicy([p2,policy],now),now).value_check_state).toBe('below_threshold');
  expect(evaluate(r,selectedPolicy([p2,policy],p2.effective_from),p2.effective_from)).toMatchObject({value_check_state:'threshold_met',policy:{id:p2.id,version:2}});expect(r).toEqual(original);
  expect(evaluate(r,{...p2,approved:false},now).value_check_state).toBe('unknown');
 });
 it.each([-1,0,1])('expiry at exact instant plus %i ms',delta=>{
  const r=row();r.official_valid_until=now;r.estimate=calculateEstimate(policy,10,'2098-12-31T23:58:20Z',now);
  const state=evaluate(r,policy,new Date(now.getTime()+delta));expect(state.official_validity_state).toBe(delta<0?'source_supported':'expired');expect(state.estimate_state).toBe(delta<0?'estimated':'expired');
  expect(state.reminder_reasons).toContain(delta<0?'official_expiring':'official_expired');expect(state.reminder_reasons).toContain(delta<0?'estimate_expiring':'estimate_expired');
 });
 it('warning boundary is inclusive and estimate cannot write official validity',()=>{
  const r=row();r.official_valid_until=new Date(now.getTime()+60001);expect(evaluate(r,policy,now).reminder_reasons).not.toContain('official_expiring');r.official_valid_until=new Date(now.getTime()+60000);expect(evaluate(r,policy,now).reminder_reasons).toContain('official_expiring');
  const before=structuredClone(r),estimate=calculateEstimate(policy,53,now.toISOString(),now);expect(estimate).toMatchObject({provenance:'shippingco_estimate',label:estimateLabel,estimated_valid_until:'2099-01-01T00:10:00Z',estimate_policy_version:1});expect(estimate).not.toHaveProperty('official_valid_until');expect(r).toEqual(before);
  for(const p of [null,{...policy,approved:false},{...policy,estimate_rule:null}])expect(()=>calculateEstimate(p,53,now.toISOString(),now)).toThrow('EWAY_ESTIMATE_UNAVAILABLE');
 });
 it('explicit accountant projection drops operational/private fields even from stored data',()=>{
  const r={...row(),private_address:'SYN_SECRET',raw_request:'SYN_SECRET',vehicle_number:'SYN_PRIVATE_VEHICLE'};
  expect(recordDto(r,true)).not.toHaveProperty('captured_by');expect(recordDto(r,true)).not.toHaveProperty('reason_code');expect(JSON.stringify(recordDto(r,true))).not.toMatch(/SYN_SECRET|SYN_PRIVATE_VEHICLE|organization_id|command_id/);
  expect(recordDto(r,false)).toHaveProperty('vehicle_number','SYN_PRIVATE_VEHICLE');
 });
 it('encrypted cursor rejects tampering, cross-scope binding and expiry',()=>{
  let ms=now.getTime();const c=ewayCursorCodec(Buffer.alloc(32,3),()=>new Date(ms)),token=c.encode('scope',id);expect(c.decode(token,'scope')).toBe(id);expect(()=>c.decode(token,'other')).toThrow();expect(()=>c.decode('x'+token,'scope')).toThrow();ms+=15*60*1000;expect(()=>c.decode(token,'scope')).toThrow();
 });
 it('forged capability fails before SQL',async()=>{await expect(find({} as TenantAccess,id)).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});await expect(reminders({} as TenantAccess,null,5)).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});});
});
