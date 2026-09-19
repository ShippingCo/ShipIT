import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';
import { hash } from './validation.ts';
export interface GrantReceipt { id: string; version: number; expires_at: string }
export function grantToken(key: string, receipt: GrantReceipt, organization: string, franchise: string, booking: string, session: string) {
  const payload=JSON.stringify([receipt.id,receipt.version,receipt.expires_at,organization,franchise,booking,hash(session)]);
  const encoded=Buffer.from(payload).toString('base64url');
  return encoded+'.'+createHmac('sha256',key).update(encoded).digest('base64url');
}
export function verifyGrant(key: string, token: unknown, receipt: GrantReceipt, organization: string, franchise: string, booking: string, session: string, now: Date) {
  if(typeof token!=='string'||token.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))throw new HttpError('RESOURCE_NOT_FOUND');
  const expected=grantToken(key,receipt,organization,franchise,booking,session);
  if(token.length!==expected.length||!timingSafeEqual(Buffer.from(token),Buffer.from(expected))||now.getTime()>=Date.parse(receipt.expires_at))throw new HttpError('RESOURCE_NOT_FOUND');
}
export function grantExpiry(token: unknown): string {
  try {
    if(typeof token!=='string'||token.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))throw new Error();
    const payload:unknown=JSON.parse(Buffer.from(token.split('.')[0]!,'base64url').toString());
    if(!Array.isArray(payload)||payload.length!==7||typeof payload[2]!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(payload[2])||!Number.isFinite(Date.parse(payload[2])))throw new Error();
    return payload[2];
  }catch{throw new HttpError('RESOURCE_NOT_FOUND');}
}
