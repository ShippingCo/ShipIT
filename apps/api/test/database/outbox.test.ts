import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { paymentSetup,paymentFault } from '../payment-support.ts';
import { createRouteService } from '../../src/modules/routes/service.ts';
import { routeMetadata } from '../route-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createOutboxWorker,PermanentJobFailure } from '../../src/modules/outbox/worker.ts';
import { withOutboxJobScope } from '../../src/modules/security/jobs.ts';
import { scopedQuery } from '../../src/modules/security/scope.ts';
import type { Consumer,Job,Event } from '../../src/modules/outbox/types.ts';
import { runOutboxLoop } from '../../src/outbox-runtime.ts';

const reference=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9:_-]+$/.test(value);
async function setup(t:Parameters<typeof paymentSetup>[0]) {
  const s=await paymentSetup(t);await s.db.prepareOutbox();await s.db.prepareRoutes();
  await s.db.adminQuery(`CREATE TABLE shipit.outbox_synthetic_effects(organization_id uuid NOT NULL,franchise_id uuid NOT NULL,
    event_id uuid NOT NULL,consumer_id text NOT NULL,PRIMARY KEY(event_id,consumer_id))`);
  await s.db.adminQuery(`GRANT SELECT,INSERT ON shipit.outbox_synthetic_effects TO "${s.db.runtimeRole}"`);
  let offset=1000,calls=0;
  const clock=()=>new Date(Date.now()+offset);
  const advance=(ms=31000)=>{offset+=ms;};
  const consumer=(id:string,overrides:Partial<Consumer>={}):Consumer=>({id,subscriptions:{'booking.created':[1],'parcel.booked':[1],'route.created':[1],'payment.settled':[1]},ordering:'H',
    validate:e=>Object.keys(e.payload).length>0&&Object.values(e.payload).every(reference),
    reconcileGap:async()=>true,
    apply:async(scope,event)=>{calls++;await scopedQuery(scope,['outbox.work'],`INSERT INTO shipit.outbox_synthetic_effects(organization_id,franchise_id,event_id,consumer_id)
      SELECT $1::uuid,$2::uuid,$3::uuid,$4::text WHERE {{franchise:$1:$2}}`,[event.organization_id,event.franchise_id,event.event_id,id]);},...overrides});
  const routeService=createRouteService(s.pool,s.keys.browser);
  const route=async(franchise=A,token=s.operator.token,organization=org)=>{
    const k=randomUUID();return routeService.execute(token,null,null,{organization_id:organization,franchise_id:franchise},k,['idempotency-key',k],routeMetadata,'routes.create',randomUUID());
  };
  const count=async(id:string)=>(await s.db.adminQuery<{n:number}>('SELECT count(*)::int n FROM shipit.outbox_synthetic_effects WHERE consumer_id=$1',[id])).rows[0]!.n;
  const job=async(id:string)=>(await s.db.adminQuery<Job>('SELECT * FROM shipit.outbox_jobs WHERE id=$1',[id])).rows[0]!;
  const http=(path:string,token=s.local.token,method:'GET'|'POST'='GET',body?:unknown,key=randomUUID(),franchise=A,organization=org)=>s.app.inject({method,
    url:'/api/v1/outbox/'+path+'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),
    cookies:s.cookies(token),headers:{...s.headers,'idempotency-key':key},...(body?{payload:JSON.stringify(body)}:{})});
  return {...s,clock,advance,consumer,route,count,job,http,calls:()=>calls};
}

