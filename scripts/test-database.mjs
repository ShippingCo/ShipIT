import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { preflightTestDatabase, cleanupRegisteredResources } from '../packages/db/test/support.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
// Empty files pass as wrapper tests. Only per-file summaries prove registration.
// Discard test stdout/stderr and assertions, which may contain private data.
const reporterSource = `export default async function* (source) {
  const files = [], failures = [];
  for await (const event of source) {
    if (event.type === 'test:summary' && event.data.file) {
      const { tests, passed, failed, skipped, cancelled, todo } = event.data.counts;
      files.push({ file: event.data.file, tests, passed, failed, skipped, cancelled, todo });
    }
    if (event.type === 'test:fail') failures.push({ file: event.data.file, line: event.data.line });
  }
  yield JSON.stringify({ files, failures });
}\n`;

function groupExists(child) {
  if (!child.pid) return false;
  try { process.kill(process.platform === 'win32' ? child.pid : -child.pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
  }
  throw new Error('DB_TEST_PROCESS_CLEANUP_FAILED');
}
function signalGroup(child, signal) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill(signal);
    else process.kill(-child.pid, signal);
    return;
  } catch (error) {
    if (error.code === 'ESRCH') return;
  }
  throw new Error('DB_TEST_PROCESS_CLEANUP_FAILED');
}
async function stopGroup(child, graceMs) {
  if (!groupExists(child)) return;
  signalGroup(child, 'SIGTERM');
  const deadline = performance.now() + graceMs;
  while (groupExists(child) && performance.now() < deadline) await delay(20);
  if (!groupExists(child)) return;
  signalGroup(child, 'SIGKILL');
  const forceDeadline = performance.now() + 1000;
  while (groupExists(child) && performance.now() < forceDeadline) await delay(20);
  if (groupExists(child)) throw new Error('DB_TEST_PROCESS_CLEANUP_FAILED');
}

// Test-only protocol seam. The command always performs guarded real-PG preflight.
export async function executeDatabaseTests(files, registry, { signal, timeoutMs = 180_000, graceMs = 3000 } = {}) {
  if (files.length === 0) throw new Error('DB_TEST_SUITE_EMPTY');
  if (signal?.aborted) throw new Error('DB_TEST_INTERRUPTED');
  files = await Promise.all(files.map(file => realpath(file)));
  const reporter = join(dirname(registry), 'reporter.mjs');
  await writeFile(reporter, reporterSource, { mode: 0o600 });
  const env = { ...process.env, DB_TEST_RESOURCE_REGISTRY: registry };
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--experimental-strip-types', '--test', '--test-timeout=60000',
    `--test-reporter=${reporter}`, ...files], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  let output = '', stopped, termination;
  let spawnFailed = false;
  const requestStop = reason => {
    stopped ??= reason;
    termination ??= stopGroup(child, graceMs);
    void termination.catch(() => {}); // The original promise is awaited below.
  };
  const interrupted = () => requestStop('DB_TEST_INTERRUPTED');
  signal?.addEventListener('abort', interrupted, { once: true });
  if (signal?.aborted) interrupted();
  child.stdout.on('data', chunk => {
    if (output.length + chunk.length > 64 * 1024) requestStop('DB_TEST_REPORT_INVALID');
    else output += chunk.toString('utf8');
  });
  child.stderr.resume();
  const timer = setTimeout(() => requestStop('DB_TEST_TIMEOUT'), timeoutMs);
  const completed = new Promise(resolveExit => {
    child.once('error', () => { spawnFailed = true; });
    child.once('close', code => resolveExit(code));
  });
  let status;
  try { status = await completed; }
  finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', interrupted);
    // Stop any grandchildren left behind after the coordinator exits.
    await (termination ?? stopGroup(child, graceMs));
  }
  if (stopped) throw new Error(stopped);
  if (spawnFailed) throw new Error('DB_TEST_EXECUTION_FAILED');
  let report;
  try { report = JSON.parse(output); } catch { throw new Error('DB_TEST_REPORT_INVALID'); }
  if (!report || !Array.isArray(report.files) || !Array.isArray(report.failures)) throw new Error('DB_TEST_REPORT_INVALID');
  const expected = new Set(files.map(file => resolve(file))), seen = new Set();
  const counts = { tests: 0, passed: 0, failed: 0, skipped: 0, cancelled: 0, todo: 0 };
  for (const file of report.files) {
    if (!file || typeof file.file !== 'string' || !expected.has(resolve(file.file)) || seen.has(resolve(file.file))) {
      throw new Error('DB_TEST_REPORT_INVALID');
    }
    seen.add(resolve(file.file));
    for (const key of Object.keys(counts)) {
      if (!Number.isSafeInteger(file[key]) || file[key] < 0) throw new Error('DB_TEST_REPORT_INVALID');
      counts[key] += file[key];
    }
  }
  for (const failure of report.failures) {
    if (failure && typeof failure.file === 'string' && Number.isSafeInteger(failure.line) &&
        failure.line > 0 && expected.has(resolve(failure.file))) {
      console.error(`DB_TEST_FAILURE: ${basename(failure.file)}:${failure.line}`);
    }
  }
  if (counts.skipped > 0 || counts.cancelled > 0 || counts.todo > 0) throw new Error('DB_TEST_SUITE_INCOMPLETE');
  if (status !== 0 || counts.failed > 0) throw new Error('DB_TEST_EXECUTION_FAILED');
  if (counts.tests === 0) throw new Error('DB_TEST_SUITE_EMPTY');
  if (seen.size !== expected.size || counts.passed !== counts.tests) throw new Error('DB_TEST_SUITE_INCOMPLETE');
  return counts;
}

