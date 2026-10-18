import type {DailyPage,DailyExport,DailyFilter,DailyMetrics} from '@shippingco/shared';
import {object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const money:Decoder<string>=v=>typeof v==='string'&&/^-?\d{1,24}$/.test(v)?v:protocol();
const metrics:Decoder<DailyMetrics>=object({bookings:integer(),billed_gross:money,tax_exclusive_revenue:money,average_bill:nullable(money),collections:money,refunds:money,outstanding:money,customers:integer(),new_customers:integer(),returning_customers:integer(),methods:array(object({method:choice('cash','upi','card','bank_transfer','other'),paise:money}),5)});
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('owner_daily_v1'),timezone:choice('Asia/Kolkata'),organization_id:uuid,franchise_id:uuid,filter:object({day:nullable(text),mode:choice('complete_day','same_elapsed'),franchise_ids:array(uuid,50)}),as_of:instant,expires_at:instant,count:integer(),windows:array(object({period:choice('today','yesterday'),from:instant,to:instant}),2),today:metrics,yesterday:metrics,comparison:array(object({metric:choice('bookings','billed_gross','tax_exclusive_revenue','average_bill','collections','refunds','outstanding','customers','new_customers','returning_customers'),delta:nullable(money),percent:nullable(text)}),10)});
const row=object({id:uuid,franchise_id:uuid,period:choice('today','yesterday'),kind:choice('booking','receipt','legacy_collection','refund','advance_refund'),occurred_at:instant,customer_id:nullable(uuid),method:nullable(text),eligible:choice(true,false),in_period:choice(true,false),new_customer:choice(true,false),billed_gross:money,tax_exclusive_revenue:money,collections:money,refunds:money,outstanding:money});
export {metrics as dailyMetricsDecoder,row as dailyRowDecoder};
export const dailyPage:Decoder<DailyPage>=object({snapshot,rows:array(row,100),next_offset:nullable(integer())});
const exported:Decoder<DailyExport>=object({snapshot,columns:array(text,30),csv:v=>typeof v==='string'&&v.length<=8*1024*1024?v:protocol()});
export function dailyDashboard(api:ScopedApi) {
 const base='/api/v1/reports/daily',owned=<T extends {snapshot:DailyPage['snapshot']}>(r:T,id?:string)=>{if(r.snapshot.organization_id!==api.organization||r.snapshot.franchise_id!==api.franchise||id!==undefined&&r.snapshot.id!==id)protocol();return r;};
 const suffix=(period?:string,metric?:string,method?:string)=>new URLSearchParams({...period?{period}:{},...metric?{metric}:{},...method?{method}:{}}).toString();
 return {franchise:api.franchise,
  intent:(filter:DailyFilter)=>api.intent('daily.capture',api.path(base),filter),
  execute:async(intent:CommandIntent)=>owned(await api.execute(intent,dailyPage,['$','day','mode','Idempotency-Key'])),
  page:async(id:string,offset=0,period?:string,metric?:string,signal?:AbortSignal,method?:string)=>owned(await api.read(api.path(base+'/'+uuid(id))+'&offset='+offset+'&'+suffix(period,metric,method),dailyPage,signal),id),
  export:async(id:string,period?:string,metric?:string,method?:string)=>owned(await api.read(api.path(base+'/'+uuid(id)+'/export')+'&'+suffix(period,metric,method),exported),id),
 };
}
export type DailySource=ReturnType<typeof dailyDashboard>;
