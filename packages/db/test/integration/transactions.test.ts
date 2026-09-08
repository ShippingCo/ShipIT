import assert from 'node:assert/strict';
import test from 'node:test';
import { createTenantIsolationFixture, fixtureId } from '@shippingco/testkit';
import { DatabaseError, withTransaction, type DatabasePool } from '../../src/index.ts';
import { provisionDatabase } from '../support.ts';

async function rows(pool: DatabasePool) {
  return (await pool.query<{ id: string; label: string }>('SELECT id, label FROM synthetic.fixture ORDER BY id')).rows;
}

await test('one-client transaction commits both writes, releases and survives pool restart', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1 });
  const fixture = createTenantIsolationFixture();
  const expected = [
    { id: fixture.shipments.alpha1.parcel.id, label: 'synthetic_alpha_1' },
    { id: fixture.shipments.alpha2.parcel.id, label: 'synthetic_alpha_2' },
    { id: fixture.shipments.beta1.parcel.id, label: 'synthetic_beta_1' },
  ];
  const pids: number[] = [];
  const value = await withTransaction(pool, async (tx) => {
    for (const record of expected) {
      const result = await tx.query<{ pid: number }>(
        'INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2) RETURNING pg_backend_pid() AS pid',
        [record.id, record.label]);
      pids.push(result.rows[0]!.pid);
    }
    pids.push((await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
    return 'committed';
  });
  assert.equal(value, 'committed');
  assert.equal(new Set(pids).size, 1);
  assert.deepEqual(await rows(pool), expected);
  assert.deepEqual(pool.stats(), { total: 1, idle: 1, waiting: 0 });
  await pool.close();
  const restarted = database.runtimePool({ maxConnections: 1 });
  assert.deepEqual(await rows(restarted), expected);
});

await test('SQL failure rolls back every write and the released connection remains usable', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1 });
  await assert.rejects(withTransaction(pool, async (tx) => {
    await tx.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(901), 'synthetic_first']);
    await tx.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(901), 'synthetic_duplicate']);
  }), (error: unknown) => error instanceof DatabaseError && error.code === 'DB_QUERY_FAILED');
  assert.deepEqual(await rows(pool), []);
  assert.deepEqual(pool.stats(), { total: 1, idle: 1, waiting: 0 });
  await withTransaction(pool, async (tx) => {
    await tx.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(902), 'synthetic_recovered']);
  });
  assert.deepEqual(await rows(pool), [{ id: fixtureId(902), label: 'synthetic_recovered' }]);
});

await test('application callback failure rolls back successful SQL without partial persistence', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1 });
  const applicationFailure = new Error('SYNTHETIC_APPLICATION_FAILURE');
  await assert.rejects(withTransaction(pool, async (tx) => {
    await tx.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(903), 'synthetic_before_failure']);
    throw applicationFailure;
  }), (error: unknown) => error instanceof DatabaseError && error.code === 'DB_TRANSACTION_FAILED');
  assert.deepEqual(await rows(pool), []);
  assert.equal(pool.stats().idle, 1);
  assert.equal((await pool.query<{ healthy: number }>('SELECT 1 AS healthy')).rows[0]?.healthy, 1);
});

await test('caught SQL errors cannot turn PostgreSQL aborted-transaction rollback into success', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1 });
  await assert.rejects(withTransaction(pool, async (tx) => {
    await tx.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(905), 'synthetic_aborted']);
    await assert.rejects(tx.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(905), 'synthetic_duplicate']));
    return 'must_not_succeed';
  }), (error: unknown) => error instanceof DatabaseError && error.code === 'DB_TRANSACTION_FAILED');
  assert.deepEqual(await rows(pool), []);
  assert.equal(pool.stats().idle, 1);
});

await test('connection loss at commit reports uncertainty, discards connection and permits recovery', { timeout: 20000 }, async (t) => {
  const database = await provisionDatabase(t);
  await database.prepareFixtures();
  const pool = database.runtimePool({ maxConnections: 1 });
  await assert.rejects(withTransaction(pool, async (tx) => {
    await tx.query('INSERT INTO synthetic.fixture (id, label) VALUES ($1, $2)', [fixtureId(904), 'synthetic_uncertain']);
    const result = await tx.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    await database.terminateBackend(result.rows[0]!.pid);
  }), (error: unknown) => error instanceof DatabaseError && error.code === 'DB_COMMIT_UNCERTAIN');
  // This drill deliberately terminates before COMMIT. Future callers receiving
  // uncertainty still cannot infer that every real lost response rolled back.
  assert.deepEqual(await rows(pool), []);
  assert.equal(pool.stats().waiting, 0);
  assert.equal(pool.stats().idle, 1);
});
