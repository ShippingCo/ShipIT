import { salesMeasures, reportLimits, type SalesAmounts, type SalesRow, type SalesGroup, type SalesSnapshot } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
import { csvCell } from './rules.ts';

export function salesTotals(rows: readonly {amounts: SalesAmounts}[]): SalesAmounts {
  return Object.fromEntries(salesMeasures.map(k=>[k,rows.reduce((sum,r)=>sum+BigInt(r.amounts[k]),0n).toString()])) as SalesAmounts;
}
export function salesGroups(rows: readonly SalesRow[]): SalesGroup[] {
  const groups=new Map<string,SalesRow[]>();
  for(const row of rows){const key=JSON.stringify([row.rate,row.treatment,row.jurisdiction]);groups.set(key,[...(groups.get(key)??[]),row]);}
  return [...groups.values()].map(group=>({rate:group[0]!.rate,treatment:group[0]!.treatment,jurisdiction:group[0]!.jurisdiction,count:group.length,amounts:salesTotals(group)}));
}
export const salesColumns=['snapshot_id','as_of','timezone','from_day','to_day','rate_filter','franchise_filter','booking_id','franchise_id','confirmed_at','receipt_id','receipt_number','rate','treatment','jurisdiction','policy_id','booking_version','payment_version',...salesMeasures.map(k=>k+'_paise'),'original_gross_paise','correction_ids','statement_ids'] as const;
export function salesCsv(snapshot:SalesSnapshot,rows:readonly SalesRow[]) {
  const csv=[salesColumns,...rows.map(r=>[snapshot.id,snapshot.as_of,snapshot.timezone,snapshot.filter.from_day,snapshot.filter.to_day,snapshot.filter.rate??'all',snapshot.filter.franchise_ids.join('|'),r.id,r.franchise_id,r.confirmed_at,r.receipt_id??'',r.receipt_number??'',r.rate,r.treatment,r.jurisdiction,r.policy_id,String(r.booking_version),String(r.payment_version),...salesMeasures.map(k=>r.amounts[k]),r.original.gross,r.corrections.map(c=>c.id).join('|'),r.statement_ids.join('|')])].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
  if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  return csv;
}
