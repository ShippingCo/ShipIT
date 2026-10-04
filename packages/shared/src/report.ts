/** v1 reports are derived evidence, never an authority for financial mutations. */
export const reportLimits = { rows: 5000, days: 31, page: 100, bytes: 8 * 1024 * 1024, lifetimeSeconds: 86400 } as const;
export const reportMeasures = ['billed_gross','tax_exclusive_revenue','collections','outstanding','refundable_credit','customer_advance','seller_cod_liability','expenses','agent_custody','verified_settlement'] as const;
export type ReportMeasure = typeof reportMeasures[number];
/** Decimal integer paise strings keep aggregate totals exact beyond JS safe integers. */
export type ReportMoney = { state:'known'; paise:string } | { state:'unknown'; reason:'source_unavailable'|'evidence_missing' };
export interface ReportSourceRef { type:'booking'|'payment_ledger'|'payment_receipt'|'adjustment'|'account_bill'|'cash_movement'|'agent_settlement'|'bank_match'|'shipment_cost'; id:string; version:number; correction_of:string|null }
export interface ReportRow {
  id:string; confirmed_at:string; source:ReportSourceRef; payment_source:ReportSourceRef;
  billed_gross:string; tax_exclusive_revenue:string; collections:string; outstanding:string;
  cost:ReportMoney; due_at:string|null;
}
export interface ReportFilter { from_day:string; to_day:string; sort:'confirmed_asc'|'confirmed_desc' }
export interface ReportSnapshot {
  id:string; schema_version:1; definition:'booking_cohort_v1'; timezone:'Asia/Kolkata';
  organization_id:string; franchise_id:string; filter:ReportFilter;
  as_of:string; expires_at:string; freshness:{state:'captured'; captured_at:string};
  count:number; totals:Record<ReportMeasure,ReportMoney>;
}
export interface ReportPage { snapshot:ReportSnapshot; rows:ReportRow[]; next_offset:number|null }
export interface ReportExport { snapshot:ReportSnapshot; columns:readonly string[]; csv:string }
