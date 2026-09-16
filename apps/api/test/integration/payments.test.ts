import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { balance,collect,reverse,fingerprint } from '../../src/modules/payments/rules.ts';
import { collection,reversal,selection } from '../../src/modules/payments/validation.ts';
import { paymentScope } from '../../src/modules/memberships/policy.ts';
import type { Membership,Role } from '../../src/modules/memberships/types.ts';
import { projection } from '../../src/modules/payments/repository.ts';
import type { TenantAccess } from '../../src/modules/security/scope.ts';
const booking=randomUUID(),obligation=randomUUID(),reference=randomUUID();
const input={amount_paise:40000,currency:'INR' as const,context:'to_pay' as const,method:'cash' as const,collection_reference:reference};
describe('payment financial rules',()=>{
 it('derives exact opening, partial, full and zero positions without rounding',()=>{
  expect(balance(100000n,0n)).toMatchObject({collected_paise:0,outstanding_paise:100000,state:'uncollected'});
  expect(collect(100000n,0n,40001)).toMatchObject({collected_paise:40001,outstanding_paise:59999,state:'partially_collected'});
  expect(collect(100000n,40001n,59999)).toMatchObject({outstanding_paise:0,state:'settled'});
  expect(balance(0n,0n)).toMatchObject({outstanding_paise:0,state:'settled'});
  expect(collect(BigInt(Number.MAX_SAFE_INTEGER),1n,Number.MAX_SAFE_INTEGER-1).collected_paise).toBe(Number.MAX_SAFE_INTEGER);
 });
 it('rejects drift, overcollection and unsafe arithmetic',()=>{
  for(const [g,c] of [[-1n,0n],[0n,1n],[100n,-1n],[9007199254740992n,0n]])expect(()=>balance(g!,c!)).toThrow();
  expect(()=>collect(50000n,0n,50001)).toThrow('PAYMENT_OVER_COLLECTION');
  for(const v of [0,-1,0.1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1])expect(()=>collect(50000n,0n,v)).toThrow();
 });
 it('supports partial/full linked reversals with an exact remaining ceiling',()=>{
  expect(reverse(50000n,50000n,50000n,0n,20000)).toMatchObject({collected_paise:30000,outstanding_paise:20000});
  expect(reverse(50000n,30000n,50000n,20000n,30000).state).toBe('uncollected');
  for(const v of [30001,50001])expect(()=>reverse(50000n,30000n,50000n,20000n,v)).toThrow('PAYMENT_REVERSAL_EXCEEDED');
  for(const v of [0,-1,1.1])expect(()=>reverse(50000n,50000n,50000n,0n,v)).toThrow();
 });
});
describe('payment closed command contract',()=>{
 it('keeps method and context independent',()=>{
  for(const context of ['paid_counter','to_pay'])for(const method of ['cash','upi'])expect(collection({...input,context,method})).toMatchObject({context,method});
 });
 it.each([0,-1,0.1,'40000',Number.MAX_SAFE_INTEGER+1,Infinity,NaN,null,undefined])('rejects malformed money %#',amount=>expect(()=>collection({...input,amount_paise:amount})).toThrow());
 it.each([{currency:'USD'},{method:'card'},{context:'delivered'},{collection_reference:'note'},{collection_reference:reference.toUpperCase()},
  {settled:true},{paid:true},{paymentMode:'Paid'},{collected_paise:1},{outstanding_paise:0},{gross_paise:0},{organization_id:booking},{actor:'admin'},{reason:'customer phone'}])('rejects unsupported values and browser authority %#',extra=>expect(()=>collection({...input,...extra})).toThrow());
 it('requires a finite reason for corrections and rejects negative credits',()=>{
  expect(reversal({amount_paise:1,currency:'INR',reason_code:'incorrect_amount'})).toEqual({amount_paise:1,currency:'INR',reason_code:'incorrect_amount'});
  for(const extra of [{reason_code:'refund'},{reason_code:''},{reason:'narrative'},{amount_paise:-1},{currency:'USD'}])expect(()=>reversal({amount_paise:1,currency:'INR',reason_code:'incorrect_amount',...extra})).toThrow();
 });
 it('includes all financial intent fields and excludes property order',()=>{
  const hash=(body:unknown)=>fingerprint('payments.collect',booking,obligation,null,collection(body));
  expect(hash(Object.fromEntries(Object.entries(input).reverse()))).toBe(hash(input));
  for(const extra of [{amount_paise:39999},{context:'paid_counter'},{method:'upi'},{collection_reference:randomUUID()}])expect(hash({...input,...extra})).not.toBe(hash(input));
  expect(fingerprint('payments.collect',randomUUID(),obligation,null,input)).not.toBe(hash(input));
  expect(fingerprint('payments.collect',booking,randomUUID(),null,input)).not.toBe(hash(input));
  const r={amount_paise:100,currency:'INR' as const,reason_code:'incorrect_amount' as const};
  expect(fingerprint('payments.reverse',booking,obligation,reference,r)).not.toBe(fingerprint('payments.reverse',booking,obligation,randomUUID(),r));
  expect(fingerprint('payments.reverse',booking,obligation,reference,r)).not.toBe(fingerprint('payments.reverse',booking,obligation,reference,{...r,reason_code:'duplicate_recording'}));
 });
 it('refuses missing tenant context and forged capabilities before financial SQL',async()=>{
  expect(()=>selection({})).toThrow();
  await expect(projection({} as TenantAccess,{id:obligation,booking_id:booking,total_paise:'100'})).rejects.toMatchObject({code:'ACTION_FORBIDDEN'});
 });
 it.each(['org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only'] as Role[])('enforces W20/W21 and R11 for %s',role=>{
  const m={role,lifecycle:'active',franchiseIds:[booking]} as Membership;
  for(const action of ['payments.collect','payments.reverse'] as const)expect(paymentScope(action,[m],[booking])).toEqual(role==='franchise_admin'?[booking]:[]);
  expect(paymentScope('payments.read',[m],[booking])).toEqual(['org_admin','franchise_admin','accountant'].includes(role)?[booking]:[]);
 });
});
