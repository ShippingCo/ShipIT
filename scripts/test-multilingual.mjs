import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeDatabaseTests } from './test-database.mjs';
import { preflightTestDatabase,cleanupRegisteredResources } from '../packages/db/test/support.ts';

await preflightTestDatabase();
const directory=await mkdtemp(join(tmpdir(),'shipit-language-')),registry=join(directory,'resources.jsonl');
await writeFile(registry,'',{mode:0o600});
const controller=new AbortController(),stop=()=>controller.abort();
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try {
 const result=await executeDatabaseTests([
  fileURLToPath(new URL('../apps/api/test/database/multilingual.test.ts',import.meta.url)),
 ],registry,{signal:controller.signal});
 console.log(`Multilingual verification: ${result.passed} passed, 0 failed/skipped/cancelled/todo.`);
}finally {
 try{await cleanupRegisteredResources(registry);}
 finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await rm(directory,{recursive:true});}
}
