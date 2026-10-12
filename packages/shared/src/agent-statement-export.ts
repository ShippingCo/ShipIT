/** Public v1 statement CSV schema; money values are exact paise strings. */
export const statementExportSpecs=[
 ['cash','cash_facts','source_id','source_kind source_id location_id direction amount_paise occurred_at recorded_at request_id correction_of'],
 ['cash','receipts','receipt_id','receipt_id method amount_paise receiver_id initial_custodian_id occurred_at recorded_at'],
 ['finance','receipt_positions','receipt_id','receipt_id method received_paise freight_applied_paise cod_reserved_paise unallocated_paise'],
 ['finance','freight_applications','id','receipt_id booking_id kind amount_paise release_of recorded_at'],
 ['finance','cod_positions','allocation_id','allocation_id receipt_id obligation_id obligation_revision_id beneficiary_id beneficiary_revision_id collected_paise remitted_paise reversed_paise reserved_paise remaining_paise recorded_at'],
 ['finance','fee_positions','earning_id','earning_id term_revision_id basis proof_id parcel_id covered_from covered_until effective_at recorded_at earned_paise expense_paise direct_paid_paise cash_paid_paise noncash_paid_paise advance_applied_paise remaining_paise'],
 ['finance','advance_positions','origin_request_id','origin_request_id head_request_id payment_method paid_paise applied_paise unapplied_paise'],
 ['finance','financial_effects','request_id','request_id effect_id kind payment_method correction_of cod_allocation_id fee_earning_id fee_advance_request_id amount_paise fee_direct_paid_paise fee_advance_paise occurred_at recorded_at is_current_at_cutoff'],
 ['finance','handover_attributions','command_id','command_id ordinal source_kind source_id origin_location_id component_kind component_id receipt_id cod_allocation_id booking_id amount_paise'],
 ['parcels','held_positions','parcel_id','parcel_id opening_receipt_id closing_receipt_id'],
 ['parcels','transitions','receipt_id','receipt_id parcel_id attempt_id previous_receipt_id proof_id kind discrepancy outcome recorded_at'],
 ['parcels','delivery_proofs','proof_id','proof_id parcel_id attempt_id proof_method completed_at committed_at custody_receipt_id'],
 ['parcels','discrepancies','discrepancy_id','discrepancy_id parcel_id source_receipt_id reason recorded_at'],
 ] as const;
export const statementExportStatementFields='capture_id previous_submission_id actor_id reason recorded_at decision_id decision_kind decision_actor_id decision_reason decision_recorded_at decision_expected_version';
export const statementExportCashFields='opening_known_paise day_in_paise day_out_paise expected_paise counted_paise variance_paise shortage_paise excess_paise ledger_exception unassigned_franchise_sources_count source_version';
export const statementExportFinanceFields='received_paise freight_applied_paise cod_collected_paise cod_remitted_paise cod_reversed_paise origin_receipt_seller_liability_paise earned_fee_paise fee_expense_paise fee_direct_paid_paise fee_cash_paid_paise fee_noncash_paid_paise fee_advance_applied_paise remaining_fee_paise advance_paid_paise unapplied_advance_paise legacy_unattributed_handovers seller_liability_is_agent_debt';
export const statementExportParcelFields='opening_held received delivered_from_custody returned_to_office transferred_to_agent held_at_count proved_deliveries untracked_proved_deliveries reported_missing';
export const statementExportColumns=['snapshot_id','timezone','currency','export_as_of','statement_id','agent_id','day','revision','status','counted_at','source_as_of','record_kind','record_id',...new Set([statementExportStatementFields,statementExportCashFields,statementExportFinanceFields,statementExportParcelFields,...statementExportSpecs.map(s=>s[3])].flatMap(s=>s.split(' ')))] as const;
