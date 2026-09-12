import { HttpError, FieldValidationError, type ValidationField, type ValidationCode } from '../../plugins/errors.ts';
import type { ContactInput, CustomerFilter } from './types.ts';
function fail(field: ValidationField, code: ValidationCode): never { throw new FieldValidationError(field, code); }
function object(value: unknown, fields: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('$', 'INVALID_TYPE');
  if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !fields.includes(key))) fail('$', 'UNKNOWN_FIELD');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: ValidationField, max: number, empty = false): string {
  if (value === undefined) fail(field, 'REQUIRED');
  if (typeof value !== 'string') fail(field, 'INVALID_TYPE');
  if ([...value].some(character => {
    const code = character.codePointAt(0)!;
    return code < 32 || (code >= 127 && code <= 159) || (code >= 0xd800 && code <= 0xdfff);
  })) fail(field, 'INVALID_FORMAT');
  const result = value.trim();
  if ((!empty && !result) || [...result].length > max || value.length > max * 4 + 100) fail(field, 'OUT_OF_RANGE');
  return result;
}
export function phone(value: unknown, field: 'phone' | 'q' = 'phone') {
  if (value === undefined) fail(field, 'REQUIRED');
  if (typeof value !== 'string') fail(field, 'INVALID_TYPE');
  if (value.length > 40 || /[^+0-9 -]/.test(value)) fail(field, 'INVALID_FORMAT');
  const display = value.replace(/^ +| +$/g, '');
  if (!/^\+[1-9][0-9]*(?:[ -][0-9]+)*$/.test(display)) fail(field, 'INVALID_FORMAT');
  const normalized = display.replace(/[ -]/g, '');
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) fail(field, 'INVALID_FORMAT');
  return { display, normalized };
}
export function uuid(value: unknown, field: 'organization_id' | 'franchise_id' | 'customer_id') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) || value.length !== 36) fail(field, 'INVALID_FORMAT');
  return value;
}
function contact(body: Record<string, unknown>, create: boolean): ContactInput {
  const p = phone(body.phone);
  return { name: text(body.name, 'name', 120), phone_normalized: p.normalized, phone_display: p.display,
    address: text(create && body.address === undefined ? '' : body.address, 'address', 500, true) };
}
export function createInput(value: unknown) { return contact(object(value, ['name', 'phone', 'address']), true); }
export function updateInput(value: unknown) {
  const body = object(value, ['name', 'phone', 'address', 'expected_version']);
  if (!Number.isInteger(body.expected_version) || Number(body.expected_version) < 1 || Number(body.expected_version) > 2147483646) fail('expected_version', 'OUT_OF_RANGE');
  return { ...contact(body, false), expected_version: body.expected_version as number };
}
export function searchInput(value: unknown): CustomerFilter {
  const body = object(value, ['search_by', 'q', 'limit', 'cursor']);
  if (body.search_by !== 'name' && body.search_by !== 'phone') fail('search_by', 'INVALID_FORMAT');
  let prefix: string;
  if (body.search_by === 'phone') prefix = phone(body.q, 'q').normalized;
  else {
    prefix = text(body.q, 'q', 120);
    if ((prefix.match(/[\p{L}\p{N}]/gu) ?? []).length < 3) fail('q', 'OUT_OF_RANGE');
  }
  const limit = body.limit === undefined ? '50' : body.limit;
  if (typeof limit !== 'string' || !/^[1-9][0-9]{0,2}$/.test(limit) || Number(limit) > 100) fail('limit', 'OUT_OF_RANGE');
  if (body.cursor !== undefined && (typeof body.cursor !== 'string' || body.cursor.length > 4096)) fail('cursor', 'INVALID_FORMAT');
  if (body.cursor === '') throw new HttpError('CURSOR_INVALID');
  return { searchBy: body.search_by, prefix, limit: Number(limit), cursor: body.cursor as string | undefined ?? null };
}
export function idempotencyKey(value: unknown, rawHeaders?: readonly string[]) {
  if (rawHeaders && rawHeaders.filter((v, i) => i % 2 === 0 && v.toLowerCase() === 'idempotency-key').length !== 1) fail('idempotency_key', 'INVALID_FORMAT');
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,255}$/.test(value) || /[^A-Za-z0-9_-]/.test(value)) fail('idempotency_key', 'INVALID_FORMAT');
  return value;
}
export function noQuery(value: unknown) { object(value, []); }
export function literalPrefix(value: string) { return value.replace(/[\\%_]/g, '\\$&') + '%'; }
