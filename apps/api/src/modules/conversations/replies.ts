import { randomUUID } from 'node:crypto';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { openInboxPayload } from '../whatsapp/webhook-payload.ts';
import { consentContactKey } from '../whatsapp/consent-worker.ts';
import { outboundInput,outboundFingerprint,sealOutbound } from '../whatsapp/outbound-rules.ts';
import type { WhatsappDependencies,Installation } from '../whatsapp/types.ts';
import type { Outbound } from '../whatsapp/outbound-repository.ts';
import type { Provenance } from './repository.ts';
import { read as readQuote,policy as quotePolicy } from '../customer-quotes/repository.ts';

export async function enqueueReply(scope:TenantAccess,dependencies:WhatsappDependencies,inbox:string,installation:string,contact:string,sourceAt:Date,text:string) {
 const config=dependencies.configuration.webhook!,c=scope.context,id=randomUUID();
 const input=outboundInput({source_kind:'conversation',source_id:inbox,purpose:'requested_assistance',format:'text',text});
 await scopedQuery(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.whatsapp_outbound(id,organization_id,franchise_id,installation_id,customer_id,contact_version,contact_key,
  source_id,affected_entity_id,source_kind,purpose,fingerprint,sealed_payload,key_version,expires_at,state,reason_code,correlation_id,conversation_inbox_id)
  SELECT $1,{{organization}},$2,$3,NULL,$4,$5,$4,$4,'conversation','requested_assistance',$6,$7,$8,$9,'queued','requested_channel_verified',$10,$4
  WHERE {{franchise:$11:$2}}`,[id,c.permittedFranchiseIds[0],installation,inbox,contact,outboundFingerprint(config,input),sealOutbound(config,id,input),config.key_version,
  new Date(sourceAt.getTime()+900000),c.correlationId,c.organizationId]);
 return id;
}

/** Reauthorize at dispatch. The reply's recipient comes only from its signed inbox. */
export async function authorizeReply(scope:TenantAccess,dependencies:WhatsappDependencies,m:Outbound,installation:Installation&{owner_active:boolean},now:Date):Promise<string|null> {
 if(!dependencies.configuration.conversation_enabled||!dependencies.configuration.customer_access_enabled||!installation.owner_active||installation.state!=='validated')return null;
 const config=dependencies.configuration.webhook;if(!config)return null;
 const registered=dependencies.configuration.bindings.some(b=>b.key===installation.binding_key&&b.organization_id===installation.organization_id&&b.franchise_id===installation.franchise_id&&
  b.waba_id===installation.waba_id&&b.phone_number_id===installation.phone_number_id&&b.credential_ref===installation.credential_ref);
 if(!registered)return null;
 const row=(await scopedQuery<{waba_id:string;phone_number_id:string;event_key:string;sealed_payload:string;key_version:string;occurred_at:Date;
  provenance:Provenance[];contact_key:string;outcome:string;intent:string;conversation_state:string;conversation_expires:Date;quote_id:string|null}>(scope,['outbox.work'],
  `SELECT i.waba_id,i.phone_number_id,j.event_key,j.sealed_payload,j.key_version,j.occurred_at,t.provenance,t.contact_key,t.outcome,t.intent,
   c.state AS conversation_state,c.expires_at AS conversation_expires,t.quote_id FROM shipit.whatsapp_inbox j
   JOIN shipit.whatsapp_installations i ON i.organization_id=j.organization_id AND i.franchise_id=j.franchise_id AND i.id=j.installation_id
   JOIN shipit.customer_conversation_turns t ON t.organization_id=j.organization_id AND t.franchise_id=j.franchise_id AND t.inbox_id=j.id
   JOIN shipit.whatsapp_consent_receipts r ON r.organization_id=j.organization_id AND r.franchise_id=j.franchise_id AND r.inbox_id=j.id
   LEFT JOIN shipit.customer_conversations c ON c.organization_id=t.organization_id AND c.franchise_id=t.franchise_id AND c.id=t.conversation_id
   WHERE {{franchise:j.organization_id:j.franchise_id}} AND j.id=$1 AND j.installation_id=$2 AND j.state='completed'
    AND r.intent='other' AND r.outcome IN ('unchanged','contact_ambiguous')`,[m.source_id,m.installation_id])).rows[0];
 if(!row||row.contact_key!==m.contact_key||row.occurred_at>now||now.getTime()-row.occurred_at.getTime()>=900000)return null;
 if(row.conversation_state==='human_requested'&&row.conversation_expires>now&&!['human','clarify'].includes(row.intent)&&row.outcome!=='paused')return null;
 const state=(await scopedQuery<{state:string}>(scope,['outbox.work'],`SELECT s.state FROM shipit.whatsapp_consent_state s
  WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.installation_id=$1 AND s.contact_key=$2`,[installation.id,m.contact_key])).rows[0];
 const pending=(await scopedQuery<{pending:boolean}>(scope,['outbox.work'],`SELECT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox j
  WHERE {{franchise:j.organization_id:j.franchise_id}} AND j.installation_id=$1 AND j.kind='inbound'
   AND NOT EXISTS(SELECT 1 FROM shipit.whatsapp_consent_receipts r WHERE r.inbox_id=j.id)) AS pending`,[installation.id])).rows[0]!.pending;
 if(state?.state==='revoked')return null;
 if(pending)return 'pending';
 if(row.intent==='quote'&&!dependencies.configuration.customer_quotes_enabled)return null;
 if(row.quote_id) {
  const quote=await readQuote(scope,row.quote_id,installation.id,m.contact_key),policy=await quotePolicy(scope);
  if(!quote||quote.expires_at<=now||quote.policy_id!==(policy?.id??null)||(!quote.reason&&!policy?.configuration.enabled))return null;
 }
 for(const evidence of [...row.provenance].sort((a,b)=>a.parcel_id.localeCompare(b.parcel_id))) {
  const current=(await scopedQuery(scope,['outbox.work'],`SELECT b.id FROM shipit.customer_access_bindings b
   JOIN shipit.parcels p ON p.organization_id=b.organization_id AND p.franchise_id=b.franchise_id AND p.id=b.parcel_id
   LEFT JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
   WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1 AND b.version=$2 AND b.installation_id=$3 AND b.contact_key=$4
    AND b.expires_at>$5 AND p.id=$6 AND p.version=$7 AND (b.relation='recipient' OR c.contact_version=b.contact_version)
    FOR SHARE OF p,b`,[evidence.binding_id,evidence.binding_version,installation.id,m.contact_key,now,evidence.parcel_id,evidence.parcel_version])).rows[0];
  if(!current)return null;
 }
 try {
  const payload=openInboxPayload(config,row) as {from?:unknown};
  if(typeof payload.from!=='string'||!/^[1-9][0-9]{7,14}$/.test(payload.from))return null;
  const phone='+'+payload.from;
  return consentContactKey(config,installation.id,phone)===m.contact_key?phone:null;
 }catch{return null;}
}
