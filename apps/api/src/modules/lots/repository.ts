import { scopedQuery,assertTenantAccess,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { LotRow,MembershipRow,LotInput,LotOperation,LotFilter,LotBoundary,ParcelReference,LotDto,LotMembershipResult } from './types.ts';
const lotColumns=`l.id,l.code,l.name,l.destination_key,l.state,l.version,l.created_at,l.updated_at,l.archived_at,
  (SELECT count(*)::int FROM shipit.lot_memberships m WHERE m.organization_id=l.organization_id AND m.franchise_id=l.franchise_id AND m.lot_id=l.id AND m.ended_at IS NULL) AS active_member_count`;
const memberColumns='m.id,m.lot_id,m.parcel_id,m.started_at,m.ended_at,m.end_reason';
// Cross-domain and evidence-only capabilities cannot read operational lot records.
function lotContext(scope:TenantAccess) {
  return assertTenantAccess(scope,['lots.read','lots.list','lots.create','lots.update','lots.archive',
    'lots.membership.add','lots.membership.move','lots.membership.remove']);
}
export async function active(scope:TenantAccess) {
  const c=lotContext(scope);
  const row=(await scopedQuery<{lifecycle:string;now:Date}>(scope,[c.action],`SELECT lifecycle,date_trunc('milliseconds',clock_timestamp()) AS now
    FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
  if(row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
  return row.now;
}
export async function load(scope:TenantAccess,id:string,lock=false) {
  const c=lotContext(scope);
  const row=(await scopedQuery<LotRow>(scope,[c.action],`SELECT ${lotColumns} FROM shipit.lots l
    WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.id=$1 ${lock?'FOR UPDATE OF l':''}`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function parcel(scope:TenantAccess,id:string,lock=false) {
  const c=lotContext(scope);
  const row=(await scopedQuery<ParcelReference>(scope,[c.action],`SELECT p.id,p.booking_id,p.status,
    b.tax_intent->'pricing_input'->>'destination_key' AS destination_key FROM shipit.parcels p
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 ${lock?'FOR UPDATE OF p':''}`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function locked(scope:TenantAccess,id:string) {
  const c=lotContext(scope);
  return (await scopedQuery<{locked:boolean}>(scope,[c.action],`SELECT EXISTS(SELECT 1 FROM shipit.lot_memberships m
    JOIN shipit.parcels p ON p.organization_id=m.organization_id AND p.franchise_id=m.franchise_id AND p.booking_id=m.booking_id AND p.id=m.parcel_id
    WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.lot_id=$1 AND p.status NOT IN ('booked','checked_in')) AS locked`,[id])).rows[0]!.locked;
}
export async function knownDestination(scope:TenantAccess,key:string) {
  return (await scopedQuery<{known:boolean}>(scope,['lots.create'],`SELECT EXISTS(SELECT 1 FROM shipit.pricing_rules r
    JOIN shipit.pricing_versions v ON v.organization_id=r.organization_id AND v.franchise_id=r.franchise_id AND v.id=r.version_id
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.destination_key=$1 AND v.state='published') AS known`,[key])).rows[0]!.known;
}
export async function currentMembership(scope:TenantAccess,parcelId:string) {
  const c=lotContext(scope);
  return (await scopedQuery<MembershipRow>(scope,[c.action],`SELECT ${memberColumns} FROM shipit.lot_memberships m
    WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.parcel_id=$1 AND m.ended_at IS NULL`,[parcelId])).rows[0]??null;
}
export async function replay(scope:TenantAccess,operation:LotOperation,key:string) {
  const c=assertTenantAccess(scope,[operation]);
  return (await scopedQuery<{fingerprint:string;state:string;dispatcher_required:boolean;result:LotDto|LotMembershipResult}>(scope,[operation],
    `SELECT fingerprint,state,dispatcher_required,result FROM shipit.lot_commands
    WHERE {{franchise:organization_id:franchise_id}} AND principal_id=$1 AND operation_id=$2 AND key_digest=$3 FOR UPDATE`,
    [c.actor.id,`api.v1.${operation}`,key])).rows[0]??null;
}
export async function reserve(scope:TenantAccess,id:string,operation:LotOperation,key:string,fingerprint:string,lotId:string,
  parcelRef:ParcelReference|null,memberId:string|null,input:LotInput,dispatcher:boolean,time:string) {
  const c=assertTenantAccess(scope,[operation]);
  await scopedQuery(scope,[operation],`INSERT INTO shipit.lot_commands
    (id,organization_id,franchise_id,principal_id,operation_id,key_digest,fingerprint,lot_id,target_lot_id,booking_id,parcel_id,membership_id,
      expected_version,expected_target_version,dispatcher_required,input,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17 WHERE {{franchise:$18:$2}}`,
    [id,c.permittedFranchiseIds[0],c.actor.id,`api.v1.${operation}`,key,fingerprint,lotId,input.target_lot_id??null,parcelRef?.booking_id??null,
      parcelRef?.id??null,memberId,input.expected_version??null,input.expected_target_version??null,dispatcher,input,c.correlationId,time,c.organizationId]);
}
export async function create(scope:TenantAccess,id:string,commandId:string,input:LotInput,time:string) {
  const c=assertTenantAccess(scope,['lots.create']);
  await scopedQuery(scope,['lots.create'],`INSERT INTO shipit.lots(id,organization_id,franchise_id,name,destination_key,created_at,updated_at,last_command_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$5,$6 WHERE {{franchise:$7:$2}}`,
    [id,c.permittedFranchiseIds[0],input.name,input.destination_key,time,commandId,c.organizationId]);
}
export async function revise(scope:TenantAccess,id:string,expected:number,commandId:string,time:string,name:string,archive:boolean) {
  const c=lotContext(scope);
  const r=await scopedQuery(scope,[c.action],`UPDATE shipit.lots SET name=$2,version=version+1,updated_at=$3,last_command_id=$4,
    state=CASE WHEN $5 THEN 'archived' ELSE 'active' END,archived_at=CASE WHEN $5 THEN $3::timestamptz ELSE NULL END
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND version=$6 AND state='active'`,[id,name,time,commandId,archive,expected]);
  if(r.rowCount!==1)throw new HttpError('VERSION_CONFLICT');
}
export async function startMembership(scope:TenantAccess,id:string,lotId:string,parcelRef:ParcelReference,commandId:string,time:string) {
  const c=lotContext(scope);
  return (await scopedQuery<MembershipRow>(scope,[c.action],`INSERT INTO shipit.lot_memberships AS m
    (id,organization_id,franchise_id,lot_id,booking_id,parcel_id,started_at,start_command_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}} RETURNING ${memberColumns}`,
    [id,c.permittedFranchiseIds[0],lotId,parcelRef.booking_id,parcelRef.id,time,commandId,c.organizationId])).rows[0]!;
}
export async function endMembership(scope:TenantAccess,lotId:string,memberId:string|null,commandId:string,time:string,reason:'removed'|'moved'|'archived') {
  const c=lotContext(scope);
  await scopedQuery(scope,[c.action],`UPDATE shipit.lot_memberships SET ended_at=$3,end_command_id=$4,end_reason=$5
    WHERE {{franchise:organization_id:franchise_id}} AND lot_id=$1 AND ($2::uuid IS NULL OR id=$2) AND ended_at IS NULL`,[lotId,memberId,time,commandId,reason]);
}
export async function appendEvent(scope:TenantAccess,lot:LotRow,commandId:string,eventId:string,eventType:string,payload:Record<string,string>,time:string) {
  const c=assertTenantAccess(scope,['lots.events']);
  const envelope={event_id:eventId,event_type:eventType,schema_version:1,organization_id:c.organizationId!,franchise_id:c.permittedFranchiseIds[0]!,
    aggregate_type:'lot',aggregate_id:lot.id,aggregate_version:lot.version,occurred_at:time,actor:{type:'user',id:c.actor.id},
    correlation_id:c.correlationId,causation_id:commandId,command_id:commandId,payload};
  await scopedQuery(scope,['lots.events'],`INSERT INTO shipit.domain_events
    (event_id,organization_id,franchise_id,lot_id,lot_command_id,command_id,event_type,aggregate_id,envelope,occurred_at,aggregate_sequence)
    SELECT $1,{{organization}},$2,$3,$4,$4,$5,$3,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
    [eventId,c.permittedFranchiseIds[0],lot.id,commandId,eventType,envelope,time,lot.version,c.organizationId]);
}
export async function complete(scope:TenantAccess,commandId:string,result:LotDto|LotMembershipResult,created:boolean) {
  const c=lotContext(scope);
  await scopedQuery(scope,[c.action],`UPDATE shipit.lot_commands SET state='committed',http_status=$2,result=$3,
    committed_at=date_trunc('milliseconds',clock_timestamp()),retain_until=date_trunc('milliseconds',clock_timestamp())+interval '24 hours'
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND state='reserved'`,[commandId,created?201:200,result]);
}
export async function list(scope:TenantAccess,f:LotFilter,b:LotBoundary|null) {
  return (await scopedQuery<LotRow>(scope,['lots.list'],`SELECT ${lotColumns} FROM shipit.lots l
    WHERE {{franchise:l.organization_id:l.franchise_id}} AND ($1::text IS NULL OR l.state=$1) AND ($2::text IS NULL OR l.destination_key=$2)
    AND ($3::timestamptz IS NULL OR (l.created_at,l.id)<($3::timestamptz,$4::uuid)) ORDER BY l.created_at DESC,l.id DESC LIMIT $5`,
    [f.state,f.destination,b?.value??null,b?.id??null,f.limit+1])).rows;
}
export async function memberships(scope:TenantAccess,id:string,f:LotFilter,b:LotBoundary|null) {
  return (await scopedQuery<MembershipRow>(scope,['lots.read'],`SELECT ${memberColumns} FROM shipit.lot_memberships m
    WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.lot_id=$1
    AND ($2::text IS NULL OR (CASE WHEN m.ended_at IS NULL THEN 'active' ELSE 'ended' END)=$2)
    AND ($3::timestamptz IS NULL OR (m.started_at,m.id)<($3::timestamptz,$4::uuid)) ORDER BY m.started_at DESC,m.id DESC LIMIT $5`,
    [id,f.state,b?.value??null,b?.id??null,f.limit+1])).rows;
}

export async function membershipById(scope:TenantAccess,id:string) {
  const c=lotContext(scope);
  const row=(await scopedQuery<MembershipRow>(scope,[c.action],`SELECT ${memberColumns} FROM shipit.lot_memberships m
    WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.id=$1`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}

/** Routes consumes the owning Lot authority in the caller's transaction. */
export async function routeLot(scope:TenantAccess,id:string) {
  const c=assertTenantAccess(scope,['routes.lot.attach','routes.lot.detach','routes.update','routes.finalize','routes.parcel.attach','routes.parcel.detach']);
  const row=(await scopedQuery<{id:string;state:string}>(scope,[c.action],`SELECT id,state FROM shipit.lots
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 FOR UPDATE`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function routeMembers(scope:TenantAccess,id:string) {
  const c=assertTenantAccess(scope,['routes.lot.attach','routes.lot.detach','routes.update','routes.finalize','routes.parcel.attach','routes.parcel.detach']);
  return (await scopedQuery<{parcel_id:string;booking_id:string;status:string;booking_state:string;lot_membership_id:string}>(scope,[c.action],
    `SELECT p.id AS parcel_id,p.booking_id,p.status,b.state AS booking_state,m.id AS lot_membership_id FROM shipit.lot_memberships m
      JOIN shipit.parcels p ON p.organization_id=m.organization_id AND p.franchise_id=m.franchise_id AND p.booking_id=m.booking_id AND p.id=m.parcel_id
      JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
      WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.lot_id=$1 AND m.ended_at IS NULL ORDER BY p.id LIMIT 1001 FOR UPDATE OF p`,[id])).rows;
}
export async function guardActiveRoute(scope:TenantAccess,id:string) {
  const c=lotContext(scope);
  const row=(await scopedQuery<{active:boolean}>(scope,[c.action],`SELECT EXISTS(SELECT 1 FROM shipit.route_lots s
    JOIN shipit.routes r ON r.organization_id=s.organization_id AND r.franchise_id=s.franchise_id AND r.id=s.route_id
    WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.lot_id=$1 AND s.ended_at IS NULL AND r.state='planning') AS active`,[id])).rows[0];
  if(row?.active)throw new HttpError('LOT_ACTIVE_ROUTE');
}
