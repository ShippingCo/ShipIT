import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupAgentMoney} from '../agent-money-support.ts';
import {paymentFault} from '../payment-support.ts';
import {startTestDelivery,testDeliveryCode} from '../delivery-support.ts';
import {createAgentFeeService} from '../../src/modules/agent-settlements/fee-service.ts';
import {createAgentCashCaptureService} from '../../src/modules/agent-settlements/cash-capture-service.ts';
import {createAgentStatementService} from '../../src/modules/agent-settlements/statement-service.ts';
import {buildServer} from '../../src/server.ts';
import {parseEnvironment} from '../../src/env.ts';
import {browserToken,csrf} from '../../src/modules/auth/crypto.ts';
import {org,A,B} from '../audit-support.ts';
const q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
async function counted(s:Awaited<ReturnType<typeof setupAgentMoney>>,actor=s.agent,amount=210000){
 await new Promise(resolve=>setTimeout(resolve,5));const counted_at=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(counted_at)),key=randomUUID();
 return createAgentCashCaptureService(s.pool,true).capture(actor.token,q,key,headers(key),{agent_id:s.agent.id,day,counted_at,counted_paise:amount,reason:'Synthetic settlement cash count'},randomUUID());
}
await test('settlement revisions require independent review, replay uncertain commits once, emit trusted evidence and never create money or fee effects',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),reviewer=await s.grant('franchise_admin',[A]),third=await s.grant('franchise_admin',[A]),sibling=await s.grant('franchise_admin',[B]),accountant=await s.grant('accountant',[A]),readonly=await s.grant('read_only',[A]);
 const fees=createAgentFeeService(s.pool,true),termsKey=randomUUID(),now=Date.now(),terms=await fees.configure(s.local.token,s.agent.id,q,termsKey,headers(termsKey),{expected_version:0,basis:'per_delivery',amount_paise:4000,currency:'INR',valid_from:new Date(now-86400000).toISOString(),valid_until:new Date(now+86400000).toISOString(),active:true},randomUUID());
 const parcel=(await s.db.adminQuery('SELECT id FROM shipit.parcels WHERE booking_id=$1 LIMIT 1',[s.bookingId])).rows[0]!.id,live={...s,clock:()=>new Date()},start=await startTestDelivery(live,parcel,s.agent),code=await testDeliveryCode(live,parcel),proofKey=randomUUID();
 await start.service.complete(s.agent.token,parcel,q,proofKey,headers(proofKey),{expected_version:5,challenge_ref:start.state.challenge_ref,challenge_version:start.state.challenge_version,proof:code},false,randomUUID());
 const proof=(await s.db.adminQuery('SELECT id FROM shipit.delivery_proofs WHERE parcel_id=$1',[parcel])).rows[0]!.id,earnKey=randomUUID();await fees.earn(s.local.token,q,earnKey,headers(earnKey),{proof_id:proof,term_revision_id:terms.resource_id},randomUUID());
 const service=createAgentStatementService(s.pool,true),off=createAgentStatementService(s.pool),cap=await counted(s,s.operator),body={capture_id:cap.id,previous_submission_id:null,expected_version:0,reason:'Synthetic cash, COD and earned fee statement'};
 const version=(await s.position()).source_version,moneyBefore=(await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n;
 const badKey=randomUUID();await assert.rejects(createAgentStatementService(paymentFault(s.pool,'INSERT INTO shipit.agent_settlement_submissions','before'),true).submit(s.operator.token,q,badKey,headers(badKey),body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_settlement_submissions')).rows[0]!.n,0);
 const key=randomUUID();await assert.rejects(createAgentStatementService(paymentFault(s.pool,'COMMIT','after'),true).submit(s.operator.token,q,key,headers(key),body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const replay=await Promise.all([service.submit(s.operator.token,q,key,headers(key),body,randomUUID()),off.submit(s.operator.token,q,key,headers(key),body,randomUUID())]);assert.deepEqual(replay[0],replay[1]);const submitted=replay[0]!;
 assert.equal(submitted.revision,1);const opened=await service.read(s.agent.token,submitted.id,q,randomUUID());assert.equal(opened.status,'pending');assert.deepEqual(opened.source_snapshot,cap.source_snapshot);
 const finance=opened.source_snapshot.finance as {totals:{origin_receipt_seller_liability_paise:string;freight_applied_paise:string;earned_fee_paise:string;remaining_fee_paise:string}};
 assert.equal(finance.totals.origin_receipt_seller_liability_paise,'200000');assert.equal(finance.totals.freight_applied_paise,'10000');assert.equal(finance.totals.earned_fee_paise,'4000');assert.equal(finance.totals.remaining_fee_paise,'4000');
 assert.equal((await service.read(accountant.token,submitted.id,q,randomUUID())).id,submitted.id);
 await assert.rejects(service.read(s.second.token,submitted.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});await assert.rejects(service.read(sibling.token,submitted.id,{...q,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.submit(s.operator.token,q,key,headers(key),{...body,reason:'Conflicting intent'},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 const noKey=randomUUID();await assert.rejects(service.decide(s.agent.token,submitted.id,q,noKey,headers(noKey),{kind:'approve',expected_version:1,reason:'Denied agent review'},randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.submit(accountant.token,q,noKey,headers(noKey),body,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.submit(s.admin.token,q,noKey,headers(noKey),body,randomUUID()),{code:'ACTION_FORBIDDEN'});await assert.rejects(service.submit(readonly.token,q,noKey,headers(noKey),body,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const correctionCap=await counted(s,s.local,209000),correctionKey=randomUUID(),correction=await service.submit(s.local.token,q,correctionKey,headers(correctionKey),{capture_id:correctionCap.id,previous_submission_id:submitted.id,expected_version:1,reason:'Synthetic explained count correction'},randomUUID());
 assert.equal(correction.revision,2);assert.equal((await service.read(s.operator.token,submitted.id,q,randomUUID())).status,'superseded');
 const decideBody={kind:'approve',expected_version:2,reason:'Synthetic independent discrepancy review'},selfKey=randomUUID();await assert.rejects(service.decide(s.local.token,correction.id,q,selfKey,headers(selfKey),decideBody,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const oldKey=randomUUID();await assert.rejects(service.decide(reviewer.token,submitted.id,q,oldKey,headers(oldKey),{...decideBody,expected_version:1},randomUUID()),{code:'VERSION_CONFLICT'});
 const keys=[randomUUID(),randomUUID()],race=await Promise.allSettled([reviewer,third].map((actor,n)=>service.decide(actor.token,correction.id,q,keys[n],headers(keys[n]!),decideBody,randomUUID())));
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.filter(r=>r.status==='rejected').length,1);const winner=race[0]!.status==='fulfilled'?0:1,actor=[reviewer,third][winner]!,approved=(race[winner] as PromiseFulfilledResult<Awaited<ReturnType<typeof service.decide>>>).value;
 assert.deepEqual(await off.decide(actor.token,correction.id,q,keys[winner],headers(keys[winner]!),decideBody,randomUUID()),approved);
 const final=await service.read(s.agent.token,correction.id,q,randomUUID());assert.equal(final.status,'approved');assert.equal((final.source_snapshot.totals as {shortage_paise:string}).shortage_paise,'1000');
 assert.equal((await s.position()).source_version,version);assert.equal((await s.position()).locations.find(l=>l.location_id===s.held.id)!.known_recorded_paise,'210000');
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,moneyBefore);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_requests')).rows[0]!.n,0);
 const events=(await s.db.adminQuery('SELECT kind,actor_id FROM shipit.agent_settlement_events ORDER BY recorded_at,id')).rows;assert.equal(events.length,3);assert.equal(events.filter(e=>e.kind==='submitted').length,2);assert.equal(events.filter(e=>e.kind==='approved').length,1);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.audit_history WHERE action IN ('agent_statement.submit','agent_statement.decide')")).rows[0]!.n,3);
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 await assert.rejects(owner.query(`INSERT INTO shipit.agent_settlement_decisions(id,organization_id,franchise_id,submission_id,expected_version,kind,actor_id,reason,correlation_id,key_digest,fingerprint)
 SELECT $1,organization_id,franchise_id,id,revision,'approve',actor_id,'Denied raw self approval',$2,$3,fingerprint FROM shipit.agent_settlement_submissions WHERE id=$4`,[randomUUID(),randomUUID(),'a'.repeat(64),correction.id]),{sqlState:'23514'});
 assert.equal((await s.db.adminQuery("SELECT has_table_privilege($1,'shipit.agent_settlement_events','INSERT') allowed",[s.db.runtimeRole])).rows[0]!.allowed,false);
 for(const table of ['agent_settlement_submissions','agent_settlement_decisions','agent_settlement_events'])for(const op of ['UPDATE','DELETE']){const sql=op==='UPDATE'?`UPDATE shipit.${table} SET actor_id=actor_id`:`DELETE FROM shipit.${table}`;await assert.rejects(owner.query(sql),{sqlState:'23514'});}
 await assert.rejects(owner.query(`INSERT INTO shipit.agent_settlement_events SELECT $1,organization_id,franchise_id,submission_id,decision_id,kind,actor_id,correlation_id,recorded_at FROM shipit.agent_settlement_events LIMIT 1`,[randomUUID()]),{sqlState:'23514'});
 const browser=browserToken(s.keys),app=buildServer({config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable',AGENT_MONEY_ENABLED:'true'}),database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined}});t.after(()=>app.close());
 const read=await app.inject({method:'GET',url:'/api/v1/agent-settlements/submissions/'+correction.id+'?'+new URLSearchParams(q),cookies:{shipit_session:s.agent.token}});assert.equal(read.statusCode,200,read.body);assert.equal(read.json().status,'approved');assert.match(String(read.headers['cache-control']),/no-store.*private/);
 const denied=await app.inject({method:'POST',url:'/api/v1/agent-settlements/submissions/'+correction.id+'/decisions?'+new URLSearchParams(q),cookies:{shipit_session:actor.token,shipit_browser:browser},headers:{origin:'http://localhost:5173','idempotency-key':randomUUID(),'content-type':'application/json'},payload:JSON.stringify(decideBody)});assert.equal(denied.statusCode,403);
 const duplicate=await app.inject({method:'POST',url:'/api/v1/agent-settlements/submissions/'+correction.id+'/decisions?'+new URLSearchParams(q),cookies:{shipit_session:actor.token,shipit_browser:browser},headers:{origin:'http://localhost:5173','x-csrf-token':csrf(s.keys,browser),'idempotency-key':keys[winner],'content-type':'application/json'},payload:JSON.stringify(decideBody)});assert.equal(duplicate.statusCode,201,duplicate.body);assert.deepEqual(duplicate.json(),approved);
 await s.memberships.revokeMembership(s.admin.token,actor.member.id,{expected_version:actor.member.version});await assert.rejects(off.decide(actor.token,correction.id,q,keys[winner],headers(keys[winner]!),decideBody,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});
await test('late source changes block approval, future-occurrence source versions do not, and linked refresh preserves rejected history',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),service=createAgentStatementService(s.pool,true),cap=await counted(s),body={capture_id:cap.id,previous_submission_id:null,expected_version:0,reason:'Synthetic count cutoff'};
 // Occurred after this count, but before this command; irrelevant to the saved frame.
 await new Promise(resolve=>setTimeout(resolve,5));const futureKey=randomUUID();await s.receipts.record(s.local.token,q,futureKey,headers(futureKey),{...s.receiptBody,amount_paise:1,allocations:[],occurred_at:new Date().toISOString()},randomUUID());
 const key=randomUUID(),submitted=await service.submit(s.agent.token,q,key,headers(key),body,randomUUID());assert.equal(submitted.revision,1);
 const unused=await counted(s,s.agent,210001);
 const lateKey=randomUUID();await s.receipts.record(s.local.token,q,lateKey,headers(lateKey),{...s.receiptBody,amount_paise:1,allocations:[],occurred_at:new Date(Date.parse(cap.counted_at)-1000).toISOString()},randomUUID());
 const staleSubmitKey=randomUUID();await assert.rejects(service.submit(s.agent.token,q,staleSubmitKey,headers(staleSubmitKey),{capture_id:unused.id,previous_submission_id:submitted.id,expected_version:1,reason:'Stale unused source'},randomUUID()),{code:'VERSION_CONFLICT'});
 const staleKey=randomUUID();await assert.rejects(service.decide(s.local.token,submitted.id,q,staleKey,headers(staleKey),{kind:'approve',expected_version:1,reason:'Must refresh late evidence'},randomUUID()),{code:'VERSION_CONFLICT'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_settlement_decisions')).rows[0]!.n,0);
 const rejectKey=randomUUID(),rejected=await service.decide(s.local.token,submitted.id,q,rejectKey,headers(rejectKey),{kind:'reject',expected_version:1,reason:'Refresh the late receipt source'},randomUUID());assert.equal(rejected.kind,'reject');
 const refreshed=await counted(s,s.agent,210002),foreignCaptureKey=randomUUID(),foreignCap=await createAgentCashCaptureService(s.pool,true).capture(s.second.token,q,foreignCaptureKey,headers(foreignCaptureKey),{agent_id:s.second.id,day:refreshed.day,counted_at:refreshed.counted_at,counted_paise:0,reason:'Synthetic distinct agent source'},randomUUID());
 const foreignKey=randomUUID(),foreign=await service.submit(s.second.token,q,foreignKey,headers(foreignKey),{capture_id:foreignCap.id,previous_submission_id:null,expected_version:0,reason:'Synthetic distinct agent submission'},randomUUID());
 for(const previous of [foreign.id,randomUUID()]){const deniedKey=randomUUID();await assert.rejects(service.submit(s.agent.token,q,deniedKey,headers(deniedKey),{capture_id:refreshed.id,previous_submission_id:previous,expected_version:1,reason:'Foreign and unknown predecessor denied alike'},randomUUID()),{code:'RESOURCE_NOT_FOUND'});}
 const nextKey=randomUUID(),next=await service.submit(s.agent.token,q,nextKey,headers(nextKey),{capture_id:refreshed.id,previous_submission_id:submitted.id,expected_version:1,reason:'Linked fresh source correction'},randomUUID());assert.equal(next.revision,2);
 const approveKey=randomUUID(),approvedBody={kind:'approve',expected_version:2,reason:'Exact corrected source reviewed'};
 await assert.rejects(createAgentStatementService(paymentFault(s.pool,'COMMIT','after'),true).decide(s.local.token,next.id,q,approveKey,headers(approveKey),approvedBody,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const recovered=await Promise.all([service.decide(s.local.token,next.id,q,approveKey,headers(approveKey),approvedBody,randomUUID()),createAgentStatementService(s.pool).decide(s.local.token,next.id,q,approveKey,headers(approveKey),approvedBody,randomUUID())]);assert.deepEqual(recovered[0],recovered[1]);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_settlement_decisions')).rows[0]!.n,2);

 const old=await service.read(s.agent.token,submitted.id,q,randomUUID());assert.equal(old.status,'superseded');assert.equal(old.decision!.kind,'reject');assert.deepEqual(old.source_snapshot,cap.source_snapshot);
 assert.equal((await service.read(s.agent.token,next.id,q,randomUUID())).status,'approved');assert.equal((await service.list(s.operator.token,q,randomUUID())).items.length,0);
 const listed=await service.list(s.agent.token,q,randomUUID());assert.equal(listed.items.length,2);assert.equal(listed.next_cursor,null);
 await assert.rejects(service.list(s.agent.token,{...q,cursor:'not-a-cursor'},randomUUID()),{code:'VALIDATION_FAILED'});
 const invalidKey=randomUUID();await assert.rejects(service.submit(s.agent.token,q,invalidKey,headers(invalidKey),{...body,actor_id:s.local.id},randomUUID()),{code:'VALIDATION_FAILED'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,3);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_requests')).rows[0]!.n,0);
});

await test('settlement list pages a fixed private cutoff completely and rechecks actor ownership for cursors',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),service=createAgentStatementService(s.pool,true),captures=createAgentCashCaptureService(s.pool,true),ids=new Set<string>(),anchor=Date.now();
 for(let offset=1;offset<=101;offset++){
  const instant=new Date(anchor-offset*86400000),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(instant),captureKey=randomUUID();
  const cap=await captures.capture(s.agent.token,q,captureKey,headers(captureKey),{agent_id:s.agent.id,day,counted_at:instant.toISOString(),counted_paise:0,reason:'Synthetic historic count, no fabricated prior receipts'},randomUUID());
  const key=randomUUID(),row=await service.submit(s.agent.token,q,key,headers(key),{capture_id:cap.id,previous_submission_id:null,expected_version:0,reason:'Synthetic historical settlement'},randomUUID());ids.add(row.id);
 }
 // Wait for an actual database millisecond boundary after every committed source row.
 // The public cutoff is millisecond precision; a row committed within its current fractional millisecond is correctly excluded.
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 for(let attempt=0;;attempt++){const ready=(await owner.query<{ready:boolean}>("SELECT date_trunc('milliseconds',clock_timestamp())>=max(recorded_at) AS ready FROM shipit.agent_settlement_submissions")).rows[0]!.ready;if(ready)break;assert(attempt<100,'Database millisecond boundary did not advance');await new Promise(resolve=>setTimeout(resolve,2));}
 const first=await service.list(s.agent.token,q,randomUUID());assert.equal(first.items.length,100);assert.ok(first.next_cursor);const second=await service.list(s.agent.token,{...q,cursor:first.next_cursor},randomUUID());
 assert.equal(second.items.length,1);assert.equal(second.next_cursor,null);assert.equal(second.as_of,first.as_of);assert.deepEqual(new Set([...first.items,...second.items].map(r=>r.id)),ids);
 await assert.rejects(service.list(s.second.token,{...q,cursor:first.next_cursor},randomUUID()),{code:'VALIDATION_FAILED'});
 assert.equal((await service.list(s.operator.token,q,randomUUID())).items.length,0);
 const key=randomUUID();await assert.rejects(service.submit(s.agent.token,q,key,headers(key),{capture_id:randomUUID(),previous_submission_id:null,expected_version:0,reason:'Unknown source denied'},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_settlement_events')).rows[0]!.n,101);
});