await test('outbox replays real producers and survives effect-before-ack crash, stale leases, and uncertain commits',{timeout:60000},async t=>{
  const s=await setup(t);await s.route();assert.equal((await s.pay()).statusCode,200);
  const c=s.consumer('synthetic.history'),worker=createOutboxWorker(s.pool,[c],{clock:s.clock});
  const sourceBefore=(await s.db.adminQuery('SELECT * FROM shipit.domain_events ORDER BY event_id')).rows;
  assert.equal(await worker.relay(c.id),5);assert.equal(await worker.relay(c.id),0);
  const [a,b]=await Promise.all([worker.claim(c.id),worker.claim(c.id)]);
  const first=a??b;assert.ok(first);if(a&&b)assert.notEqual(a.id,b.id);
  assert.equal(await worker.effect(first),null);const effects=await s.count(c.id);assert.equal(effects,1);
  // Process dies here, without acknowledgement. Restart with a fresh pool and recover.
  s.advance();const fresh=s.db.runtimePool();const restarted=createOutboxWorker(fresh,[c],{clock:s.clock});
  for(let i=0;i<8;i++)await restarted.tick();
  assert.equal(await s.count(c.id),5);assert.equal((await s.job(first.id)).state,'completed');
  assert.equal(await restarted.effect(first),'lease_lost');assert.equal(await restarted.acknowledge(first,null),false);
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.domain_events ORDER BY event_id')).rows,sourceBefore);

  const retryConsumer=s.consumer('synthetic.uncertain'),normal=createOutboxWorker(s.pool,[retryConsumer],{clock:s.clock});
  await normal.relay(retryConsumer.id);const claimed=await normal.claim(retryConsumer.id);assert.ok(claimed);
  const uncertain=createOutboxWorker(paymentFault(s.pool,'COMMIT','after'),[retryConsumer],{clock:s.clock});
  assert.equal(await uncertain.effect(claimed),'retryable_failure');assert.equal(await s.count(retryConsumer.id),1);
  assert.equal(await normal.effect(claimed),null);assert.equal(await normal.acknowledge(claimed,null),true);assert.equal(await s.count(retryConsumer.id),1);
  // Failure after a real effect write rolls the effect and receipt back together.
  const next=await normal.claim(retryConsumer.id);assert.ok(next);
  const fault=createOutboxWorker(paymentFault(s.pool,'shipit.outbox_receipt(','before'),[retryConsumer],{clock:s.clock});
  assert.equal(await fault.effect(next),'retryable_failure');assert.equal(await s.count(retryConsumer.id),1);
  assert.equal(await normal.effect(next),null);assert.equal(await s.count(retryConsumer.id),2);
  // A new producer transaction remains invisible until COMMIT, even though the
  // relay has already completed a scan. No watermark can skip this late fact.
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
  const held={...s.pool,async connect(){const client=await s.pool.connect();return {...client,
    async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
      if(sql==='COMMIT'){entered();await gate;}return client.query<Row>(sql,params);
    }};}};
  const creator=createRouteService(held,s.keys.browser),key=randomUUID();
  const pending=creator.execute(s.operator.token,null,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],routeMetadata,'routes.create',randomUUID());
  await started;assert.equal(await worker.relay(c.id),0);release();await pending;assert.equal(await worker.relay(c.id),1);
});

