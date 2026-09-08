import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
  assert.doesNotMatch(JSON.stringify(workflow), /secrets\.|pull_request_target|write-all/);
});

test('the exact final CI gate fails closed for failed, cancelled, skipped and absent work', () => {
  const gate = workflow.jobs.validate;
  assert.equal(gate.name, 'Planning and prototype checks');
  assert.deepEqual(gate.needs, ['checks']);
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
    [{ checks: { result: 'success' } }, 0],
    ...['failure', 'cancelled', 'skipped', 'neutral', ''].map((result) => [{ checks: { result } }, 1]),
    [{}, 1], [{ checks: {} }, 1], [{ unexpected: { result: 'success' } }, 1],
    [{ checks: { result: 'success' }, unexpected: { result: 'success' } }, 1],
  ];
  for (const [value, status] of cases) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      encoding: 'utf8', env: { ...process.env, QUALITY_RESULTS: JSON.stringify(value) },
    });
    assert.equal(child.status, status, JSON.stringify(value));
  }
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
