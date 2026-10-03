import type { TenantAccess } from '../security/scope.ts';
import { scopedQuery } from '../security/scope.ts';

/** Installation-scoped manual signals; never infer carrier API availability. */
export async function manualHealth(s:TenantAccess,installation:string,now:Date) {
  const latest=(await scopedQuery<{
    id:string;actor_id:string;received_at:Date;occurred_at:Date|null;time_reason:string|null;
  }>(s,['carriers.read'],`SELECT r.id,c.actor_id,r.received_at,r.occurred_at,r.time_reason
    FROM shipit.carrier_tracking_records r
    JOIN shipit.carrier_commands c ON c.organization_id=r.organization_id AND c.franchise_id=r.franchise_id AND c.id=r.source_ref
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.installation_id=$1 AND r.source_mode='manual'
    ORDER BY r.received_at DESC,r.id DESC LIMIT 1`,[installation])).rows[0]??null;
  const counts=(await scopedQuery<{unresolved:number;unmapped:number;oldest_received_at:Date|null}>(s,['carriers.read'],`
    SELECT count(*)::int AS unresolved,count(*) FILTER (WHERE r.status IS NULL)::int AS unmapped,
      min(r.received_at) AS oldest_received_at
    FROM shipit.carrier_tracking_records r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.installation_id=$1 AND r.source_mode='manual'
      AND r.duplicate_of IS NULL AND NOT EXISTS(SELECT 1 FROM shipit.carrier_tracking_decisions d
        WHERE d.organization_id=r.organization_id AND d.franchise_id=r.franchise_id AND d.record_id=r.id)`,[installation])).rows[0]!;
  const received=latest?new Date(latest.received_at):null,source=latest?.occurred_at?new Date(latest.occurred_at):null;
  const knownSource=source!==null&&received!==null&&source<=now&&source<=received;
  return {as_of:now.toISOString(),source:'manual' as const,carrier_verified:false,
    state:counts.unresolved?'needs_review':latest?'last_known':'no_observations',
    last_observation:latest,received_age_seconds:received?Math.max(0,Math.floor((now.getTime()-received.getTime())/1000)):null,
    source_age_seconds:knownSource?Math.floor((now.getTime()-source.getTime())/1000):null,
    source_time_state:!latest?'missing':!source?'unknown':knownSource?'known':'future',
    review:counts,operational_owner_role:'franchise_admin' as const};
}
