import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Reviewed PostgreSQL 18.6 official image, pinned to its multi-platform manifest.
const image = 'postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af';
const owner = randomBytes(16).toString('hex');
const name = `shipit-db-test-${owner}`;
const password = randomBytes(32).toString('hex');
const pnpm = process.env.npm_execpath;
let activeChild;
let signal;
let creating = false;
let cleaning = false;
let container;

function stopChild(child, requestedSignal) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') child.kill(requestedSignal);
    else process.kill(-child.pid, requestedSignal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function run(command, args, { env = process.env, inherit = false, timeout = 30_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    activeChild = child;
    let output = '';
    let timedOut = false;
    let force;
    // Docker diagnostics can contain configuration. Capture, never relay them.
    child.stdout?.on('data', (chunk) => { if (output.length < 64 * 1024) output += chunk; });
    child.stderr?.resume();
    const timer = setTimeout(() => {
      timedOut = true;
      // The database runner owns a nested test-process group and needs time to
      // stop it and clean its resource registry before a forced outer shutdown.
      stopChild(child, 'SIGTERM');
      force = setTimeout(() => stopChild(child, 'SIGKILL'), 10_000);
    }, timeout);
    child.once('error', () => {
      clearTimeout(timer);
      clearTimeout(force);
      if (activeChild === child) activeChild = undefined;
      resolve({ status: null, output: '' });
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      clearTimeout(force);
      if (activeChild === child) activeChild = undefined;
      resolve({ status: timedOut ? null : status, output });
    });
  });
}

for (const requestedSignal of ['SIGINT', 'SIGTERM']) {
  process.on(requestedSignal, () => {
    signal ??= requestedSignal;
    if (!cleaning) stopChild(activeChild, requestedSignal);
  });
}

function requireSuccess(result, diagnostic) {
  if (signal) throw new Error('DB_TEST_LOCAL_INTERRUPTED');
  if (result.status !== 0) throw new Error(diagnostic);
  return result.output.trim();
}

async function cleanup() {
  cleaning = true;
  if (!creating) return;
  if (!container) {
    // A cancelled/timed-out create may still have succeeded. Inspect only the
    // unique name's ID and ownership label, never configuration or credentials.
    const result = await run('docker', ['inspect', '--format',
      '{{.Id}} {{index .Config.Labels "com.shippingco.test-owner"}}', name]);
    if (result.status !== 0) {
      // Distinguish a known absent container from an unavailable Docker daemon.
      const inventory = await run('docker', ['container', 'ls', '--all', '--quiet',
        '--filter', `name=^/${name}$`]);
      if (inventory.status !== 0 || inventory.output.trim()) throw new Error('DB_TEST_LOCAL_CLEANUP_FAILED');
      return;
    }
    const [id, foundOwner] = result.output.trim().split(' ');
    if (!/^[a-f0-9]{64}$/.test(id) || foundOwner !== owner) throw new Error('DB_TEST_LOCAL_CLEANUP_FAILED');
    container = id;
  }
  const result = await run('docker', ['container', 'rm', '--force', '--volumes', container]);
  if (result.status !== 0) throw new Error('DB_TEST_LOCAL_CLEANUP_FAILED');
  console.log('Disposable PostgreSQL container removed.');
}

try {
  if (!pnpm || !existsSync(pnpm)) throw new Error('DB_TEST_LOCAL_RUN_THROUGH_PNPM');
  creating = true;
  const created = requireSuccess(await run('docker', ['create', '--name', name,
    '--label', `com.shippingco.test-owner=${owner}`,
    '--publish', '127.0.0.1::5432',
    '--env', 'POSTGRES_DB=shipit_control_test', '--env', 'POSTGRES_USER=shipit_bootstrap',
    '--env', 'POSTGRES_PASSWORD', image,
    // Role provisioning contains generated passwords. Intentional negative tests
    // must not cause PostgreSQL to retain their statements in container logs.
    'postgres', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'], {
    env: { ...process.env, POSTGRES_PASSWORD: password }, timeout: 180_000,
  }), 'DB_TEST_LOCAL_CONTAINER_CREATE_FAILED');
  if (!/^[a-f0-9]{64}$/.test(created)) throw new Error('DB_TEST_LOCAL_CONTAINER_CREATE_FAILED');
  container = created;
  requireSuccess(await run('docker', ['start', container]), 'DB_TEST_LOCAL_CONTAINER_START_FAILED');
  const deadline = Date.now() + 60_000;
  let healthy = false;
  while (Date.now() < deadline && !signal) {
    const result = await run('docker', ['exec', container, 'pg_isready',
      '--host=127.0.0.1', '--username=shipit_bootstrap', '--dbname=shipit_control_test', '--quiet'], { timeout: 5_000 });
    if (result.status === 0) { healthy = true; break; }
    await delay(500);
  }
  if (signal) throw new Error('DB_TEST_LOCAL_INTERRUPTED');
  if (!healthy) throw new Error('DB_TEST_LOCAL_POSTGRES_NOT_READY');
  const binding = requireSuccess(await run('docker', ['port', container, '5432/tcp']), 'DB_TEST_LOCAL_PORT_UNAVAILABLE');
  const port = binding.match(/^127\.0\.0\.1:(\d+)$/)?.[1];
  if (!port || Number(port) < 1 || Number(port) > 65_535) throw new Error('DB_TEST_LOCAL_PORT_UNAVAILABLE');
  const args = process.argv.slice(2);
  console.log('Disposable PostgreSQL 18.6 is ready on loopback.');
  const child = await run(process.execPath, [pnpm, ...(args.length ? args : ['quality'])], {
    inherit: true, timeout: 30 * 60_000,
    env: {
      ...process.env, NODE_ENV: 'test', TEST_DATABASE_IDENTITY: 'db_test',
      TEST_DATABASE_URL: `postgresql://shipit_bootstrap:${password}@127.0.0.1:${port}/shipit_control_test`,
    },
  });
  if (child.status === null) throw new Error('DB_TEST_LOCAL_COMMAND_INTERRUPTED_OR_TIMED_OUT');
  process.exitCode = child.status;
} catch (error) {
  // All messages here are controlled diagnostics; never print child errors/env.
  console.error(error.message?.startsWith('DB_TEST_LOCAL_') ? error.message : 'DB_TEST_LOCAL_FAILED');
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch {
    console.error('DB_TEST_LOCAL_CLEANUP_FAILED');
    process.exitCode = 1;
  }
  if (signal) process.exitCode = signal === 'SIGINT' ? 130 : 143;
}
