import {randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import type {SettingsOwner,SettingsDto,SettingKey,ReportScopeOptions} from '@shippingco/shared';
import {withSettingsScope,withReportOptionsScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery} from '../security/scope.ts';
import {object,uuid,idempotencyKey} from '../pricing/validation.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {HttpError} from '../../plugins/errors.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';
export function createSettingsService(database:DatabasePool,writesEnabled=false){
 return {
  read(token:string,owner:SettingsOwner,query:unknown,correlation:string){const q=v.selection(query,owner);return withSettingsScope(database,token,q.organizationId,q.franchiseId,false,correlation,c=>r.resolve(c,owner));},
  history(token:string,owner:SettingsOwner,query:unknown,correlation:string){const q=v.selection(query,owner,true);return withSettingsScope(database,token,q.organizationId,q.franchiseId,false,correlation,c=>r.history(c,q.franchiseId,q.before));},
  update(token:string,owner:SettingsOwner,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=v.selection(query,owner),input=v.update(body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({owner,input});
   return withSettingsScope(database,token,q.organizationId,q.franchiseId,true,correlation,async context=>{
    const s=context.access,c=assertTenantAccess(s,['settings.organization.update','settings.franchise.update']);
    for(const k of Object.keys(input.changes) as SettingKey[])if(!r.editable(k,owner,context.canUpdate))throw new HttpError('ACTION_FORBIDDEN');
    const prior=(await scopedQuery<{fingerprint:string;result:SettingsDto}>(s,['settings.organization.update','settings.franchise.update'],`SELECT fingerprint,result FROM shipit.settings_commands WHERE {{organization:organization_id}} AND franchise_id IS NOT DISTINCT FROM $1::uuid AND actor_id=$2 AND key_digest=$3`,[q.franchiseId,c.actor.id,key])).rows[0];
    if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');for(const k of ['report_scope','reporting_schedule'] as const){const value=prior.result.values[k].value;if(value!==null&&!await r.referenceAvailable(context,k,value))throw new HttpError('RESOURCE_NOT_FOUND');}return prior.result;}
    if(!context.organizationActive)throw new HttpError('ORGANIZATION_DISABLED');if(!context.franchiseActive)throw new HttpError('FRANCHISE_DISABLED');
    if(!writesEnabled)throw new HttpError('SETTINGS_DISABLED');
    // Catalog checks happen after exact replay and current authority, but before any settings writes.
    // ICU and PostgreSQL may ship different tzdata; unsupported values are a correctable 422.
    const zones=[...new Set(Object.values(input.changes).flatMap(value=>value&&'timezone' in value?[value.timezone]:[]))];
    if(zones.length){
     const supported=await scopedQuery(s,['settings.organization.update','settings.franchise.update'],`SELECT requested.zone FROM unnest($1::text[]) requested(zone) WHERE {{organization:$2}} AND EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE lower(z.name)=lower(requested.zone))`,[zones,q.organizationId]);
     if(supported.rows.length!==zones.length)v.fail();
    }
    for(const k of Object.keys(input.changes) as SettingKey[]){const value=input.changes[k];if(value!=null&&!await r.referenceAvailable(context,k,value))throw new HttpError('RESOURCE_NOT_FOUND');}
    try{
     const version=await r.append(context,q.franchiseId,input.changes,input.reason,input.expected_version),result=await r.resolve(context,owner);
     await scopedQuery(s,['settings.organization.update','settings.franchise.update'],`INSERT INTO shipit.settings_commands(id,organization_id,franchise_id,actor_id,key_digest,fingerprint,version_id,result) SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{organization:$8}}`,[randomUUID(),q.franchiseId,c.actor.id,key,fingerprint,version.id,JSON.stringify(result),q.organizationId]);
     return result;
    }catch(error){if(error instanceof DatabaseError){if(error.sqlState==='40001'||error.sqlState==='23505')throw new HttpError('VERSION_CONFLICT');if(error.sqlState==='23503'||error.sqlState==='42501')throw new HttpError('RESOURCE_NOT_FOUND');}throw error;}
   });
  },
  scopes(token:string,query:unknown,correlation:string):Promise<ReportScopeOptions>{
   const b=object(query,['organization_id','franchise_id','cursor']),organizationId=uuid(b.organization_id,'organization_id'),franchiseId=uuid(b.franchise_id,'franchise_id'),cursor=b.cursor==null?null:uuid(b.cursor,'cursor');
   return withReportOptionsScope(database,token,organizationId,franchiseId,cursor,correlation,async(s,exports,more)=>{
    const rows=(await scopedQuery<{id:string;name:string}>(s,['reports.capture'],`SELECT id,display_name AS name FROM shipit.franchises WHERE {{franchise:organization_id:id}} AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 50`,[cursor])).rows;
    return {organization_id:organizationId,active_franchise_id:franchiseId,items:rows.map(row=>({...row,can_export:exports.includes(row.id)})),next_cursor:more?rows.at(-1)!.id:null,maximum_selection:50};
   });
  },
 };
}
