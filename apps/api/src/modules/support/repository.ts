import { randomUUID } from 'node:crypto';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { sealOutbound,openOutbound } from '../whatsapp/outbound-rules.ts';
import type { WhatsappDependencies } from '../whatsapp/types.ts';
export interface Case {id:string;conversation_id:string;installation_id:string;contact_key:string;inbox_id:string;parcel_id:string|null;reason:string;state:'open'|'claimed'|'resolved';assigned_staff_id:string|null;version:number;created_at:Date;updated_at:Date}
export const summary=(c:Case)=>({id:c.id,state:c.state,reason:c.reason,assigned_staff_id:c.assigned_staff_id,version:c.version,created_at:c.created_at.toISOString(),updated_at:c.updated_at.toISOString()});
export async function get(scope:TenantAccess,id:string,lock=false) {
 return (await scopedQuery<Case>(scope,['support.read','support.write','whatsapp.inbox.work','outbox.work'],`SELECT c.* FROM shipit.support_cases c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows[0];
}
export async function active(scope:TenantAccess,conversation:string) {
 return (await scopedQuery<Case>(scope,['support.read','support.write','whatsapp.inbox.work','outbox.work'],`SELECT c.* FROM shipit.support_cases c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.conversation_id=$1 AND c.state<>'resolved' FOR UPDATE`,[conversation])).rows[0];
}
export async function event(scope:TenantAccess,c:Case,type:string,reason:string,deps?:WhatsappDependencies,text?:string|null) {
 const id=randomUUID(),x=scope.context,config=deps?.configuration.webhook;
 const sealed=text&&config?sealOutbound(config,id,{source_kind:'support',source_id:id,affected_entity_id:c.id,purpose:'requested_assistance',format:'text',text}):null;
 await scopedQuery(scope,['support.write','whatsapp.inbox.work'],`INSERT INTO shipit.support_events(id,organization_id,franchise_id,case_id,event_type,reason,version,actor_type,actor_id,correlation_id,sealed_payload,key_version)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}}`,[id,x.permittedFranchiseIds[0],c.id,type,reason,c.version,x.actor.type,x.actor.id,x.correlationId,sealed,sealed?config!.key_version:null,x.organizationId]);
 return id;
}
export async function open(scope:TenantAccess,source:{conversation:string;installation:string;contact:string;inbox:string;parcel:string|null;reason:string}) {
 const existing=await active(scope,source.conversation);
 if(existing){await touch(scope,existing.id,source.inbox);return {value:existing,created:false};}
 const x=scope.context,id=randomUUID();
 const value=(await scopedQuery<Case>(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.support_cases(id,organization_id,franchise_id,conversation_id,installation_id,contact_key,inbox_id,parcel_id,reason)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}} RETURNING *`,[id,x.permittedFranchiseIds[0],source.conversation,source.installation,source.contact,source.inbox,source.parcel,source.reason,x.organizationId])).rows[0]!;
 await event(scope,value,'opened',source.reason);return {value,created:true};
}
export async function touch(scope:TenantAccess,id:string,inbox:string) {
 await scopedQuery(scope,['whatsapp.inbox.work'],`UPDATE shipit.support_cases c SET inbox_id=$2,updated_at=clock_timestamp() WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1`,[id,inbox]);
}
export function privateText(deps:WhatsappDependencies,row:{id:string;sealed_payload:string|null;key_version:string|null}):string|null {
 if(!row.sealed_payload)return null;
 try{return openOutbound(deps.configuration.webhook!,row.id,row.key_version!,row.sealed_payload).text??null;}catch{return '[Private text unavailable]';}
}
