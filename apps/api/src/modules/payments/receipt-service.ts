import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import type {MoneyReceiptResult,MoneyReceiptDetail,ReceiptAllocationInput} from '@shippingco/shared';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {withMoneyReceiptScope} from '../memberships/service.ts';
import {appendPayment} from '../audit/repository.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {selection,uuid,idempotencyKey} from '../pricing/validation.ts';
import {instant} from '../pricing/types.ts';
import * as validate from './receipt-validation.ts';
import * as receipts from './receipt-repository.ts';
import * as payments from './repository.ts';
import {allocate,releaseAllocation} from './allocation-rules.ts';
import type {MoneyReceiptScopes,MoneyReceiptCommand,MoneyReceiptRow} from './receipt-types.ts';
async function apply(s:MoneyReceiptScopes,p:MoneyReceiptCommand,receipt:Pick<MoneyReceiptRow,'customer_id'|'method'|'amount_paise'>,items:ReceiptAllocationInput[],allocated:number) {
 let net=BigInt(allocated);const time=instant(p.recorded_at);
 for(const item of items){
  await receipts.bookingCustomer(s.command,item.booking_id,receipt.customer_id);
  const o=await payments.obligation(s.payment,item.booking_id,true),before=await payments.projection(s.payment,o);
  if(before.version!==item.expected_payment_version||before.version===2147483647)throw new HttpError('VERSION_CONFLICT');
  net=BigInt(allocate(BigInt(receipt.amount_paise),net,BigInt(before.outstanding_paise),item.amount_paise).allocated_paise);
  const command=randomUUID(),entryId=randomUUID(),input={amount_paise:item.amount_paise,currency:'INR' as const,context:item.context,method:receipt.method,collection_reference:randomUUID()};
  await payments.reserve(s.payment,command,o,keyDigest(p.id+':'+item.booking_id),digest({parent:p.id,receipt:p.receipt_id,booking:item.booking_id,input}),input,null,time,p.id);
  const entry=await payments.append(s.payment,command,entryId,o,before.version+1,input,null,time),result={entry:payments.entryDto(entry),payment:await payments.projection(s.payment,o)};
  await receipts.appendAllocation(s.command,p,{id:randomUUID(),booking_id:item.booking_id,payment_entry_id:entryId,kind:'allocation',amount_paise:item.amount_paise,release_of:null},o.id);
  await appendPayment(s.audit!,item.booking_id,command,entryId);
  if(before.outstanding_paise>0&&result.payment.outstanding_paise===0)await payments.settled(s.events!,result,command,randomUUID(),time);
  await payments.finish(s.payment,command,result);
 }
}
function replay(previous:Awaited<ReturnType<typeof receipts.replay>>,intent:string):MoneyReceiptResult|undefined {
 if(!previous)return;
 if(previous.fingerprint!==intent)throw new HttpError('IDEMPOTENCY_CONFLICT');
 if(!previous.result)throw new HttpError('IDEMPOTENCY_IN_PROGRESS');return structuredClone(previous.result);
}
export function createMoneyReceiptService(database:DatabasePool,writesEnabled=true) {
 async function record(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string):Promise<MoneyReceiptResult> {
  const q=selection(query),input=validate.moneyReceipt(body),key=keyDigest(idempotencyKey(keyInput,headers)),intent=digest({operation:'money_receipts.record',input});
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.record',correlation,async s=>{
   await receipts.active(s.command);await receipts.customer(s.command,input.customer_id);
   const previous=replay(await receipts.replay(s.command,key),intent);if(previous)return previous;
   if(!writesEnabled)throw new HttpError('MONEY_RECEIPTS_DISABLED');
   const account=await receipts.account(s.command,input.account_id);
   if(account.version!==input.expected_account_version||!account.active||!account.methods.includes(input.method))throw new HttpError('VERSION_CONFLICT');
   await receipts.receiver(s.command,input.receiver_id);
   if(input.custodian_id!==input.receiver_id)throw new FieldValidationError('custodian_id','INVALID_FORMAT');
   const p=await receipts.reserve(s.command,randomUUID(),randomUUID(),1,key,intent,input);
   if(Date.parse(input.occurred_at)>p.recorded_at.getTime())throw new FieldValidationError('occurred_at','OUT_OF_RANGE');
   await receipts.appendReceipt(s.command,p,account.id,input);
   await apply(s,p,{customer_id:input.customer_id,method:input.method,amount_paise:String(input.amount_paise)},input.allocations,0);
   return receipts.finish(s.command,p);
  });
 }
 async function allocateReceipt(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string):Promise<MoneyReceiptResult> {
  const q=selection(query),id=uuid(idInput,'receipt_id'),input=validate.allocateReceipt(body),key=keyDigest(idempotencyKey(keyInput,headers)),intent=digest({operation:'money_receipts.allocate',receipt_id:id,input});
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.allocate',correlation,async s=>{
   await receipts.active(s.command);const source=await receipts.receipt(s.command,id,true);
   const previous=replay(await receipts.replay(s.command,key),intent);if(previous)return previous;
   if(!writesEnabled)throw new HttpError('MONEY_RECEIPTS_DISABLED');
   const balance=await receipts.current(s.command,id);if(balance.version!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
   const p=await receipts.reserve(s.command,randomUUID(),id,input.expected_version+1,key,intent,input);
   await apply(s,p,source,input.allocations,balance.allocated_paise);return receipts.finish(s.command,p);
  });
 }
 async function correct(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string):Promise<MoneyReceiptResult> {
  const q=selection(query),id=uuid(idInput,'receipt_id'),input=validate.correctAllocation(body),key=keyDigest(idempotencyKey(keyInput,headers)),intent=digest({operation:'money_receipts.correct',receipt_id:id,input});
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.correct',correlation,async s=>{
   await receipts.active(s.command);const source=await receipts.receipt(s.command,id,true),target=await receipts.allocation(s.command,id,input.allocation_id);
   const previous=replay(await receipts.replay(s.command,key),intent);if(previous)return previous;
   if(!writesEnabled)throw new HttpError('MONEY_RECEIPTS_DISABLED');
   const balance=await receipts.current(s.command,id);if(balance.version!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
   releaseAllocation(BigInt(source.amount_paise),BigInt(balance.allocated_paise),BigInt(target.amount_paise),BigInt(target.released),input.amount_paise);
   await receipts.bookingCustomer(s.command,target.booking_id,source.customer_id);
   const o=await payments.obligation(s.payment,target.booking_id,true),before=await payments.projection(s.payment,o),original=await payments.entry(s.payment,o,target.payment_entry_id);
   if(before.version===2147483647)throw new HttpError('VERSION_CONFLICT');
   if(before.collected_paise<input.amount_paise)throw new HttpError('ALLOCATION_CONFLICT');
   const p=await receipts.reserve(s.command,randomUUID(),id,input.expected_version+1,key,intent,input),time=instant(p.recorded_at),command=randomUUID(),entryId=randomUUID();
   const leaf={amount_paise:input.amount_paise,currency:'INR' as const,reason_code:input.reason_code};
   await payments.reserve(s.payment,command,o,keyDigest(p.id+':'+target.booking_id),digest({parent:p.id,receipt:id,target:target.id,input:leaf}),leaf,original.id,time,p.id);
   const entry=await payments.append(s.payment,command,entryId,o,before.version+1,leaf,original,time);
   await receipts.appendAllocation(s.command,p,{id:randomUUID(),booking_id:target.booking_id,payment_entry_id:entryId,kind:'release',amount_paise:input.amount_paise,release_of:target.id},o.id);
   await appendPayment(s.audit!,target.booking_id,command,entryId);await payments.finish(s.payment,command,{entry:payments.entryDto(entry),payment:await payments.projection(s.payment,o)});
   return receipts.finish(s.command,p);
  });
 }
 async function read(token:string,idInput:unknown,query:unknown,correlation:string):Promise<MoneyReceiptDetail> {
  const q=selection(query),id=uuid(idInput,'receipt_id');
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.read',correlation,async s=>({receipt:receipts.evidence(await receipts.receipt(s.command,id)),balance:await receipts.current(s.command,id)}));
 }
 async function summary(token:string,idInput:unknown,query:unknown,correlation:string):Promise<MoneyReceiptResult> {
  const q=selection(query),id=uuid(idInput,'receipt_id');
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.select',correlation,async s=>{await receipts.receipt(s.command,id);return receipts.current(s.command,id);});
 }
 async function list(token:string,query:unknown,correlation:string) {
  const q=validate.receiptPage(query,true);
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.select',correlation,async s=>{
   await receipts.customer(s.command,q.customerId!);const rows=await receipts.customerReceiptIds(s.command,q.customerId!,q.cursor,q.limit+1),items:MoneyReceiptResult[]=[];
   for(const row of rows.slice(0,q.limit))items.push(await receipts.current(s.command,row.id));
   return {items,next_cursor:rows.length>q.limit?rows[q.limit-1]!.id:null};
  });
 }
 async function bills(token:string,query:unknown,correlation:string) {
  const q=validate.receiptPage(query,true);
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.select',correlation,async s=>{
   await receipts.customer(s.command,q.customerId!);const rows=await receipts.customerBookingIds(s.command,q.customerId!,q.cursor,q.limit+1),items: {booking_id:string;currency:'INR';gross_paise:number;outstanding_paise:number;expected_payment_version:number}[]=[];
   for(const row of rows.slice(0,q.limit)){
    const projection=await payments.projection(s.payment,await payments.obligation(s.payment,row.id));
    items.push({booking_id:row.id,currency:'INR',gross_paise:projection.gross_paise,outstanding_paise:projection.outstanding_paise,expected_payment_version:projection.version});
   }
   return {items,next_cursor:rows.length>q.limit?rows[q.limit-1]!.id:null};
  });
 }
 async function history(token:string,idInput:unknown,query:unknown,correlation:string) {
  const q=validate.receiptPage(query),id=uuid(idInput,'receipt_id');
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.select',correlation,async s=>{
   await receipts.receipt(s.command,id);const rows=await receipts.history(s.command,id,q.cursor,q.limit+1);
   return {items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit?rows[q.limit-1]!.id:null};
  });
 }
 async function receivers(token:string,query:unknown,correlation:string) {
  const q=validate.receiptPage(query);
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.select',correlation,async s=>{
   const rows=await receipts.receivers(s.command,q.cursor,q.limit+1);
   return {items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit?rows[q.limit-1]!.id:null};
  });
 }
 return {record,allocate:allocateReceipt,correct,read,summary,list,bills,history,receivers};
}
