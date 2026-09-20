import { parseEnvironment } from './env.ts';
import { developerSecretResolver } from './secrets.ts';
import { startOutboxRuntime } from './outbox-runtime.ts';

const controller=new AbortController();
const stop=()=>controller.abort();
process.on('SIGINT',stop);process.on('SIGTERM',stop);
try {
  const config=parseEnvironment(process.env);
  // Hosted #68 composition injects managed identity; local credentials cannot serve hosted modes.
  const resolver=developerSecretResolver(config,process.env.LOCAL_DATABASE_URL);
  await startOutboxRuntime(config,resolver,controller.signal,{emit:(event,code)=>{
    process.stderr.write(JSON.stringify({event,code,recovery_owner:'franchise_admin',runbook:'outbox-quarantine-v1'})+'\n');
  }});
} catch {
  process.stderr.write('{"code":"OUTBOX_RUNTIME_FAILED"}\n');process.exitCode=1;
} finally { process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop); }
