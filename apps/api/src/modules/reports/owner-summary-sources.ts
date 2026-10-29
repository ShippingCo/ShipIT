import {reportLimits,type OwnerSummaryPeriod,type OwnerSummarySnapshot,type OwnerSummaryEvidence} from '@shippingco/shared';
import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {captureDaily} from './daily-repository.ts';
import {dailyMetrics} from './daily-rules.ts';
import {capture as reconciliation} from '../reconciliation/report-repository.ts';

export interface DueSource {id:string;franchise_id:string;amount_paise:string;overdue_days:number|null}
export async function dueSources(scope:TenantAccess,balances:readonly {id:string;outstanding:string}[],cutoff:string):Promise<DueSource[]> {
 return (await scopedQuery<DueSource>(scope,['reports.capture'],`SELECT b.id,b.franchise_id,x.outstanding amount_paise,
  CASE WHEN a.due_date IS NULL THEN NULL ELSE GREATEST(0,($2::timestamptz AT TIME ZONE 'Asia/Kolkata')::date-a.due_date) END overdue_days
 FROM shipit.bookings b JOIN jsonb_to_recordset($1::jsonb) AS x(id uuid,outstanding text) ON x.id=b.id
 LEFT JOIN shipit.customer_account_bookings a ON a.organization_id=b.organization_id AND a.franchise_id=b.franchise_id AND a.booking_id=b.id
 WHERE {{franchise:b.organization_id:b.franchise_id}} AND x.outstanding::numeric>0 ORDER BY b.id`,[JSON.stringify(balances),cutoff])).rows;
}

