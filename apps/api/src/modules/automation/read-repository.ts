import { scopedQuery,type TenantAccess } from '../security/scope.ts';

export interface DecisionRow {id:string;source_event_id:string;event_type:string;policy_id:string;policy_version:number;affected_type:string;
  affected_entity_id:string;booking_id:string;parcel_id:string|null;customer_id:string|null;notification_kind:string;outcome:string;reason_code:string;
  outbound_intent_id:string|null;correlation_id:string;decided_at:Date}
export const dto=(row:DecisionRow)=>({...row,decided_at:row.decided_at.toISOString()});
export async function list(scope:TenantAccess,after:string|null,limit:number) {
  return (await scopedQuery<DecisionRow>(scope,['whatsapp.consent.read'],`SELECT d.id,d.source_event_id,d.event_type,d.policy_id,d.policy_version,d.affected_type,d.affected_entity_id,
    d.booking_id,d.parcel_id,d.customer_id,d.notification_kind,d.outcome,d.reason_code,d.outbound_intent_id,d.correlation_id,d.decided_at
    FROM shipit.notification_automation_decisions d WHERE {{franchise:d.organization_id:d.franchise_id}}
      AND ($1::uuid IS NULL OR d.id>$1) ORDER BY d.id LIMIT $2`,[after,limit+1])).rows;
}
export async function detail(scope:TenantAccess,id:string) {
  return (await scopedQuery<DecisionRow>(scope,['whatsapp.consent.read'],`SELECT d.id,d.source_event_id,d.event_type,d.policy_id,d.policy_version,d.affected_type,d.affected_entity_id,
    d.booking_id,d.parcel_id,d.customer_id,d.notification_kind,d.outcome,d.reason_code,d.outbound_intent_id,d.correlation_id,d.decided_at
    FROM shipit.notification_automation_decisions d WHERE {{franchise:d.organization_id:d.franchise_id}} AND d.id=$1`,[id])).rows[0]??null;
}
