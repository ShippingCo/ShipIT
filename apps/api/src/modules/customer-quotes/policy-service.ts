import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withStaffTenantScope } from '../memberships/service.ts';
import { scopedQuery } from '../security/scope.ts';
import { digest,keyDigest } from '../pricing/idempotency.ts';
import { uuid,idempotencyKey } from '../pricing/validation.ts';
import { policyInput } from './rules.ts';
import { policy } from './repository.ts';

export function createQuotePolicyService(database:DatabasePool) {
 return {
  async read(token:string,organization:unknown,franchise:unknown,correlation:string) {
   const org=uuid(organization,'$'),f=uuid(franchise,'$');
   return withStaffTenantScope(database,token,org,'pricing.draft',async scope=>({policy:await policy(scope)??null}),{franchiseId:f,correlationId:correlation,object:true});
  },
  async configure(token:string,organization:unknown,franchise:unknown,key:unknown,input:unknown,correlation:string) {
   const org=uuid(organization,'$'),f=uuid(franchise,'$'),body=policyInput(input),hash=keyDigest(idempotencyKey(key)),fingerprint=digest(body);
   return withStaffTenantScope(database,token,org,'pricing.draft',async scope=>{
    const prior=(await scopedQuery<{fingerprint:string;result:unknown}>(scope,['pricing.draft'],`SELECT p.fingerprint,p.result FROM shipit.customer_quote_policy_commands p
     WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.actor_id=$1 AND p.key_digest=$2`,[scope.context.actor.id,hash])).rows[0];
    if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return prior.result;}
    const active=(await scopedQuery(scope,['pricing.draft'],`SELECT f.id FROM shipit.franchises f JOIN shipit.organizations o ON o.id=f.organization_id
     WHERE {{franchise:f.organization_id:f.id}} AND f.lifecycle='active' AND o.lifecycle='active'`,[])).rows[0];
    if(!active)throw new HttpError('ACTION_FORBIDDEN');
    const current=await policy(scope);if((current?.version??0)!==body.expected_version)throw new HttpError('VERSION_CONFLICT');
    const rate=(await scopedQuery(scope,['pricing.draft'],`SELECT v.id FROM shipit.pricing_versions v WHERE {{franchise:v.organization_id:v.franchise_id}}
     AND v.id=$1 AND v.state='published'`,[body.rate_version_id])).rows[0];
    if(!rate)throw new HttpError('RESOURCE_NOT_FOUND');
    const {expected_version,...configuration}=body,result={id:randomUUID(),version:expected_version+1,configuration};
    await scopedQuery(scope,['pricing.draft'],`INSERT INTO shipit.customer_quote_policies(id,organization_id,franchise_id,version,configuration,rate_version_id,actor_id,correlation_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}`,[result.id,f,result.version,configuration,configuration.rate_version_id,scope.context.actor.id,correlation,org]);
    await scopedQuery(scope,['pricing.draft'],`INSERT INTO shipit.customer_quote_policy_commands(organization_id,franchise_id,actor_id,key_digest,fingerprint,result)
     SELECT {{organization}},$1,$2,$3,$4,$5 WHERE {{franchise:$6:$1}}`,[f,scope.context.actor.id,hash,fingerprint,result,org]);
    return result;
   },{franchiseId:f,correlationId:correlation,object:true});
  },
 };
}
