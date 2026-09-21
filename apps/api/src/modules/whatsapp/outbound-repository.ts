import { scopedQuery, type TenantAccess } from '../security/scope.ts';
import type { OutboundInput,ResolvedOutboundInput } from './outbound-rules.ts';

export interface Outbound {
 id:string;organization_id:string;franchise_id:string;installation_id:string;customer_id:string;contact_version:string;contact_key:string;
 source_id:string;affected_entity_id:string;source_kind:'event'|'inbox';purpose:OutboundInput['purpose'];fingerprint:string;sealed_payload:string|null;key_version:string;expires_at:Date;
 state:string;reason_code:string;version:number;attempts:number;cycle_attempts:number;attempt_id:string|null;lease_until:Date|null;available_at:Date;created_at:Date;
}
type MessageSummary=Pick<Outbound,'id'|'state'|'reason_code'|'version'|'attempts'|'cycle_attempts'|'created_at'|'available_at'|'expires_at'>;
export const safeMessage=(m:MessageSummary)=>({id:m.id,state:m.state,reason_code:m.reason_code,version:m.version,attempts:m.attempts,
 cycle_attempts:m.cycle_attempts,created_at:m.created_at,available_at:m.available_at,expires_at:m.expires_at});
export async function prior(scope:TenantAccess,input:ResolvedOutboundInput) {
 return (await scopedQuery<Outbound>(scope,['outbox.work'],`SELECT m.* FROM shipit.whatsapp_outbound m
 WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.source_kind=$1 AND m.source_id=$2 AND m.affected_entity_id=$3 AND m.customer_id=$4 AND m.purpose=$5`,
 [input.source_kind,input.source_id,input.affected_entity_id,input.customer_id,input.purpose])).rows[0];
}
export async function sourceValid(scope:TenantAccess,input:ResolvedOutboundInput) {
 if(input.source_kind==='inbox')return (await scopedQuery(scope,['outbox.work'],`SELECT r.inbox_id FROM shipit.whatsapp_consent_receipts r
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.inbox_id=$1 AND r.customer_id=$2 AND r.intent='other' AND r.outcome='unchanged'`,[input.source_id,input.customer_id])).rows.length===1;
 const direct=(await scopedQuery(scope,['outbox.work'],`SELECT e.event_id FROM shipit.domain_events e JOIN shipit.bookings b
 ON b.organization_id=e.organization_id AND b.franchise_id=e.franchise_id
 JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
 WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:b.organization_id:b.franchise_id}}
 AND {{franchise:c.organization_id:c.franchise_id}} AND b.customer_snapshot->>'phone'=c.phone_normalized
 AND e.event_id=$1 AND b.customer_id=$2 AND ($3=$1 OR b.id=$3 OR EXISTS(SELECT 1 FROM shipit.parcels p
 WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.booking_id=b.id AND p.id=$3))
 AND (e.aggregate_id=b.id OR e.envelope->'payload'->>'booking_id'=b.id::text OR
 EXISTS(SELECT 1 FROM shipit.parcels p WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.booking_id=b.id AND
   p.id=e.aggregate_id)) LIMIT 1`,[input.source_id,input.customer_id,input.affected_entity_id])).rows.length===1;
 if(direct||input.affected_entity_id===input.source_id)return direct;
 return (await scopedQuery(scope,['outbox.work'],`SELECT e.event_id FROM shipit.domain_events e JOIN shipit.route_parcel_effects x
   ON x.organization_id=e.organization_id AND x.franchise_id=e.franchise_id AND x.event_id=e.event_id AND x.parcel_id=$3
  JOIN shipit.bookings b ON b.organization_id=x.organization_id AND b.franchise_id=x.franchise_id AND b.id=x.booking_id
  JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
  WHERE {{franchise:e.organization_id:e.franchise_id}} AND {{franchise:x.organization_id:x.franchise_id}}
   AND {{franchise:b.organization_id:b.franchise_id}} AND {{franchise:c.organization_id:c.franchise_id}}
   AND e.event_id=$1 AND b.customer_id=$2 AND b.customer_snapshot->>'phone'=c.phone_normalized LIMIT 1`,
 [input.source_id,input.customer_id,input.affected_entity_id])).rows.length===1;
}
export async function businessName(scope:TenantAccess) {
 return (await scopedQuery<{display_name:string}>(scope,['outbox.work'],`SELECT f.display_name FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}`)).rows[0]!.display_name;
}
export async function insert(scope:TenantAccess,values:readonly unknown[]) {
 const c=scope.context;
 return (await scopedQuery<Outbound>(scope,['outbox.work'],`INSERT INTO shipit.whatsapp_outbound(id,installation_id,customer_id,contact_version,contact_key,source_id,affected_entity_id,source_kind,purpose,
 fingerprint,sealed_payload,key_version,expires_at,disclosure_hash,state,reason_code,organization_id,franchise_id,correlation_id)
 SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::uuid,$7::uuid,$8::text,$9::text,$10::text,$11::text,$12::text,$13::timestamptz,$14::text,$15::text,$16::text,$17::uuid,$18::uuid,$19::uuid
 WHERE {{franchise:$17:$18}} ON CONFLICT(organization_id,franchise_id,source_kind,source_id,affected_entity_id,customer_id,purpose) DO NOTHING RETURNING *`,[...values,c.organizationId,c.permittedFranchiseIds[0],c.correlationId])).rows[0];
}
export async function lock(scope:TenantAccess,id:string) {
 return (await scopedQuery<Outbound>(scope,['outbox.work','outbox.redrive'],`SELECT m.* FROM shipit.whatsapp_outbound m
 WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.id=$1 FOR UPDATE`,[id])).rows[0];
}
export async function now(scope:TenantAccess,override?:Date) {
 return override??(await scopedQuery<{now:Date}>(scope,['outbox.work'],`SELECT clock_timestamp() AS now WHERE {{franchise:$1:$2}}`,
 [scope.context.organizationId,scope.context.permittedFranchiseIds[0]])).rows[0]!.now;
}
export async function update(scope:TenantAccess,m:Outbound,state:string,reason:string,instant:Date,options:{attempt?:string;delay?:number;purge?:boolean;reset?:boolean}={}) {
 return (await scopedQuery<Outbound>(scope,['outbox.work','outbox.redrive'],`UPDATE shipit.whatsapp_outbound m SET state=$2,reason_code=$3,version=version+1,
 attempts=attempts+CASE WHEN $5::uuid IS NULL THEN 0 ELSE 1 END,
 cycle_attempts=CASE WHEN $8 THEN 0 ELSE cycle_attempts+CASE WHEN $5::uuid IS NULL THEN 0 ELSE 1 END END,
 attempt_id=coalesce($5::uuid,attempt_id),lease_until=CASE WHEN $2='dispatching' THEN $4::timestamptz+interval '30 seconds' ELSE NULL END,
 available_at=$4::timestamptz+($6::integer*interval '1 second'),sealed_payload=CASE WHEN $7 THEN NULL ELSE sealed_payload END
 WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.id=$1 RETURNING *`,
 [m.id,state,reason,instant,options.attempt??null,options.delay??0,options.purge??false,options.reset??false])).rows[0]!;
}
export async function attempt(scope:TenantAccess,m:Outbound,outcome:string,reason:string,providerId:string|null) {
 const c=scope.context;
 await scopedQuery(scope,['outbox.work'],`INSERT INTO shipit.whatsapp_outbound_attempts(id,organization_id,franchise_id,intent_id,installation_id,attempt,outcome,reason_code,provider_message_id)
 SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::integer,$7::text,$8::text,$9::text WHERE {{franchise:$2:$3}} ON CONFLICT(id) DO NOTHING`,
 [m.attempt_id,c.organizationId,c.permittedFranchiseIds[0],m.id,m.installation_id,m.attempts,outcome,reason,providerId]);
}
export async function observation(scope:TenantAccess,id:string) {
 return (await scopedQuery<{progress:number;failed:boolean}>(scope,['outbox.work','outbox.redrive'],`SELECT coalesce(max(d.progress),0)::integer AS progress,coalesce(bool_or(d.failure_observed),false) AS failed
 FROM shipit.whatsapp_outbound_attempts a JOIN shipit.whatsapp_delivery_observations d ON d.installation_id=a.installation_id AND d.message_id=a.provider_message_id
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND {{franchise:d.organization_id:d.franchise_id}} AND a.intent_id=$1`,[id])).rows[0]!;
}
export async function disclose(scope:TenantAccess,id:string) {
 await scopedQuery(scope,['outbox.work'],`SELECT shipit.whatsapp_outbound_disclose($1,$2,$3) WHERE {{franchise:$1:$2}}`,
 [scope.context.organizationId,scope.context.permittedFranchiseIds[0],id]);
}
export async function detail(scope:TenantAccess,id:string) {
 const m=(await scopedQuery<MessageSummary>(scope,['outbox.read'],`SELECT m.id,m.state,m.reason_code,m.version,m.attempts,m.cycle_attempts,m.created_at,m.available_at,m.expires_at
 FROM shipit.whatsapp_outbound m WHERE {{franchise:m.organization_id:m.franchise_id}} AND m.id=$1`,[id])).rows[0];
 if(!m)return null;
 const attempts=(await scopedQuery(scope,['outbox.read'],`SELECT a.attempt,a.outcome,a.reason_code,a.recorded_at FROM shipit.whatsapp_outbound_attempts a
 WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.intent_id=$1 ORDER BY a.attempt DESC LIMIT 101`,[id])).rows;
 return {message:safeMessage(m),attempts:attempts.slice(0,100),history_truncated:attempts.length>100};
}
export async function health(scope:TenantAccess) {
 return (await scopedQuery(scope,['outbox.read'],`SELECT m.state,count(*)::integer AS count,greatest(0,extract(epoch FROM clock_timestamp()-min(m.created_at)))::float8 AS oldest_age_seconds
 FROM shipit.whatsapp_outbound m WHERE {{franchise:m.organization_id:m.franchise_id}} GROUP BY m.state ORDER BY m.state`)).rows;
}
export async function list(scope:TenantAccess,after:string|null,limit:number) {
 return (await scopedQuery<MessageSummary>(scope,['outbox.read'],`SELECT m.id,m.state,m.reason_code,m.version,m.attempts,m.cycle_attempts,m.created_at,m.available_at,m.expires_at
 FROM shipit.whatsapp_outbound m WHERE {{franchise:m.organization_id:m.franchise_id}}
 AND ($1::uuid IS NULL OR m.id>$1) ORDER BY m.id LIMIT $2`,[after,limit+1])).rows;
}
export async function replay(scope:TenantAccess,key:string) {
 return (await scopedQuery<{intent_id:string;version:number;fingerprint:string}>(scope,['outbox.redrive'],`SELECT r.intent_id,r.version,r.fingerprint FROM shipit.whatsapp_outbound_redrives r
 WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.actor_id=$1 AND r.key_hash=$2`,[scope.context.actor.id,key])).rows[0];
}
export async function redriveReceipt(scope:TenantAccess,m:Outbound,key:string,fingerprint:string,reason:string) {
 const c=scope.context;
 await scopedQuery(scope,['outbox.redrive'],`INSERT INTO shipit.whatsapp_outbound_redrives(organization_id,franchise_id,intent_id,actor_id,correlation_id,key_hash,fingerprint,version,reason_code)
 SELECT $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::uuid,$6::text,$7::text,$8::integer,$9::text WHERE {{franchise:$1:$2}}`,
 [c.organizationId,c.permittedFranchiseIds[0],m.id,c.actor.id,c.correlationId,key,fingerprint,m.version,reason]);
}
