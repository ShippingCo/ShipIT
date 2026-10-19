import {reportLimits,type AccountantRow,type AccountantFilter} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {utcRange} from './rules.ts';
/** The caller establishes a serializable snapshot before authorization, locks and these source reads. */
export async function captureAccountant(scope:TenantAccess,filter:AccountantFilter) {
 const range=utcRange(filter);
 const result=(await scopedQuery<{rows:Omit<AccountantRow,'id'>[];count:number;controls:{family:string;basis:string;column:string;source_paise:string}[]}>(scope,['reports.capture'],`SELECT result.* FROM LATERAL (WITH raw_sources AS (
 SELECT 'sales'::text family,'economic_sale'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT b.id::text AS source_id,
 b.franchise_id::text AS franchise_id,
 (b.version)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 b.id::text AS booking_id,
 b.customer_id::text AS customer_id,
 b.tax_snapshot->>'pre_tax_paise' AS pre_tax_paise,
 b.tax_snapshot->>'taxable_basis_paise' AS taxable_paise,
 ((b.tax_snapshot->>'pre_tax_paise')::numeric-(b.tax_snapshot->>'taxable_basis_paise')::numeric)::text AS non_taxable_paise,
 b.tax_snapshot->>'cgst_paise' AS cgst_paise,
 b.tax_snapshot->>'sgst_paise' AS sgst_paise,
 b.tax_snapshot->>'igst_paise' AS igst_paise,
 b.tax_snapshot->>'rounding_adjustment_paise' AS rounding_paise,
 b.final_payable_paise::text AS gross_paise,
 b.tax_snapshot->>'policy_id' AS tax_policy_id,
 b.tax_snapshot->>'treatment' AS tax_treatment,
 b.tax_snapshot->>'jurisdiction' AS tax_jurisdiction,
 (b.tax_snapshot->'components')::text AS tax_components,
 CASE WHEN EXISTS(SELECT 1 FROM shipit.issued_receipts d WHERE d.organization_id=b.organization_id AND d.franchise_id=b.franchise_id AND d.booking_id=b.id AND d.kind='booking_charge') THEN 'booking_charge_receipt' ELSE 'unknown:not_issued' END AS document_state FROM shipit.bookings b  WHERE {{franchise:b.organization_id:b.franchise_id}} AND true AND b.confirmed_at<$2::timestamptz) r
 UNION ALL
 SELECT 'receipts'::text family,'economic_receipt'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT r.id::text AS source_id,
 r.franchise_id::text AS franchise_id,
 (1)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 r.id::text AS receipt_id,
 r.customer_id::text AS customer_id,
 r.method AS method,
 r.receiver_id::text AS receiver_id,
 r.initial_custodian_id::text AS initial_custodian_id,
 r.amount_paise::text AS received_paise,
 r.account_id::text AS account_id,
 r.account_revision_id::text AS account_revision_id,
 r.external_reference AS external_reference,
 to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
 'recorded:not_bank_verified'::text AS verification FROM shipit.money_receipts r  WHERE {{franchise:r.organization_id:r.franchise_id}} AND true AND r.occurred_at<$2::timestamptz) r
 UNION ALL
 SELECT 'allocations'::text family,'reference_allocation'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT a.id::text AS source_id,
 a.franchise_id::text AS franchise_id,
 (a.command_version)::text AS source_version,
 (a.release_of)::text AS correction_of,
 to_char(c.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 a.receipt_id::text AS receipt_id,
 a.booking_id::text AS booking_id,
 a.payment_entry_id::text AS payment_entry_id,
 a.kind AS kind,
 (CASE a.kind WHEN 'allocation' THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END)::text AS allocated_paise FROM shipit.money_receipt_allocations a JOIN shipit.money_receipt_commands c ON c.organization_id=a.organization_id AND c.franchise_id=a.franchise_id AND c.id=a.command_id WHERE {{franchise:a.organization_id:a.franchise_id}} AND true AND c.recorded_at<$2::timestamptz) r
 UNION ALL
 SELECT 'legacy_receipts'::text family,'economic_legacy_receipt'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT p.id::text AS source_id,
 p.franchise_id::text AS franchise_id,
 (p.sequence)::text AS source_version,
 (p.reversal_of)::text AS correction_of,
 to_char(p.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 p.booking_id::text AS booking_id,
 p.kind AS kind,
 p.method AS method,
 (CASE p.kind WHEN 'collection' THEN p.amount_paise::numeric ELSE -p.amount_paise::numeric END)::text AS received_paise,
 'unknown:legacy_account_and_custody'::text AS verification FROM shipit.payment_entries p  WHERE {{franchise:p.organization_id:p.franchise_id}} AND NOT EXISTS(SELECT 1 FROM shipit.money_receipt_allocations a WHERE a.organization_id=p.organization_id AND a.franchise_id=p.franchise_id AND a.payment_entry_id=p.id) AND p.occurred_at<$2::timestamptz) r
 UNION ALL
 SELECT 'adjustments'::text family,'economic_charge_correction'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT c.id::text AS source_id,
 c.franchise_id::text AS franchise_id,
 (c.version)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 c.booking_id::text AS booking_id,
 c.kind AS kind,
 c.payment_version::text AS payment_version,
 c.reason AS reason,
 c.approval_ref AS approval_ref,
 c.pre_tax::text AS pre_tax_reduction_paise,
 c.taxable::text AS taxable_reduction_paise,
 c.cgst::text AS cgst_reduction_paise,
 c.sgst::text AS sgst_reduction_paise,
 c.igst::text AS igst_reduction_paise,
 c.rounding::text AS rounding_reduction_paise,
 (c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding)::text AS gross_reduction_paise,
 'financial_adjustment:not_statutory_credit_note'::text AS qualification FROM shipit.financial_changes c  WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.kind NOT IN ('refund','refund_correction') AND c.occurred_at<$2::timestamptz) r
 UNION ALL
 SELECT 'refunds'::text family,'economic_refund_or_correction'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT c.id::text AS source_id,
 c.franchise_id::text AS franchise_id,
 (c.version)::text AS source_version,
 (c.refund_correction_of)::text AS correction_of,
 to_char(COALESCE(e.occurred_at,o.occurred_at,c.occurred_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 c.booking_id::text AS booking_id,
 c.kind AS kind,
 (CASE c.kind WHEN 'refund' THEN c.refund::numeric ELSE -c.refund::numeric END)::text AS refunded_paise,
 e.method AS method,
 e.source_account_id::text AS account_id,
 e.transfer_ref AS transfer_ref,
 to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at,
 CASE WHEN e.id IS NULL THEN 'unknown:legacy_return_evidence' WHEN c.kind='refund_correction' THEN 'correction:not_new_transfer' ELSE 'recorded:actual_return' END AS verification FROM shipit.financial_changes c LEFT JOIN shipit.financial_changes o ON o.organization_id=c.organization_id AND o.franchise_id=c.franchise_id AND o.id=c.refund_correction_of LEFT JOIN shipit.financial_refund_evidence e ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.id=COALESCE(c.refund_correction_of,c.id) WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.kind IN ('refund','refund_correction') AND COALESCE(e.occurred_at,o.occurred_at,c.occurred_at)<$2::timestamptz) r
 UNION ALL
 SELECT 'advance_returns'::text family,'economic_advance_return'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT f.id::text AS source_id,
 f.franchise_id::text AS franchise_id,
 (f.version)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char((f.input->>'occurred_at')::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 f.receipt_id::text AS receipt_id,
 f.request_id::text AS request_id,
 f.amount_paise::text AS returned_paise,
 f.input->>'method' AS method,
 f.source_account_id::text AS account_id,
 f.input->>'transfer_ref' AS transfer_ref FROM shipit.advance_refund_commands f  WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.operation='return' AND (f.input->>'occurred_at')::timestamptz<$2::timestamptz) r
 UNION ALL
 SELECT 'documents'::text family,'reference_document'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT d.id::text AS source_id,
 d.franchise_id::text AS franchise_id,
 (d.version)::text AS source_version,
 (d.correction_of)::text AS correction_of,
 to_char(d.issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 d.booking_id::text AS booking_id,
 d.kind AS document_type,
 d.number AS document_number,
 d.payment_entry_id::text AS payment_entry_id,
 'issued_receipt:not_tax_invoice'::text AS qualification FROM shipit.issued_receipts d  WHERE {{franchise:d.organization_id:d.franchise_id}} AND true AND d.issued_at<$2::timestamptz) r
 UNION ALL
 SELECT 'statements'::text family,'reference_document'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT s.id::text AS source_id,
 s.franchise_id::text AS franchise_id,
 (COALESCE(s.revision,1))::text AS source_version,
 (s.previous_statement_id)::text AS correction_of,
 to_char(s.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 s.account_id::text AS account_id,
 s.customer_id::text AS customer_id,
 s.from_day::text AS from_day,
 s.to_day::text AS to_day,
 CASE WHEN s.account_id IS NULL THEN 'legacy_account_statement' ELSE 'account_statement_v2' END AS document_type,
 s.snapshot->>'number' AS document_number,
 'statement:not_tax_invoice'::text AS qualification,
 s.source_digest AS source_digest FROM shipit.account_statements s  WHERE {{franchise:s.organization_id:s.franchise_id}} AND true AND s.occurred_at<$2::timestamptz) r
 UNION ALL
 SELECT 'statement_shipments'::text family,'reference_relationship'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT s.id::text AS source_id,
 s.franchise_id::text AS franchise_id,
 (COALESCE(s.revision,1))::text AS source_version,
 (s.previous_statement_id)::text AS correction_of,
 to_char(s.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 member.booking_id::text AS booking_id,
 s.id::text AS statement_id FROM shipit.account_statements s CROSS JOIN LATERAL (SELECT l.booking_id FROM shipit.account_statement_lines l WHERE l.organization_id=s.organization_id AND l.franchise_id=s.franchise_id AND l.statement_id=s.id UNION SELECT (line->>'booking_id')::uuid FROM jsonb_array_elements(COALESCE(s.snapshot->'lines','[]'::jsonb)) line WHERE line->>'booking_id' IS NOT NULL) member WHERE {{franchise:s.organization_id:s.franchise_id}} AND true AND s.occurred_at<$2::timestamptz) r
 UNION ALL
 SELECT 'document_links'::text family,'reference_unqualified_document'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT q.id::text AS source_id,
 q.franchise_id::text AS franchise_id,
 (1)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(q.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 q.booking_id::text AS booking_id,
 l.ordinal::text AS ordinal,
 l.kind AS document_type,
 l.receipt_id::text AS document_id,
 l.external_ref AS external_reference,
 'unverified:external_document_qualification_required'::text AS qualification FROM shipit.financial_adjustment_requests q JOIN shipit.financial_document_links l ON l.organization_id=q.organization_id AND l.franchise_id=q.franchise_id AND l.request_id=q.id WHERE {{franchise:q.organization_id:q.franchise_id}} AND true AND q.recorded_at<$2::timestamptz) r
 UNION ALL
 SELECT 'cashbook'::text family,'economic_expense_or_nonrevenue_movement'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT r.id::text AS source_id,
 r.franchise_id::text AS franchise_id,
 (1)::text AS source_version,
 (r.correction_of)::text AS correction_of,
 to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 r.kind AS kind,
 r.category AS category,
 e.id::text AS effect_id,
 e.decision_id::text AS decision_id,
 r.payment_method AS method,
 r.source_location_id::text AS source_location_id,
 r.target_location_id::text AS target_location_id,
 CASE WHEN r.kind='expense' THEN (r.amount_paise::numeric-COALESCE(old.amount_paise,0))::text ELSE '0' END AS expense_paise,
 CASE WHEN r.kind<>'expense' THEN (r.amount_paise::numeric-COALESCE(old.amount_paise,0))::text ELSE '0' END AS movement_paise,
 r.amount_paise::text AS revised_amount_paise,
 r.fee_earning_id::text AS fee_earning_id,
 (r.fee_cash_paise::numeric-COALESCE(old.fee_cash_paise,0))::text AS fee_cash_paise,
 (r.fee_advance_paise::numeric-COALESCE(old.fee_advance_paise,0))::text AS fee_advance_paise,
 r.fee_advance_request_id::text AS fee_advance_request_id,
 r.cod_allocation_id::text AS cod_allocation_id,
 r.agent_payee_id::text AS agent_id,
 r.payment_reference AS payment_reference,
 to_char(e.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recorded_at FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id LEFT JOIN shipit.cashbook_requests old ON old.organization_id=r.organization_id AND old.franchise_id=r.franchise_id AND old.id=r.correction_of WHERE {{franchise:r.organization_id:r.franchise_id}} AND true AND r.occurred_at<$2::timestamptz) r
 UNION ALL
 SELECT 'handovers'::text family,'reference_custody_request'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT h.id::text AS source_id,
 h.franchise_id::text AS franchise_id,
 (1)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(h.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 h.source_location_id::text AS source_location_id,
 h.target_location_id::text AS target_location_id,
 h.amount_paise::text AS requested_paise FROM shipit.cash_handovers h  WHERE {{franchise:h.organization_id:h.franchise_id}} AND true AND h.occurred_at<$2::timestamptz) r
 UNION ALL
 SELECT 'handover_acknowledgements'::text family,'reference_custody_acknowledgement'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT c.id::text AS source_id,
 c.franchise_id::text AS franchise_id,
 (c.version)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(c.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 c.handover_id::text AS handover_id,
 c.kind AS kind,
 c.state AS state,
 CASE WHEN c.kind='accept' THEN c.amount_paise::text ELSE '0' END AS acknowledged_paise,
 c.remaining_paise::text AS remaining_paise FROM shipit.cash_handover_commands c  WHERE {{franchise:c.organization_id:c.franchise_id}} AND true AND c.recorded_at<$2::timestamptz) r
 UNION ALL
 SELECT 'custody'::text family,'reference_custody_leg'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT f.source_id::text AS source_id,
 f.franchise_id::text AS franchise_id,
 (1)::text AS source_version,
 (f.correction_of)::text AS correction_of,
 to_char(f.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 f.source_kind AS source_kind,
 f.location_id::text AS location_id,
 f.account_id::text AS account_id,
 f.direction AS direction,
 (CASE f.direction WHEN 'in' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END)::text AS custody_paise,
 f.request_id::text AS request_id,
 f.unknown_reason AS unknown_reason,
 f.payment_method AS method FROM shipit.cashbook_source_facts f  WHERE {{franchise:f.organization_id:f.franchise_id}} AND true AND f.occurred_at<$2::timestamptz) r
 UNION ALL
 SELECT 'cod_reservations'::text family,'reference_seller_liability'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT a.id::text AS source_id,
 a.franchise_id::text AS franchise_id,
 (1)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(a.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 a.receipt_id::text AS receipt_id,
 b.booking_id::text AS booking_id,
 a.obligation_id::text AS obligation_id,
 a.obligation_revision_id::text AS obligation_revision_id,
 o.beneficiary_id::text AS beneficiary_id,
 a.amount_paise::text AS reserved_paise FROM shipit.cod_receipt_allocations a JOIN shipit.cod_obligation_revisions o ON o.organization_id=a.organization_id AND o.franchise_id=a.franchise_id AND o.id=a.obligation_revision_id JOIN shipit.cod_obligations b ON b.organization_id=a.organization_id AND b.franchise_id=a.franchise_id AND b.id=a.obligation_id WHERE {{franchise:a.organization_id:a.franchise_id}} AND true AND a.recorded_at<$2::timestamptz) r
 UNION ALL
 SELECT 'agent_fees'::text family,'reference_fee_entitlement'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT f.id::text AS source_id,
 f.franchise_id::text AS franchise_id,
 (1)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(f.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 f.agent_id::text AS agent_id,
 f.term_revision_id::text AS term_revision_id,
 f.basis AS basis,
 f.amount_paise::text AS earned_paise,
 f.proof_id::text AS proof_id,
 f.parcel_id::text AS parcel_id FROM shipit.agent_fee_earnings f  WHERE {{franchise:f.organization_id:f.franchise_id}} AND true AND f.recorded_at<$2::timestamptz) r
 UNION ALL
 SELECT 'settlements'::text family,'reference_review_not_transfer'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT s.id::text AS source_id,
 s.franchise_id::text AS franchise_id,
 (s.revision)::text AS source_version,
 (s.previous_submission_id)::text AS correction_of,
 to_char(s.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 s.agent_id::text AS agent_id,
 s.day::text AS day,
 s.capture_id::text AS capture_id FROM shipit.agent_settlement_submissions s  WHERE {{franchise:s.organization_id:s.franchise_id}} AND true AND s.recorded_at<$2::timestamptz) r
 UNION ALL
 SELECT 'settlement_decisions'::text family,'reference_review_not_transfer'::text meaning,CASE WHEN (r.occurred_at)::timestamptz<$1::timestamptz THEN 'opening' ELSE 'period' END basis,to_jsonb(r) fields FROM (SELECT d.id::text AS source_id,
 d.franchise_id::text AS franchise_id,
 (d.expected_version+1)::text AS source_version,
 (NULL::uuid)::text AS correction_of,
 to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at,
 d.submission_id::text AS submission_id,
 d.kind AS decision FROM shipit.agent_settlement_decisions d  WHERE {{franchise:d.organization_id:d.franchise_id}} AND true AND d.recorded_at<$2::timestamptz) r
 UNION ALL
 SELECT 'shipments'::text family,'reference_shipment:not_sale'::text meaning,CASE WHEN b.confirmed_at<$1::timestamptz THEN 'opening' ELSE 'period' END basis,
 jsonb_build_object('source_id',p.id::text,'franchise_id',p.franchise_id::text,'source_version','1','occurred_at',to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'booking_id',b.id::text,'docket',p.docket) fields
 FROM shipit.parcels p JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
 WHERE {{franchise:p.organization_id:p.franchise_id}} AND b.confirmed_at<$2::timestamptz
 UNION ALL
 SELECT 'cod_obligations'::text family,'reference_cod_configuration:not_collected_liability'::text meaning,CASE WHEN r.recorded_at<$1::timestamptz THEN 'opening' ELSE 'period' END basis,
 jsonb_build_object('source_id',r.id::text,'franchise_id',r.franchise_id::text,'source_version',r.version::text,'occurred_at',to_char(r.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'obligation_id',r.obligation_id::text,'booking_id',o.booking_id::text,'parcel_id',o.parcel_id::text,'beneficiary_id',r.beneficiary_id::text,'beneficiary_revision_id',r.beneficiary_revision_id::text,'configured_paise',r.amount_paise::text,'active',r.active::text) fields
 FROM shipit.cod_obligation_revisions r JOIN shipit.cod_obligations o ON o.organization_id=r.organization_id AND o.franchise_id=r.franchise_id AND o.id=r.obligation_id
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.recorded_at<$2::timestamptz
 ), sources AS (SELECT * FROM raw_sources LIMIT $3), bounded AS (SELECT * FROM sources ORDER BY family,fields->>'source_id',fields::text LIMIT $3),
 controls AS (SELECT family,basis,k.key AS column,sum(k.value::numeric)::text source_paise FROM sources CROSS JOIN LATERAL jsonb_each_text(fields) k
 WHERE right(k.key,6)='_paise' AND k.value IS NOT NULL GROUP BY family,basis,k.key)
 SELECT (SELECT count(*)::int FROM sources) count,
 COALESCE((SELECT jsonb_agg(to_jsonb(b) ORDER BY family,fields->>'source_id',fields::text) FROM bounded b),'[]'::jsonb) rows,
 COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY family,basis,c.column) FROM controls c),'[]'::jsonb) controls) result`,[range.from,range.to,reportLimits.rows+1])).rows[0]!;
 if(result.count>reportLimits.rows||result.rows.length!==result.count)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 return result;
}

