import {reportLimits,type DailyRow,type DailyMetrics,type DailySnapshot,type DailyComparisonMode} from '@shippingco/shared';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {csvCell} from './rules.ts';
export function dailyWindows(now:Date,day:string|null,mode:DailyComparisonMode):DailySnapshot['windows'] {
 const current=new Date(now.getTime()+19800000).toISOString().slice(0,10),selected=day??current;
 if(selected>current)throw new FieldValidationError('$','OUT_OF_RANGE');
 const start=Date.parse(selected+'T00:00:00+05:30'),end=Math.min(start+86400000,now.getTime()),elapsed=end-start;
 return [{period:'today',from:new Date(start).toISOString(),to:new Date(end).toISOString()},
  {period:'yesterday',from:new Date(start-86400000).toISOString(),to:new Date(mode==='same_elapsed'?start-86400000+elapsed:start).toISOString()}];
}
export function dailyMetrics(rows:readonly DailyRow[]):DailyMetrics {
 const sales=rows.filter(r=>r.kind==='booking'&&r.in_period),eligible=sales.filter(r=>r.eligible);
 const sum=(key:'billed_gross'|'tax_exclusive_revenue'|'collections'|'refunds'|'outstanding',source:readonly DailyRow[]=rows)=>source.reduce((s,r)=>s+BigInt(r[key]),0n).toString();
 const customers=new Map<string,boolean>();for(const r of eligible)if(r.customer_id)customers.set(r.franchise_id+':'+r.customer_id,(customers.get(r.franchise_id+':'+r.customer_id)??false)||r.new_customer);
 const methods=new Map<string,bigint>();for(const r of rows)if(r.method!==null)methods.set(r.method,(methods.get(r.method)??0n)+BigInt(r.collections));
 const gross=sum('billed_gross',sales),newCustomers=[...customers.values()].filter(Boolean).length;
 return {bookings:eligible.length,billed_gross:gross,tax_exclusive_revenue:sum('tax_exclusive_revenue',sales),average_bill:eligible.length?((BigInt(gross)+BigInt(eligible.length)/2n)/BigInt(eligible.length)).toString():null,
  collections:sum('collections'),refunds:sum('refunds'),outstanding:sum('outstanding'),customers:customers.size,new_customers:newCustomers,returning_customers:customers.size-newCustomers,
  methods:[...methods].sort(([a],[b])=>a.localeCompare(b)).map(([method,paise])=>({method,paise:String(paise)}))};
}
export function dailyComparison(today:DailyMetrics,yesterday:DailyMetrics):DailySnapshot['comparison'] {
 return (['bookings','billed_gross','tax_exclusive_revenue','average_bill','collections','refunds','outstanding','customers','new_customers','returning_customers'] as const).map(metric=>{
  const a=today[metric],b=yesterday[metric];if(a===null||b===null)return {metric,delta:null,percent:null};
  const delta=BigInt(a)-BigInt(b),denominator=BigInt(b),hundredths=denominator===0n?null:delta*10000n/denominator;
  const absolute=hundredths===null?null:hundredths<0n?-hundredths:hundredths;
  return {metric,delta:String(delta),percent:absolute===null?null:`${hundredths!<0n?'-':''}${absolute/100n}.${String(absolute%100n).padStart(2,'0')}`};
 });
}
export const dailyColumns=['snapshot_id','as_of','timezone','comparison_mode','period','from','to','source_id','franchise_id','source_kind','occurred_at','customer_id','method','eligible','in_period','new_customer','billed_gross_paise','tax_exclusive_revenue_paise','collections_paise','refunds_paise','outstanding_paise'] as const;
export function dailyEvidence(rows:DailyRow[],period:string|undefined,metric:string|undefined,method?:string) {
 const metrics=['bookings','billed_gross','tax_exclusive_revenue','average_bill','collections','refunds','outstanding','customers','new_customers','returning_customers'];
 if(period!==undefined&&!['today','yesterday'].includes(period)||metric!==undefined&&!metrics.includes(metric))throw new FieldValidationError('$','INVALID_FORMAT');
 if(method!==undefined&&(!['cash','upi','card','bank_transfer','other'].includes(method)||metric!=='collections'))throw new FieldValidationError('$','INVALID_FORMAT');
 return rows.filter(r=>{
  if(period!==undefined&&r.period!==period)return false;
  if(method!==undefined&&r.method!==method)return false;
  if(metric===undefined)return true;
  if(metric==='collections')return r.kind==='receipt'||r.kind==='legacy_collection';
  if(metric==='refunds')return r.kind==='refund'||r.kind==='advance_refund';
  if(metric==='outstanding')return r.kind==='booking'&&BigInt(r.outstanding)>0n;
  return r.kind==='booking'&&r.in_period&&(['billed_gross','tax_exclusive_revenue'].includes(metric)||r.eligible)&&
   (metric!=='new_customers'||r.new_customer)&&(metric!=='returning_customers'||!r.new_customer);
 });
}
export function dailyCsv(s:DailySnapshot,rows:readonly DailyRow[]) {
 const csv=[dailyColumns,...rows.map(r=>{const w=s.windows.find(w=>w.period===r.period)!;return [s.id,s.as_of,s.timezone,s.filter.mode,r.period,w.from,w.to,r.id,r.franchise_id,r.kind,r.occurred_at,r.customer_id??'',r.method??'',String(r.eligible),String(r.in_period),String(r.new_customer),r.billed_gross,r.tax_exclusive_revenue,r.collections,r.refunds,r.outstanding];})].map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 if(Buffer.byteLength(csv)>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return csv;
}
