import { createHash, createHmac, randomBytes, randomInt, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../../plugins/errors.ts';

export interface AuthKeys { version: string; verifier: Buffer; encryption: Buffer; browser: Buffer }
export function parseKeys(value: string): AuthKeys {
  try {
    const data = JSON.parse(value) as Record<string, unknown>;
    if (typeof data.version !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(data.version)) throw new Error();
    const key = (name: string) => {
      const raw = data[name];
      if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) throw new Error();
      return Buffer.from(raw, 'hex');
    };
    const keys = { version: data.version, verifier: key('verifier'), encryption: key('encryption'), browser: key('browser') };
    if (new Set([keys.verifier.toString('hex'), keys.encryption.toString('hex'), keys.browser.toString('hex')]).size !== 3) throw new Error();
    return keys;
  } catch { throw new Error('AUTH_KEYS_INVALID'); }
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const secret = () => randomBytes(32).toString('base64url');
export const otp = () => randomInt(100_000_000).toString().padStart(8, '0');
export function mac(key: Buffer, ...parts: string[]) { return createHmac('sha256', key).update(JSON.stringify(parts)).digest('hex'); }
export function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function seal(keys: AuthKeys, id: string, code: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', keys.encryption, iv);
  cipher.setAAD(Buffer.from(JSON.stringify([keys.version, id])));
  const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
export function unseal(keys: AuthKeys, id: string, payload: string) {
  const raw = Buffer.from(payload, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', keys.encryption, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(JSON.stringify([keys.version, id])));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}
export function browserToken(keys: AuthKeys, now = Date.now()) {
  const value = `${secret()}.${now}`;
  return `${value}.${mac(keys.browser, 'preauth', value)}`;
}
export function validBrowser(keys: AuthKeys, token: string, now = Date.now()) {
  if (token.length > 150) return false;
  const parts = token.split('.');
  const issued = Number(parts[1]);
  return parts.length === 3 && /^[\w-]{43}$/.test(parts[0]!) && Number.isSafeInteger(issued) &&
    issued <= now && now - issued < 600_000 && equal(parts[2]!, mac(keys.browser, 'preauth', `${parts[0]}.${parts[1]}`));
}
export function csrf(keys: AuthKeys, binding: string) { return mac(keys.browser, 'csrf', binding); }
export function checkCsrf(keys: AuthKeys, binding: string, provided: unknown) {
  if (typeof provided !== 'string' || !equal(csrf(keys, binding), provided)) throw new HttpError('ACTION_FORBIDDEN');
}
