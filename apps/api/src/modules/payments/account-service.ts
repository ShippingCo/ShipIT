import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import type {ReceivingAccountDto,ReceivingAccountInput,ReceiptMethod} from '@shippingco/shared';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {withReceivingAccountScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {instant} from '../pricing/types.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {selection,idempotencyKey,uuid} from '../pricing/validation.ts';
import {receivingAccount,receiptPage} from './receipt-validation.ts';
interface AccountRow {
 id:string;account_id:string;version:number;name:string;methods:ReceiptMethod[];other_method_name:string|null;
 active:boolean;recorded_at:Date;fingerprint:string;
}
function dto(row:AccountRow):ReceivingAccountDto {
 return {id:row.account_id,revision_id:row.id,version:row.version,name:row.name,methods:row.methods,
  other_method_name:row.other_method_name,active:row.active,recorded_at:instant(row.recorded_at)};
}
async function current(scope:TenantAccess,id:string) {
 const row=(await scopedQuery<AccountRow>(scope,['receiving_accounts.read','receiving_accounts.configure'],`SELECT * FROM shipit.receiving_account_revisions
 WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 ORDER BY version DESC LIMIT 1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
async function active(scope:TenantAccess) {
 const row=(await scopedQuery<{lifecycle:string}>(scope,['receiving_accounts.configure'],`SELECT lifecycle FROM shipit.franchises
 WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');if(row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
async function append(scope:TenantAccess,id:string,key:string,intent:string,input:ReceivingAccountInput) {
 const c=assertTenantAccess(scope,['receiving_accounts.configure']);
 const row=(await scopedQuery<AccountRow>(scope,['receiving_accounts.configure'],`INSERT INTO shipit.receiving_account_revisions
 (id,organization_id,franchise_id,account_id,version,name,methods,other_method_name,active,actor_id,correlation_id,key_digest,fingerprint)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}} RETURNING *`,
 [randomUUID(),c.permittedFranchiseIds[0],id,input.expected_version+1,input.name,input.methods,input.other_method_name,input.active,c.actor.id,c.correlationId,key,intent,c.organizationId])).rows[0];
 if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return dto(row);
}
export function createReceivingAccountService(database:DatabasePool,writesEnabled=true) {
 async function configure(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
  const q=selection(query),id=idInput===null?null:uuid(idInput,'account_id'),input=receivingAccount(body),key=keyDigest(idempotencyKey(keyInput,headers));
  if((id===null)!==(input.expected_version===0))throw new FieldValidationError('expected_version','OUT_OF_RANGE');
  const intent=digest({operation:'receiving_accounts.configure',account_id:id,input});
  return withReceivingAccountScope(database,token,q.organizationId,q.franchiseId,'receiving_accounts.configure',correlation,async scope=>{
   await active(scope);const before=id?await current(scope,id):null,c=assertTenantAccess(scope,['receiving_accounts.configure']);
   const previous=(await scopedQuery<AccountRow>(scope,['receiving_accounts.configure'],`SELECT * FROM shipit.receiving_account_revisions
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
   if(previous){if(previous.fingerprint!==intent)throw new HttpError('IDEMPOTENCY_CONFLICT');return dto(previous);}
   if(!writesEnabled)throw new HttpError('MONEY_RECEIPTS_DISABLED');
   if(before&&before.version!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
   const account=id??randomUUID();
   if(!id)await scopedQuery(scope,['receiving_accounts.configure'],`INSERT INTO shipit.receiving_accounts(id,organization_id,franchise_id)
    SELECT $1,{{organization}},$2 WHERE {{franchise:$3:$2}}`,[account,c.permittedFranchiseIds[0],c.organizationId]);
   return append(scope,account,key,intent,input);
  });
 }
 async function read(token:string,idInput:unknown,query:unknown,correlation:string) {
  const q=selection(query),id=uuid(idInput,'account_id');
  return withReceivingAccountScope(database,token,q.organizationId,q.franchiseId,'receiving_accounts.read',correlation,async scope=>dto(await current(scope,id)));
 }
 async function list(token:string,query:unknown,correlation:string) {
  const q=receiptPage(query);
  return withReceivingAccountScope(database,token,q.organizationId,q.franchiseId,'receiving_accounts.read',correlation,async scope=>{
   const rows=(await scopedQuery<AccountRow>(scope,['receiving_accounts.read'],`SELECT r.* FROM shipit.receiving_accounts a
    JOIN LATERAL (SELECT * FROM shipit.receiving_account_revisions x WHERE x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.account_id=a.id ORDER BY x.version DESC LIMIT 1) r ON true
    WHERE {{franchise:a.organization_id:a.franchise_id}} AND ($1::uuid IS NULL OR a.id>$1) ORDER BY a.id LIMIT $2`,[q.cursor,q.limit+1])).rows;
   return {items:rows.slice(0,q.limit).map(dto),next_cursor:rows.length>q.limit?rows[q.limit-1]!.account_id:null};
  });
 }
 return {configure,read,list};
}
