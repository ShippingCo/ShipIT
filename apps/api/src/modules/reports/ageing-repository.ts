import { reportLimits,type AgeingFilter,type AgeingRow } from '@shippingco/shared';
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
  const result=(await scopedQuery<{as_of:Date;rows:AgeingRow[]}>(scope,['reports.capture'],`
    SELECT statement_timestamp() as_of,COALESCE(jsonb_agg(r.row ORDER BY r.confirmed_at,r.id),'[]'::jsonb) rows FROM (
      SELECT b.id,b.confirmed_at,jsonb_build_object(
        'id',b.id,'customer_id',b.customer_id,'confirmed_at',to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'booking_version',b.version,'obligation_id',o.id,'payment_version',p.version,'financial_version',a.version,
        'original_gross',o.total_paise::text,'reductions',a.reduction::text,'gross',(o.total_paise-a.reduction)::text,
        'collections',p.collections::text,'reversals',p.reversals::text,'refunds',a.refunds::text,
        'net_collections',(p.collections-p.reversals-a.refunds)::text,
        'outstanding',greatest(o.total_paise-a.reduction-p.collections+p.reversals+a.refunds,0)::text,
        'refundable_credit',greatest(p.collections-p.reversals-a.refunds-o.total_paise+a.reduction,0)::text,
        'due_at',NULL,'overdue',NULL,'parcels',parcels.items,'entries',p.entries,'changes',a.changes) row
      FROM shipit.bookings b JOIN shipit.booking_obligations o
        ON o.organization_id=b.organization_id AND o.franchise_id=b.franchise_id AND o.booking_id=b.id
      CROSS JOIN LATERAL (SELECT COALESCE(sum(e.amount_paise::numeric) FILTER(WHERE e.kind='collection'),0) collections,
        COALESCE(sum(e.amount_paise::numeric) FILTER(WHERE e.kind='reversal'),0) reversals,COALESCE(max(e.sequence),0) version,
        COALESCE(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'amount',e.amount_paise::text,'version',e.sequence,
          'occurred_at',to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'reversal_of',e.reversal_of) ORDER BY e.sequence),'[]'::jsonb) entries
        FROM shipit.payment_entries e WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id AND e.obligation_id=o.id) p
      CROSS JOIN LATERAL (SELECT COALESCE(sum(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding),0) reduction,
        COALESCE(sum(c.refund::numeric),0) refunds,COALESCE(max(c.version),0) version,
        COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'kind',c.kind,'version',c.version,
          'reduction',(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding)::text,'refund',c.refund::text,
          'occurred_at',to_char(c.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY c.version),'[]'::jsonb) changes
        FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id) a
      CROSS JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('id',x.id,'status',x.status) ORDER BY x.position) items,
        bool_or(x.status=$2) matches FROM shipit.parcels x
        WHERE x.organization_id=b.organization_id AND x.franchise_id=b.franchise_id AND x.booking_id=b.id) parcels
      WHERE {{franchise:b.organization_id:b.franchise_id}} AND ($1::uuid IS NULL OR b.customer_id=$1)
        AND ($2::text IS NULL OR parcels.matches)
        AND ($3='all' OR o.total_paise-a.reduction-p.collections+p.reversals+a.refunds>0)
      ORDER BY b.confirmed_at,b.id LIMIT $4
    ) r`,[filter.customer_id,filter.status,filter.balances,reportLimits.rows+1])).rows[0]!;
  if(result.rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  const as_of=result.as_of.toISOString();
  return {as_of,rows:result.rows.map(r=>({...r,...ageing(filter.anchor==='booking'?r.confirmed_at:r.due_at,as_of)}))};
}