/** Independent source equations, not totals of the exported register reducer. */
export async function capturePositions(scope:TenantAccess,filter:AccountantFilter) {
 const range=utcRange(filter);
 return (await scopedQuery<{id:string;franchise_id:string;basis:'opening'|'closing';gross_paise:string;allocated_paise:string;refund_paise:string;outstanding_paise:string;refundable_paise:string;payment_version:string;financial_version:string}>(scope,['reports.capture'],`SELECT b.id,b.franchise_id,w.basis,
 (b.final_payable_paise::numeric-c.reduction)::text gross_paise,p.collected::text allocated_paise,c.refund::text refund_paise,
 GREATEST(b.final_payable_paise::numeric-c.reduction-p.collected+c.refund,0)::text outstanding_paise,
 GREATEST(p.collected-c.refund-b.final_payable_paise::numeric+c.reduction,0)::text refundable_paise,p.version::text payment_version,c.version::text financial_version
 FROM shipit.bookings b CROSS JOIN (VALUES ('opening',$1::timestamptz),('closing',$2::timestamptz)) w(basis,cutoff)
 CROSS JOIN LATERAL(SELECT COALESCE(sum(CASE e.kind WHEN 'collection' THEN e.amount_paise::numeric ELSE -e.amount_paise::numeric END),0) collected,COALESCE(max(e.sequence),0) version
 FROM shipit.payment_entries e WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id AND e.occurred_at<w.cutoff) p
 CROSS JOIN LATERAL(SELECT COALESCE(sum(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding),0) reduction,
 COALESCE(sum(CASE c.kind WHEN 'refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0) refund,COALESCE(max(c.version),0) version
 FROM shipit.financial_changes c LEFT JOIN shipit.financial_changes original ON original.organization_id=c.organization_id AND original.franchise_id=c.franchise_id AND original.id=c.refund_correction_of
 LEFT JOIN shipit.financial_refund_evidence e ON e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id AND e.id=COALESCE(c.refund_correction_of,c.id)
 WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id AND COALESCE(e.occurred_at,original.occurred_at,c.occurred_at)<w.cutoff) c
 WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.confirmed_at<w.cutoff ORDER BY w.basis,b.id LIMIT $3`,[range.from,range.to,reportLimits.rows+1])).rows;
}

