import { reportLimits,type AgeingFilter,type AgeingAdvance,type AgeingRow } from '@shippingco/shared';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import { ageing } from './ageing-rules.ts';

export async function checkAgeingCustomer(scope:TenantAccess,customer:string|null) {
  if(customer!==null&&!(await scopedQuery(scope,['reports.capture'],`SELECT id FROM shipit.customers
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[customer])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function captureAgeing(scope:TenantAccess,filter:AgeingFilter) {
  // One statement captures charge, ledger, corrections and operational status together.
  // Aggregate each source independently before joining: neither parcels nor payments multiply debt.
  const result=(await scopedQuery<{as_of:Date;rows:AgeingRow[];advances:AgeingAdvance[]}>(scope,['reports.capture'],`
    SELECT captured.* FROM (WITH sources AS (
      SELECT b.id,b.confirmed_at,jsonb_build_object(
        'id',b.id,'customer_id',COALESCE(ab.debtor_customer_id,b.customer_id),'shipping_customer_id',b.customer_id,'account_id',ab.account_id,'account_revision_id',ab.account_revision_id,'statement_id',st.id,'confirmed_at',to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'booking_version',b.version,'obligation_id',o.id,'payment_version',p.version,'financial_version',a.version,
        'original_gross',o.total_paise::text,'reductions',a.reduction::text,'gross',(o.total_paise-a.reduction)::text,
        'collections',p.collections::text,'reversals',p.reversals::text,'refunds',a.refunds::text,
        'net_collections',(p.collections-p.reversals-a.refunds)::text,
        'outstanding',greatest(o.total_paise-a.reduction-p.collections+p.reversals+a.refunds,0)::text,
        'refundable_credit',greatest(p.collections-p.reversals-a.refunds-o.total_paise+a.reduction,0)::text,
        'due_at',to_char(ab.due_date::timestamp AT TIME ZONE 'Asia/Kolkata' AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'overdue',NULL,'parcels',parcels.items,'entries',p.entries,'changes',a.changes) row
      FROM shipit.bookings b JOIN shipit.booking_obligations o
        ON o.organization_id=b.organization_id AND o.franchise_id=b.franchise_id AND o.booking_id=b.id
      LEFT JOIN shipit.customer_account_bookings ab ON ab.organization_id=b.organization_id AND ab.franchise_id=b.franchise_id AND ab.booking_id=b.id
      LEFT JOIN LATERAL(SELECT id FROM shipit.account_statements st WHERE st.organization_id=b.organization_id AND st.franchise_id=b.franchise_id AND st.account_id=ab.account_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(st.snapshot->'lines') line WHERE line->>'booking_id'=b.id::text) ORDER BY st.revision DESC LIMIT 1) st ON true
      CROSS JOIN LATERAL (SELECT COALESCE(sum(e.amount_paise::numeric) FILTER(WHERE e.kind='collection'),0) collections,
        COALESCE(sum(e.amount_paise::numeric) FILTER(WHERE e.kind='reversal'),0) reversals,COALESCE(max(e.sequence),0) version,
        COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'receipt_id',ra.receipt_id,'allocation_id',ra.id,'kind',e.kind,'amount',e.amount_paise::text,'version',e.sequence,
          'occurred_at',to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reversal_of',e.reversal_of) ORDER BY e.sequence),'[]'::jsonb) entries
        FROM shipit.payment_entries e LEFT JOIN shipit.money_receipt_allocations ra ON ra.organization_id=e.organization_id AND ra.franchise_id=e.franchise_id AND ra.payment_entry_id=e.id WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id AND e.obligation_id=o.id) p
      CROSS JOIN LATERAL (SELECT COALESCE(sum(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding),0) reduction,
        COALESCE(sum(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0) refunds,COALESCE(max(c.version),0) version,
        COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'version',c.version,
          'reduction',(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding)::text,'refund',(CASE WHEN c.kind='refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END)::text,
          'occurred_at',to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.version),'[]'::jsonb) changes
        FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id) a
      CROSS JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',x.id,'status',x.status) ORDER BY x.position) items,
        bool_or(x.status=$2) matches FROM shipit.parcels x
        WHERE x.organization_id=b.organization_id AND x.franchise_id=b.franchise_id AND x.booking_id=b.id) parcels
      WHERE {{franchise:b.organization_id:b.franchise_id}} AND ($1::uuid IS NULL OR COALESCE(ab.debtor_customer_id,b.customer_id)=$1)
        AND ($2::text IS NULL OR parcels.matches)
        AND ($3='all' OR o.total_paise-a.reduction-p.collections+p.reversals+a.refunds>0)
      AND (NOT $5::boolean OR (ab.due_date<(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date AND o.total_paise-a.reduction-p.collections+p.reversals+a.refunds>0))
      ORDER BY b.confirmed_at,b.id LIMIT $4
    ), advances AS (
      SELECT mr.id,jsonb_build_object('customer_id',mr.customer_id,'receipt_id',mr.id,'version',(mc.result->>'version')::int,
      'received',mr.amount_paise::text,'allocated',mc.result->>'allocated_paise','cod_reserved',cp.reserved::text,'returned',rf.returned::text,
      'unallocated',(mr.amount_paise-(mc.result->>'allocated_paise')::numeric-cp.reserved-rf.returned)::text) row
      FROM shipit.money_receipts mr
      JOIN LATERAL(SELECT result FROM shipit.money_receipt_commands c WHERE c.organization_id=mr.organization_id AND c.franchise_id=mr.franchise_id AND c.receipt_id=mr.id AND c.state='committed' ORDER BY version DESC LIMIT 1) mc ON true
      CROSS JOIN LATERAL(SELECT COALESCE(sum(reserved_paise),0) reserved FROM shipit.cod_receipt_positions p WHERE p.organization_id=mr.organization_id AND p.franchise_id=mr.franchise_id AND p.receipt_id=mr.id) cp
      CROSS JOIN LATERAL(SELECT COALESCE(sum(amount_paise::numeric),0) returned FROM shipit.advance_refund_commands f WHERE f.organization_id=mr.organization_id AND f.franchise_id=mr.franchise_id AND f.receipt_id=mr.id AND f.operation='return') rf
      WHERE {{franchise:mr.organization_id:mr.franchise_id}} AND ($1::uuid IS NULL OR mr.customer_id=$1)
      AND mr.amount_paise>(mc.result->>'allocated_paise')::numeric+cp.reserved+rf.returned ORDER BY mr.id LIMIT $4
    ) SELECT statement_timestamp() as_of,COALESCE((SELECT jsonb_agg(row ORDER BY confirmed_at,id) FROM sources),'[]'::jsonb) rows,
      COALESCE((SELECT jsonb_agg(row ORDER BY id) FROM advances),'[]'::jsonb) advances) captured`,[filter.customer_id,filter.status,filter.balances,reportLimits.rows+1,filter.overdue_only??false])).rows[0]!;
  if(result.rows.length>reportLimits.rows||result.advances.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  const as_of=result.as_of.toISOString();
  return {as_of,advances:result.advances,rows:result.rows.map(r=>({...r,overdue:r.due_at===null?null:BigInt(r.outstanding)>0&&ageing(r.due_at,as_of).age_days!>0,...ageing(filter.anchor==='booking'?r.confirmed_at:r.due_at,as_of)}))};
}