await test('bounded retries, poison quarantine, authorized original redrive and safe operational projections',{timeout:60000},async t=>{
  const s=await setup(t),alerts:string[]=[];
  let repaired=false;
  const c=s.consumer('synthetic.poison',{subscriptions:{'booking.created':[1]},apply:async()=>{if(!repaired)throw new Error('SECRET_SHOULD_NOT_ESCAPE');}});
  const worker=createOutboxWorker(s.pool,[c],{clock:s.clock,random:()=>0,telemetry:{emit:(_event,code)=>alerts.push(code)}});
  await worker.relay(c.id);const first=await worker.claim(c.id);assert.ok(first);
  await worker.acknowledge(first,await worker.effect(first));
  for(let n=1;n<5;n++){s.advance();await worker.tick();}
  const quarantined=await s.job(first.id);assert.equal(quarantined.state,'quarantined');assert.equal(quarantined.attempts,5);assert.equal(quarantined.reason_code,'attempts_exhausted');
  assert.ok(alerts.length>0);s.advance();assert.equal(await worker.claim(c.id),null);
  const reason={expected_version:quarantined.version,reason_code:'dependency_repaired'},key=randomUUID();
  const denied=await s.http('jobs/'+first.id+'/redrive',s.operator.token,'POST',reason,key);assert.equal(denied.statusCode,403);
  const orgDenied=await s.http('jobs/'+first.id+'/redrive',s.admin.token,'POST',reason,key);assert.equal(orgDenied.statusCode,403);
  const redrive=await s.http('jobs/'+first.id+'/redrive',s.local.token,'POST',reason,key);assert.equal(redrive.statusCode,200,redrive.body);
  assert.deepEqual((await s.http('jobs/'+first.id+'/redrive',s.local.token,'POST',reason,key)).json(),redrive.json());
  assert.equal((await s.http('jobs/'+first.id+'/redrive',s.local.token,'POST',{...reason,reason_code:'consumer_upgraded'},key)).statusCode,409);
  assert.equal((await s.http('jobs/'+first.id+'/redrive',s.local.token,'POST',reason)).statusCode,409);
  repaired=true;await worker.tick();assert.equal((await s.job(first.id)).state,'completed');assert.equal((await s.job(first.id)).attempts,6);
  assert.deepEqual((await s.http('jobs/'+first.id+'/redrive',s.local.token,'POST',reason,key)).json(),redrive.json());
  assert.equal((await s.job(first.id)).state,'completed'); // Original replay never resets later progress.
  const detail=await s.http('jobs/'+first.id);assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().attempts.filter((a:{kind:string})=>a.kind==='quarantined').length,1);
  assert.ok(!detail.body.includes('lease_token'));assert.ok(!detail.body.includes('envelope'));assert.ok(!detail.body.includes('SECRET'));
  const audit=await s.list(s.local.token,{resource_type:'outbox_job',resource_id:first.id});assert.equal(audit.statusCode,200,audit.body);
  assert.equal(audit.json().items.length,1);assert.equal(audit.json().items[0].reason_code,'dependency_repaired');
  assert.ok(!s.logs.join('').includes('SECRET_SHOULD_NOT_ESCAPE'));
  const incompatible=s.consumer('synthetic.schema',{subscriptions:{'booking.created':[99]}}),bad=createOutboxWorker(s.pool,[incompatible],{clock:s.clock});
  const calls=s.calls();await bad.tick();assert.equal(s.calls(),calls);
  assert.equal((await s.db.adminQuery('SELECT reason_code FROM shipit.outbox_jobs WHERE consumer_id=$1',[incompatible.id])).rows[0]!.reason_code,'schema_mismatch');
  const permanent=s.consumer('synthetic.permanent',{subscriptions:{'booking.created':[1]},apply:async()=>{throw new PermanentJobFailure();}});
  await createOutboxWorker(s.pool,[permanent],{clock:s.clock}).tick();
  assert.equal((await s.db.adminQuery('SELECT attempts,reason_code FROM shipit.outbox_jobs WHERE consumer_id=$1',[permanent.id])).rows[0]!.attempts,1);
  const crash=s.consumer('synthetic.crashes',{subscriptions:{'booking.created':[1]}}),crashing=createOutboxWorker(s.pool,[crash],{clock:s.clock});
  await crashing.relay(crash.id);let crashed:Job|null=null;
  for(let n=0;n<5;n++){crashed=await crashing.claim(crash.id);assert.ok(crashed);s.advance();}
  assert.equal(await crashing.claim(crash.id),null);assert.equal((await s.job(crashed!.id)).state,'quarantined');
  const beforeAlert=alerts.length;
  await createOutboxWorker(s.pool,[crash],{clock:s.clock,telemetry:{emit:(_e,code)=>alerts.push(code)}}).tick();
  assert.ok(alerts.length>beforeAlert); // Quarantine alert recovers without a runnable job.
});

