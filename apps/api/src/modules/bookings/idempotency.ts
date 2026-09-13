import { digest } from '../pricing/idempotency.ts';
import type { BookingInput } from './validation.ts';
export { keyDigest } from '../pricing/idempotency.ts';
export function fingerprint(body: BookingInput) {
  // All schema object keys are ASCII; all numbers are safe integers. Validated contact
  // strings reject lone surrogates. Recursive sort preserves the ordered parcel array.
  return digest({ operation_id:'api.v1.bookings.create',resource_ids:{},content_type:'application/json',query:{},body });
}
