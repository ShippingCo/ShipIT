import { ApiFailure } from './errors';
export type Decoder<T> = (value: unknown) => T;
export function protocol(): never { throw new ApiFailure('TEMPORARILY_UNAVAILABLE', { kind: 'protocol', dispatched: true }); }
export const text: Decoder<string> = value => typeof value === 'string' && value.length <= 4096 ? value : protocol();
export const uuid: Decoder<string> = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) ? value : protocol();
export const instant: Decoder<string> = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : protocol();
export const integer = (min = 0): Decoder<number> => value => typeof value === 'number' && Number.isSafeInteger(value) && value >= min ? value : protocol();
export const choice = <T extends string | number | boolean>(...values: readonly T[]): Decoder<T> => value => values.some(v => v === value) ? value as T : protocol();
export const nullable = <T>(decode: Decoder<T>): Decoder<T | null> => value => value === null ? null : decode(value);
export const array = <T>(decode: Decoder<T>, max = 100): Decoder<T[]> => value => Array.isArray(value) && value.length <= max ? value.map(decode) : protocol();
/** Allowlist projection, including nested values. Unknown response fields never enter UI state. */
export function object<S extends Record<string, Decoder<unknown>>>(shape: S): Decoder<{ [K in keyof S]: ReturnType<S[K]> }> {
  return value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return protocol();
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(shape).map(([key, decode]) => [key, decode(record[key])])) as { [K in keyof S]: ReturnType<S[K]> };
  };
}
export const page = object({ next_cursor: nullable(text), has_more: choice(true, false) });
export function list<T>(decode: Decoder<T>): Decoder<{ items: T[]; page: ReturnType<typeof page> }> {
  const parse = object({ items: array(decode), page });
  return value => { const result = parse(value); if (result.page.has_more !== (result.page.next_cursor !== null)) return protocol(); return result; };
}
