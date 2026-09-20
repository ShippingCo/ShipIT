import { HttpError } from '../../plugins/errors.ts';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import type { Installation,RegisteredTemplate,Binding,Template } from './types.ts';

export async function active(scope:TenantAccess) {
  const f=(await scopedQuery<{lifecycle:string}>(scope,['whatsapp.write'],`SELECT f.lifecycle FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}} FOR UPDATE`)).rows[0];
  if(!f)throw new HttpError('RESOURCE_NOT_FOUND');if(f.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
export async function installation(scope:TenantAccess) {
  return (await scopedQuery<Installation>(scope,['whatsapp.read','whatsapp.write'],`SELECT i.* FROM shipit.whatsapp_installations i WHERE {{franchise:i.organization_id:i.franchise_id}}`)).rows[0]??null;
}
export async function rootsActive(scope:TenantAccess) {
  const row=(await scopedQuery<{active:boolean}>(scope,['whatsapp.read'],`SELECT (f.lifecycle='active' AND o.lifecycle='active') AS active
    FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id
    WHERE {{franchise:f.organization_id:f.id}} AND {{organization:o.id}}`)).rows[0];
  return row?.active===true;
}
export async function replay(scope:TenantAccess,key:string,fingerprint:string) {
  const row=(await scopedQuery<{fingerprint:string;result:Record<string,unknown>}>(scope,['whatsapp.write'],`SELECT c.fingerprint,c.result FROM shipit.whatsapp_commands c
    WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.actor_id=$1 AND c.key_hash=$2`,[scope.context.actor.id,key])).rows[0];
  if(row&&row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return row?.result??null;
}
export async function template(scope:TenantAccess,id:string,name:string,language:string) {
  return (await scopedQuery<RegisteredTemplate>(scope,['whatsapp.read','whatsapp.write'],`SELECT t.* FROM shipit.whatsapp_templates t
    WHERE {{franchise:t.organization_id:t.franchise_id}} AND t.installation_id=$1 AND t.name=$2 AND t.language=$3 ORDER BY t.version DESC LIMIT 1`,[id,name,language])).rows[0]??null;
}
export async function save(scope:TenantAccess,id:string,binding:Binding,version:number,credentialRevision:number,state:string,validatedAt:Date,command:string) {
  if(version===1) {
    await scopedQuery(scope,['whatsapp.write'],`INSERT INTO shipit.whatsapp_installations(id,organization_id,franchise_id,binding_key,waba_id,phone_number_id,credential_ref,version,credential_revision,state,validated_at,command_id)
      SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,1,1,$8,$9::timestamptz,$10::uuid WHERE {{franchise:$2:$3}}`,[id,binding.organization_id,binding.franchise_id,binding.key,binding.waba_id,binding.phone_number_id,binding.credential_ref,state,validatedAt,command]);
  }else {
    await scopedQuery(scope,['whatsapp.write'],`UPDATE shipit.whatsapp_installations i SET binding_key=$2,credential_ref=$3,version=$4,credential_revision=$5,state=$6,validated_at=$7,command_id=$8
      WHERE {{franchise:i.organization_id:i.franchise_id}} AND i.id=$1`,[id,binding.key,binding.credential_ref,version,credentialRevision,state,validatedAt,command]);
  }
}
export async function saveTemplate(scope:TenantAccess,id:string,value:Template,version:number,credentialRevision:number,checkedAt:Date,command:string) {
  await scopedQuery(scope,['whatsapp.write'],`INSERT INTO shipit.whatsapp_templates(organization_id,franchise_id,installation_id,name,language,version,credential_revision,provider_id,status,category,supported,shape_hash,variables,checked_at,command_id)
    SELECT $1::uuid,$2::uuid,$3::uuid,$4,$5,$6::integer,$7::integer,$8,$9,$10,$11::boolean,$12,$13::jsonb,$14::timestamptz,$15::uuid WHERE {{franchise:$1:$2}}`,
  [scope.context.organizationId,scope.context.permittedFranchiseIds[0],id,value.name,value.language,version,credentialRevision,value.provider_id,value.status,value.category,value.supported,value.shape_hash,JSON.stringify(value.variables),checkedAt,command]);
}
export async function command(scope:TenantAccess,id:string,installationId:string,key:string,fingerprint:string,operation:string,version:number,result:unknown) {
  await scopedQuery(scope,['whatsapp.write'],`INSERT INTO shipit.whatsapp_commands(id,organization_id,franchise_id,installation_id,actor_id,key_hash,fingerprint,operation,version,result,correlation_id)
    SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6,$7,$8,$9::integer,$10::jsonb,$11::uuid WHERE {{franchise:$2:$3}}`,[id,scope.context.organizationId,scope.context.permittedFranchiseIds[0],installationId,
    scope.context.actor.id,key,fingerprint,operation,version,JSON.stringify(result),scope.context.correlationId]);
}
