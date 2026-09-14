import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
export function envelope(scope: TenantAccess, command: string, id: string, type: 'booking.created'|'parcel.booked', aggregate: string, time: string, ref: string) {
  const c = assertTenantAccess(scope,['bookings.events']);
  return { event_id:id,event_type:type,schema_version:1,organization_id:c.organizationId!,franchise_id:c.permittedFranchiseIds[0]!,
    aggregate_type:type==='booking.created'?'booking':'parcel',aggregate_id:aggregate,aggregate_version:1,occurred_at:time,
    actor:{type:'user',id:c.actor.id},correlation_id:c.correlationId,causation_id:command,command_id:command,
    payload:type==='booking.created'?{parcel_set_ref:ref}:{booking_id:ref} };
}
export async function persist(scope: TenantAccess, event: ReturnType<typeof envelope>, booking: string) {
  await scopedQuery(scope,['bookings.events'],`INSERT INTO shipit.domain_events
    (event_id,organization_id,franchise_id,booking_id,parcel_id,command_id,event_type,aggregate_id,envelope,occurred_at,aggregate_sequence)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}`,
  [event.event_id,event.franchise_id,booking,event.aggregate_type==='parcel'?event.aggregate_id:null,event.command_id,event.event_type,event.aggregate_id,event,event.occurred_at,event.aggregate_version,event.organization_id]);
}
