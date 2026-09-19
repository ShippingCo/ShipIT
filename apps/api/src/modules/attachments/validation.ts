import { createHash } from 'node:crypto';
import { attachmentLimits, attachmentMedia, type AttachmentIntent } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
export function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw new HttpError('VALIDATION_FAILED');
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) throw new HttpError('VALIDATION_FAILED');
  return value;
}
export function selection(value: unknown, extra: readonly string[] = []) {
  const q = object(value, ['organization_id', 'franchise_id', ...extra]);
  return { organizationId: uuid(q.organization_id), franchiseId: uuid(q.franchise_id), parcelId: q.parcel_id === undefined ? null : uuid(q.parcel_id) };
}
export function intent(value: unknown): AttachmentIntent {
  const b = object(value, ['purpose', 'parcel_id', 'kind', 'media_type', 'size_bytes', 'sha256']);
  if (!['shipment_evidence', 'parcel_proof'].includes(String(b.purpose))) throw new HttpError('VALIDATION_FAILED');
  if (typeof b.media_type !== 'string' || !Object.hasOwn(attachmentMedia, b.media_type)) throw new HttpError('ATTACHMENT_TYPE_UNSUPPORTED');
  const media = b.media_type as AttachmentIntent['media_type'];
  if (b.kind !== attachmentMedia[media]) throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');
  if (typeof b.size_bytes !== 'number' || !Number.isSafeInteger(b.size_bytes) || b.size_bytes < 1) throw new HttpError('VALIDATION_FAILED');
  if (b.size_bytes > attachmentLimits.fileBytes) throw new HttpError('ATTACHMENT_LIMIT_EXCEEDED');
  if (typeof b.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(b.sha256)) throw new HttpError('VALIDATION_FAILED');
  const parcel = b.parcel_id === undefined ? undefined : uuid(b.parcel_id);
  if (b.purpose === 'parcel_proof' && !parcel) throw new HttpError('VALIDATION_FAILED');
  return { purpose: b.purpose as AttachmentIntent['purpose'], ...(parcel ? { parcel_id: parcel } : {}), kind: attachmentMedia[media], media_type: media, size_bytes: b.size_bytes, sha256: b.sha256 };
}
export const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export function key(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new HttpError('VALIDATION_FAILED');
  return hash(value);
}
export const fingerprint = (operation: string, booking: string, id: string | null, body: unknown) => hash(JSON.stringify([operation, booking, id, body]));
