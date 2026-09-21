import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import type { Event } from '../outbox/types.ts';
import type { DecisionOutcome,ResolvedNotification } from './types.ts';

export async function activation(scope:TenantAccess,policy:string,version:number) {
  return (await scopedQuery<{activated_at:Date}>(scope,['outbox.work'],`SELECT a.activated_at FROM shipit.notification_policy_activations a
    WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.consumer_id='customer-notifications' AND a.policy_id=$1 AND a.policy_version=$2`,[policy,version])).rows[0];
}
export async function decided(scope:TenantAccess,event:string,policy:string,version:number,affected:string) {
  return (await scopedQuery(scope,['outbox.work'],`SELECT d.id FROM shipit.notification_automation_decisions d
    WHERE {{franchise:d.organization_id:d.franchise_id}} AND d.source_event_id=$1 AND d.policy_id=$2 AND d.policy_version=$3 AND d.affected_entity_id=$4`,
    [event,policy,version,affected])).rows.length>0;
}
export async function reconcileGap(scope:TenantAccess,event:Event,highWater:number) {
  return (await scopedQuery<{safe:boolean}>(scope,['outbox.work'],`SELECT count(*)=($4::integer-$3::integer-1)::bigint AS safe FROM shipit.domain_events e
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.aggregate_id=$1 AND e.envelope->>'aggregate_type'=$2
      AND e.aggregate_sequence>$3 AND e.aggregate_sequence<$4`,[event.aggregate_id,event.aggregate_type,highWater,event.aggregate_version])).rows[0]!.safe;
}
export async function booking(scope:TenantAccess,event:Event):Promise<ResolvedNotification[]> {
  return (await scopedQuery<ResolvedNotification>(scope,['outbox.work'],`SELECT 'booking'::text AS affected_type,b.id AS affected_entity_id,b.id AS booking_id,NULL::uuid AS parcel_id,b.customer_id,
    b.customer_snapshot->>'phone'=c.phone_normalized AS contact_current,b.state='active' AND b.parcel_set_ref=$2::uuid AS relevant,
    CASE WHEN b.state<>'active' THEN 'booking_inactive' WHEN b.parcel_set_ref<>$2::uuid THEN 'source_mismatch' ELSE 'eligible' END AS reason_code,
    $1::uuid AS canonical_event_id,jsonb_build_object('booking_id',b.id,'parcel_count',b.parcel_count,'confirmed_at',to_char(b.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS values
    FROM shipit.bookings b JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND {{franchise:c.organization_id:c.franchise_id}} AND b.id=$3`,
    [event.event_id,event.payload.parcel_set_ref,event.aggregate_id])).rows;
}
export async function parcel(scope:TenantAccess,event:Event,expected:string):Promise<ResolvedNotification[]> {
  return (await scopedQuery<ResolvedNotification>(scope,['outbox.work'],`SELECT 'parcel'::text AS affected_type,p.id AS affected_entity_id,p.booking_id,p.id AS parcel_id,b.customer_id,
    b.customer_snapshot->>'phone'=c.phone_normalized AS contact_current,b.state='active' AND p.status=$2 AND p.version=$3 AS relevant,
    CASE WHEN b.state<>'active' THEN 'booking_inactive' WHEN p.status<>$2 OR p.version<>$3 THEN 'state_superseded' ELSE 'eligible' END AS reason_code,
    $1::uuid AS canonical_event_id,jsonb_build_object('docket',p.docket,'occurred_at',$4::text) AS values
    FROM shipit.parcels p JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    WHERE {{franchise:p.organization_id:p.franchise_id}} AND {{franchise:b.organization_id:b.franchise_id}} AND {{franchise:c.organization_id:c.franchise_id}} AND p.id=$5`,
    [event.event_id,expected,event.aggregate_version,event.occurred_at,event.aggregate_id])).rows;
}
export async function transit(scope:TenantAccess,event:Event):Promise<ResolvedNotification[]> {
  return (await scopedQuery<ResolvedNotification>(scope,['outbox.work'],`SELECT 'parcel'::text AS affected_type,p.id AS affected_entity_id,p.booking_id,p.id AS parcel_id,b.customer_id,
    b.customer_snapshot->>'phone'=c.phone_normalized AS contact_current,false AS relevant,
    CASE WHEN x.event_id IS NULL THEN 'unsupported_source_cause' ELSE 'overlapping_route_cause' END AS reason_code,
    coalesce(x.event_id,$1::uuid) AS canonical_event_id,jsonb_build_object('docket',p.docket,'occurred_at',$2::text) AS values
    FROM shipit.parcels p JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    LEFT JOIN shipit.route_parcel_effects x ON x.organization_id=p.organization_id AND x.franchise_id=p.franchise_id AND x.parcel_id=p.id AND x.parcel_event_id=$1
    WHERE {{franchise:p.organization_id:p.franchise_id}} AND {{franchise:b.organization_id:b.franchise_id}} AND {{franchise:c.organization_id:c.franchise_id}} AND p.id=$3`,
    [event.event_id,event.occurred_at,event.aggregate_id])).rows;
}
export async function route(scope:TenantAccess,event:Event):Promise<ResolvedNotification[]> {
  return (await scopedQuery<ResolvedNotification>(scope,['outbox.work'],`SELECT 'parcel'::text AS affected_type,x.parcel_id AS affected_entity_id,x.booking_id,x.parcel_id,b.customer_id,
    b.customer_snapshot->>'phone'=c.phone_normalized AS contact_current,
    x.outcome='updated' AND (($2='route.departed' AND r.execution_state='departed') OR ($2='route.arrived' AND r.execution_state='arrived')) AS relevant,
    CASE WHEN x.outcome='skipped' THEN x.skip_reason WHEN NOT (($2='route.departed' AND r.execution_state='departed') OR ($2='route.arrived' AND r.execution_state='arrived')) THEN 'state_superseded' ELSE 'eligible' END AS reason_code,
    x.event_id AS canonical_event_id,jsonb_build_object('docket',p.docket,'route_id',x.route_id,'effective_at',to_char(x.effective_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'base_eta_at',coalesce(to_char(x.base_eta_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'unavailable'),
      'revised_eta_at',coalesce(to_char(x.revised_eta_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'unavailable')) AS values
    FROM shipit.route_parcel_effects x JOIN shipit.parcels p ON p.organization_id=x.organization_id AND p.franchise_id=x.franchise_id AND p.id=x.parcel_id
    JOIN shipit.bookings b ON b.organization_id=x.organization_id AND b.franchise_id=x.franchise_id AND b.id=x.booking_id
    JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    JOIN shipit.routes r ON r.organization_id=x.organization_id AND r.franchise_id=x.franchise_id AND r.id=x.route_id
    WHERE {{franchise:x.organization_id:x.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}} AND {{franchise:b.organization_id:b.franchise_id}}
      AND {{franchise:c.organization_id:c.franchise_id}} AND {{franchise:r.organization_id:r.franchise_id}} AND x.event_id=$1 ORDER BY x.parcel_id`,
    [event.event_id,event.event_type])).rows;
}
export async function installationAvailable(scope:TenantAccess) {
  return (await scopedQuery<{available:boolean}>(scope,['outbox.work'],`SELECT EXISTS(SELECT 1 FROM shipit.whatsapp_installations i
    JOIN shipit.organizations o ON o.id=i.organization_id JOIN shipit.franchises f ON f.organization_id=i.organization_id AND f.id=i.franchise_id
    WHERE {{franchise:i.organization_id:i.franchise_id}} AND {{organization:o.id}} AND {{franchise:f.organization_id:f.id}}
      AND i.state='validated' AND o.lifecycle='active' AND f.lifecycle='active') AS available`)).rows[0]!.available;
}
export async function record(scope:TenantAccess,input:{id:string;event:Event;policy:string;version:number;resolved:ResolvedNotification;kind:string;semantic:string;outcome:DecisionOutcome;reason:string;outbound:string|null}) {
  const c=scope.context;
  await scopedQuery(scope,['outbox.work'],`INSERT INTO shipit.notification_automation_decisions
    (id,organization_id,franchise_id,source_event_id,event_type,policy_id,policy_version,affected_type,affected_entity_id,booking_id,parcel_id,customer_id,
      notification_kind,semantic_key,outcome,reason_code,outbound_intent_id,correlation_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17 WHERE {{franchise:$18:$2}} ON CONFLICT DO NOTHING`,
    [input.id,c.permittedFranchiseIds[0],input.event.event_id,input.event.event_type,input.policy,input.version,input.resolved.affected_type,input.resolved.affected_entity_id,
      input.resolved.booking_id,input.resolved.parcel_id,input.resolved.customer_id,input.kind,input.semantic,input.outcome,input.reason,input.outbound,input.event.correlation_id,c.organizationId]);
}
