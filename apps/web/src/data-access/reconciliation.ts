import type {ScopedApi} from './scoped-api';
import {object,uuid,text,integer,instant,choice,nullable,optional,array,protocol} from './dto';
const direction=choice('credit','debit'),status=choice('recorded','verified','pending','different','unassigned');
const classification=choice('unassigned','customer_payment','advance','owner_funds','transfer','fee','other');
const amount=object({mode:choice('signed','credit_debit','direction'),unit:choice('rupees','paise'),amount_column:optional(text),positive_direction:optional(direction),credit_column:optional(text),debit_column:optional(text),direction_column:optional(text),credit_value:optional(text),debit_value:optional(text)});
const mapping=object({expected_version:integer(),name:text,identity_namespace:text,date_column:text,date_format:choice('yyyy-mm-dd','dd/mm/yyyy','dd-mm-yyyy'),amount,reference_column:nullable(text),identity_column:nullable(text),currency_column:nullable(text)});
const allocation=object({source_id:text,source_version:text,amount_paise:integer(1)});
const candidate=object({business_date:text,direction,amount_paise:integer(1),currency:choice('INR'),external_reference:nullable(text),external_id:nullable(text)});
const outcome=object({row_number:integer(2),version:integer(1),state:choice('imported','duplicate','needs_review','conflict','rejected'),transaction_id:nullable(uuid),reason:text});

