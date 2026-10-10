import { describe,it,expect } from 'vitest';
import { receivingAccount,moneyReceipt,allocateReceipt,correctAllocation } from '../../src/modules/payments/receipt-validation.ts';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const item={booking_id:id,amount_paise:40000,context:'to_pay',expected_payment_version:0};
const receipt={customer_id:id,account_id:other,expected_account_version:1,method:'upi',amount_paise:100000,currency:'INR',receiver_id:id,custodian_id:id,
 occurred_at:'2026-10-10T14:30:00+05:30',external_reference:'SYNTHETIC-UPI-REF',allocations:[item,{...item,booking_id:other,amount_paise:50000}]};
describe('receipt command boundaries',()=>{
 it('normalizes explicit receiving methods and requires a name for configured other methods',()=>{
  expect(receivingAccount({name:' Bank clearing ',methods:['upi','card','bank_transfer','other'],other_method_name:' Cheque ',active:true,expected_version:0}))
   .toEqual({name:'Bank clearing',methods:['bank_transfer','card','other','upi'],other_method_name:'Cheque',active:true,expected_version:0});
  const cash={name:'Front counter',methods:['cash'],other_method_name:null,active:true,expected_version:0};
  expect(receivingAccount(cash).methods).toEqual(['cash']);
  for(const patch of [{methods:['cash','upi']},{methods:['upi','upi']},{methods:['other']},{other_method_name:'Cheque'},{methods:['credit']},{active:1},{expected_version:-1},{name:'Counter\nprivate'}])expect(()=>receivingAccount({...cash,...patch})).toThrow('VALIDATION_FAILED');
 });
 it('keeps external evidence separate from logical identity, validates timestamps and retains an advance',()=>{
  const result=moneyReceipt(receipt);expect(result.occurred_at).toBe('2026-10-10T09:00:00Z');
  expect(result.allocations.reduce((sum,a)=>sum+a.amount_paise,0)).toBe(90000);
  expect(moneyReceipt({...receipt,external_reference:null,allocations:[]})).toMatchObject({external_reference:null,allocations:[]});
  for(const patch of [{collection_reference:id},{bank_verified:true},{pan:'4242424242424242'},{external_reference:'ref\nsecret'},{occurred_at:'2026-02-30T00:00:00Z'},{occurred_at:'2026-10-10T00:00:00'},{receiver_id:'someone'},{currency:'USD'},{amount_paise:89999}])expect(()=>moneyReceipt({...receipt,...patch})).toThrow('VALIDATION_FAILED');
 });
 it('canonicalizes multi-obligation intent and rejects duplicate, oversized or overflowing allocations',()=>{
  expect(moneyReceipt({...receipt,allocations:[...receipt.allocations].reverse()})).toEqual(moneyReceipt(receipt));
  const command={expected_version:1,allocations:[item]};expect(allocateReceipt(command).allocations).toHaveLength(1);
  for(const allocations of [[],[item,item],Array.from({length:51},(_,i)=>({...item,booking_id:i.toString().padStart(8,'0')+'-1111-4111-8111-111111111111'})),[{...item,amount_paise:Number.MAX_SAFE_INTEGER},{...item,booking_id:other,amount_paise:1}],[{...item,amount_paise:0}],[{...item,expected_payment_version:0.5}],[{...item,organization_id:id}]])expect(()=>allocateReceipt({...command,allocations})).toThrow('VALIDATION_FAILED');
 });
 it('requires exact linked correction identity and a permitted reason without approval mass assignment',()=>{
  const correction={expected_version:1,allocation_id:id,amount_paise:10000,currency:'INR',reason_code:'incorrect_amount'};
  expect(correctAllocation(correction)).toEqual(correction);
  for(const patch of [{amount_paise:0},{amount_paise:0.1},{expected_version:0},{reason_code:'refund'},{approved_by:id},{allocation_id:[] }])expect(()=>correctAllocation({...correction,...patch})).toThrow('VALIDATION_FAILED');
 });
});
