import { TenancyError } from './errors.ts';
import { utcInstant, type FranchiseListInput, type Lifecycle } from './types.ts';

const invalid = (): never => { throw new TenancyError('VALIDATION_FAILED'); };
export function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !fields.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) || value.length !== 36) return invalid();
  return value;
}
export function displayName(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value !== value.trim() || Array.from(value).length > 120 ||
      Array.from(value).some(character => {
        const code = character.codePointAt(0)!;
        return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
      })) return invalid();
  return value;
}
export function franchiseCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{0,31}$/.test(value) || /[^A-Z0-9_]/.test(value)) return invalid();
  return value;
}
export function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2147483646) return invalid();
  return value;
}
export function profileInput(value: unknown) {
  const input = object(value, ['display_name', 'expected_version']);
  return { displayName: displayName(input.display_name), expectedVersion: version(input.expected_version) };
}
export function createFranchiseInput(value: unknown) {
  const input = object(value, ['display_name', 'franchise_code']);
  return { displayName: displayName(input.display_name), franchiseCode: franchiseCode(input.franchise_code) };
}
export function lifecycleInput(value: unknown) {
  const input = object(value, ['lifecycle', 'expected_version', 'reason_code']);
  if (input.lifecycle !== 'active' && input.lifecycle !== 'disabled') return invalid();
  const reason: 'administrative_reactivate' | 'administrative_disable' = input.lifecycle === 'active' ? 'administrative_reactivate' : 'administrative_disable';
  if (input.reason_code !== reason) return invalid();
  return { lifecycle: input.lifecycle as Lifecycle, expectedVersion: version(input.expected_version), reasonCode: reason };
}
export function listInput(value: unknown): FranchiseListInput {
  const input = object(value, ['limit', 'after']);
  const limit = input.limit === undefined ? 50 : input.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 100) return invalid();
  if (input.after === undefined) return { limit };
  const after = object(input.after, ['created_at', 'id']);
  const instant = after.created_at;
  if (typeof instant !== 'string' || !Number.isFinite(Date.parse(instant)) || utcInstant(new Date(instant)) !== instant) return invalid();
  return { limit, after: { created_at: instant, id: uuid(after.id) } };
}
