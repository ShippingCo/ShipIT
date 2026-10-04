import { reportLimits, reportMeasures, type ReportFilter, type ReportRow, type ReportSnapshot } from '@shippingco/shared';
import { FieldValidationError, HttpError } from '../../plugins/errors.ts';
import { object } from '../pricing/validation.ts';

function day(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'2000-01-01'||value>'9998-12-31')throw new FieldValidationError('$','INVALID_FORMAT');
  const date=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new FieldValidationError('$','INVALID_FORMAT');
  return value;
}
export function reportFilter(input:unknown):ReportFilter {
  const b=object(input,['from_day','to_day','sort']),from=day(b.from_day),to=day(b.to_day);
  if(to<from||(Date.parse(to)-Date.parse(from))/86400000>=reportLimits.days)throw new FieldValidationError('$','OUT_OF_RANGE');
  const sort=b.sort??'confirmed_desc';
  if(sort!=='confirmed_asc'&&sort!=='confirmed_desc')throw new FieldValidationError('$','INVALID_FORMAT');
  return {from_day:from,to_day:to,sort};
}
export function utcRange(filter:ReportFilter) {
  return {from:new Date(filter.from_day+'T00:00:00+05:30').toISOString(),
    to:new Date(Date.parse(filter.to_day+'T00:00:00+05:30')+86400000).toISOString()};
}
export function totals(rows:readonly ReportRow[]):ReportSnapshot['totals'] {
  const result=Object.fromEntries(reportMeasures.map(m=>[m,{state:'unknown',reason:'source_unavailable'}])) as ReportSnapshot['totals'];
  for(const key of ['billed_gross','tax_exclusive_revenue','collections','outstanding'] as const)
    result[key]={state:'known',paise:rows.reduce((sum,r)=>sum+BigInt(r[key]),0n).toString()};
  return result;
}
/** Quote every cell, including embedded delimiters; neutralize spreadsheet formula prefixes. */
export function csvCell(value:string):string {
  const safe=/^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(value)||/^[\t\r\n]/.test(value)?"'"+value:value;
  return '"'+safe.replaceAll('"','""')+'"';
}
export const exportColumns=['snapshot_id','as_of','timezone','from_day','to_day','booking_id','confirmed_at','booking_version','payment_version','billed_gross_paise','tax_exclusive_revenue_paise','net_collected_paise','outstanding_paise','cost_state','due_at'] as const;
export function reportCsv(snapshot:ReportSnapshot,rows:readonly ReportRow[]) {
  const records=rows.map(r=>[snapshot.id,snapshot.as_of,snapshot.timezone,snapshot.filter.from_day,snapshot.filter.to_day,r.id,r.confirmed_at,
    String(r.source.version),String(r.payment_source.version),r.billed_gross,r.tax_exclusive_revenue,r.collections,r.outstanding,r.cost.state,r.due_at??'unknown']);
  const csv=[exportColumns,...records].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  return csv;
}
