import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import { createDatabaseConfig, createPool, checkDatabaseReadiness, DatabaseError, pgOptions, runMigrations } from './index.ts';
import type { DatabaseConfigInput } from './index.ts';
import { boundedShutdown } from './shutdown.ts';
const input: DatabaseConfigInput = { connectionString: 'postgresql://synthetic:synthetic_fixture_only@localhost/shipit_test',
  environment: 'test', tls: { mode: 'disable' } };
await test('database config requires bounded explicit settings and verified production TLS', () => {
  const config = createDatabaseConfig(input);
  assert.equal(config.maxConnections, 10);
  assert.equal(config.connectionTimeoutMs, 2000);
  assert.equal(config.statementTimeoutMs, 5000);
  assert.equal(config.queryTimeoutMs, 6000);
  assert.equal(Object.isFrozen(config), true);
  assert.throws(() => createDatabaseConfig({ ...input, environment: 'production' }), DatabaseError);
  assert.equal(pgOptions({ ...input, environment: 'production', tls: { mode: 'verify-full' } }).ssl !== false, true);
  for (const extra of [{ maxConnections: 0 }, { maxConnections: 51 }, { connectionTimeoutMs: 0 },
    { idleTimeoutMs: Infinity }, { statementTimeoutMs: -1 }, { queryTimeoutMs: 5000 },
    { idleTransactionTimeoutMs: 0 }, { applicationName: 'private\ncontent' }]) {
    assert.throws(() => createDatabaseConfig({ ...input, ...extra }), { message: 'DB_CONFIG_INVALID' });
  }
});
await test('malformed URLs and override parameters never leak submitted values', () => {
  for (const connectionString of ['invalid_synthetic_marker', 'https://synthetic:fixture@localhost/shipit_test',
    'postgresql://localhost/shipit_test', 'postgresql://synthetic@localhost/shipit_test',
    input.connectionString + '?sslmode=no-verify', input.connectionString + '#private']) {
    assert.throws(() => createDatabaseConfig({ ...input, connectionString }), { message: 'DB_CONFIG_INVALID' });
  }
});
await test('real pg Client parameters cannot inherit password/options/TLS negotiation from ambient PG configuration', async () => {
  const original = { ...process.env };
  try {
    Object.assign(process.env, { PGPASSWORD: 'private_synthetic_marker', PGOPTIONS: '-c search_path=untrusted',
      PGSSLNEGOTIATION: 'private_synthetic_marker', PGSSLMODE: 'no-verify', PGHOST: 'untrusted.example',
      PGPORT: '1', PGDATABASE: 'untrusted', PGUSER: 'untrusted', PGCLIENT_ENCODING: 'SQL_ASCII', PGREPLICATION: 'database' });
    const client = new Client(pgOptions(input));
    const internal = client as unknown as { connectionParameters: {
      password: string; options: string; sslnegotiation: string; replication: string; client_encoding: string;
    } };
    assert.equal(client.host, 'localhost');
    assert.equal(client.database, 'shipit_test');
    assert.equal(client.user, 'synthetic');
    assert.equal(internal.connectionParameters.password, 'synthetic_fixture_only');
    assert.equal(internal.connectionParameters.options, '-c search_path=pg_catalog');
    assert.equal(internal.connectionParameters.sslnegotiation, 'postgres');
    assert.equal(internal.connectionParameters.replication, 'false');
    assert.equal(internal.connectionParameters.client_encoding, 'UTF8');
    assert.equal(client.ssl, false);
    await client.end();
    await assert.rejects(runMigrations({ ...input, connectionString: 'invalid_synthetic_marker' }), { message: 'DB_CONFIG_INVALID' });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
await test('closed pool/client failures and readiness contain controlled codes only', async () => {
  const pool = createPool(input);
  await pool.close();
  await pool.close();
  assert.deepEqual(await checkDatabaseReadiness(pool), { status: 'not_ready', code: 'DB_CLOSED' });
  await assert.rejects(pool.connect(), { message: 'DB_CLOSED' });
});
await test('shutdown deadlines destroy the owned transport and report failure', async () => {
  let destroyed = false;
  await assert.rejects(boundedShutdown(() => new Promise(() => {}), () => { destroyed = true; }, 10), { message: 'DB_SHUTDOWN_FAILED' });
  assert.equal(destroyed, true);
});