await test('expired leases are fenced; serialized effects cannot overlap; stale versions and gaps follow consumer policy',{timeout:60000},async t=>{
  const s=await setup(t),c=s.consumer('synthetic.lease',{subscriptions:{'booking.created':[1]}});
  const worker=createOutboxWorker(s.pool,[c],{clock:s.clock});await worker.relay(c.id);
  const old=await worker.claim(c.id);assert.ok(old);s.advance();const current=await worker.claim(c.id);assert.ok(current);
  assert.equal(old.id,current.id);assert.notEqual(old.lease_token,current.lease_token);assert.equal(await worker.effect(old),'lease_lost');
  assert.equal(await worker.acknowledge(old,'permanent_failure'),false);
  let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
  const slow={...c,apply:async(scope:Parameters<Consumer['apply']>[0],event:Event)=>{entered();await gate;await c.apply(scope,event,false);}};
  const running=createOutboxWorker(s.pool,[slow],{clock:s.clock}).effect(current);await started;s.advance();
  assert.equal(await worker.claim(c.id),null);release();assert.equal(await running,'retryable_failure');assert.equal(await s.count(c.id),0);
  const recovered=await worker.claim(c.id);assert.ok(recovered);assert.equal(await worker.effect(recovered),null);assert.equal(await worker.acknowledge(recovered,null),true);

  await s.route(); // Route update creates real revision 2, then process it before revision 1.
  const routeService=createRouteService(s.pool,s.keys.browser),route=await s.route(),k=randomUUID();
  await routeService.execute(s.operator.token,route.id,null,{organization_id:org,franchise_id:A},k,['idempotency-key',k],{...routeMetadata,expected_version:1},'routes.update',randomUUID());
  const projection=s.consumer('synthetic.projection',{subscriptions:{'route.created':[1],'route.updated':[1]},ordering:'P'});
  const p=createOutboxWorker(s.pool,[projection],{clock:s.clock});await p.relay(projection.id);
  // Deterministically place the committed update ahead of its older source fact.
  await s.db.adminQuery(`UPDATE shipit.outbox_jobs j SET available_at=$1 FROM shipit.domain_events e
    WHERE j.event_id=e.event_id AND j.consumer_id=$2 AND e.event_type='route.updated'`,[new Date(0),projection.id]);
  await p.tick();for(let i=0;i<3;i++)await p.tick();
  assert.equal((await s.db.adminQuery(`SELECT count(*)::int n FROM shipit.outbox_receipts r JOIN shipit.outbox_jobs j ON j.id=r.job_id
    WHERE j.consumer_id=$1 AND disposition='skipped_stale'`,[projection.id])).rows[0]!.n,1);
  const gaps=s.consumer('synthetic.gaps',{subscriptions:{'route.updated':[1]},reconcileGap:undefined});
  await createOutboxWorker(s.pool,[gaps],{clock:s.clock}).tick();
  assert.equal((await s.db.adminQuery('SELECT reason_code FROM shipit.outbox_jobs WHERE consumer_id=$1',[gaps.id])).rows[0]!.reason_code,'ordering_gap');
});

