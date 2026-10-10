import {reportLimits,ageingStatuses,type PerformancePage,type PerformanceExport,type PerformanceFilter,type PerformanceSummary} from '@shippingco/shared';
import {object,uuid,text,instant,integer,choice,array,nullable,protocol,type Decoder} from './dto';
import type {ScopedApi} from './scoped-api';
import type {CommandIntent} from './command-intent';
const summary:Decoder<PerformanceSummary>=object({booked:integer(),dispatched:integer(),delivered:integer(),open:integer(),rto:integer(),failed_parcels:integer(),failed_attempts:integer(),
  on_time:object({numerator:integer(),denominator:integer(),excluded:integer()}),duration:object({total_seconds:v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:protocol(),denominator:integer(),excluded:integer()}),unknown_destination:integer(),unknown_courier:integer()});
const row=object({id:uuid,booking_id:uuid,customer_id:uuid,confirmed_at:instant,version:integer(),destination:nullable(text),service:nullable(text),courier:nullable(text),status:choice(...ageingStatuses),failed_attempts:integer(),
  dispatched_at:nullable(instant),delivered_at:nullable(instant),original_eta_at:nullable(instant),revised_eta_at:nullable(instant),original_eta_version:nullable(integer()),revised_eta_version:nullable(integer()),
  route_id:nullable(uuid),manifest_id:nullable(uuid),route_departed_at:nullable(instant),route_arrived_at:nullable(instant),duration_seconds:nullable(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:protocol()),outcome:choice('on_time','delayed','open','rto','unknown')});
const group=object({key:nullable(text),summary});
const snapshot=object({id:uuid,schema_version:choice(1),definition:choice('delivery_performance_v1'),timezone:choice('Asia/Kolkata'),organization_id:uuid,franchise_id:uuid,
  filter:object({from_day:text,to_day:text,sort:choice('confirmed_asc','confirmed_desc'),eta:choice('original','revised')}),as_of:instant,expires_at:instant,
  freshness:object({state:choice('captured'),captured_at:instant}),count:integer(),summary,destinations:array(group,reportLimits.rows),routes:array(group,reportLimits.rows)});
const selection=object({destination:nullable(text),route_id:nullable(text),count:integer(),summary});
export const performancePage:Decoder<PerformancePage>=object({snapshot,selection,rows:array(row,reportLimits.page),next_offset:nullable(integer())});
const exported:Decoder<PerformanceExport>=object({snapshot,selection,columns:array(text,40),csv:v=>typeof v==='string'&&v.length<=reportLimits.bytes?v:protocol()});
export function performance(api:ScopedApi) {
  const path='/api/v1/reports/performance';
  const check=(p:PerformancePage)=>{if(p.snapshot.organization_id!==api.organization||p.snapshot.franchise_id!==api.franchise)protocol();return p;};
  const selected=(destination:string|null,route:string|null)=>'&'+new URLSearchParams({...destination===null?{}:{destination},...route===null?{}:{route_id:route}});
  return {
    intent(filter:PerformanceFilter){return api.intent('performance.capture',api.path(path),filter);},
    async execute(intent:CommandIntent){return check(await api.execute(intent,performancePage,['$','Idempotency-Key']));},
    async page(id:string,offset=0,signal?:AbortSignal,destination:string|null=null,route:string|null=null){return check(await api.read(api.path(path+'/'+uuid(id))+'&offset='+offset+selected(destination,route),performancePage,signal));},
    async export(id:string,destination:string|null=null,route:string|null=null){const p=await api.read(api.path(path+'/'+uuid(id)+'/export')+selected(destination,route),exported);if(p.snapshot.id!==id||p.snapshot.organization_id!==api.organization||p.snapshot.franchise_id!==api.franchise)protocol();return p;},
  };
}
export type PerformanceSource=ReturnType<typeof performance>;
