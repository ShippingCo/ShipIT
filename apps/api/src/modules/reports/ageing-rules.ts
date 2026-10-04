import { ageingBuckets,ageingMeasures,ageingStatuses,reportLimits,type AgeingFilter,type AgeingRow,type AgeingSummary,type AgeingSnapshot,type AgeingBucket } from '@shippingco/shared';
import { object,uuid } from '../pricing/validation.ts';
import { FieldValidationError,HttpError } from '../../plugins/errors.ts';
import { csvCell } from './rules.ts';

export function ageingFilter(input:unknown):AgeingFilter {
  const b=object(input,['anchor','status','customer_id','balances']);
  const anchor=b.anchor??'booking',status=b.status??null,balances=b.balances??'outstanding';
  if((anchor!=='booking'&&anchor!=='due')||(balances!=='outstanding'&&balances!=='all')||
    (status!==null&&!ageingStatuses.some(s=>s===status)))throw new FieldValidationError('$','INVALID_FORMAT');
  return {anchor,status:status as AgeingFilter['status'],balances,customer_id:b.customer_id==null?null:uuid(b.customer_id,'$')};
}
/** Business calendar days, not elapsed 24-hour periods; no inferred due dates. */
export function ageing(anchor:string|null,asOf:string):{age_days:number|null;bucket:AgeingBucket} {
  if(anchor===null)return {age_days:null,bucket:'unknown'};
  const day=(v:string)=>Math.floor((Date.parse(v)+19800000)/86400000);
  const age_days=day(asOf)-day(anchor);
  if(!Number.isFinite(age_days))throw new HttpError('TEMPORARILY_UNAVAILABLE');
  return {age_days,bucket:age_days<0?'future':age_days<=30?'0_30':age_days<=60?'31_60':'61_plus'};
}
export function ageingSummary(rows:readonly AgeingRow[]):AgeingSummary {
  return {count:rows.length,
    totals:Object.fromEntries(ageingMeasures.map(k=>[k,rows.reduce((sum,r)=>sum+BigInt(r[k]),0n).toString()])) as AgeingSummary['totals'],
    buckets:Object.fromEntries(ageingBuckets.map(k=>[k,rows.reduce((sum,r)=>sum+(r.bucket===k?BigInt(r.outstanding):0n),0n).toString()])) as AgeingSummary['buckets']};
}
export function ageingCustomers(rows:readonly AgeingRow[]) {
  const groups=new Map<string,AgeingRow[]>();
  for(const row of rows){const group=groups.get(row.customer_id)??[];group.push(row);groups.set(row.customer_id,group);}
  return [...groups].map(([customer_id,group])=>({customer_id,...ageingSummary(group)}));
}
export const ageingColumns=['snapshot_id','as_of','timezone','anchor','status_filter','customer_filter','balances_filter','booking_id','customer_id','confirmed_at','due_at','age_days','bucket','overdue','booking_version','obligation_id','payment_version','financial_version',...ageingMeasures.map(k=>k+'_paise'),'parcels','collection_history','financial_changes'] as const;
export function ageingCsv(s:AgeingSnapshot,rows:readonly AgeingRow[]) {
  const csv=[ageingColumns,...rows.map(r=>[s.id,s.as_of,s.timezone,s.filter.anchor,s.filter.status??'all',s.filter.customer_id??'all',s.filter.balances,
    r.id,r.customer_id,r.confirmed_at,r.due_at??'unknown',r.age_days===null?'unknown':String(r.age_days),r.bucket,r.overdue===null?'unknown':String(r.overdue),
    String(r.booking_version),r.obligation_id,String(r.payment_version),String(r.financial_version),...ageingMeasures.map(k=>r[k]),JSON.stringify(r.parcels),JSON.stringify(r.entries),JSON.stringify(r.changes)])]
    .map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  return csv;
}
