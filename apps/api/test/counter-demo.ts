/** Guarded, disposable #33 browser fixture; no production data or credentials printed. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanupRegisteredResources } from '../../../packages/db/test/support.ts';
import { attachmentSetup } from './attachment-support.ts';
import { org,A,B } from './audit-support.ts';
import { buildServer } from '../src/server.ts';
import { parseEnvironment } from '../src/env.ts';
if(process.env.NODE_ENV!=='test'||process.env.TEST_DATABASE_IDENTITY!=='db_test')throw new Error('SYNTHETIC_FIXTURE_ONLY');
const temp=await mkdtemp(join(tmpdir(),'shipit-counter-')),registry=join(temp,'registry.jsonl');
await writeFile(registry,'',{mode:0o600});process.env.DB_TEST_RESOURCE_REGISTRY=registry;
const cleanup:(()=>unknown)[]=[],t={after:(f:()=>unknown)=>cleanup.push(f)} as unknown as TestContext;
let finish!:()=>void;const stop=new Promise<void>(resolve=>{finish=resolve;});process.once('SIGINT',finish);process.once('SIGTERM',finish);
try {
 const s=await attachmentSetup(t);await s.db.preparePayments();await s.db.prepareReceipts();
 const actor=await s.grant('operator',[A,B]);
 const invite=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:actor.id,role:'franchise_admin',franchise_ids:[A]});await s.memberships.acceptInvitation(actor.token,{token:invite.acceptance_token});
 const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3033',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
 const app=buildServer({config,database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined},pricingClock:()=>new Date('2099-01-01T00:00:00Z'),attachments:s.deps});cleanup.push(()=>app.close());
 app.addHook('onRequest',async request=>{if(request.url.includes('/customers?')&&request.url.includes('/'+A+'/'))await new Promise(resolve=>setTimeout(resolve,2500));});
 app.get('/_fixture/session',async(_request,reply)=>{reply.header('Set-Cookie',`shipit_session=${actor.token}; HttpOnly; SameSite=Strict; Path=/`);return reply.redirect('http://localhost:5173/#/business/new-booking');});
 await app.listen({host:'127.0.0.1',port:3033});
 console.log('Synthetic #33 fixture: http://localhost:3033/_fixture/session (Vite proxy port 3033). Rate SYN_DEST / standard / 999g; unregistered handover 27; references SYN_BUYER / SYN_HANDOVER. A customer searches wait 2.5 seconds for scope-race verification.');
 await stop;
} catch {console.error('SYNTHETIC_COUNTER_FIXTURE_FAILED');process.exitCode=1;}
finally {for(const close of cleanup.reverse())try{await close();}catch{process.exitCode=1;}try{await cleanupRegisteredResources(registry);}catch{process.exitCode=1;}await rm(temp,{recursive:true,force:true});}
