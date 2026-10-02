import { randomUUID } from 'node:crypto';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { outboundInput,outboundFingerprint,sealOutbound } from '../whatsapp/outbound-rules.ts';
import { openInboxPayload } from '../whatsapp/webhook-payload.ts';
import { consentContactKey } from '../whatsapp/consent-worker.ts';
import { pending,state } from '../whatsapp/consent-repository.ts';
import type { WhatsappDependencies,Installation } from '../whatsapp/types.ts';
import type { Outbound } from '../whatsapp/outbound-repository.ts';
import type { Case } from './repository.ts';
export async function enqueue(scope:TenantAccess,deps:WhatsappDependencies,c:Case,event:string,text:string) {
 const config=deps.configuration.webhook!,id=randomUUID(),x=scope.context;
 const input=outboundInput({source_kind:'support',source_id:event,affected_entity_id:c.id,purpose:'requested_assistance',format:'text',text});
 const consent=(await scopedQuery<{last_inbound_at:Date}>(scope,['support.write'],`SELECT s.last_inbound_at FROM shipit.whatsapp_consent_state s WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.installation_id=$1 AND s.contact_key=$2`,[c.installation_id,c.contact_key])).rows[0],now=new Date();
 const blocked=!consent?.last_inbound_at||consent.last_inbound_at>now||now.getTime()-consent.last_inbound_at.getTime()>=86400000;
 await scopedQuery(scope,['support.write'],`INSERT INTO shipit.whatsapp_outbound
 (id,organization_id,franchise_id,installation_id,contact_key,contact_version,source_id,affected_entity_id,source_kind,purpose,fingerprint,sealed_payload,key_version,expires_at,state,reason_code,correlation_id,support_event_id)
 SELECT $1,{{organization}},$2,$3,$4,$5,$5,$6,'support','requested_assistance',$7,$8,$9,clock_timestamp()+interval '24 hours',$10,$11,$12,$5 WHERE {{franchise:$13:$2}}`,
 [id,x.permittedFranchiseIds[0],c.installation_id,c.contact_key,event,c.id,outboundFingerprint(config,input),sealOutbound(config,id,input),config.key_version,
  blocked?'failed':'queued',blocked?'customer_window_closed':'staff_response_queued',x.correlationId,x.organizationId]);
 return {id,state:blocked?'failed':'queued',reason_code:blocked?'customer_window_closed':'staff_response_queued'};
}
export async function authorize(scope:TenantAccess,deps:WhatsappDependencies,m:Outbound,i:Installation&{owner_active:boolean},now:Date):Promise<string|null> {
 const config=deps.configuration.webhook;
 if(!deps.configuration.support_enabled||!config||!i.owner_active||i.state!=='validated'||!deps.configuration.bindings.some(b=>b.key===i.binding_key&&b.organization_id===i.organization_id&&b.franchise_id===i.franchise_id&&b.waba_id===i.waba_id&&b.phone_number_id===i.phone_number_id&&b.credential_ref===i.credential_ref))return null;
 const row=(await scopedQuery<{event_key:string;sealed_payload:string;key_version:string;waba_id:string;phone_number_id:string}>(scope,['outbox.work'],`SELECT j.event_key,j.sealed_payload,j.key_version,i.waba_id,i.phone_number_id
 FROM shipit.support_events e JOIN shipit.support_cases c ON c.organization_id=e.organization_id AND c.franchise_id=e.franchise_id AND c.id=e.case_id
 JOIN shipit.whatsapp_inbox j ON j.organization_id=c.organization_id AND j.franchise_id=c.franchise_id AND j.id=c.inbox_id
 JOIN shipit.whatsapp_installations i ON i.organization_id=c.organization_id AND i.franchise_id=c.franchise_id AND i.id=c.installation_id
 WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.id=$1 AND c.id=$2 AND c.installation_id=$3 AND c.contact_key=$4
 AND e.event_type='responded' AND c.state='claimed' AND c.assigned_staff_id::text=e.actor_id
 AND NOT EXISTS(SELECT 1 FROM shipit.support_events later WHERE later.organization_id=e.organization_id AND later.franchise_id=e.franchise_id
  AND later.case_id=e.case_id AND later.version>e.version AND later.event_type IN ('assigned','resolved','reopened'))
 AND EXISTS(SELECT 1 FROM shipit.memberships member JOIN shipit.membership_franchise_scopes s ON s.organization_id=member.organization_id AND s.membership_id=member.id
  WHERE member.organization_id=c.organization_id AND s.franchise_id=c.franchise_id AND member.user_id=c.assigned_staff_id AND member.lifecycle='active' AND member.role IN ('franchise_admin','operator'))
 FOR SHARE OF c`,[m.source_id,m.affected_entity_id,i.id,m.contact_key])).rows[0];
 if(!row)return null;
 const consent=await state(scope,i.id,m.contact_key);
 if(consent?.state==='revoked')return null;
 if(await pending(scope,i.id))return 'pending';
 if(!consent?.last_inbound_at||consent.last_inbound_at>now||now.getTime()-consent.last_inbound_at.getTime()>=86400000)return 'window_closed';
 try{const payload=openInboxPayload(config,row) as {from?:unknown};if(typeof payload.from!=='string'||!/^[1-9][0-9]{7,14}$/.test(payload.from))return null;
  const phone='+'+payload.from;return consentContactKey(config,i.id,phone)===m.contact_key?phone:null;
 }catch{return null;}
}
