import { assertTenantAccess,scopedQuery,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { RouteRow,ManifestRow,RouteOperation,RouteInput,RouteFilter,RouteBoundary,SourceRow,Contribution,RouteDto,RouteManifestItem } from './types.ts';
const columns='r.id,r.origin,r.destination,r.mode,r.carrier_code,r.scheduled_departure_at,r.state,r.version,r.current_manifest_id,r.created_at,r.updated_at';
function context(scope:TenantAccess) {return assertTenantAccess(scope,['routes.read','routes.list','routes.create','routes.update','routes.archive','routes.finalize','routes.lot.attach','routes.lot.detach','routes.parcel.attach','routes.parcel.detach']);}
export async function active(scope:TenantAccess) {
  const c=context(scope),row=(await scopedQuery<{lifecycle:string;now:Date}>(scope,[c.action],`SELECT lifecycle,date_trunc('milliseconds',clock_timestamp()) AS now
    FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');if(row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');return row.now;
}
export async function load(scope:TenantAccess,id:string,lock=false) {
  const c=context(scope),r=(await scopedQuery<RouteRow>(scope,[c.action],`SELECT ${columns} FROM shipit.routes r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1 ${lock?'FOR UPDATE OF r':''}`,[id])).rows[0];
  if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return r;
}
export async function replay(scope:TenantAccess,operation:RouteOperation,key:string) {
  const c=assertTenantAccess(scope,[operation]);
  return (await scopedQuery<{fingerprint:string;state:string;result:RouteDto|null}>(scope,[operation],`SELECT fingerprint,state,result FROM shipit.route_commands
    WHERE {{franchise:organization_id:franchise_id}} AND principal_id=$1 AND operation_id=$2 AND key_digest=$3 FOR UPDATE`,
    [c.actor.id,`api.v1.${operation}`,key])).rows[0]??null;
}
export async function reserve(scope:TenantAccess,id:string,route:string,operation:RouteOperation,key:string,fingerprint:string,input:RouteInput,resource:string|null,time:string) {
  const c=assertTenantAccess(scope,[operation]);
  await scopedQuery(scope,[operation],`INSERT INTO shipit.route_commands
    (id,organization_id,franchise_id,principal_id,route_id,operation_id,key_digest,fingerprint,expected_version,input,source_resource_id,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,
    [id,c.permittedFranchiseIds[0],c.actor.id,route,`api.v1.${operation}`,key,fingerprint,input.expected_version??null,input,resource,c.correlationId,time,c.organizationId]);
}
export async function create(scope:TenantAccess,id:string,manifest:string,command:string,b:RouteInput,time:string) {
  const c=assertTenantAccess(scope,['routes.create']);
  await scopedQuery(scope,['routes.create'],`INSERT INTO shipit.routes
    (id,organization_id,franchise_id,origin,destination,mode,carrier_code,scheduled_departure_at,current_manifest_id,last_command_id,created_at,updated_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$10 WHERE {{franchise:$11:$2}}`,
    [id,c.permittedFranchiseIds[0],b.origin,b.destination,b.mode,b.carrier_code,b.scheduled_departure_at,manifest,command,time,c.organizationId]);
}
export async function revise(scope:TenantAccess,before:RouteRow,manifest:string,command:string,b:RouteInput,operation:RouteOperation,time:string) {
  const r=await scopedQuery(scope,[operation],`UPDATE shipit.routes SET origin=$2,destination=$3,mode=$4,carrier_code=$5,scheduled_departure_at=$6,
    state=$7,version=version+1,current_manifest_id=$8,last_command_id=$9,updated_at=$10
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND version=$11 AND state='planning'`,
    [before.id,b.origin??before.origin,b.destination??before.destination,b.mode??before.mode,operation==='routes.update'?b.carrier_code:before.carrier_code,
      b.scheduled_departure_at??before.scheduled_departure_at,operation==='routes.finalize'?'finalized':operation==='routes.archive'?'archived':'planning',manifest,command,time,b.expected_version]);
  if(r.rowCount!==1)throw new HttpError('VERSION_CONFLICT');
}
export async function sources(scope:TenantAccess,route:string) {
  const c=context(scope);
  return (await scopedQuery<SourceRow>(scope,[c.action],`SELECT id,'lot'::text AS kind,lot_id,NULL::uuid AS parcel_id FROM shipit.route_lots
    WHERE {{franchise:organization_id:franchise_id}} AND route_id=$1 AND ended_at IS NULL
    UNION ALL SELECT id,'direct'::text AS kind,NULL::uuid AS lot_id,parcel_id FROM shipit.route_parcels
    WHERE {{franchise:organization_id:franchise_id}} AND route_id=$1 AND ended_at IS NULL ORDER BY id LIMIT 101`,[route])).rows;
}
export async function changeSource(scope:TenantAccess,route:string,resource:string,command:string,operation:RouteOperation,time:string) {
  const lot=operation.startsWith('routes.lot.'),table=lot?'route_lots':'route_parcels',field=lot?'lot_id':'parcel_id';
  const c=assertTenantAccess(scope,[operation]);
  if(operation.endsWith('.attach'))await scopedQuery(scope,[operation],`INSERT INTO shipit.${table}
    (id,organization_id,franchise_id,route_id,${field},start_command_id,started_at)
    SELECT gen_random_uuid(),{{organization}},$1,$2,$3,$4,$5 WHERE {{franchise:$6:$1}}`,[c.permittedFranchiseIds[0],route,resource,command,time,c.organizationId]);
  else {
    const r=await scopedQuery(scope,[operation],`UPDATE shipit.${table} SET ended_at=$3,end_command_id=$4
      WHERE {{franchise:organization_id:franchise_id}} AND route_id=$1 AND ${field}=$2 AND ended_at IS NULL`,[route,resource,time,command]);
    if(r.rowCount!==1)throw new HttpError('ROUTE_MANIFEST_CONFLICT');
  }
}
export async function manifest(scope:TenantAccess,route:string,id:string) {
  const c=context(scope),r=(await scopedQuery<ManifestRow>(scope,[c.action],`SELECT id,route_id,version,finalized,parcel_count,created_at FROM shipit.route_manifests
    WHERE {{franchise:organization_id:franchise_id}} AND route_id=$1 AND id=$2`,[route,id])).rows[0];
  if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return r;
}
export async function snapshot(scope:TenantAccess,route:string,id:string,version:number,finalized:boolean,command:string,rows:Contribution[],time:string) {
  const c=context(scope),parcels=[...new Map(rows.map(r=>[r.parcel_id,{parcel_id:r.parcel_id,booking_id:r.booking_id}])).values()].sort((a,b)=>a.parcel_id.localeCompare(b.parcel_id));
  await scopedQuery(scope,[c.action],`INSERT INTO shipit.route_manifests(id,organization_id,franchise_id,route_id,version,finalized,parcel_count,command_id,created_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[id,c.permittedFranchiseIds[0],route,version,finalized,parcels.length,command,time,c.organizationId]);
  await scopedQuery(scope,[c.action],`INSERT INTO shipit.route_manifest_parcels(organization_id,franchise_id,route_id,manifest_id,parcel_id,booking_id,finalized)
    SELECT {{organization}},$1,$2,$3,p.parcel_id,p.booking_id,$4 FROM jsonb_to_recordset($5::jsonb) AS p(parcel_id uuid,booking_id uuid)
    WHERE {{franchise:$6:$1}}`,[c.permittedFranchiseIds[0],route,id,finalized,JSON.stringify(parcels),c.organizationId]);
  await scopedQuery(scope,[c.action],`INSERT INTO shipit.route_manifest_sources(organization_id,franchise_id,route_id,manifest_id,parcel_id,source_id,lot_id,lot_membership_id)
    SELECT {{organization}},$1,$2,$3,p.parcel_id,p.source_id,p.lot_id,p.lot_membership_id
    FROM jsonb_to_recordset($4::jsonb) AS p(parcel_id uuid,source_id uuid,lot_id uuid,lot_membership_id uuid)
    WHERE {{franchise:$5:$1}}`,[c.permittedFranchiseIds[0],route,id,JSON.stringify(rows.map(r=>({parcel_id:r.parcel_id,source_id:r.source_id,lot_id:r.lot_id,lot_membership_id:r.lot_membership_id}))),c.organizationId]);
}
export async function items(scope:TenantAccess,id:string,limit:number,b:RouteBoundary|null) {
  return (await scopedQuery<RouteManifestItem>(scope,['routes.read'],`SELECT p.parcel_id,
    (SELECT jsonb_agg(CASE WHEN s.lot_id IS NULL THEN jsonb_build_object('kind','direct','source_id',s.source_id)
      ELSE jsonb_build_object('kind','lot','source_id',s.source_id,'lot_id',s.lot_id,'lot_membership_id',s.lot_membership_id) END
      ORDER BY (s.lot_id IS NOT NULL),s.source_id) FROM shipit.route_manifest_sources s
      WHERE s.organization_id=p.organization_id AND s.franchise_id=p.franchise_id AND s.manifest_id=p.manifest_id AND s.parcel_id=p.parcel_id) AS sources
    FROM shipit.route_manifest_parcels p WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.manifest_id=$1
      AND ($2::uuid IS NULL OR p.parcel_id>$2) ORDER BY p.parcel_id LIMIT $3`,[id,b?.id??null,limit+1])).rows;
}
export async function list(scope:TenantAccess,f:RouteFilter,b:RouteBoundary|null) {
  return (await scopedQuery<RouteRow>(scope,['routes.list'],`SELECT ${columns} FROM shipit.routes r
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND ($1::text IS NULL OR r.state=$1)
      AND ($2::timestamptz IS NULL OR (r.created_at,r.id)<($2::timestamptz,$3::uuid)) ORDER BY r.created_at DESC,r.id DESC LIMIT $4`,
    [f.state,b?.value??null,b?.id??null,f.limit+1])).rows;
}
export async function complete(scope:TenantAccess,id:string,result:RouteDto,created:boolean) {
  const c=context(scope);
  await scopedQuery(scope,[c.action],`UPDATE shipit.route_commands SET state='committed',http_status=$2,result=$3,
    committed_at=date_trunc('milliseconds',clock_timestamp()),retain_until=date_trunc('milliseconds',clock_timestamp())+interval '24 hours'
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND state='reserved'`,[id,created?201:200,result]);
}
export async function appendEvent(scope:TenantAccess,route:RouteRow,command:string,event:string,type:string,time:string) {
  const c=assertTenantAccess(scope,['routes.events']);
  const envelope={event_id:event,event_type:type,schema_version:1,organization_id:c.organizationId,franchise_id:c.permittedFranchiseIds[0],
    aggregate_type:'route',aggregate_id:route.id,aggregate_version:route.version,occurred_at:time,actor:{type:'user',id:c.actor.id},
    correlation_id:c.correlationId,causation_id:command,command_id:command,payload:{manifest_id:route.current_manifest_id}};
  await scopedQuery(scope,['routes.events'],`INSERT INTO shipit.domain_events
    (event_id,organization_id,franchise_id,route_id,route_command_id,command_id,event_type,aggregate_id,envelope,occurred_at,aggregate_sequence)
    SELECT $1,{{organization}},$2,$3,$4,$4,$5,$3,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
    [event,c.permittedFranchiseIds[0],route.id,command,type,envelope,time,route.version,c.organizationId]);
}
/** Internal T03 authority; no independent Route-read grant or client-owned scope. */
export async function dispatchManifest(scope:TenantAccess,id:string,parcel:string) {
  const m=(await scopedQuery<{finalized:boolean;contains:boolean}>(scope,['parcels.dispatch'],`SELECT m.finalized,
    EXISTS(SELECT 1 FROM shipit.route_manifest_parcels p WHERE p.organization_id=m.organization_id AND p.franchise_id=m.franchise_id
      AND p.manifest_id=m.id AND p.parcel_id=$2) AS contains FROM shipit.route_manifests m
    WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.id=$1`,[id,parcel])).rows[0];
  if(!m)throw new HttpError('RESOURCE_NOT_FOUND');if(!m.finalized||!m.contains)throw new HttpError('PARCEL_STATE_CONFLICT');
}