export async function reconciliationAccounts(scope:TenantAccess) {
 const rows=(await scopedQuery<{id:string;franchise_id:string;enabled:boolean}>(scope,['reports.capture'],`SELECT a.id,a.franchise_id,COALESCE(c.enabled,false) enabled FROM shipit.receiving_accounts a
 LEFT JOIN LATERAL(SELECT enabled FROM shipit.reconciliation_config_versions c WHERE c.organization_id=a.organization_id AND c.franchise_id=a.franchise_id ORDER BY version DESC LIMIT 1) c ON true
 WHERE {{franchise:a.organization_id:a.franchise_id}} ORDER BY a.id LIMIT 51`)).rows;
 if(rows.length>50)throw new HttpError('REPORT_LIMIT_EXCEEDED');return rows;
}

export async function captureAdvances(scope:TenantAccess,filter:AccountantFilter) {
 const range=utcRange(filter);
 return (await scopedQuery<{id:string;franchise_id:string;basis:'opening'|'closing';received_paise:string;allocated_paise:string;cod_reserved_paise:string;returned_paise:string;unallocated_paise:string;version:string}>(scope,['reports.capture'],`SELECT r.id,r.franchise_id,w.basis,r.amount_paise::text received_paise,
 a.allocated::text allocated_paise,c.reserved::text cod_reserved_paise,f.returned::text returned_paise,(r.amount_paise::numeric-a.allocated-c.reserved-f.returned)::text unallocated_paise,a.version::text version
 FROM shipit.money_receipts r CROSS JOIN (VALUES ('opening',$1::timestamptz),('closing',$2::timestamptz)) w(basis,cutoff)
 CROSS JOIN LATERAL(SELECT COALESCE(sum(CASE a.kind WHEN 'allocation' THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END),0) allocated,COALESCE(max(a.command_version),1) version
 FROM shipit.money_receipt_allocations a JOIN shipit.money_receipt_commands m ON m.organization_id=a.organization_id AND m.franchise_id=a.franchise_id AND m.id=a.command_id
 WHERE a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.receipt_id=r.id AND m.recorded_at<w.cutoff) a
 CROSS JOIN LATERAL(SELECT COALESCE(sum(c.amount_paise::numeric-COALESCE(v.reversed,0)),0) reserved FROM shipit.cod_receipt_allocations c
 LEFT JOIN LATERAL(SELECT sum(q.amount_paise::numeric-COALESCE(old.amount_paise,0)) reversed FROM shipit.cashbook_requests q JOIN shipit.cashbook_effects e ON e.organization_id=q.organization_id AND e.franchise_id=q.franchise_id AND e.request_id=q.id
 LEFT JOIN shipit.cashbook_requests old ON old.organization_id=q.organization_id AND old.franchise_id=q.franchise_id AND old.id=q.correction_of
 WHERE q.organization_id=c.organization_id AND q.franchise_id=c.franchise_id AND q.cod_allocation_id=c.id AND q.kind='cod_reservation_reversal' AND q.occurred_at<w.cutoff) v ON true
 WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.receipt_id=r.id AND c.recorded_at<w.cutoff) c
 CROSS JOIN LATERAL(SELECT COALESCE(sum(f.amount_paise::numeric),0) returned FROM shipit.advance_refund_commands f WHERE f.organization_id=r.organization_id AND f.franchise_id=r.franchise_id AND f.receipt_id=r.id AND f.operation='return' AND (f.input->>'occurred_at')::timestamptz<w.cutoff) f
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.occurred_at<w.cutoff ORDER BY w.basis,r.id LIMIT $3`,[range.from,range.to,reportLimits.rows+1])).rows;
}

