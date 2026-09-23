import { randomUUID } from 'node:crypto';
import { scopedQuery,assertTenantAccess,type TenantAccess } from '../security/scope.ts';
import { consentContactKey } from '../whatsapp/consent-worker.ts';
import { outboundFingerprint,sealOutbound,type ResolvedOutboundInput } from '../whatsapp/outbound-rules.ts';
import { templateReason,validVariables } from '../whatsapp/rules.ts';
import type { WhatsappDependencies,Installation,RegisteredTemplate } from '../whatsapp/types.ts';
import type { DeliveryProofConfiguration } from './types.ts';

interface Source {attempt:string;challenge:string;parcel:string;recipient:string;contactVersion:string;code:string;expires:Date;command:string;
 kind:'initial'|'resend'|'replacement';ordinal:number;time:Date}
const actions=['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace'] as const;
export const sendReservationPending=(state:string)=>['queued','dispatching','retry_wait','uncertain'].includes(state);
export async function reserveChallengeSend(scope:TenantAccess,whatsapp:WhatsappDependencies|undefined,proof:DeliveryProofConfiguration,source:Source) {
 const c=assertTenantAccess(scope,actions),send=randomUUID(),outbound=randomUUID();
 let reason='provider_unavailable',installation:Installation|undefined,template:RegisteredTemplate|null,phone:string|undefined;
 const webhook=whatsapp?.configuration.webhook;
 if(whatsapp&&webhook) {
  installation=(await scopedQuery<Installation>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace'],`SELECT i.* FROM shipit.whatsapp_installations i
   WHERE {{franchise:i.organization_id:i.franchise_id}} FOR SHARE`)).rows[0];
  const recipient=(await scopedQuery<{phone_normalized:string;contact_version:string}>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace'],`SELECT x.phone_normalized,x.contact_version FROM shipit.delivery_recipients x
   WHERE {{franchise:x.organization_id:x.franchise_id}} AND x.id=$1 AND x.parcel_id=$2`,[source.recipient,source.parcel])).rows[0];
  if(installation&&recipient&&recipient.contact_version===source.contactVersion) {
   phone=recipient.phone_normalized;
   template=(await scopedQuery<RegisteredTemplate>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace'],`SELECT t.* FROM shipit.whatsapp_templates t WHERE {{franchise:t.organization_id:t.franchise_id}}
    AND t.installation_id=$1 AND t.name=$2 AND t.language=$3 ORDER BY t.version DESC LIMIT 1`,[installation.id,proof.template_name,proof.template_language])).rows[0]??null;
   reason=!proof.meta_send_qualified?'authentication_template_unqualified':installation.state!=='validated'?'installation_unavailable':templateReason(template,'delivery_otp')??
    (template!.credential_revision!==installation.credential_revision||source.time.getTime()-template!.checked_at.getTime()<0||source.time.getTime()-template!.checked_at.getTime()>=900000?'template_validation_stale':
     !validVariables(template!,[source.code])?'template_variables_invalid':'eligible');
  } else reason=recipient?'contact_changed':'contact_unavailable';
 }
 const queued=reason==='eligible'&&!!webhook&&!!installation&&!!phone;
 await scopedQuery(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace'],`INSERT INTO shipit.delivery_challenge_sends(id,organization_id,franchise_id,parcel_id,attempt_id,challenge_id,recipient_ref,kind,resend_ordinal,reserved_at,outbound_intent_id,send_state,reason_code,command_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 WHERE {{franchise:$14:$2}}`,
 [send,c.permittedFranchiseIds[0],source.parcel,source.attempt,source.challenge,source.recipient,source.kind,source.ordinal,source.time,queued?outbound:null,
  queued?'queued':'failed',reason,source.command,c.organizationId]);
 if(!queued)return {state:'failed',reason_code:reason};
 const activeInstallation=installation!,recipient=phone!;
 const input:ResolvedOutboundInput={source_kind:'delivery_challenge',source_id:send,affected_entity_id:source.parcel,delivery_recipient_ref:source.recipient,
  purpose:'delivery_otp',format:'template',template_name:proof.template_name,template_language:proof.template_language,variables:[source.code]};
 const fingerprint=outboundFingerprint(webhook,input);
 await scopedQuery(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace'],`INSERT INTO shipit.whatsapp_outbound(id,installation_id,customer_id,delivery_recipient_ref,contact_version,contact_key,source_id,affected_entity_id,source_kind,purpose,
  fingerprint,sealed_payload,key_version,expires_at,state,reason_code,organization_id,franchise_id,correlation_id)
  SELECT $1,$2,NULL,$3,$4,$5,$6,$7,'delivery_challenge','delivery_otp',$8,$9,$10,$11,'queued','operational_exception_approved',{{organization}},$12,$13
  WHERE {{franchise:$14:$12}}`,[outbound,activeInstallation.id,source.recipient,source.contactVersion,consentContactKey(webhook,activeInstallation.id,recipient),send,source.parcel,
  fingerprint,sealOutbound(webhook,outbound,input),webhook.key_version,source.expires,c.permittedFranchiseIds[0],c.correlationId,c.organizationId]);
 return {state:'queued',reason_code:'operational_exception_approved'};
}
