import { scopedQuery,type TenantAccess } from '../security/scope.ts';

export type HistoryView='messages'|'automation';
export interface HistoryFilter {status:string|null;kind:string|null;correlation:string|null;source:string|null}
export interface HistoryRow {
 id:string;row_kind:'message'|'decision'|'fanout';effective_time:string;outbound_id:string|null;decision_id:string|null;
 source_id:string;source_kind:string;affected_id:string;customer_id:string|null;correlation_id:string;
 notification_kind:string;policy_id:string|null;policy_version:number|null;outcome:string|null;decision_reason:string|null;
 state:string|null;reason_code:string|null;version:number|null;attempt_count:number;progress:number;failure_observed:boolean;
 observed_at:Date|null;rendering_available:boolean;expires_at:Date|null;active:boolean;
 fanout_id:string|null;item_id:string|null;route_id:string|null;original_event_id:string|null;
 fanout_state:string|null;total_count:number|null;completed_count:number|null;skipped_count:number|null;failed_count:number|null;
}
/** No content, provider identity, keys, envelopes or ciphertext cross this projection. */
export async function rows(scope:TenantAccess,view:HistoryView,filter:HistoryFilter,after:{time:string;id:string}|null,limit:number,id:string|null=null) {
 return (await scopedQuery<HistoryRow>(scope,['whatsapp.consent.read'],`
 SELECT * FROM (WITH candidates AS (SELECT * FROM (
  (SELECT m.organization_id,m.franchise_id,m.id,'message'::text AS row_kind,m.created_at AS effective_time,m.id AS outbound_id,NULL::uuid AS decision_id,NULL::uuid AS fanout_id
  FROM shipit.whatsapp_outbound m WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.franchise_id=$10::uuid AND $1='messages'
   AND ($2::uuid IS NULL OR m.id=$2) AND ($3::timestamptz IS NULL OR (m.created_at,m.id)<($3,$4::uuid))
  ORDER BY m.created_at DESC,m.id DESC LIMIT CASE WHEN $5::text IS NULL AND $6::text IS NULL AND $7::uuid IS NULL AND $8::uuid IS NULL THEN $9::integer ELSE NULL END)
  UNION ALL
  (SELECT d.organization_id,d.franchise_id,d.id,'decision',d.decided_at,d.outbound_intent_id,d.id,NULL::uuid
  FROM shipit.notification_automation_decisions d WHERE {{franchise:d.organization_id:d.franchise_id}} AND d.franchise_id=$10::uuid AND $1='automation'
   AND ($2::uuid IS NULL OR d.id=$2) AND ($3::timestamptz IS NULL OR (d.decided_at,d.id)<($3,$4::uuid))
  ORDER BY d.decided_at DESC,d.id DESC LIMIT CASE WHEN $5::text IS NULL AND $6::text IS NULL AND $7::uuid IS NULL AND $8::uuid IS NULL THEN $9::integer ELSE NULL END)
  UNION ALL
  (SELECT f.organization_id,f.franchise_id,f.id,'fanout',f.created_at,NULL::uuid,NULL::uuid,f.id
  FROM shipit.route_delay_fanouts f WHERE {{franchise:f.organization_id:f.franchise_id}} AND f.franchise_id=$10::uuid AND $1='automation'
   AND ($2::uuid IS NULL OR f.id=$2) AND ($3::timestamptz IS NULL OR (f.created_at,f.id)<($3,$4::uuid))
  ORDER BY f.created_at DESC,f.id DESC LIMIT CASE WHEN $5::text IS NULL AND $6::text IS NULL AND $7::uuid IS NULL AND $8::uuid IS NULL THEN $9::integer ELSE NULL END)
 ) owned_candidates ORDER BY effective_time DESC,id DESC
 LIMIT CASE WHEN $5::text IS NULL AND $6::text IS NULL AND $7::uuid IS NULL AND $8::uuid IS NULL THEN $9::integer ELSE NULL END
 ), projected AS (
 SELECT c.id,c.row_kind,to_char(c.effective_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS effective_time,
 c.effective_time AS sort_time,m.id AS outbound_id,d.id AS decision_id,
 coalesce(d.source_event_id,f.source_identity_id,m.source_id) AS source_id,
 coalesce(d.event_type,f.source_kind,m.source_kind) AS source_kind,
 CASE WHEN c.row_kind='fanout' THEN f.route_id ELSE coalesce(d.affected_entity_id,m.affected_entity_id) END AS affected_id,
 coalesce(d.customer_id,m.customer_id) AS customer_id,coalesce(d.correlation_id,f.correlation_id,m.correlation_id) AS correlation_id,
 coalesce(d.notification_kind,f.purpose,m.purpose) AS notification_kind,
 coalesce(d.policy_id,f.policy_id) AS policy_id,coalesce(d.policy_version,f.policy_version) AS policy_version,
 coalesce(d.outcome,i.outcome) AS outcome,coalesce(d.reason_code,i.reason_code) AS decision_reason,
 CASE WHEN p.progress=3 OR m.state='read' THEN 'read' WHEN p.progress=2 OR m.state='delivered' THEN 'delivered'
  WHEN p.failure_observed AND m.state='accepted' THEN 'failed' ELSE m.state END AS state,
 CASE WHEN p.progress>=2 OR m.state IN ('delivered','read') THEN 'delivery_confirmed'
  WHEN p.failure_observed AND m.state='accepted' THEN 'delivery_failed' ELSE m.reason_code END AS reason_code,
 m.version,coalesce(m.attempts,0) AS attempt_count,coalesce(p.progress,0) AS progress,
 coalesce(p.failure_observed,false) AS failure_observed,p.observed_at,m.sealed_payload IS NOT NULL AS rendering_available,m.expires_at,
 fr.lifecycle='active' AS active,coalesce(f.id,i.fanout_id) AS fanout_id,i.id AS item_id,f.route_id,f.original_event_id,
 f.state AS fanout_state,f.total_count,f.completed_count,f.skipped_count,f.failed_count
 FROM candidates c
 JOIN shipit.franchises fr ON fr.organization_id=c.organization_id AND fr.id=c.franchise_id AND {{franchise:fr.organization_id:fr.id}}
 LEFT JOIN shipit.whatsapp_outbound m ON m.organization_id=c.organization_id AND m.franchise_id=c.franchise_id AND m.id=c.outbound_id AND {{franchise:m.organization_id:m.franchise_id}}
 LEFT JOIN LATERAL (SELECT d.id,d.source_event_id,d.event_type,d.affected_entity_id,d.customer_id,d.correlation_id,d.notification_kind,d.policy_id,d.policy_version,d.outcome,d.reason_code
  FROM shipit.notification_automation_decisions d WHERE {{franchise:d.organization_id:d.franchise_id}}
   AND d.organization_id=c.organization_id AND d.franchise_id=c.franchise_id
   AND (d.id=c.decision_id OR (c.row_kind='message' AND d.source_event_id=m.source_id AND d.outbound_intent_id=m.id))
  ORDER BY d.decided_at,d.id LIMIT 1) d ON true
 LEFT JOIN LATERAL (SELECT i.id,i.fanout_id,i.outcome,i.reason_code FROM shipit.route_delay_fanout_items i
  WHERE {{franchise:i.organization_id:i.franchise_id}} AND i.organization_id=c.organization_id AND i.franchise_id=c.franchise_id
   AND i.source_identity_id=m.source_id AND i.parcel_id=m.affected_entity_id AND i.outbound_intent_id=m.id LIMIT 1) i ON true
 LEFT JOIN shipit.route_delay_fanouts f ON f.organization_id=c.organization_id AND f.franchise_id=c.franchise_id
  AND f.id=coalesce(c.fanout_id,i.fanout_id) AND {{franchise:f.organization_id:f.franchise_id}}
 LEFT JOIN LATERAL (SELECT max(o.progress)::integer AS progress,bool_or(o.failure_observed) AS failure_observed,max(o.last_event_at) AS observed_at
  FROM shipit.whatsapp_outbound_attempts a JOIN shipit.whatsapp_delivery_observations o
   ON o.organization_id=a.organization_id AND o.franchise_id=a.franchise_id AND o.installation_id=a.installation_id AND o.message_id=a.provider_message_id
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND {{franchise:o.organization_id:o.franchise_id}}
   AND a.organization_id=c.organization_id AND a.franchise_id=c.franchise_id AND a.intent_id=m.id) p ON true
 ) SELECT * FROM projected
 WHERE ($5::text IS NULL OR CASE WHEN $1='messages' THEN state ELSE coalesce(outcome,fanout_state) END=$5)
  AND ($6::text IS NULL OR notification_kind=$6) AND ($7::uuid IS NULL OR correlation_id=$7)
  AND ($8::uuid IS NULL OR source_id=$8)
 ORDER BY sort_time DESC,id DESC LIMIT $9) history ORDER BY effective_time DESC,id DESC`,[view,id,after?.time??null,after?.id??null,filter.status,filter.kind,filter.correlation,filter.source,limit+1,scope.context.permittedFranchiseIds[0]])).rows;
}
export async function attempts(scope:TenantAccess,id:string) {
 const rows=(await scopedQuery<{attempt:number;outcome:string;reason_code:string;recorded_at:Date}>(scope,['whatsapp.consent.read'],`
 SELECT a.attempt,a.outcome,a.reason_code,a.recorded_at FROM shipit.whatsapp_outbound_attempts a
 JOIN shipit.whatsapp_outbound m ON m.organization_id=a.organization_id AND m.franchise_id=a.franchise_id AND m.id=a.intent_id
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND {{franchise:m.organization_id:m.franchise_id}} AND m.id=$1
 ORDER BY a.attempt DESC LIMIT 101`,[id])).rows;
 return {attempts:rows.slice(0,100).map(r=>({...r,recorded_at:r.recorded_at.toISOString()})),history_truncated:rows.length>100};
}