await test('tenant round robin survives restart; role, foreign-ID, nested counts and runtime privileges stay isolated',{timeout:90000},async t=>{
  const s=await setup(t),localB=await s.grant('franchise_admin',[B]);
  for(let i=0;i<105;i++)await s.route();await s.route(B,localB.token);
  const c=s.consumer('synthetic.fair',{subscriptions:{'route.created':[1]}}),worker=createOutboxWorker(s.pool,[c],{clock:s.clock});
  assert.equal(await worker.relay(c.id),100);assert.equal(await worker.relay(c.id),1);assert.equal(await worker.relay(c.id),5);
  const one=await worker.claim(c.id);assert.ok(one);
  const two=await createOutboxWorker(s.db.runtimePool(),[c],{clock:s.clock}).claim(c.id);assert.ok(two);
  assert.notEqual(one.franchise_id,two.franchise_id);
  const cAdmin=await s.user();await s.memberships.bootstrapAdministrator(cAdmin.id,otherOrg);
  const cStaff=await s.user();
  const invitation=await s.memberships.createInvitation(cAdmin.token,{organization_id:otherOrg,invitee_user_id:cStaff.id,role:'franchise_admin',franchise_ids:[C]});
  await s.memberships.acceptInvitation(cStaff.token,{token:invitation.acceptance_token});
  await s.route(C,cStaff.token,otherOrg);assert.equal(await worker.relay(c.id),1);
  const cJob=(await s.db.adminQuery<Job>('SELECT * FROM shipit.outbox_jobs WHERE franchise_id=$1 AND consumer_id=$2',[C,c.id])).rows[0]!;
  assert.equal((await s.http('jobs/'+cJob.id)).statusCode,404);
  assert.equal((await s.http('jobs/'+cJob.id+'/redrive',s.local.token,'POST',{expected_version:cJob.version,reason_code:'consumer_upgraded'})).statusCode,404);
  const foreign=one.franchise_id===B?one:two;
  const missing=await s.http('jobs/'+randomUUID()),denied=await s.http('jobs/'+foreign.id);
  assert.equal(missing.statusCode,404);assert.equal(denied.statusCode,404);assert.deepEqual(denied.json().error.code,missing.json().error.code);
  const localJobs=await s.http('jobs');assert.equal(localJobs.statusCode,200);assert.equal(localJobs.json().items.length,50);assert.equal(localJobs.json().page.has_more,true);
  const query=new URLSearchParams({organization_id:org,franchise_id:A,cursor:localJobs.json().page.next_cursor});
  const page=await s.app.inject({url:'/api/v1/outbox/jobs?'+query,cookies:s.cookies(s.local.token)});
  assert.equal(page.statusCode,200,page.body);assert.equal(page.json().items.length,50);
  assert.equal(new Set([...localJobs.json().items,...page.json().items].map((j:Job)=>j.id)).size,100);
  query.set('franchise_id',B);
  assert.equal((await s.app.inject({url:'/api/v1/outbox/jobs?'+query,cookies:s.cookies(s.admin.token)})).json().error.code,'CURSOR_INVALID');
  assert.equal((await s.http('health',s.local.token,'GET',undefined,randomUUID(),B)).statusCode,404);
  assert.equal((await s.http('health',s.local.token,'GET',undefined,randomUUID(),C,otherOrg)).statusCode,404);
  assert.equal((await s.http('health',s.admin.token,'GET',undefined,randomUUID(),B)).statusCode,200);
  for(const role of ['operator','dispatcher','delivery_agent','accountant','read_only']) {
    const user=await s.grant(role,[A]);assert.equal((await s.http('health',user.token)).statusCode,403,role);
    assert.equal((await s.http('jobs/'+one.id+'/redrive',user.token,'POST',{expected_version:one.version,reason_code:'consumer_upgraded'})).statusCode,403,role);
  }
  for(const sql of ['DELETE FROM shipit.outbox_jobs','TRUNCATE shipit.outbox_receipts',
    "UPDATE shipit.outbox_jobs SET state='completed'",'UPDATE shipit.outbox_attempts SET attempt=99',
    'UPDATE shipit.outbox_jobs SET id=gen_random_uuid()'])await assert.rejects(s.pool.query(sql));
  await assert.rejects(s.db.adminQuery('UPDATE shipit.outbox_attempts SET attempt=99'));
  await withOutboxJobScope(s.pool,foreign.id,async scope=>{
    assert.equal(scope.context.organizationId,foreign.organization_id);assert.deepEqual(scope.context.permittedFranchiseIds,[foreign.franchise_id]);
    assert.equal(scope.context.provenance,'trusted-event');
  });
  // Revocation is checked before replay or operational disclosure.
  await s.memberships.revokeMembership(s.admin.token,localB.member.id,{expected_version:1});
  assert.equal((await s.http('health',localB.token,'GET',undefined,randomUUID(),B)).statusCode,404);
  const own=one.franchise_id===A?one:two;
  const noCsrf=await s.app.inject({method:'POST',url:'/api/v1/outbox/jobs/'+own.id+'/redrive?'+new URLSearchParams({organization_id:org,franchise_id:A}),
    cookies:s.cookies(s.local.token),headers:{'content-type':'application/json','idempotency-key':randomUUID()},payload:{expected_version:own.version,reason_code:'dependency_repaired'}});
  assert.equal(noCsrf.statusCode,403);
  for(const body of [{expected_version:1,reason_code:'arbitrary'},{expected_version:1,reason_code:'consumer_upgraded',organization_id:otherOrg}])
    assert.equal((await s.http('jobs/'+own.id+'/redrive',s.local.token,'POST',body)).statusCode,422);
  await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1,lifecycle_changed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[A]);
  assert.equal((await s.http('jobs/'+own.id+'/redrive',s.local.token,'POST',{expected_version:own.version,reason_code:'consumer_upgraded'})).json().error.code,'FRANCHISE_DISABLED');
});

await test('real HTTP operational health and production-clock worker loop run and shut down cleanly',{timeout:30000},async t=>{
  const s=await setup(t),stop=new AbortController();
  const base=s.consumer('synthetic.runtime',{subscriptions:{'booking.created':[1]}});
  const c={...base,apply:async(scope:Parameters<Consumer['apply']>[0],event:Event,historical:boolean)=>{
    await base.apply(scope,event,historical);stop.abort();
  }};
  const address=await s.app.listen({host:'127.0.0.1',port:0});
  const url=address+'/api/v1/outbox/health?'+new URLSearchParams({organization_id:org,franchise_id:A});
  const get=()=>fetch(url,{headers:{cookie:'shipit_session='+s.local.token}});
  assert.equal((await get()).status,200);
  await runOutboxLoop(s.pool,[c],stop.signal,{emit:()=>{}});
  const response=await get();assert.equal(response.status,200);
  const body=await response.json() as {states:{state:string;count:number}[]};assert.equal(body.states.find(s=>s.state==='completed')?.count,1);
  assert.equal(await s.count(c.id),1);
});
