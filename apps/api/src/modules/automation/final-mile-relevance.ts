import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import type { ResolvedOutboundInput } from '../whatsapp/outbound-rules.ts';

const finalMileEvents=new Set(['delivery.attempt_failed','parcel.rto_approved','delivery.completed']);

/** Returns null for non-#43 intents. The Parcel SHARE lock makes this the final
 * lifecycle linearization point immediately before outbound reservation. */
export async function finalMileRelevance(scope:TenantAccess,input:ResolvedOutboundInput):Promise<boolean|null> {
  if(input.source_kind!=='event'||input.purpose!=='updates')return null;
  const source=(await scopedQuery<{event_type:string}>(scope,['outbox.work'],`SELECT e.event_type FROM shipit.domain_events e
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.event_id=$1 AND e.aggregate_id=$2`,
    [input.source_id,input.affected_entity_id])).rows[0];
  if(!source||!finalMileEvents.has(source.event_type))return null;
  if(source.event_type==='delivery.attempt_failed')return (await scopedQuery<{relevant:boolean}>(scope,['outbox.work'],`SELECT p.status='failed_attempt' AND p.version=e.aggregate_sequence
      AND a.state='failed' AND f.attempt_number=p.failed_attempt_count AND NOT EXISTS(SELECT 1 FROM shipit.delivery_attempts newer
        WHERE {{franchise:newer.organization_id:newer.franchise_id}} AND newer.parcel_id=p.id AND newer.attempt_number>a.attempt_number) AS relevant
    FROM shipit.domain_events e JOIN shipit.parcels p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.aggregate_id
    JOIN shipit.parcel_failed_attempts f ON f.organization_id=e.organization_id AND f.franchise_id=e.franchise_id AND f.id=e.event_id AND f.parcel_id=p.id
    JOIN shipit.delivery_attempts a ON a.organization_id=f.organization_id AND a.franchise_id=f.franchise_id AND a.id=f.attempt_id AND a.parcel_id=p.id
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}}
      AND {{franchise:f.organization_id:f.franchise_id}} AND {{franchise:a.organization_id:a.franchise_id}}
      AND e.event_id=$1 AND e.aggregate_id=$2 AND a.id::text=e.envelope->'payload'->>'attempt_id'
      AND f.reason_code=e.envelope->'payload'->>'failure_reason' FOR SHARE OF p`,[input.source_id,input.affected_entity_id])).rows[0]?.relevant??false;
  if(source.event_type==='parcel.rto_approved')return (await scopedQuery<{relevant:boolean}>(scope,['outbox.work'],`SELECT p.status='rto' AND p.version=e.aggregate_sequence AS relevant
    FROM shipit.domain_events e JOIN shipit.parcels p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.aggregate_id
    JOIN shipit.parcel_rto_approvals r ON r.organization_id=e.organization_id AND r.franchise_id=e.franchise_id AND r.id=e.event_id AND r.parcel_id=p.id
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}} AND {{franchise:r.organization_id:r.franchise_id}}
      AND e.event_id=$1 AND e.aggregate_id=$2 AND r.approval_ref::text=e.envelope->'payload'->>'approval_ref'
      AND r.eligibility_ref::text=e.envelope->'payload'->>'eligibility_ref' AND r.return_plan_ref::text=e.envelope->'payload'->>'return_plan_ref'
    FOR SHARE OF p`,[input.source_id,input.affected_entity_id])).rows[0]?.relevant??false;
  return (await scopedQuery<{relevant:boolean}>(scope,['outbox.work'],`SELECT p.status='delivered' AND p.version=e.aggregate_sequence AND a.state='completed' AS relevant
    FROM shipit.domain_events e JOIN shipit.parcels p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.aggregate_id
    JOIN shipit.delivery_attempts a ON a.organization_id=e.organization_id AND a.franchise_id=e.franchise_id AND a.id::text=e.envelope->'payload'->>'attempt_id' AND a.parcel_id=p.id
    JOIN shipit.delivery_proofs proof ON proof.organization_id=a.organization_id AND proof.franchise_id=a.franchise_id
      AND proof.id::text=e.envelope->'payload'->>'proof_ref' AND proof.attempt_id=a.id AND proof.parcel_id=p.id
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}}
      AND {{franchise:a.organization_id:a.franchise_id}} AND {{franchise:proof.organization_id:proof.franchise_id}}
      AND e.event_id=$1 AND e.aggregate_id=$2 FOR SHARE OF p`,[input.source_id,input.affected_entity_id])).rows[0]?.relevant??false;
}
