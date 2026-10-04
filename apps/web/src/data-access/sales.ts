import { salesMeasures,type SalesAmounts,type SalesPage,type SalesExport,type SalesFilter } from '@shippingco/shared';
import { object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder } from './dto';
import type { ScopedApi } from './scoped-api';
import type { CommandIntent } from './command-intent';
const paise:Decoder<string>=v=>typeof v==='string'&&/^-?\d{1,24}$/.test(v)?v:protocol();
const amounts:Decoder<SalesAmounts>=object(Object.fromEntries(salesMeasures.map(m=>[m,paise])) as Record<typeof salesMeasures[number],Decoder<string>>);
const correction=object({id:uuid,kind:choice('discount','cancellation','correction','refund'),refund:paise,taxable:paise,occurred_at:instant,reason:text,approval_ref:text,pre_tax:paise,cgst:paise,sgst:paise,igst:paise,rounding:paise});
const row=object({id:uuid,franchise_id:uuid,customer_id:uuid,confirmed_at:instant,booking_version:integer(1),payment_version:integer(),receipt_id:nullable(uuid),receipt_number:nullable(text),rate:text,treatment:text,jurisdiction:text,policy_id:uuid,original:amounts,amounts,corrections:array(correction,5000),statement_ids:array(uuid,100)});
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('sales_gst_v1'),timezone:choice('Asia/Kolkata'),organization_id:uuid,franchise_id:uuid,filter:object({from_day:text,to_day:text,sort:choice('confirmed_asc','confirmed_desc'),rate:nullable(text),franchise_ids:array(uuid,50)}),as_of:instant,expires_at:instant,count:integer(),totals:amounts,groups:array(object({rate:text,treatment:text,jurisdiction:text,count:integer(),amounts}),5000)});
export const salesPage:Decoder<SalesPage>=object({snapshot,rows:array(row,100),next_offset:nullable(integer())});
const exported:Decoder<SalesExport>=object({snapshot,columns:array(text,50),csv:text});
export const financeState=object({version:integer(),payment_version:integer(),gross:paise,collections:paise,refunds:paise,pre_tax:paise,taxable:paise,cgst:paise,sgst:paise,igst:paise,rounding:paise,changes:array(object({id:uuid,version:integer(1),kind:choice('discount','cancellation','correction','refund'),reason:text,approval_ref:text,occurred_at:instant,refund:paise}),5000)});
const statement=object({id:uuid,kind:choice('account_statement'),customer_id:uuid,from_day:text,to_day:text,as_of:instant,rows:array(row,5000),totals:amounts});
export function sales(api:ScopedApi){
 const path='/api/v1/reports/sales';
 const check=(p:SalesPage)=>{if(p.snapshot.organization_id!==api.organization||p.snapshot.franchise_id!==api.franchise)protocol();return p;};
 return {
  franchise:api.franchise,
  intent(filter:SalesFilter){return api.intent('sales.capture',api.path(path),filter);},
  async execute(intent:CommandIntent){return check(await api.execute(intent,salesPage,['$','Idempotency-Key']));},
  async page(id:string,offset=0,signal?:AbortSignal){const p=check(await api.read(api.path(path+'/'+uuid(id))+'&offset='+offset,salesPage,signal));if(p.snapshot.id!==id)protocol();return p;},
  async export(id:string){const p=await api.read(api.path(path+'/'+uuid(id)+'/export'),exported);if(p.snapshot.id!==id||p.snapshot.organization_id!==api.organization||p.snapshot.franchise_id!==api.franchise)protocol();return p;},
  current(id:string,signal?:AbortSignal){return api.read(api.path('/api/v1/finance/bookings/'+uuid(id)),financeState,signal);},
  financeIntent(kind:'changes'|'statements',body:unknown){return api.intent('finance.'+kind,api.path('/api/v1/finance/'+kind),body);},
  executeFinance(intent:CommandIntent){return api.execute(intent,object({id:uuid}),['$','expected_version','booking_id','customer_id','Idempotency-Key']);},
  statement(id:string){return api.read(api.path('/api/v1/finance/statements/'+uuid(id)),statement);},
 };
}
export type SalesSource=ReturnType<typeof sales>;
