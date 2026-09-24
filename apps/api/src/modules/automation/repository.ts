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
const publicFailureReason:Readonly<Record<string,string>>={
  customer_unavailable:'The recipient was unavailable',
  customer_requests_pickup:'The recipient requested office collection',
  address_issue:'The delivery address needs confirmation',
  recipient_refusal:'The recipient could not accept the delivery',
  payment_not_collected:'The required payment was not collected',
  operational_issue:'An operational issue prevented delivery',
  other_controlled:'A delivery condition prevented completion',
};
export function safeFailureReason(reason:string) {
  const value=publicFailureReason[reason];if(!value)throw new Error('NOTIFICATION_FAILURE_REASON_UNSUPPORTED');return value;
}
export async function failedAttempt(scope:TenantAccess,event:Event):Promise<ResolvedNotification[]> {
  const rows=(await scopedQuery<ResolvedNotification&{failure_reason:string}>(scope,['outbox.work'],`SELECT 'parcel'::text AS affected_type,p.id AS affected_entity_id,p.booking_id,p.id AS parcel_id,b.customer_id,
    b.customer_snapshot->>'phone'=c.phone_normalized AS contact_current,
    b.state='active' AND p.status='failed_attempt' AND p.version=e.aggregate_sequence AND a.state='failed'
      AND f.attempt_number=p.failed_attempt_count AND NOT EXISTS(SELECT 1 FROM shipit.delivery_attempts newer
        WHERE {{franchise:newer.organization_id:newer.franchise_id}} AND newer.parcel_id=p.id AND newer.attempt_number>a.attempt_number) AS relevant,
    CASE WHEN b.state<>'active' THEN 'booking_inactive' WHEN p.status<>'failed_attempt' OR p.version<>e.aggregate_sequence
      OR a.state<>'failed' OR f.attempt_number<>p.failed_attempt_count OR EXISTS(SELECT 1 FROM shipit.delivery_attempts newer
        WHERE {{franchise:newer.organization_id:newer.franchise_id}} AND newer.parcel_id=p.id AND newer.attempt_number>a.attempt_number)
      THEN 'source_superseded' ELSE 'eligible' END AS reason_code,
    e.event_id AS canonical_event_id,jsonb_build_object('docket',p.docket,'occurred_at',to_char(f.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS values,
    f.reason_code AS failure_reason
    FROM shipit.domain_events e JOIN shipit.parcels p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.aggregate_id
    JOIN shipit.parcel_failed_attempts f ON f.organization_id=e.organization_id AND f.franchise_id=e.franchise_id AND f.id=e.event_id AND f.parcel_id=p.id
    JOIN shipit.delivery_attempts a ON a.organization_id=f.organization_id AND a.franchise_id=f.franchise_id AND a.id=f.attempt_id AND a.parcel_id=p.id
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}}
      AND {{franchise:f.organization_id:f.franchise_id}} AND {{franchise:a.organization_id:a.franchise_id}}
      AND {{franchise:b.organization_id:b.franchise_id}} AND {{franchise:c.organization_id:c.franchise_id}}
      AND e.event_id=$1 AND e.event_type='delivery.attempt_failed' AND e.aggregate_id=$2
      AND a.id::text=e.envelope->'payload'->>'attempt_id' AND f.reason_code=e.envelope->'payload'->>'failure_reason'
      AND f.evidence_ref::text=e.envelope->'payload'->>'evidence_ref'`,[event.event_id,event.aggregate_id])).rows;
  return rows.map(row=>({...row,values:{...row.values,safe_failure_reason:safeFailureReason(row.failure_reason)}}));
}
export async function rto(scope:TenantAccess,event:Event):Promise<ResolvedNotification[]> {
  return (await scopedQuery<ResolvedNotification>(scope,['outbox.work'],`SELECT 'parcel'::text AS affected_type,p.id AS affected_entity_id,p.booking_id,p.id AS parcel_id,b.customer_id,
    b.customer_snapshot->>'phone'=c.phone_normalized AS contact_current,b.state='active' AND p.status='rto' AND p.version=e.aggregate_sequence AS relevant,
    CASE WHEN b.state<>'active' THEN 'booking_inactive' WHEN p.status<>'rto' OR p.version<>e.aggregate_sequence THEN 'source_superseded' ELSE 'eligible' END AS reason_code,
    e.event_id AS canonical_event_id,jsonb_build_object('docket',p.docket,'occurred_at',to_char(r.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) AS values
    FROM shipit.domain_events e JOIN shipit.parcels p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.aggregate_id
    JOIN shipit.parcel_rto_approvals r ON r.organization_id=e.organization_id AND r.franchise_id=e.franchise_id AND r.id=e.event_id AND r.parcel_id=p.id
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}}
      AND {{franchise:r.organization_id:r.franchise_id}} AND {{franchise:b.organization_id:b.franchise_id}} AND {{franchise:c.organization_id:c.franchise_id}}
      AND e.event_id=$1 AND e.event_type='parcel.rto_approved' AND e.aggregate_id=$2
      AND r.approval_ref::text=e.envelope->'payload'->>'approval_ref' AND r.eligibility_ref::text=e.envelope->'payload'->>'eligibility_ref'
      AND r.return_plan_ref::text=e.envelope->'payload'->>'return_plan_ref'`,[event.event_id,event.aggregate_id])).rows;
}
export async function completion(scope:TenantAccess,event:Event):Promise<ResolvedNotification[]> {
  return (await scopedQuery<ResolvedNotification>(scope,['outbox.work'],`SELECT 'parcel'::text AS affected_type,p.id AS affected_entity_id,p.booking_id,p.id AS parcel_id,b.customer_id,
    b.customer_snapshot->>'phone'=c.phone_normalized AS contact_current,b.state='active' AND p.status='delivered' AND p.version=e.aggregate_sequence AS relevant,
    CASE WHEN b.state<>'active' THEN 'booking_inactive' WHEN p.status<>'delivered' OR p.version<>e.aggregate_sequence THEN 'source_superseded' ELSE 'eligible' END AS reason_code,
    e.event_id AS canonical_event_id,jsonb_build_object('docket',p.docket,
      'completed_at',to_char(proof.completed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'proof_wording',CASE proof.proof_method WHEN 'otp_verified' THEN 'recipient verification' ELSE 'approved alternate delivery proof' END) AS values
    FROM shipit.domain_events e JOIN shipit.parcels p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.aggregate_id
    JOIN shipit.delivery_attempts a ON a.organization_id=e.organization_id AND a.franchise_id=e.franchise_id AND a.id::text=e.envelope->'payload'->>'attempt_id' AND a.parcel_id=p.id
    JOIN shipit.delivery_proofs proof ON proof.organization_id=a.organization_id AND proof.franchise_id=a.franchise_id
      AND proof.id::text=e.envelope->'payload'->>'proof_ref' AND proof.attempt_id=a.id AND proof.parcel_id=p.id
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}}
      AND {{franchise:a.organization_id:a.franchise_id}} AND {{franchise:proof.organization_id:proof.franchise_id}}
      AND {{franchise:b.organization_id:b.franchise_id}} AND {{franchise:c.organization_id:c.franchise_id}}
      AND e.event_id=$1 AND e.event_type='delivery.completed' AND e.aggregate_id=$2`,[event.event_id,event.aggregate_id])).rows;
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
