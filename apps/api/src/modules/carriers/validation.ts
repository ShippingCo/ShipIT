import { HttpError } from '../../plugins/errors.ts';
import { object, integer, uuid, timestamp } from '../pricing/validation.ts';
import type { SourceTime, ObservationStatus } from './contract.ts';
export { object, uuid };
export { selection, idempotencyKey, keyDigest } from '../eway/validation.ts';
export const statuses = ['booked_claim','collected_claim','in_transit_claim','out_for_delivery_claim',
  'failed_attempt_claim','held_claim','delivered_claim','returned_claim'] as const;
const fail = (): never => { throw new HttpError('VALIDATION_FAILED'); };
// Minimal codes, not free-text notes, addresses, URLs or provider payloads. Preserve exact case/punctuation.
export function code(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) || value.includes('://') || value.includes('\n')) return fail();
  return value;
}
export function installation(value: unknown) {
  const b = object(value, ['label','courier_id','file_import']);
  if (b.file_import !== undefined && typeof b.file_import !== 'boolean') fail();
  // Preserve old command fingerprints and generic installations when omitted.
  return { label: code(b.label), courier_id: b.courier_id === undefined || b.courier_id === null ? null : uuid(b.courier_id, '$'),
    ...(b.file_import === undefined ? {} : {file_import:b.file_import as boolean}) };
}
export function mapping(value: unknown) {
  const b = object(value, ['kind','source_code','normalized_id','expected_version','reason_code']);
  if (!['service','location'].includes(String(b.kind)) || !['initial_mapping','mapping_correction'].includes(String(b.reason_code))) fail();
  return { kind: b.kind as 'service'|'location', source_code: code(b.source_code),
    normalized_id: b.normalized_id === null ? null : uuid(b.normalized_id, '$'),
    expected_version: integer(b.expected_version, 'expected_version', 0, 2147483646), reason_code: String(b.reason_code) };
}
export function reference(value: unknown) {
  const b = object(value, ['installation_id','external_docket','service_code','origin_code','destination_code','expected_version','reason_code']);
  if (!['initial_mapping','reference_correction'].includes(String(b.reason_code))) fail();
  return { installation_id: uuid(b.installation_id, '$'), external_docket: code(b.external_docket),
    service_code: code(b.service_code), origin_code: code(b.origin_code), destination_code: code(b.destination_code),
    expected_version: integer(b.expected_version, 'expected_version', 0, 2147483646), reason_code: String(b.reason_code) };
}
export function observation(value: unknown) {
  const b = object(value, ['reference_id','expected_parcel_version','status_code','status','occurred_at']);
  if (b.status !== null && !statuses.includes(b.status as ObservationStatus)) fail();
  const time = object(b.occurred_at, ['state','at','reason']);
  let occurredAt: SourceTime;
  if (time.state === 'known' && time.reason === undefined) occurredAt = { state: 'known', at: timestamp(time.at, '$') };
  else if (time.state === 'unknown' && time.at === undefined && ['missing','unknown_timezone','invalid'].includes(String(time.reason)))
    occurredAt = { state: 'unknown', reason: time.reason as 'missing'|'unknown_timezone'|'invalid' };
  else return fail();
  return { reference_id: uuid(b.reference_id, '$'), expected_parcel_version: integer(b.expected_parcel_version, 'expected_version', 1, 2147483646),
    status_code: code(b.status_code), status: b.status as ObservationStatus|null, occurred_at: occurredAt };
}
