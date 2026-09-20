import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { checkCurrentConsent } from './consent-service.ts';
import { consentContactKey } from './consent-worker.ts';
import * as consent from './consent-repository.ts';
import * as repository from './outbound-repository.ts';
import { disclosureText, outboundFingerprint, outboundInput, policyFailure, sealOutbound } from './outbound-rules.ts';
import type { WhatsappDependencies } from './types.ts';

/** Database-only effect for a trusted consumer. Never call this from a booking transaction or a browser. */
export async function enqueueMessage(scope:TenantAccess,dependencies:WhatsappDependencies,value:unknown) {
 assertTenantAccess(scope,['outbox.work']);
 const input=outboundInput(value),config=dependencies.configuration.webhook;
 if(!config)throw new HttpError('TEMPORARILY_UNAVAILABLE');
 // Match the consent lock order; the unique ledger identity serializes duplicate inserts.
 const installation=await consent.lockInstallation(scope);
 if(!installation)throw new HttpError('RESOURCE_NOT_FOUND');
 const customer=await consent.lockCustomer(scope,input.customer_id);
 if(!customer||!await repository.sourceValid(scope,input))throw new HttpError('RESOURCE_NOT_FOUND');
 const fingerprint=outboundFingerprint(config,input),prior=await repository.prior(scope,input);
 if(prior) {
  if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
  return {id:prior.id};
 }
 const instant=await repository.now(scope,dependencies.clock?.());
 const policy=await checkCurrentConsent(scope,{...dependencies,clock:()=>instant},{...input,purpose:input.purpose==='consent_disclosure'?'requested_assistance':input.purpose,
  requested_inbox_id:input.source_kind==='inbox'?input.source_id:undefined});
 const rendering=input.purpose==='consent_disclosure'?{...input,text:disclosureText(await repository.businessName(scope))}:input;
 const id=randomUUID();
 const state=policy.allowed?'queued':policyFailure(policy.reason);
 const saved=await repository.insert(scope,[id,installation.id,customer.id,customer.contact_version,consentContactKey(config,installation.id,customer.phone_normalized),input.source_id,input.source_kind,input.purpose,
  fingerprint,state==='suppressed'?null:sealOutbound(config,id,rendering),config.key_version,new Date(instant.getTime()+86400000),
  input.purpose==='consent_disclosure'?createHash('sha256').update(rendering.text!).digest('hex'):null,state,policy.reason]);
 if(saved)return {id:saved.id};
 const concurrent=await repository.prior(scope,input);
 if(!concurrent||concurrent.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
 return {id:concurrent.id};
}
