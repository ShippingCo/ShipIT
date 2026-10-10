import type {ReceivingAccountDto,ReceivingAccountInput,MoneyReceiptResult,MoneyReceiptDetail,MoneyReceiptInput,AllocateReceiptInput,CorrectAllocationInput} from '@shippingco/shared';
import {object,uuid,text,integer,instant,choice,array,nullable,protocol} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const method=choice('cash','upi','card','bank_transfer','other');
const account=object({id:uuid,revision_id:uuid,version:integer(1),name:text,methods:array(method,4),other_method_name:nullable(text),active:choice(true,false),recorded_at:instant});
export function receivingAccountDto(value:unknown):ReceivingAccountDto {
 const result=account(value);
 if(!result.methods.length||new Set(result.methods).size!==result.methods.length||(result.methods.includes('cash')&&result.methods.length!==1)||result.methods.includes('other')!==(result.other_method_name!==null))return protocol();return result;
}
const allocation=object({id:uuid,booking_id:uuid,payment_entry_id:uuid,kind:choice('allocation','release'),amount_paise:integer(1),release_of:nullable(uuid)});
const balance=object({receipt_id:uuid,customer_id:uuid,version:integer(1),currency:choice('INR'),received_paise:integer(1),allocated_paise:integer(),unallocated_paise:integer(),allocations:array(allocation,50)});
export function moneyReceiptResult(value:unknown):MoneyReceiptResult {
 const result=balance(value);
 if(BigInt(result.allocated_paise)+BigInt(result.unallocated_paise)!==BigInt(result.received_paise))return protocol();
 const ids=new Set<string>(),bookings=new Set<string>();
 for(const a of result.allocations){if(ids.has(a.id)||bookings.has(a.booking_id)||(a.kind==='allocation')!==(a.release_of===null))return protocol();ids.add(a.id);bookings.add(a.booking_id);}
 return result;
}
const receiptEvidence=object({id:uuid,customer_id:uuid,account_id:uuid,account_revision_id:uuid,method,received_paise:integer(1),currency:choice('INR'),receiver_id:uuid,initial_custodian_id:uuid,occurred_at:instant,recorded_at:instant,external_reference:nullable(text),verification:choice('manually_recorded_unverified')});
const historyEntry=object({id:uuid,booking_id:uuid,payment_entry_id:uuid,kind:choice('allocation','release'),amount_paise:integer(1),release_of:nullable(uuid),version:integer(1),recorded_at:instant,released_paise:integer()});
const historyPage=object({items:array(historyEntry),next_cursor:nullable(uuid)}),receiverPage=object({items:array(object({id:uuid,label:text})),next_cursor:nullable(uuid)});
const resultPage=object({items:array(moneyReceiptResult),next_cursor:nullable(uuid)}),accountPage=object({items:array(receivingAccountDto),next_cursor:nullable(uuid)});
const billPage=object({items:array(object({booking_id:uuid,currency:choice('INR'),gross_paise:integer(),outstanding_paise:integer(),expected_payment_version:integer()})),next_cursor:nullable(uuid)});
function query(cursor?:string,customer?:string){return (customer?'&customer_id='+uuid(customer):'')+(cursor?'&cursor='+uuid(cursor):'');}
export function moneyReceipts(api:ScopedApi) {
 const source=api.path('/api/v1/money-receipts');
 return {
  receivers:(cursor?:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/money-receipt-receivers')+query(cursor),receiverPage,signal),
  history:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(api.path(`/api/v1/money-receipts/${uuid(id)}/history`)+query(cursor),value=>{const result=historyPage(value);if(result.items.some(item=>item.released_paise>item.amount_paise||(item.kind==='allocation')!==(item.release_of===null)))return protocol();return result;},signal),
  record:(input:MoneyReceiptInput)=>api.intent('api.v1.money_receipts.record',source,input),
  allocate:(id:string,input:AllocateReceiptInput)=>api.intent('api.v1.money_receipts.allocate',api.path(`/api/v1/money-receipts/${uuid(id)}/allocations`),input,'POST',input.expected_version),
  correct:(id:string,input:CorrectAllocationInput)=>api.intent('api.v1.money_receipts.correct',api.path(`/api/v1/money-receipts/${uuid(id)}/allocation-corrections`),input,'POST',input.expected_version),
  execute:(intent:CommandIntent)=>api.execute(intent,value=>{
   const result=moneyReceiptResult(value),sent=JSON.parse(intent.bodyJson) as MoneyReceiptInput|AllocateReceiptInput|CorrectAllocationInput;
   if(intent.operation==='api.v1.money_receipts.record'){
    const input=sent as MoneyReceiptInput;
    if(result.version!==1||result.customer_id!==input.customer_id||result.received_paise!==input.amount_paise||BigInt(result.allocated_paise)!==input.allocations.reduce((sum,a)=>sum+BigInt(a.amount_paise),0n))return protocol();
   }else if(intent.operation==='api.v1.money_receipts.allocate'||intent.operation==='api.v1.money_receipts.correct'){
    if(result.version!==(sent as AllocateReceiptInput).expected_version+1||!intent.path.includes('/'+result.receipt_id+'/'))return protocol();
   }else return protocol();
   if(intent.operation==='api.v1.money_receipts.correct'){
    const input=sent as CorrectAllocationInput,a=result.allocations[0];if(result.allocations.length!==1||a?.kind!=='release'||a.amount_paise!==input.amount_paise||a.release_of!==input.allocation_id)return protocol();
   }else {
    const input=sent as MoneyReceiptInput|AllocateReceiptInput;if(result.allocations.length!==input.allocations.length||input.allocations.some(item=>!result.allocations.some(a=>a.kind==='allocation'&&a.booking_id===item.booking_id&&a.amount_paise===item.amount_paise)))return protocol();
   }
   return result;
  },['customer_id','account_id','expected_account_version','method','amount_paise','currency','receiver_id','custodian_id','occurred_at','external_reference','allocations','expected_version','allocation_id','reason_code']),
  balance:(id:string,signal?:AbortSignal)=>api.read(api.path(`/api/v1/money-receipts/${uuid(id)}/balance`),value=>{const result=moneyReceiptResult(value);if(result.receipt_id!==id)return protocol();return result;},signal),
  read:(id:string,signal?:AbortSignal)=>api.read(api.path(`/api/v1/money-receipts/${uuid(id)}`),(value:unknown)=>{
   const result:MoneyReceiptDetail=object({receipt:receiptEvidence,balance:moneyReceiptResult})(value);
   if(result.receipt.id!==id||result.balance.receipt_id!==id||result.receipt.customer_id!==result.balance.customer_id||result.receipt.received_paise!==result.balance.received_paise)return protocol();return result;
  },signal),
  list:(customer:string,cursor?:string,signal?:AbortSignal)=>api.read(source+query(cursor,customer),value=>{const result=resultPage(value);if(result.items.some(item=>item.customer_id!==customer))return protocol();return result;},signal),
  bills:(customer:string,cursor?:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/money-receipt-bills')+query(cursor,customer),billPage,signal),
 };
}
export function receivingAccounts(api:ScopedApi) {
 const source=api.path('/api/v1/receiving-accounts');
 return {
  list:(cursor?:string,signal?:AbortSignal)=>api.read(source+query(cursor),accountPage,signal),
  configure:(id:string|null,input:ReceivingAccountInput)=>api.intent('api.v1.receiving_accounts.configure',id?api.path(`/api/v1/receiving-accounts/${uuid(id)}/revisions`):source,input),
  execute:(intent:CommandIntent)=>api.execute(intent,value=>{const result=receivingAccountDto(value),sent=JSON.parse(intent.bodyJson) as ReceivingAccountInput;
   if((sent.expected_version>0&&!intent.path.includes('/'+result.id+'/revisions'))||intent.operation!=='api.v1.receiving_accounts.configure'||result.version!==sent.expected_version+1||result.name!==sent.name.trim()||result.active!==sent.active||result.other_method_name!==(sent.other_method_name?.trim()??null)||JSON.stringify([...result.methods].sort())!==JSON.stringify([...sent.methods].sort()))return protocol();return result;
  },['name','methods','other_method_name','active','expected_version']),
 };
}
