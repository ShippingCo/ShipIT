import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

interface RunnerOptions { signal?: AbortSignal; timeoutMs?: number; graceMs?: number }
interface RunnerCounts { tests: number; passed: number; failed: number; skipped: number; cancelled: number; todo: number }
const runnerPath = new URL('../../../scripts/test-database.mjs', import.meta.url).href;
const { executeDatabaseTests } = await import(runnerPath) as {
  executeDatabaseTests(files: string[], registry: string, options?: RunnerOptions): Promise<RunnerCounts>;
};
async function fixture(source: string, run: (file: string, registry: string, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'shipit-runner-unit-'));
  try {
    const file = join(directory, 'protocol.test.mjs'), registry = join(directory, 'resources.jsonl');
    await writeFile(file, source);
    await writeFile(registry, '', { mode: 0o600 });
    await run(file, registry, directory);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
await test('DB runner command refuses missing or unsafe test config without ordinary DATABASE_URL fallback', () => {
  const testUrl = 'postgresql://db_test:synthetic_refusal_secret@127.0.0.1:1/shipit_refusal_test';
  const ordinaryUrl = 'postgresql://db_production:synthetic_no_fallback@127.0.0.1:1/production';
  const valid = { NODE_ENV: 'test', TEST_DATABASE_URL: testUrl, TEST_DATABASE_IDENTITY: 'db_test' };
  const cases: NodeJS.ProcessEnv[] = [
    { ...valid, NODE_ENV: undefined },
    { ...valid, NODE_ENV: 'production' },
    { ...valid, TEST_DATABASE_URL: undefined },
    { ...valid, TEST_DATABASE_IDENTITY: undefined },
    { ...valid, TEST_DATABASE_IDENTITY: 'db_production' },
    { ...valid, TEST_DATABASE_URL: ordinaryUrl },
    { ...valid, TEST_DATABASE_URL: `${testUrl}?sslmode=no-verify` },
  ];
  for (const configuration of cases) {
    const result = spawnSync(process.execPath, [fileURLToPath(runnerPath)], {
      env: { ...process.env, ...configuration, DATABASE_URL: ordinaryUrl,
        NODE_TEST_CONTEXT: undefined, DB_TEST_RESOURCE_REGISTRY: undefined },
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.trim(), 'DB_TEST_CONFIG_INVALID');
    assert.doesNotMatch(result.stdout + result.stderr, /postgres(?:ql)?:\/\/|synthetic_refusal_secret|synthetic_no_fallback/);
  }
});
await test('DB runner counts real registered tests and ignores raw test output', async () => {
  await fixture(`import test from 'node:test';
    console.log('SYNTHETIC_PRIVATE_STDOUT'); console.error('SYNTHETIC_PRIVATE_STDERR');
    await test('SYNTHETIC_PRIVATE_TEST_NAME', () => {});`, async (file, registry) => {
    assert.deepEqual(await executeDatabaseTests([file], registry), {
      tests: 1, passed: 1, failed: 0, skipped: 0, cancelled: 0, todo: 0,
    });
  });
});
await test('DB runner refuses zero registered tests and skipped, cancelled or todo tests', async () => {
  for (const [source, message] of [
    ['', 'DB_TEST_SUITE_EMPTY'],
    ["import test from 'node:test'; await test.skip('not executed', () => {});", 'DB_TEST_SUITE_INCOMPLETE'],
    ["import test from 'node:test'; await test.todo('not implemented');", 'DB_TEST_SUITE_INCOMPLETE'],
    ["import test from 'node:test'; await test('cancelled', {signal:AbortSignal.abort()}, () => {});", 'DB_TEST_SUITE_INCOMPLETE'],
  ]) {
    await fixture(source!, async (file, registry) => {
      await assert.rejects(executeDatabaseTests([file], registry), { message });
    });
  }
});
await test('DB runner refuses partially empty suites and sanitizes failed assertions', async () => {
  await fixture("import test from 'node:test'; await test('executed', () => {});", async (file, registry, directory) => {
    const empty = join(directory, 'empty.test.mjs');
    await writeFile(empty, '');
    await assert.rejects(executeDatabaseTests([file, empty], registry), { message: 'DB_TEST_SUITE_INCOMPLETE' });
  });
  await fixture(`import test from 'node:test';
    await test('private name', () => { throw new Error('SYNTHETIC_PRIVATE_ERROR'); });`, async (file, registry) => {
    await assert.rejects(executeDatabaseTests([file], registry), { message: 'DB_TEST_EXECUTION_FAILED' });
  });
});
await test('DB runner bounds hung execution and stops the child process group', { timeout: 10000 }, async () => {
  await fixture("import test from 'node:test'; await test('hung', async () => { await new Promise(resolve => setTimeout(resolve, 30000)); });",
    async (file, registry) => {
      const start = performance.now();
      await assert.rejects(executeDatabaseTests([file], registry, { timeoutMs: 250, graceMs: 100 }), { message: 'DB_TEST_TIMEOUT' });
      assert.ok(performance.now() - start < 4000);
    });
});
await test('DB runner signal stops a descendant before returning to registry cleanup', { timeout: 10000 }, async () => {
  await fixture(`import test from 'node:test'; import {spawn} from 'node:child_process';
    import {writeFile} from 'node:fs/promises'; import {dirname,join} from 'node:path';
    await test('descendant', async () => {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
      await writeFile(join(dirname(process.env.DB_TEST_RESOURCE_REGISTRY), 'descendant.pid'), String(child.pid));
      await new Promise(resolve => setTimeout(resolve, 30000));
    });`, async (file, registry, directory) => {
    const controller = new AbortController();
    const execution = executeDatabaseTests([file], registry, { signal: controller.signal, graceMs: 100 });
    const rejected = assert.rejects(execution, { message: 'DB_TEST_INTERRUPTED' });
    let pid: number | undefined;
    try {
      const deadline = performance.now() + 3000;
      while (!pid && performance.now() < deadline) {
        try { pid = Number(await readFile(join(directory, 'descendant.pid'), 'utf8')); }
        catch { await delay(20); }
      }
      assert.ok(pid && Number.isSafeInteger(pid));
      controller.abort();
      await rejected;
      assert.throws(() => process.kill(pid!, 0), (error: unknown) =>
        error instanceof Error && 'code' in error && error.code === 'ESRCH');
    } finally {
      controller.abort();
      await execution.catch(() => {});
      if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
    }
  });
});
