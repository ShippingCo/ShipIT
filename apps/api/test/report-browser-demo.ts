import {setTimeout as delay} from 'node:timers/promises';
import {createOwnerSummaryService} from '../src/modules/reports/owner-summary-service.ts';
import {createOwnerSummaryWorker} from '../src/modules/reports/owner-summary-worker.ts';
/** Loopback-only real API/PostgreSQL browser fixture; run through db:local. */
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import type { TestContext } from 'node:test';
import { cleanupRegisteredResources } from '../../../packages/db/test/support.ts';
import { randomUUID } from 'node:crypto';
import { org,A } from './audit-support.ts';
import { startTestDelivery,testDeliveryCode } from './delivery-support.ts';
import { paymentSetup,collectionInput } from './payment-support.ts';
import { buildServer } from '../src/server.ts';
import { parseEnvironment } from '../src/env.ts';
if(process.env.NODE_ENV!=='test'||process.env.TEST_DATABASE_IDENTITY!=='db_test')throw new Error('SYNTHETIC_FIXTURE_ONLY');
const directory=await mkdtemp(join(tmpdir(),'shipit-reports-browser-')),registry=join(directory,'registry.jsonl');
if(dirname(directory)!==tmpdir())throw new Error('DB_TEST_CLEANUP_FAILED');
await writeFile(registry,'',{mode:0o600});process.env.DB_TEST_RESOURCE_REGISTRY=registry;
const cleanup:(()=>unknown)[]=[],t={after:(f:()=>unknown)=>cleanup.push(f)} as unknown as TestContext;
let ownerRunId:string|undefined;
let finish!:()=>void;const stop=new Promise<void>(resolve=>{finish=resolve;});process.once('SIGINT',finish);process.once('SIGTERM',finish);
try {
  const s=await paymentSetup(t);await s.db.prepareReports();
  if(process.env.REPORT_DEMO_OWNER==='1'){
    await s.db.prepareOwnerReports();await s.db.prepareSettings();const owner=s.db.ownerPool();
    const today=new Date(Date.now()+19800000).toISOString().slice(0,10),at=Date.parse(today+'T00:00:00+05:30')-3600000;
    await owner.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');await owner.query('UPDATE shipit.bookings SET confirmed_at=$1 WHERE id=$2',[new Date(at),s.bookingId]);await owner.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');
    const paid=await s.pay(collectionInput(6000));if(paid.statusCode!==200)throw new Error('SYNTHETIC_PAYMENT_FAILED');
    await owner.query('ALTER TABLE shipit.payment_entries DISABLE TRIGGER USER');await owner.query('UPDATE shipit.payment_entries SET occurred_at=$1 WHERE id=$2',[new Date(at+60000),paid.json().entry.id]);await owner.query('ALTER TABLE shipit.payment_entries ENABLE TRIGGER USER');
    const service=createOwnerSummaryService(s.pool,true),q={organization_id:org,franchise_id:A},key=randomUUID();
    await service.save(s.local.token,null,q,key,['idempotency-key',key],{expected_version:0,name:'Synthetic daily owner report',timing:{frequency:'daily',timezone:'Asia/Kolkata',minute:0,weekday:1},franchise_ids:[A],recipient_ids:[s.local.id],enabled:true,whatsapp:false,corrections:true,alerts:{enabled:false,notify:false,minimum_paise:'100',minimum_overdue_days:1,repeat_hours:null}},randomUUID());
    const worker=createOwnerSummaryWorker(s.pool,undefined,{enabled:true});await worker.tick();ownerRunId=(await service.workspace(s.local.token,q,randomUUID())).runs.find(r=>r.kind==='summary')?.id;
    const abort=new AbortController(),loop=(async()=>{while(!abort.signal.aborted){await worker.tick();try{await delay(1000,undefined,{signal:abort.signal});}catch{if(!abort.signal.aborted)throw new Error('SYNTHETIC_WORKER_TIMER_FAILED');}}})();cleanup.push(async()=>{abort.abort();await loop;});
  }
  if(process.env.REPORT_DEMO_DAILY==='1'){
    await s.db.prepareRoutes();await s.db.prepareEway();
    const owner=s.db.ownerPool();
    await owner.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');
    await owner.query("UPDATE shipit.bookings SET confirmed_at=statement_timestamp()-interval '1 second' WHERE id=$1",[s.bookingId]);
    await owner.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');
    const paid=await s.pay(collectionInput(6000));if(paid.statusCode!==200)throw new Error('SYNTHETIC_PAYMENT_FAILED');
  }
  if(process.env.REPORT_DEMO_AGEING==='1'){
    const paid=await s.pay(collectionInput(1000));if(paid.statusCode!==200)throw new Error('SYNTHETIC_PAYMENT_FAILED');
    if((await s.reverse(paid.json().entry.id,400)).statusCode!==200)throw new Error('SYNTHETIC_REVERSAL_FAILED');
    const agent=await s.grant('delivery_agent',[A]),parcel=s.booked.parcels[0].id,started=await startTestDelivery(s,parcel,agent);
    const proof=await testDeliveryCode(s,parcel),key=randomUUID();
    await started.service.complete(agent.token,parcel,{organization_id:org,franchise_id:A},key,['Idempotency-Key',key],
      {expected_version:5,challenge_ref:started.state.challenge_ref,challenge_version:started.state.challenge_version,proof},false,randomUUID());
  } else if(process.env.REPORT_DEMO_PAID==='1'){
    const paid=await s.pay(collectionInput(s.gross));if(paid.statusCode!==200)throw new Error('SYNTHETIC_PAYMENT_FAILED');
  }
  const webOrigin=process.env.REPORT_DEMO_WEB_PORT==='5174'?'http://localhost:5174':'http://localhost:5173';
  const config=parseEnvironment({OWNER_SUMMARIES_ENABLED:process.env.REPORT_DEMO_OWNER==='1'?'true':'false',NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3061',LOG_LEVEL:'silent',ALLOWED_ORIGINS:webOrigin,TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const app=buildServer({config,database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined},pricingClock:s.clock});cleanup.push(()=>app.close());
  app.get('/_fixture/session',async(_request,reply)=>{reply.header('Set-Cookie',`shipit_session=${s.local.token}; HttpOnly; SameSite=Strict; Path=/`);return reply.redirect(webOrigin+(ownerRunId?'/#/business/reports?owner_report='+ownerRunId:process.env.REPORT_DEMO_DAILY==='1'?'/#/business':'/#/business/reports'));});
  app.get('/_fixture/stop',()=>{finish();return {stopping:true};});
  await app.listen({host:'127.0.0.1',port:3061});
  console.log('Synthetic Reports fixture: http://localhost:3061/_fixture/session; Vite proxy 3061. Booking day '+s.booked.charges.confirmed_at.slice(0,10)+'.');
  await stop;
} catch {console.error('SYNTHETIC_REPORT_FIXTURE_FAILED');process.exitCode=1;}
finally {
  for(const close of cleanup.reverse())try{await close();}catch{process.exitCode=1;}
  try{await cleanupRegisteredResources(registry);}catch{process.exitCode=1;}
  await rm(directory,{recursive:true});
}
