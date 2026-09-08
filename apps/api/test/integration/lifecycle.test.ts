import { request } from 'node:http';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { buildServer } from '../../src/server.ts';
import { attachLifecycle, ShutdownError } from '../../src/lifecycle.ts';
import { parseEnvironment } from '../../src/env.ts';
import { startRuntime } from '../../src/runtime.ts';
import { developerSecretResolver } from '../../src/secrets.ts';
import { syntheticEnv, fakeDatabase } from '../support.ts';

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function get(url: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request(url, { agent: false }, res => {
      let body = ''; res.on('data', chunk => { body += String(chunk); });
      res.on('end', () => resolve({ status: res.statusCode!, body })); res.on('error', reject);
    });
    req.on('error', reject); req.setTimeout(2000, () => req.destroy(new Error('TEST_TIMEOUT'))); req.end();
  });
}
it('drains real in-flight HTTP, rejects new work and closes the pool exactly once', async () => {
  const database = fakeDatabase(), entered = deferred(), release = deferred();
  const app = buildServer({ config: parseEnvironment(syntheticEnv), database, logSink: { write: () => {} } });
  const lifecycle = attachLifecycle(app, database);
  app.get('/synthetic-drain', async () => { entered.resolve(); await release.promise; return { status: 'finished' }; });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const inFlight = get(`${url}/synthetic-drain`);
  try {
    await entered.promise;
    const close = lifecycle.shutdown(); expect(lifecycle.shutdown()).toBe(close); expect(lifecycle.isStopping()).toBe(true);
    await new Promise(resolve => setImmediate(resolve));
    const next = await get(`${url}/health/live`).catch(() => null);
    expect(next === null || next.status === 503).toBe(true); expect(database.close).not.toHaveBeenCalled();
    release.resolve(); expect((await inFlight).status).toBe(200); await close;
    expect(app.server.listening).toBe(false); expect(database.close).toHaveBeenCalledOnce();
  } finally { release.resolve(); await app.close(); }
});
it('forces HTTP cleanup at drain expiry, closes DB and reports failure instead of success', async () => {
  const database = fakeDatabase(), entered = deferred(), release = deferred();
  const app = buildServer({ config: parseEnvironment(syntheticEnv), database, logSink: { write: () => {} } });
  const lifecycle = attachLifecycle(app, database, { drainMs: 40, totalMs: 200 });
  app.get('/synthetic-hang', async () => { entered.resolve(); await release.promise; return {}; });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const flight = get(`${url}/synthetic-hang`).catch(() => null);
  try {
    await entered.promise; const start = performance.now();
    await expect(lifecycle.shutdown()).rejects.toThrow(ShutdownError); expect(performance.now() - start).toBeLessThan(1000);
    expect(database.close).toHaveBeenCalledOnce(); expect(await flight).toBeNull();
  } finally { release.resolve(); await app.close(); }
});
it('total deadline bounds stuck DB close and cleanup errors remain controlled', async () => {
  for (const hangs of [true, false]) {
    const database = fakeDatabase(), release = deferred();
    database.close.mockImplementation(async () => { if (hangs) await release.promise; else throw new Error('SYN_DB_CLOSE_PASSWORD'); });
    const app = buildServer({ config: parseEnvironment(syntheticEnv), database, logSink: { write: () => {} } });
    const lifecycle = attachLifecycle(app, database, { drainMs: 40, totalMs: 100 });
    await app.listen({ host: '127.0.0.1', port: 0 });
    try { await expect(lifecycle.shutdown()).rejects.toThrow('SHUTDOWN_FAILED'); expect(database.close).toHaveBeenCalledOnce(); }
    finally { release.resolve(); await app.close().catch(() => {}); }
  }
});
it('startup composes a lazy pool and serves live/503-ready during real connection failure', async () => {
  const config = { ...parseEnvironment(syntheticEnv), port: 0 };
  const runtime = await startRuntime({ config,
    secretResolver: developerSecretResolver(config, 'postgresql://db_developer:SYN_PASSWORD@127.0.0.1:1/shipit_developer'), logSink: { write: () => {} } });
  try {
    expect(runtime.app.server.listening).toBe(true);
    expect((await runtime.app.inject('/health/live')).statusCode).toBe(200);
    expect((await runtime.app.inject('/health/ready')).statusCode).toBe(503);
  } finally { await runtime.shutdown(); }
});
it('listener collision fails startup safely and closes its owned resources', async () => {
  const occupied = createServer(); occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  const address = occupied.address(); if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS');
  const config = { ...parseEnvironment(syntheticEnv), port: address.port };
  try {
    await expect(startRuntime({ config,
      secretResolver: developerSecretResolver(config, 'postgresql://db_developer:SYN_PASSWORD@127.0.0.1:1/shipit_developer'),
      logSink: { write: () => {} } })).rejects.toThrow('STARTUP_FAILED');
  } finally { await new Promise<void>(resolve => occupied.close(() => resolve())); }
});
it('aborted startup never resolves secrets or opens a listener', async () => {
  const resolver = { kind: 'managed' as const, resolve: vi.fn(async () => 'SYN_PASSWORD') };
  await expect(startRuntime({ config: { ...parseEnvironment(syntheticEnv), databaseSecretRef: 'managed/version-1' },
    secretResolver: resolver, signal: AbortSignal.abort() })).rejects.toThrow();
  expect(resolver.resolve).not.toHaveBeenCalled();
});
it('process startup validation is redacted and nonzero', () => {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../../src/index.ts', import.meta.url))], {
    env: { ...process.env, ...syntheticEnv, PORT: 'SYN_STARTUP_SECRET' }, encoding: 'utf8', timeout: 5000,
  });
  expect(child.status).toBe(1); expect(child.stderr).toContain('CONFIGURATION_INVALID'); expect(child.stdout + child.stderr).not.toContain('SYN_STARTUP_SECRET');
});
it.each(['SIGTERM', 'SIGINT'] as const)('process %s shuts down a real listener cleanly', async signal => {
  const reserve = createServer(); reserve.listen(0, '127.0.0.1'); await once(reserve, 'listening');
  const address = reserve.address(); if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS');
  await new Promise<void>(resolve => reserve.close(() => resolve()));
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../../src/index.ts', import.meta.url))], {
    env: { ...process.env, ...syntheticEnv, PORT: String(address.port), LOCAL_DATABASE_URL: 'postgresql://db_developer:SYN_PASSWORD@127.0.0.1:1/shipit_developer' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = ''; child.stderr.on('data', chunk => { output += String(chunk); });
  const exit = once(child, 'exit');
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('TEST_STARTUP_TIMEOUT')), 4000);
      child.stdout.on('data', chunk => { output += String(chunk); if (output.includes('Server listening')) { clearTimeout(timer); resolve(); } });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('TEST_STARTUP_EXIT')); });
    });
    expect((await get(`http://127.0.0.1:${address.port}/health/live`)).status).toBe(200);
    child.kill(signal); expect((await exit)[0]).toBe(0); expect(output).not.toContain('SYN_PASSWORD');
  } finally { if (child.exitCode === null) { child.kill('SIGKILL'); await exit; } }
});

