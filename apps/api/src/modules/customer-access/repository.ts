import { scopedQuery, type TenantAccess } from '../security/scope.ts';

export interface Binding {
  id:string; parcel_id:string; installation_id:string; inbox_id:string; relation:'sender'|'recipient'; contact_key:string;
  customer_id:string|null; contact_version:string|null; version:number; expires_at:Date;
}
export async function source(scope:TenantAccess,inbox:string) {
  // Match staff lock order before locking the installation in a worker read.
  await scopedQuery(scope,['customer.access.manage','whatsapp.inbox.work'],`SELECT o.id FROM shipit.organizations o
    WHERE {{organization:o.id}} FOR SHARE`,[]);
  return (await scopedQuery<{installation_id:string;waba_id:string;phone_number_id:string;event_key:string;sealed_payload:string;key_version:string;occurred_at:Date}>(scope,
    ['customer.access.manage','whatsapp.inbox.work'],`SELECT j.installation_id,i.waba_id,i.phone_number_id,j.event_key,j.sealed_payload,j.key_version,j.occurred_at
    FROM shipit.whatsapp_inbox j JOIN shipit.whatsapp_installations i
    ON i.organization_id=j.organization_id AND i.franchise_id=j.franchise_id AND i.id=j.installation_id
    JOIN shipit.franchises f ON f.organization_id=i.organization_id AND f.id=i.franchise_id JOIN shipit.organizations o ON o.id=i.organization_id
    WHERE {{franchise:j.organization_id:j.franchise_id}} AND j.id=$1 AND j.kind='inbound' AND j.state='completed'
    AND i.state='validated' AND f.lifecycle='active' AND o.lifecycle='active'
    AND j.occurred_at<=clock_timestamp() AND j.occurred_at>clock_timestamp()-interval '15 minutes' FOR SHARE OF i,f,o`,[inbox])).rows[0];
}
export async function parcel(scope:TenantAccess,id:string) {
  return (await scopedQuery<{id:string;customer_id:string;contact_version:string;phone_normalized:string;recipient_phone:string}>(scope,['customer.access.manage'],
    `SELECT p.id,b.customer_id,c.contact_version,c.phone_normalized,p.recipient_snapshot->>'phone_normalized' AS recipient_phone
     FROM shipit.parcels p JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
     JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
     WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 FOR UPDATE OF p FOR SHARE OF c`,[id])).rows[0];
}
export async function binding(scope:TenantAccess,parcel:string,relation:string) {
  return (await scopedQuery<Binding>(scope,['customer.access.manage'],`SELECT b.* FROM shipit.customer_access_bindings b
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.parcel_id=$1 AND b.relation=$2 FOR UPDATE`,[parcel,relation])).rows[0];
}
export async function revoke(scope:TenantAccess,id:string,evidence:string) {
  return (await scopedQuery<Binding>(scope,['customer.access.manage'],`UPDATE shipit.customer_access_bindings b SET
    version=version+1,expires_at=clock_timestamp(),evidence_ref=$2,actor_id=$3,correlation_id=$4
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1 RETURNING b.*`,
    [id,evidence,scope.context.actor.id,scope.context.correlationId])).rows[0]!;
}
export async function replay(scope:TenantAccess,key:string) {
  return (await scopedQuery<{fingerprint:string;result:{id:string;version:number;expires_at:string}}>(scope,['customer.access.manage'],
    `SELECT c.fingerprint,c.result FROM shipit.customer_access_commands c WHERE {{franchise:c.organization_id:c.franchise_id}}
     AND c.actor_id=$1 AND c.key_digest=$2`,[scope.context.actor.id,key])).rows[0];
}
export async function bind(scope:TenantAccess,b:Binding,evidence:string,inbox:string) {
  const c=scope.context;
  await scopedQuery(scope,['customer.access.manage'],`INSERT INTO shipit.customer_access_bindings
    (id,organization_id,franchise_id,parcel_id,installation_id,relation,contact_key,customer_id,contact_version,version,evidence_ref,inbox_id,actor_id,correlation_id,verified_at,expires_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,clock_timestamp(),clock_timestamp()+interval '24 hours'
    WHERE {{franchise:$14:$2}} ON CONFLICT(organization_id,franchise_id,parcel_id,relation) DO UPDATE SET
    installation_id=EXCLUDED.installation_id,contact_key=EXCLUDED.contact_key,customer_id=EXCLUDED.customer_id,contact_version=EXCLUDED.contact_version,
    version=EXCLUDED.version,evidence_ref=EXCLUDED.evidence_ref,inbox_id=EXCLUDED.inbox_id,actor_id=EXCLUDED.actor_id,
    correlation_id=EXCLUDED.correlation_id,verified_at=EXCLUDED.verified_at,expires_at=EXCLUDED.expires_at`,
  [b.id,c.permittedFranchiseIds[0],b.parcel_id,b.installation_id,b.relation,b.contact_key,b.customer_id,b.contact_version,b.version,evidence,inbox,c.actor.id,c.correlationId,c.organizationId]);
  return (await binding(scope,b.parcel_id,b.relation))!;
}
export async function record(scope:TenantAccess,id:string,key:string,fingerprint:string,result:unknown,evidence:string,inbox:string,relation:string) {
  const c=scope.context;
  await scopedQuery(scope,['customer.access.manage'],`INSERT INTO shipit.customer_access_commands
    (organization_id,franchise_id,actor_id,key_digest,fingerprint,binding_id,result,correlation_id,evidence_ref,inbox_id,relation)
    SELECT {{organization}},$1,$2,$3,$4,$5,$6,$7,$9,$10,$11 WHERE {{franchise:$8:$1}}`,
  [c.permittedFranchiseIds[0],c.actor.id,key,fingerprint,id,result,c.correlationId,c.organizationId,evidence,inbox,relation]);
}
export async function selection(scope:TenantAccess,installation:string,contact:string,docket:string|null) {
  return (await scopedQuery<Binding & {docket:string}>(scope,['whatsapp.inbox.work'],`SELECT DISTINCT ON(p.id) b.*,p.docket FROM shipit.customer_access_bindings b
    JOIN shipit.parcels p ON p.organization_id=b.organization_id AND p.franchise_id=b.franchise_id AND p.id=b.parcel_id
    LEFT JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.installation_id=$1 AND b.contact_key=$2 AND b.expires_at>clock_timestamp()
    AND ($3::text IS NULL OR p.docket=$3) AND (b.relation='recipient' OR c.contact_version=b.contact_version)
    ORDER BY p.id,CASE WHEN b.relation='sender' THEN 0 ELSE 1 END LIMIT 11`,[installation,contact,docket])).rows;
}
export async function grant(scope:TenantAccess,b:Binding,inbox:string,id:string,digest:string) {
  const c=scope.context;
  await scopedQuery(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.customer_tracking_grants
    (id,organization_id,franchise_id,binding_id,binding_version,inbox_id,token_digest,expires_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,least($7,clock_timestamp()+interval '15 minutes') WHERE {{franchise:$8:$2}}
    ON CONFLICT(binding_id,binding_version,inbox_id) DO NOTHING`,[id,c.permittedFranchiseIds[0],b.id,b.version,inbox,digest,b.expires_at,c.organizationId]);
  return (await scopedQuery<{id:string;expires_at:Date;token_digest:string}>(scope,['whatsapp.inbox.work'],`SELECT g.id,g.expires_at,g.token_digest FROM shipit.customer_tracking_grants g
    WHERE {{franchise:g.organization_id:g.franchise_id}} AND g.binding_id=$1 AND g.binding_version=$2 AND g.inbox_id=$3`,[b.id,b.version,inbox])).rows[0]!;
}
export async function tracking(scope:TenantAccess,digest:string,docket:string|null) {
  // Staff mutations lock the organization before parcel/binding rows. Acquire
  // that same root first so a read cannot deadlock with a concurrent rebind.
  await scopedQuery(scope,['customer.tracking.read','whatsapp.inbox.work'],`SELECT o.id FROM shipit.organizations o
    WHERE {{organization:o.id}} FOR SHARE`,[]);
  return (await scopedQuery<{id:string;docket:string;status:string;version:number}>(scope,['customer.tracking.read','whatsapp.inbox.work'],`SELECT p.id,p.docket,p.status,p.version
    FROM shipit.customer_tracking_grants g JOIN shipit.customer_access_bindings b
    ON b.organization_id=g.organization_id AND b.franchise_id=g.franchise_id AND b.id=g.binding_id AND b.version=g.binding_version
    JOIN shipit.parcels p ON p.organization_id=b.organization_id AND p.franchise_id=b.franchise_id AND p.id=b.parcel_id
    JOIN shipit.whatsapp_installations i ON i.organization_id=b.organization_id AND i.franchise_id=b.franchise_id AND i.id=b.installation_id
    JOIN shipit.franchises f ON f.organization_id=b.organization_id AND f.id=b.franchise_id JOIN shipit.organizations o ON o.id=b.organization_id
    LEFT JOIN shipit.customers c ON c.organization_id=b.organization_id AND c.franchise_id=b.franchise_id AND c.id=b.customer_id
    WHERE {{franchise:g.organization_id:g.franchise_id}} AND g.token_digest=$1 AND ($2::text IS NULL OR p.docket=$2)
    AND g.expires_at>clock_timestamp() AND b.expires_at>clock_timestamp() AND i.state='validated' AND f.lifecycle='active' AND o.lifecycle='active'
    AND (b.relation='recipient' OR c.contact_version=b.contact_version) FOR SHARE OF b,i,f,o,p`,[digest,docket])).rows[0];
}
export async function timeline(scope:TenantAccess,id:string) {
  return (await scopedQuery<{event_type:string;occurred_at:Date}>(scope,['customer.tracking.read','whatsapp.inbox.work'],`SELECT e.event_type,e.occurred_at FROM shipit.domain_events e
    WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.parcel_id=$1 AND e.event_type IN
    ('parcel.booked','parcel.checked_in','parcel.dispatched','parcel.in_transit','delivery.attempt_started','delivery.retry_started','delivery.attempt_failed',
     'parcel.held_at_office','delivery.completed','delivery.collected','delivery.reversed','parcel.rto_approved')
    ORDER BY e.aggregate_sequence DESC,e.event_id DESC LIMIT 20`,[id])).rows;
}
export async function eta(scope:TenantAccess,id:string) {
  return (await scopedQuery<{revised_eta_at:Date|null}>(scope,['customer.tracking.read','whatsapp.inbox.work'],`SELECT x.revised_eta_at FROM shipit.route_parcel_effects x
    JOIN shipit.domain_events e ON e.organization_id=x.organization_id AND e.franchise_id=x.franchise_id AND e.event_id=x.event_id
    WHERE {{franchise:x.organization_id:x.franchise_id}} AND x.parcel_id=$1
    ORDER BY e.occurred_at DESC,x.route_version DESC,e.event_id DESC LIMIT 1`,[id])).rows[0]?.revised_eta_at??null;
}
