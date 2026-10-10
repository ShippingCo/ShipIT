import { FieldValidationError, type ValidationField } from '../../plugins/errors.ts';
import { object, integer, uuid, timestamp, selection } from '../pricing/validation.ts';
import type { ReceiptMethod, ReceivingAccountInput, MoneyReceiptInput, ReceiptAllocationInput, AllocateReceiptInput, CorrectAllocationInput } from '@shippingco/shared';
const methods:readonly ReceiptMethod[]=['bank_transfer','card','cash','other','upi'];
function method(value:unknown):ReceiptMethod {
  if(typeof value!=='string'||!methods.includes(value as ReceiptMethod))throw new FieldValidationError('method','INVALID_FORMAT');
  return value as ReceiptMethod;
}
function text(value:unknown,field:ValidationField,max:number):string {
  if(value===undefined)throw new FieldValidationError(field,'REQUIRED');
  if(typeof value!=='string')throw new FieldValidationError(field,'INVALID_TYPE');
  if(value.length>max*4+100)throw new FieldValidationError(field,'OUT_OF_RANGE');
  if([...value].some(c=>{const n=c.codePointAt(0)!;return n<32||(n>=127&&n<=159)||(n>=0xd800&&n<=0xdfff);}))throw new FieldValidationError(field,'INVALID_FORMAT');
  const result=value.trim();
  if(!result||[...result].length>max)throw new FieldValidationError(field,'OUT_OF_RANGE');
  return result;
}
function nullableText(value:unknown,field:ValidationField,max:number):string|null {return value===null?null:text(value,field,max);}
export function receivingAccount(value:unknown):ReceivingAccountInput {
  const b=object(value,['name','methods','other_method_name','active','expected_version']);
  if(!Array.isArray(b.methods)||b.methods.length<1||b.methods.length>4)throw new FieldValidationError('methods','OUT_OF_RANGE');
  const selected=b.methods.map(method).sort();
  if(new Set(selected).size!==selected.length||(selected.includes('cash')&&selected.length!==1))throw new FieldValidationError('methods','INVALID_FORMAT');
  const other=nullableText(b.other_method_name,'other_method_name',60);
  if(selected.includes('other')!==(other!==null))throw new FieldValidationError('other_method_name','INVALID_FORMAT');
  if(typeof b.active!=='boolean')throw new FieldValidationError('active','INVALID_TYPE');
  return {name:text(b.name,'name',120),methods:selected,other_method_name:other,active:b.active,expected_version:integer(b.expected_version,'expected_version',0,2147483646)};
}
function allocations(value:unknown,empty:boolean):ReceiptAllocationInput[] {
  if(!Array.isArray(value)||value.length>50||(!empty&&value.length===0))throw new FieldValidationError('allocations','OUT_OF_RANGE');
  const seen=new Set<string>();let sum=0n;
  return value.map((item):ReceiptAllocationInput=>{
    const b=object(item,['booking_id','amount_paise','context','expected_payment_version']);
    const booking=uuid(b.booking_id,'booking_id'),amount=integer(b.amount_paise,'amount_paise',1);
    if(seen.has(booking))throw new FieldValidationError('allocations','INVALID_FORMAT');seen.add(booking);
    sum+=BigInt(amount);if(sum>BigInt(Number.MAX_SAFE_INTEGER))throw new FieldValidationError('allocations','OUT_OF_RANGE');
    if(b.context!=='paid_counter'&&b.context!=='to_pay')throw new FieldValidationError('context','INVALID_FORMAT');
    return {booking_id:booking,amount_paise:amount,context:b.context,expected_payment_version:integer(b.expected_payment_version,'expected_payment_version',0,2147483646)};
  }).sort((a,b)=>a.booking_id.localeCompare(b.booking_id));
}
export function moneyReceipt(value:unknown):MoneyReceiptInput {
  const b=object(value,['customer_id','account_id','expected_account_version','method','amount_paise','currency','receiver_id','custodian_id','occurred_at','external_reference','allocations']);
  if(b.currency!=='INR')throw new FieldValidationError('currency','INVALID_FORMAT');
  const amount=integer(b.amount_paise,'amount_paise',1),applications=allocations(b.allocations,true);
  if(applications.reduce((sum,a)=>sum+BigInt(a.amount_paise),0n)>BigInt(amount))throw new FieldValidationError('allocations','OUT_OF_RANGE');
  return {customer_id:uuid(b.customer_id,'customer_id'),account_id:uuid(b.account_id,'account_id'),expected_account_version:integer(b.expected_account_version,'expected_account_version',1,2147483647),
    method:method(b.method),amount_paise:amount,currency:'INR',receiver_id:uuid(b.receiver_id,'receiver_id'),custodian_id:uuid(b.custodian_id,'custodian_id'),
    occurred_at:timestamp(b.occurred_at,'occurred_at'),external_reference:nullableText(b.external_reference,'external_reference',128),allocations:applications};
}
export function allocateReceipt(value:unknown):AllocateReceiptInput {
  const b=object(value,['expected_version','allocations']);
  return {expected_version:integer(b.expected_version,'expected_version',1,2147483646),allocations:allocations(b.allocations,false)};
}
export function correctAllocation(value:unknown):CorrectAllocationInput {
  const b=object(value,['expected_version','allocation_id','amount_paise','currency','reason_code']);
  if(b.currency!=='INR')throw new FieldValidationError('currency','INVALID_FORMAT');
  if(typeof b.reason_code!=='string'||!['duplicate_recording','incorrect_amount','collection_not_received'].includes(b.reason_code))throw new FieldValidationError('reason_code','INVALID_FORMAT');
  return {expected_version:integer(b.expected_version,'expected_version',1,2147483646),allocation_id:uuid(b.allocation_id,'allocation_id'),amount_paise:integer(b.amount_paise,'amount_paise',1),currency:'INR',reason_code:b.reason_code as CorrectAllocationInput['reason_code']};
}

/** UUID keyset cursors contain no evidence and cannot widen current owner/customer scope. */
export function receiptPage(value:unknown,customer=false) {
 const b=object(value,['organization_id','franchise_id','limit','cursor',...(customer?['customer_id']:[])]);
 const q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id});
 if(b.limit!==undefined&&(typeof b.limit!=='string'||!/^([1-9][0-9]?|100)$/.test(b.limit)))throw new FieldValidationError('limit','OUT_OF_RANGE');
 return {...q,limit:b.limit===undefined?50:Number(b.limit),cursor:b.cursor===undefined?null:uuid(b.cursor,'cursor'),customerId:customer?uuid(b.customer_id,'customer_id'):null};
}
