import assert from 'node:assert/strict';
import test from 'node:test';
import { validateTestDatabaseConfig } from './index.ts';
import type { TestDatabaseEnvironment, TestDatabasePolicy } from './index.ts';
const valid = { NODE_ENV: 'test', TEST_DATABASE_URL: 'postgresql://localhost/shipit_test', TEST_DATABASE_IDENTITY: 'db_test' };
const ci: TestDatabasePolicy = { allowedHosts: ['postgres'], forbiddenHosts: ['primary.example'], forbiddenIdentities: ['db_test_forbidden'] };

await test('missing dedicated configuration, non-test mode and ordinary DATABASE_URL fallback fail closed', () => {
  const cases: TestDatabaseEnvironment[] = [{}, { NODE_ENV: 'test' },
    { ...valid, TEST_DATABASE_URL: undefined }, { ...valid, TEST_DATABASE_IDENTITY: undefined },
    { ...valid, NODE_ENV: 'production' }, { ...valid, NODE_ENV: 'development' }];
  for (const env of cases) assert.throws(() => validateTestDatabaseConfig(env), /UNSAFE_TEST_DATABASE_CONFIGURATION/);
  const ordinaryOnly = { NODE_ENV: 'test', TEST_DATABASE_IDENTITY: 'db_test', DATABASE_URL: valid.TEST_DATABASE_URL };
  assert.throws(() => validateTestDatabaseConfig(ordinaryOnly), /UNSAFE_TEST_DATABASE_CONFIGURATION/);
});
await test('database names, identities, hosts, protocols and connection overrides refuse unsafe targets', () => {
  const targets = ['postgresql://localhost/shipit', 'postgresql://localhost/shipit_testing',
    'postgresql://localhost/shipit_test/extra', 'postgresql://localhost/shipit%5ftest',
    'postgresql://localhost/shipit_test?host=primary.example', 'postgresql://localhost/shipit_test?dbname=shipit',
    'postgresql://localhost/shipit_test#ignored', 'postgresql://localhost/shipit_test?',
    'https://localhost/shipit_test', 'invalid-synthetic-url',
    'postgresql://primary.example/shipit_test', 'postgresql://prod.example/shipit_test',
    'postgresql://staging.example/shipit_test'];
  for (const target of targets) assert.throws(() => validateTestDatabaseConfig({ ...valid, TEST_DATABASE_URL: target }), /UNSAFE_TEST_DATABASE_CONFIGURATION/);
  for (const identity of ['db_production', 'db_staging', 'db_demo', 'db_developer', 'db_test_']) {
    assert.throws(() => validateTestDatabaseConfig({ ...valid, TEST_DATABASE_IDENTITY: identity }), /UNSAFE_TEST_DATABASE_CONFIGURATION/);
  }
});
await test('explicit production host and identity deny rules override even trusted allowlists', () => {
  for (const host of ['primary.example', 'prod.example', 'PRODUCTION.EXAMPLE.']) {
    assert.throws(() => validateTestDatabaseConfig({ ...valid, TEST_DATABASE_URL: `postgresql://${host}/shipit_test` },
      { ...ci, allowedHosts: [host] }), /UNSAFE_TEST_DATABASE_CONFIGURATION/);
  }
  assert.throws(() => validateTestDatabaseConfig({ ...valid, TEST_DATABASE_URL: 'postgresql://postgres/shipit_test', TEST_DATABASE_IDENTITY: 'db_test_forbidden' }, ci), /UNSAFE_TEST_DATABASE_CONFIGURATION/);
});
await test('dedicated local and explicitly approved CI worker targets are accepted', () => {
  const config = validateTestDatabaseConfig(valid);
  assert.equal(config.database, 'shipit_test');
  assert.equal(Object.isFrozen(config), true);
  const worker = validateTestDatabaseConfig({ ...valid, TEST_DATABASE_URL: 'postgresql://postgres:5432/shipit_test_2', TEST_DATABASE_IDENTITY: 'db_test_2' }, ci);
  assert.equal(worker.database, 'shipit_test_2');
  assert.equal(worker.hostname, 'postgres');
  assert.throws(() => validateTestDatabaseConfig({ ...valid, TEST_DATABASE_URL: 'postgresql://postgres/shipit_test' }), /UNSAFE_TEST_DATABASE_CONFIGURATION/);
});
await test('guard errors redact supplied connection material', () => {
  let message = '';
  try { validateTestDatabaseConfig({ ...valid, TEST_DATABASE_URL: 'invalid_synthetic_sensitive_marker' }); }
  catch (error) { message = String(error); }
  assert.equal(message, 'Error: UNSAFE_TEST_DATABASE_CONFIGURATION');
});
