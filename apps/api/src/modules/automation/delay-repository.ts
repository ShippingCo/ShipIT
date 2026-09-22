import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import type { DelayFanoutCandidate,DelayFanoutOutcome,DelayFanoutRow } from './delay-types.ts';

interface Source {route_id:string;manifest_id:string;manifest_version:number;route_version:number;total_count:number}
export async function source(scope:TenantAccess,event:string):Promise<Source|null> {
  return (await scopedQuery<Source>(scope,['outbox.work','routes.delay.remind'],`SELECT x.route_id,x.manifest_id,m.version AS manifest_version,
    min(x.route_version)::integer AS route_version,count(*)::integer AS total_count
    FROM shipit.domain_events e JOIN shipit.route_parcel_effects x ON x.organization_id=e.organization_id AND x.franchise_id=e.franchise_id AND x.event_id=e.event_id
    JOIN shipit.route_manifests m ON m.organization_id=x.organization_id AND m.franchise_id=x.franchise_id AND m.route_id=x.route_id AND m.id=x.manifest_id
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:x.organization_id:x.franchise_id}} AND {{franchise:m.organization_id:m.franchise_id}}
      AND e.event_id=$1 AND e.event_type='route.delayed' AND e.route_id=x.route_id AND e.envelope->'payload'->>'affected_set_ref'=e.event_id::text
      AND e.envelope->'payload'->>'manifest_id'=x.manifest_id::text
    GROUP BY x.route_id,x.manifest_id,m.version HAVING count(*) BETWEEN 1 AND 1000 AND min(x.route_version)=max(x.route_version)`,[event])).rows[0]??null;
}
export async function insertFanout(scope:TenantAccess,input:{id:string;sourceIdentity:string;sourceKind:'route_delay'|'reminder';originalEvent:string;
  reminderEvent:string|null;source:Source;policy:string;version:number;purpose:'route_delay'|'route_delay_reminder';correlation:string;suppression:string|null}) {
  const c=scope.context;
  return (await scopedQuery<DelayFanoutRow>(scope,['outbox.work','routes.delay.remind'],`INSERT INTO shipit.route_delay_fanouts
    (id,organization_id,franchise_id,source_identity_id,source_kind,original_event_id,reminder_event_id,route_id,manifest_id,manifest_version,route_version,
     policy_id,policy_version,purpose,correlation_id,total_count,source_suppression_reason)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16 WHERE {{franchise:$17:$2}}
    ON CONFLICT(organization_id,franchise_id,source_identity_id,purpose) DO NOTHING RETURNING *`,[input.id,c.permittedFranchiseIds[0],input.sourceIdentity,
      input.sourceKind,input.originalEvent,input.reminderEvent,input.source.route_id,input.source.manifest_id,input.source.manifest_version,input.source.route_version,
      input.policy,input.version,input.purpose,input.correlation,input.source.total_count,input.suppression,c.organizationId])).rows[0]??null;
}
export async function existingFanout(scope:TenantAccess,sourceIdentity:string,purpose:string) {
  return (await scopedQuery<DelayFanoutRow>(scope,['outbox.work','routes.delay.remind'],`SELECT f.* FROM shipit.route_delay_fanouts f
    WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.source_identity_id=$1 AND f.purpose=$2`,[sourceIdentity,purpose])).rows[0]??null;
}
export async function lockFanout(scope:TenantAccess,id:string) {
  return (await scopedQuery<DelayFanoutRow>(scope,['outbox.work'],`SELECT f.* FROM shipit.route_delay_fanouts f
    WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.id=$1 FOR UPDATE`,[id])).rows[0]??null;
}
export async function candidate(scope:TenantAccess,fanout:DelayFanoutRow) {
  return (await scopedQuery<DelayFanoutCandidate>(scope,['outbox.work'],`SELECT x.parcel_id,x.booking_id,x.outcome AS source_outcome,x.skip_reason AS source_skip_reason,
    p.status,b.state AS booking_state,c.id AS customer_id,b.customer_snapshot->>'phone'=c.phone_normalized AS contact_current,r.execution_state,
    latest.event_id AS eta_event_id,latest.event_id AS latest_delay_event_id,p.docket,latest.effective_at,latest.revised_eta_at
    FROM shipit.route_parcel_effects x
    JOIN shipit.parcels p ON p.organization_id=x.organization_id AND p.franchise_id=x.franchise_id AND p.id=x.parcel_id
    JOIN shipit.bookings b ON b.organization_id=x.organization_id AND b.franchise_id=x.franchise_id AND b.id=x.booking_id
    LEFT JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    JOIN shipit.routes r ON r.organization_id=x.organization_id AND r.franchise_id=x.franchise_id AND r.id=x.route_id
    LEFT JOIN LATERAL (SELECT y.event_id,y.effective_at,y.revised_eta_at FROM shipit.route_parcel_effects y
      JOIN shipit.domain_events e ON e.organization_id=y.organization_id AND e.franchise_id=y.franchise_id AND e.event_id=y.event_id
      WHERE y.organization_id=x.organization_id AND y.franchise_id=x.franchise_id AND y.route_id=x.route_id AND y.parcel_id=x.parcel_id
        AND e.event_type='route.delayed' ORDER BY y.route_version DESC LIMIT 1) latest ON true
    WHERE {{franchise:x.organization_id:x.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}}
      AND {{franchise:b.organization_id:b.franchise_id}} AND {{franchise:r.organization_id:r.franchise_id}}
      AND x.event_id=$1 AND ($2::uuid IS NULL OR x.parcel_id>$2) ORDER BY x.parcel_id LIMIT 1`,[fanout.original_event_id,fanout.cursor_parcel_id])).rows[0]??null;
}
export async function recordItem(scope:TenantAccess,fanout:DelayFanoutRow,item:DelayFanoutCandidate,input:{id:string;outcome:DelayFanoutOutcome;reason:string;outbound:string|null;etaEvent:string|null}) {
  const c=scope.context;
  await scopedQuery(scope,['outbox.work'],`INSERT INTO shipit.route_delay_fanout_items
    (id,organization_id,franchise_id,fanout_id,source_identity_id,original_event_id,parcel_id,booking_id,purpose,outcome,reason_code,outbound_intent_id,eta_event_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}} ON CONFLICT DO NOTHING`,
    [input.id,c.permittedFranchiseIds[0],fanout.id,fanout.source_identity_id,fanout.original_event_id,item.parcel_id,item.booking_id,fanout.purpose,
      input.outcome,input.reason,input.outbound,input.etaEvent,c.organizationId]);
  const complete=input.outcome==='queued',skipped=input.outcome==='skipped'||input.outcome==='suppressed',failed=input.outcome==='blocked';
  await scopedQuery(scope,['outbox.work'],`UPDATE shipit.route_delay_fanouts f SET cursor_parcel_id=$2,completed_count=completed_count+$3::integer,
    skipped_count=skipped_count+$4::integer,failed_count=failed_count+$5::integer,attempt_count=attempt_count+1,
    state=CASE WHEN completed_count+skipped_count+failed_count+1=total_count THEN 'completed' ELSE 'running' END,
    started_at=coalesce(started_at,clock_timestamp()),completed_at=CASE WHEN completed_count+skipped_count+failed_count+1=total_count THEN clock_timestamp() END,
    reason_code=CASE WHEN completed_count+skipped_count+failed_count+1=total_count AND failed_count+$5::integer>0 THEN 'items_blocked' ELSE NULL END
    WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.id=$1`,[fanout.id,item.parcel_id,complete?1:0,skipped?1:0,failed?1:0]);
}
export async function activationExists(scope:TenantAccess,policy:string,version:number) {
  return (await scopedQuery(scope,['routes.delay.remind'],`SELECT a.policy_id FROM shipit.notification_policy_activations a
    WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.consumer_id='customer-notifications' AND a.policy_id=$1 AND a.policy_version=$2`,[policy,version])).rows.length===1;
}
export async function reminderReplay(scope:TenantAccess,key:string) {
  const c=scope.context;
  return (await scopedQuery<{fingerprint:string;result:Record<string,unknown>|null}>(scope,['routes.delay.remind'],`SELECT c.fingerprint,c.result
    FROM shipit.route_delay_reminder_commands c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.principal_id=$1
      AND c.operation_id='api.v1.routes.delay.remind' AND c.key_digest=$2 FOR UPDATE`,[c.actor.id,key])).rows[0]??null;
}
export async function latestDelay(scope:TenantAccess,route:string) {
  return (await scopedQuery<{event_id:string}>(scope,['routes.delay.remind'],`SELECT e.event_id FROM shipit.domain_events e
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.route_id=$1 AND e.event_type='route.delayed' ORDER BY e.aggregate_sequence DESC LIMIT 1`,[route])).rows[0]?.event_id??null;
}
export async function routeExecution(scope:TenantAccess,route:string) {
  return (await scopedQuery<{execution_state:string;base_eta_at:Date|null;total_delay_minutes:number;version:number}>(scope,['routes.delay.remind'],`SELECT r.execution_state,r.base_eta_at,r.total_delay_minutes,r.version
    FROM shipit.routes r WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1`,[route])).rows[0]??null;
}
export async function rateLimited(scope:TenantAccess,event:string,now:Date) {
  return (await scopedQuery(scope,['routes.delay.remind'],`SELECT r.id FROM shipit.route_delay_reminder_events r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.original_event_id=$1 AND r.occurred_at>$2::timestamptz-interval '60 minutes' LIMIT 1`,[event,now])).rows.length>0;
}
export async function createReminder(scope:TenantAccess,input:{command:string;event:string;fanout:string;route:string;original:string;key:string;fingerprint:string;now:Date;policy:string;version:number;source:Source}) {
  const c=scope.context;
  await scopedQuery(scope,['routes.delay.remind'],`INSERT INTO shipit.route_delay_reminder_commands
    (id,organization_id,franchise_id,principal_id,route_id,original_event_id,operation_id,key_digest,fingerprint,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,'api.v1.routes.delay.remind',$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,
    [input.command,c.permittedFranchiseIds[0],c.actor.id,input.route,input.original,input.key,input.fingerprint,c.correlationId,input.now,c.organizationId]);
  await scopedQuery(scope,['routes.delay.remind'],`INSERT INTO shipit.route_delay_reminder_events
    (id,organization_id,franchise_id,route_id,original_event_id,command_id,actor_id,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
    [input.event,c.permittedFranchiseIds[0],input.route,input.original,input.command,c.actor.id,c.correlationId,input.now,c.organizationId]);
  await insertFanout(scope,{id:input.fanout,sourceIdentity:input.event,sourceKind:'reminder',originalEvent:input.original,reminderEvent:input.event,
    source:input.source,policy:input.policy,version:input.version,purpose:'route_delay_reminder',correlation:c.correlationId,suppression:null});
  const result={id:input.event,event_type:'route.delay_reminder.requested',route_id:input.route,original_event_id:input.original,fanout_id:input.fanout,created_at:input.now.toISOString()};
  await scopedQuery(scope,['routes.delay.remind'],`UPDATE shipit.route_delay_reminder_commands c SET state='committed',result=$2,committed_at=$3
    WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 AND c.state='reserved'`,[input.command,result,input.now]);
  return result;
}
