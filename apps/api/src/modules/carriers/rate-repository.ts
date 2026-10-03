import { randomUUID } from 'node:crypto';
import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { RateConfig, RateRow } from './rate-validation.ts';
import type { MappingRow } from './repository.ts';
export interface RateImport {id:string;installation_id:string;courier_id:string;file_sha256:string;normalization_version:string;
  config:RateConfig;rows:RateRow[];issues:string[];created_at:Date}
export interface RateApproval {id:string;pricing_version_id:string|null;approved_at:Date}
export async function get(s:TenantAccess,id:string) {
  const row=(await scopedQuery<RateImport>(s,['carriers.write'],`SELECT r.id,r.installation_id,i.courier_id,r.file_sha256,r.normalization_version,r.config,r.rows,r.issues,r.created_at
    FROM shipit.carrier_rate_imports r JOIN shipit.carrier_installations i ON i.organization_id=r.organization_id AND i.franchise_id=r.franchise_id AND i.id=r.installation_id
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1`,[id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function mapping(s:TenantAccess,installation:string,id:string) {
  const row=(await scopedQuery<MappingRow>(s,['carriers.write'],`SELECT id,installation_id,kind,source_code,normalized_id,version FROM shipit.carrier_mappings
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND id=$2`,[installation,id])).rows[0];
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function duplicate(s:TenantAccess,installation:string,file:string,normalization:string) {
  return (await scopedQuery<{id:string}>(s,['carriers.write'],`SELECT id FROM shipit.carrier_rate_imports
    WHERE {{franchise:organization_id:franchise_id}} AND installation_id=$1 AND file_sha256=$2 AND normalization_version=$3`,[installation,file,normalization])).rows[0];
}
export async function insert(s:TenantAccess,id:string,installation:string,file:string,normalization:string,config:RateConfig,rows:RateRow[],issues:string[],now:Date) {
  const c=assertTenantAccess(s,['carriers.write']);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_rate_imports
    (id,organization_id,franchise_id,installation_id,file_sha256,normalization_version,purpose,config,rows,issues,actor_id,correlation_id,created_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,
  [id,c.permittedFranchiseIds[0],installation,file,normalization,config.purpose,JSON.stringify(config),JSON.stringify(rows),JSON.stringify(issues),c.actor.id,c.correlationId,now,c.organizationId]);
}
export async function approval(s:TenantAccess,id:string) {
  return (await scopedQuery<RateApproval>(s,['carriers.write'],`SELECT id,pricing_version_id,approved_at FROM shipit.carrier_rate_approvals
    WHERE {{franchise:organization_id:franchise_id}} AND import_id=$1`,[id])).rows[0]??null;
}
export async function approve(s:TenantAccess,run:RateImport,pricing:string|null,now:Date) {
  const c=assertTenantAccess(s,['carriers.write']);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_rate_approvals(id,organization_id,franchise_id,import_id,pricing_version_id,actor_id,correlation_id,approved_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],run.id,pricing,c.actor.id,c.correlationId,now,c.organizationId]);
}
export async function prior(s:TenantAccess,operation:string,key:string,fingerprint:string) {
  const c=assertTenantAccess(s,['carriers.write']);
  const row=(await scopedQuery<{import_id:string;fingerprint:string}>(s,['carriers.write'],`SELECT import_id,fingerprint FROM shipit.carrier_rate_commands
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
  if(row&&row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return row;
}
export async function receipt(s:TenantAccess,id:string,operation:string,key:string,fingerprint:string,now:Date) {
  const c=assertTenantAccess(s,['carriers.write']);
  await scopedQuery(s,['carriers.write'],`INSERT INTO shipit.carrier_rate_commands(organization_id,franchise_id,import_id,actor_id,operation,key_digest,fingerprint,created_at)
    SELECT {{organization}},$1,$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$1}}`,[c.permittedFranchiseIds[0],id,c.actor.id,operation,key,fingerprint,now,c.organizationId]);
}
export async function purchaseConflict(s:TenantAccess,run:Pick<RateImport,'installation_id'|'config'>) {
  return (await scopedQuery(s,['carriers.write'],`SELECT r.id FROM shipit.carrier_rate_imports r
    JOIN shipit.carrier_rate_approvals a ON a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.import_id=r.id
    WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.installation_id=$1 AND r.purpose='courier_purchase_estimate'
      AND (r.config->'policy'->>'effective_from')::timestamptz<$3 AND $2<(r.config->'policy'->>'effective_to')::timestamptz LIMIT 1`,
  [run.installation_id,run.config.policy.effective_from,run.config.policy.effective_to])).rows.length>0;
}
