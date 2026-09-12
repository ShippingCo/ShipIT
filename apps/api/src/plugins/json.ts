import type { FastifyInstance } from 'fastify';
import { FieldValidationError, HttpError } from './errors.ts';

export const JSON_BODY_LIMIT = 256 * 1024;
export const JSON_MAX_DEPTH = 64;
// Native JSON.parse owns grammar. This iterative structural pass detects decoded
// duplicate keys and pollution keys without recursion or a regex JSON parser.
export function parseStrictJson(source: string, exactIntegers = false): unknown {
  const refuse = (): never => { throw new HttpError('MALFORMED_REQUEST'); };
  let result: unknown;
  try { result = JSON.parse(source); } catch { return refuse(); }
  const stack: { object: boolean; key: boolean; keys: Set<string> }[] = [];
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      const start = i++;
      while (i < source.length) {
        if (source[i] === '\\') i += 2;
        else if (source[i] === '"') break;
        else i++;
      }
      const top = stack.at(-1);
      if (top?.object && top.key) {
        const key = JSON.parse(source.slice(start, i + 1)) as string;
        if (top.keys.has(key) || key === '__proto__' || key === 'constructor') refuse();
        top.keys.add(key); top.key = false;
      }
    } else if (char === '{' || char === '[') {
      stack.push({ object: char === '{', key: char === '{', keys: new Set() });
      if (stack.length > JSON_MAX_DEPTH) refuse();
    } else if (char === '}' || char === ']') stack.pop();
    else if (char === ',' && stack.at(-1)?.object) stack.at(-1)!.key = true;
    else if (char === '-' || (char! >= '0' && char! <= '9')) {
      const start = i;
      while (i + 1 < source.length && ![' ', '\t', '\n', '\r', ',', '}', ']'].includes(source[i + 1]!)) i++;
      const token=source.slice(start,i+1);
      if (!Number.isFinite(Number(token))) refuse();
      // Pricing schemas permit only integers. Inspect original decimal digits before
      // JSON.parse precision loss can turn 9007199254740991.1 or 1e-999 into an integer.
      if(exactIntegers) {
        const match=/^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
        const digits=(match[1]!+(match[2]??'')).replace(/^0+/,'');
        const scale=(match[2]?.length??0)-Number(match[3]??0);
        if(!Number.isSafeInteger(Number(token)) || (digits && (scale>digits.length ||
          (scale>0 && !/^0*$/.test(digits.slice(-scale))))))throw new FieldValidationError('$','OUT_OF_RANGE');
      }
    }
  }
  return result;
}
export function registerJson(app: FastifyInstance) {
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: JSON_BODY_LIMIT }, (request, body, done) => {
    try { done(null, parseStrictJson(new TextDecoder('utf-8', { fatal: true }).decode(body as Buffer), (request.routeOptions.url??'').includes('/pricing/'))); }
    catch(error) { done(error instanceof FieldValidationError?error:new HttpError('MALFORMED_REQUEST')); }
  });
  app.addHook('onRequest', async (request) => {
    try { decodeURIComponent(request.raw.url ?? ''); }
    catch { throw new HttpError('MALFORMED_REQUEST'); }
    if (request.method === 'OPTIONS' && (!request.headers.origin || !request.headers['access-control-request-method'])) throw new HttpError('MALFORMED_REQUEST');
    const contentType = request.headers['content-type'];
    if (contentType && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) throw new HttpError('UNSUPPORTED_MEDIA_TYPE');
  });
}
