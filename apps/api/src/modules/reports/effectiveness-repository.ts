import {scopedQuery,type TenantAccess} from '../security/scope.ts';
import {assistantMetricsSql,type MetricRow} from '../conversations/metrics.ts';
import type {SupportHours} from '../support/rules.ts';
import type {AggregateCell} from './effectiveness-rules.ts';
export async function captureEffectiveness(scope:TenantAccess,from:Date,to:Date,hours:SupportHours|undefined) {
  const configured=!!hours?.staffed;
  return (await scopedQuery<{as_of:Date;messaging:AggregateCell[];assistant:MetricRow[];queue:AggregateCell[]}>(scope,['reports.capture'],`
    SELECT statement_timestamp() AS as_of,
      COALESCE((SELECT jsonb_agg(cells ORDER BY category) FROM (
        WITH messages AS (
          SELECT m.id,m.customer_id,COALESCE('customer:'||m.customer_id::text,'contact:'||m.installation_id::text||':'||m.contact_key) AS subject,
            a.recorded_attempts,(a.provider_failure OR p.failure_observed) AS failure_observed,
            CASE WHEN p.progress=3 OR m.state='read' THEN 'read'
              WHEN p.progress>=2 OR m.state='delivered' THEN 'delivered'
              WHEN p.failure_observed AND m.state='accepted' THEN 'provider_failed'
              WHEN m.state='failed' AND a.latest_outcome IN ('permanent_failure','retryable_not_accepted') THEN 'provider_failed'
              WHEN m.state='failed' THEN 'pre_send_failed'
              WHEN p.progress=1 THEN 'sent'
              WHEN m.state='suppressed' AND m.reason_code IN ('consent_revoked','consent_unknown','consent_processing_pending') THEN 'consent_suppressed'
              WHEN m.state='suppressed' THEN 'policy_suppressed'
              WHEN m.state IN ('accepted','canceled','queued','retry_wait','dispatching','uncertain') THEN m.state ELSE 'unclassified' END AS category,
            (p.progress>=2 OR m.state IN ('delivered','read')) AS confirmed
          FROM shipit.whatsapp_outbound m
          CROSS JOIN LATERAL (SELECT count(*)::int recorded_attempts,
            COALESCE(bool_or(a.outcome IN ('permanent_failure','retryable_not_accepted')),false) provider_failure,
            (array_agg(a.outcome ORDER BY a.attempt DESC))[1] latest_outcome
            FROM shipit.whatsapp_outbound_attempts a WHERE {{franchise:a.organization_id:a.franchise_id}}
              AND a.organization_id=m.organization_id AND a.franchise_id=m.franchise_id AND a.intent_id=m.id) a
          CROSS JOIN LATERAL (SELECT COALESCE(max(o.progress),0) progress,COALESCE(bool_or(o.failure_observed),false) failure_observed
            FROM shipit.whatsapp_outbound_attempts a JOIN shipit.whatsapp_delivery_observations o
              ON o.organization_id=a.organization_id AND o.franchise_id=a.franchise_id AND o.installation_id=a.installation_id AND o.message_id=a.provider_message_id
            WHERE {{franchise:a.organization_id:a.franchise_id}} AND {{franchise:o.organization_id:o.franchise_id}}
              AND a.organization_id=m.organization_id AND a.franchise_id=m.franchise_id AND a.intent_id=m.id) p
          WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.created_at >= $1 AND m.created_at < $2
        ) SELECT v.category,CASE WHEN v.category IN ('known_customers','confirmed_customers') THEN count(DISTINCT m.customer_id)::int ELSE sum(v.weight)::int END n,
          count(DISTINCT m.subject)::int subjects FROM messages m
          CROSS JOIN LATERAL (VALUES (m.category,true,1),('logical_intents',true,1),('delivery_unknown',m.category IN ('accepted','sent','queued','retry_wait','dispatching','uncertain','unclassified'),1),
            ('recorded_send_attempts',m.recorded_attempts>0,m.recorded_attempts),('provider_failure_observed',m.failure_observed,1),
            ('known_customers',m.customer_id IS NOT NULL,1),('confirmed_customers',m.customer_id IS NOT NULL AND m.confirmed,1),
            ('unknown_customer_intents',m.customer_id IS NULL,1)) v(category,eligible,weight)
          WHERE v.eligible GROUP BY v.category
      ) cells),'[]'::jsonb) AS messaging,
      COALESCE((SELECT jsonb_agg(cells ORDER BY category) FROM (${assistantMetricsSql}) cells),'[]'::jsonb) AS assistant,
      COALESCE((SELECT jsonb_agg(cells ORDER BY category) FROM (
        WITH active AS (
          SELECT c.id,c.state,c.conversation_id,CASE WHEN $7::boolean AND anchor.at IS NOT NULL AND anchor.at<=statement_timestamp()
            THEN elapsed.minutes ELSE NULL END AS business_minutes
          FROM shipit.support_cases c
          LEFT JOIN LATERAL (SELECT max(e.occurred_at) at FROM shipit.support_events e
            WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.organization_id=c.organization_id AND e.franchise_id=c.franchise_id
              AND e.case_id=c.id AND e.event_type IN ('opened','reopened')) anchor ON true
          LEFT JOIN LATERAL (SELECT COALESCE(sum(GREATEST(0,extract(epoch FROM
              LEAST(statement_timestamp(),(d.day+make_interval(mins=>$5::int)) AT TIME ZONE $3::text)
              -GREATEST(anchor.at,(d.day+make_interval(mins=>$4::int)) AT TIME ZONE $3::text)))),0)/60 minutes
            FROM generate_series(date_trunc('day',anchor.at AT TIME ZONE $3::text),
              date_trunc('day',statement_timestamp() AT TIME ZONE $3::text),interval '1 day') d(day)
            WHERE extract(dow FROM d.day)::int=ANY($6::int[]) AND $7::boolean AND anchor.at<=statement_timestamp()) elapsed ON true
          WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.state IN ('open','claimed')
        ) SELECT v.category,count(*)::int n,count(DISTINCT a.conversation_id)::int subjects,
          avg(a.business_minutes)::double precision business_minutes,
          count(DISTINCT a.conversation_id) FILTER(WHERE a.business_minutes IS NOT NULL)::int age_subjects,
          count(*) FILTER(WHERE a.business_minutes IS NULL)::int unknown_age
          FROM active a CROSS JOIN LATERAL (VALUES (a.state,true),('all_active',true),('age_unknown',a.business_minutes IS NULL)) v(category,eligible)
          WHERE v.eligible GROUP BY v.category
      ) cells),'[]'::jsonb) AS queue`,[from,to,hours?.timezone??'UTC',hours?.start_minute??0,hours?.end_minute??1440,hours?.weekdays??[],configured])).rows[0]!;
}
