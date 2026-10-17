import {randomUUID} from 'node:crypto';
import type {StatementCandidate} from '@shippingco/shared';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
const actions=['reconciliation.read','reconciliation.configure','reconciliation.import','reconciliation.reconcile','reconciliation.unmatch'] as const;
import * as r from './repository.ts';
interface Transaction {id:string;account_id:string;business_date:string;direction:string;amount_paise:string;currency:string;external_reference:string|null;external_id:string|null;identity_namespace:string;alias_matches?:boolean}
function same(t:Transaction,account:string,c:StatementCandidate,namespace:string) {
 return t.account_id===account&&t.business_date===c.business_date&&t.direction===c.direction&&BigInt(t.amount_paise)===BigInt(c.amount_paise)&&t.currency===c.currency&&t.external_reference===c.external_reference&&t.external_id===c.external_id&&t.identity_namespace===namespace;
}
export async function transaction(scope:TenantAccess,id:string):Promise<Transaction> {
 const row=(await scopedQuery<Transaction>(scope,[...actions],`SELECT id,account_id,business_date::text,direction,amount_paise::text,currency,external_reference,external_id,identity_namespace FROM shipit.reconciliation_transactions WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
async function candidates(scope:TenantAccess,run:r.ImportRow,row:number,c:StatementCandidate,namespace:string) {
 return (await scopedQuery<Transaction>(scope,[...actions],`SELECT DISTINCT t.id,t.account_id,t.business_date::text,t.direction,t.amount_paise::text,t.currency,t.external_reference,t.external_id,t.identity_namespace,
 EXISTS(SELECT 1 FROM shipit.reconciliation_row_outcomes o JOIN shipit.reconciliation_imports prior ON prior.organization_id=o.organization_id AND prior.franchise_id=o.franchise_id AND prior.id=o.import_id
 WHERE o.organization_id=t.organization_id AND o.franchise_id=t.franchise_id AND o.transaction_id=t.id AND prior.file_sha256=$3 AND o.row_number=$4 AND prior.account_id=$5 AND prior.rows->($4::int-2)->'candidate'=$6::jsonb AND $2::text IS NULL) alias_matches
 FROM shipit.reconciliation_transactions t JOIN shipit.reconciliation_imports i ON i.organization_id=t.organization_id AND i.franchise_id=t.franchise_id AND i.id=t.origin_import_id
 WHERE {{franchise:t.organization_id:t.franchise_id}} AND ((t.identity_namespace=$1 AND t.external_id=$2) OR (t.external_reference=$7 AND (t.account_id<>$5 OR t.amount_paise<>$8 OR t.direction<>$9)) OR (i.file_sha256=$3 AND t.origin_row=$4)
 OR EXISTS(SELECT 1 FROM shipit.reconciliation_row_outcomes o JOIN shipit.reconciliation_imports prior ON prior.organization_id=o.organization_id AND prior.franchise_id=o.franchise_id AND prior.id=o.import_id WHERE o.organization_id=t.organization_id AND o.franchise_id=t.franchise_id AND o.transaction_id=t.id AND prior.file_sha256=$3 AND o.row_number=$4)) LIMIT 2`,[namespace,c.external_id,run.file_sha256,row,run.account_id,c,c.external_reference,c.amount_paise,c.direction])).rows;
}
async function insert(scope:TenantAccess,command:string,run:r.ImportRow,row:number,c:StatementCandidate,namespace:string) {
 const access=assertTenantAccess(scope,['reconciliation.import']),id=randomUUID();
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_transactions(id,organization_id,franchise_id,account_id,currency,business_date,direction,amount_paise,external_reference,external_id,identity_namespace,origin_import_id,origin_row,command_id)
 SELECT $1,{{organization}},$2,$3,'INR',$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,[id,access.permittedFranchiseIds[0],run.account_id,c.business_date,c.direction,c.amount_paise,c.external_reference,c.external_id,namespace,run.id,row,command,access.organizationId]);return id;
}
export async function commit(scope:TenantAccess,command:string,id:string,selected:number[]) {
 const run=await r.importRun(scope,id),mapping=await r.mapping(scope,run.mapping_id),prior=await r.outcomes(scope,id);
 for(const number of selected) {
  const row=run.rows.find(row=>row.row===number);if(!row)throw new FieldValidationError('$','OUT_OF_RANGE');
  if(prior.some(o=>o.row_number===number))continue;
  if(row.error||!row.candidate){await r.outcome(scope,command,id,number,1,'rejected',null,row.error??'INVALID_ROW');continue;}
  const previous=await candidates(scope,run,number,row.candidate,mapping.mapping.identity_namespace);
  if(previous.length) {
   const matches=previous.length===1&&(same(previous[0]!,run.account_id,row.candidate,mapping.mapping.identity_namespace)||previous[0]!.alias_matches===true);
   await r.outcome(scope,command,id,number,1,matches?'duplicate':'conflict',matches?previous[0]!.id:null,matches?'Existing proven identity or exact file row':'Identity or file row has different account, amount or evidence');
  } else if(!row.candidate.external_id)await r.outcome(scope,command,id,number,1,'needs_review',null,'No proven transaction ID; review duplicates before explicitly accepting a distinct transaction');
  else {
   const transactionId=await insert(scope,command,run,number,row.candidate,mapping.mapping.identity_namespace);
   await r.outcome(scope,command,id,number,1,'imported',transactionId,'Imported proven transaction identity');
  }
 }
 return {id,outcomes:await r.outcomes(scope,id)};
}
export async function resolve(scope:TenantAccess,command:string,id:string,rowNumber:number,expected:number,decision:'distinct'|'duplicate'|'reject',target:string|null,reason:string) {
 const run=await r.importRun(scope,id),row=run.rows.find(row=>row.row===rowNumber),before=(await r.outcomes(scope,id)).find(o=>o.row_number===rowNumber);
 if(!row||!before)throw new HttpError('RESOURCE_NOT_FOUND');
 if(before.version!==expected||!['needs_review','conflict'].includes(before.state))throw new HttpError('VERSION_CONFLICT');
 if(decision==='reject')await r.outcome(scope,command,id,rowNumber,expected+1,'rejected',null,reason);
 else {
  if(before.state!=='needs_review'||!row.candidate||row.candidate.external_id)throw new HttpError('RECONCILIATION_CONFLICT');
  const mapping=await r.mapping(scope,run.mapping_id);
  if(decision==='duplicate') {
   if(!target)throw new FieldValidationError('$','INVALID_FORMAT');const selected=await transaction(scope,target),c=row.candidate;
   if(selected.account_id!==run.account_id||selected.currency!==c.currency||selected.direction!==c.direction||BigInt(selected.amount_paise)!==BigInt(c.amount_paise))throw new HttpError('RECONCILIATION_CONFLICT');
   await r.outcome(scope,command,id,rowNumber,expected+1,'duplicate',selected.id,reason);
  } else {
   if(target)throw new FieldValidationError('$','INVALID_FORMAT');
   if((await candidates(scope,run,rowNumber,row.candidate,mapping.mapping.identity_namespace)).length)throw new HttpError('RECONCILIATION_CONFLICT');
   const selected=await insert(scope,command,run,rowNumber,row.candidate,mapping.mapping.identity_namespace);
   await r.outcome(scope,command,id,rowNumber,expected+1,'imported',selected,reason);
  }
 }
 return {id,outcomes:await r.outcomes(scope,id)};
}
