import { spawnSync } from 'node:child_process';

const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
// -X utf8 makes the existing Unicode contracts work identically on Windows/Linux.
// Refuse optimized Python: the validators intentionally use assertions.
const result = spawnSync(python, ['-X', 'utf8', '-c',
  'import sys, runpy\nif sys.flags.optimize: raise RuntimeError("Python assertions must be enabled")\nrunpy.run_path("scripts/validate_planning.py", run_name="__main__")'], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
// Use this exact Node executable; avoid a different system Node on Windows PATH.
if (process.exitCode === 0) {
  const migration = spawnSync(process.execPath, ['scripts/validate_prototype_migration.mjs'], { stdio: 'inherit' });
  if (migration.error) console.error(migration.error.message);
  process.exitCode = migration.status ?? 1;
}
