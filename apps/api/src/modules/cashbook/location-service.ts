import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import type {CashLocationDto,CashLocationInput} from '@shippingco/shared';
import {withCashbookScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {object,selection,uuid,integer,idempotencyKey} from '../pricing/validation.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {instant} from '../pricing/types.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
const actions=['cashbook.configure','cashbook.read','cashbook.select'] as const;
interface Row {id:string;location_id:string;version:number;name:string;active:boolean;kind:'cash'|'noncash';account_id:string;account_revision_id:string;account_version:number;custodian_id:string|null;recorded_at:Date;fingerprint:string}
function dto(r:Row):CashLocationDto {return {id:r.location_id,revision_id:r.id,version:r.version,name:r.name,active:r.active,kind:r.kind,account_id:r.account_id,account_revision_id:r.account_revision_id,account_version:r.account_version,custodian_id:r.custodian_id,recorded_at:instant(r.recorded_at)};}
export function locationInput(value:unknown):CashLocationInput {
 const b=object(value,['account_id','expected_account_version','custodian_id','name','active','expected_version']);
 if(typeof b.name!=='string'||b.name.length>480||!b.name.trim()||[...b.name.trim()].length>120||[...b.name].some(char=>{const code=char.codePointAt(0)!;return code<32||(code>=127&&code<=159)||(code>=0xd800&&code<=0xdfff);}))throw new FieldValidationError('name','INVALID_FORMAT');
 if(typeof b.active!=='boolean')throw new FieldValidationError('$','INVALID_FORMAT');
 return {account_id:uuid(b.account_id,'account_id'),expected_account_version:integer(b.expected_account_version,'expected_account_version',1,2147483647),custodian_id:b.custodian_id===null?null:uuid(b.custodian_id,'custodian_id'),name:b.name.trim(),active:b.active,expected_version:integer(b.expected_version,'expected_version',0,2147483646)};
}
async function readRow(scope:TenantAccess,id:string,ownOnly=false) {
 const c=assertTenantAccess(scope,[...actions]);
 const row=(await scopedQuery<Row>(scope,[...actions],`SELECT r.*,l.kind,l.custodian_id,a.version account_version FROM shipit.cash_locations l
 JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions x WHERE x.organization_id=l.organization_id AND x.franchise_id=l.franchise_id AND x.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
 JOIN shipit.receiving_account_revisions a ON a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.account_id=r.account_id AND a.id=r.account_revision_id
 WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.id=$1 AND (NOT $2::boolean OR l.kind='noncash' OR l.custodian_id=$3)`,[id,ownOnly,c.actor.id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export function createCashLocationService(database:DatabasePool,writesEnabled=false) {
 return {
  async configure(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=idInput===null?null:uuid(idInput,'$'),input=locationInput(body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation:'cashbook.location.configure',id,input});
   if((id===null)!==(input.expected_version===0))throw new FieldValidationError('expected_version','OUT_OF_RANGE');
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.configure',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,['cashbook.configure']);
    const f=(await scopedQuery<{lifecycle:string}>(scope,['cashbook.configure'],`SELECT lifecycle FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
    if(!f)throw new HttpError('RESOURCE_NOT_FOUND');if(f.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
    const before=id?await readRow(scope,id):null;
    const previous=(await scopedQuery<Row>(scope,['cashbook.configure'],`SELECT r.*,l.kind,l.custodian_id,a.version account_version FROM shipit.cash_location_revisions r
     JOIN shipit.cash_locations l ON l.organization_id=r.organization_id AND l.franchise_id=r.franchise_id AND l.id=r.location_id
     JOIN shipit.receiving_account_revisions a ON a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.account_id=r.account_id AND a.id=r.account_revision_id
     WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.actor_id=$1 AND r.key_digest=$2`,[c.actor.id,key])).rows[0];
    if(previous){if(previous.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return dto(previous);}
    if(!writesEnabled)throw new HttpError('CASHBOOK_DISABLED');
    if(before&&(before.version!==input.expected_version||before.account_id!==input.account_id||before.custodian_id!==input.custodian_id))throw new HttpError('VERSION_CONFLICT');
    const account=(await scopedQuery<{id:string;version:number;methods:string[];active:boolean}>(scope,['cashbook.configure'],`SELECT id,version,methods,active FROM shipit.receiving_account_revisions WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 ORDER BY version DESC LIMIT 1`,[input.account_id])).rows[0];
    if(!account)throw new HttpError('RESOURCE_NOT_FOUND');if(account.version!==input.expected_account_version||((input.active||!before)&&!account.active))throw new HttpError('VERSION_CONFLICT');
    const cash=account.methods.includes('cash');if((input.active||!before)&&cash!==(input.custodian_id!==null))throw new FieldValidationError('custodian_id','INVALID_FORMAT');
    if((input.active||!before)&&input.custodian_id!==null){
     const member=(await scopedQuery(scope,['cashbook.configure'],`SELECT m.user_id FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
      JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE {{franchise:s.organization_id:s.franchise_id}} AND m.user_id=$1 AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin')`,[input.custodian_id])).rows[0];if(!member)throw new HttpError('RESOURCE_NOT_FOUND');
    }
    const location=id??randomUUID();
    if(!id){
     const existing=(await scopedQuery(scope,['cashbook.configure'],`SELECT id FROM shipit.cash_locations WHERE {{franchise:organization_id:franchise_id}} AND account_id=$1 AND custodian_id IS NOT DISTINCT FROM $2::uuid`,[input.account_id,input.custodian_id])).rows[0];if(existing)throw new HttpError('VERSION_CONFLICT');
     await scopedQuery(scope,['cashbook.configure'],`INSERT INTO shipit.cash_locations(id,organization_id,franchise_id,account_id,kind,custodian_id)
      SELECT $1,{{organization}},$2,$3,$4,$5 WHERE {{franchise:$6:$2}}`,[location,c.permittedFranchiseIds[0],input.account_id,cash?'cash':'noncash',input.custodian_id,c.organizationId]);
    }
    await scopedQuery(scope,['cashbook.configure'],`INSERT INTO shipit.cash_location_revisions(id,organization_id,franchise_id,location_id,account_id,account_revision_id,version,name,active,actor_id,correlation_id,key_digest,fingerprint)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,[randomUUID(),c.permittedFranchiseIds[0],location,input.account_id,account.id,input.expected_version+1,input.name,input.active,c.actor.id,c.correlationId,key,fingerprint,c.organizationId]);
    return dto(await readRow(scope,location));
   });
  },
  async read(token:string,idInput:unknown,query:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$');return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.select',correlation,s=>readRow(s.access,id,s.ownOnly).then(dto));
  },
  async list(token:string,query:unknown,correlation:string) {
   const b=object(query,['organization_id','franchise_id','cursor','limit']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),cursor=b.cursor===undefined?null:uuid(b.cursor,'cursor');
   if(b.limit!==undefined&&(typeof b.limit!=='string'||!/^([1-9][0-9]?|100)$/.test(b.limit)))throw new FieldValidationError('limit','OUT_OF_RANGE');const limit=b.limit===undefined?50:Number(b.limit);
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.select',correlation,async s=>{
    const c=assertTenantAccess(s.access,['cashbook.select']),rows=(await scopedQuery<Row>(s.access,['cashbook.select'],`SELECT r.*,l.kind,l.custodian_id,a.version account_version FROM shipit.cash_locations l
     JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions x WHERE x.organization_id=l.organization_id AND x.franchise_id=l.franchise_id AND x.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
     JOIN shipit.receiving_account_revisions a ON a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.account_id=r.account_id AND a.id=r.account_revision_id
     WHERE {{franchise:l.organization_id:l.franchise_id}} AND ($1::uuid IS NULL OR l.id>$1) AND (NOT $2::boolean OR l.kind='noncash' OR l.custodian_id=$3)
     ORDER BY l.id LIMIT $4`,[cursor,s.ownOnly,c.actor.id,limit+1])).rows;
    return {items:rows.slice(0,limit).map(dto),next_cursor:rows.length>limit?rows[limit-1]!.location_id:null};
   });
  }
 };
}
