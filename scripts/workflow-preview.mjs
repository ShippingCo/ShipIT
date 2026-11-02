import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Same operator composition as production, with the guarded disposable API fixture. */
export function workflowPreviewCommands(root, env) {
  if (env.NODE_ENV !== 'test' || env.TEST_DATABASE_IDENTITY !== 'db_test' || !env.TEST_DATABASE_URL) throw new Error('WORKFLOW_PREVIEW_REQUIRES_DISPOSABLE_DATABASE');
  const common = Object.fromEntries(['PATH','HOME','USER','TMPDIR','LANG','TERM'].filter(key => env[key] !== undefined).map(key => [key,env[key]]));
  return [
    {name:'fixture API',args:['--experimental-strip-types',resolve(root,'apps/api/test/counter-demo.ts')],cwd:root,env:{...common,NODE_ENV:'test',TEST_DATABASE_IDENTITY:'db_test',TEST_DATABASE_URL:env.TEST_DATABASE_URL,SHIPIT_COUNTER_PREVIEW_ORIGIN:'http://localhost:5174'}},
    {name:'operator UI',args:[resolve(root,'apps/web/node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','5174','--strictPort'],cwd:resolve(root,'apps/web'),env:{...common,VITE_DATA_MODE:'production',VITE_API_BASE_URL:'',SHIPIT_API_PROXY:'http://127.0.0.1:3033'}},
  ];
}

async function main() {
  const root=resolve(import.meta.dirname,'..');
  const commands=workflowPreviewCommands(root,process.env),children=[];
  let stopping=false,failed=false;
  const stop=()=>{if(stopping)return;stopping=true;for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  console.log('Workflow preview uses the real operator UI with fictional, disposable records. No live provider sends.');
  console.log('When the fixture is ready, open http://localhost:3033/_fixture/session. Ctrl+C stops both services and removes the test database.');
  await Promise.all(commands.map(command=>new Promise(resolveChild=>{
    const child=spawn(process.execPath,command.args,{cwd:command.cwd,env:command.env,stdio:'inherit'});children.push(child);
    child.once('error',()=>{failed=true;console.error(`Could not start ${command.name}. Check dependencies and ports 3033/5174.`);stop();resolveChild();});
    child.once('close',code=>{if(!stopping){failed=code!==0;stop();}resolveChild();});
  })));
  process.exitCode=failed?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(()=>{console.error('WORKFLOW_PREVIEW_START_FAILED');process.exitCode=1;});
