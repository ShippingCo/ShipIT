import { scopedQuery, assertTenantAccess, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { BookingDto } from './types.ts';
export async function active(scope: TenantAccess) {
  const row = (await scopedQuery<{ lifecycle:string }>(scope,['bookings.create'],`SELECT lifecycle FROM shipit.franchises
    WHERE {{franchise:organization_id:id}} FOR SHARE`)).rows[0];
  if (!row) throw new HttpError('RESOURCE_NOT_FOUND');
  if (row.lifecycle !== 'active') throw new HttpError('FRANCHISE_DISABLED');
}
export async function now(scope: TenantAccess) {
  return (await scopedQuery<{ instant:Date }>(scope,['bookings.create'],`SELECT date_trunc('milliseconds',clock_timestamp()) AS instant
    FROM shipit.franchises WHERE {{franchise:organization_id:id}}`)).rows[0]!.instant;
}
export async function reserve(scope: TenantAccess, command: string, booking: string, key: string, fingerprint: string) {
  const c = assertTenantAccess(scope,['bookings.create']);
  const inserted = await scopedQuery(scope,['bookings.create'],`INSERT INTO shipit.booking_commands
    (id,principal_type,principal_id,organization_id,franchise_id,operation_id,key_digest,fingerprint,normalization_version,booking_id,correlation_id)
    SELECT $1,'user',$2,{{organization}},$3,'api.v1.bookings.create',$4,$5,1,$6,$7 WHERE {{franchise:$8:$3}}
    ON CONFLICT ON CONSTRAINT booking_commands_identity_key DO NOTHING RETURNING id`,
  [command,c.actor.id,c.permittedFranchiseIds[0],key,fingerprint,booking,c.correlationId,c.organizationId]);
  if (inserted.rows.length) return null;
  const previous = (await scopedQuery<{fingerprint:string;result:BookingDto;state:string;booking_id:string}>(scope,['bookings.create'],`SELECT fingerprint,result,state,booking_id FROM shipit.booking_commands
    WHERE {{franchise:organization_id:franchise_id}} AND principal_type='user' AND principal_id=$1
      AND operation_id='api.v1.bookings.create' AND key_digest=$2 FOR UPDATE`,[c.actor.id,key])).rows[0];
  if (!previous || previous.state !== 'committed') throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
  if (previous.result.id !== previous.booking_id || previous.result.organization_id !== c.organizationId ||
    previous.result.franchise_id !== c.permittedFranchiseIds[0]) throw new HttpError('RESOURCE_NOT_FOUND');
  if (previous.fingerprint !== fingerprint) throw new HttpError('IDEMPOTENCY_CONFLICT');
  return structuredClone(previous.result);
}
export async function insert(scope: TenantAccess, command: string, result: BookingDto, pricing: unknown, tax: unknown, intent: unknown, parcelSet: string) {
  const c = assertTenantAccess(scope,['bookings.create']);
  await scopedQuery(scope,['bookings.create'],`INSERT INTO shipit.bookings
    (id,organization_id,franchise_id,command_id,customer_id,customer_version,customer_snapshot,pricing_quote_id,tax_calculation_id,
      pricing_snapshot,tax_snapshot,tax_intent,confirmed_at,parcel_count,parcel_set_ref,final_payable_paise)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15 WHERE {{franchise:$16:$2}}`,
  [result.id,c.permittedFranchiseIds[0],command,result.customer.source_customer_id,result.customer.source_customer_version,result.customer,
    result.charges.pricing.id,result.charges.tax.id,pricing,tax,intent,result.charges.confirmed_at,result.parcels.length,parcelSet,
    result.payment_obligation.total_paise,c.organizationId]);
}
export async function saveObligation(scope: TenantAccess, booking: string, result: BookingDto['payment_obligation']) {
  const c = assertTenantAccess(scope,['bookings.create']);
  await scopedQuery(scope,['bookings.create'],`INSERT INTO shipit.booking_obligations(id,organization_id,franchise_id,booking_id,total_paise,collected_paise,outstanding_paise)
    SELECT $1,{{organization}},$2,$3,$4,0,$4 WHERE {{franchise:$5:$2}}`,[result.id,c.permittedFranchiseIds[0],booking,result.total_paise,c.organizationId]);
}
export async function complete(scope: TenantAccess, command: string, result: BookingDto) {
  await scopedQuery(scope,['bookings.create'],`UPDATE shipit.booking_commands SET state='committed',http_status=201,result=$2,
    committed_at=date_trunc('milliseconds',clock_timestamp()),retain_until=date_trunc('milliseconds',clock_timestamp())+interval '24 hours'
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND state='reserved'`,[command,result]);
}
