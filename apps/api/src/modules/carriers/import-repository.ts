import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { ImportKind, PreviewRow, RowError } from './csv.ts';
export interface ImportRun { id:string; installation_id:string; kind:ImportKind; file_sha256:string; fingerprint:string;
  rows:PreviewRow[]; created_at:Date; actor_id:string }
export interface Outcome { row_number:number; state:'applied'|'duplicate'|'conflicted'; error:RowError|null;
  resource_id:string|null; identity:string; fingerprint:string }
export async function run(s:TenantAccess,id:string) {
  const result=(await scopedQuery<ImportRun>(s,['carriers.read','carriers.write'],`SELECT id,installation_id,kind,file_sha256,fingerprint,rows,created_at,actor_id
    FROM shipit.carrier_import_runs WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
  if(!result)throw new HttpError('RESOURCE_NOT_FOUND');return result;
}
export async function priorRun(s:TenantAccess,key:string,fingerprint:string) {
  const c=assertTenantAccess(s,['carriers.write']);
  const row=(await scopedQuery<{id:string;fingerprint:string}>(s,['carriers.write'],`SELECT id,fingerprint FROM shipit.carrier_import_runs
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
  if(row&&row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return row;
}
export async function insertRun(s:TenantAccess,id:string,installation:string,kind:ImportKind,file:string,key:string,fingerprint:string,rows:PreviewRow[],now:Date) {
  const c=assertTenantAccess(s,['carriers.write']);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_import_runs
    (id,organization_id,franchise_id,installation_id,kind,file_sha256,key_digest,fingerprint,rows,actor_id,correlation_id,created_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}}`,
  [id,c.permittedFranchiseIds[0],installation,kind,file,key,fingerprint,JSON.stringify(rows),c.actor.id,c.correlationId,now,c.organizationId]);
}
export async function outcomes(s:TenantAccess,id:string) {
  return (await scopedQuery<Outcome>(s,['carriers.read','carriers.write'],`SELECT row_number,state,error,resource_id,identity,fingerprint FROM shipit.carrier_import_outcomes
    WHERE {{franchise:organization_id:franchise_id}} AND run_id=$1 ORDER BY row_number`,[id])).rows;
}
export async function sourceOutcome(s:TenantAccess,installation:string,kind:ImportKind,identity:string) {
  return (await scopedQuery<Outcome>(s,['carriers.read','carriers.write'],`SELECT row_number,state,error,resource_id,identity,fingerprint FROM shipit.carrier_import_outcomes
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND kind=$2 AND identity=$3 AND state='applied'`,[installation,kind,identity])).rows[0];
}
export async function saveOutcome(s:TenantAccess,run:ImportRun,row:PreviewRow,state:Outcome['state'],error:RowError|null,resource:string|null,command:string|null,now:Date) {
  const c=assertTenantAccess(s,['carriers.write']);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_import_outcomes
    (organization_id,franchise_id,run_id,installation_id,kind,row_number,identity,fingerprint,state,error,resource_id,command_id,actor_id,correlation_id,created_at)
    SELECT {{organization}},$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14 WHERE {{franchise:$15:$1}}`,
  [c.permittedFranchiseIds[0],run.id,run.installation_id,run.kind,row.row,row.identity!,row.fingerprint!,state,error,resource,command,c.actor.id,c.correlationId,now,c.organizationId]);
}
export async function commitIntent(s:TenantAccess,id:string,runId:string,key:string,fingerprint:string,now:Date) {
  const c=assertTenantAccess(s,['carriers.write']);
  const old=(await scopedQuery<{fingerprint:string}>(s,['carriers.write'],`SELECT fingerprint FROM shipit.carrier_import_commits
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
  if(old){if(old.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return;}
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_import_commits(id,organization_id,franchise_id,run_id,actor_id,key_digest,fingerprint,correlation_id,created_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
  [id,c.permittedFranchiseIds[0],runId,c.actor.id,key,fingerprint,c.correlationId,now,c.organizationId]);
}
export async function docket(s:TenantAccess,docket:string) {
  const row=(await scopedQuery<{id:string;version:number;status:string;state:string;created_at:Date}>(s,['carriers.write'],`SELECT p.id,p.version,p.status,b.state,b.confirmed_at AS created_at FROM shipit.parcels p
    JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
    WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.docket=$1 FOR SHARE OF p`,[docket])).rows[0];
  return row;
}
export async function reserved(s:TenantAccess,installation:string,docket:string) {
  return (await scopedQuery<{parcel_id:string}>(s,['carriers.write'],`SELECT parcel_id FROM shipit.carrier_dockets
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND external_docket=$2`,[installation,docket])).rows[0];
}
export async function latestTime(s:TenantAccess,parcel:string,reference:string) {
  return (await scopedQuery<{at:string|null}>(s,['carriers.write'],`SELECT max((evidence->'occurredAt'->>'at')::timestamptz)::text AS at FROM shipit.carrier_observations
    WHERE {{franchise:organization_id:franchise_id}} AND parcel_id=$1 AND reference_id=$2 AND evidence->'occurredAt'->>'state'='known'`,[parcel,reference])).rows[0]?.at??null;
}
