import { randomUUID } from 'node:crypto';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import type { PickupDraft } from './rules.ts';

export interface Pickup {id:string;installation_id:string;contact_key:string;quote_id:string;inbox_id:string;request_key:string;address:string;
 window_start:Date;window_end:Date;review_reason:string|null;state:string;version:number;assigned_staff_id:string|null;agreed_start:Date|null;agreed_end:Date|null;created_at:Date}
export async function get(scope:TenantAccess,id:string,lock=false) {
 return (await scopedQuery<Pickup>(scope,['pickups.read','pickups.decide','whatsapp.inbox.work','outbox.work'],`SELECT p.* FROM shipit.pickup_requests p WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 ${lock?'FOR UPDATE':''}`,[id])).rows[0];
}
export async function draft(scope:TenantAccess,conversation:string,value:PickupDraft|null) {
 await scopedQuery(scope,['whatsapp.inbox.work'],`UPDATE shipit.customer_conversations c SET pickup_draft=$2 WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1`,[conversation,value]);
}
export async function event(scope:TenantAccess,p:Pickup,type:string) {
 const c=scope.context,id=randomUUID();
 await scopedQuery(scope,['pickups.decide','whatsapp.inbox.work'],`INSERT INTO shipit.pickup_events(id,organization_id,franchise_id,pickup_id,event_type,version,actor_type,actor_id,correlation_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,
 [id,c.permittedFranchiseIds[0],p.id,type,p.version,c.actor.type,c.actor.id,c.correlationId,c.organizationId]);
 return id;
}
export async function change(scope:TenantAccess,p:Pickup,state:string,staff:string|null,start:string|null,end:string|null) {
 return (await scopedQuery<Pickup>(scope,['pickups.decide','whatsapp.inbox.work'],`UPDATE shipit.pickup_requests p SET state=$2,version=version+1,assigned_staff_id=$3,agreed_start=$4,agreed_end=$5,updated_at=clock_timestamp()
  WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 AND p.version=$6 AND p.state='submitted' RETURNING p.*`,[p.id,state,staff,start,end,p.version])).rows[0]!;
}
export function summary(p:Pickup) {
 return {id:p.id,state:p.state,version:p.version,review_reason:p.review_reason,requested_window:{start:p.window_start,end:p.window_end},
  agreed_window:p.agreed_start?{start:p.agreed_start,end:p.agreed_end}:null};
}
export async function notification(scope:TenantAccess,id:string) {
 return (await scopedQuery(scope,['pickups.read','pickups.decide'],`SELECT m.id,m.state,m.reason_code,m.version,m.attempts,m.created_at FROM shipit.whatsapp_outbound m
  WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.source_kind='pickup' AND m.affected_entity_id=$1 ORDER BY m.created_at DESC LIMIT 1`,[id])).rows[0]??null;
}
