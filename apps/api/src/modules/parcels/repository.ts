import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { ParcelDto } from '../bookings/types.ts';
import type { ParcelCommandInput,ParcelLifecycleRow,ParcelOperation,ParcelTransitionDto } from './types.ts';
export async function insert(scope: TenantAccess, booking: string, index: number, parcel: ParcelDto, manual: string|null) {
  const c = assertTenantAccess(scope,['parcels.create']);
  const row = (await scopedQuery<{docket:string}>(scope,['parcels.create'],`INSERT INTO shipit.parcels
    (id,organization_id,franchise_id,booking_id,position,docket,weight_grams,sender_snapshot,recipient_snapshot)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}} RETURNING docket`,
  [parcel.id,c.permittedFranchiseIds[0],booking,index,manual,parcel.weight_grams,parcel.sender,parcel.recipient,c.organizationId])).rows[0]!;
  return row.docket;
}

export async function replay(scope:TenantAccess,parcelId:string,operation:ParcelOperation,key:string,fingerprint:string) {
  const c=assertTenantAccess(scope,[operation]);
  const previous=(await scopedQuery<{parcel_id:string;operation_id:string;fingerprint:string;state:string;result:ParcelTransitionDto}>(scope,[operation],
    `SELECT pc.parcel_id,pc.operation_id,pc.fingerprint,pc.state,pc.result FROM shipit.parcel_commands pc
      JOIN shipit.parcels p ON p.organization_id=pc.organization_id AND p.franchise_id=pc.franchise_id AND p.id=pc.parcel_id
      WHERE {{franchise:pc.organization_id:pc.franchise_id}} AND pc.principal_id=$1 AND pc.operation_id=$2 AND pc.key_digest=$3 FOR UPDATE`,
    [c.actor.id,`api.v1.${operation}`,key])).rows[0];
  if(!previous)return null;
  if(previous.parcel_id!==parcelId||previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
  if(previous.state!=='committed'||!previous.result)throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
  return structuredClone(previous.result);
}

export async function load(scope:TenantAccess,parcelId:string) {
  const c=assertTenantAccess(scope);
  const row=(await scopedQuery<ParcelLifecycleRow&{booking_state:string;organization_lifecycle:string;franchise_lifecycle:string}>(scope,[c.action],
    `SELECT p.id,p.booking_id,p.organization_id,p.franchise_id,p.docket,p.version,p.status,p.custody,p.attempts_started,
      p.failed_attempt_count,p.active_attempt_id,p.assigned_agent_id,b.state AS booking_state,o.lifecycle AS organization_lifecycle,
      f.lifecycle AS franchise_lifecycle FROM shipit.parcels p
      JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
      JOIN shipit.organizations o ON o.id=p.organization_id
      JOIN shipit.franchises f ON f.organization_id=p.organization_id AND f.id=p.franchise_id
      WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 FOR UPDATE OF p`,[parcelId])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
  if(row.organization_lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
  if(row.franchise_lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
  if(row.booking_state!=='active')throw new HttpError('PARCEL_STATE_CONFLICT');
  return row;
}

export async function databaseNow(scope:TenantAccess) {
  const c=assertTenantAccess(scope);
  return (await scopedQuery<{instant:Date}>(scope,[c.action],`SELECT date_trunc('milliseconds',clock_timestamp()) AS instant
    FROM shipit.franchises WHERE {{franchise:organization_id:id}}`)).rows[0]!.instant;
}

export async function lastFailureReason(scope:TenantAccess,parcelId:string) {
  return (await scopedQuery<{reason_code:string}>(scope,['parcels.approve_rto'],`SELECT f.reason_code FROM shipit.parcel_failed_attempts f
    WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.parcel_id=$1 ORDER BY f.attempt_number DESC LIMIT 1`,[parcelId])).rows[0]?.reason_code??null;
}

export async function reserve(scope:TenantAccess,id:string,parcel:ParcelLifecycleRow,operation:ParcelOperation,key:string,fingerprint:string,input:ParcelCommandInput) {
  const c=assertTenantAccess(scope,[operation]);
  await scopedQuery(scope,[operation],`INSERT INTO shipit.parcel_commands
    (id,principal_id,organization_id,franchise_id,booking_id,parcel_id,operation_id,key_digest,fingerprint,expected_version,
      from_status,to_status,input,correlation_id)
    SELECT $1,$2,{{organization}},$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 WHERE {{franchise:$14:$3}}`,
  [id,c.actor.id,c.permittedFranchiseIds[0],parcel.booking_id,parcel.id,`api.v1.${operation}`,key,fingerprint,input.expected_version,
    parcel.status,operation==='parcels.check_in'?'checked_in':operation==='parcels.dispatch'?'dispatched':operation==='parcels.transit'?'in_transit':operation==='parcels.fail_delivery'?'failed_attempt':'rto',input,c.correlationId,c.organizationId]);
}

const mutation:Readonly<Record<ParcelOperation,string>>={
  'parcels.check_in':`status='checked_in',custody='franchise_office'`,
  'parcels.dispatch':`status='dispatched',custody='route_dispatch'`,
  'parcels.transit':`status='in_transit',custody='route_dispatch'`,
  'parcels.fail_delivery':`status='failed_attempt',active_attempt_id=NULL,failed_attempt_count=failed_attempt_count+1`,
  'parcels.approve_rto':`status='rto',active_attempt_id=NULL`,
};
export async function mutate(scope:TenantAccess,parcel:ParcelLifecycleRow,commandId:string,operation:ParcelOperation,time:string) {
  return (await scopedQuery<ParcelLifecycleRow>(scope,[operation],`UPDATE shipit.parcels SET ${mutation[operation]},version=version+1,
    last_command_id=$2,updated_at=$3 WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND version=$4 AND status=$5 RETURNING
    id,booking_id,organization_id,franchise_id,docket,version,status,custody,attempts_started,failed_attempt_count,active_attempt_id,assigned_agent_id`,
  [parcel.id,commandId,time,parcel.version,parcel.status])).rows[0];
}

export async function appendTransition(scope:TenantAccess,commandId:string,eventId:string,before:ParcelLifecycleRow,after:ParcelLifecycleRow,
  operation:ParcelOperation,input:ParcelCommandInput,time:string) {
  const c=assertTenantAccess(scope,[operation]);
  await scopedQuery(scope,[operation],`INSERT INTO shipit.parcel_transitions
    (id,organization_id,franchise_id,booking_id,parcel_id,command_id,sequence,operation_id,from_status,to_status,actor_id,
      reason_code,evidence_ref,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14 WHERE {{franchise:$15:$2}}`,
  [eventId,c.permittedFranchiseIds[0],before.booking_id,before.id,commandId,after.version,operation,before.status,after.status,c.actor.id,
    input.reason_code??input.override_reason_code??null,input.evidence_ref,c.correlationId,time,c.organizationId]);
}

export async function appendFailure(scope:TenantAccess,commandId:string,eventId:string,parcel:ParcelLifecycleRow,input:ParcelCommandInput,time:string) {
  const c=assertTenantAccess(scope,['parcels.fail_delivery']);
  await scopedQuery(scope,['parcels.fail_delivery'],`INSERT INTO shipit.parcel_failed_attempts
    (id,organization_id,franchise_id,booking_id,parcel_id,command_id,attempt_id,attempt_number,reason_code,failure_subreason_code,evidence_ref,actor_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,
  [eventId,c.permittedFranchiseIds[0],parcel.booking_id,parcel.id,commandId,input.attempt_id,parcel.failed_attempt_count,input.reason_code,
    input.failure_subreason_code??null,input.evidence_ref,c.actor.id,time,c.organizationId]);
}

export async function appendRto(scope:TenantAccess,commandId:string,eventId:string,parcel:ParcelLifecycleRow,input:ParcelCommandInput,time:string) {
  const c=assertTenantAccess(scope,['parcels.approve_rto']);
  await scopedQuery(scope,['parcels.approve_rto'],`INSERT INTO shipit.parcel_rto_approvals
    (id,organization_id,franchise_id,booking_id,parcel_id,command_id,mode,override_reason_code,approval_ref,eligibility_ref,return_plan_ref,actor_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,
  [eventId,c.permittedFranchiseIds[0],parcel.booking_id,parcel.id,commandId,input.override_reason_code?'privileged_override':'attempt_limit',
    input.override_reason_code??null,input.approval_ref,input.evidence_ref,input.return_plan_ref,c.actor.id,time,c.organizationId]);
}

export async function appendEvent(scope:TenantAccess,commandId:string,eventId:string,parcel:ParcelLifecycleRow,operation:ParcelOperation,
  input:ParcelCommandInput,time:string) {
  const c=assertTenantAccess(scope,['parcels.events']);
  const eventType=operation==='parcels.check_in'?'parcel.checked_in':operation==='parcels.dispatch'?'parcel.dispatched':
    operation==='parcels.transit'?'parcel.in_transit':operation==='parcels.fail_delivery'?'delivery.attempt_failed':'parcel.rto_approved';
  const payload=operation==='parcels.check_in'?{receipt_ref:input.evidence_ref,location_ref:input.location_ref}:
    operation==='parcels.dispatch'?{manifest_id:input.manifest_id,dispatch_evidence_ref:input.evidence_ref}:
    operation==='parcels.transit'?{route_id:input.route_id,movement_evidence_ref:input.evidence_ref}:
    operation==='parcels.fail_delivery'?{attempt_id:input.attempt_id,failure_reason:input.reason_code,evidence_ref:input.evidence_ref,
      ...(input.failure_subreason_code?{failure_subreason:input.failure_subreason_code}:{})}:
    {approval_ref:input.approval_ref,eligibility_ref:input.evidence_ref,return_plan_ref:input.return_plan_ref,...(input.override_reason_code?{override_reason_code:input.override_reason_code}:{})};
  const envelope={event_id:eventId,event_type:eventType,schema_version:1,organization_id:c.organizationId!,franchise_id:c.permittedFranchiseIds[0]!,
    aggregate_type:'parcel',aggregate_id:parcel.id,aggregate_version:parcel.version,occurred_at:time,actor:{type:'user',id:c.actor.id},
    correlation_id:c.correlationId,causation_id:commandId,command_id:commandId,payload};
  await scopedQuery(scope,['parcels.events'],`INSERT INTO shipit.domain_events
    (event_id,organization_id,franchise_id,booking_id,parcel_id,command_id,parcel_command_id,event_type,aggregate_id,envelope,occurred_at,aggregate_sequence)
    SELECT $1,{{organization}},$2,$3,$4,$5,$5,$6,$4,$7,$8,$9 WHERE {{franchise:$10:$2}}`,
  [eventId,c.permittedFranchiseIds[0],parcel.booking_id,parcel.id,commandId,eventType,envelope,time,parcel.version,c.organizationId]);
}

export async function complete(scope:TenantAccess,commandId:string,result:ParcelTransitionDto) {
  const c=assertTenantAccess(scope);
  await scopedQuery(scope,[c.action],`UPDATE shipit.parcel_commands SET state='committed',http_status=200,result=$2,
    committed_at=date_trunc('milliseconds',clock_timestamp()),retain_until=date_trunc('milliseconds',clock_timestamp())+interval '24 hours'
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND state='reserved'`,[commandId,result]);
}

/** Minimal Parcel reference for initial dispatch planning, never shipment PII. */
export async function routeParcel(scope:TenantAccess,id:string) {
  const c=assertTenantAccess(scope,['routes.lot.attach','routes.lot.detach','routes.update','routes.finalize','routes.parcel.attach','routes.parcel.detach']);
  const row=(await scopedQuery<{parcel_id:string;booking_id:string;status:string;booking_state:string}>(scope,[c.action],
    `SELECT p.id AS parcel_id,p.booking_id,p.status,b.state AS booking_state FROM shipit.parcels p
      JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
      WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 FOR UPDATE OF p`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
