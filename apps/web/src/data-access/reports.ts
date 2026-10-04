import { reportLimits, reportMeasures, type ReportMoney, type ReportPage, type ReportFilter, type ReportExport } from '@shippingco/shared';
import { object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder } from './dto';
import type { ScopedApi } from './scoped-api';
import type { CommandIntent } from './command-intent';
const paise:Decoder<string>=v=>typeof v==='string'&&/^-?\d{1,24}$/.test(v)?v:protocol();
const money:Decoder<ReportMoney>=v=>{
  const state=object({state:choice('known','unknown')})(v).state;
  return state==='known'?object({state:choice('known'),paise})(v):object({state:choice('unknown'),reason:choice('source_unavailable','evidence_missing')})(v);
};
const source=object({type:choice('booking','payment_ledger','payment_receipt','adjustment','account_bill','cash_movement','agent_settlement','bank_match','shipment_cost'),id:uuid,version:integer(),correction_of:nullable(uuid)});
const row=object({id:uuid,confirmed_at:instant,source,payment_source:source,billed_gross:paise,tax_exclusive_revenue:paise,collections:paise,outstanding:paise,cost:money,due_at:nullable(instant)});
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('booking_cohort_v1'),timezone:choice('Asia/Kolkata'),organization_id:uuid,franchise_id:uuid,
  filter:object({from_day:text,to_day:text,sort:choice('confirmed_asc','confirmed_desc')}),as_of:instant,expires_at:instant,
  freshness:object({state:choice('captured'),captured_at:instant}),count:integer(),totals:object(Object.fromEntries(reportMeasures.map(m=>[m,money])) as Record<typeof reportMeasures[number],Decoder<ReportMoney>>)});
export const reportPage:Decoder<ReportPage>=object({snapshot,rows:array(row,reportLimits.page),next_offset:nullable(integer())});
const exported:Decoder<ReportExport>=object({snapshot,columns:array(text,30),csv:v=>typeof v==='string'&&v.length<=reportLimits.bytes?v:protocol()});
export function reports(api:ScopedApi) {
  const path='/api/v1/reports/snapshots';
  const check=(p:ReportPage)=>{if(p.snapshot.organization_id!==api.organization||p.snapshot.franchise_id!==api.franchise)protocol();return p;};
  return {
    intent(filter:ReportFilter){return api.intent('reports.capture',api.path(path),filter);},
    async execute(intent:CommandIntent){return check(await api.execute(intent,reportPage,['$','Idempotency-Key']));},
    async page(id:string,offset=0,signal?:AbortSignal){return check(await api.read(api.path(path+'/'+uuid(id))+'&offset='+offset,reportPage,signal));},
    async export(id:string){const result=await api.read(api.path(path+'/'+uuid(id)+'/export'),exported);if(result.snapshot.id!==id||result.snapshot.organization_id!==api.organization||result.snapshot.franchise_id!==api.franchise)protocol();return result;},
  };
}
export type ReportSource=ReturnType<typeof reports>;
