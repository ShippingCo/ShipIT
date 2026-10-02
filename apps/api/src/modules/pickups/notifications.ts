import { randomUUID } from 'node:crypto';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { outboundInput,outboundFingerprint,sealOutbound } from '../whatsapp/outbound-rules.ts';
import { openInboxPayload } from '../whatsapp/webhook-payload.ts';
import { consentContactKey } from '../whatsapp/consent-worker.ts';
import { pending,state } from '../whatsapp/consent-repository.ts';
import type { WhatsappDependencies,Installation } from '../whatsapp/types.ts';
import type { Outbound } from '../whatsapp/outbound-repository.ts';
import type { Pickup } from './repository.ts';
import { expectations } from './rules.ts';

export async function enqueueDecision(scope:TenantAccess,deps:WhatsappDependencies,p:Pickup,event:string) {
 const config=deps.configuration.webhook!,id=randomUUID(),c=scope.context;
 const text=`Pickup ${p.id}: ${p.state}. ${p.state==='accepted'?`Agreed window ${p.agreed_start!.toISOString()} to ${p.agreed_end!.toISOString()}. `:'Contact the franchise to discuss alternatives. '}${expectations}`;
 const input=outboundInput({source_kind:'pickup',source_id:event,affected_entity_id:p.id,purpose:'requested_assistance',format:'text',text});
 await scopedQuery(scope,['pickups.decide'],`INSERT INTO shipit.whatsapp_outbound
  (id,organization_id,franchise_id,installation_id,contact_key,contact_version,source_id,affected_entity_id,source_kind,purpose,fingerprint,sealed_payload,key_version,expires_at,state,reason_code,correlation_id,pickup_event_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$5,$6,'pickup','requested_assistance',$7,$8,$9,clock_timestamp()+interval '24 hours','queued','pickup_decided',$10,$5 WHERE {{franchise:$11:$2}}`,
 [id,c.permittedFranchiseIds[0],p.installation_id,p.contact_key,event,p.id,outboundFingerprint(config,input),sealOutbound(config,id,input),config.key_version,c.correlationId,c.organizationId]);
}
export async function authorizePickup(scope:TenantAccess,deps:WhatsappDependencies,m:Outbound,i:Installation&{owner_active:boolean},now:Date):Promise<string|null> {
 const config=deps.configuration.webhook;
 if(!deps.configuration.pickup_enabled||!config||!i.owner_active||i.state!=='validated'||!deps.configuration.bindings.some(b=>b.key===i.binding_key&&b.organization_id===i.organization_id&&b.franchise_id===i.franchise_id&&b.waba_id===i.waba_id&&b.phone_number_id===i.phone_number_id&&b.credential_ref===i.credential_ref))return null;
 const row=(await scopedQuery<{contact_key:string;event_key:string;sealed_payload:string;key_version:string;waba_id:string;phone_number_id:string}>(scope,['outbox.work'],`SELECT p.contact_key,j.event_key,j.sealed_payload,j.key_version,i.waba_id,i.phone_number_id
  FROM shipit.pickup_events e JOIN shipit.pickup_requests p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.pickup_id
  JOIN shipit.whatsapp_inbox j ON j.organization_id=p.organization_id AND j.franchise_id=p.franchise_id AND j.id=p.inbox_id
  JOIN shipit.whatsapp_installations i ON i.organization_id=p.organization_id AND i.franchise_id=p.franchise_id AND i.id=p.installation_id
  WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.id=$1 AND p.id=$2 AND p.installation_id=$3 AND p.contact_key=$4
   AND e.version=p.version AND e.event_type='pickup.'||p.state FOR SHARE OF p`,[m.source_id,m.affected_entity_id,i.id,m.contact_key])).rows[0];
 if(!row)return null;
 const consent=await state(scope,i.id,m.contact_key);
 if(consent?.state==='revoked')return null;
 if(await pending(scope,i.id))return 'pending';
 // Free-form replies require a current customer-service window. No guessed template.
 if(!consent?.last_inbound_at||consent.last_inbound_at>now||now.getTime()-consent.last_inbound_at.getTime()>=86400000)return 'window_closed';
 try {
  const payload=openInboxPayload(config,row) as {from?:unknown};
  if(typeof payload.from!=='string'||!/^[1-9][0-9]{7,14}$/.test(payload.from))return null;
  const phone='+'+payload.from;return consentContactKey(config,i.id,phone)===m.contact_key?phone:null;
 }catch{return null;}
}
