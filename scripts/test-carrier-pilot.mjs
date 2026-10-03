import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeDatabaseTests } from './test-database.mjs';
import { preflightTestDatabase,cleanupRegisteredResources } from '../packages/db/test/support.ts';

// The fictional pilot uses the same strict test runner and cleanup as quality.
// No credentials, carrier calls, or retained customer records are involved.
await preflightTestDatabase();
const directory=await mkdtemp(join(tmpdir(),'shipit-carrier-pilot-'));
if(dirname(directory)!==tmpdir())throw new Error('DB_TEST_CLEANUP_FAILED');
const registry=join(directory,'resources.jsonl');
await writeFile(registry,'',{mode:0o600});
try {
  const files=['../apps/api/test/database/carrier-pilot.test.ts','../packages/db/test/integration/carrier-pilot.test.ts']
    .map(path=>fileURLToPath(new URL(path,import.meta.url)));
  const result=await executeDatabaseTests(files,registry);
  console.log(`Fictional Akash Ganga manual pilot: ${result.passed} passed; no live carrier interface selected.`);
} finally {
  try { await cleanupRegisteredResources(registry); }
  finally {
    await rm(directory,{recursive:true});
  }
}
