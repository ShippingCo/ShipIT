import { randomUUID } from 'node:crypto';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import type { Intent,Tool } from './router.ts';
import type { Binding } from '../customer-access/repository.ts';

export interface Conversation {id:string;selected_docket:string|null;pending_intent:Tool|null;state:'active'|'human_requested';expires_at:Date;version:number}
export interface Provenance {binding_id:string;binding_version:number;parcel_id:string;parcel_version:number}
export type Outcome='answered'|'selection_required'|'not_found'|'forbidden'|'unavailable'|'human_requested'|'paused'|'consent'|'stale'|'invalid';
export async function source(scope:TenantAccess,id:string) {
 await scopedQuery(scope,['whatsapp.inbox.work'],`SELECT o.id FROM shipit.organizations o WHERE {{organization:o.id}} FOR SHARE`);
 await scopedQuery(scope,['whatsapp.inbox.work'],`SELECT f.id FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}} FOR SHARE`);
 return (await scopedQuery<{installation_id:string;waba_id:string;phone_number_id:string;event_key:string;sealed_payload:string;key_version:string;occurred_at:Date;now:Date;owner_active:boolean;consent_intent:string;consent_outcome:string}>(scope,['whatsapp.inbox.work'],
  `SELECT j.installation_id,i.waba_id,i.phone_number_id,j.event_key,j.sealed_payload,j.key_version,j.occurred_at,clock_timestamp() AS now,
   i.state='validated' AND f.lifecycle='active' AND o.lifecycle='active' AS owner_active,r.intent AS consent_intent,r.outcome AS consent_outcome
   FROM shipit.whatsapp_inbox j JOIN shipit.whatsapp_installations i ON i.organization_id=j.organization_id AND i.franchise_id=j.franchise_id AND i.id=j.installation_id
   JOIN shipit.franchises f ON f.organization_id=i.organization_id AND f.id=i.franchise_id JOIN shipit.organizations o ON o.id=i.organization_id
   JOIN shipit.whatsapp_consent_receipts r ON r.organization_id=j.organization_id AND r.franchise_id=j.franchise_id AND r.inbox_id=j.id
   WHERE {{franchise:j.organization_id:j.franchise_id}} AND j.id=$1 AND j.kind='inbound' AND j.state='completed' FOR UPDATE OF i`,[id])).rows[0]!;
}
export async function conversation(scope:TenantAccess,installation:string,contact:string,now:Date) {
 const c=scope.context;
 await scopedQuery(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.customer_conversations(id,organization_id,franchise_id,installation_id,contact_key,expires_at)
  SELECT $1,{{organization}},$2,$3,$4,$5 WHERE {{franchise:$6:$2}} ON CONFLICT(installation_id,contact_key) DO NOTHING`,
 [randomUUID(),c.permittedFranchiseIds[0],installation,contact,new Date(now.getTime()+900000),c.organizationId]);
 return (await scopedQuery<Conversation>(scope,['whatsapp.inbox.work'],`SELECT c.id,c.selected_docket,c.pending_intent,c.state,c.expires_at,c.version
  FROM shipit.customer_conversations c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.installation_id=$1 AND c.contact_key=$2 FOR UPDATE`,[installation,contact])).rows[0]!;
}
export async function consentRevoked(scope:TenantAccess,installation:string,contact:string) {
 return (await scopedQuery<{state:string}>(scope,['whatsapp.inbox.work'],`SELECT s.state FROM shipit.whatsapp_consent_state s
  WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.installation_id=$1 AND s.contact_key=$2`,[installation,contact])).rows[0]?.state==='revoked';
}
export async function advance(scope:TenantAccess,c:Conversation,selection:string|null,pending:Tool|null,state:Conversation['state'],now:Date) {
 await scopedQuery(scope,['whatsapp.inbox.work'],`UPDATE shipit.customer_conversations c SET selected_docket=$2,pending_intent=$3,state=$4,expires_at=$5,version=version+1
  WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 AND c.version=$6`,[c.id,selection,pending,state,new Date(now.getTime()+900000),c.version]);
}
export async function record(scope:TenantAccess,inbox:string,installation:string,contact:string|null,c:Conversation|null,intent:Intent,outcome:Outcome,provenance:Provenance[]) {
 const x=scope.context;
 await scopedQuery(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.customer_conversation_turns(inbox_id,organization_id,franchise_id,installation_id,contact_key,conversation_id,intent,outcome,provenance,correlation_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,[inbox,x.permittedFranchiseIds[0],installation,contact,c?.id??null,intent,outcome,JSON.stringify(provenance),x.correlationId,x.organizationId]);
}
export async function shipment(scope:TenantAccess,b:Binding) {
 // Recheck the selected binding under a row lock before any read or side effect.
 return (await scopedQuery<{id:string;docket:string;version:number;booking_id:string}>(scope,['whatsapp.inbox.work'],`SELECT p.id,p.docket,p.version,p.booking_id
  FROM shipit.customer_access_bindings b JOIN shipit.parcels p ON p.organization_id=b.organization_id AND p.franchise_id=b.franchise_id AND p.id=b.parcel_id
  LEFT JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
  WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1 AND b.version=$2 AND b.expires_at>clock_timestamp()
   AND (b.relation='recipient' OR c.contact_version=b.contact_version) FOR UPDATE OF p FOR SHARE OF b`,[b.id,b.version])).rows[0];
}
export async function history(scope:TenantAccess,conversation:string) {
 return (await scopedQuery(scope,['whatsapp.inbox.work'],`SELECT t.intent,t.outcome,t.recorded_at FROM shipit.customer_conversation_turns t
  WHERE {{franchise:t.organization_id:t.franchise_id}} AND t.conversation_id=$1 ORDER BY t.recorded_at DESC,t.inbox_id DESC LIMIT 20`,[conversation])).rows;
}
