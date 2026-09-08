import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureId } from '@shippingco/testkit';
import { provisionDatabase } from '../../../../packages/db/test/support.ts';
import { buildServer } from '../../src/server.ts';
import { attachLifecycle } from '../../src/lifecycle.ts';
import { parseEnvironment } from '../../src/env.ts';

const config = parseEnvironment({ NODE_ENV: 'development', HOST: '127.0.0.1', PORT: '3000', LOG_LEVEL: 'info',
  ALLOWED_ORIGINS: 'http://localhost:5173', TRUSTED_PROXY_HOPS: '0', DATABASE_SECRET_REF: 'local:database', DATABASE_TLS_MODE: 'disable' });
await test('API readiness, real outage/recovery and fixture persistence survive server/pool restart', { timeout: 30000 }, async t => {
  const database = await provisionDatabase(t); await database.prepareFixtures();
  const logs: string[] = [];
  for (const iteration of [0, 1]) {
    const pool = database.runtimePool();
    const app = buildServer({ config, database: pool, logSink: { write: message => { logs.push(message); } } });
    const lifecycle = attachLifecycle(app, pool);
    try {
      assert.equal((await app.inject('/health/live')).statusCode, 200);
      assert.equal((await app.inject('/health/ready')).statusCode, 200);
      if (iteration === 0) {
        await pool.query('INSERT INTO synthetic.fixture (id,label) VALUES ($1,$2)', [fixtureId(1100), 'synthetic_persistent_infrastructure']);
        await database.setAvailable(false);
        assert.equal((await app.inject('/health/live')).statusCode, 200);
        const unavailable = await app.inject('/health/ready');
        assert.equal(unavailable.statusCode, 503); assert.equal(unavailable.json().error.code, 'TEMPORARILY_UNAVAILABLE');
        assert.doesNotMatch(unavailable.body, /DB_|postgres|shipit_|password/);
        await database.setAvailable(true);
        assert.equal((await app.inject('/health/ready')).statusCode, 200);
      }
      const stored = await pool.query<{ label: string }>('SELECT label FROM synthetic.fixture WHERE id=$1', [fixtureId(1100)]);
      assert.equal(stored.rows[0]?.label, 'synthetic_persistent_infrastructure');
    } finally { await lifecycle.shutdown(); }
    assert.deepEqual(pool.stats(), { total: 0, idle: 0, waiting: 0 });
  }
  assert.doesNotMatch(logs.join(''), /postgres(?:ql)?:\/\/|password|synthetic_persistent_infrastructure/);
});
