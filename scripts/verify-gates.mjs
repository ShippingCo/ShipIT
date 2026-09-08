import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

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
function run(label, args, expectedFailure) {
  const child = spawnSync(process.execPath, [pnpm, ...args], {
    cwd: project, encoding: 'utf8', timeout: 600_000, maxBuffer: 30 * 1024 * 1024,
    env: { ...process.env, CI: 'true' },
  });
  const output = (child.stdout || '') + (child.stderr || '');
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
