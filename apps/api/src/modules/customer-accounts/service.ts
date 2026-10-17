import {creditSources} from './sources.ts';
import type {DatabasePool} from '@shippingco/db';
import {DatabaseError} from '@shippingco/db';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {withCustomerAccountScope} from '../memberships/service.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {selection,uuid,idempotencyKey,object,timestamp} from '../pricing/validation.ts';
import {receiptPage} from '../payments/receipt-validation.ts';
import {accountInput,rateInput,text} from './validation.ts';
import {create as bookingInput} from '../bookings/validation.ts';
import {approve,exposure,creditTime} from './credit.ts';
import * as r from './repository.ts';
import * as requests from './requests.ts';
export function createCustomerAccountService(database:DatabasePool,writesEnabled=false,clock?:()=>Date) {
 return {
  async requestCredit(token:string,query:unknown,keyInput:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const q=selection(query),body=bookingInput(value),key=keyDigest(idempotencyKey(keyInput,headers));
   if(body.credit_approval_id)throw new FieldValidationError('credit_approval_id','UNKNOWN_FIELD');
   return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.request',correlation,async scope=>{
    await r.active(scope);return requests.request(scope,body,key,writesEnabled,clock?.());
   });
  },
  async creditRequest(token:string,idInput:unknown,query:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput);return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.request',correlation,async scope=>{
    const row=await requests.readRequest(scope,id);return {id:row.id,approval_id:row.approval_id,expires_at:row.expires_at?.toISOString()??null,reason:row.reason};
   });
  },
  async reviewCredit(token:string,idInput:unknown,query:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput);return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.approve',correlation,async scope=>{
    const request=await requests.readRequest(scope,id),body=requests.requestBooking(request),a=await r.account(scope,request.account_id);
    return {id,account:r.accountDto(a),credit:await exposure(scope,a,await creditTime(scope,clock),true),customer_id:body.customer_id,customer_version:body.expected_customer_version,
     parcels:body.parcels.map(p=>({recipient_name:p.recipient.name,weight_grams:p.weight_grams,docket:p.docket??null})),destination_key:body.tax_intent.pricing_input.destination_key,service:body.tax_intent.pricing_input.service,
     quote_id:body.tax_intent.quote_id,tax_calculation_id:body.tax_calculation_id,approval_id:request.approval_id};
   });
  },
  async pendingCredit(token:string,query:unknown,correlation:string) {
   const q=receiptPage(query);return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.approve',correlation,async scope=>{
    const rows=await requests.pending(scope,q.cursor,q.limit+1);return {items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit?rows[q.limit-1]!.id:null};
   });
  },
  async approveRequest(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput),b=object(value,['reason']),reason=text(b.reason,'reason',256,3),key=keyDigest(idempotencyKey(keyInput,headers));
   return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.approve',correlation,async scope=>{
    await r.active(scope);const row=await requests.readRequest(scope,id);
    return approve(scope,row.operator_id,requests.requestBooking(row),reason,key,digest({request_id:id,reason}),id,writesEnabled,clock?.());
   });
  },
  async choices(token:string,query:unknown,correlation:string) {
   const q=receiptPage(query,true);return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.select',correlation,async scope=>{
    const rows=await r.choices(scope,q.customerId!,q.cursor,q.limit+1);return {items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit?rows[q.limit-1]!.id:null};
   });
  },
  async history(token:string,idInput:unknown,query:unknown,correlation:string,rate=false) {
   const b=object(query,['organization_id','franchise_id','cursor']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'account_id');
   if(b.cursor!==undefined&&(typeof b.cursor!=='string'||!/^\d{1,10}$/.test(b.cursor)||Number(b.cursor)>2147483646))throw new FieldValidationError('cursor','INVALID_FORMAT');
   const cursor=Number(b.cursor??0);
   return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.read',correlation,async scope=>{
    await r.account(scope,id);
    if(rate){const rows=await r.rates(scope,id,cursor,51);return {items:rows.slice(0,50).map(r.rateDto),next_cursor:rows.length>50?String(rows[49]!.version):null};}
    const rows=await r.history(scope,id,cursor,51);return {items:rows.slice(0,50).map(row=>({...r.accountDto(row),reason:row.reason,attested_by:row.actor_id})),next_cursor:rows.length>50?String(rows[49]!.version):null};
   });
  },
  async sources(token:string,idInput:unknown,query:unknown,correlation:string) {
   const b=object(query,['organization_id','franchise_id','cursor','limit','as_of']),{as_of,...page}=b,q=receiptPage(page),id=uuid(idInput,'account_id');
   if(typeof as_of!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(as_of))throw new FieldValidationError('as_of','INVALID_FORMAT');
   timestamp(as_of.replace(/(\.\d{3})\d+Z$/,'$1Z'),'as_of');
   const cutoff=as_of.replace(/\.(\d+)Z$/,(_,fraction:string)=>'.'+fraction.padEnd(6,'0')+'Z');
   return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.select',correlation,async scope=>{
    if(cutoff>await creditTime(scope,clock))throw new FieldValidationError('as_of','OUT_OF_RANGE');
    await r.account(scope,id);const rows=await creditSources(scope,id,cutoff,q.cursor,q.limit+1);
    return {items:rows.slice(0,q.limit),next_cursor:rows.length>q.limit?rows[q.limit-1]!.booking_id:null};
   });
  },
  async credit(token:string,idInput:unknown,query:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'account_id');return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.select',correlation,async scope=>exposure(scope,await r.account(scope,id),await creditTime(scope,clock),true));
  },
  async approve(token:string,query:unknown,keyInput:unknown,headers:readonly string[],value:unknown,correlation:string) {
   const q=selection(query),b=object(value,['operator_id','booking','reason']),operator=uuid(b.operator_id,'operator_id'),booking=bookingInput(b.booking),reason=text(b.reason,'reason',256,3),key=keyDigest(idempotencyKey(keyInput,headers));
   if(booking.credit_approval_id)throw new FieldValidationError('credit_approval_id','UNKNOWN_FIELD');
   return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.approve',correlation,async scope=>{
    await r.active(scope);
    return approve(scope,operator,booking,reason,key,digest({operator,booking,reason}),null,writesEnabled,clock?.());
   });
  },
  async configure(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=idInput===null?null:uuid(idInput,'account_id'),input=accountInput(body),key=keyDigest(idempotencyKey(keyInput,headers));
   if((id===null)!==(input.expected_version===0))throw new FieldValidationError('expected_version','OUT_OF_RANGE');
   const intent=digest({operation:'customer_accounts.configure',id,input});
   return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.configure',correlation,async scope=>{
    await r.active(scope);const before=id?await r.account(scope,id,true):null;
    const replay=await r.replayAccount(scope,key);if(replay){if(replay.fingerprint!==intent)throw new HttpError('IDEMPOTENCY_CONFLICT');return r.accountDto(replay);}
    if(!writesEnabled)throw new HttpError('CUSTOMER_ACCOUNTS_DISABLED');
    if(before&&(before.version!==input.expected_version||before.debtor_customer_id!==input.debtor_customer_id))throw new HttpError('VERSION_CONFLICT');
    await r.customers(scope,[input.debtor_customer_id,...input.shipping_customer_ids]);
    try{return await r.configure(scope,id,input,key,intent);}catch(error){if(error instanceof DatabaseError&&error.sqlState==='23505')throw new HttpError('VERSION_CONFLICT');throw error;}
   });
  },
  async publishRate(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'account_id'),input=rateInput(body),key=keyDigest(idempotencyKey(keyInput,headers)),intent=digest({operation:'customer_accounts.rates',id,input});
   return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.rates',correlation,async scope=>{
    await r.active(scope);await r.account(scope,id,true);
    const replay=await r.replayRate(scope,key);if(replay){if(replay.fingerprint!==intent)throw new HttpError('IDEMPOTENCY_CONFLICT');return r.rateDto(replay);}
    if(!writesEnabled)throw new HttpError('CUSTOMER_ACCOUNTS_DISABLED');
    if(await r.rateVersion(scope,id)!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
    try{return await r.appendRate(scope,id,input,key,intent);}catch(error){if(error instanceof DatabaseError&&error.sqlState==='23514')throw new HttpError('RATE_CONFLICT');throw error;}
   });
  },
  async list(token:string,query:unknown,correlation:string) {
   const q=receiptPage(query);return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.read',correlation,async scope=>{
    const rows=await r.page(scope,q.cursor,q.limit+1);return {items:rows.slice(0,q.limit).map(r.accountDto),next_cursor:rows.length>q.limit?rows[q.limit-1]!.account_id:null};
   });
  },
  async read(token:string,idInput:unknown,query:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'account_id');return withCustomerAccountScope(database,token,q.organizationId,q.franchiseId,'customer_accounts.read',correlation,async scope=>r.accountDto(await r.account(scope,id)));
  }
 };
}
