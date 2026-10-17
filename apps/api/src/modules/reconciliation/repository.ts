import {randomUUID} from 'node:crypto';
import type {ReconciliationConfig,ReconciliationMappingInput,StatementPreviewRow} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {scopedQuery,assertTenantAccess,type TenantAccess} from '../security/scope.ts';
const actions=['reconciliation.read','reconciliation.configure','reconciliation.import','reconciliation.reconcile','reconciliation.unmatch'] as const;
export type CommandAction='configure'|'mapping'|'preview'|'import'|'resolve_row'|'batch'|'match'|'unmatch'|'classify'|'review';
export interface MappingRow {id:string;profile_id:string;version:number;mapping:ReconciliationMappingInput;actor_id:string;recorded_at:Date}
export interface ImportRow {id:string;account_id:string;account_revision_id:string;mapping_id:string;period_from:string;period_to:string;file_sha256:string;rows:StatementPreviewRow[]}
export interface Outcome {row_number:number;version:number;state:'imported'|'duplicate'|'needs_review'|'conflict'|'rejected';transaction_id:string|null;reason:string}
export async function lock(scope:TenantAccess) {
 const row=(await scopedQuery<{lifecycle:string}>(scope,[...actions],`SELECT lifecycle FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');if(row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
export async function config(scope:TenantAccess,writes_available:boolean):Promise<ReconciliationConfig> {
 const row=(await scopedQuery<{version:number;enabled:boolean;recorded_at:Date}>(scope,[...actions],`SELECT v.version,v.enabled,c.recorded_at FROM shipit.reconciliation_config_versions v JOIN shipit.reconciliation_commands c ON c.organization_id=v.organization_id AND c.franchise_id=v.franchise_id AND c.id=v.command_id WHERE {{franchise:v.organization_id:v.franchise_id}} ORDER BY v.version DESC LIMIT 1`)).rows[0];
 return {version:row?.version??0,enabled:row?.enabled??false,writes_available,recorded_at:row?.recorded_at.toISOString()??null};
}
export async function replay(scope:TenantAccess,action:CommandAction,key:string,fingerprint:string):Promise<Record<string,unknown>|null> {
 const c=assertTenantAccess(scope,actions),row=(await scopedQuery<{fingerprint:string;result:Record<string,unknown>}>(scope,[...actions],`SELECT fingerprint,result FROM shipit.reconciliation_commands WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND action=$2 AND key_digest=$3`,[c.actor.id,action,key])).rows[0];
 if(!row)return null;if(row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return row.result;
}
export async function record(scope:TenantAccess,id:string,action:CommandAction,key:string,fingerprint:string,resource:string,result:Record<string,unknown>) {
 const c=assertTenantAccess(scope,actions);
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_commands(id,organization_id,franchise_id,actor_id,action,key_digest,fingerprint,resource_id,result,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,[id,c.permittedFranchiseIds[0],c.actor.id,action,key,fingerprint,resource,result,c.correlationId,c.organizationId]);
}
export async function appendConfig(scope:TenantAccess,command:string,version:number,enabled:boolean,reason:string) {
 const c=assertTenantAccess(scope,['reconciliation.configure']),id=randomUUID();
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_config_versions(id,organization_id,franchise_id,version,enabled,reason,command_id) SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}}`,[id,c.permittedFranchiseIds[0],version,enabled,reason,command,c.organizationId]);return id;
}
export async function mapping(scope:TenantAccess,id:string):Promise<MappingRow> {
 const row=(await scopedQuery<MappingRow>(scope,[...actions],`SELECT v.*,c.actor_id,c.recorded_at FROM shipit.reconciliation_mapping_versions v JOIN shipit.reconciliation_commands c ON c.organization_id=v.organization_id AND c.franchise_id=v.franchise_id AND c.id=v.command_id WHERE {{franchise:v.organization_id:v.franchise_id}} AND v.id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function mappingVersion(scope:TenantAccess,id:string) {
 return (await scopedQuery<{version:number}>(scope,[...actions],`SELECT COALESCE(max(version),0)::int version FROM shipit.reconciliation_mapping_versions WHERE {{franchise:organization_id:franchise_id}} AND profile_id=$1`,[id])).rows[0]!.version;
}
export async function appendMapping(scope:TenantAccess,command:string,profile:string,input:ReconciliationMappingInput) {
 const c=assertTenantAccess(scope,['reconciliation.configure']),id=randomUUID();
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_mapping_versions(id,organization_id,franchise_id,profile_id,version,mapping,command_id) SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}}`,[id,c.permittedFranchiseIds[0],profile,input.expected_version+1,input,command,c.organizationId]);return id;
}
export async function mappings(scope:TenantAccess,cursor:string|null,limit:number) {
 return (await scopedQuery<MappingRow>(scope,[...actions],`SELECT v.*,c.actor_id,c.recorded_at FROM shipit.reconciliation_mapping_versions v JOIN shipit.reconciliation_commands c ON c.organization_id=v.organization_id AND c.franchise_id=v.franchise_id AND c.id=v.command_id
 WHERE {{franchise:v.organization_id:v.franchise_id}} AND ($1::uuid IS NULL OR v.id>$1) ORDER BY v.id LIMIT $2`,[cursor,limit])).rows;
}
export async function account(scope:TenantAccess,id:string,readHistory=false) {
 const row=(await scopedQuery<{id:string;methods:string[]}>(scope,[...actions],`SELECT id,methods FROM shipit.receiving_account_revisions WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 ORDER BY version DESC LIMIT 1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');if(!readHistory&&row.methods.includes('cash'))throw new HttpError('RECONCILIATION_CONFLICT');return row;
}
export async function appendImport(scope:TenantAccess,command:string,accountId:string,revision:string,mappingId:string,from:string,to:string,hash:string,rows:StatementPreviewRow[]) {
 const c=assertTenantAccess(scope,['reconciliation.import']),id=randomUUID();
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_imports(id,organization_id,franchise_id,account_id,account_revision_id,mapping_id,period_from,period_to,file_sha256,rows,command_id) SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}`,[id,c.permittedFranchiseIds[0],accountId,revision,mappingId,from,to,hash,JSON.stringify(rows),command,c.organizationId]);return id;
}
export async function importRun(scope:TenantAccess,id:string):Promise<ImportRow> {
 const row=(await scopedQuery<ImportRow>(scope,[...actions],`SELECT id,account_id,account_revision_id,mapping_id,period_from::text,period_to::text,file_sha256,rows FROM shipit.reconciliation_imports WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function outcomes(scope:TenantAccess,id:string) {
 return (await scopedQuery<Outcome>(scope,[...actions],`SELECT DISTINCT ON(row_number) row_number,version,state,transaction_id,reason FROM shipit.reconciliation_row_outcomes WHERE {{franchise:organization_id:franchise_id}} AND import_id=$1 ORDER BY row_number,version DESC`,[id])).rows;
}
export async function outcome(scope:TenantAccess,command:string,run:string,row:number,version:number,state:Outcome['state'],transaction:string|null,reason:string) {
 const c=assertTenantAccess(scope,['reconciliation.import']);
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_row_outcomes(organization_id,franchise_id,import_id,row_number,version,state,transaction_id,reason,command_id) SELECT {{organization}},$1,$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$1}}`,[c.permittedFranchiseIds[0],run,row,version,state,transaction,reason,command,c.organizationId]);
}
export async function auditRead(scope:TenantAccess,resource:string,action:'reconciliation.read'|'reconciliation.preview_columns'='reconciliation.read') {
 const c=assertTenantAccess(scope,['reconciliation.audit']);
 await scopedQuery(scope,['reconciliation.audit'],`INSERT INTO shipit.reconciliation_access_events(id,organization_id,franchise_id,actor_id,resource_id,action,correlation_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],c.actor.id,resource,action,c.correlationId,c.organizationId]);
}
