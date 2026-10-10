import {reportLimits,type PerformanceFilter,type PerformanceRow,type PerformanceSummary,type PerformanceGroup,type PerformanceSnapshot} from '@shippingco/shared';
import {object} from '../pricing/validation.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {reportFilter,csvCell} from './rules.ts';
export function performanceFilter(input:unknown):PerformanceFilter {
  const b=object(input,['from_day','to_day','sort','eta']);
  const eta=b.eta??'original';
  if(eta!=='original'&&eta!=='revised')throw new FieldValidationError('$','INVALID_FORMAT');
  return {...reportFilter({from_day:b.from_day,to_day:b.to_day,...(b.sort===undefined?{}:{sort:b.sort})}),eta};
}
export function performanceTiming(row:Omit<PerformanceRow,'duration_seconds'|'outcome'>,eta:PerformanceFilter['eta']):PerformanceRow {
  const actual=row.delivered_at===null?null:Date.parse(row.delivered_at),start=row.dispatched_at===null?null:Date.parse(row.dispatched_at);
  const estimate=eta==='original'?row.original_eta_at:row.revised_eta_at;
  const duration_seconds=actual!==null&&start!==null&&actual>=start?(actual-start)/1000:null;
  const outcome=row.status==='rto'?'rto':row.status!=='delivered'?'open':actual===null||estimate===null?'unknown':actual<=Date.parse(estimate)?'on_time':'delayed';
  return {...row,duration_seconds,outcome};
}
export function performanceSummary(rows:readonly PerformanceRow[]):PerformanceSummary {
  const delivered=rows.filter(r=>r.status==='delivered'),timed=delivered.filter(r=>r.duration_seconds!==null),eligible=delivered.filter(r=>r.outcome==='on_time'||r.outcome==='delayed');
  return {booked:rows.length,dispatched:rows.filter(r=>r.dispatched_at!==null).length,delivered:delivered.length,
    open:rows.filter(r=>r.outcome==='open').length,rto:rows.filter(r=>r.status==='rto').length,
    failed_parcels:rows.filter(r=>r.failed_attempts>0).length,failed_attempts:rows.reduce((n,r)=>n+r.failed_attempts,0),
    on_time:{numerator:eligible.filter(r=>r.outcome==='on_time').length,denominator:eligible.length,excluded:delivered.length-eligible.length},
    duration:{total_seconds:timed.reduce((n,r)=>n+r.duration_seconds!,0),denominator:timed.length,excluded:delivered.length-timed.length},
    unknown_destination:rows.filter(r=>r.destination===null).length,unknown_courier:rows.filter(r=>r.courier===null).length};
}
export function performanceGroups(rows:readonly PerformanceRow[],dimension:'destination'|'route_id'):PerformanceGroup[] {
  const groups=new Map<string|null,PerformanceRow[]>();
  for(const row of rows){const key=row[dimension],items=groups.get(key);if(items)items.push(row);else groups.set(key,[row]);}
  return [...groups].sort(([a],[b])=>(a??'').localeCompare(b??'')).map(([key,items])=>({key,summary:performanceSummary(items)}));
}
export const performanceColumns=['snapshot_id','as_of','timezone','from_day','to_day','eta_policy','parcel_id','booking_id','customer_id','parcel_version','destination','service','courier','status','failed_attempts','dispatched_at','delivered_at','original_eta_at','original_eta_version','revised_eta_at','revised_eta_version','route_id','manifest_id','route_departed_at','route_arrived_at','duration_seconds','outcome'] as const;
export function performanceCsv(snapshot:PerformanceSnapshot,rows:readonly PerformanceRow[]) {
  const records=rows.map(r=>[snapshot.id,snapshot.as_of,snapshot.timezone,snapshot.filter.from_day,snapshot.filter.to_day,snapshot.filter.eta,
    r.id,r.booking_id,r.customer_id,String(r.version),r.destination??'unknown',r.service??'unknown',r.courier??'unknown',r.status,String(r.failed_attempts),
    r.dispatched_at??'unknown',r.delivered_at??'unknown',r.original_eta_at??'unknown',String(r.original_eta_version??'unknown'),
    r.revised_eta_at??'unknown',String(r.revised_eta_version??'unknown'),r.route_id??'unknown',r.manifest_id??'unknown',
    r.route_departed_at??'unknown',r.route_arrived_at??'unknown',String(r.duration_seconds??'unknown'),r.outcome]);
  const csv=[performanceColumns,...records].map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
  if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return csv;
}
