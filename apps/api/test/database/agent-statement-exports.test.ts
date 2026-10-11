import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setupAgentMoney} from '../agent-money-support.ts';
import {createAgentCashCaptureService} from '../../src/modules/agent-settlements/cash-capture-service.ts';
import {createAgentStatementService} from '../../src/modules/agent-settlements/statement-service.ts';
import {createAgentStatementExportService} from '../../src/modules/agent-settlements/export-service.ts';
import {statementExportRows} from '../../src/modules/agent-settlements/export-rules.ts';
import {paymentFault} from '../payment-support.ts';
import {buildServer} from '../../src/server.ts';
import {parseEnvironment} from '../../src/env.ts';
import {browserToken,csrf} from '../../src/modules/auth/crypto.ts';
import {org,A,B} from '../audit-support.ts';
const q={organization_id:org,franchise_id:A},headers=(k:string)=>['idempotency-key',k];
async function submit(s:Awaited<ReturnType<typeof setupAgentMoney>>,amount=210000,previous:{id:string;revision:number}|null=null,reason='=1+1'){
 const count=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(count)),captureKey=randomUUID();
 const capture=await createAgentCashCaptureService(s.pool,true).capture(s.operator.token,q,captureKey,headers(captureKey),{agent_id:s.agent.id,day,counted_at:count,counted_paise:amount,reason:'Synthetic export count'},randomUUID()),key=randomUUID();
 return createAgentStatementService(s.pool,true).submit(s.operator.token,q,key,headers(key),{capture_id:capture.id,previous_submission_id:previous?.id??null,expected_version:previous?.revision??0,reason},randomUUID());
}
await test('financial statement exports freeze complete actual sources, page independently and preserve actor-owned exact recovery',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t);await s.db.prepareReports();const accountant=await s.grant('accountant',[A]),sibling=await s.grant('franchise_admin',[B]);
 for(let n=0;n<40;n++){const key=randomUUID();await s.receipts.record(s.local.token,q,key,headers(key),{...s.receiptBody,amount_paise:1,allocations:[]},randomUUID());}
 const statement=await submit(s,210040),service=createAgentStatementExportService(s.pool),key=randomUUID(),metadata=await service.capture(s.local.token,statement.id,q,key,headers(key),{},randomUUID());
 assert.equal(metadata.definition,'agent_statement_v1');assert.equal(metadata.source_count,125);assert.equal(metadata.count,125);assert.equal(metadata.currency,'INR');assert.equal(metadata.timezone,'Asia/Kolkata');assert.equal(Date.parse(metadata.expires_at)-Date.parse(metadata.as_of),86400000);
 const first=await service.read(s.local.token,metadata.id,q,randomUUID());assert(first.rows);assert.equal(first.rows.length,100);assert.equal(first.next_offset,100);
 const second=await service.read(s.local.token,metadata.id,{...q,offset:'100'},randomUUID());assert(second.rows);assert.equal(second.rows.length,25);assert.equal(second.next_offset,null);assert.deepEqual(second.snapshot,first.snapshot);
 assert.equal(metadata.summaries.length,4);const complete=[...metadata.summaries,...first.rows,...second.rows];assert.equal(new Set(complete.map(r=>r.record_kind+'/'+r.record_id)).size,129);assert.equal(complete.filter(r=>r.record_kind==='receipts').length,41);assert.equal(complete.find(r=>r.record_kind==='cash_summary')!.fields.expected_paise,'210040');assert.equal(complete.find(r=>r.record_kind==='finance_summary')!.fields.origin_receipt_seller_liability_paise,'200000');
 const download=await service.read(s.local.token,metadata.id,q,randomUUID(),true);assert(typeof download.csv==='string');assert(download.csv.includes("\"'=1+1\""));assert(download.csv.includes(s.receipt.receipt_id));assert.equal(download.csv.split('\r\n').length,131);
 const frozen=download.csv,correction=await submit(s,209040,statement,'Synthetic linked corrected count');assert.equal(correction.revision,2);assert.equal((await createAgentStatementService(s.pool,true).read(s.local.token,statement.id,q,randomUUID())).status,'superseded');
 assert.deepEqual(await service.capture(s.local.token,statement.id,q,key,headers(key),{},randomUUID()),metadata);const old=await service.read(s.local.token,metadata.id,q,randomUUID(),true);assert(typeof old.csv==='string');assert.equal(old.csv,frozen);assert.equal(old.snapshot.status,'pending');
 await assert.rejects(service.capture(s.local.token,correction.id,q,key,headers(key),{},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 const denied=randomUUID();for(const actor of [s.operator,s.agent,s.admin])await assert.rejects(service.capture(actor.token,statement.id,q,denied,headers(denied),{},randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(service.read(accountant.token,metadata.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});const ownKey=randomUUID(),own=await service.capture(accountant.token,statement.id,q,ownKey,headers(ownKey),{},randomUUID());assert.equal(own.status,'superseded');await assert.rejects(service.read(s.local.token,own.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.read(sibling.token,metadata.id,{...q,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});await assert.rejects(service.capture(sibling.token,statement.id,{...q,franchise_id:B},denied,headers(denied),{},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const detail=await createAgentStatementService(s.pool,true).read(s.local.token,statement.id,q,randomUUID()),privateExtra={...detail,source_snapshot:{...detail.source_snapshot,private_contact:'NEVER_EXPORT',cash:{...(detail.source_snapshot.cash as object),private_contact:'NEVER_EXPORT'}}};assert(!JSON.stringify(statementExportRows(privateExtra)).includes('NEVER_EXPORT'));
 await s.memberships.revokeMembership(s.admin.token,accountant.member.id,{expected_version:accountant.member.version});await assert.rejects(service.read(accountant.token,own.id,q,randomUUID(),true),{code:'RESOURCE_NOT_FOUND'});
});
await test('statement export rollback and lost commit do not duplicate storage, bounded quota expires without deleting durable statements',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t);await s.db.prepareReports();const statement=await submit(s),service=createAgentStatementExportService(s.pool),bad=randomUUID();
 await assert.rejects(createAgentStatementExportService(paymentFault(s.pool,'INSERT INTO shipit.report_snapshots','before')).capture(s.local.token,statement.id,q,bad,headers(bad),{},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,0);
 const key=randomUUID();await assert.rejects(createAgentStatementExportService(paymentFault(s.pool,'COMMIT','after')).capture(s.local.token,statement.id,q,key,headers(key),{},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const replay=await Promise.all([1,2].map(()=>service.capture(s.local.token,statement.id,q,key,headers(key),{},randomUUID())));assert.deepEqual(replay[0],replay[1]);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,1);
 for(let n=1;n<20;n++){const next=randomUUID();await service.capture(s.local.token,statement.id,q,next,headers(next),{},randomUUID());}const excess=randomUUID();await assert.rejects(service.capture(s.local.token,statement.id,q,excess,headers(excess),{},randomUUID()),{code:'REPORT_QUOTA_EXCEEDED'});assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,20);
 // Production guards reject retiming. A test-only owner expiry fixture advances both dates equally.
 const owner=s.db.ownerPool();t.after(()=>owner.close());await assert.rejects(owner.query("UPDATE shipit.report_snapshots SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[replay[0]!.id]),{sqlState:'23514'});
 await s.db.adminQuery('ALTER TABLE shipit.report_snapshots DISABLE TRIGGER USER');
 try{await s.db.adminQuery("UPDATE shipit.report_snapshots SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[replay[0]!.id]);}finally{await s.db.adminQuery('ALTER TABLE shipit.report_snapshots ENABLE TRIGGER USER');}await assert.rejects(service.read(s.local.token,replay[0]!.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});await assert.rejects(service.capture(s.local.token,statement.id,q,key,headers(key),{},randomUUID()),{code:'REPORT_EXPIRED'});
 assert.equal((await createAgentStatementService(s.pool,false).read(s.agent.token,statement.id,q,randomUUID())).id,statement.id);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_daily_cash_captures')).rows[0]!.n,1);
 const newKey=randomUUID();await service.capture(s.local.token,statement.id,q,newKey,headers(newKey),{},randomUUID());assert.equal((await s.db.adminQuery('SELECT metadata IS NULL cleared FROM shipit.report_snapshots WHERE id=$1',[replay[0]!.id])).rows[0]!.cleared,true);assert.equal((await s.db.adminQuery('SELECT rows IS NULL cleared FROM shipit.report_snapshots WHERE id=$1',[replay[0]!.id])).rows[0]!.cleared,true);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_requests')).rows[0]!.n,0);assert.equal((await s.position()).locations.find(l=>l.location_id===s.held.id)!.known_recorded_paise,'210000');
});
await test('private statement export HTTP enforces current financial roles, csrf and captured download audit even with money writes off',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t);await s.db.prepareReports();const statement=await submit(s),service=createAgentStatementExportService(s.pool),app=buildServer({config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',TRUSTED_PROXY_HOPS:'0',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'}),database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined}});t.after(()=>app.close());
 const query=new URLSearchParams(q).toString(),path='/api/v1/agent-settlements/submissions/'+statement.id+'/exports',key=randomUUID(),browser=browserToken(s.keys),cookie='shipit_session='+s.local.token+'; shipit_browser='+browser;
 assert.equal((await app.inject({method:'POST',url:path+'?'+query,headers:{cookie,origin:'http://localhost:5173','idempotency-key':key},payload:{}})).statusCode,403);
 const created=await app.inject({method:'POST',url:path+'?'+query,headers:{cookie,origin:'http://localhost:5173','x-csrf-token':csrf(s.keys,browser),'idempotency-key':key},payload:{}});assert.equal(created.statusCode,201);assert.match(String(created.headers['cache-control']),/no-store/);assert.match(String(created.headers['cache-control']),/private/);const metadata=created.json();
 const downloaded=await app.inject({url:'/api/v1/agent-settlements/exports/'+metadata.id+'/download?'+query,headers:{cookie}});assert.equal(downloaded.statusCode,200);assert.equal(downloaded.json().snapshot.id,metadata.id);assert(downloaded.json().csv.includes('"cash_summary"'));assert.equal((await s.db.adminQuery("SELECT count(*)::int n FROM shipit.report_access_events WHERE snapshot_id=$1 AND action='report.export'",[metadata.id])).rows[0]!.n,1);
 const denied=await app.inject({url:'/api/v1/agent-settlements/exports/'+metadata.id+'/download?'+query,headers:{cookie:'shipit_session='+s.agent.token}});assert.equal(denied.statusCode,403);
 await assert.rejects(service.read(s.local.token,metadata.id,{...q,offset:'1'},randomUUID()),{code:'VALIDATION_FAILED'});
 const forged=await app.inject({method:'POST',url:path+'?'+query,headers:{cookie,origin:'http://localhost:5173','x-csrf-token':csrf(s.keys,browser),'idempotency-key':randomUUID()},payload:{actor_id:s.agent.id}});assert.equal(forged.statusCode,422);
});