async function main() {
  let temporary;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    await preflightTestDatabase();
    const folder = join(root, 'packages/db/test/integration');
    const files = (await readdir(folder)).filter(name => name.endsWith('.test.ts')).sort().map(name => join(folder, name));
    if (files.length === 0) throw new Error('DB_TEST_SUITE_EMPTY');
    if (controller.signal.aborted) throw new Error('DB_TEST_INTERRUPTED');
    temporary = await mkdtemp(join(tmpdir(), 'shipit-db-tests-'));
    const registry = join(temporary, 'resources.jsonl');
    await writeFile(registry, '', { mode: 0o600 });
    const result = await executeDatabaseTests(files, registry, { signal: controller.signal });
    const apiFolder = join(root, 'apps/api/test/database');
    const apiFiles = (await readdir(apiFolder)).filter(name => name.endsWith('.test.ts')).sort().map(name => join(apiFolder, name));
    const apiResult = await executeDatabaseTests(apiFiles, registry, { signal: controller.signal });
    console.log(`PostgreSQL integration tests: ${result.passed} DB + ${apiResult.passed} API passed, 0 failed/skipped/cancelled/todo.`);
  } catch (error) {
    const safeCodes = ['DB_TEST_CONFIG_INVALID', 'DB_TEST_CONNECTION_FAILED', 'DB_TEST_SUITE_EMPTY',
      'DB_TEST_SUITE_INCOMPLETE', 'DB_TEST_INTERRUPTED', 'DB_TEST_TIMEOUT', 'DB_TEST_EXECUTION_FAILED',
      'DB_TEST_REPORT_INVALID', 'DB_TEST_PROCESS_CLEANUP_FAILED'];
    console.error(error instanceof Error && safeCodes.includes(error.message) ? error.message : 'DB_TEST_SETUP_FAILED');
    process.exitCode = 1;
  } finally {
    if (temporary) {
      try { await cleanupRegisteredResources(join(temporary, 'resources.jsonl')); }
      catch { console.error('DB_TEST_CLEANUP_FAILED'); process.exitCode = 1; }
      try {
        if (dirname(temporary) === tmpdir()) await rm(temporary, { recursive: true });
        else { console.error('DB_TEST_CLEANUP_FAILED'); process.exitCode = 1; }
      } catch { console.error('DB_TEST_CLEANUP_FAILED'); process.exitCode = 1; }
    }
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    if (controller.signal.aborted) process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
