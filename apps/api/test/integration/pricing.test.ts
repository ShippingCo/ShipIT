import { expect, it } from 'vitest';
import type { Membership } from '../../src/modules/memberships/types.ts';
import type { TenantAccess } from '../../src/modules/security/scope.ts';
import type { PricingVersionDto } from '@shippingco/shared';
import { draft as fixture, input, start } from '../pricing-support.ts';
import { draft, quote, timestamp } from '../../src/modules/pricing/validation.ts';
import { calculate, assertRules, checked } from '../../src/modules/pricing/calculation.ts';
import { replayDto } from '../../src/modules/pricing/types.ts';
import { fingerprint } from '../../src/modules/pricing/idempotency.ts';
import { pricingScope } from '../../src/modules/memberships/policy.ts';
import * as repository from '../../src/modules/pricing/repository.ts';
import { validatePricingSnapshot } from '../../src/modules/pricing/service.ts';
import { parseStrictJson } from '../../src/plugins/json.ts';
const version:PricingVersionDto={...fixture,id:'v',card_id:'c',version_number:1,version:2,state:'published',created_at:start,published_at:start,published_by:'actor',rules:fixture.rules.map((r,i)=>({...r,id:'r'+i}))};
const calc=(weight:number)=>calculate(version,{...input,weight_grams:weight},new Date(start),'q','actor',false);
it.each([[1,'r0'],[999,'r0'],[1000,'r1'],[1001,'r1'],[1999,'r1'],[3000,'r2'],[3001,'r2'],[Number.MAX_SAFE_INTEGER,'r2']])('exact boundary %s matches one rule', (weight,id)=>expect(calc(weight as number).rule_id).toBe(id));
it.each([2000,2001,2999])('gap %s is explicit no-rate',weight=>expect(()=>calc(weight)).toThrow('NO_RATE'));
it('identical input/instant/evidence identity yields identical bytes, independent of rule order',()=>{
  const a=calc(999);expect(JSON.stringify(calc(999))).toBe(JSON.stringify(a));
  expect(calculate({...version,rules:[...version.rules].reverse()},input,new Date(start),'q','actor',false)).toEqual(a);
  expect(a).toMatchObject({freight_suggestion_paise:12551,packing_paise:249,subtotal_paise:12800,expires_at:'2099-01-01T00:10:00Z'});
});
it('exact destination/service and defensive ambiguity rejection',()=>{
  for(const change of [{destination_key:'OTHER'},{service:'express' as const}])expect(()=>calculate(version,{...input,...change},new Date(start),'q','actor',false)).toThrow('NO_RATE');
  const overlap={...version,rules:[...version.rules,{...version.rules[0]!,id:'other'}]};
  expect(()=>assertRules(overlap)).toThrow('RATE_CONFLICT');expect(()=>calculate(overlap,input,new Date(start),'q','actor',false)).toThrow('RATE_CONFLICT');
  expect(()=>assertRules(version)).not.toThrow();
});
it.each([0,-1,0.001,1.5,'1','0.001',Infinity,NaN,Number.MAX_SAFE_INTEGER+1,null])('reject invalid exact weight %#',weight=>expect(()=>quote({...input,weight_grams:weight})).toThrow('VALIDATION_FAILED'));
it.each(['overnight','Standard','',null,1])('unsupported service %#',service=>expect(()=>quote({...input,service})).toThrow('VALIDATION_FAILED'));
it('paise sums/variance checked through safe maximum without binary rupee rounding',()=>{
  expect(checked(9007199254740991n)).toBe(Number.MAX_SAFE_INTEGER);expect(()=>checked(9007199254740992n)).toThrow('VALIDATION_FAILED');
  const v={...version,rules:[{...version.rules[0]!,freight_paise:Number.MAX_SAFE_INTEGER,packing_paise:0}]};
  expect(calculate(v,input,new Date(start),'q','actor',false).subtotal_paise).toBe(Number.MAX_SAFE_INTEGER);
  expect(()=>draft({...fixture,rules:[{...fixture.rules[0]!,freight_paise:Number.MAX_SAFE_INTEGER,packing_paise:1}]})).toThrow('VALIDATION_FAILED');
});
it.each([12051,12551,13051])('within inclusive tolerance exact amount %s',freight=>{
  const q=calculate(version,quote({...input,override:{freight_paise:freight,reason_code:'customer_agreement'}}),new Date(start),'q','actor',false);
  expect(q.variance_paise).toBe(Math.abs(freight-12551));expect(q.override_status).toBe('within_tolerance');
});
it('above tolerance requires actual approval and structured reason',()=>{
  const requested=quote({...input,override:{freight_paise:13052,reason_code:'commercial_exception'}});
  expect(()=>calculate(version,requested,new Date(start),'q','actor',false)).toThrow('ACTION_FORBIDDEN');
  expect(calculate(version,requested,new Date(start),'q','actor',true)).toMatchObject({variance_paise:501,override_status:'privileged',approval_actor_id:'actor'});
  for(const override of [{freight_paise:13052},{freight_paise:13052,reason_code:'free text'},{freight_paise:13052,reason_code:'commercial_exception',managerApproved:true}])expect(()=>quote({...input,override})).toThrow('VALIDATION_FAILED');
});
it('strict input, nested owners, malicious totals and dates fail safely',()=>{
  for(const name of ['organization_id','franchise_id','rate','price','freight_total','packing_total','calculated_total','managerApproved'])expect(()=>quote({...input,[name]:1})).toThrow('VALIDATION_FAILED');
  for(const destination_key of ['lower',' A','A\n','A'.repeat(33),'Α'])expect(()=>quote({...input,destination_key})).toThrow('VALIDATION_FAILED');
  for(const field of ['id','organization_id','franchise_id','version_id'])expect(()=>draft({...fixture,rules:[{...fixture.rules[0],[field]:'foreign'}]})).toThrow('VALIDATION_FAILED');
  for(const t of ['2099-02-30T00:00:00Z','0000-01-01T00:00:00Z','2099-01-01T00:00:00.0001Z','2099-01-01T00:00:00Z\n'])expect(()=>timestamp(t,'effective_from')).toThrow('VALIDATION_FAILED');
  expect(timestamp('2099-01-01T05:30:00+05:30','effective_from')).toBe(start);
});
it('finite configured expiry clipped to version end; exact start/end behavior',()=>{
  expect(calculate(version,input,new Date('2099-01-01T23:59:59Z'),'q','actor',false).expires_at).toBe(fixture.effective_to);
  for(const date of ['2098-12-31T23:59:59.999Z',fixture.effective_to])expect(()=>calculate(version,input,new Date(date),'q','actor',false)).toThrow('NO_RATE');
  expect(()=>draft({...fixture,quote_validity_seconds:0})).toThrow('VALIDATION_FAILED');
});
it('canonical intent includes expected version, resource, array order and normalized time',()=>{
  const first=draft(fixture);expect(fingerprint('api.v1.pricing.draft',null,first)).toBe(fingerprint('api.v1.pricing.draft',null,draft({...fixture,effective_from:'2099-01-01T05:30:00+05:30'})));
  expect(fingerprint('api.v1.pricing.replace','a',{...first,expected_version:1})).not.toBe(fingerprint('api.v1.pricing.replace','a',{...first,expected_version:2}));
  expect(fingerprint('api.v1.pricing.draft',null,first)).not.toBe(fingerprint('api.v1.pricing.draft',null,{...first,rules:[...first.rules].reverse()}));
});
it('R21 W27 W01 W43 matrix grants only existing current roles/scopes',()=>{
  for(const role of ['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only'] as const) {
    const m={role,franchiseIds:['A'],lifecycle:'active'} as Membership;
    expect(pricingScope('pricing.quote',[m],['A','B'])).toEqual(role==='org_admin'?['A','B']:['franchise_admin','operator','dispatcher','accountant'].includes(role)?['A']:[]);
    for(const action of ['pricing.draft','pricing.publish','pricing.override.approve'] as const)expect(pricingScope(action,[m],['A','B'])).toEqual(role==='franchise_admin'?['A']:[]);
    expect(pricingScope('pricing.override',[m],[])).toEqual(['franchise_admin','operator','dispatcher'].includes(role)?['A']:[]);
    expect(pricingScope('pricing.quote',[{...m,lifecycle:'revoked'}],['A','B'])).toEqual([]);
  }
});
it('pricing SQL and snapshot validation reject missing/structural capabilities before SQL',async()=>{
  for(const scope of [undefined,{}, {context:{organizationId:'foreign',action:'pricing.publish'}}]) {
    await expect(repository.find(scope as TenantAccess,'id')).rejects.toThrow('ACTION_FORBIDDEN');
    await expect(repository.effective(scope as TenantAccess,new Date())).rejects.toThrow('ACTION_FORBIDDEN');
    await expect(repository.create(scope as TenantAccess,fixture)).rejects.toThrow('ACTION_FORBIDDEN');
    await expect(validatePricingSnapshot(scope as TenantAccess,'id',input)).rejects.toThrow('ACTION_FORBIDDEN');
  }
});
it('original JSON numeric lexemes cannot hide fractional precision loss or underflow',()=>{
  for(const token of ['9007199254740991.1','1.0000000000000000000001','1e-999','9007199254740993','0.1','-0.0001'])expect(()=>parseStrictJson('{"weight_grams":'+token+'}',true)).toThrow('VALIDATION_FAILED');
  for(const token of ['1','1.0','1e0','1000e-3','-0','0e-999','9007199254740991'])expect(()=>parseStrictJson('{"weight_grams":'+token+'}',true)).not.toThrow();
});

it('receipt projections drop future private fields at every exposed object boundary',()=>{
  const q=calc(999);
  expect(replayDto({...q,internal:'SYN_SECRET',policy:{...q.policy,internal:'SYN_SECRET'},inputs:{...q.inputs,internal:'SYN_SECRET'},breakdown:{...q.breakdown,internal:'SYN_SECRET'}} as typeof q)).toEqual(q);
  expect(replayDto({...version,internal:'SYN_SECRET',rules:version.rules.map(r=>({...r,internal:'SYN_SECRET'}))} as typeof version)).toEqual(version);
});