const evidence=object({transaction_id:optional(uuid),external_id:optional(nullable(text)),identity_namespace:optional(text),import_id:optional(nullable(uuid)),row_number:optional(nullable(integer(2))),classification_version:optional(integer()),matches:optional(array(object({id:uuid,method:choice('exact','manual'),amount_paise:text,batch_id:optional(nullable(uuid)),is_fee:optional(choice(true,false)),source_version:optional(text),actor_id:optional(uuid),reviewed_at:optional(instant),reason:optional(text),sources:optional(array(object({source_id:text,source_version:text,amount_paise:text,is_fee:choice(true,false)}),200))}),200)),source_kind:optional(text),source_id:optional(nullable(text)),version:optional(value=>typeof value==='number'?integer()(value):text(value)),method:optional(nullable(text)),recorded_at:optional(text),batch_id:optional(uuid),expected_date:optional(text),receipts:optional(array(allocation)),fees:optional(array(allocation)),reason:optional(text),case_id:optional(uuid),state:optional(text),kind:optional(text),candidate:optional(nullable(candidate)),unknown_reason:optional(nullable(text)),account_scope:optional(text)});
export const reconciliationRow=object({id:text,kind:choice('transaction','source','batch','case','import_row','unknown_source'),resource_id:uuid,business_date:nullable(text),direction:nullable(direction),amount_paise:nullable(text),matched_paise:nullable(text),remaining_paise:nullable(text),status,classification:nullable(classification),external_reference:nullable(text),evidence});
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('manual_reconciliation_v1'),organization_id:uuid,franchise_id:uuid,timezone:choice('Asia/Kolkata'),filter:object({account_id:uuid,from_day:text,to_day:text}),as_of:instant,expires_at:instant,count:integer(),controls:array(object({kind:choice('transaction','source'),direction,count:integer(),amount_paise:text,matched_paise:text,remaining_paise:text})),status_counts:object({recorded:integer(),verified:integer(),pending:integer(),different:integer(),unassigned:integer()})});
const report=object({snapshot,rows:array(reconciliationRow,200),next_offset:nullable(integer())});
const result=object({id:optional(uuid),version:optional(integer()),case_id:optional(uuid),batch_id:optional(uuid),enabled:optional(choice(true,false)),outcomes:optional(array(outcome,200)),snapshot:optional(snapshot),headers:optional(array(text,16)),row_count:optional(integer())});
const page=<T,>(decode:(value:unknown)=>T)=>object({items:array(decode),next_cursor:nullable(text)});
export function reconciliation(api:ScopedApi) {
 const more=(cursor?:string)=>cursor?'&cursor='+encodeURIComponent(cursor):'';
 const path=(suffix:string)=>api.path('/api/v1/reconciliation/'+suffix);
 const account=(id:string)=>'&account_id='+uuid(id);
 return {
  config:(signal?:AbortSignal)=>api.read(path('config'),object({version:integer(),enabled:choice(true,false),writes_available:choice(true,false),recorded_at:nullable(instant)}),signal),
  accounts:(cursor?:string,signal?:AbortSignal)=>api.read(path('accounts')+more(cursor),page(object({id:uuid,name:text,active:choice(true,false),methods:array(text)})),signal),
  mappings:(cursor?:string,signal?:AbortSignal)=>api.read(path('mappings')+more(cursor),page(object({id:uuid,profile_id:uuid,version:integer(1),mapping,actor_id:uuid,recorded_at:instant})),signal),
  imports:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(path('imports')+account(id)+more(cursor),page(object({id:uuid,period_from:text,period_to:text,recorded_at:text,row_count:integer(),processed_count:integer(),review_count:integer()})),signal),
  import:(id:string,signal?:AbortSignal)=>api.read(path('imports/'+uuid(id)),object({id:uuid,account_id:uuid,account_revision_id:uuid,mapping_id:uuid,period_from:text,period_to:text,file_sha256:text,rows:array(object({row:integer(2),error:nullable(text),candidate:nullable(candidate)}),200),outcomes:array(outcome,200)}),signal),
  sources:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(path('sources')+account(id)+more(cursor),page(object({id:text,source_kind:text,source_id:uuid,version:text,account_id:uuid,direction,amount_paise:text,available_paise:text,currency:choice('INR'),method:nullable(text),external_reference:nullable(text),business_date:text,recorded_at:text})),signal),
  transactions:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(path('transactions')+account(id)+more(cursor),page(object({id:uuid,business_date:text,direction,amount_paise:text,available_paise:text,external_reference:nullable(text),external_id:nullable(text),classification,classification_version:integer()})),signal),
  batches:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(path('batches')+account(id)+more(cursor),page(object({id:uuid,batch_id:uuid,version:integer(1),expected_date:text,reference:text,reason:text,receipts:array(allocation),fees:array(allocation)})),signal),
  suggestions:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(path('transactions/'+uuid(id)+'/suggestions')+more(cursor),page(object({source_id:text,source_version:text,source_kind:text,amount_paise:text,available_paise:text,external_reference:nullable(text),business_date:text,kind:choice('exact','review')})),signal),
  history:(id:string,cursor?:string,signal?:AbortSignal)=>api.read(path('history/'+uuid(id))+more(cursor),page(object({id:uuid,action:text,actor_id:uuid,resource_id:uuid,recorded_at:instant,reason:nullable(text)})),signal),
  command:(suffix:string,body:unknown)=>{if(!/^(config|columns|mappings|imports|batches|cases|matches|transactions|reports)(\/[a-z0-9-]+){0,2}$/.test(suffix))protocol();return api.intent('api.v1.reconciliation.command',path(suffix),body);},
  execute:(intent:Parameters<ScopedApi['execute']>[0])=>api.execute(intent,result),
  columns:(intent:Parameters<ScopedApi['execute']>[0])=>api.execute(intent,object({headers:array(text,16),row_count:integer()})),
  capture:(body:unknown)=>api.intent('api.v1.reconciliation.report',path('reports'),body),
  executeReport:(intent:Parameters<ScopedApi['execute']>[0])=>api.execute(intent,report),
  report:(id:string,offset=0,signal?:AbortSignal)=>api.read(path('reports/'+uuid(id))+'&offset='+offset,report,signal),
  export:(id:string,columns:string[],signal?:AbortSignal)=>api.read(path('reports/'+uuid(id)+'/export')+'&columns='+encodeURIComponent(columns.join(',')),object({snapshot,columns:array(text),csv:value=>typeof value==='string'&&value.length<=8*1024*1024?value:protocol()}),signal),
 };
}
export type ReconciliationData=ReturnType<typeof reconciliation>;