export async function captureCodPositions(scope:TenantAccess,filter:AccountantFilter) {
 const range=utcRange(filter);
 return (await scopedQuery<{id:string;franchise_id:string;basis:'opening'|'closing';reserved_paise:string;remitted_paise:string;reversed_paise:string;remaining_paise:string}>(scope,['reports.capture'],`SELECT a.id,a.franchise_id,w.basis,a.amount_paise::text reserved_paise,
 c.remitted::text remitted_paise,c.reversed::text reversed_paise,(a.amount_paise::numeric-c.remitted-c.reversed)::text remaining_paise
 FROM shipit.cod_receipt_allocations a CROSS JOIN (VALUES ('opening',$1::timestamptz),('closing',$2::timestamptz)) w(basis,cutoff)
 CROSS JOIN LATERAL(SELECT COALESCE(sum(r.amount_paise::numeric-COALESCE(old.amount_paise,0)) FILTER(WHERE r.kind='cod_remittance'),0) remitted,
 COALESCE(sum(r.amount_paise::numeric-COALESCE(old.amount_paise,0)) FILTER(WHERE r.kind='cod_reservation_reversal'),0) reversed
 FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 LEFT JOIN shipit.cashbook_requests old ON old.organization_id=r.organization_id AND old.franchise_id=r.franchise_id AND old.id=r.correction_of
 WHERE r.organization_id=a.organization_id AND r.franchise_id=a.franchise_id AND r.cod_allocation_id=a.id AND r.occurred_at<w.cutoff) c
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.recorded_at<w.cutoff ORDER BY w.basis,a.id LIMIT $3`,[range.from,range.to,reportLimits.rows+1])).rows;
}

