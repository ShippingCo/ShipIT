import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {withAgentMoneyScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery} from '../security/scope.ts';
import {selection,uuid,integer,object,idempotencyKey} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {agentMoneyActions} from './types.ts';
import {reserveCod} from './rules.ts';
import {cashbookText} from '../cashbook/request-service.ts';
import * as repo from './repository.ts';
const actions=[...agentMoneyActions];
function active(value:unknown):boolean {if(typeof value!=='boolean')throw new FieldValidationError('$','INVALID_TYPE');return value;}
function enabled(value:boolean){if(!value)throw new HttpError('AGENT_MONEY_DISABLED');}
const intent=(operation:string,id:string|null,input:unknown,key:unknown,headers:readonly string[])=>({key:keyDigest(idempotencyKey(key,headers)),fingerprint:digest({operation,id,input})});
export function createAgentCodService(database:DatabasePool,writesEnabled=false){
 return {
  async configureBeneficiary(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),id=idInput===null?null:uuid(idInput,'$'),b=object(body,['expected_version','name','active']),input={expected_version:integer(b.expected_version,'expected_version',0,2147483645),name:cashbookText(b.name,120),active:active(b.active)};
   if((id===null)!==(input.expected_version===0))throw new FieldValidationError('expected_version','OUT_OF_RANGE');const i=intent('configure_beneficiary',id,input,key,headers);
   return withAgentMoneyScope(database,token,q.organizationId,q.franchiseId,'agent_money.configure',correlation,async scope=>{
    const saved=await repo.replay(scope,'configure_beneficiary',i.key,i.fingerprint);if(saved)return saved;enabled(writesEnabled);
    const before=id?await repo.beneficiary(scope,id):null;if(before&&before.version!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
    const c=assertTenantAccess(scope,actions),beneficiary=id??randomUUID(),revision=randomUUID(),command=randomUUID();
    if(!id)await scopedQuery(scope,[...actions],`INSERT INTO shipit.cod_beneficiaries(id,organization_id,franchise_id) SELECT $1,{{organization}},$2 WHERE {{franchise:$3:$2}}`,[beneficiary,c.permittedFranchiseIds[0],c.organizationId]);
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.cod_beneficiary_revisions(id,organization_id,franchise_id,beneficiary_id,version,name,active,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}`,[revision,c.permittedFranchiseIds[0],beneficiary,input.expected_version+1,input.name,input.active,command,c.organizationId]);
    return repo.finish(scope,'configure_beneficiary',i.key,i.fingerprint,{beneficiary_id:beneficiary,...input},command,revision);
   });
  },
  async configureCod(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),id=idInput===null?null:uuid(idInput,'$'),b=object(body,['booking_id','parcel_id','expected_version','beneficiary_id','beneficiary_revision_id','amount_paise','currency','active']);
   if(b.currency!=='INR')throw new FieldValidationError('currency','INVALID_FORMAT');
   const input={booking_id:uuid(b.booking_id,'$'),parcel_id:uuid(b.parcel_id,'$'),expected_version:integer(b.expected_version,'expected_version',0,2147483645),beneficiary_id:uuid(b.beneficiary_id,'$'),beneficiary_revision_id:uuid(b.beneficiary_revision_id,'$'),amount_paise:integer(b.amount_paise,'amount_paise',1),currency:'INR',active:active(b.active)};
   if((id===null)!==(input.expected_version===0))throw new FieldValidationError('expected_version','OUT_OF_RANGE');const i=intent('configure_cod',id,input,key,headers);
   return withAgentMoneyScope(database,token,q.organizationId,q.franchiseId,'agent_money.configure',correlation,async scope=>{
    const saved=await repo.replay(scope,'configure_cod',i.key,i.fingerprint);if(saved)return saved;enabled(writesEnabled);const c=assertTenantAccess(scope,actions);
    const parcel=(await scopedQuery(scope,[...actions],`SELECT id FROM shipit.parcels WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1 AND id=$2 FOR UPDATE`,[input.booking_id,input.parcel_id])).rows[0];if(!parcel)throw new HttpError('RESOURCE_NOT_FOUND');
    const beneficiary=await repo.beneficiary(scope,input.beneficiary_id);if(beneficiary.id!==input.beneficiary_revision_id||input.active&&!beneficiary.active)throw new HttpError('VERSION_CONFLICT');
    const before=id?await repo.cod(scope,id):null;
    if(before&&(before.version!==input.expected_version||before.booking_id!==input.booking_id||before.parcel_id!==input.parcel_id))throw new HttpError('VERSION_CONFLICT');
    if(before&&BigInt(before.collected_paise)>0n&&(before.beneficiary_id!==input.beneficiary_id||before.beneficiary_revision_id!==input.beneficiary_revision_id||BigInt(before.amount_paise)!==BigInt(input.amount_paise)||before.active!==input.active))throw new HttpError('ALLOCATION_CONFLICT');
    if(!id&&(await scopedQuery(scope,[...actions],`SELECT id FROM shipit.cod_obligations WHERE {{franchise:organization_id:franchise_id}} AND parcel_id=$1`,[input.parcel_id])).rows.length)throw new HttpError('VERSION_CONFLICT');
    const obligation=id??randomUUID(),revision=randomUUID(),command=randomUUID();
    if(!id)await scopedQuery(scope,[...actions],`INSERT INTO shipit.cod_obligations(id,organization_id,franchise_id,booking_id,parcel_id) SELECT $1,{{organization}},$2,$3,$4 WHERE {{franchise:$5:$2}}`,[obligation,c.permittedFranchiseIds[0],input.booking_id,input.parcel_id,c.organizationId]);
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.cod_obligation_revisions(id,organization_id,franchise_id,obligation_id,version,beneficiary_id,beneficiary_revision_id,amount_paise,currency,active,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,'INR',$8,$9 WHERE {{franchise:$10:$2}}`,[revision,c.permittedFranchiseIds[0],obligation,input.expected_version+1,input.beneficiary_id,input.beneficiary_revision_id,input.amount_paise,input.active,command,c.organizationId]);
    return repo.finish(scope,'configure_cod',i.key,i.fingerprint,{obligation_id:obligation,...input},command,revision);
   });
  },
  async reserve(token:string,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),b=object(body,['receipt_id','obligation_id','obligation_revision_id','amount_paise','currency']);if(b.currency!=='INR')throw new FieldValidationError('currency','INVALID_FORMAT');
   const input={receipt_id:uuid(b.receipt_id,'$'),obligation_id:uuid(b.obligation_id,'$'),obligation_revision_id:uuid(b.obligation_revision_id,'$'),amount_paise:integer(b.amount_paise,'amount_paise',1),currency:'INR'},i=intent('reserve_cod',null,input,key,headers);
   return withAgentMoneyScope(database,token,q.organizationId,q.franchiseId,'agent_money.reserve',correlation,async scope=>{
    const saved=await repo.replay(scope,'reserve_cod',i.key,i.fingerprint);if(saved)return saved;enabled(writesEnabled);const c=assertTenantAccess(scope,actions);
    const receipt=(await scopedQuery<{amount_paise:string;customer_id:string}>(scope,[...actions],`SELECT amount_paise::text,customer_id FROM shipit.money_receipts WHERE {{franchise:organization_id:franchise_id}} AND id=$1 FOR UPDATE`,[input.receipt_id])).rows[0];if(!receipt)throw new HttpError('RESOURCE_NOT_FOUND');
    const obligation=await repo.cod(scope,input.obligation_id);if(obligation.id!==input.obligation_revision_id||!obligation.active)throw new HttpError('VERSION_CONFLICT');
    const customer=(await scopedQuery<{customer_id:string}>(scope,[...actions],`SELECT customer_id FROM shipit.bookings WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[obligation.booking_id])).rows[0];if(customer?.customer_id!==receipt.customer_id)throw new HttpError('RESOURCE_NOT_FOUND');
    const funds=(await scopedQuery<{freight:string;cod:string}>(scope,[...actions],`SELECT COALESCE((SELECT sum(CASE a.kind WHEN 'allocation' THEN a.amount_paise::numeric ELSE -a.amount_paise::numeric END) FROM shipit.money_receipt_allocations a WHERE a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.receipt_id=r.id),0)::text freight,
     COALESCE((SELECT sum(a.reserved_paise) FROM shipit.cod_receipt_positions a WHERE a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.receipt_id=r.id),0)::text cod
     FROM shipit.money_receipts r WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1`,[input.receipt_id])).rows[0];if(!funds)throw new HttpError('RESOURCE_NOT_FOUND');
    reserveCod(BigInt(receipt.amount_paise),BigInt(funds.freight),BigInt(funds.cod),BigInt(input.amount_paise),BigInt(obligation.amount_paise)-BigInt(obligation.collected_paise));
    const id=randomUUID(),command=randomUUID();await scopedQuery(scope,[...actions],`INSERT INTO shipit.cod_receipt_allocations(id,organization_id,franchise_id,receipt_id,obligation_id,obligation_revision_id,amount_paise,currency,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,'INR',$7 WHERE {{franchise:$8:$2}}`,[id,c.permittedFranchiseIds[0],input.receipt_id,input.obligation_id,input.obligation_revision_id,input.amount_paise,command,c.organizationId]);
    return repo.finish(scope,'reserve_cod',i.key,i.fingerprint,input,command,id);
   });
  }
 };
}
