import { createHash } from 'node:crypto';
import type { ContactInput, CustomerOperation } from './types.ts';
export function keyDigest(key: string) { return createHash('sha256').update(key).digest('hex'); }
export function fingerprint(operation: CustomerOperation, customerId: string | null,
  input: ContactInput & { expected_version?: number }) {
  // Recursively sorted v1 schema. Display format is deliberately intent-bearing.
  const body = { address: input.address, ...(input.expected_version === undefined ? {} : { expected_version: input.expected_version }),
    name: input.name, phone_display: input.phone_display, phone_normalized: input.phone_normalized };
  return createHash('sha256').update(JSON.stringify({ body, content_type: 'application/json', operation_id: operation,
    query: {}, resource_ids: customerId === null ? {} : { customer_id: customerId } })).digest('hex');
}
