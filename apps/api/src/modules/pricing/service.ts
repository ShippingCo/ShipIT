import { randomUUID } from 'node:crypto';
import { DatabaseError, type DatabasePool } from '@shippingco/db';
import type { PricingQuoteDto, PricingQuoteInput, PricingVersionDto } from '@shippingco/shared';
import { withStaffTenantScope } from '../memberships/service.ts';
import { lockActiveFranchiseForOperationalWrite } from '../tenancy/repository.ts';
import { TenancyError } from '../tenancy/errors.ts';
import { appendPricing } from '../audit/repository.ts';
import { HttpError } from '../../plugins/errors.ts';
import { assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { versionDto, replayDto, type PricingAction, type PricingOperation } from './types.ts';
import * as validate from './validation.ts';
import * as repository from './repository.ts';
import { assertRules, calculate } from './calculation.ts';
import { digest, fingerprint, keyDigest } from './idempotency.ts';
async function active(scope:TenantAccess) {
  const c=assertTenantAccess(scope);
  try {await lockActiveFranchiseForOperationalWrite(scope,{organizationId:c.organizationId!,franchiseId:c.permittedFranchiseIds[0]!});}
  catch(error) {if(error instanceof TenancyError)throw new HttpError(error.code);throw error;}
}
async function load(scope:TenantAccess,id:string) {
  const row=await repository.find(scope,id);
  if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
  return versionDto(row,await repository.rules(scope,id));
}
async function current(scope:TenantAccess,now:Date) {
  const row=await repository.effective(scope,now);
  return versionDto(row,await repository.rules(scope,row.id));
}
function reauthorizeQuote(scope:TenantAccess,result:PricingQuoteDto) {
  if(result.inputs.override && scope.context.action!=='pricing.override'&&scope.context.action!=='pricing.override.approve'&&scope.context.action!=='pricing.validate')throw new HttpError('ACTION_FORBIDDEN');
  if(result.override_status==='privileged'&&scope.context.action!=='pricing.override.approve')throw new HttpError('ACTION_FORBIDDEN');
}
/** #22 must call inside the live staff transaction and keep its locks until snapshot commit.
 * It takes a stored quote ID and current business inputs, never a client-calculated DTO.
 */
export async function validatePricingSnapshot(scope:TenantAccess,quoteId:string,expected:PricingQuoteInput,now:Date=new Date()):Promise<PricingQuoteDto> {
  assertTenantAccess(scope,['pricing.validate','pricing.override.approve']);
  const id=validate.uuid(quoteId,'quote_id'),input=validate.quote(expected);
  await active(scope);
  const stored=await repository.quote(scope,id);
  if(!stored)throw new HttpError('RESOURCE_NOT_FOUND');
  reauthorizeQuote(scope,stored);
  if(now.getTime()<Date.parse(stored.created_at)||now.getTime()>=Date.parse(stored.expires_at)||digest(input)!==digest(stored.inputs))throw new HttpError('QUOTE_STALE');
  let version:PricingVersionDto;
  try {version=await current(scope,now);}catch(error) {if(error instanceof HttpError&&error.code==='NO_RATE')throw new HttpError('QUOTE_STALE');throw error;}
  if(version.id!==stored.rate_version_id)throw new HttpError('QUOTE_STALE');
  const recalculated=calculate(version,input,new Date(stored.created_at),stored.id,scope.context.actor.id,scope.context.action==='pricing.override.approve');
  if(digest(recalculated)!==digest(stored))throw new HttpError('QUOTE_STALE');
  // Fresh independent value; caller may freeze/persist without aliasing the stored evidence.
  return structuredClone(recalculated);
}
export function createPricingService(database:DatabasePool,clock:()=>Date=()=>new Date()) {
  function scoped<T>(session:string,organization:unknown,franchise:unknown,action:PricingAction,correlationId:string,object:boolean,
    work:(scope:TenantAccess)=>Promise<T>) {
    const org=validate.uuid(organization,'organization_id'),franchiseId=validate.uuid(franchise,'franchise_id');
    return withStaffTenantScope(database,session,org,action,async scope=>{await repository.visible(scope);return work(scope);},{franchiseId,correlationId,object});
  }
  async function command<T extends PricingVersionDto|PricingQuoteDto>(scope:TenantAccess,operation:PricingOperation,keyInput:unknown,
    id:string|null,body:unknown,work:()=>Promise<T>):Promise<T> {
    if(id)await load(scope,id);
    const key=keyDigest(validate.idempotencyKey(keyInput)),intent=fingerprint(operation,id,body);
    const previous=await repository.receipt(scope,operation,key);
    if(previous) {
      await load(scope,previous.version_id);
      if(previous.quote_id) {
        const original=await repository.quote(scope,previous.quote_id);
        if(!original)throw new HttpError('RESOURCE_NOT_FOUND');
        reauthorizeQuote(scope,original);
      }
      if(previous.fingerprint!==intent)throw new HttpError('IDEMPOTENCY_CONFLICT');
      // Receipts contain only the explicitly constructed version/quote DTO, with no raw rows.
      return replayDto(previous.result) as T;
    }
    await active(scope);
    const result=await work();
    await repository.saveReceipt(scope,operation,key,intent,result);
    return result;
  }
  return {
    effective(session:string,organization:unknown,franchise:unknown,correlationId:string) {
      return scoped(session,organization,franchise,'pricing.read',correlationId,false,scope=>current(scope,clock()));
    },
    read(session:string,organization:unknown,franchise:unknown,id:unknown,correlationId:string) {
      return scoped(session,organization,franchise,'pricing.draft',correlationId,true,scope=>load(scope,validate.uuid(id)));
    },
    create(session:string,organization:unknown,franchise:unknown,key:unknown,input:unknown,correlationId:string) {
      return scoped(session,organization,franchise,'pricing.draft',correlationId,false,async scope=>{
        const body=validate.draft(input);
        return command(scope,'api.v1.pricing.draft',key,null,body,async()=>{
          const row=await repository.create(scope,body);
          await appendPricing(scope,row.id,row.revision,null,'pricing.draft','policy_change');
          return versionDto(row,await repository.rules(scope,row.id));
        });
      });
    },
    replace(session:string,organization:unknown,franchise:unknown,id:unknown,key:unknown,input:unknown,correlationId:string) {
      return scoped(session,organization,franchise,'pricing.draft',correlationId,true,async scope=>{
        const versionId=validate.uuid(id);await load(scope,versionId);const body=validate.draft(input,true);
        return command(scope,'api.v1.pricing.replace',key,versionId,body,async()=>{
          const row=await repository.replace(scope,versionId,body);
          await appendPricing(scope,row.id,row.revision,null,'pricing.draft','policy_change');
          return versionDto(row,await repository.rules(scope,row.id));
        });
      });
    },
    publish(session:string,organization:unknown,franchise:unknown,id:unknown,key:unknown,input:unknown,correlationId:string) {
      return scoped(session,organization,franchise,'pricing.publish',correlationId,true,async scope=>{
        const versionId=validate.uuid(id);await load(scope,versionId);const body=validate.publish(input);
        return command(scope,'api.v1.pricing.publish',key,versionId,body,async()=>{
          const row=(await repository.find(scope,versionId))!;
          if(row.revision!==body.expected_version||row.state!=='draft')throw new HttpError('VERSION_CONFLICT');
          assertRules(versionDto(row,await repository.rules(scope,row.id)));
          if(row.effective_from.getTime()<clock().getTime()||await repository.publicationConflict(scope,row))throw new HttpError('RATE_CONFLICT');
          let published;
          try {published=await repository.publish(scope,versionId,body.expected_version);}
          catch(error) {if(error instanceof DatabaseError&&error.sqlState==='23514')throw new HttpError('RATE_CONFLICT');throw error;}
          await appendPricing(scope,row.id,published.revision,null,'pricing.publish','policy_publication');
          return versionDto(published,await repository.rules(scope,row.id));
        });
      });
    },
    quote(session:string,organization:unknown,franchise:unknown,key:unknown,input:unknown,correlationId:string) {
      const body=validate.quote(input);
      return scoped(session,organization,franchise,body.override?'pricing.override':'pricing.quote',correlationId,false,scope=>
        command(scope,'api.v1.pricing.quote',key,null,body,async()=>{
          const now=clock(),version=await current(scope,now);
          const result=calculate(version,body,now,randomUUID(),scope.context.actor.id,scope.context.action==='pricing.override.approve');
          await repository.saveQuote(scope,result);
          if(body.override)await appendPricing(scope,version.id,version.version,result.id,
            result.override_status==='privileged'?'pricing.override.approve':'pricing.override',body.override.reason_code);
          return result;
        }));
    },
    validate(session:string,organization:unknown,franchise:unknown,id:string,input:PricingQuoteInput,correlationId:string) {
      return scoped(session,organization,franchise,'pricing.validate',correlationId,true,scope=>validatePricingSnapshot(scope,id,input,clock()));
    },
  };
}
