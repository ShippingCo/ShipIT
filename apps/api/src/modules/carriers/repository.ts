import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { Dimensions, Mapping, Observation } from './contract.ts';
const read = ['carriers.read','carriers.write'] as const;
const write = ['carriers.write'] as const;
export interface InstallationRow { id:string; organization_id:string; franchise_id:string; courier_id:string; label:string; revision:number; command_id:string; created_at:Date }
export interface MappingRow { id:string; installation_id:string; kind:'service'|'location'; source_code:string; normalized_id:string; version:number }
export interface ReferenceRow { id:string; installation_id:string; parcel_id:string; external_docket:string; version:number; dimensions:Dimensions }
export interface ObservationRow { id:string; reference_id:string; parcel_version:number; evidence:Observation; review_state:'pending_review' }
export interface CommandResult { id:string; version:number }
export async function installation(s:TenantAccess,id:string) {
  const row=(await scopedQuery<InstallationRow>(s,['carriers.read','carriers.write'],`SELECT * FROM shipit.carrier_installations
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function parcel(s:TenantAccess,id:string,agentOnly=false) {
  const c=assertTenantAccess(s,read);
  const row=(await scopedQuery<{id:string;version:number;status:string;state:string}>(s,['carriers.read','carriers.write'],`SELECT p.id,p.version,p.status,b.state FROM shipit.parcels p
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 AND (NOT $2::boolean OR p.assigned_agent_id=$3::uuid)
    FOR SHARE OF p`,[id,agentOnly,c.actor.id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
  if(c.action==='carriers.write'&&row.state!=='active')throw new HttpError('PARCEL_STATE_CONFLICT');
  return row;
}
export async function replay(s:TenantAccess,operation:string,key:string,fingerprint:string) {
  const c=assertTenantAccess(s,write);
  const row=(await scopedQuery<{fingerprint:string;result:CommandResult}>(s,['carriers.write'],`SELECT fingerprint,result FROM shipit.carrier_commands
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
  if(!row)return null;if(row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return row.result;
}
export async function receipt(s:TenantAccess,id:string,operation:string,key:string,fingerprint:string,result:CommandResult,reason:string,now:Date) {
  const c=assertTenantAccess(s,write);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_commands
    (id,organization_id,franchise_id,actor_id,operation,key_digest,fingerprint,resource_id,version,reason_code,result,correlation_id,occurred_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,
  [id,c.permittedFranchiseIds[0],c.actor.id,operation,key,fingerprint,result.id,result.version,reason,result,c.correlationId,now,c.organizationId]);
}
export async function addInstallation(s:TenantAccess,id:string,courier:string,label:string,command:string,now:Date) {
  const c=assertTenantAccess(s,write);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_installations(id,organization_id,franchise_id,courier_id,label,command_id,created_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}}`,[id,c.permittedFranchiseIds[0],courier,label,command,now,c.organizationId]);
}
export async function courier(s:TenantAccess,id:string) {
  if(!(await scopedQuery(s,['carriers.read','carriers.write'],`SELECT id FROM shipit.carrier_installations
    WHERE {{franchise:organization_id:franchise_id}} AND courier_id=$1 LIMIT 1`,[id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function latestMapping(s:TenantAccess,installationId:string,kind:string,source:string) {
  return (await scopedQuery<MappingRow>(s,['carriers.read','carriers.write'],`SELECT id,installation_id,kind,source_code,normalized_id,version FROM shipit.carrier_mappings
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND kind=$2 AND source_code=$3 ORDER BY version DESC LIMIT 1`,[installationId,kind,source])).rows[0];
}
export async function normalizedTarget(s:TenantAccess,installationId:string,kind:string,id:string) {
  if(!(await scopedQuery(s,['carriers.read','carriers.write'],`SELECT id FROM shipit.carrier_mappings WHERE {{franchise:organization_id:franchise_id}}
    AND installation_id=$1 AND kind=$2 AND normalized_id=$3 LIMIT 1`,[installationId,kind,id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
}
export async function addMapping(s:TenantAccess,id:string,installationId:string,kind:string,source:string,target:string,version:number,command:string) {
  const c=assertTenantAccess(s,write);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_mappings(id,organization_id,franchise_id,installation_id,kind,source_code,normalized_id,version,command_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[id,c.permittedFranchiseIds[0],installationId,kind,source,target,version,command,c.organizationId]);
}
export async function dimension(s:TenantAccess,installationId:string,kind:string,source:string):Promise<Mapping> {
  const row=await latestMapping(s,installationId,kind,source);
  return row?{state:'mapped',id:row.normalized_id,mappingVersionId:row.id}:{state:'unmapped',sourceCode:source};
}
export async function currentReference(s:TenantAccess,installationId:string,parcelId:string) {
  return (await scopedQuery<ReferenceRow>(s,['carriers.read','carriers.write'],`SELECT id,installation_id,parcel_id,external_docket,version,dimensions FROM shipit.carrier_references
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND parcel_id=$2 ORDER BY version DESC LIMIT 1`,[installationId,parcelId])).rows[0];
}
export async function reference(s:TenantAccess,id:string,parcelId:string) {
  const row=(await scopedQuery<ReferenceRow>(s,['carriers.read','carriers.write'],`SELECT id,installation_id,parcel_id,external_docket,version,dimensions FROM shipit.carrier_references
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND parcel_id=$2`,[id,parcelId])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function addReference(s:TenantAccess,id:string,installationId:string,parcelId:string,docket:string,version:number,dimensions:Dimensions,command:string) {
  const c=assertTenantAccess(s,write),franchise=c.permittedFranchiseIds[0];
  const old=(await scopedQuery<{parcel_id:string}>(s,['carriers.read','carriers.write'],`SELECT parcel_id FROM shipit.carrier_dockets
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND external_docket=$2`,[installationId,docket])).rows[0];
  if(old&&old.parcel_id!==parcelId)throw new HttpError('VERSION_CONFLICT');
  if(!old)await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_dockets(organization_id,franchise_id,installation_id,external_docket,parcel_id)
    SELECT {{organization}},$1,$2,$3,$4 WHERE {{franchise:$5:$1}}`,[franchise,installationId,docket,parcelId,c.organizationId]);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_references(id,organization_id,franchise_id,installation_id,parcel_id,external_docket,version,dimensions,command_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[id,franchise,installationId,parcelId,docket,version,dimensions,command,c.organizationId]);
}
/** Shared ingestion persistence boundary: immutable observation only, no Parcel/Payments executor. */
export async function ingest(s:TenantAccess,id:string,parcelId:string,referenceId:string,parcelVersion:number,evidence:Observation,command:string,now:Date,statusCode:string) {
  const c=assertTenantAccess(s,write);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_observations(id,organization_id,franchise_id,parcel_id,reference_id,parcel_version,evidence,command_id,received_at,status_code)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$10 WHERE {{franchise:$9:$2}}`,[id,c.permittedFranchiseIds[0],parcelId,referenceId,parcelVersion,evidence,command,now,c.organizationId,statusCode]);
}
export async function list(s:TenantAccess,kind:'installations'|'mappings'|'references'|'observations',parent:string|null,after:string|null,limit:number) {
  if(kind==='installations')return (await scopedQuery<{id:string}>(s,['carriers.read'],`SELECT id,courier_id,label,revision,command_id,created_at FROM shipit.carrier_installations
    WHERE {{franchise:organization_id:franchise_id}} AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2`,[after,limit+1])).rows;
  if(kind==='mappings')return (await scopedQuery<{id:string}>(s,['carriers.read'],`SELECT id,installation_id,kind,source_code,normalized_id,version FROM shipit.carrier_mappings
    WHERE {{franchise:organization_id:franchise_id}} AND ($1::uuid IS NULL OR id>$1) AND installation_id=$3 ORDER BY id LIMIT $2`,[after,limit+1,parent])).rows;
  if(kind==='references')return (await scopedQuery<{id:string}>(s,['carriers.read'],`SELECT id,installation_id,parcel_id,external_docket,version,dimensions FROM shipit.carrier_references
    WHERE {{franchise:organization_id:franchise_id}} AND ($1::uuid IS NULL OR id>$1) AND parcel_id=$3 ORDER BY id LIMIT $2`,[after,limit+1,parent])).rows;
  return (await scopedQuery<{id:string}>(s,['carriers.read'],`SELECT id,reference_id,parcel_version,status_code,evidence,review_state FROM shipit.carrier_observations
    WHERE {{franchise:organization_id:franchise_id}} AND ($1::uuid IS NULL OR id>$1) AND parcel_id=$3 ORDER BY id LIMIT $2`,[after,limit+1,parent])).rows;
}
