/** Loopback-only real API/PostgreSQL browser fixture; run through db:local. */
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanupRegisteredResources } from '../../../packages/db/test/support.ts';
import { randomUUID } from 'node:crypto';
import { org,A } from './audit-support.ts';
import {statementSetup} from './account-statement-support.ts';
import {createMoneyReceiptService} from '../src/modules/payments/receipt-service.ts';
import {createReceivingAccountService} from '../src/modules/payments/account-service.ts';
import { buildServer } from '../src/server.ts';
import { parseEnvironment } from '../src/env.ts';
if(process.env.NODE_ENV!=='test'||process.env.TEST_DATABASE_IDENTITY!=='db_test')throw new Error('SYNTHETIC_FIXTURE_ONLY');
const directory=await mkdtemp(join(tmpdir(),'shipit-reports-browser-')),registry=join(directory,'registry.jsonl');
if(dirname(directory)!==tmpdir())throw new Error('DB_TEST_CLEANUP_FAILED');
await writeFile(registry,'',{mode:0o600});process.env.DB_TEST_RESOURCE_REGISTRY=registry;
const cleanup:(()=>unknown)[]=[],t={after:(f:()=>unknown)=>cleanup.push(f)} as unknown as TestContext;
let finish!:()=>void;const stop=new Promise<void>(resolve=>{finish=resolve;});process.once('SIGINT',finish);process.once('SIGTERM',finish);
try {
  const s=await statementSetup(t),booked=await s.book(),q={organization_id:org,franchise_id:A},headers=['idempotency-key','synthetic'];
  const account=await createReceivingAccountService(s.pool).configure(s.local.token,null,q,randomUUID(),headers,{expected_version:0,name:'Fictional bank',methods:['bank_transfer'],other_method_name:null,active:true},randomUUID());
  await createMoneyReceiptService(s.pool).record(s.operator.token,q,randomUUID(),headers,{customer_id:s.source.id,account_id:account.id,expected_account_version:1,method:'bank_transfer',amount_paise:1500,currency:'INR',receiver_id:s.operator.id,custodian_id:s.operator.id,occurred_at:new Date().toISOString(),external_reference:'SYN_BROWSER',allocations:[{booking_id:booked.id,amount_paise:500,context:'to_pay',expected_payment_version:0}]},randomUUID());
  await s.issue();
  const webOrigin=process.env.REPORT_DEMO_WEB_PORT==='5174'?'http://localhost:5174':'http://localhost:5173';
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3061',LOG_LEVEL:'silent',ALLOWED_ORIGINS:webOrigin,TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const app=buildServer({config,database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined},pricingClock:s.clock});cleanup.push(()=>app.close());
  app.get('/_fixture/session',async(_request,reply)=>{reply.header('Set-Cookie',`shipit_session=${s.local.token}; HttpOnly; SameSite=Strict; Path=/`);return reply.redirect(webOrigin+'/#/business/reports');});
  app.get('/_fixture/stop',()=>{finish();return {stopping:true};});
  await app.listen({host:'127.0.0.1',port:3061});
  console.log('Synthetic Reports fixture: http://localhost:3061/_fixture/session; Vite proxy 3061. Booking day '+booked.charges.confirmed_at.slice(0,10)+'.');
  await stop;
} catch {console.error('SYNTHETIC_REPORT_FIXTURE_FAILED');process.exitCode=1;}
finally {
  for(const close of cleanup.reverse())try{await close();}catch{process.exitCode=1;}
  try{await cleanupRegisteredResources(registry);}catch{process.exitCode=1;}
  await rm(directory,{recursive:true});
}
