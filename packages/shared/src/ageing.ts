/** Read-only financial evidence; never a new balance or due-date authority. */
export const ageingBuckets = ['0_30','31_60','61_plus','unknown','future'] as const;
export type AgeingBucket = typeof ageingBuckets[number];
export const ageingStatuses = ['booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto'] as const;
export interface AgeingFilter {
  anchor:'booking'|'due'; status:typeof ageingStatuses[number]|null;
  customer_id:string|null; balances:'outstanding'|'all';
}
export const ageingMeasures = ['original_gross','reductions','gross','collections','reversals','refunds','net_collections','outstanding','refundable_credit'] as const;
export type AgeingAmounts = Record<typeof ageingMeasures[number],string>;
export interface AgeingEntry { id:string; kind:'collection'|'reversal'; amount:string; version:number; occurred_at:string; reversal_of:string|null }
export interface AgeingChange { id:string; kind:'discount'|'cancellation'|'correction'|'refund'|'refund_correction'; version:number; reduction:string; refund:string; occurred_at:string }
export interface AgeingRow extends AgeingAmounts {
  id:string; customer_id:string; confirmed_at:string; booking_version:number; obligation_id:string;
  payment_version:number; financial_version:number; due_at:string|null;
  age_days:number|null; bucket:AgeingBucket; overdue:boolean|null;
  parcels:{id:string; status:typeof ageingStatuses[number]}[];
  entries:AgeingEntry[]; changes:AgeingChange[];
}
export interface AgeingSummary {
  count:number; totals:AgeingAmounts; buckets:Record<AgeingBucket,string>;
}
export interface AgeingSnapshot extends AgeingSummary {
  id:string; schema_version:1; definition:'to_pay_ageing_v1'; timezone:'Asia/Kolkata';
  organization_id:string; franchise_id:string; filter:AgeingFilter; as_of:string; expires_at:string;
  customers:(AgeingSummary&{customer_id:string})[];
  due_date_source:'unavailable'; advance_source:'unavailable';
}
export interface AgeingPage { snapshot:AgeingSnapshot; rows:AgeingRow[]; next_offset:number|null }
export interface AgeingExport { snapshot:AgeingSnapshot; columns:readonly string[]; csv:string }
