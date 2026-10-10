import {reportLimits,type PerformanceFilter,type PerformanceRow,type PerformanceSnapshot} from '@shippingco/shared';
import {scopedQuery,assertTenantAccess,type TenantAccess} from '../security/scope.ts';
import {HttpError} from '../../plugins/errors.ts';
import {utcRange} from './rules.ts';
import {performanceTiming} from './performance-rules.ts';
type SourceRow=Omit<PerformanceRow,'duration_seconds'|'outcome'>;
export async function capturePerformance(scope:TenantAccess,filter:PerformanceFilter,agentOnly=false) {
  const range=utcRange(filter);
  // One statement, one parcel row. Every optional producer is reduced before joining.
  const result=(await scopedQuery<{as_of:Date;rows:SourceRow[]}>(scope,['reports.capture'],`
    SELECT statement_timestamp() AS as_of,COALESCE(jsonb_agg(x.row ORDER BY x.confirmed_at,x.id),'[]'::jsonb) AS rows FROM (
      SELECT p.id,b.confirmed_at,jsonb_build_object('id',p.id,'booking_id',b.id,'customer_id',b.customer_id,'version',p.version,
        'confirmed_at',to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'destination',NULLIF(b.pricing_snapshot->'inputs'->>'destination_key',''),
        'service',NULLIF(b.pricing_snapshot->'inputs'->>'service',''),'courier',route.carrier_code,
        'status',p.status,'failed_attempts',failures.n,
        'dispatched_at',to_char(dispatch.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'delivered_at',to_char(proof.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'original_eta_at',to_char(original.base_eta_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'original_eta_version',original.route_version,
        'revised_eta_at',to_char(revised.revised_eta_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'revised_eta_version',revised.route_version,'route_id',route.id,'manifest_id',route.manifest_id,
        'route_departed_at',to_char(route_times.departed AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'route_arrived_at',to_char(route_times.arrived AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS row
      FROM shipit.parcels p JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
      LEFT JOIN LATERAL (SELECT min(t.occurred_at) AS occurred_at FROM shipit.parcel_transitions t
        WHERE t.organization_id=p.organization_id AND t.franchise_id=p.franchise_id AND t.parcel_id=p.id AND t.to_status='dispatched') dispatch ON true
      LEFT JOIN LATERAL (SELECT a.agent_id FROM shipit.delivery_attempts a
        WHERE a.organization_id=p.organization_id AND a.franchise_id=p.franchise_id AND a.parcel_id=p.id AND a.booking_id=p.booking_id
        ORDER BY a.attempt_number DESC LIMIT 1) assignment ON true
      LEFT JOIN shipit.delivery_proofs proof ON proof.organization_id=p.organization_id AND proof.franchise_id=p.franchise_id AND proof.parcel_id=p.id AND proof.booking_id=p.booking_id
      CROSS JOIN LATERAL (SELECT count(*)::int n FROM shipit.parcel_failed_attempts f
        WHERE f.organization_id=p.organization_id AND f.franchise_id=p.franchise_id AND f.parcel_id=p.id) failures
      LEFT JOIN LATERAL (SELECT r.id,r.carrier_code,d.manifest_id FROM shipit.parcel_dispatch_manifests d
        JOIN shipit.parcel_commands c ON c.organization_id=d.organization_id AND c.franchise_id=d.franchise_id AND c.id=d.command_id
        JOIN shipit.route_manifest_parcels m ON m.organization_id=d.organization_id AND m.franchise_id=d.franchise_id
          AND m.manifest_id=d.manifest_id AND m.parcel_id=d.parcel_id AND m.booking_id=d.booking_id AND m.finalized
        JOIN shipit.routes r ON r.organization_id=m.organization_id AND r.franchise_id=m.franchise_id AND r.id=m.route_id
        WHERE d.organization_id=p.organization_id AND d.franchise_id=p.franchise_id AND d.parcel_id=p.id AND d.booking_id=p.booking_id
        ORDER BY c.expected_version DESC,c.id LIMIT 1) route ON true
      LEFT JOIN LATERAL (SELECT e.base_eta_at,e.route_version FROM shipit.route_parcel_effects e
        WHERE e.organization_id=p.organization_id AND e.franchise_id=p.franchise_id AND e.parcel_id=p.id
          AND e.manifest_id=route.manifest_id AND e.outcome='updated' AND e.base_eta_at IS NOT NULL
          AND (proof.completed_at IS NULL OR e.effective_at<=proof.completed_at)
        ORDER BY e.route_version,e.command_id LIMIT 1) original ON true
      LEFT JOIN LATERAL (SELECT e.revised_eta_at,e.route_version FROM shipit.route_parcel_effects e
        WHERE e.organization_id=p.organization_id AND e.franchise_id=p.franchise_id AND e.parcel_id=p.id
          AND e.manifest_id=route.manifest_id AND e.outcome='updated'
          AND (proof.completed_at IS NULL OR e.effective_at<=proof.completed_at)
        ORDER BY e.route_version DESC,e.command_id LIMIT 1) revised ON true
      CROSS JOIN LATERAL (SELECT min((c.input->>'effective_at')::timestamptz) FILTER (WHERE c.operation_id='api.v1.routes.departure') departed,
        min((c.input->>'effective_at')::timestamptz) FILTER (WHERE c.operation_id='api.v1.routes.arrival') arrived
        FROM shipit.route_commands c WHERE c.organization_id=p.organization_id AND c.franchise_id=p.franchise_id AND c.route_id=route.id
          AND c.state='committed' AND c.operation_id IN ('api.v1.routes.departure','api.v1.routes.arrival')) route_times
      WHERE {{franchise:p.organization_id:p.franchise_id}} AND b.confirmed_at>=$1 AND b.confirmed_at<$2 AND ($4::uuid IS NULL OR assignment.agent_id=$4::uuid)
      ORDER BY b.confirmed_at,p.id LIMIT $3
    ) x`,[range.from,range.to,reportLimits.rows+1,agentOnly?assertTenantAccess(scope,['reports.capture']).actor.id:null])).rows[0]!;
  if(result.rows.length>reportLimits.rows)throw new HttpError('REPORT_LIMIT_EXCEEDED');
  const rows=result.rows.map(r=>performanceTiming(r,filter.eta));
  if(filter.sort==='confirmed_desc')rows.reverse();return {as_of:result.as_of.toISOString(),rows};
}

/** Recheck the whole immutable selection before returning any counts or pages. */
export async function requirePerformanceAudience(scope:TenantAccess,snapshot:PerformanceSnapshot,rows:readonly PerformanceRow[],agentOnly:boolean) {
  if(!agentOnly)return;
  if(snapshot.audience!=='assignment')throw new HttpError('RESOURCE_NOT_FOUND');
  if(!rows.length)return;
  const result=(await scopedQuery<{n:number}>(scope,['reports.capture'],
    `SELECT count(*)::int n FROM shipit.parcels p
      JOIN LATERAL (SELECT a.agent_id FROM shipit.delivery_attempts a
        WHERE a.organization_id=p.organization_id AND a.franchise_id=p.franchise_id AND a.parcel_id=p.id AND a.booking_id=p.booking_id
        ORDER BY a.attempt_number DESC LIMIT 1) assignment ON true
      WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=ANY($1::uuid[]) AND assignment.agent_id=$2::uuid`,
    [rows.map(r=>r.id),assertTenantAccess(scope,['reports.capture']).actor.id])).rows[0]!;
  if(result.n!==rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
}
