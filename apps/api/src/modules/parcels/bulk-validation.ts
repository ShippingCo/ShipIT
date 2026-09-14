import { MAX_BULK_PARCELS, type BulkParcelRequest, type BulkParcelItem } from '@shippingco/shared';
import { FieldValidationError } from '../../plugins/errors.ts';
import { object } from '../tax/validation.ts';
import { parcelId, idempotencyKey } from '../bookings/validation.ts';
import { command } from './validation.ts';
import { digest } from '../pricing/idempotency.ts';

/** Complete validation precedes receipt reservation and every business command. */
export function bulkCommand(value: unknown): BulkParcelRequest {
  const body = object(value, ['action','items']);
  if (body.action !== 'check_in' && body.action !== 'dispatch') throw new FieldValidationError('action','INVALID_FORMAT');
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_BULK_PARCELS) throw new FieldValidationError('items','OUT_OF_RANGE');
  const parcels = new Map<string, BulkParcelItem>(), keys = new Map<string,string>();
  for (const value of body.items) {
    const item = object(value,['parcel_id','idempotency_key','command']);
    const id = parcelId(item.parcel_id), key = idempotencyKey(item.idempotency_key);
    const input = command(`parcels.${body.action}`, item.command) as BulkParcelItem['command'];
    const normalized = { parcel_id: id, idempotency_key: key, command: input };
    const previous = parcels.get(id);
    if ((previous && digest(previous) !== digest(normalized)) || (keys.has(key) && keys.get(key) !== id)) {
      throw new FieldValidationError('items','INVALID_FORMAT');
    }
    parcels.set(id, normalized); keys.set(key,id);
  }
  return { action: body.action, items: [...parcels.values()].sort((a,b) => a.parcel_id < b.parcel_id ? -1 : a.parcel_id > b.parcel_id ? 1 : 0) };
}
