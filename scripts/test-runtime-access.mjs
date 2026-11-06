import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeDatabaseTests } from './test-database.mjs';
import { preflightTestDatabase, cleanupRegisteredResources } from '../packages/db/test/support.ts';

await preflightTestDatabase();
const directory = await mkdtemp(join(tmpdir(), 'shipit-access-'));
if (dirname(directory) !== tmpdir()) throw new Error('DB_TEST_CLEANUP_FAILED');
const registry = join(directory, 'resources.jsonl');
await writeFile(registry, '', { mode: 0o600 });
try {
  const result = await executeDatabaseTests([
    fileURLToPath(new URL('../packages/db/test/integration/runtime-access.test.ts', import.meta.url)),
  ], registry);
  console.log(`Restricted-role access checks: ${result.passed} passed; no business records or external sends.`);
} finally {
  try { await cleanupRegisteredResources(registry); }
  finally { await rm(directory, { recursive: true }); }
}
