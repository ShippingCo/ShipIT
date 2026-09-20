import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { withOutboundScope } from '../security/jobs.ts';
import { checkCurrentConsent } from './consent-service.ts';
import * as consent from './consent-repository.ts';
import * as repository from './outbound-repository.ts';
import { openOutbound, policyFailure, sendDecision } from './outbound-rules.ts';
import type { SendOutcome, WhatsappDependencies } from './types.ts';

export function createOutboundWorker(database:DatabasePool,dependencies:WhatsappDependencies) {
 const clock=()=>dependencies.clock?.()??null;
 return {
  async attention() {return await withOutboundScope(database,null,clock(),async()=>true,true)??false;},
  async tick() {
   const reservation=await withOutboundScope(database,null,clock(),async(scope,id)=>{
    const installation=await consent.lockInstallation(scope,true),m=await repository.lock(scope,id);
    if(!m)return null;
    const now=await repository.now(scope,dependencies.clock?.()),observed=await repository.observation(scope,id);
    const state=observed.progress===3?'read':observed.progress===2?'delivered':observed.failed&&m.state==='accepted'?'failed':null;
    if(state&&state!==m.state&&m.state!=='read'&&!(m.state==='delivered'&&state!=='read')) {
     await repository.update(scope,m,state,state==='failed'?'delivery_failed':'delivery_confirmed',now,{purge:state!=='failed'});
     await repository.disclose(scope,id);return {result:state} as const;
    }
    if(m.state==='dispatching') {
     if(m.lease_until!>now)return null;
     await repository.attempt(scope,m,'uncertain','worker_interrupted',null);
     await repository.update(scope,m,'uncertain','worker_interrupted',now);return {result:'uncertain'} as const;
    }
    if(m.expires_at<=now&&m.sealed_payload!==null) {
     await repository.update(scope,m,['queued','retry_wait'].includes(m.state)?'suppressed':m.state,'rendering_expired',now,{purge:true});return {result:'expired'} as const;
    }
    if(!['queued','retry_wait'].includes(m.state)||m.available_at>now)return null;
    const config=dependencies.configuration.webhook;
    let input;
    try {if(!config||!m.sealed_payload)throw new Error();input=openOutbound(config,id,m.key_version,m.sealed_payload);}
    catch {await repository.update(scope,m,'failed','rendering_unavailable',now);return {result:'failed'} as const;}
    const customer=await consent.lockCustomer(scope,m.customer_id);
    if(!installation||installation.id!==m.installation_id||!customer||customer.contact_version!==m.contact_version) {
     await repository.update(scope,m,'suppressed','contact_changed',now,{purge:true});return {result:'suppressed'} as const;
    }
    const policy=await checkCurrentConsent(scope,{...dependencies,clock:()=>now},{...input,purpose:input.purpose==='consent_disclosure'?'requested_assistance':input.purpose,
     requested_inbox_id:input.source_kind==='inbox'?input.source_id:undefined});
    if(!policy.allowed) {
     const result=policyFailure(policy.reason);
     await repository.update(scope,m,result,policy.reason,now,{purge:result==='suppressed'});return {result};
    }
    const binding=dependencies.configuration.bindings.find(b=>b.key===installation.binding_key)!;
    const template=input.format==='template'?await consent.template(scope,installation.id,input.template_name,input.template_language):null;
    const attempt=randomUUID();
    await repository.update(scope,m,'dispatching','dispatch_reserved',now,{attempt});
    return {id,attempt,binding,template,recipient:customer.phone_normalized,input} as const;
   });
   if(!reservation)return null;
   if('result' in reservation)return reservation.result;
   // Reservation commit is the linearization point. No database lock spans HTTP.
   // An ambiguous COMMIT prevents this call; lease recovery marks it uncertain.
   let outcome:SendOutcome;
   try {
    outcome=reservation.input.format==='template'?
     await dependencies.provider.send(reservation.binding,reservation.template!,reservation.recipient,reservation.input.variables):
     dependencies.provider.sendText?await dependencies.provider.sendText(reservation.binding,reservation.recipient,reservation.input.text!):{kind:'unavailable',reason:'text_unavailable'};
   }catch{outcome={kind:'uncertain',reason:'acceptance_unknown'};}
   return withOutboundScope(database,reservation.id,clock(),async(scope,id)=>{
    const m=await repository.lock(scope,id);if(!m||m.attempt_id!==reservation.attempt||m.state!=='dispatching')return 'uncertain';
    const decision=sendDecision(outcome,m.cycle_attempts),now=await repository.now(scope,dependencies.clock?.());
    await repository.attempt(scope,m,outcome.kind,decision.reason,outcome.kind==='accepted'?outcome.provider_message_id:null);
    await repository.update(scope,m,decision.state,decision.reason,now,{delay:decision.delay,purge:decision.state==='accepted'});
    return decision.state;
   });
  },
 };
}
