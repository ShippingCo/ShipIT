import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadLocalEnv, localCommand } from './local.mjs';

test('local env loading supports missing files, multiline JSON and explicit precedence', () => {
  const root = mkdtempSync(join(tmpdir(), 'shippingco-env-'));
  try {
    assert.deepEqual(loadLocalEnv(root, { SHELL: 'kept' }), { SHELL: 'kept' });
    writeFileSync(join(root, '.env.database.local'), 'DATABASE_URL=synthetic-db\nPORT=3000\n');
    writeFileSync(join(root, '.env'), 'PORT=3001\nLOCAL_AUTH_JSON=\'{\n"test": true\n}\'\n');
    writeFileSync(join(root, '.env.local'), 'PORT=3002\nVITE_DATA_MODE=production\n');
    const loaded = loadLocalEnv(root, {});
    assert.equal(loaded.DATABASE_URL, 'synthetic-db');
    assert.equal(loaded.PORT, '3002');
    assert.deepEqual(JSON.parse(loaded.LOCAL_AUTH_JSON), { test: true });
    assert.equal(loadLocalEnv(root, { PORT: '' }).PORT, '');
    assert.equal(loadLocalEnv(root, { PORT: '4000' }).PORT, '4000');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('web imports only public variables and the API proxy from root files', () => {
  const root = mkdtempSync(join(tmpdir(), 'shippingco-env-'));
  try {
    writeFileSync(join(root, '.env'), 'LOCAL_AUTH_JSON=private\nDATABASE_URL=private\nVITE_DATA_MODE=production\nSHIPIT_API_PROXY=http://localhost:3000\n');
    assert.deepEqual(loadLocalEnv(root, { PATH: 'inherited' }, true), {
      VITE_DATA_MODE: 'production', SHIPIT_API_PROXY: 'http://localhost:3000', PATH: 'inherited',
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local commands use the correct workspace and forward arguments without a shell', () => {
  const root = resolve('synthetic-workspace');
  for (const [service, entry, cwd] of [
    ['api', 'apps/api/src/index.ts', 'apps/api'],
    ['worker', 'apps/api/src/outbox-index.ts', 'apps/api'],
    ['migrate', 'packages/db/src/migrate-cli.ts', 'packages/db'],
    ['web', 'apps/web/node_modules/vite/bin/vite.js', 'apps/web'],
  ]) {
    assert.deepEqual(localCommand(service, root, {}, ['--help']), {
      command: process.execPath,
      args: ['--experimental-strip-types', resolve(root, entry), '--help'],
      cwd: resolve(root, cwd),
    });
  }
  assert.deepEqual(localCommand('db', root, { LOCAL_DB_CONTAINER: 'custom-postgres' }), {
    command: 'docker', args: ['start', 'custom-postgres'], cwd: root,
  });
  assert.equal(localCommand('db', root, {}).args[1], 'shipit-postgres-local');
  assert.throws(() => localCommand('db', root, { LOCAL_DB_CONTAINER: '--all' }), /Invalid/);
  assert.throws(() => localCommand('db', root, {}, ['--attach']), /extra arguments/);
  assert.throws(() => localCommand('unknown', root, {}), /Use api/);
});
