import {reportLimits,type CashbookReportFilter,type CashbookSourceRow,type CashbookSourceTotals} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {utcRange} from '../reports/rules.ts';
import {cashbookPositionDto,type CashbookPositionCapture} from './effect-service.ts';
/** Rows, independently aggregated controls and complete current custody share one statement MVCC view. */
export async function captureCashbookSources(scope:TenantAccess,filter:CashbookReportFilter) {
 const range=utcRange({...filter,sort:'confirmed_asc'});
 const result=(await scopedQuery<CashbookPositionCapture&{rows:CashbookSourceRow[];totals:CashbookSourceTotals}>(scope,['reports.capture'],`SELECT result.* FROM LATERAL (WITH locations AS (
  SELECT l.* FROM shipit.cash_locations l WHERE {{franchise:l.organization_id:l.franchise_id}}
 ),facts AS (SELECT f.* FROM shipit.cashbook_source_facts f WHERE {{franchise:f.organization_id:f.franchise_id}}),selected AS (
  SELECT f.* FROM facts f WHERE f.occurred_at>=$1 AND f.occurred_at<$2 AND ($3::text IS NULL OR f.source_kind=$3) AND ($4::uuid IS NULL OR f.location_id=$4) AND ($6::text IS NULL OR f.payment_method=$6)
 ),positions AS (
  SELECT l.id location_id,COALESCE(sum(f.amount_paise::numeric) FILTER(WHERE f.direction='in'),0)::text inflows,COALESCE(sum(f.amount_paise::numeric) FILTER(WHERE f.direction='out'),0)::text outflows,
  COALESCE(sum(CASE WHEN f.direction='in' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END),0)::text recorded,
  (SELECT COALESCE(sum(h.remaining_paise::numeric),0)::text FROM shipit.cash_handover_positions h WHERE h.organization_id=l.organization_id AND h.franchise_id=l.franchise_id AND h.source_location_id=l.id) reserved,
  (SELECT count(*)::int FROM facts u WHERE u.location_id IS NULL AND (u.account_id IS NULL OR u.account_id=l.account_id)) unknown_sources,
  (SELECT COALESCE(sum(CASE WHEN u.source_kind='refund' THEN u.amount_paise::numeric ELSE -u.amount_paise::numeric END),0)::text FROM facts u WHERE u.location_id IS NULL AND u.source_kind IN ('refund','refund_correction') AND (u.account_id IS NULL OR u.account_id=l.account_id)) unresolved_refunds
  FROM locations l LEFT JOIN facts f ON f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND f.location_id=l.id GROUP BY l.id,l.account_id,l.organization_id,l.franchise_id
 ) SELECT statement_timestamp() as_of,COALESCE((SELECT version::text FROM shipit.cashbook_source_versions v WHERE {{franchise:v.organization_id:v.franchise_id}}),'0') source_version,
  (SELECT count(*)::int FROM facts WHERE location_id IS NULL) unknown_sources,COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.location_id) FROM positions p),'[]'::jsonb) locations,
  (SELECT jsonb_build_object('count',count(*)::int,'known_inflows_paise',COALESCE(sum(amount_paise::numeric) FILTER(WHERE location_id IS NOT NULL AND direction='in'),0)::text,
   'known_outflows_paise',COALESCE(sum(amount_paise::numeric) FILTER(WHERE location_id IS NOT NULL AND direction='out'),0)::text,'known_net_paise',COALESCE(sum(CASE WHEN direction='in' THEN amount_paise::numeric ELSE -amount_paise::numeric END) FILTER(WHERE location_id IS NOT NULL),0)::text,
   'unknown_inflows_paise',COALESCE(sum(amount_paise::numeric) FILTER(WHERE location_id IS NULL AND direction='in'),0)::text,'unknown_outflows_paise',COALESCE(sum(amount_paise::numeric) FILTER(WHERE location_id IS NULL AND direction='out'),0)::text,'unknown_sources',count(*) FILTER(WHERE location_id IS NULL)::int) FROM selected) totals,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.source_kind||':'||f.source_id||':'||COALESCE(f.location_id::text,'unknown'),'source_kind',f.source_kind,'payment_method',f.payment_method,'source_id',f.source_id,'location_id',f.location_id,'account_id',f.account_id,'direction',f.direction,'amount_paise',f.amount_paise::text,
   'occurred_at',to_char(f.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'recorded_at',to_char(f.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'actor_id',f.actor_id,'request_id',f.request_id,'correction_of',f.correction_of,'unknown_reason',f.unknown_reason) ORDER BY f.occurred_at,f.source_kind,f.source_id,f.location_id)
   FROM (SELECT * FROM selected ORDER BY occurred_at,source_kind,source_id,location_id LIMIT $5) f),'[]'::jsonb) rows) result`,[range.from,range.to,filter.kind,filter.location_id,reportLimits.rows+1,filter.payment_method])).rows[0]!;
 if(result.totals.count>reportLimits.rows||result.rows.length!==result.totals.count)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 if(new Set(result.rows.map(r=>r.id)).size!==result.rows.length)throw new HttpError('CASHBOOK_CONFLICT');
 if(filter.sort==='occurred_desc')result.rows.reverse();
 return {position:cashbookPositionDto(result),rows:result.rows,totals:result.totals};
}
