import type { ReportFilter } from './report.ts';

export const salesMeasures = ['pre_tax','taxable','non_taxable','cgst','sgst','igst','gst','rounding','gross','collections','refunds','outstanding','refundable_credit'] as const;
export type SalesAmounts = Record<typeof salesMeasures[number], string>;
export interface SalesFilter extends ReportFilter { rate: string | null; franchise_ids: string[] }
export interface SalesEvidence {
  id: string; kind: 'discount'|'cancellation'|'correction'|'refund'|'refund_correction'; occurred_at: string;
  refund: string; taxable: string; reason: string; approval_ref: string; pre_tax: string; cgst: string; sgst: string; igst: string; rounding: string;
}
export interface SalesRow {
  id: string; franchise_id: string; confirmed_at: string; customer_id: string;
  booking_version: number; payment_version: number; receipt_id: string|null; receipt_number: string|null;
  rate: string; treatment: string; jurisdiction: string; policy_id: string;
  original: SalesAmounts; amounts: SalesAmounts; corrections: SalesEvidence[]; statement_ids: string[];
}
export interface SalesGroup { rate: string; treatment: string; jurisdiction: string; count: number; amounts: SalesAmounts }
export interface SalesSnapshot {
  id: string; schema_version: 1; definition: 'sales_gst_v1'; timezone: 'Asia/Kolkata';
  organization_id: string; franchise_id: string; filter: SalesFilter; as_of: string; expires_at: string;
  count: number; totals: SalesAmounts; groups: SalesGroup[];
}
export interface SalesPage { snapshot: SalesSnapshot; rows: SalesRow[]; next_offset: number|null }
export interface SalesExport { snapshot: SalesSnapshot; columns: readonly string[]; csv: string }
