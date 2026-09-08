import { afterEach, describe, expect, it } from 'vitest';
import { harness } from '../support.ts';
import { JSON_BODY_LIMIT } from '../../src/plugins/json.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
import { fakeDatabase, syntheticEnv } from '../support.ts';

const apps: ReturnType<typeof buildServer>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
function setup(...args: Parameters<typeof harness>) { const h = harness(...args); apps.push(h.app); return h; }
const command = (payload: string, contentType = 'application/json') => ({ method: 'POST' as const, url: '/synthetic-command', headers: { 'content-type': contentType }, payload });

describe('security and HTTP boundary', () => {
  it('builds and injects without listening or requiring DB availability', async () => {
    const { app, database } = setup();
    expect(app.server.listening).toBe(false); expect(database.query).not.toHaveBeenCalled();
    expect((await app.inject('/health/live')).statusCode).toBe(200); expect(app.server.listening).toBe(false);
  });
  it('production composition contains only health and CORS routes', async () => {
    const app = buildServer({ config: parseEnvironment(syntheticEnv), database: fakeDatabase(), logSink: { write: () => {} } }); apps.push(app);
    for (const path of ['/synthetic-command', '/synthetic-context', '/api/v1/test', '/api/v1/debug', '/api/v1/probe', '/api/v1/login']) {
      const result = await app.inject(path); expect(result.statusCode).toBe(404); expect(result.json().error.code).toBe('RESOURCE_NOT_FOUND');
    }
  });
  it.each(['{"name":"SYN_BODY_SECRET",', '{"name":"SYN_BODY_SECRET","name":"other"}',
    '{"name":"ok","nested":{"flag":true,"fl\\u0061g":false}}', '{"name":"ok","__proto__":{}}',
    '{"name":"ok","constructor":{"prototype":{}}}', '{"name":1e999}', '', '[[[[', '{"name":"bad\nstring"}'])('rejects malformed or ambiguous JSON before handler: %s', async payload => {
    const { app, handler, logs } = setup(); const result = await app.inject(command(payload));
    expect(result.statusCode).toBe(400); expect(result.json().error.code).toBe('MALFORMED_REQUEST'); expect(handler).not.toHaveBeenCalled();
    expect(result.body + logs.join('')).not.toContain('SYN_BODY_SECRET');
  });
  it('rejects deep nesting and invalid UTF-8 without leaking data', async () => {
    const { app, handler } = setup();
    for (const payload of ['['.repeat(65) + '0' + ']'.repeat(65), Buffer.from([0x7b, 0x22, 0xc0, 0xaf, 0x22, 0x3a, 0x31, 0x7d])]) {
      const result = await app.inject({ ...command(''), payload }); expect(result.statusCode).toBe(400);
    }
    expect(handler).not.toHaveBeenCalled();
  });
  it('accepts valid escaped strings, nested data and repeated keys in separate objects', async () => {
    const { parseStrictJson } = await import('../../src/plugins/json.ts');
    for (const value of [{ text: '\\"{},[]', items: [{ a: 1 }, { a: 2 }], null: null, bool: true, num: -12.4e-3 }, [1,2,3]]) {
      expect(parseStrictJson(JSON.stringify(value))).toEqual(value);
    }
    const { app, handler } = setup(); expect((await app.inject(command('{"name":"ok","nested":{"flag":true}}'))).statusCode).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
  it('accepts below and exactly 256 KiB, rejects above before handler', async () => {
    const { app, handler } = setup();
    for (const bytes of [JSON_BODY_LIMIT - 1, JSON_BODY_LIMIT, JSON_BODY_LIMIT + 1]) {
      const payload = JSON.stringify({ name: 'a'.repeat(bytes - 11) }); expect(Buffer.byteLength(payload)).toBe(bytes);
      const result = await app.inject(command(payload)); expect(result.statusCode).toBe(bytes > JSON_BODY_LIMIT ? 413 : 200);
      if (bytes > JSON_BODY_LIMIT) expect(result.json().error.code).toBe('PAYLOAD_TOO_LARGE');
    }
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it.each(['text/plain', 'application/x-www-form-urlencoded', 'application/jsonp', 'application/vendor+json', 'application/json; charset=latin1'])('rejects unsupported content type %s', async type => {
    const { app, handler } = setup(); const result = await app.inject(command('{"name":"SYN_BODY_SECRET"}', type));
    expect(result.statusCode).toBe(415); expect(result.json().error.code).toBe('UNSUPPORTED_MEDIA_TYPE'); expect(handler).not.toHaveBeenCalled();
  });
  it.each([
    [{}, 'REQUIRED'], [{ name: 123 }, 'INVALID_TYPE'], [{ name: 'ok', count: 0 }, 'OUT_OF_RANGE'],
    [{ name: 'ok', SYN_UNKNOWN_SECRET: 'SYN_BODY_SECRET' }, 'UNKNOWN_FIELD'], [{ name: 'ok', nested: { SYN_UNKNOWN_SECRET: true } }, 'UNKNOWN_FIELD'],
  ])('maps schema failure to safe field/code details: %j', async (payload, code) => {
    const { app, handler, logs } = setup(); const result = await app.inject(command(JSON.stringify(payload)));
    expect(result.statusCode).toBe(422); expect(result.json().error.details[0].code).toBe(code); expect(handler).not.toHaveBeenCalled();
    expect(result.body + logs.join('')).not.toMatch(/SYN_UNKNOWN_SECRET|SYN_BODY_SECRET/);
  });
  it('only approved origins get CORS access; no origin establishes identity', async () => {
    const { app } = setup();
    for (const origin of ['http://localhost:5173', 'https://hostile.example.test', 'null', 'http://localhost:5173.hostile.test']) {
      const result = await app.inject({ url: '/synthetic-context', headers: { origin, 'x-user-id': 'SYN_USER', 'x-franchise-id': 'SYN_FRANCHISE', 'x-role': 'admin' } });
      expect(result.statusCode).toBe(200); expect(result.json().hasIdentity).toBe(false);
      expect(result.headers['access-control-allow-origin']).toBe(origin === 'http://localhost:5173' ? origin : undefined);
      expect(result.headers['access-control-allow-credentials']).toBeUndefined();
    }
    const result = await app.inject({ method: 'OPTIONS', url: '/synthetic-command', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' } });
    expect(result.statusCode).toBe(204); expect(result.headers['access-control-allow-headers']).toBe('Content-Type, Authorization, Idempotency-Key');
  });
  it('ignores all forged forwarding headers with zero trusted proxies', async () => {
    const { app } = setup();
    const result = await app.inject({ url: '/synthetic-context', remoteAddress: '192.0.2.10', headers: { host: 'real.test',
      'x-forwarded-for': '198.51.100.2', 'x-forwarded-host': 'forged.test', 'x-forwarded-proto': 'https' } });
    expect(result.json()).toMatchObject({ ip: '192.0.2.10', hostname: 'real.test', protocol: 'http' });
  });
  it('trusts only allowlisted proxy addresses within the configured hop bound', async () => {
    const { app } = setup({ trustedProxyHops: 1, trustedProxyAddresses: ['192.0.2.10'] });
    const headers = { host: 'real.test', 'x-forwarded-for': '203.0.113.1, 198.51.100.2', 'x-forwarded-host': 'proxy.test', 'x-forwarded-proto': 'https' };
    expect((await app.inject({ url: '/synthetic-context', remoteAddress: '192.0.2.10', headers })).json()).toMatchObject({ ip: '198.51.100.2', hostname: 'proxy.test', protocol: 'https' });
    expect((await app.inject({ url: '/synthetic-context', remoteAddress: '192.0.2.11', headers })).json()).toMatchObject({ ip: '192.0.2.11', hostname: 'real.test', protocol: 'http' });
  });
  it('generates unique server-owned IDs matching headers and error correlations', async () => {
    const { app } = setup(); const ids = new Set();
    for (let i = 0; i < 5; i++) {
      const result = await app.inject({ url: '/missing?token=SYN_QUERY', headers: { 'x-request-id': 'SYN_FORGED_ID' } });
      const id = result.headers['x-request-id']; expect(id).toMatch(/^[0-9a-f-]{36}$/); expect(result.json().error.correlation_id).toBe(id); ids.add(id);
      expect(Object.keys(result.json().error).sort()).toEqual(['code', 'correlation_id', 'message']);
    }
    expect(ids.size).toBe(5);
  });
  it('deliberately excludes credentials, cookies, bodies, raw paths and arbitrary errors from logs', async () => {
    const { app, logs } = setup();
    const markers = ['SYN_AUTHORIZATION', 'SYN_COOKIE', 'SYN_BODY_SECRET', 'SYN_QUERY', 'SYN_PATH', 'SYN_SET_COOKIE', 'SYN_RESPONSE_BODY',
      'SYN_DB_URL_PASSWORD_TOKEN', 'SYN_PROVIDER_PAYLOAD', 'SYN_OTP_VERIFIER_ADDRESS'];
    await app.inject({ ...command('{"name":"SYN_BODY_SECRET","nested":{"SYN_OTP_VERIFIER_ADDRESS":true}}'),
      headers: { 'content-type': 'application/json', authorization: 'SYN_AUTHORIZATION', cookie: 'SYN_COOKIE' } });
    await app.inject('/SYN_PATH?token=SYN_QUERY'); await app.inject('/synthetic-private');
    const result = await app.inject('/synthetic-error'); expect(result.statusCode).toBe(500); expect(result.json().error.code).toBe('INTERNAL_ERROR');
    for (const marker of markers) expect(logs.join('') + result.body).not.toContain(marker);
    const records = logs.map(line => JSON.parse(line)); expect(records.some(log => log.event === 'request_completed' && log.status === 500)).toBe(true);
    expect(records.some(log => log.event === 'request_failed' && log.request_id === result.headers['x-request-id'])).toBe(true);
    app.log.error({ err: new Error('SYN_DB_URL_PASSWORD_TOKEN'), req: { headers: { authorization: 'SYN_AUTHORIZATION' }, body: 'SYN_BODY_SECRET' }, password: 'SYN_COOKIE' }, 'Controlled message');
    for (const marker of markers) expect(logs.join('')).not.toContain(marker);
  });
  it('live remains healthy while readiness safely reflects dependency outage and recovery', async () => {
    const { app, database, logs } = setup();
    for (const available of [true, false, true]) {
      database.query.mockImplementation(async () => { if (!available) throw new Error('SYN_DB_URL_PASSWORD_TOKEN'); return { command: 'SELECT', rowCount: 1, oid: 0, fields: [], rows: [] }; });
      expect((await app.inject('/health/live')).statusCode).toBe(200);
      const ready = await app.inject('/health/ready'); expect(ready.statusCode).toBe(available ? 200 : 503);
      if (!available) expect(ready.json().error.code).toBe('TEMPORARILY_UNAVAILABLE');
      expect(ready.body + logs.join('')).not.toContain('SYN_DB_URL_PASSWORD_TOKEN');
    }
  });
  it('router, malformed query and invalid preflight failures use safe correlated envelopes', async () => {
    const { app, logs } = setup();
    for (const options of ['/SYN_PATH_SECRET%zz', '/health/live?token=SYN_QUERY_SECRET%zz',
      { method: 'OPTIONS' as const, url: '/synthetic-command', headers: { origin: 'http://localhost:5173' } }]) {
      const result = await app.inject(options); expect(result.statusCode).toBe(400);
      expect(result.json().error.code).toBe('MALFORMED_REQUEST');
      expect(result.json().error.correlation_id).toBe(result.headers['x-request-id']);
      expect(result.body + logs.join('')).not.toMatch(/SYN_PATH_SECRET|SYN_QUERY_SECRET/);
    }
  });
  it('rate limits unknown routes as well as registered commands', async () => {
    const { app } = setup();
    for (let i = 0; i < 120; i++) expect((await app.inject('/missing')).statusCode).toBe(404);
    expect((await app.inject('/missing')).statusCode).toBe(429);
  });
  it('limits the 121st command without limiting health endpoints', async () => {
    const { app, handler } = setup();
    for (let i = 0; i < 120; i++) expect((await app.inject(command('{"name":"ok"}'))).statusCode).toBe(200);
    const limited = await app.inject(command('{"name":"ok"}')); expect(limited.statusCode).toBe(429); expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeDefined(); expect(handler).toHaveBeenCalledTimes(120);
    for (let i = 0; i < 125; i++) { expect((await app.inject('/health/live')).statusCode).toBe(200); expect((await app.inject('/health/ready')).statusCode).toBe(200); }
  });
});
