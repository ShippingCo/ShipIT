import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ESLint } from 'eslint';
import { parse } from 'yaml';

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
const checks = ['planning', 'lint', 'types', 'tests', 'build'];
const commands = ['pnpm check:planning', 'pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build'];

test('optimized Python cannot silently disable contract assertions', () => {
  for (const script of ['scripts/check-toolchain.mjs', 'scripts/run-planning.mjs']) {
    const child = spawnSync(process.execPath, [script], {
      encoding: 'utf8', env: { ...process.env, PYTHONOPTIMIZE: '1' },
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /Python assertions must be enabled/);
  }
});

test('workflow runs all five checks on PRs and main without privileged code execution', () => {
  assert.deepEqual(workflow.on, { pull_request: { branches: ['main'] }, push: { branches: ['main'] } });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], true);
  const job = workflow.jobs.checks;
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job['timeout-minutes'], 15);
  assert.equal(job.strategy['fail-fast'], false);
  assert.deepEqual(job.strategy.matrix, { check: checks });
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  for (const step of job.steps) {
    assert.equal(step['continue-on-error'], undefined);
    if (step.uses) assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
  }
  const action = (prefix) => job.steps.find((s) => s.uses?.startsWith(prefix));
  assert.equal(action('actions/checkout@').with['persist-credentials'], false);
  assert.equal(action('actions/checkout@').with['fetch-depth'], 0);
  assert.deepEqual(action('pnpm/action-setup@').with, { run_install: false });
  assert.deepEqual(action('actions/setup-node@').with, {
    'node-version-file': '.node-version', cache: 'pnpm', 'cache-dependency-path': 'pnpm-lock.yaml',
  });
  assert.equal(action('actions/setup-python@').with['python-version-file'], '.python-version');
  const install = job.steps.find((s) => s.run === 'pnpm install --frozen-lockfile --ignore-scripts');
  assert.ok(install);
  assert.equal(install.if, undefined);
  assert.ok(job.steps.find((s) => s.run === 'pnpm check:toolchain' && s.if === undefined));
  for (const [index, command] of commands.entries()) {
    const step = job.steps.find((s) => s.run === command);
    assert.ok(step, command);
    assert.equal(step.if, `matrix.check == '${checks[index]}'`);
  }
  assert.ok(job.steps.find((s) => s.run === 'pnpm test:quality' && s.if === "matrix.check == 'planning'"));
  const migrations = job.steps.find((step) => step.run === 'pnpm check:migrations');
  assert.ok(migrations);
  assert.equal(migrations.if, "matrix.check == 'planning'");
  assert.deepEqual(migrations.env, { MIGRATION_BASE_SHA: '${{ github.event.pull_request.base.sha || github.event.before }}' });
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|pull_request_target|write-all/);
});

test('the exact final CI gate fails closed for failed, cancelled, skipped and absent work', () => {
  const gate = workflow.jobs.validate;
  assert.equal(gate.name, 'Planning and prototype checks');
  assert.deepEqual(gate.needs, ['checks', 'database']);
  assert.equal(gate.if, 'always()');
  assert.equal(gate['timeout-minutes'], 2);
  assert.equal(gate['continue-on-error'], undefined);
  assert.equal(gate.steps.length, 1);
  const step = gate.steps[0];
  assert.deepEqual(step.env, { QUALITY_RESULTS: '${{ toJSON(needs) }}' });
  assert.equal(step.if, undefined);
  assert.equal(step['continue-on-error'], undefined);
  const source = step.run.match(/^node --input-type=module <<'JS'\n([\s\S]+)\nJS\n?$/)?.[1];
  assert.ok(source, 'Expected a single inline node gate, with no checkout dependency');
  const cases = [
    [{ checks: { result: 'success' }, database: { result: 'success' } }, 0],
    ...['failure', 'cancelled', 'skipped', 'neutral', ''].flatMap((result) => [
      [{ checks: { result }, database: { result: 'success' } }, 1],
      [{ checks: { result: 'success' }, database: { result } }, 1],
    ]),
    [{}, 1], [{ checks: {} }, 1], [{ unexpected: { result: 'success' } }, 1],
    [{ checks: { result: 'success' } }, 1], [{ database: { result: 'success' } }, 1],
    [{ checks: { result: 'success' }, database: {} }, 1],
    [{ checks: { result: 'success' }, unexpected: { result: 'success' } }, 1],
    [{ checks: { result: 'success' }, database: { result: 'success' }, unexpected: { result: 'success' } }, 1],
  ];
  for (const [value, status] of cases) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8', env: { ...process.env, QUALITY_RESULTS: JSON.stringify(value) },
    });
    assert.equal(child.status, status, JSON.stringify(value));
  }
});

