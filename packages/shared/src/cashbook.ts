import type {ReceiptMethod} from './money-receipt.ts';
export interface CashLocationDto {
 id:string;revision_id:string;version:number;name:string;active:boolean;kind:'cash'|'noncash';
 account_id:string;account_revision_id:string;account_version:number;methods:ReceiptMethod[];custodian_id:string|null;recorded_at:string;
}
export interface CashLocationInput {
 account_id:string;expected_account_version:number;custodian_id:string|null;name:string;active:boolean;expected_version:number;
}

export type CashMovementKind='cod_reservation_reversal'|'cod_remittance'|'agent_fee_payment'|'agent_advance'|'expense'|'opening_float'|'owner_funds'|'deposit'|'withdrawal';
export type ExpenseCategory='rent'|'utilities'|'supplies'|'transport'|'maintenance'|'other';
export interface CashbookRequestInput {
 cod_allocation_id?:string|null;payment_reference?:string|null;
 fee_earning_id?:string|null;fee_cash_paise?:number|null;fee_advance_paise?:number|null;fee_advance_request_id?:string|null;agent_payee_id?:string|null;payment_method?:ReceiptMethod|null;correction_of?:string|null;kind:CashMovementKind;source_location_id:string;source_revision_id:string;target_location_id:string|null;target_revision_id:string|null;
 expected_source_version:number;amount_paise:number;currency:'INR';category:ExpenseCategory|null;payee:string|null;
 responsible_employee_id:string;reason:string;occurred_at:string;
}
export interface CashbookRequestDto extends CashbookRequestInput {
 id:string;actor_id:string;recorded_at:string;
}
export interface CashbookDecisionInput {decision:'approved'|'rejected';reason:string;expected_version:1}
export interface CashbookDecisionDto {attachments?:{id:string;version:number;sha256:string}[];id:string;request_id:string;decision:'approved'|'rejected';reason:string;actor_id:string;recorded_at:string;version:2}
export interface CashbookRequestDetail {request:CashbookRequestDto;decision:CashbookDecisionDto|null;effect:CashbookEffectDto|null;version:1|2|3}

export interface CashbookApplyInput {expected_version:2;decision_id:string}
export interface CashbookEffectDto {id:string;request_id:string;decision_id:string;actor_id:string;recorded_at:string;version:3;legs:{location_id:string;direction:'in'|'out';amount_paise:string}[]}
export interface CashbookLocationPosition {location_id:string;known_inflows_paise:string;known_outflows_paise:string;known_recorded_paise:string;available_paise:string;pending_reserved_paise:string;shortfall_paise:string;unknown_sources:number;state:'recorded'|'incomplete'|'exception'}
export interface CashbookPositionSnapshot {as_of:string;source_version:number;locations:CashbookLocationPosition[];unknown_sources:number}


export type CashHandoverState='requested'|'partially_accepted'|'accepted'|'rejected'|'cancelled';
export interface CashHandoverInput {
 source_location_id:string;source_revision_id:string;target_location_id:string;target_revision_id:string;
 expected_source_version:number;amount_paise:number;currency:'INR';reason:string;occurred_at:string;
}
export interface CashHandoverRequestDto extends CashHandoverInput {id:string;actor_id:string;recorded_at:string;version:1}
export interface CashHandoverCommandInput {kind:'accept'|'reject'|'cancel';expected_version:number;expected_source_version:number;amount_paise:number;currency:'INR';reason:string}
export interface CashHandoverCommandDto {
 id:string;handover_id:string;version:number;kind:'accept'|'reject'|'cancel';amount_paise:number;currency:'INR';reason:string;
 actor_id:string;recorded_at:string;accepted_paise:number;remaining_paise:number;ended_paise:number;state:Exclude<CashHandoverState,'requested'>;
 legs:{location_id:string;direction:'in'|'out';amount_paise:string}[];
}
export interface CashHandoverDetail {source_custodian_id:string;target_custodian_id:string;request:CashHandoverRequestDto;version:number;accepted_paise:number;remaining_paise:number;ended_paise:number;state:CashHandoverState;current_source_version:number;commands:CashHandoverCommandDto[];next_cursor:number|null}

