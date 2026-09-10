import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { inspectSource, checkTenantQueries } from './check-tenant-queries.mjs';
const file = 'apps/api/src/modules/example/repository.ts';
test('tenant AST gate accepts maintained sources and a scoped positive control', () => {
  assert.deepEqual(checkTenantQueries(), []);
  assert.deepEqual(inspectSource(file, `import {scopedQuery as run} from '../security/scope.ts';
    export const list = scope => run(scope, ['franchise.profile.read'], 'SELECT id FROM shipit.franchises WHERE {{franchise:organization_id:id}}');`), []);
});
test('tenant AST gate rejects raw, aliased, computed, missing-predicate and issuer bypasses', () => {
  for (const code of [
    'db.query(`SELECT * FROM shipit.franchises`)',
    "db['query']('SELECT * FROM shipit.franchises')",
    'const execute = db.query; execute(sql)',
    "const execute = db['query']; execute(sql)",
    "import * as scope from '../security/scope.ts'; scope.issueTenantAccess(db, claims)",
    'const {query: execute} = db; execute(sql)',
    "import {issueTenantAccess as forge} from '../security/scope.ts'",
    "import {query as execute} from '@shippingco/db'",
    "import {scopedQuery as run} from '../security/scope.ts'; run(scope, ['franchise.profile.read'], 'SELECT * FROM shipit.franchises')",
  ]) assert.ok(inspectSource(file, code).length, code);
});
test('intentionally unscoped repository makes actual checker CLI exit nonzero', () => {
  const root = mkdtempSync(join(tmpdir(), 'shipit-tenant-gate-'));
  try {
    mkdirSync(join(root, 'apps/api/src/modules/example'), {recursive:true});
    writeFileSync(join(root, file), 'export const unsafe = db => db.query(`SELECT * FROM shipit.franchises`);');
    const result = spawnSync(process.execPath, [resolve('scripts/check-tenant-queries.mjs')], {cwd:root,encoding:'utf8'});
    assert.equal(result.status, 1); assert.match(result.stderr, /TENANT_QUERY_GATE/);
  } finally { rmSync(root, {recursive:true,force:true}); }
});
test('organization occupancy authority remains confined to the membership service', () => {
  const source = "import {activeRoleExists,pendingInvitationExists} from '../memberships/authority.ts'";
  assert.deepEqual(inspectSource('apps/api/src/modules/memberships/service.ts', source), []);
  for (const path of [file, 'apps/api/src/modules/example/service.ts']) {
    assert.ok(inspectSource(path, source).some(error => error.includes('authority resolution')));
    assert.ok(inspectSource(path, "export * from '../memberships/authority.ts'").length);
  }
});
