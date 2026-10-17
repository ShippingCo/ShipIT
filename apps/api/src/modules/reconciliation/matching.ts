import {randomUUID} from 'node:crypto';
import type {ReconciliationSource,ReconciliationAllocation,ReconciliationMatchInput,ReconciliationBatchInput} from '@shippingco/shared';
import {HttpError} from '../../plugins/errors.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
const actions=['reconciliation.read','reconciliation.configure','reconciliation.import','reconciliation.reconcile','reconciliation.unmatch'] as const;
import {digest} from '../pricing/idempotency.ts';
import * as r from './repository.ts';
import {transaction} from './imports.ts';
export interface Batch {id:string;batch_id:string;version:number;account_id:string;expected_date:string;reference:string;reason:string;receipts:ReconciliationAllocation[];fees:ReconciliationAllocation[]}
export async function source(scope:TenantAccess,id:string):Promise<ReconciliationSource> {
 const row=(await scopedQuery<ReconciliationSource>(scope,[...actions],`SELECT id,source_kind,source_id,version,account_id,direction,amount_paise::text,currency,method,external_reference,business_date::text,
 to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at FROM shipit.reconciliation_recorded_sources WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function sourceUsed(scope:TenantAccess,id:string) {
 return BigInt((await scopedQuery<{amount:string}>(scope,[...actions],`SELECT COALESCE(sum(a.amount_paise),0)::text amount FROM shipit.reconciliation_match_sources a WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.source_id=$1
 AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_unmatches u WHERE u.organization_id=a.organization_id AND u.franchise_id=a.franchise_id AND u.match_id=a.match_id)`,[id])).rows[0]!.amount);
}
export async function transactionUsed(scope:TenantAccess,id:string) {
 return BigInt((await scopedQuery<{amount:string}>(scope,[...actions],`SELECT COALESCE(sum(a.amount_paise),0)::text amount FROM shipit.reconciliation_match_transactions a WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.transaction_id=$1
 AND NOT EXISTS(SELECT 1 FROM shipit.reconciliation_unmatches u WHERE u.organization_id=a.organization_id AND u.franchise_id=a.franchise_id AND u.match_id=a.match_id)`,[id])).rows[0]!.amount);
}
export async function batch(scope:TenantAccess,id:string):Promise<Batch> {
 const row=(await scopedQuery<Batch>(scope,[...actions],`SELECT id,batch_id,version,account_id,expected_date::text,reference,reason,receipts,fees FROM shipit.reconciliation_batches WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
async function checked(scope:TenantAccess,account:string,lines:ReconciliationAllocation[],direction:'credit'|'debit',kind:'any'|'card'|'fee') {
 let total=0n;
 for(const line of lines) {
  const s=await source(scope,line.source_id);
  if(s.account_id!==account||s.direction!==direction||s.version!==line.source_version||s.currency!=='INR'||BigInt(line.amount_paise)>BigInt(s.amount_paise)||kind==='card'&&(s.source_kind!=='receipt'||s.method!=='card')||kind==='fee'&&s.source_kind!=='expense')throw new HttpError('RECONCILIATION_CONFLICT');
  total+=BigInt(line.amount_paise);
 }
 return total;
}
export async function saveBatch(scope:TenantAccess,command:string,id:string|null,input:ReconciliationBatchInput) {
 const c=assertTenantAccess(scope,['reconciliation.reconcile']);await r.account(scope,input.account_id);
 const version=id?(await scopedQuery<{version:number}>(scope,[...actions],`SELECT COALESCE(max(version),0)::int version FROM shipit.reconciliation_batches WHERE {{franchise:organization_id:franchise_id}} AND batch_id=$1`,[id])).rows[0]!.version:0;
 if(id&&version===0)throw new HttpError('RESOURCE_NOT_FOUND');
 if(version!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
 const gross=await checked(scope,input.account_id,input.receipts,'credit','card'),fees=await checked(scope,input.account_id,input.fees,'debit','fee');
 if(fees>=gross)throw new HttpError('RECONCILIATION_CONFLICT');
 const revision=randomUUID(),batchId=id??randomUUID();
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_batches(id,organization_id,franchise_id,batch_id,version,account_id,expected_date,reference,reason,receipts,fees,command_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}}`,[revision,c.permittedFranchiseIds[0],batchId,version+1,input.account_id,input.expected_date,input.reference,input.reason,JSON.stringify(input.receipts),JSON.stringify(input.fees),command,c.organizationId]);
 return {id:revision,batch_id:batchId,version:version+1,gross_paise:gross.toString(),fee_paise:fees.toString(),net_paise:(gross-fees).toString(),expected_date:input.expected_date};
}
export async function confirm(scope:TenantAccess,command:string,input:ReconciliationMatchInput) {
 const c=assertTenantAccess(scope,['reconciliation.reconcile']);await r.account(scope,input.account_id);
 const external=await Promise.all(input.transactions.map(line=>transaction(scope,line.transaction_id))),direction=external[0]!.direction as 'credit'|'debit';
 for(let i=0;i<external.length;i++) {
  const t=external[i]!,line=input.transactions[i]!;
  if(t.account_id!==input.account_id||t.currency!=='INR'||t.direction!==direction||BigInt(line.amount_paise)+await transactionUsed(scope,t.id)>BigInt(t.amount_paise))throw new HttpError('RECONCILIATION_CONFLICT');
 }
 const gross=await checked(scope,input.account_id,input.sources,direction,'any'),fees=await checked(scope,input.account_id,input.fees,'debit','fee'),net=input.transactions.reduce((sum,line)=>sum+BigInt(line.amount_paise),0n);
 if(gross!==net+fees||fees>0n&&(!input.batch_id||direction!=='credit'))throw new HttpError('RECONCILIATION_CONFLICT');
 for(const line of [...input.sources,...input.fees])if(await sourceUsed(scope,line.source_id)+BigInt(line.amount_paise)>BigInt((await source(scope,line.source_id)).amount_paise))throw new HttpError('RECONCILIATION_CONFLICT');
 if(input.batch_id) {
  const selected=await batch(scope,input.batch_id),latest=(await scopedQuery<{version:number}>(scope,[...actions],`SELECT max(version)::int version FROM shipit.reconciliation_batches WHERE {{franchise:organization_id:franchise_id}} AND batch_id=$1`,[selected.batch_id])).rows[0]!.version;
  if(selected.account_id!==input.account_id||selected.version!==latest||direction!=='credit'||digest(selected.receipts)!==digest(input.sources)||digest(selected.fees)!==digest(input.fees))throw new HttpError('RECONCILIATION_CONFLICT');
 }
 if(input.method==='exact') {
  if(input.transactions.length!==1||input.sources.length!==1||input.fees.length||input.batch_id)throw new HttpError('RECONCILIATION_CONFLICT');
  const s=await source(scope,input.sources[0]!.source_id),t=external[0]!;
  if(!s.external_reference||s.external_reference!==t.external_reference||BigInt(s.amount_paise)!==BigInt(t.amount_paise)||net!==BigInt(s.amount_paise))throw new HttpError('RECONCILIATION_CONFLICT');
  // The deferred SQL guard also proves uniqueness, ownership and both capacities at commit.
 }
 const id=randomUUID();await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_matches(id,organization_id,franchise_id,account_id,method,reason,batch_id,direction,command_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[id,c.permittedFranchiseIds[0],input.account_id,input.method,input.reason,input.batch_id,direction,command,c.organizationId]);
 for(const line of input.transactions)await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_match_transactions(organization_id,franchise_id,match_id,transaction_id,amount_paise)
 SELECT {{organization}},$1,$2,$3,$4 WHERE {{franchise:$5:$1}}`,[c.permittedFranchiseIds[0],id,line.transaction_id,line.amount_paise,c.organizationId]);
 for(const [isFee,lines] of [[false,input.sources],[true,input.fees]] as const)for(const line of lines)await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_match_sources(organization_id,franchise_id,match_id,source_id,source_version,amount_paise,is_fee)
 SELECT {{organization}},$1,$2,$3,$4,$5,$6 WHERE {{franchise:$7:$1}}`,[c.permittedFranchiseIds[0],id,line.source_id,line.source_version,line.amount_paise,isFee,c.organizationId]);
 return {id,method:input.method,gross_paise:gross.toString(),fees_paise:fees.toString(),net_paise:net.toString()};
}
export async function unmatch(scope:TenantAccess,command:string,id:string,reason:string) {
 const c=assertTenantAccess(scope,['reconciliation.unmatch']);
 if(!(await scopedQuery(scope,[...actions],`SELECT id FROM shipit.reconciliation_matches WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
 if((await scopedQuery(scope,[...actions],`SELECT id FROM shipit.reconciliation_unmatches WHERE {{franchise:organization_id:franchise_id}} AND match_id=$1`,[id])).rows.length)throw new HttpError('RECONCILIATION_CONFLICT');
 const revision=randomUUID();await scopedQuery(scope,[...actions],`INSERT INTO shipit.reconciliation_unmatches(id,organization_id,franchise_id,match_id,reason,command_id) SELECT $1,{{organization}},$2,$3,$4,$5 WHERE {{franchise:$6:$2}}`,[revision,c.permittedFranchiseIds[0],id,reason,command,c.organizationId]);return {id:revision,match_id:id,state:'revoked'};
}