test('PostgreSQL integration runs unconditionally with pinned tools and disposable infrastructure', () => {
  const job = workflow.jobs.database;
  assert.equal(job.name, 'PostgreSQL integration');
  assert.equal(job['runs-on'], 'ubuntu-24.04');
  assert.equal(job['timeout-minutes'], 15);
  assert.equal(job.if, undefined);
  assert.equal(job['continue-on-error'], undefined);
  for (const step of job.steps) {
    assert.equal(step.if, undefined);
    assert.equal(step['continue-on-error'], undefined);
    if (step.uses) {
      assert.match(step.uses, /^[\w-]+\/[\w-]+@[a-f0-9]{40}$/);
      const reference = workflow.jobs.checks.steps.find((other) => other.uses === step.uses);
      assert.ok(reference, 'Database job must use the same reviewed actions');
      if (step.uses.startsWith('actions/checkout@')) assert.deepEqual(step.with, { 'persist-credentials': false });
      else assert.deepEqual(step.with, reference.with);
    }
  }
  for (const command of ['pnpm check:toolchain', 'pnpm install --frozen-lockfile --ignore-scripts', 'pnpm db:local test:db']) {
    assert.ok(job.steps.some((step) => step.run === command), command);
  }
  assert.equal(job.services, undefined, 'Generated credentials belong to the bounded container helper');
});

