import {describe,it,expect} from 'vitest';
import {accountDueDate,accountInput,rateInput} from '../../src/modules/customer-accounts/validation.ts';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const profile={expected_version:0,debtor_customer_id:id,shipping_customer_ids:[other,id],name:'Synthetic account',billing_contact:{name:'Billing contact',phone:'+12025550100',authorization_ref:'OWNER_ATTESTED'},closing_day:31,due_days:10,credit_limit_paise:100000,state:'active',reason:'Approved terms'};
describe('explicit account terms and negotiated rate boundaries',()=>{
 it('clamps inclusive month closing and uses Asia/Kolkata at midnight and leap years',()=>{
  for(const [at,closing,days,wanted] of [['2028-02-29T18:29:59Z',31,0,'2028-02-29'],['2028-02-29T18:30:00Z',1,0,'2028-03-01'],['2027-02-28T18:29:59Z',31,10,'2027-03-10'],['2026-12-31T18:30:00Z',31,0,'2027-01-31'],['2026-10-15T18:30:00Z',15,0,'2026-11-15']] as const)expect(accountDueDate(new Date(at),closing,days)).toBe(wanted);
 });
 it('requires explicit identities and attestation, rejects ownership/approval mass assignment',()=>{
  expect(accountInput(profile).shipping_customer_ids).toEqual([id,other]);
  for(const patch of [{organization_id:id},{approved:true},{credit_limit_paise:0.5},{credit_limit_paise:Number.MAX_SAFE_INTEGER+1},{closing_day:0},{closing_day:32},{due_days:-1},{due_days:367},{state:'verified'},{shipping_customer_ids:[id,id]},{shipping_customer_ids:[]},{billing_contact:{...profile.billing_contact,authorization_ref:''}},{reason:'\nsecret'},{name:'Private\u0001account'}])expect(()=>accountInput({...profile,...patch})).toThrow('VALIDATION_FAILED');
  expect(accountInput({...profile,credit_limit_paise:0,debtor_customer_id:other}).debtor_customer_id).toBe(other);
 });
 it('rejects ambiguous overlapping rules, fractional money and invalid effective intervals',()=>{
  const rule={destination_key:'SYN',service:'standard',min_weight_grams:1,max_weight_grams:1000,freight_paise:12000,packing_paise:0},rate={expected_version:0,effective_from:'2028-01-01T00:00:00Z',effective_to:'2028-02-01T00:00:00Z',approval_ref:'SYN',rules:[rule]};
  expect(rateInput(rate).rules[0]!.freight_paise).toBe(12000);
  for(const patch of [{rules:[rule,rule]},{rules:[{...rule,freight_paise:1.5}]},{effective_to:rate.effective_from},{effective_from:'2028-02-30T00:00:00Z'},{effective_from:'2028-01-01T00:00:00'},{rules:[]}])expect(()=>rateInput({...rate,...patch})).toThrow();
 });
});
