import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';

// This check only reads Git and the working tree. A released migration is any
// migration present on the trusted comparison commit; corrections are new files.
let root = process.cwd();
function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('MIGRATION_BASE_UNAVAILABLE');
  return result.stdout;
}

try {
  root = realpathSync(git(['rev-parse', '--show-toplevel']).trim());
  const requested = process.env.MIGRATION_BASE_SHA;
  if (requested !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(requested)) {
    throw new Error('MIGRATION_BASE_UNAVAILABLE');
  }
  const base = git(['rev-parse', '--verify', `${requested ?? 'origin/main'}^{commit}`]).trim();
  const tree = git(['ls-tree', '-rz', '--full-tree', base, '--', 'packages/db/migrations/']);
  let protectedCount = 0;
  for (const entry of tree.split('\0').filter(Boolean)) {
    const match = /^(\d{6}) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (!match) throw new Error('MIGRATION_BASE_UNAVAILABLE');
    const [, mode, type, hash, path] = match;
    if (!/\.(?:cjs|mjs|js|sql)$/i.test(path)) continue;
    protectedCount += 1;
    let unchanged = false;
    try {
      const absolute = resolve(root, path);
      const stat = lstatSync(absolute);
      unchanged = path.startsWith('packages/db/migrations/') && absolute.startsWith(root + sep) &&
        realpathSync(absolute) === absolute && stat.isFile() && type === 'blob' &&
        mode === (stat.mode & 0o111 ? '100755' : '100644') &&
        git(['hash-object', '--no-filters', '--', path]).trim() === hash;
    } catch { /* A missing, renamed or unreadable released migration fails closed. */ }
    if (!unchanged) {
      console.error(`MIGRATION_IMMUTABILITY_VIOLATION: released migration changed or missing: ${JSON.stringify(path)}`);
      process.exitCode = 1;
    }
  }
  if (!process.exitCode) console.log(`Migration history passed: ${protectedCount} released files unchanged; forward additions allowed.`);
} catch {
  console.error('MIGRATION_BASE_UNAVAILABLE: provide a fetched MIGRATION_BASE_SHA or origin/main.');
  process.exitCode = 1;
}
