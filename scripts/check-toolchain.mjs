import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const expectedNode = readFileSync(new URL('.node-version', root), 'utf8').trim();
const expectedPython = readFileSync(new URL('.python-version', root), 'utf8').trim();
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
assert.equal(process.versions.node, expectedNode, `Use Node ${expectedNode} from .node-version`);
const expectedManager = manifest.packageManager.replace('@', '/');
assert.equal(process.env.npm_config_user_agent?.split(' ')[0], expectedManager,
  `Run this check through ${manifest.packageManager}`);
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, ['-c', 'import platform, sys\nif sys.flags.optimize: raise RuntimeError("Python assertions must be enabled")\nprint(platform.python_version())'], { encoding: 'utf8' });
assert.equal(result.status, 0, result.error?.message || result.stderr);
assert.equal(result.stdout.trim(), expectedPython, `Use Python ${expectedPython}; PYTHON may name its executable`);
console.log(`Toolchain passed: Node ${expectedNode}, ${manifest.packageManager}, Python ${expectedPython}`);