it('malformed and oversized HTTP headers receive safe transport envelopes on real sockets', async () => {
  const logs: string[] = [], database = fakeDatabase();
  const app = buildServer({ config: parseEnvironment(syntheticEnv), database, logSink: { write: line => { logs.push(line); } } });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address(); if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS');
  try {
    for (const [header, expected] of [['Bad Header: SYN_HEADER_SECRET', 400], ['X-Large: ' + 'SYN_HEADER_SECRET'.repeat(2000), 431]] as const) {
      const output = await new Promise<string>((resolve, reject) => {
        const socket = createConnection({ host: '127.0.0.1', port: address.port });
        let received = ''; socket.setTimeout(2000, () => socket.destroy(new Error('TEST_TIMEOUT')));
        socket.on('error', reject); socket.on('data', chunk => { received += String(chunk); });
        socket.on('end', () => resolve(received));
        socket.on('connect', () => socket.end(`GET / HTTP/1.1\r\nHost: example.test\r\n${header}\r\n\r\n`));
      });
      expect(output).toContain(`HTTP/1.1 ${expected}`);
      const body = JSON.parse(output.split('\r\n\r\n')[1]!);
      expect(body.error.correlation_id).toBe(output.match(/X-Request-Id: ([^\r]+)/)?.[1]);
      expect(body.error.code).toBe(expected === 400 ? 'MALFORMED_REQUEST' : 'HEADERS_TOO_LARGE');
      expect(output + logs.join('')).not.toContain('SYN_HEADER_SECRET');
    }
  } finally { await app.close(); }
});
