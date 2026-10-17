/** Manual financial evidence only. These DTOs never authorize a ledger posting. */
export type ReconciliationDirection = 'credit'|'debit';
export type ReconciliationDateFormat = 'yyyy-mm-dd'|'dd/mm/yyyy'|'dd-mm-yyyy';
export type ReconciliationAmountMapping = {unit:'rupees'|'paise'} & (
 {mode:'signed';amount_column:string;positive_direction:ReconciliationDirection} |
 {mode:'credit_debit';credit_column:string;debit_column:string} |
 {mode:'direction';amount_column:string;direction_column:string;credit_value:string;debit_value:string}
);
export interface ReconciliationMappingInput {
 expected_version:number;name:string;identity_namespace:string;date_column:string;date_format:ReconciliationDateFormat;
 amount:ReconciliationAmountMapping;reference_column:string|null;identity_column:string|null;currency_column:string|null;
}
export interface ReconciliationMapping extends ReconciliationMappingInput {
 id:string;profile_id:string;version:number;recorded_at:string;actor_id:string;
}
export interface ReconciliationConfig {version:number;enabled:boolean;writes_available:boolean;recorded_at:string|null}
export interface StatementCandidate {
 business_date:string;direction:ReconciliationDirection;amount_paise:number;currency:'INR';
 external_reference:string|null;external_id:string|null;
}
export type StatementRowError = 'COLUMN_COUNT'|'INVALID_DATE'|'OUTSIDE_PERIOD'|'INVALID_AMOUNT'|'INVALID_DIRECTION'|'INVALID_REFERENCE'|'INVALID_IDENTITY'|'CURRENCY_MISMATCH';
export interface StatementPreviewRow {row:number;error:StatementRowError|null;candidate:StatementCandidate|null}
export type ReconciliationClassification = 'unassigned'|'customer_payment'|'advance'|'owner_funds'|'transfer'|'fee'|'other';
export interface ReconciliationSource {
 id:string;source_kind:'receipt'|'refund'|'expense'|'owner_funds'|'deposit'|'withdrawal';source_id:string;version:string;
 account_id:string;direction:ReconciliationDirection;amount_paise:string;currency:'INR';method:string|null;
 external_reference:string|null;business_date:string;recorded_at:string;
}
export interface ReconciliationAllocation {source_id:string;source_version:string;amount_paise:number}
export interface ReconciliationMatchInput {
 account_id:string;method:'exact'|'manual';reason:string;batch_id:string|null;
 transactions:{transaction_id:string;amount_paise:number}[];sources:ReconciliationAllocation[];fees:ReconciliationAllocation[];
}
export interface ReconciliationBatchInput {
 expected_version:number;account_id:string;expected_date:string;reference:string;reason:string;
 receipts:ReconciliationAllocation[];fees:ReconciliationAllocation[];
}
export type ReconciliationStatus='recorded'|'verified'|'pending'|'different'|'unassigned';
export interface ReconciliationReportFilter {account_id:string;from_day:string;to_day:string}
export interface ReconciliationReportRow {
 id:string;kind:'transaction'|'source'|'batch'|'case'|'import_row'|'unknown_source';resource_id:string;business_date:string|null;
 direction:ReconciliationDirection|null;amount_paise:string|null;matched_paise:string|null;remaining_paise:string|null;
 status:ReconciliationStatus;classification:ReconciliationClassification|null;external_reference:string|null;
 evidence:Record<string,unknown>;
}
export interface ReconciliationControl {kind:'transaction'|'source';direction:ReconciliationDirection;count:number;amount_paise:string;matched_paise:string;remaining_paise:string}
export interface ReconciliationReportSnapshot {
 id:string;schema_version:1;definition:'manual_reconciliation_v1';organization_id:string;franchise_id:string;timezone:'Asia/Kolkata';
 filter:ReconciliationReportFilter;as_of:string;expires_at:string;count:number;controls:ReconciliationControl[];
 status_counts:Record<ReconciliationStatus,number>;
}
export interface ReconciliationReportPage {snapshot:ReconciliationReportSnapshot;rows:ReconciliationReportRow[];next_offset:number|null}
