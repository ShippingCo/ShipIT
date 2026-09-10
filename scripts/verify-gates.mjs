import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { parse } from 'yaml';

// Run via pnpm verify:gates. All intentional failures occur in a new disposable
// snapshot. Never modify the developer's checkout, Git index, credentials or .env.
const source = process.cwd();
const pnpm = process.env.npm_execpath;
assert.ok(pnpm && existsSync(pnpm), 'Run through pnpm verify:gates');
const temporaryRoot = realpathSync(tmpdir());
const temporary = mkdtempSync(join(temporaryRoot, 'shipit-quality-'));
const project = join(temporary, 'project');
const logs = join(source, 'node_modules', '.cache', 'quality-verification');
mkdirSync(project);
mkdirSync(logs, { recursive: true });
const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
assert.equal(listed.status, 0, listed.stderr);
const files = new Set(listed.stdout.split('\0').filter(Boolean));
// These files can be hidden by a developer's personal /docs ignore rule.
files.add('docs/QUALITY_CHECKS.md');
files.add('docs/ISSUE_5_VERIFICATION.md');
for (const file of files) {
  if (file.startsWith('.codex/') || file.startsWith('.pnpm-store/') || file.startsWith('node_modules/') ||
      file.startsWith('docs/planning/') || file === '.env' || (file.startsWith('.env.') && file !== '.env.example')) continue;
  const destination = resolve(project, file);
  assert.ok(destination.startsWith(project + sep), 'Snapshot path escaped project');
  if (!existsSync(join(source, file))) continue;
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(join(source, file), destination);
}

let sequence = 0;
function run(label, args, expectedFailure, overrides = {}) {
  const env = { ...process.env, CI: 'true', ...overrides };
  const child = spawnSync(process.execPath, [pnpm, ...args], {
    cwd: project, encoding: 'utf8', timeout: 600_000, maxBuffer: 30 * 1024 * 1024,
    env,
  });
  let output = (child.stdout || '') + (child.stderr || '');
  // Failure evidence must never persist the privileged bootstrap URL/password.
  for (const key of ['TEST_DATABASE_URL', 'DATABASE_URL']) {
    for (const value of new Set([process.env[key], env[key]])) {
      if (!value) continue;
      output = output.replaceAll(value, '[REDACTED_DATABASE_URL]');
      try {
        const password = new URL(value).password;
        if (password) {
          output = output.replaceAll(password, '[REDACTED_DATABASE_PASSWORD]');
          output = output.replaceAll(decodeURIComponent(password), '[REDACTED_DATABASE_PASSWORD]');
        }
      } catch { /* Invalid configuration is deliberately exercised below. */ }
    }
  }
  writeFileSync(join(logs, `${++sequence}-${label}.log`), output);
  assert.equal(child.error, undefined, `${label}: ${child.error?.message}`);
  assert.notEqual(child.status, null, `${label}: terminated without an exit status`);
  if (expectedFailure) {
    assert.notEqual(child.status, 0, `${label}: unexpectedly passed`);
    assert.match(output, expectedFailure, `${label}: failed for the wrong reason; see logs`);
  } else {
    assert.equal(child.status, 0, `${label}: failed; see ${logs}`);
  }
  console.log(`PASS ${label}: exit ${child.status}${expectedFailure ? ' (expected failure)' : ''}`);
}

function finalGateDrill(label, results, expectedStatus) {
  const workflow = parse(readFileSync(join(project, '.github/workflows/ci.yml'), 'utf8'));
  const gate = workflow.jobs.validate.steps[0].run.match(/^node --input-type=module <<'JS'\n([\s\S]+)\nJS\n?$/)?.[1];
  assert.ok(gate, 'Final gate must be the exact executable inline CI body');
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', gate], {
    cwd: project, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, QUALITY_RESULTS: JSON.stringify(results) },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, expectedStatus, label);
  writeFileSync(join(logs, `${++sequence}-${label}.log`), (child.stdout || '') + (child.stderr || ''));
  console.log(`PASS ${label}: exit ${child.status}${expectedStatus ? ' (expected failure)' : ''}`);
}

function withFile(file, content, action) {
  const path = join(project, file);
  const original = existsSync(path) ? readFileSync(path) : null;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  try { action(); } finally {
    if (original) writeFileSync(path, original);
    else rmSync(path);
    if (original) assert.deepEqual(readFileSync(path), original, `${file} was not restored`);
    else assert.equal(existsSync(path), false);
  }
}

