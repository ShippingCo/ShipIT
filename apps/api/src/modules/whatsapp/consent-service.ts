import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withWhatsappScope } from '../memberships/service.ts';
import type { TenantAccess } from '../security/scope.ts';
import { object, uuid } from '../pricing/validation.ts';
import { consentContactKey } from './consent-worker.ts';
import { evaluateConsentPolicy, type ConsentPolicyInput } from './consent-rules.ts';
import type { WhatsappDependencies } from './types.ts';
import * as repository from './consent-repository.ts';

export interface ConsentRequest {
  customer_id: string;
  purpose: ConsentPolicyInput['purpose'];
  format: 'text' | 'template';
  template_name?: string;
  template_language?: string;
  variables?: unknown;
  requested_inbox_id?: string;
}

/** #39 calls this under its trusted job scope at both enqueue and final dispatch.
 * Return values are observations, never reusable authorization tokens. No network I/O. */
export async function checkCurrentConsent(scope: TenantAccess, dependencies: WhatsappDependencies, request: ConsentRequest) {
  if(!['updates','requested_assistance','delivery_otp','marketing'].includes(request.purpose)||!['text','template'].includes(request.format))throw new HttpError('VALIDATION_FAILED');
  // Match the consumer's root/installation/customer lock order. A STOP cannot commit
  // between reading consent and checking pending work in this transaction.
  const installation=await repository.lockInstallation(scope);
  const customer=await repository.lockCustomer(scope,request.customer_id);
  const now=(dependencies.clock??(()=>new Date()))();
  if(!customer)throw new HttpError('RESOURCE_NOT_FOUND');
  const config=dependencies.configuration.webhook;
  if(!installation||!config)return {allowed:false,reason:'installation_unavailable',policy_version:'whatsapp-consent-v1'};
  const contact=consentContactKey(config,installation.id,customer.phone_normalized);
  const matches=await repository.contactMatches(scope,customer.phone_normalized);
  const state=await repository.state(scope,installation.id,contact);
  const pending=await repository.pending(scope,installation.id);
  const requested=!!request.requested_inbox_id && await repository.requestedContext(scope,request.requested_inbox_id,installation.id,contact,customer.id,customer.contact_version,now);
  const template=request.format==='template'?await repository.template(scope,installation.id,request.template_name,request.template_language):null;
  const binding = dependencies.configuration.bindings.find(b=>b.key===installation.binding_key && b.organization_id===installation.organization_id &&
    b.franchise_id===installation.franchise_id && b.waba_id===installation.waba_id && b.phone_number_id===installation.phone_number_id && b.credential_ref===installation.credential_ref);
  return evaluateConsentPolicy({purpose:request.purpose,state:state?.state??'unknown',
    currentContact:matches===1 && state?.customer_id===customer.id && state.contact_version===customer.contact_version,
    pendingInbound:pending,installationActive:installation.state==='validated' && installation.owner_active && !!binding,
    lastInboundAt:state?.last_inbound_at??null,requestedInboxMatches:requested,now,
    format:request.format,template,credentialRevision:installation.credential_revision,variables:request.variables});
}

export function createConsentService(database:DatabasePool,dependencies:WhatsappDependencies) {
  const select=(query:unknown)=>{const q=object(query,['organization_id','franchise_id']);return [uuid(q.organization_id),uuid(q.franchise_id)] as const;};
  return {
    async history(token:string,id:string,query:unknown,correlation:string) {
      const [org,franchise]=select(query);uuid(id);
      return withWhatsappScope(database,token,org,franchise,'whatsapp.consent.read',correlation,async scope=>{
        const current=await checkCurrentConsent(scope,dependencies,{customer_id:id,purpose:'updates',format:'text'});
        const history=await repository.history(scope,id);
        return {history:history.slice(0,100),has_more:history.length>100,
          current};
      });
    },
    async policy(token:string,id:string,query:unknown,body:unknown,correlation:string) {
      const [org,franchise]=select(query);uuid(id);
      const b=object(body,['purpose','format','template_name','template_language','variables','requested_inbox_id']);
      if(!['updates','requested_assistance','delivery_otp','marketing'].includes(String(b.purpose)) || !['text','template'].includes(String(b.format)))throw new HttpError('VALIDATION_FAILED');
      if(b.requested_inbox_id!==undefined)uuid(b.requested_inbox_id);
      if(b.format==='template' && (typeof b.template_name!=='string'||!/^[a-z][a-z0-9_]{0,511}$/.test(b.template_name)||
        typeof b.template_language!=='string'||!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(b.template_language)))throw new HttpError('VALIDATION_FAILED');
      return withWhatsappScope(database,token,org,franchise,'whatsapp.consent.read',correlation,
        scope=>checkCurrentConsent(scope,dependencies,{...b,customer_id:id} as ConsentRequest));
    },
  };
}
