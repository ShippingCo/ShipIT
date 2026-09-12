import { createHash } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { object, displayName, createFranchiseInput } from '../tenancy/validation.ts';

export const operationId = 'api.v1.onboarding.create';
export function onboardingInput(value: unknown) {
  try {
    const body = object(value, ['display_name', 'franchise']);
    const franchise = createFranchiseInput(body.franchise);
    return { display_name: displayName(body.display_name), franchise: {
      display_name: franchise.displayName, franchise_code: franchise.franchiseCode,
    } };
  } catch { throw new HttpError('VALIDATION_FAILED'); }
}
export function requestKey(value: unknown): string {
  if (typeof value !== 'string' || (!/^[A-Za-z0-9_-]{1,255}$/.test(value) || /[^A-Za-z0-9_-]/.test(value))) throw new HttpError('VALIDATION_FAILED');
  return value;
}
export function fingerprint(body: ReturnType<typeof onboardingInput>) {
  // Fixed, recursively sorted v1 schema; no defaults, query, or caller-owned resources.
  return createHash('sha256').update(JSON.stringify({ body, content_type: 'application/json',
    operation_id: operationId, query: {}, resource_ids: {} })).digest('hex');
}
