/** Disposable synthetic browser fixture. Run only through pnpm db:local demo:onboarding. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import { withTransaction } from '@shippingco/db';
import { provisionDatabase, cleanupRegisteredResources } from '../../../packages/db/test/support.ts';
import { createAuthService } from '../src/modules/auth/service.ts';
import { AuthRepository } from '../src/modules/auth/repository.ts';
import { digest, secret } from '../src/modules/auth/crypto.ts';
import { buildServer } from '../src/server.ts';
import { parseEnvironment } from '../src/env.ts';

if (process.env.NODE_ENV !== 'test' || process.env.TEST_DATABASE_IDENTITY !== 'db_test') throw new Error('SYNTHETIC_FIXTURE_ONLY');
const temporary = await mkdtemp(join(tmpdir(), 'shipit-onboarding-demo-'));
const registry = join(temporary, 'registry.jsonl');
await writeFile(registry, '', { mode: 0o600 });
process.env.DB_TEST_RESOURCE_REGISTRY = registry;
const cleanup: (() => unknown)[] = [];
let finish!: () => void;
const stopped = new Promise<void>(resolve => { finish = resolve; });
process.once('SIGINT', finish); process.once('SIGTERM', finish);
try {
  const db = await provisionDatabase({ after: (fn: () => unknown) => { cleanup.push(fn); } } as unknown as TestContext);
  await db.prepareMemberships();
  const pool = db.runtimePool(), keys = { version: 'synthetic', verifier: randomBytes(32), encryption: randomBytes(32), browser: randomBytes(32) };
  const auth = createAuthService(pool, keys), userId = await auth.provision('email', 'independent-shop@example.test');
  const config = parseEnvironment({ NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable' });
  const app = buildServer({ config, database: pool, auth: { keys, delivery: {}, webhook: undefined } });
  // In-memory fixture session issued only for this generated test DB; no secrets printed.
  app.get('/_fixture/session', async (_request, reply) => {
    const token = secret();
    await withTransaction(pool, async tx => { const repo = new AuthRepository(tx); await repo.newSession((await repo.user(userId))!, digest(token)); });
    reply.header('Set-Cookie', `shipit_session=${token}; HttpOnly; SameSite=Strict; Path=/`);
    return reply.redirect('http://localhost:5173/#/business');
  });
  app.get('/_fixture/disable', async (_request, reply) => {
    await auth.changeAccount(userId, 'disabled');
    return reply.redirect('http://localhost:5173/#/business/settings');
  });
  await app.listen({ host:'127.0.0.1',port:3017 });
  cleanup.push(() => app.close());
  console.log('Synthetic fixture ready: open http://localhost:3017/_fixture/session with pnpm dev running.');
  await stopped;
} catch {
  console.error('SYNTHETIC_FIXTURE_FAILED'); process.exitCode = 1;
} finally {
  for (const close of cleanup.reverse()) { try { await close(); } catch { process.exitCode = 1; } }
  try { await cleanupRegisteredResources(registry); } catch { process.exitCode = 1; }
  await rm(temporary, { recursive: true, force: true });
}