test('released migrations are immutable while forward additions are allowed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shipit-migration-history-'));
  const folder = join(directory, 'packages/db/migrations');
  const checker = resolve('scripts/check-migrations.mjs');
  const git = (...args) => {
    const child = spawnSync('git', args, { cwd: directory, encoding: 'utf8', timeout: 10_000 });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, 'Temporary migration-history Git command failed');
    return child.stdout.trim();
  };
  const check = (base, status, diagnostic) => {
    const child = spawnSync(process.execPath, [checker], {
      cwd: directory, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, MIGRATION_BASE_SHA: base },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, status, child.stderr);
    if (diagnostic) assert.match(child.stderr, diagnostic);
  };
  try {
    mkdirSync(folder, { recursive: true });
    git('init', '--quiet');
    const released = ['cjs', 'mjs', 'js', 'sql'].map(extension => join(folder, `1000-released.${extension}`));
    for (const file of released) writeFileSync(file, '-- released migration\n');
    git('add', '.');
    git('-c', 'user.name=Migration Test', '-c', 'user.email=migration-test@example.invalid',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'Released migrations');
    const base = git('rev-parse', 'HEAD');
    git('update-ref', 'refs/remotes/origin/main', base);
    writeFileSync(join(folder, '2000-forward.cjs'), '// new forward migration\n');
    check(base, 0);
    check(undefined, 0);
    for (const file of released) {
      writeFileSync(file, '-- rewritten migration\n');
      check(base, 1, /MIGRATION_IMMUTABILITY_VIOLATION/);
      writeFileSync(file, '-- released migration\n');
    }
    const file = released[0];
    rmSync(file);
    check(base, 1, /MIGRATION_IMMUTABILITY_VIOLATION/);
    writeFileSync(file, '-- released migration\n');
    renameSync(file, join(folder, '3000-renamed.cjs'));
    check(base, 1, /MIGRATION_IMMUTABILITY_VIOLATION/);
    renameSync(join(folder, '3000-renamed.cjs'), file);
    check('0'.repeat(40), 1, /MIGRATION_BASE_UNAVAILABLE/);
    git('update-ref', '-d', 'refs/remotes/origin/main');
    check(undefined, 1, /MIGRATION_BASE_UNAVAILABLE/);
    check(base, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('the disposable PostgreSQL helper guards credentials, propagates failures and cleans only its container', () => {
  const directory = mkdtempSync(join(tmpdir(), 'shipit-docker-helper-'));
  const log = join(directory, 'events.jsonl');
  const state = join(directory, 'owner');
  const manager = join(directory, 'pnpm.mjs');
  const timerModule = join(directory, 'bounded-timeout.mjs');
  const docker = join(directory, 'docker');
  const fakeDocker = `#!${process.execPath}
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const record = (value) => appendFileSync(process.env.HELPER_LOG, JSON.stringify(value) + '\\n');
const id = 'a'.repeat(64);
if (args[0] === 'create') {
  const owner = args[args.indexOf('--label') + 1].split('=')[1];
  writeFileSync(process.env.HELPER_STATE, owner);
  record({ action: 'create', guarded: /^[a-f0-9]{64}$/.test(process.env.POSTGRES_PASSWORD) &&
    !args.some(value => value.includes(process.env.POSTGRES_PASSWORD)), loopback: args.includes('127.0.0.1::5432'),
    pinned: args.some(value => /^postgres:18\\.6-bookworm@sha256:[a-f0-9]{64}$/.test(value)),
    safeStatementLogging: args.slice(-5).join(' ') === 'postgres -c log_statement=none -c log_min_error_statement=panic' });
  if (process.env.HELPER_SCENARIO === 'lost-create') process.exit(1);
  console.log(id);
} else if (args[0] === 'port') console.log('127.0.0.1:54329');
else if (args[0] === 'inspect') console.log(id + ' ' + readFileSync(process.env.HELPER_STATE, 'utf8'));
else if (args[0] === 'container' && args[1] === 'rm') {
  record({ action: 'remove', exact: args.at(-1) === id, volumes: args.includes('--volumes') });
  if (process.env.HELPER_SCENARIO === 'cleanup-failure') process.exit(1);
} else if (!['start', 'exec'].includes(args[0])) process.exit(2);
`;
  const fakeManager = `import { appendFileSync } from 'node:fs';
const url = new URL(process.env.TEST_DATABASE_URL);
appendFileSync(process.env.HELPER_LOG, JSON.stringify({ action: 'command', args: process.argv.slice(2),
  guarded: process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_IDENTITY === 'db_test' &&
    url.hostname === '127.0.0.1' && url.username === 'shipit_bootstrap' &&
    url.pathname === '/shipit_control_test' && /^[a-f0-9]{64}$/.test(url.password) }) + '\\n');
if (process.env.HELPER_SCENARIO === 'signal') {
  process.kill(process.ppid, 'SIGTERM');
  setInterval(() => {}, 1_000);
} else if (process.env.HELPER_SCENARIO === 'timeout') {
  process.on('SIGTERM', () => {
    appendFileSync(process.env.HELPER_LOG, JSON.stringify({ action: 'timeout-signal', signal: 'SIGTERM' }) + '\\n');
    setTimeout(() => process.exit(0), 25);
  });
  setInterval(() => {}, 1_000);
} else process.exit(process.env.HELPER_SCENARIO === 'command-failure' ? 7 : 0);
`;
  try {
    writeFileSync(docker, fakeDocker);
    chmodSync(docker, 0o700);
    writeFileSync(manager, fakeManager);
    // Only the helper's 30-minute command deadline is shortened. The child must
    // still receive TERM and finish its simulated cleanup before the KILL grace.
    writeFileSync(timerModule, 'const original = globalThis.setTimeout; globalThis.setTimeout = (callback, delay, ...args) => original(callback, delay === 30 * 60_000 ? 250 : delay, ...args);\n');
    for (const [scenario, expectedStatus, expectedCommand] of [
      ['success', 0, ['quality']], ['command-failure', 7, ['test:db']],
      ['cleanup-failure', 1, ['test:db']], ['lost-create', 1, null],
      ['signal', 143, ['test:db']],
      ['timeout', 1, ['test:db']],
    ]) {
      writeFileSync(log, '');
      const child = spawnSync(process.execPath, [...(scenario === 'timeout' ? ['--import', timerModule] : []),
        'scripts/with-test-postgres.mjs', ...(scenario === 'success' ? [] : ['test:db'])], {
        encoding: 'utf8', timeout: 15_000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, npm_execpath: manager,
          NODE_ENV: 'production', TEST_DATABASE_URL: 'inherited-unsafe-value', TEST_DATABASE_IDENTITY: 'db_production',
          HELPER_LOG: log, HELPER_STATE: state, HELPER_SCENARIO: scenario },
      });
      assert.equal(child.error, undefined);
      assert.equal(child.status, expectedStatus, scenario);
      const events = readFileSync(log, 'utf8').trim().split('\n').map(value => JSON.parse(value));
      assert.deepEqual(events[0], { action: 'create', guarded: true, loopback: true, pinned: true, safeStatementLogging: true });
      assert.deepEqual(events.at(-1), { action: 'remove', exact: true, volumes: true });
      if (expectedCommand) assert.deepEqual(events[1], { action: 'command', args: expectedCommand, guarded: true });
      else assert.equal(events.length, 2);
      assert.doesNotMatch(child.stdout + child.stderr, /postgres(?:ql)?:\/\/|[a-f0-9]{64}|inherited-unsafe-value/);
      if (scenario === 'cleanup-failure') assert.match(child.stderr, /DB_TEST_LOCAL_CLEANUP_FAILED/);
      if (scenario === 'timeout') {
        assert.deepEqual(events[2], { action: 'timeout-signal', signal: 'SIGTERM' });
        assert.match(child.stderr, /DB_TEST_LOCAL_COMMAND_INTERRUPTED_OR_TIMED_OUT/);
      }
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('lint covers each workspace and detects real faults and stale suppressions', async () => {
  const eslint = new ESLint();
  const examples = [
    ['apps/web/src/quality-probe.ts', 'debugger;', 'no-debugger'],
    ['apps/api/src/quality-probe.ts', 'debugger;', 'no-debugger'],
    ['packages/db/src/quality-probe.ts', 'debugger;', 'no-debugger'],
    ['packages/shared/src/quality-probe.ts', 'debugger;', 'no-debugger'],
    ['apps/web/src/quality-probe.tsx', 'import { useState } from "react"; export function Probe({ show }: { show: boolean }) { if (show) useState(0); return null; }', 'react-hooks/rules-of-hooks'],
    ['apps/web/src/quality-probe.tsx', 'import { useEffect } from "react"; export function Probe({ name }: { name: string }) { useEffect(() => { document.title = name; }, []); return null; }', 'react-hooks/exhaustive-deps'],
    ['scripts/quality-probe.mjs', '// eslint-disable-next-line no-debugger\nconsole.log("ok");', null],
  ];
  for (const [filePath, code, rule] of examples) {
    // Syntax-only probes use the real config with typed rules disabled because the
    // virtual file isn't in a TS project. Actual typed probes run in verify:gates.
    const config = await eslint.calculateConfigForFile(filePath);
    assert.ok(config, `${filePath} must be covered`);
    const probe = new ESLint({ overrideConfig: {
      languageOptions: { parserOptions: { projectService: false, project: false } },
      rules: { '@typescript-eslint/no-floating-promises': 'off', '@typescript-eslint/no-misused-promises': 'off' },
    } });
    const [result] = await probe.lintText(code, { filePath });
    assert.ok(result.messages.some((m) => m.ruleId === rule && m.severity === 2), `${filePath}: ${rule}`);
    assert.equal(result.messages.some((m) => m.fatal), false, 'A parser error is not a rule detection');
  }
});

test('legacy hook exceptions remain narrow, explained and counted', () => {
  const expected = {
    'apps/web/src/pages/business/ReportsPage.tsx': ['L01', 'L01'],
    'apps/web/src/pages/business/EwayPage.tsx': ['L02'],
    'apps/web/src/pages/CustomerWhatsApp.tsx': ['L03'],
    'apps/web/src/pages/business/LotsPage.tsx': ['L04', 'L06'],
    'apps/web/src/pages/business/RoutesPage.tsx': ['L05'],
    'apps/web/src/pages/business/PackagesPage.tsx': ['L07'],
  };
  for (const [path, ids] of Object.entries(expected)) {
    const source = readFileSync(path, 'utf8');
    const comments = [...source.matchAll(/eslint-disable-next-line react-hooks\/exhaustive-deps -- (L\d+): ([^\n]+)/g)];
    assert.deepEqual(comments.map((m) => m[1]), ids);
    for (const comment of comments) assert.match(comment[2], /docs\/QUALITY_CHECKS\.md and issue #7/);
  }
  const sources = readdirSync('apps/web/src', { recursive: true }).filter((p) => /\.tsx?$/.test(p));
  let total = 0;
  for (const path of sources) {
    const normalized = `apps/web/src/${path.replaceAll('\\', '/')}`;
    const directives = readFileSync(normalized, 'utf8').match(/eslint-disable[^\n]*/g) || [];
    if (directives.length) assert.ok(normalized in expected, `Unregistered suppression: ${normalized}`);
    assert.equal(directives.length, expected[normalized]?.length || 0);
    total += directives.length;
  }
  assert.equal(total, 8);
});

test('normal tests include testkit, API and web while frontend remains independent', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(manifest.scripts.test, 'pnpm test:unit && pnpm test:api && pnpm test:web');
  assert.equal(manifest.scripts['test:unit'], 'pnpm --filter @shippingco/testkit test && pnpm --filter @shippingco/db test:unit');
  assert.equal(manifest.scripts['test:api'], 'pnpm --filter @shippingco/api test');
  assert.equal(manifest.scripts['test:web'], 'pnpm --filter @shippingco/web test');
  assert.match(manifest.scripts.quality, /pnpm test &&/);
  assert.match(manifest.scripts.quality, /pnpm test:db && pnpm build$/);
  assert.equal(manifest.scripts['test:db'], 'node scripts/test-database.mjs');
  assert.equal(manifest.scripts['db:local'], 'node scripts/with-test-postgres.mjs');
  assert.equal(JSON.parse(readFileSync('apps/web/package.json', 'utf8')).scripts.test, 'vitest run');
  for (const folder of ['apps', 'packages']) {
    for (const name of readdirSync(folder)) {
      const path = `${folder}/${name}/package.json`;
      const pkg = JSON.parse(readFileSync(path, 'utf8'));
      for (const kind of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
        assert.equal(pkg[kind]?.['@shippingco/testkit'], undefined, `${path}: testkit must be development-only`);
      }
    }
  }
});

test('production imports of test fixtures are rejected but test files can use them', async () => {
  const eslint = new ESLint({ overrideConfig: {
    languageOptions: { parserOptions: { projectService: false, project: false } },
    rules: { '@typescript-eslint/no-floating-promises': 'off', '@typescript-eslint/no-misused-promises': 'off' },
  } });
  for (const filePath of ['apps/web/src/probe.ts', 'apps/api/src/probe.ts', 'packages/shared/src/probe.ts', 'packages/db/src/probe.ts']) {
    for (const target of ['@shippingco/testkit', '../../../packages/testkit/src/index.ts', './test/helper.ts']) {
      const [result] = await eslint.lintText(`import '${target}';`, { filePath });
      assert.ok(result.messages.some(m => m.ruleId === 'no-restricted-imports'), filePath);
      assert.equal(result.messages.some(m => m.fatal), false);
    }
  }
  for (const filePath of ['apps/api/src/probe.test.ts', 'apps/web/src/test/helper.ts']) {
    const [result] = await eslint.lintText("import '@shippingco/testkit';", { filePath });
    assert.equal(result.messages.length, 0);
  }
});
