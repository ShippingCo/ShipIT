import {reportLimits,type DailyFilter,type DailyRow,type OwnerSummaryPeriod} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {dailyWindows} from './daily-rules.ts';
/** All source reads and both comparison cutoffs share one PostgreSQL statement snapshot. */
export async function captureDaily(scope:TenantAccess,filter:DailyFilter,period?:OwnerSummaryPeriod) {
 const result=(await scopedQuery<{as_of:Date;rows:DailyRow[]}>(scope,['reports.capture'],`SELECT * FROM (WITH clock AS (
  SELECT statement_timestamp() AS now,COALESCE($1::date,(statement_timestamp() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS start
 ), windows AS (
  SELECT 'today'::text period,COALESCE($4::timestamptz,start) AS lo,COALESCE($5::timestamptz,LEAST(now,start+interval '24 hours')) AS hi FROM clock
  UNION ALL SELECT 'yesterday',start-interval '24 hours',CASE WHEN $2='same_elapsed' THEN LEAST(now,start+interval '24 hours')-interval '24 hours' ELSE start END FROM clock WHERE $4::timestamptz IS NULL
 ), bookings AS (
  SELECT b.*,w.period,w.lo,w.hi,
   b.confirmed_at>=w.lo AS in_period,
   NOT a.cancelled AS eligible,
   (b.tax_snapshot->>'pre_tax_paise')::numeric-a.pre_tax AS revenue,
   b.final_payable_paise::numeric-a.reduction AS gross,
   GREATEST(b.final_payable_paise::numeric-a.reduction-p.collected+a.refunds,0) AS debt,
   NOT EXISTS(SELECT 1 FROM shipit.bookings old WHERE old.organization_id=b.organization_id AND old.franchise_id=b.franchise_id AND old.customer_id=b.customer_id
    AND old.confirmed_at<w.lo AND NOT EXISTS(SELECT 1 FROM shipit.financial_changes c WHERE c.organization_id=old.organization_id AND c.franchise_id=old.franchise_id AND c.booking_id=old.id AND c.kind='cancellation' AND c.occurred_at<w.hi)) AS new_customer
  FROM shipit.bookings b CROSS JOIN windows w
  CROSS JOIN LATERAL(SELECT COALESCE(sum(CASE e.kind WHEN 'collection' THEN e.amount_paise::numeric ELSE -e.amount_paise::numeric END),0) collected
   FROM shipit.payment_entries e WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id AND e.occurred_at<w.hi) p
  CROSS JOIN LATERAL(SELECT COALESCE(sum(c.pre_tax::numeric),0) pre_tax,COALESCE(sum(c.pre_tax::numeric+c.cgst+c.sgst+c.igst+c.rounding),0) reduction,
   COALESCE(sum(CASE c.kind WHEN 'refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END),0) refunds,COALESCE(bool_or(c.kind='cancellation'),false) cancelled
   FROM shipit.financial_changes c WHERE c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.booking_id=b.id AND c.occurred_at<w.hi) a
  WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.confirmed_at<w.hi
 ), sources AS (
  SELECT id,franchise_id,period,'booking'::text kind,confirmed_at occurred_at,customer_id,NULL::text method,eligible,in_period,new_customer,
   CASE WHEN in_period THEN gross ELSE 0 END billed_gross,CASE WHEN in_period THEN revenue ELSE 0 END tax_exclusive_revenue,0::numeric collections,0::numeric refunds,debt outstanding
  FROM bookings WHERE in_period OR debt>0
  UNION ALL
  SELECT r.id,r.franchise_id,w.period,'receipt',r.occurred_at,r.customer_id,r.method,false,true,false,0,0,r.amount_paise,0,0
  FROM shipit.money_receipts r CROSS JOIN windows w WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.occurred_at>=w.lo AND r.occurred_at<w.hi
  UNION ALL
  SELECT e.id,e.franchise_id,w.period,'legacy_collection',e.occurred_at,NULL,e.method,false,true,false,0,0,CASE e.kind WHEN 'collection' THEN e.amount_paise::numeric ELSE -e.amount_paise::numeric END,0,0
  FROM shipit.payment_entries e CROSS JOIN windows w WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.occurred_at>=w.lo AND e.occurred_at<w.hi
   AND NOT EXISTS(SELECT 1 FROM shipit.money_receipt_allocations a WHERE a.organization_id=e.organization_id AND a.franchise_id=e.franchise_id AND a.payment_entry_id=e.id)
  UNION ALL
  SELECT c.id,c.franchise_id,w.period,'refund',c.occurred_at,NULL,NULL,false,true,false,0,0,0,CASE c.kind WHEN 'refund_correction' THEN -c.refund::numeric ELSE c.refund::numeric END,0
  FROM shipit.financial_changes c CROSS JOIN windows w WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.occurred_at>=w.lo AND c.occurred_at<w.hi AND c.kind IN ('refund','refund_correction')
  UNION ALL
  SELECT f.id,f.franchise_id,w.period,'advance_refund',(f.input->>'occurred_at')::timestamptz,NULL,NULL,false,true,false,0,0,0,f.amount_paise,0
  FROM shipit.advance_refund_commands f CROSS JOIN windows w WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.operation='return'
   AND (f.input->>'occurred_at')::timestamptz>=w.lo AND (f.input->>'occurred_at')::timestamptz<w.hi
 ), bounded AS (SELECT * FROM sources ORDER BY period,kind,occurred_at,id LIMIT $3)
 SELECT statement_timestamp() AS as_of,COALESCE(jsonb_agg(jsonb_build_object('id',id,'franchise_id',franchise_id,'period',period,'kind',kind,
  'occurred_at',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'customer_id',customer_id,'method',method,
  'eligible',eligible,'in_period',in_period,'new_customer',new_customer,'billed_gross',billed_gross::text,'tax_exclusive_revenue',tax_exclusive_revenue::text,
  'collections',collections::text,'refunds',refunds::text,'outstanding',outstanding::text) ORDER BY period,kind,occurred_at,id),'[]'::jsonb) rows FROM bounded) captured`,[filter.day,filter.mode,reportLimits.rows+1,period?.from??null,period?.to??null])).rows[0]!;
 if(result.rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 return {as_of:result.as_of.toISOString(),windows:period?[{period:'today' as const,from:period.from,to:period.to}]:dailyWindows(result.as_of,filter.day,filter.mode),rows:result.rows};
}
