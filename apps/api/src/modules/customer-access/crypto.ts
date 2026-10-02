import { createHash, createHmac } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';

export function accessToken(key: Buffer, id: string) {
  return createHmac('sha256', key).update('customer-tracking-v1\0' + id).digest('base64url');
}
export function tokenDigest(token: unknown) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new HttpError('RESOURCE_NOT_FOUND');
  return createHash('sha256').update(token).digest('hex');
}
