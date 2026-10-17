import type {CustomerAccountInput,AccountRateInput} from '@shippingco/shared';
import type {ScopedApi} from './scoped-api';
import {object,uuid,text,integer,instant,choice,nullable,optional,array} from './dto';
const rateRule=object({destination_key:text,service:choice('standard','express','same_city'),min_weight_grams:integer(1),max_weight_grams:nullable(integer(1)),freight_paise:integer(),packing_paise:integer()});
export const customerAccountDto=object({id:uuid,revision_id:uuid,version:integer(1),debtor_customer_id:uuid,name:text,shipping_customer_ids:array(uuid),billing_contact:object({name:text,phone:text,authorization_ref:text}),closing_day:integer(1),due_days:integer(),credit_limit_paise:integer(),state:choice('active','held'),recorded_at:instant});
export const accountRateDto=object({id:uuid,account_id:uuid,version:integer(1),effective_from:instant,effective_to:instant,approval_ref:text,rules:array(rateRule),recorded_at:instant});
export const creditDto=object({outstanding_paise:text,available_paise:text,overdue_paise:text,credit_limit_paise:integer(),state:choice('active','held'),as_of:instant});
const choiceDto=object({id:uuid,name:text,version:integer(1),state:choice('active','held')});
const approval=object({id:uuid,expires_at:instant});
const page=<T,>(decode:(value:unknown)=>T)=>object({items:array(decode),next_cursor:nullable(text)});
export const accountPricingDto=optional(object({id:uuid,revision_id:uuid,version:integer(1),rate_source:choice('account','normal'),rate_revision_id:nullable(uuid),rule_index:nullable(integer())}));
export function customerAccounts(api:ScopedApi){
 const query=(cursor?:string)=>cursor?'&cursor='+encodeURIComponent(cursor):'';
 return {
  list:(cursor?:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-accounts')+query(cursor),page(customerAccountDto),signal),
  choices:(customer:string,cursor?:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-account-choices')+'&customer_id='+uuid(customer)+query(cursor),page(choiceDto),signal),
  sources:(id:string,cutoff:string,cursor?:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-accounts/'+uuid(id)+'/credit-sources')+'&as_of='+encodeURIComponent(instant(cutoff))+query(cursor),page(object({booking_id:uuid,due_date:text,gross_paise:text,reduction_paise:text,collected_paise:text,refund_paise:text,outstanding_paise:text})),signal),
  credit:(id:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-accounts/'+uuid(id)+'/credit'),creditDto,signal),
  rates:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-accounts/'+uuid(id)+'/rates')+query(cursor),page(accountRateDto),signal),
  history:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-accounts/'+uuid(id)+'/history')+query(cursor),page(value=>({...customerAccountDto(value),...object({reason:text,attested_by:uuid})(value)})),signal),
  configure:(id:string|null,body:CustomerAccountInput)=>api.intent('api.v1.customer_accounts.configure',api.path('/api/v1/customer-accounts'+(id?'/'+uuid(id)+'/revisions':'')),body),
  rate:(id:string,body:AccountRateInput)=>api.intent('api.v1.customer_accounts.rates',api.path('/api/v1/customer-accounts/'+uuid(id)+'/rates'),body),
  executeAccount:(intent:Parameters<ScopedApi['execute']>[0])=>api.execute(intent,customerAccountDto,['name','billing_contact','closing_day','due_days','credit_limit_paise','state','expected_version','shipping_customer_ids','reason']),
  executeRate:(intent:Parameters<ScopedApi['execute']>[0])=>api.execute(intent,accountRateDto,['rules','effective_from','effective_to','approval_ref','expected_version']),
  request:(body:unknown)=>api.intent('api.v1.customer_accounts.request',api.path('/api/v1/customer-credit-requests'),body),
  executeRequest:(intent:Parameters<ScopedApi['execute']>[0])=>api.execute(intent,object({id:uuid})),
  requestStatus:(id:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-credit-requests/'+uuid(id)),object({id:uuid,approval_id:nullable(uuid),expires_at:nullable(instant),reason:nullable(text)}),signal),
  review:(id:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-credit-requests/'+uuid(id)+'/review'),object({id:uuid,account:customerAccountDto,credit:creditDto,customer_id:uuid,customer_version:integer(1),parcels:array(object({recipient_name:text,weight_grams:integer(1),docket:nullable(text)})),destination_key:text,service:text,quote_id:uuid,tax_calculation_id:uuid,approval_id:nullable(uuid)}),signal),
  pending:(cursor?:string,signal?:AbortSignal)=>api.read(api.path('/api/v1/customer-credit-requests')+query(cursor),page(object({id:uuid,account_id:uuid,name:text,operator_id:uuid,total_paise:integer(),expires_at:instant})),signal),
  approve:(id:string,reason:string)=>api.intent('api.v1.customer_accounts.approve',api.path('/api/v1/customer-credit-requests/'+uuid(id)+'/approval'),{reason}),
  executeApproval:(intent:Parameters<ScopedApi['execute']>[0])=>api.execute(intent,approval,['reason']),
 };
}
