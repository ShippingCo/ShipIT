import { HttpError } from '../../plugins/errors.ts';
export type Channel = 'email' | 'whatsapp';
export function object(value: unknown, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new HttpError('VALIDATION_FAILED');
  return value as Record<string, unknown>;
}
export function identifier(channel: unknown, address: unknown): { channel: Channel; address: string } {
  if (!['email', 'whatsapp'].includes(String(channel)) || typeof address !== 'string' || address.length > 254) throw new HttpError('VALIDATION_FAILED');
  const normalized = address.trim();
  // Deliberately accepts international E.164 input, not a guessed default country.
  if (channel === 'whatsapp') {
    if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) throw new HttpError('VALIDATION_FAILED');
    return { channel, address: normalized };
  }
  // Bounded ASCII login-email contract; no provider-specific dot/plus rewriting.
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(normalized) || normalized.startsWith('.') || normalized.includes('..') || normalized.includes('.@')) throw new HttpError('VALIDATION_FAILED');
  return { channel: 'email', address: normalized.toLowerCase() };
}
export function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) throw new HttpError('VALIDATION_FAILED');
  return value;
}
