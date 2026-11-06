import test from 'node:test';
import assert from 'node:assert/strict';
import { localAccessConfiguration, localFeatureStates } from './local-access.ts';
import { runAccessCommand } from './runtime-access-cli.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const environment = {
  NODE_ENV: 'development', SHIPIT_ENVIRONMENT: 'developer', DATABASE_TLS_MODE: 'disable',
  LOCAL_DATABASE_URL: 'postgresql://db_developer:synthetic@127.0.0.1:5432/shipit_developer',
  MIGRATION_DATABASE_URL: 'postgresql://db_migration:synthetic@127.0.0.1:5432/shipit_developer',
};
await test('local access refuses nonlocal, mismatched and runtime-as-owner targets before connecting', () => {
  assert.equal(localAccessConfiguration(environment, true).runtime.environment, 'developer');
  for (const changed of [
    { NODE_ENV: 'production' }, { SHIPIT_ENVIRONMENT: 'production' }, { DATABASE_TLS_MODE: 'verify-full' },
    { LOCAL_DATABASE_URL: environment.LOCAL_DATABASE_URL.replace('127.0.0.1', 'example.com') },
    { LOCAL_DATABASE_URL: environment.LOCAL_DATABASE_URL.replace('/shipit_developer', '/shipit_production') },
    { LOCAL_DATABASE_URL: environment.LOCAL_DATABASE_URL + '?sslmode=disable' },
    { LOCAL_DATABASE_URL: environment.LOCAL_DATABASE_URL.replace('db_developer', 'postgres') },
    { MIGRATION_DATABASE_URL: environment.LOCAL_DATABASE_URL },
    { MIGRATION_DATABASE_URL: environment.MIGRATION_DATABASE_URL.replace(':5432', ':5433') },
    { MIGRATION_DATABASE_URL: environment.MIGRATION_DATABASE_URL.replace('/shipit_developer', '/other') },
    { MIGRATION_DATABASE_URL: '' },
  ]) assert.throws(() => localAccessConfiguration({ ...environment, ...changed }, true), /^Error: ACCESS_LOCAL_TARGET/);
});

await test('feature summaries retain off/invalid distinctions and never serialize unrelated values', () => {
  const secret = 'SYNTHETIC_DO_NOT_PRINT';
  const states = localFeatureStates({ CASHBOOK_ENABLED: 'true', CUSTODY_ENABLED: 'false', MONEY_RECEIPTS_ENABLED: '1',
    UNKNOWN_ENABLED: secret, LOCAL_AUTH_JSON: secret,
    LOCAL_WHATSAPP_JSON: JSON.stringify({ credentials: { key: secret }, configuration: { outbound_enabled: true, conversation_enabled: false, token: secret } }),
  });
  assert.equal(states.flags.CASHBOOK_ENABLED, 'on');
  assert.equal(states.flags.CUSTODY_ENABLED, 'off');
  assert.equal(states.flags.MONEY_RECEIPTS_ENABLED, 'invalid');
  assert.equal(states.flags.SETTINGS_WRITES_ENABLED, 'off');
  assert.deepEqual(states.whatsapp, { outbound_enabled: 'on', conversation_enabled: 'off' });
  assert.ok(!JSON.stringify(states).includes(secret));
  assert.deepEqual(localFeatureStates({ LOCAL_WHATSAPP_JSON: 'null' }).whatsapp, { configuration: 'invalid' });
});

await test('unsafe commands cannot turn preview into mutation or select arbitrary grant targets', async () => {
  for (const args of [[], ['repair'], ['doctor', '--apply', 'settings'], ['repair', '--apply'],
    ['repair', 'ALL'], ['repair', '--apply', 'settings', 'settings'], ['repair', '--apply', '__proto__'],
    ['repair', 'settings; GRANT ALL'], ['delete', 'settings']]) {
    await assert.rejects(runAccessCommand(args, environment), /^Error: ACCESS_(COMMAND|PROFILE)_INVALID$/);
  }
});

await test('CLI rejects configuration with a safe specific code and never echoes supplied secrets', () => {
  const secret = 'SYNTHETIC_PRIVATE_VALUE';
  const result = spawnSync(process.execPath, ['--experimental-strip-types',
    fileURLToPath(new URL('./runtime-access-cli.ts', import.meta.url)), 'doctor'], {
    encoding: 'utf8', env: { ...process.env, ...environment, NODE_ENV: 'production', LOCAL_DATABASE_URL: secret },
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).code, 'ACCESS_LOCAL_TARGET_INVALID');
  assert.ok(!result.stderr.includes(secret));
});
