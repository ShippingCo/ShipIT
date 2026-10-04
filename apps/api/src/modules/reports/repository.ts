import { randomUUID } from 'node:crypto';
import { reportLimits, type ReportFilter, type ReportRow, type ReportSnapshot } from '@shippingco/shared';
import { assertTenantAccess, scopedQuery, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import { utcRange } from './rules.ts';
const actions=['reports.capture'] as const;
export interface SavedReport<M=ReportSnapshot,R=ReportRow> { id:string; fingerprint:string; metadata:M; rows:R[]; expired:boolean }
export async function lock(scope:TenantAccess) {
  // Same lock order as monetary commands; bounds concurrent capture/quota checks per franchise.
  const result=await scopedQuery(scope,['reports.capture'],`SELECT id FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`);
  if(!result.rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
  const c=assertTenantAccess(scope,actions);
  await scopedQuery(scope,['reports.capture'],`UPDATE shipit.report_snapshots SET metadata=NULL,rows=NULL
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND expires_at<=clock_timestamp() AND metadata IS NOT NULL`,[c.actor.id]);
}
export async function replay<M=ReportSnapshot,R=ReportRow>(scope:TenantAccess,key:string) {
  const c=assertTenantAccess(scope,actions);
  return (await scopedQuery<SavedReport<M,R>>(scope,['reports.capture'],`SELECT id,fingerprint,metadata,rows,expires_at<=clock_timestamp() AS expired
    FROM shipit.report_snapshots WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2 AND franchise_id=$3`,[c.actor.id,key,c.permittedFranchiseIds[0]])).rows[0];
}
export async function get<M=ReportSnapshot,R=ReportRow>(scope:TenantAccess,id:string) {
  const c=assertTenantAccess(scope,actions);
  const result=(await scopedQuery<SavedReport<M,R>>(scope,['reports.capture'],`SELECT id,fingerprint,metadata,rows,expires_at<=clock_timestamp() AS expired
    FROM shipit.report_snapshots WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND actor_id=$2`,[id,c.actor.id])).rows[0];
  if(!result||result.expired)throw new HttpError('RESOURCE_NOT_FOUND');
  return result;
}
export async function capture(scope:TenantAccess,filter:ReportFilter) {
  const range=utcRange(filter);
  // One SQL statement gives one MVCC view, including all ledger aggregates and the cutoff.
  const result=(await scopedQuery<{as_of:Date;rows:ReportRow[]}>(scope,['reports.capture'],`SELECT statement_timestamp() AS as_of,
    COALESCE(jsonb_agg(r.row ORDER BY r.confirmed_at,r.id),'[]'::jsonb) AS rows FROM (
      SELECT b.id,b.confirmed_at,jsonb_build_object('id',b.id,'confirmed_at',to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'source',jsonb_build_object('type','booking','id',b.id,'version',b.version,'correction_of',NULL),
        'payment_source',jsonb_build_object('type','payment_ledger','id',o.id,'version',p.version,'correction_of',NULL),
        'billed_gross',b.final_payable_paise::text,'tax_exclusive_revenue',b.tax_snapshot->>'pre_tax_paise',
        'collections',p.collected::text,'outstanding',(b.final_payable_paise::numeric-p.collected)::text,
        'cost',jsonb_build_object('state','unknown','reason','source_unavailable'),'due_at',NULL) AS row
      FROM shipit.bookings b JOIN shipit.booking_obligations o ON o.organization_id=b.organization_id AND o.franchise_id=b.franchise_id AND o.booking_id=b.id
      CROSS JOIN LATERAL (SELECT COALESCE(sum(CASE WHEN e.kind='collection' THEN e.amount_paise::numeric ELSE -e.amount_paise::numeric END),0) AS collected,
        COALESCE(max(e.sequence),0) AS version FROM shipit.payment_entries e
        WHERE e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id AND e.obligation_id=o.id) p
      WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.confirmed_at >= $1 AND b.confirmed_at < $2
      ORDER BY b.confirmed_at,b.id LIMIT $3
    ) r`,[range.from,range.to,reportLimits.rows+1])).rows[0]!;
  if(result.rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  if(filter.sort==='confirmed_desc')result.rows.reverse();
  return {as_of:result.as_of.toISOString(),rows:result.rows};
}
export async function save(scope:TenantAccess,key:string,fingerprint:string,metadata:{id:string;as_of:string;expires_at:string},rows:readonly unknown[]) {
  const c=assertTenantAccess(scope,actions);
  if(Buffer.byteLength(JSON.stringify(rows))>reportLimits.bytes)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  const count=(await scopedQuery<{n:number}>(scope,['reports.capture'],`SELECT count(*)::int n FROM shipit.report_snapshots
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND expires_at>clock_timestamp()`,[c.actor.id])).rows[0]!.n;
  if(count>=20)throw new HttpError('REPORT_QUOTA_EXCEEDED');
  await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.report_snapshots
    (id,organization_id,franchise_id,actor_id,key_digest,fingerprint,metadata,rows,created_at,expires_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,
    [metadata.id,c.permittedFranchiseIds[0],c.actor.id,key,fingerprint,metadata,JSON.stringify(rows),metadata.as_of,metadata.expires_at,c.organizationId]);
}
export async function audit(scope:TenantAccess,id:string,action:'report.capture'|'report.read'|'report.export') {
  const c=assertTenantAccess(scope,actions);
  await scopedQuery(scope,['reports.capture'],`INSERT INTO shipit.report_access_events(id,organization_id,franchise_id,actor_id,snapshot_id,action,correlation_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}}`,
    [randomUUID(),c.permittedFranchiseIds[0],c.actor.id,id,action,c.correlationId,c.organizationId]);
}
