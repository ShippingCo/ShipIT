import {reportLimits,type FinancialAuditFilter,type FinancialAuditRow} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {utcRange} from './rules.ts';
/** A single statement captures source facts and nested immutable lineage at one MVCC cutoff. */
export async function captureFinancialAudit(scope:TenantAccess,filter:FinancialAuditFilter) {
 const range=utcRange(filter);
 const result=(await scopedQuery<{as_of:Date;rows:FinancialAuditRow[]}>(scope,['reports.capture'],`
 SELECT result.* FROM LATERAL (
 WITH facts(organization_id,franchise_id,id,kind,change_kind,status,source_type,source_id,booking_id,receipt_id,actor_id,recorded_at,reason,version,correction_of,policy_id,threshold,additional_review,approval_basis,approved_actor,amount_basis,before_paise,proposed_paise) AS (
 SELECT r.organization_id,r.franchise_id,'request:'||r.id,CASE WHEN r.supersedes_id IS NOT NULL THEN 'request_amendment' ELSE r.kind END,r.kind,COALESCE(d.outcome,'pending'),'financial_request',r.id,r.booking_id,NULL::uuid,r.actor_id,r.recorded_at,r.reason,COALESCE(d.version,0),COALESCE(r.supersedes_id,r.refund_correction_of),r.policy_id,policy.discount_review_threshold_paise,
 CASE WHEN r.kind='discount' AND policy.discount_review_threshold_paise IS NOT NULL THEN r.pre_tax::numeric+r.cgst+r.sgst+r.igst+r.rounding>policy.discount_review_threshold_paise ELSE NULL END,
 CASE WHEN r.policy_id IS NULL THEN 'unconfigured_policy' ELSE 'financial_policy' END,approved.actor_id,CASE WHEN r.kind IN ('refund','refund_correction') THEN 'net_recorded_refunds' ELSE 'charge_gross' END,
 CASE WHEN r.kind IN ('refund','refund_correction') THEN a.refunds ELSE b.final_payable_paise-a.reduction END,
 CASE WHEN r.kind='refund' THEN a.refunds+r.refund WHEN r.kind='refund_correction' THEN a.refunds-r.refund ELSE b.final_payable_paise-a.reduction-r.pre_tax-r.cgst-r.sgst-r.igst-r.rounding END
 FROM shipit.financial_adjustment_requests r
 JOIN shipit.bookings b ON b.organization_id=r.organization_id AND b.franchise_id=r.franchise_id AND b.id=r.booking_id
 LEFT JOIN shipit.financial_policy_revisions policy ON policy.organization_id=r.organization_id AND policy.franchise_id=r.franchise_id AND policy.id=r.policy_id
 LEFT JOIN LATERAL (SELECT outcome,version FROM shipit.financial_request_decisions WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND request_id=r.id ORDER BY version DESC LIMIT 1) d ON true
 LEFT JOIN LATERAL (SELECT actor_id FROM shipit.financial_request_decisions WHERE organization_id=r.organization_id AND franchise_id=r.franchise_id AND request_id=r.id AND outcome='approved') approved ON true
 CROSS JOIN LATERAL (SELECT COALESCE(sum(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding),0) reduction,COALESCE(sum(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0) refunds
 FROM shipit.financial_changes c WHERE c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.booking_id=r.booking_id AND c.version<=r.expected_financial_version) a
 WHERE {{franchise:r.organization_id:r.franchise_id}}
 UNION ALL
 SELECT c.organization_id,c.franchise_id,'change:'||c.id,c.kind,c.kind,'recorded','financial_change',c.id,c.booking_id,NULL::uuid,c.actor_id,c.occurred_at,c.reason,c.version,c.refund_correction_of,NULL::uuid,NULL::bigint,NULL::boolean,'legacy_manual_reference',NULL::uuid,
 CASE WHEN c.kind IN ('refund','refund_correction') THEN 'net_recorded_refunds' ELSE 'charge_gross' END,
 CASE WHEN c.kind IN ('refund','refund_correction') THEN a.refunds ELSE b.final_payable_paise-a.reduction END,
 CASE WHEN c.kind='refund' THEN a.refunds+c.refund WHEN c.kind='refund_correction' THEN a.refunds-c.refund ELSE b.final_payable_paise-a.reduction-c.pre_tax-c.cgst-c.sgst-c.igst-c.rounding END
 FROM shipit.financial_changes c JOIN shipit.bookings b ON b.organization_id=c.organization_id AND b.franchise_id=c.franchise_id AND b.id=c.booking_id
 CROSS JOIN LATERAL (SELECT COALESCE(sum(x.pre_tax::numeric+x.cgst+x.sgst+x.igst+x.rounding),0) reduction,COALESCE(sum(CASE WHEN x.kind='refund_correction' THEN -x.refund::numeric ELSE x.refund::numeric END),0) refunds FROM shipit.financial_changes x
 WHERE x.organization_id=c.organization_id AND x.franchise_id=c.franchise_id AND x.booking_id=c.booking_id AND x.version<c.version) a
 WHERE {{franchise:c.organization_id:c.franchise_id}} AND NOT EXISTS(SELECT 1 FROM shipit.financial_request_decisions d WHERE d.organization_id=c.organization_id AND d.franchise_id=c.franchise_id AND d.financial_change_id=c.id)
 UNION ALL
 SELECT q.organization_id,q.franchise_id,'quote:'||q.id,'price_override','price_override',CASE WHEN q.result->>'override_status'='privileged' THEN 'approved' ELSE 'recorded' END,'pricing_quote',q.id,booked.id,NULL::uuid,q.actor_id,a.occurred_at,a.reason_code,a.committed_version,NULL::uuid,q.version_id,(q.result->'policy'->>'override_tolerance_paise')::bigint,
 abs((q.result->>'variance_paise')::numeric)>(q.result->'policy'->>'override_tolerance_paise')::numeric,'quote_tolerance',(q.result->>'approval_actor_id')::uuid,'freight',(q.result->>'freight_suggestion_paise')::numeric,(q.result->>'freight_paise')::numeric
 FROM shipit.pricing_quotes q JOIN shipit.pricing_audit_events a ON a.organization_id=q.organization_id AND a.franchise_id=q.franchise_id AND a.quote_id=q.id
 LEFT JOIN LATERAL (SELECT CASE WHEN count(*)=1 THEN min(b.id::text)::uuid END id FROM shipit.bookings b WHERE b.organization_id=q.organization_id AND b.franchise_id=q.franchise_id AND b.pricing_quote_id=q.id AND ($6::uuid IS NULL OR b.id=$6)) booked ON true
 WHERE {{franchise:q.organization_id:q.franchise_id}} AND a.action IN ('pricing.override','pricing.override.approve')
 UNION ALL
 SELECT e.organization_id,e.franchise_id,'payment:'||e.id,'collection_correction','collection_correction','recorded','payment_entry',e.id,e.booking_id,NULL::uuid,e.actor_id,c.committed_at,e.reason_code,e.sequence,e.reversal_of,NULL::uuid,NULL::bigint,NULL::boolean,'administrator_command',e.actor_id,'recorded_collection',original.amount_paise-prior.amount,original.amount_paise-prior.amount-e.amount_paise
 FROM shipit.payment_entries e JOIN shipit.payment_entries original ON original.organization_id=e.organization_id AND original.franchise_id=e.franchise_id AND original.booking_id=e.booking_id AND original.id=e.reversal_of
 JOIN shipit.payment_commands c ON c.organization_id=e.organization_id AND c.franchise_id=e.franchise_id AND c.id=e.command_id AND c.state='committed'
 CROSS JOIN LATERAL (SELECT COALESCE(sum(x.amount_paise),0) amount FROM shipit.payment_entries x WHERE x.organization_id=e.organization_id AND x.franchise_id=e.franchise_id AND x.booking_id=e.booking_id AND x.reversal_of=e.reversal_of AND x.sequence<e.sequence) prior
 WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.kind='reversal' AND c.receipt_command_id IS NULL
 UNION ALL
 SELECT c.organization_id,c.franchise_id,'receipt_command:'||c.id,'receipt_correction','receipt_correction','recorded','money_receipt_command',c.id,original.booking_id,c.receipt_id,c.principal_id,c.recorded_at,c.input->>'reason_code',c.version,original.id,NULL::uuid,NULL::bigint,NULL::boolean,'administrator_command',c.principal_id,'allocated_collection',original.amount_paise-prior.amount,original.amount_paise-prior.amount-(c.input->>'amount_paise')::numeric
 FROM shipit.money_receipt_commands c JOIN shipit.money_receipt_allocations original ON original.organization_id=c.organization_id AND original.franchise_id=c.franchise_id AND original.receipt_id=c.receipt_id AND original.id=(c.input->>'allocation_id')::uuid
 CROSS JOIN LATERAL (SELECT COALESCE(sum(x.amount_paise),0) amount FROM shipit.money_receipt_allocations x WHERE x.organization_id=c.organization_id AND x.franchise_id=c.franchise_id AND x.receipt_id=c.receipt_id AND x.release_of=original.id AND x.command_version<c.version) prior
 WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.operation_id='api.v1.money_receipts.correct' AND c.state='committed'
 UNION ALL
 SELECT n.organization_id,n.franchise_id,'denial:'||n.id,'deletion_denied','deletion_denied','denied','financial_deletion_denial',n.id,r.booking_id,NULL::uuid,n.actor_id,n.recorded_at,'hard_delete_forbidden',1,n.request_id,NULL::uuid,NULL::bigint,NULL::boolean,'not_applicable',NULL::uuid,'none',NULL::numeric,NULL::numeric
 FROM shipit.financial_deletion_denials n JOIN shipit.financial_adjustment_requests r ON r.organization_id=n.organization_id AND r.franchise_id=n.franchise_id AND r.id=n.request_id
 WHERE {{franchise:n.organization_id:n.franchise_id}}
 )
 SELECT statement_timestamp() as_of,COALESCE(jsonb_agg(jsonb_build_object('id',f.id,'kind',f.kind,'change_kind',f.change_kind,'status',f.status,'source_type',f.source_type,'source_id',f.source_id,'booking_id',f.booking_id,'receipt_id',f.receipt_id,'actor_id',f.actor_id,
 'recorded_at',to_char(f.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reason',f.reason,'version',f.version,'correction_of',f.correction_of,'policy_id',f.policy_id,'approval_threshold_paise',f.threshold::text,'additional_review_required',f.additional_review,'approval_basis',f.approval_basis,'approved_actor_id',f.approved_actor,'amount_basis',f.amount_basis,'before_paise',f.before_paise::text,'proposed_paise',f.proposed_paise::text,
 'decisions',CASE WHEN f.source_type='financial_request' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'actor_id',d.actor_id,'outcome',d.outcome,'version',d.version,'financial_change_id',d.financial_change_id,'recorded_at',to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY d.version) FROM shipit.financial_request_decisions d WHERE d.organization_id=f.organization_id AND d.franchise_id=f.franchise_id AND d.request_id=f.source_id),'[]'::jsonb) ELSE '[]'::jsonb END,
 'document_links',CASE WHEN f.source_type='financial_request' THEN COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',l.kind,'receipt_id',l.receipt_id,'external_ref',l.external_ref,'qualification',CASE WHEN l.kind='issued_receipt' THEN 'issued_source' ELSE 'unverified_external_reference' END) ORDER BY l.ordinal) FROM shipit.financial_document_links l WHERE l.organization_id=f.organization_id AND l.franchise_id=f.franchise_id AND l.request_id=f.source_id),'[]'::jsonb) ELSE '[]'::jsonb END
 ) ORDER BY f.recorded_at,f.id COLLATE "C"),'[]'::jsonb) rows FROM (
 SELECT * FROM facts WHERE recorded_at >= $1 AND recorded_at < $2 AND ($3::text IS NULL OR kind=$3) AND ($4::text IS NULL OR status=$4) AND ($5::uuid IS NULL OR actor_id=$5) AND ($6::uuid IS NULL OR booking_id=$6)
 ORDER BY recorded_at,id COLLATE "C" LIMIT $7) f) result`,[range.from,range.to,filter.kind,filter.status,filter.actor_id,filter.booking_id,reportLimits.rows+1])).rows[0]!;
 if(result.rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 if(filter.sort==='confirmed_desc')result.rows.reverse();return {as_of:result.as_of.toISOString(),rows:result.rows};
}
