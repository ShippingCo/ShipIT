import type {ReportFilter} from './report.ts';
export const financialAuditKinds=['discount','cancellation','correction','refund','refund_correction','request_amendment','price_override','collection_correction','receipt_correction','deletion_denied'] as const;
export const financialAuditStatuses=['pending','approved','rejected','applied','superseded','recorded','denied'] as const;
export interface FinancialAuditFilter extends ReportFilter {kind:typeof financialAuditKinds[number]|null;status:typeof financialAuditStatuses[number]|null;actor_id:string|null;booking_id:string|null}
export interface FinancialAuditDecision {id:string;actor_id:string;outcome:string;version:number;financial_change_id:string|null;recorded_at:string}
export interface FinancialAuditDocument {kind:'issued_receipt'|'external_invoice'|'external_credit_note';receipt_id:string|null;external_ref:string|null;qualification:'issued_source'|'unverified_external_reference'}
/** Positive original/proposed paise have the labelled basis; rows are audit facts, not additive economic totals. */
export interface FinancialAuditRow {
 id:string;kind:typeof financialAuditKinds[number];change_kind:string;status:typeof financialAuditStatuses[number];
 source_type:'financial_request'|'financial_change'|'pricing_quote'|'payment_entry'|'money_receipt_command'|'financial_deletion_denial';
 source_id:string;booking_id:string|null;receipt_id:string|null;actor_id:string;recorded_at:string;reason:string;version:number;
 correction_of:string|null;policy_id:string|null;approval_threshold_paise:string|null;additional_review_required:boolean|null;
 approval_basis:'financial_policy'|'unconfigured_policy'|'quote_tolerance'|'legacy_manual_reference'|'administrator_command'|'not_applicable';approved_actor_id:string|null;
 amount_basis:'charge_gross'|'net_recorded_refunds'|'freight'|'recorded_collection'|'allocated_collection'|'none';
 before_paise:string|null;proposed_paise:string|null;decisions:FinancialAuditDecision[];document_links:FinancialAuditDocument[];
}
export interface FinancialAuditSnapshot {id:string;schema_version:1;definition:'financial_audit_v1';organization_id:string;franchise_id:string;timezone:'Asia/Kolkata';
 as_of:string;expires_at:string;filter:FinancialAuditFilter;count:number;counts:Partial<Record<FinancialAuditRow['kind'],number>>}
export interface FinancialAuditPage {snapshot:FinancialAuditSnapshot;rows:FinancialAuditRow[];next_offset:number|null}
export interface FinancialAuditExport {snapshot:FinancialAuditSnapshot;columns:readonly string[];csv:string}