/** Applied fee expense/payment and recoverable agent advance balances; entitlement is separate. */
export async function captureAgentPositions(scope:TenantAccess,filter:AccountantFilter) {
 const range=utcRange(filter);
 return (await scopedQuery<{family:string;id:string;franchise_id:string;agent_id:string;basis:'opening'|'closing';fields:Record<string,string>}>(scope,['reports.capture'],`SELECT result.* FROM LATERAL (WITH RECURSIVE applied AS (
 SELECT r.*,r.amount_paise::numeric-COALESCE(p.amount_paise,0) delta,
 r.fee_cash_paise::numeric-COALESCE(p.fee_cash_paise,0) cash_delta,r.fee_advance_paise::numeric-COALESCE(p.fee_advance_paise,0) advance_delta
 FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
 LEFT JOIN shipit.cashbook_requests p ON p.organization_id=r.organization_id AND p.franchise_id=r.franchise_id AND p.id=r.correction_of
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.occurred_at<$2::timestamptz), ancestry AS (SELECT id origin,id FROM applied WHERE kind='agent_advance' AND correction_of IS NULL UNION ALL SELECT a.origin,r.id FROM ancestry a JOIN applied r ON r.correction_of=a.id WHERE r.kind='agent_advance'), windows AS (SELECT * FROM (VALUES ('opening',$1::timestamptz),('closing',$2::timestamptz)) w(basis,cutoff)),
 fee AS (SELECT 'agent_fee_positions'::text family,f.id,f.franchise_id,f.agent_id,w.basis,
 jsonb_build_object('earned_paise',f.amount_paise::text,'recognized_paise',a.expense::text,'paid_paise',a.paid::text,'advance_applied_paise',a.advance::text,'payable_paise',(a.expense-a.paid-a.advance)::text) fields
 FROM shipit.agent_fee_earnings f CROSS JOIN windows w CROSS JOIN LATERAL(
 SELECT COALESCE(sum(r.delta) FILTER(WHERE r.kind='expense'),0) expense,COALESCE(sum(r.cash_delta),0) paid,COALESCE(sum(r.advance_delta),0) advance FROM applied r
 WHERE r.organization_id=f.organization_id AND r.franchise_id=f.franchise_id AND r.fee_earning_id=f.id AND r.occurred_at<w.cutoff) a
 WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.recorded_at<w.cutoff),
 advance AS (SELECT 'agent_advance_positions'::text family,a.id,a.franchise_id,a.agent_payee_id agent_id,w.basis,
 jsonb_build_object('advanced_paise',d.advanced::text,'applied_paise',f.applied::text,'recoverable_paise',(d.advanced-f.applied)::text) fields
 FROM applied a CROSS JOIN windows w CROSS JOIN LATERAL(SELECT COALESCE(sum(r.delta),0) advanced FROM ancestry chain JOIN applied r ON r.id=chain.id WHERE chain.origin=a.id AND r.occurred_at<w.cutoff) d CROSS JOIN LATERAL(SELECT COALESCE(sum(r.advance_delta),0) applied FROM applied r WHERE r.organization_id=a.organization_id AND r.franchise_id=a.franchise_id AND r.fee_advance_request_id=a.id AND r.occurred_at<w.cutoff) f
 WHERE a.kind='agent_advance' AND a.correction_of IS NULL AND a.occurred_at<w.cutoff)
 SELECT * FROM fee UNION ALL SELECT * FROM advance ORDER BY family,id,basis LIMIT $3) result`,[range.from,range.to,reportLimits.rows+1])).rows;
}