try {
  run('empty-store-install', ['install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', join(temporary, 'store')]);
  run('clean-quality', ['quality']);
  withFile('apps/api/src/modules/tenancy/unsafe-regression.ts',
    'export const unsafe = db => db.query(`SELECT * FROM shipit.franchises`);',
    () => run('unscoped-private-query', ['check:tenant-queries'], /TENANT_QUERY_GATE/));
  const manifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'));
  manifest.devDependencies['quality-gate-sentinel'] = '0.0.0';
  withFile('package.json', JSON.stringify(manifest), () =>
    run('lockfile-rejection', ['install', '--frozen-lockfile', '--ignore-scripts', '--store-dir', join(temporary, 'store')], /ERR_PNPM_OUTDATED_LOCKFILE/));
  withFile('packages/shared/src/quality-probe.ts', 'debugger;\n', () =>
    run('lint-rejection', ['lint'], /no-debugger/));
  withFile('packages/shared/src/quality-probe.ts', 'Promise.resolve(1);\n', () =>
    run('promise-rejection', ['lint'], /no-floating-promises/));
  withFile('apps/web/src/quality-probe.tsx', 'export const Probe = () => <button onClick={async () => { await Promise.resolve(); }}>Probe</button>;\n', () =>
    run('async-handler-rejection', ['lint'], /no-misused-promises/));
  withFile('packages/shared/src/quality-probe.ts', 'export const qualityProbe: number = "wrong";\n', () =>
    run('type-rejection', ['typecheck'], /TS2322/));
  withFile('apps/web/src/test/quality-probe.test.ts', 'import { it, expect } from "vitest"; it("quality gate intentional failure", () => { expect(1).toBe(2); });\n', () =>
    run('test-rejection', ['test'], /AssertionError: expected 1 to be 2/));
  withFile('packages/testkit/src/quality-probe.test.ts', 'import assert from "node:assert/strict"; import test from "node:test"; await test("testkit gate intentional failure", () => { assert.fail("TESTKIT_GATE_SENTINEL"); });\n', () =>
    run('testkit-rejection', ['test'], /TESTKIT_GATE_SENTINEL/));
  withFile('apps/api/test/integration/quality-probe.test.ts', 'import {it,expect} from "vitest"; it("API gate intentional failure", () => { expect("API_GATE_SENTINEL").toBe("rejected"); });\n', () =>
    run('api-test-rejection', ['test:api'], /API_GATE_SENTINEL/));
  run('database-missing-config-rejection', ['test:db'], /DB_TEST_CONFIG_INVALID/, {
    NODE_ENV: 'test', TEST_DATABASE_URL: undefined, TEST_DATABASE_IDENTITY: undefined,
  });
  // Ask the OS for an unused loopback port, then close it immediately before the
  // controlled connection failure. Never reuse a production or developer URL.
  const unavailable = createServer();
  await new Promise((resolve, reject) => {
    unavailable.once('error', reject);
    unavailable.listen(0, '127.0.0.1', resolve);
  });
  const address = unavailable.address();
  assert.ok(address && typeof address === 'object');
  await new Promise((resolve, reject) => unavailable.close(error => error ? reject(error) : resolve()));
  run('database-unavailable-rejection', ['test:db'], /DB_TEST_CONNECTION_FAILED/, {
    NODE_ENV: 'test', TEST_DATABASE_IDENTITY: 'db_test',
    TEST_DATABASE_URL: `postgresql://shipit_bootstrap:unavailable-test-only@127.0.0.1:${address.port}/shipit_control_test`,
  });
  const integrationFolder = join(project, 'packages/db/test/integration');
  const integrationFiles = readdirSync(integrationFolder).filter(name => name.endsWith('.test.ts'));
  assert.ok(integrationFiles.length > 0, 'The required PostgreSQL suite must contain tests before the drill');
  const originals = new Map(integrationFiles.map(name => {
    const path = join(integrationFolder, name);
    return [path, readFileSync(path)];
  }));
  function withIntegrationSuite(content, action) {
    try {
      for (const path of originals.keys()) {
        if (content === null) rmSync(path);
        else writeFileSync(path, content);
      }
      action();
    } finally {
      for (const [path, original] of originals) {
        writeFileSync(path, original);
        assert.deepEqual(readFileSync(path), original, 'Integration test was not restored');
      }
    }
  }
  // Preserve the valid inherited bootstrap environment so these reach discovery
  // and execution, rather than passing a drill on a configuration failure.
  withIntegrationSuite(null, () =>
    run('database-empty-suite-rejection', ['test:db'], /DB_TEST_SUITE_EMPTY/));
  withIntegrationSuite('// Intentionally no registered tests in this discovered file.\n', () =>
    run('database-empty-execution-rejection', ['test:db'], /DB_TEST_SUITE_EMPTY/));
  withIntegrationSuite('import test from "node:test"; await test.skip("required database skip sentinel", () => {});\n', () =>
    run('database-skipped-suite-rejection', ['test:db'], /DB_TEST_SUITE_INCOMPLETE/));
  finalGateDrill('final-gate-success', { checks: { result: 'success' }, database: { result: 'success' } }, 0);
  for (const result of ['failure', 'cancelled', 'skipped']) {
    finalGateDrill(`final-gate-database-${result}`, { checks: { result: 'success' }, database: { result } }, 1);
  }
  finalGateDrill('final-gate-database-missing', { checks: { result: 'success' } }, 1);
  const index = readFileSync(join(project, 'apps/web/index.html'), 'utf8');
  withFile('apps/web/index.html', index + '\n<script type="module" src="/src/__quality_missing__.tsx"></script>\n', () =>
    run('build-rejection', ['build'], /__quality_missing__/));
  run('restored-quality', ['quality']);
  console.log(`All gate drills passed. Logs: ${logs}`);
} finally {
  // Verify the final absolute deletion target is the unique directory we created.
  const target = realpathSync(temporary);
  const child = relative(temporaryRoot, target);
  assert.ok(!isAbsolute(child) && !child.startsWith('..') && child.startsWith('shipit-quality-'));
  assert.equal(dirname(target), temporaryRoot);
  rmSync(target, { recursive: true, force: true });
}
