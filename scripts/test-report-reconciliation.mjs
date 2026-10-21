import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {executeDatabaseTests} from './test-database.mjs';
import {preflightTestDatabase,cleanupRegisteredResources} from '../packages/db/test/support.ts';

// Same guarded runtime-role runner and cleanup as quality. Synthetic sources only.
await preflightTestDatabase();
const directory=await mkdtemp(join(tmpdir(),'shipit-reconciliation-'));
if(dirname(directory)!==tmpdir())throw new Error('DB_TEST_CLEANUP_FAILED');
const registry=join(directory,'resources.jsonl');await writeFile(registry,'',{mode:0o600});
try {
 const files=['report-reconciliation','sales','ageing-accounts','accountant','cash-close',
  'reconciliation','shipment-costs','owner-summary','agent-cod-remittance','eway']
  .map(name=>fileURLToPath(new URL('../apps/api/test/database/'+name+'.test.ts',import.meta.url)));
 const result=await executeDatabaseTests(files,registry);
 console.log(`Issue 67 synthetic cross-report and producer regressions: ${result.passed} passed; 0 failed/skipped/cancelled/todo. No external qualification claimed.`);
}finally{
 try{await cleanupRegisteredResources(registry);}finally{await rm(directory,{recursive:true});}
}
