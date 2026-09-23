import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { object, uuid } from '../pricing/validation.ts';
import { namePattern, languagePattern } from './rules.ts';
import type { BusinessWebhookConfig } from './webhook-payload.ts';
import type { SendOutcome } from './types.ts';

export interface OutboundInput {
  source_kind:'event'|'inbox'|'delivery_challenge'; source_id:string; affected_entity_id?:string; customer_id?:string;delivery_recipient_ref?:string;
  purpose:'updates'|'requested_assistance'|'consent_disclosure'|'delivery_otp';
  format:'text'|'template'; text?:string; template_name?:string; template_language?:string; variables?:string[];
}
export type ResolvedOutboundInput=OutboundInput&{affected_entity_id:string};
export function outboundInput(value:unknown):ResolvedOutboundInput {
  const b=object(value,['source_kind','source_id','affected_entity_id','customer_id','delivery_recipient_ref','purpose','format','text','template_name','template_language','variables']);
  uuid(b.source_id);const affected=uuid(b.affected_entity_id??b.source_id),delivery=b.source_kind==='delivery_challenge';
  if(delivery) {uuid(b.delivery_recipient_ref);if(b.customer_id!==undefined)throw new HttpError('VALIDATION_FAILED');}
  else {uuid(b.customer_id);if(b.delivery_recipient_ref!==undefined)throw new HttpError('VALIDATION_FAILED');}
  if(!['event','inbox','delivery_challenge'].includes(String(b.source_kind))||!['updates','requested_assistance','consent_disclosure','delivery_otp'].includes(String(b.purpose))||
    !['text','template'].includes(String(b.format)) || (b.purpose==='updates'?b.source_kind!=='event':b.purpose==='delivery_otp'?b.source_kind!=='delivery_challenge':b.source_kind!=='inbox'))throw new HttpError('VALIDATION_FAILED');
  if(b.purpose==='consent_disclosure') {
    if(b.format!=='text'||b.text!==undefined||b.variables!==undefined||b.template_name!==undefined||b.template_language!==undefined)throw new HttpError('VALIDATION_FAILED');
  } else if(b.format==='text') {
    if(typeof b.text!=='string'||!b.text.trim()||b.text.length>4096||Array.from(b.text).some(c=>c.charCodeAt(0)<32&&!['\n','\r','\t'].includes(c))||
      b.template_name!==undefined||b.template_language!==undefined||b.variables!==undefined)throw new HttpError('VALIDATION_FAILED');
  } else if(typeof b.template_name!=='string'||!namePattern.test(b.template_name)||typeof b.template_language!=='string'||!languagePattern.test(b.template_language)||
    b.text!==undefined||!Array.isArray(b.variables)||b.variables.length>20||b.variables.some(v=>typeof v!=='string'||!v.length||v.length>1024||Array.from(v).some(c=>c.charCodeAt(0)<32)))throw new HttpError('VALIDATION_FAILED');
  return {...b,affected_entity_id:affected} as unknown as ResolvedOutboundInput;
}
export const disclosureText=(business:string)=>`${business}: Reply START UPDATES to this message to receive optional shipment updates from this franchise on WhatsApp. Reply STOP at any time to stop. Your choice does not affect shipment service.`;
/** Policy withdrawal is terminal; configuration can be repaired without changing intent. */
export function policyFailure(reason:string):'failed'|'suppressed' {
  return reason.startsWith('template_')||reason==='installation_unavailable'?'failed':'suppressed';
}
export function outboundFingerprint(config:BusinessWebhookConfig,input:ResolvedOutboundInput) {
  return createHmac('sha256',Buffer.from(config.fingerprint_key,'hex')).update('shipit:outbound:v1\0').update(JSON.stringify([
    input.source_kind,input.source_id,input.affected_entity_id,input.customer_id??null,input.delivery_recipient_ref??null,input.purpose,input.format,input.text??null,input.template_name??null,input.template_language??null,input.variables??null])).digest('hex');
}
export function sealOutbound(config:BusinessWebhookConfig,id:string,input:ResolvedOutboundInput) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(config.encryption_key,'hex'),iv);
  cipher.setAAD(Buffer.from(`shipit:outbound:v1:${config.key_version}:${id}`));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(input)),cipher.final()]);
  return Buffer.concat([iv,encrypted,cipher.getAuthTag()]).toString('base64url');
}
export function openOutbound(config:BusinessWebhookConfig,id:string,keyVersion:string,sealed:string):ResolvedOutboundInput {
  if(config.key_version!==keyVersion)throw new Error('OUTBOUND_KEY_UNAVAILABLE');
  const b=Buffer.from(sealed,'base64url'),cipher=createDecipheriv('aes-256-gcm',Buffer.from(config.encryption_key,'hex'),b.subarray(0,12));
  cipher.setAAD(Buffer.from(`shipit:outbound:v1:${keyVersion}:${id}`));cipher.setAuthTag(b.subarray(-16));
  const value=JSON.parse(Buffer.concat([cipher.update(b.subarray(12,-16)),cipher.final()]).toString('utf8')) as OutboundInput;
  return {...value,affected_entity_id:value.affected_entity_id??value.source_id};
}
export function retryDelay(attempt:number,retryAfter:number|undefined,random=Math.random) {
  const backoff=Math.min(300,2**Math.min(attempt,8))*(0.5+random()*0.5);
  // Do not truncate a long provider wait into an earlier retry. Such waits dead-letter.
  if(retryAfter!==undefined&&(!Number.isFinite(retryAfter)||retryAfter>86400||retryAfter<0))return null;
  return Math.ceil(Math.max(backoff,retryAfter??0));
}
export function sendDecision(outcome:SendOutcome,attempt:number,random=Math.random) {
  if(outcome.kind==='accepted')return {state:'accepted',reason:'provider_accepted',delay:0} as const;
  if(outcome.kind==='uncertain')return {state:'uncertain',reason:'acceptance_unknown',delay:0} as const;
  if(outcome.kind==='retryable_not_accepted') {
    const delay=retryDelay(attempt,outcome.retry_after_seconds,random);
    return attempt>=5||delay===null?{state:'failed',reason:'retry_exhausted',delay:0} as const:{state:'retry_wait',reason:'rate_limited',delay} as const;
  }
  return {state:'failed',reason:outcome.kind==='configuration_failure'?'credential_rejected':'provider_rejected',delay:0} as const;
}
