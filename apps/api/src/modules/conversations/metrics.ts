import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withWhatsappScope } from '../memberships/service.ts';
import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { object,uuid } from '../pricing/validation.ts';
import { categories } from './outcomes.ts';

export const metricNames=[...categories,'unmeasured','abandonment','case_opened','case_resolved','case_reopened','reply_failed','reply_pending','interpretation_pending','interpretation_failed','interpretation_provider_failed','failure_authorization','failure_missing_data','failure_dependency','failure_interpretation','failure_invalid_input','failure_stale'] as const;
export interface MetricRow {category:string;events:string;conversations:string;latency_ms:number|null}
/** Fixed closed UTC weeks prevent arbitrary customer/time filters and overlapping windows. */
export function metricWindow(value:unknown,now=new Date()) {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new HttpError('VALIDATION_FAILED');
 const from=new Date(value+'T00:00:00.000Z'),to=new Date(from.getTime()+7*86400000);
 if(!Number.isFinite(from.getTime())||from.toISOString().slice(0,10)!==value||from.getUTCDay()!==1||to.getTime()+900000>now.getTime()||now.getTime()-from.getTime()>371*86400000)throw new HttpError('VALIDATION_FAILED');
 return {from,to};
}
/** Internal aggregate SQL reused in one-statement report capture; no transcript projection. */
export const assistantMetricsSql=`SELECT * FROM (WITH turns AS (
  SELECT t.inbox_id,t.conversation_id,t.intent,t.metric_category,t.metric_reason,t.metric_latency_ms,t.recorded_at
  FROM shipit.customer_conversation_turns t WHERE {{franchise:t.organization_id:t.franchise_id}}
   AND t.recorded_at >= $1::timestamptz-interval '15 minutes' AND t.recorded_at < $2::timestamptz+interval '15 minutes'
 ), events AS (
  SELECT t.metric_category AS category,t.conversation_id,t.metric_latency_ms AS latency_ms FROM turns t WHERE t.recorded_at >= $1 AND t.recorded_at < $2
  UNION ALL
  SELECT 'failure_'||t.metric_reason,t.conversation_id,NULL FROM turns t WHERE t.recorded_at >= $1 AND t.recorded_at < $2 AND t.metric_category='failure'
  UNION ALL
  SELECT 'abandonment',t.conversation_id,NULL FROM turns t
   WHERE t.metric_category='clarification' AND t.recorded_at+interval '15 minutes'>=$1 AND t.recorded_at+interval '15 minutes'<$2
   AND NOT EXISTS(SELECT 1 FROM turns n WHERE n.conversation_id=t.conversation_id
    AND (n.recorded_at,n.inbox_id)>(t.recorded_at,t.inbox_id) AND n.recorded_at<=t.recorded_at+interval '15 minutes')
  UNION ALL
  SELECT 'case_'||e.event_type,c.conversation_id,NULL FROM shipit.support_events e
   JOIN shipit.support_cases c ON c.organization_id=e.organization_id AND c.franchise_id=e.franchise_id AND c.id=e.case_id
   WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.event_type IN ('opened','resolved','reopened') AND e.occurred_at >= $1 AND e.occurred_at < $2
  UNION ALL
  SELECT CASE WHEN m.state IN ('failed','suppressed','canceled') THEN 'reply_failed' ELSE 'reply_pending' END,t.conversation_id,NULL
   FROM shipit.whatsapp_outbound m JOIN shipit.customer_conversation_turns t ON t.organization_id=m.organization_id AND t.franchise_id=m.franchise_id AND t.inbox_id=m.conversation_inbox_id
   WHERE {{franchise:m.organization_id:m.franchise_id}} AND t.recorded_at >= $1 AND t.recorded_at < $2 AND m.state NOT IN ('accepted','delivered','read')
  UNION ALL
  SELECT CASE WHEN a.state='reserved' THEN 'interpretation_pending' WHEN a.state IN ('uncertain','invalid') THEN 'interpretation_failed' ELSE 'interpretation_provider_failed' END,t.conversation_id,NULL
   FROM shipit.conversation_inferences a JOIN shipit.customer_conversation_turns t ON t.organization_id=a.organization_id AND t.franchise_id=a.franchise_id AND t.inbox_id=a.inbox_id
   WHERE {{franchise:a.organization_id:a.franchise_id}} AND t.recorded_at >= $1 AND t.recorded_at < $2 AND a.state<>'interpreted'
 ) SELECT category,count(*)::text AS events,count(DISTINCT conversation_id)::text AS conversations,
  round(avg(latency_ms))::integer AS latency_ms FROM events GROUP BY category) metrics ORDER BY category`;
/** One source ID per stream: turn inbox, support event or expired clarification anchor.
 * These are projections of durable events, never increment-on-retry counters.
 * No payload, phone, docket, contact digest or free-form reason leaves the database.
 */
export async function metricRows(scope:TenantAccess,from:Date,to:Date) {
 return (await scopedQuery<MetricRow>(scope,['support.read'],`SELECT metrics.* FROM shipit.franchises f
  CROSS JOIN LATERAL (${assistantMetricsSql}) metrics WHERE {{franchise:f.organization_id:f.id}} ORDER BY metrics.category`,[from,to])).rows;
}
export function publicMetrics(rows:MetricRow[]) {
 // No total or complementary subtotal can reconstruct a suppressed cell.
 const hiddenFailure=rows.some(r=>r.category.startsWith('failure_')&&Number(r.conversations)<5);
 return metricNames.map(category=>{
  const row=rows.find(r=>r.category===category),suppressed=!!row&&(Number(row.conversations)<5||(category==='failure'&&hiddenFailure));
  return {category,suppressed,events:suppressed?null:Number(row?.events??0),latency_ms:suppressed?null:row?.latency_ms??null};
 });
}
export function createAssistantMetrics(database:DatabasePool) {
 return async(token:string,query:unknown,correlation:string)=>{
  const q=object(query,['organization_id','franchise_id','week']),org=uuid(q.organization_id),franchise=uuid(q.franchise_id),{from,to}=metricWindow(q.week);
  return withWhatsappScope(database,token,org,franchise,'support.read',correlation,async scope=>({
   definition_version:1,week:from.toISOString().slice(0,10),minimum_conversations:5,
   items:publicMetrics(await metricRows(scope,from,to)),
  }));
 };
}
