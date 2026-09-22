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
export interface FanoutReadRow {id:string;source_identity_id:string;source_kind:string;original_event_id:string;reminder_event_id:string|null;route_id:string;
  manifest_id:string;manifest_version:number;policy_id:string;policy_version:number;purpose:string;state:string;total_count:number;completed_count:number;
  skipped_count:number;failed_count:number;attempt_count:number;reason_code:string|null;created_at:Date;started_at:Date|null;completed_at:Date|null}
export const fanoutDto=(row:FanoutReadRow)=>({...row,processed_count:row.completed_count+row.skipped_count+row.failed_count,
  created_at:row.created_at.toISOString(),started_at:row.started_at?.toISOString()??null,completed_at:row.completed_at?.toISOString()??null});
const fanoutColumns=`f.id,f.source_identity_id,f.source_kind,f.original_event_id,f.reminder_event_id,f.route_id,f.manifest_id,f.manifest_version,
 f.policy_id,f.policy_version,f.purpose,f.state,f.total_count,f.completed_count,f.skipped_count,f.failed_count,f.attempt_count,f.reason_code,f.created_at,f.started_at,f.completed_at`;
export async function fanouts(scope:TenantAccess,after:string|null,limit:number) {
  return (await scopedQuery<FanoutReadRow>(scope,['whatsapp.consent.read'],`SELECT ${fanoutColumns} FROM shipit.route_delay_fanouts f
    WHERE {{franchise:f.organization_id:f.franchise_id}} AND ($1::uuid IS NULL OR f.id>$1) ORDER BY f.id LIMIT $2`,[after,limit+1])).rows;
}
export async function fanout(scope:TenantAccess,id:string) {
  const root=(await scopedQuery<FanoutReadRow>(scope,['whatsapp.consent.read'],`SELECT ${fanoutColumns} FROM shipit.route_delay_fanouts f
    WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.id=$1`,[id])).rows[0]??null;
  if(!root)return null;
  const items=(await scopedQuery<{parcel_id:string;outcome:string;reason_code:string;outbound_intent_id:string|null;eta_event_id:string|null;decided_at:Date}>(scope,['whatsapp.consent.read'],
    `SELECT i.parcel_id,i.outcome,i.reason_code,i.outbound_intent_id,i.eta_event_id,i.decided_at FROM shipit.route_delay_fanout_items i
     WHERE {{franchise:i.organization_id:i.franchise_id}} AND i.fanout_id=$1 ORDER BY i.parcel_id LIMIT 1001`,[id])).rows;
  if(items.length>1000)throw new Error('ROUTE_DELAY_FANOUT_LIMIT_INVALID');
  return {root,items:items.map(item=>({...item,decided_at:item.decided_at.toISOString()}))};
}