export interface CashHandoverTargets {source_location_id:string;source_revision_id:string;current_source_version:number;items:{id:string;revision_id:string;name:string;custodian_id:string}[];next_cursor:string|null}

export interface CashHandoverListItem {id:string;source_location_id:string;target_location_id:string;actor_id:string;amount_paise:number;accepted_paise:number;remaining_paise:number;ended_paise:number;version:number;state:CashHandoverState;occurred_at:string;recorded_at:string}
export interface CashHandoverList {items:CashHandoverListItem[];next_cursor:string|null;current_source_version:number}

export type CashbookRequestState='requested'|'approved'|'rejected'|'applied';
export interface CashbookRequestListItem {
 id:string;payment_method:ReceiptMethod|null;kind:CashMovementKind;category:ExpenseCategory|null;amount_paise:number;currency:'INR';
 source_location_id:string;target_location_id:string|null;responsible_employee_id:string;actor_id:string;
 occurred_at:string;recorded_at:string;state:CashbookRequestState;version:1|2|3;
 correction_of:string|null;corrected_by:string|null;
}
/** Live bounded request inbox, not a captured monetary report. Private payees remain in scoped detail. */
export interface CashbookRequestList {as_of:string;items:CashbookRequestListItem[];next_cursor:string|null;current_source_version:number}

export type CashbookSourceKind='cod_remittance'|'agent_fee_payment'|'agent_advance'|'receipt'|'refund'|'refund_correction'|'legacy_collection'|'legacy_collection_correction'|'expense'|'opening_float'|'owner_funds'|'deposit'|'withdrawal'|'correction'|'handover';
export interface CashbookReportFilter {from_day:string;to_day:string;sort:'occurred_asc'|'occurred_desc';payment_method:ReceiptMethod|null;kind:CashbookSourceKind|null;location_id:string|null}
export interface CashbookSourceRow {payment_method:ReceiptMethod|null;id:string;source_kind:CashbookSourceKind;source_id:string;location_id:string|null;account_id:string|null;direction:'in'|'out';amount_paise:string;occurred_at:string;recorded_at:string;actor_id:string;request_id:string|null;correction_of:string|null;unknown_reason:string|null}
export interface CashbookSourceTotals {count:number;known_inflows_paise:string;known_outflows_paise:string;known_net_paise:string;unknown_inflows_paise:string;unknown_outflows_paise:string;unknown_sources:number}
export interface CashbookReportSnapshot {id:string;schema_version:1;definition:'cashbook_sources_v1';organization_id:string;franchise_id:string;timezone:'Asia/Kolkata';filter:CashbookReportFilter;as_of:string;expires_at:string;count:number;totals:CashbookSourceTotals;position:CashbookPositionSnapshot}
export interface CashbookReportPage {snapshot:CashbookReportSnapshot;rows:CashbookSourceRow[];next_offset:number|null}

/** Frozen provenance of one actual acknowledgement; totals cover every row. */
export interface CashAttributionItem {
 ordinal:number;source_kind:string;source_id:string;origin_location_id:string;origin_recorded_at:string;
 component_kind:'freight'|'cod'|'unallocated'|'other_funds'|'unattributed';component_id:string;
 receipt_id:string|null;cod_allocation_id:string|null;booking_id:string|null;amount_paise:string;component_captured_at:string|null;
}
export interface CashAttributionPage {
 handover_id:string;command_id:string;as_of:string;amount_paise:string;attributed_paise:string;unattributed_paise:string;unallocated_paise:string;
 coverage:'captured'|'legacy_unattributed';items:CashAttributionItem[];next_cursor:string|null;
}

/** Own sending locations only; no general ledger or account projection. */
export interface CashHandoverSource {id:string;name:string;custodian_id:string;kind:'cash';active:true}
export interface CashHandoverSources {items:CashHandoverSource[];next_cursor:string|null}
