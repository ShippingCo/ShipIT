import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

const repository = resolve(import.meta.dirname, '..');

export function loadLocalEnv(root, inherited = process.env, publicOnly = false) {
  const values = {};
  for (const name of ['.env.database.local', '.env', '.env.local']) {
    let source;
    try {
      source = readFileSync(resolve(root, name), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw new Error(`Cannot read ${name}`, { cause: error });
    }
    for (const [key, value] of Object.entries(parseEnv(source))) {
      if (!publicOnly || key.startsWith('VITE_') || key === 'SHIPIT_API_PROXY') values[key] = value;
    }
  }
  // Shell overrides remain authoritative, including explicit empty values.
  return { ...values, ...inherited };
}

export function localCommand(service, root, env, extra = []) {
  const node = (entry, cwd) => ({
    command: process.execPath,
    args: ['--experimental-strip-types', resolve(root, entry), ...extra],
    cwd: resolve(root, cwd),
  });
  switch (service) {
    case 'api': return node('apps/api/src/index.ts', 'apps/api');
    case 'worker': return node('apps/api/src/outbox-index.ts', 'apps/api');
    case 'migrate': return node('packages/db/src/migrate-cli.ts', 'packages/db');
    case 'web': return node('apps/web/node_modules/vite/bin/vite.js', 'apps/web');
    case 'db': {
      const container = env.LOCAL_DB_CONTAINER || 'shipit-postgres-local';
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Invalid LOCAL_DB_CONTAINER');
      if (extra.length) throw new Error('db:start does not accept extra arguments');
      return { command: 'docker', args: ['start', container], cwd: root };
    }
    default: throw new Error('Use api, web, worker, migrate or db');
  }
}

function main() {
  const [service, ...extra] = process.argv.slice(2);
  const env = loadLocalEnv(repository, process.env, service === 'web');
  const { command, args, cwd } = localCommand(service, repository, env, extra);
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
  const handlers = new Map();
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => child.kill(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  child.once('error', () => {
    console.error(`Could not start ${service}. ${service === 'db' ? 'Check that Docker Desktop is running.' : 'Run pnpm install first.'}`);
    process.exitCode = 1;
  });
  child.once('close', (code, signal) => {
    for (const [name, handler] of handlers) process.off(name, handler);
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1);
    if (service === 'db' && code !== 0) console.error('Start Docker Desktop and check LOCAL_DB_CONTAINER points to your existing database container.');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
