import {randomUUID} from 'node:crypto';
import type {ReconciliationClassification} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
const actions=['reconciliation.read','reconciliation.configure','reconciliation.import','reconciliation.reconcile','reconciliation.unmatch'] as const;
import {transaction} from './imports.ts';
import {source} from './matching.ts';
import {importRun} from './repository.ts';
export async function classify(scope:TenantAccess,command:string,id:string,version:number,classification:ReconciliationClassification,reason:string) {
 const c=assertTenantAccess(scope,['reconciliation.reconcile']);await transaction(scope,id);
 const previous=(await scopedQuery<{version:number}>(scope,[...actions],`SELECT COALESCE(max(version),0)::int version FROM shipit.reconciliation_classifications WHERE {{franchise:organization_id:franchise_id}} AND transaction_id=$1`,[id])).rows[0]!.version;
 if(previous!==version)throw new HttpError('VERSION_CONFLICT');const revision=randomUUID();
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_classifications(id,organization_id,franchise_id,transaction_id,version,classification,reason,command_id) SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}`,[revision,c.permittedFranchiseIds[0],id,version+1,classification,reason,command,c.organizationId]);
 return {id:revision,transaction_id:id,version:version+1,classification};
}
export interface ReviewInput {expected_version:number;source_id:string|null;transaction_id:string|null;import_id:string|null;row_number:number|null;state:'open'|'resolved';kind:'missing_payment'|'unexplained_credit'|'wrong_amount'|'identity_conflict'|'changed_source'|'other';reason:string}
export async function review(scope:TenantAccess,command:string,id:string|null,input:ReviewInput) {
 const c=assertTenantAccess(scope,['reconciliation.reconcile']);
 if(input.source_id)await source(scope,input.source_id);if(input.transaction_id)await transaction(scope,input.transaction_id);
 if(input.import_id){const run=await importRun(scope,input.import_id);if(!run.rows.some(r=>r.row===input.row_number))throw new HttpError('RESOURCE_NOT_FOUND');}
 if(id) {
  const before=(await scopedQuery<ReviewInput&{version:number}>(scope,[...actions],`SELECT version,source_id,transaction_id,import_id,row_number,state,kind FROM shipit.reconciliation_review_revisions WHERE {{franchise:organization_id:franchise_id}} AND case_id=$1 ORDER BY version DESC LIMIT 1`,[id])).rows[0];
  if(!before)throw new HttpError('RESOURCE_NOT_FOUND');
  if(before.version!==input.expected_version||before.source_id!==input.source_id||before.transaction_id!==input.transaction_id||before.import_id!==input.import_id||before.row_number!==input.row_number||before.kind!==input.kind)throw new HttpError('VERSION_CONFLICT');
 } else if(input.expected_version!==0||input.state!=='open')throw new HttpError('RECONCILIATION_CONFLICT');
 const revision=randomUUID(),caseId=id??randomUUID();
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_review_revisions(id,organization_id,franchise_id,case_id,version,source_id,transaction_id,import_id,row_number,state,kind,reason,command_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,[revision,c.permittedFranchiseIds[0],caseId,input.expected_version+1,input.source_id,input.transaction_id,input.import_id,input.row_number,input.state,input.kind,input.reason,command,c.organizationId]);
 return {id:revision,case_id:caseId,version:input.expected_version+1,state:input.state};
}