/** Called only inside a repeatable-read owner-report transaction. Original rows are retained for independent reconciliation. */
export async function captureOwnerSummary(scope:TenantAccess,period:OwnerSummaryPeriod,cutoff:string):Promise<OwnerSummarySnapshot> {
 const captured=await captureDaily(scope,{day:null,mode:'complete_day',franchise_ids:[...scope.context.permittedFranchiseIds]},period);
 const due=await dueSources(scope,captured.rows.filter(r=>r.kind==='booking'),period.to);
 const facts=(await scopedQuery<{rows:OwnerSummaryEvidence[];unknown:number}>(scope,['reports.capture'],`SELECT result.* FROM LATERAL(WITH
 expenses AS (SELECT r.id,r.franchise_id,'expense'::text kind,r.occurred_at,r.amount_paise::text amount_paise,'applied'::text state
  FROM shipit.cashbook_requests r JOIN shipit.cashbook_effects e ON e.organization_id=r.organization_id AND e.franchise_id=r.franchise_id AND e.request_id=r.id
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.kind='expense' AND r.occurred_at>=$1 AND r.occurred_at<$2
  AND NOT EXISTS(SELECT 1 FROM shipit.cashbook_requests n JOIN shipit.cashbook_effects ne ON ne.organization_id=n.organization_id AND ne.franchise_id=n.franchise_id AND ne.request_id=n.id
   WHERE n.organization_id=r.organization_id AND n.franchise_id=r.franchise_id AND n.correction_of=r.id AND n.occurred_at<$2)),
 custody AS (SELECT l.id,l.franchise_id,'agent_custody'::text kind,NULL::timestamptz occurred_at,
  COALESCE(sum(CASE f.direction WHEN 'in' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END),0)::text amount_paise,'recorded_known_sources'::text state
  FROM shipit.cash_locations l LEFT JOIN shipit.cashbook_source_facts f ON f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND f.location_id=l.id AND f.occurred_at<$2
  WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.kind='cash' AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.business_membership_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
   WHERE m.organization_id=l.organization_id AND ms.franchise_id=l.franchise_id AND m.user_id=l.custodian_id AND m.role='delivery_agent') GROUP BY l.id,l.franchise_id),
 counts AS (SELECT DISTINCT ON(c.session_id) c.session_id id,c.franchise_id,'cash_difference'::text kind,(c.result->'count'->>'counted_at')::timestamptz occurred_at,
  c.result->'count'->>'variance_paise' amount_paise,'recorded_count'::text state
  FROM shipit.cash_close_commands c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.operation='count'
   AND (c.result->'count'->>'counted_at')::timestamptz>=$1 AND (c.result->'count'->>'counted_at')::timestamptz<$2 ORDER BY c.session_id,c.version DESC),
 unknowns AS(SELECT f.source_id id,f.franchise_id,'unknown_custody'::text kind,f.occurred_at,f.amount_paise::text amount_paise,COALESCE(f.unknown_reason,'unassigned')||':'||f.source_kind||':'||f.direction state
  FROM shipit.cashbook_source_facts f WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.occurred_at<$2 AND f.location_id IS NULL),
 sources AS(SELECT * FROM expenses UNION ALL SELECT * FROM custody UNION ALL SELECT * FROM counts UNION ALL SELECT * FROM unknowns)
 SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('id',id,'franchise_id',franchise_id,'kind',kind,'occurred_at',to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'amount_paise',amount_paise,'state',state) ORDER BY kind,id)
  FROM(SELECT * FROM sources ORDER BY kind,id LIMIT $3) bounded),'[]'::jsonb) rows,
  (SELECT count(*)::int FROM shipit.cashbook_source_facts f WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.occurred_at<$2 AND f.location_id IS NULL) unknown) result`,[period.from,period.to,reportLimits.rows+1])).rows[0]!;
 const accounts=(await scopedQuery<{id:string;franchise_id:string;enabled:boolean}>(scope,['reports.capture'],`SELECT a.id,a.franchise_id,COALESCE(c.enabled,false) enabled FROM shipit.receiving_accounts a
 LEFT JOIN LATERAL(SELECT enabled FROM shipit.reconciliation_config_versions c WHERE c.organization_id=a.organization_id AND c.franchise_id=a.franchise_id ORDER BY version DESC LIMIT 1) c ON true
 WHERE {{franchise:a.organization_id:a.franchise_id}} ORDER BY a.id LIMIT 51`)).rows;
 if(accounts.length>50)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 const evidence=[...facts.rows,...due.filter(d=>d.overdue_days===null||d.overdue_days>0).map(d=>({id:d.id,franchise_id:d.franchise_id,kind:d.overdue_days===null?'unknown_due':'overdue',occurred_at:null,amount_paise:d.amount_paise,state:d.overdue_days===null?'due_date_unknown':'overdue_'+d.overdue_days+'_days'}))];
 let reconciliationExceptions=0;
 for(const account of accounts.filter(a=>a.enabled)) {
  // These sources own business_date in IST, independently of an owner's notification timezone.
  const day=(v:string)=>new Date(Date.parse(v)+19800000).toISOString().slice(0,10);
  const report=await reconciliation(scope,{account_id:account.id,from_day:day(period.from),to_day:day(new Date(Date.parse(period.to)-1).toISOString())});
  for(const row of report.rows.filter(r=>['pending','different','unassigned'].includes(r.status))) {
   reconciliationExceptions++;evidence.push({id:row.id,franchise_id:account.franchise_id,kind:'reconciliation_'+row.kind,occurred_at:null,amount_paise:row.remaining_paise,state:row.status});
  }
  if(evidence.length+captured.rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 }
 if(evidence.length+captured.rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
 const sum=(kind:string,absolute=false)=>evidence.filter(e=>e.kind===kind).reduce((s,e)=>{const n=BigInt(e.amount_paise??0);return s+(absolute&&n<0n?-n:n);},0n).toString();
 const snapshot:OwnerSummarySnapshot={definition:'owner_period_v1',period,as_of:cutoff,expires_at:new Date(Date.parse(cutoff)+86400000).toISOString(),
  franchise_ids:[...scope.context.permittedFranchiseIds].sort(),metrics:dailyMetrics(captured.rows),expenses_paise:sum('expense'),overdue_paise:sum('overdue'),unknown_due_count:due.filter(d=>d.overdue_days===null).length,
  agent_held_known_paise:sum('agent_custody'),unknown_custody_count:facts.unknown,cash_differences_paise:sum('cash_difference',true),reconciliation_exceptions:reconciliationExceptions,
  reconciliation_state:accounts.every(a=>!a.enabled)?'disabled':accounts.every(a=>a.enabled)?'available':'partially_disabled',evidence,sales_rows:captured.rows};
 if(Buffer.byteLength(JSON.stringify(snapshot))>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');return snapshot;
}
