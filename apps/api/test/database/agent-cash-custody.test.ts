import {setupAgentMoney} from '../agent-money-support.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentFault} from '../payment-support.ts';
import {org,A,B} from '../audit-support.ts';
import {createMoneyReceiptService} from '../../src/modules/payments/receipt-service.ts';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
import {createCashHandoverService} from '../../src/modules/cashbook/handover-service.ts';
import {createCashbookRequestService} from '../../src/modules/cashbook/request-service.ts';
import {buildServer} from '../../src/server.ts';
import {parseEnvironment} from '../../src/env.ts';
import {browserToken,csrf} from '../../src/modules/auth/crypto.ts';
const q={organization_id:org,franchise_id:A},headers=(key:string)=>['idempotency-key',key];
await test('agent cash and shop UPI stay separate through partial acknowledgement and admin recovery of a revoked custodian',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),disabled=createCashHandoverService(s.pool,true,false),body=await s.requestBody(),key=randomUUID();
 const upiKey=randomUUID();await s.receipts.record(s.local.token,q,upiKey,headers(upiKey),{...s.receiptBody,account_id:s.upiAccount.id,method:'upi',external_reference:'SYNTHETIC-SHOP-UPI',allocations:[]},randomUUID());
 const balance=async(location:string)=>(await s.position()).locations.find(x=>x.location_id===location)!;
 assert.equal((await balance(s.held.id)).known_recorded_paise,'210000');assert.equal((await balance(s.bank.id)).known_recorded_paise,'210000');
 await assert.rejects(s.receipts.record(s.agent.token,q,randomUUID(),headers('agent-record'),s.receiptBody,randomUUID()),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(createMoneyReceiptService(s.pool,true,false).record(s.local.token,q,randomUUID(),headers('agent-disabled'),s.receiptBody,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(createCashLocationService(s.pool,true,false).configure(s.local.token,null,q,randomUUID(),headers('agent-location-disabled'),{account_id:s.officeAccount.id,expected_account_version:1,custodian_id:s.agent.id,name:'Synthetic disabled agent drawer',active:true,expected_version:0},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(disabled.request(s.agent.token,q,key,headers(key),{...body,expected_source_version:(await s.position()).source_version},randomUUID()),{code:'AGENT_MONEY_DISABLED'});
 const requested=await s.handovers.request(s.agent.token,q,key,headers(key),{...body,expected_source_version:(await s.position()).source_version},randomUUID());assert.equal((await balance(s.held.id)).known_recorded_paise,'210000');assert.equal((await balance(s.office.id)).known_recorded_paise,'0');
 await assert.rejects(s.handovers.read(s.second.token,requested.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});assert.equal((await s.handovers.list(s.second.token,q,randomUUID())).items.length,0);
 const detail=await s.handovers.read(s.operator.token,requested.id,q,randomUUID()),acceptBody={kind:'accept',expected_version:1,expected_source_version:detail.current_source_version,amount_paise:209000,currency:'INR',reason:'Synthetic physically received cash'},acceptKey=randomUUID();
 const accepted=await s.handovers.respond(s.operator.token,requested.id,q,acceptKey,headers(acceptKey),acceptBody,randomUUID());assert.equal(accepted.legs.length,2);assert.equal(accepted.remaining_paise,1000);assert.equal((await balance(s.held.id)).known_recorded_paise,'1000');assert.equal((await balance(s.office.id)).known_recorded_paise,'209000');
 assert.deepEqual(await disabled.respond(s.operator.token,requested.id,q,acceptKey,headers(acceptKey),acceptBody,randomUUID()),accepted);
 await s.memberships.revokeMembership(s.admin.token,s.agent.member.id,{expected_version:s.agent.member.version});
 for(const operation of [()=>s.handovers.read(s.agent.token,requested.id,q,randomUUID()),()=>s.handovers.request(s.agent.token,q,key,headers(key),body,randomUUID())])await assert.rejects(operation(),{code:'RESOURCE_NOT_FOUND'});
 const current=await s.handovers.read(s.local.token,requested.id,q,randomUUID()),cancelBody={kind:'cancel',expected_version:2,expected_source_version:current.current_source_version,amount_paise:0,currency:'INR',reason:'Synthetic owner recovery of pending remainder'},cancelKey=randomUUID();
 await assert.rejects(disabled.respond(s.local.token,requested.id,q,cancelKey,headers(cancelKey),cancelBody,randomUUID()),{code:'AGENT_MONEY_DISABLED'});
 await s.handovers.respond(s.local.token,requested.id,q,cancelKey,headers(cancelKey),cancelBody,randomUUID());
 const accountKey=randomUUID();await s.accounts.configure(s.local.token,s.agentAccount.id,q,accountKey,headers(accountKey),{name:'Synthetic closed agent account',methods:['cash'],other_method_name:null,active:false,expected_version:1},randomUUID());
 const locationKey=randomUUID(),closed=await s.locations.configure(s.local.token,s.held.id,q,locationKey,headers(locationKey),{account_id:s.agentAccount.id,expected_account_version:2,custodian_id:s.agent.id,name:'Synthetic closed historical drawer',active:false,expected_version:1},randomUUID());
 const targets=await s.handovers.targets(s.local.token,s.held.id,q,randomUUID());assert.ok(targets.items.some(x=>x.id===s.office.id));
 const recoveryBody={...body,source_revision_id:closed.revision_id,expected_source_version:(await s.position()).source_version,amount_paise:1000,reason:'Synthetic actual historical-custodian recovery'},recoveryKey=randomUUID();
 await assert.rejects(s.handovers.request(s.operator.token,q,recoveryKey,headers(recoveryKey),recoveryBody,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const recovery=await s.handovers.request(s.local.token,q,recoveryKey,headers(recoveryKey),recoveryBody,randomUUID()),receivedKey=randomUUID();
 await s.handovers.respond(s.operator.token,recovery.id,q,receivedKey,headers(receivedKey),{kind:'accept',expected_version:1,expected_source_version:(await s.position()).source_version,amount_paise:1000,currency:'INR',reason:'Synthetic actual recovered cash receipt'},randomUUID());
 assert.equal((await balance(s.held.id)).known_recorded_paise,'0');assert.equal((await balance(s.office.id)).known_recorded_paise,'210000');
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,2);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cash_handover_legs')).rows[0]!.n,4);assert.equal((await s.db.adminQuery('SELECT sum(amount_paise)::text n FROM shipit.cod_receipt_allocations')).rows[0]!.n,'200000');
});
await test('production HTTP grants own agent handover only and commits agent-to-agent acknowledgement exactly once',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),browser=browserToken(s.keys);
 const app=buildServer({config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable',CASHBOOK_ENABLED:'true',MONEY_RECEIPTS_ENABLED:'true',AGENT_MONEY_ENABLED:'true'}),database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined}});t.after(()=>app.close());
 const call=(method:'GET'|'POST',path:string,body:unknown={},actor=s.agent.token,key=randomUUID(),query:Record<string,string>=q,csrfEnabled=true)=>app.inject({method,url:'/api/v1'+path+'?'+new URLSearchParams(query),cookies:{shipit_session:actor,shipit_browser:browser},headers:{origin:'http://localhost:5173',...(csrfEnabled?{'x-csrf-token':csrf(s.keys,browser)}:{}),'idempotency-key':key,'content-type':'application/json'},...(method==='GET'?{}:{payload:JSON.stringify(body)})});
 const ownSources=await call('GET','/cashbook/handover-sources');assert.equal(ownSources.statusCode,200,ownSources.body);assert.deepEqual(ownSources.json(),{items:[{id:s.held.id,name:s.held.name,custodian_id:s.agent.id,kind:'cash',active:true}],next_cursor:null});assert.match(String(ownSources.headers['cache-control']),/no-store.*private/);
 assert.deepEqual((await call('GET','/cashbook/handover-sources',{},s.second.token)).json().items.map((i:{id:string})=>i.id),[s.other.id]);
 assert.equal((await call('GET','/cashbook/handover-sources',{},s.agent.token,randomUUID(),{...q,franchise_id:B})).statusCode,404);
 assert.equal((await call('GET','/cashbook/handover-sources',{},s.agent.token,randomUUID(),{...q,cursor:'not-a-reference'})).statusCode,422);
 const ownIds=[s.held.id];
 for(let n=0;n<100;n++){const ak=randomUUID(),account=await s.accounts.configure(s.local.token,null,q,ak,headers(ak),{name:'Synthetic owned source '+n,methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID()),lk=randomUUID(),loc=await s.locations.configure(s.local.token,null,q,lk,headers(lk),{account_id:account.id,expected_account_version:1,custodian_id:s.agent.id,name:'Synthetic own cash '+n,active:true,expected_version:0},randomUUID());ownIds.push(loc.id);}
 const first=(await call('GET','/cashbook/handover-sources')).json();assert.equal(first.items.length,100);assert.equal(first.next_cursor,first.items.at(-1).id);
 const second=(await call('GET','/cashbook/handover-sources',{},s.agent.token,randomUUID(),{...q,cursor:first.next_cursor})).json();assert.equal(second.items.length,1);assert.equal(second.next_cursor,null);assert.deepEqual([...first.items,...second.items].map(i=>i.id).sort(),ownIds.sort());assert([...first.items,...second.items].every(i=>i.custodian_id===s.agent.id));
 for(const path of ['/cashbook/locations','/cashbook/position','/cashbook/requests'])assert.equal((await call('GET',path)).statusCode,403,path);
 assert.equal((await call('GET','/money-receipts',{},s.agent.token,randomUUID(),{...q,customer_id:s.source.id})).statusCode,403);
 const expense={kind:'expense',source_location_id:s.held.id,source_revision_id:s.held.revision_id,target_location_id:null,target_revision_id:null,expected_source_version:(await s.position()).source_version,amount_paise:100,currency:'INR',category:'transport',payee:'Synthetic fuel supplier',responsible_employee_id:s.operator.id,reason:'Synthetic forbidden agent expense',occurred_at:new Date(Date.now()-1000).toISOString(),payment_method:'cash'};
 assert.equal((await call('POST','/cashbook/requests',expense)).statusCode,403);
 await assert.rejects(createCashbookRequestService(s.pool,true).submit(s.agent.token,q,randomUUID(),headers('expense-denied'),expense,randomUUID()),{code:'ACTION_FORBIDDEN'});
 const body=await s.requestBody(s.other,20000),key=randomUUID();assert.equal((await call('POST','/cashbook/handovers',body,s.agent.token,key,q,false)).statusCode,403);
 const response=await call('POST','/cashbook/handovers',body,s.agent.token,key);assert.equal(response.statusCode,201,response.body);assert.match(String(response.headers['cache-control']),/no-store/);const requested=response.json();
 assert.equal((await call('GET',`/cashbook/handovers/${requested.id}`,{},s.second.token)).statusCode,200);
 const read=await s.handovers.read(s.second.token,requested.id,q,randomUUID()),acceptBody={kind:'accept',expected_version:1,expected_source_version:read.current_source_version,amount_paise:20000,currency:'INR',reason:'Synthetic actual second-agent cash receipt'},acceptKey=randomUUID();
 const before=(await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cash_handover_commands')).rows[0]!.n;
 await assert.rejects(createCashHandoverService(paymentFault(s.pool,'INSERT INTO shipit.cash_handover_legs','before'),true,true).respond(s.second.token,requested.id,q,acceptKey,headers(acceptKey),acceptBody,randomUUID()));
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cash_handover_commands')).rows[0]!.n,before);
 const outcomes=await Promise.all([0,1].map(()=>call('POST',`/cashbook/handovers/${requested.id}/commands`,acceptBody,s.second.token,acceptKey)));for(const result of outcomes)assert.equal(result.statusCode,200,result.body);assert.deepEqual(outcomes[0]!.json(),outcomes[1]!.json());
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cash_handover_commands')).rows[0]!.n,before+1);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cash_handover_legs')).rows[0]!.n,2);
 const positions=await s.position();assert.equal(positions.locations.find(x=>x.location_id===s.held.id)!.known_recorded_paise,'190000');assert.equal(positions.locations.find(x=>x.location_id===s.other.id)!.known_recorded_paise,'20000');
 assert.equal((await call('GET',`/cashbook/handovers/${requested.id}`,{},s.agent.token,randomUUID(),{...q,franchise_id:B})).statusCode,404);
 await s.memberships.revokeMembership(s.admin.token,s.second.member.id,{expected_version:s.second.member.version});assert.equal((await call('POST',`/cashbook/handovers/${requested.id}/commands`,acceptBody,s.second.token,acceptKey)).statusCode,404);
 assert.equal((await call('GET',`/cashbook/handovers/${requested.id}`,{},s.second.token)).statusCode,404);
 assert.equal((await call('GET','/cashbook/handover-sources',{},s.second.token)).statusCode,404);
});

await test('daily cash frame fixes Kolkata count time and server visibility without guessing UPI or late-recorded custody',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),{withAgentMoneyScope}=await import('../../src/modules/memberships/service.ts'),{dailyCashFrame}=await import('../../src/modules/agent-settlements/daily-cash.ts');
 const count=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(count));
 const capture=(agent=s.agent.id,at=count,d=day,token=s.local.token)=>withAgentMoneyScope(s.pool,token,org,A,'agent_money.read',randomUUID(),scope=>dailyCashFrame(scope,agent,d,at,209000n));
 const before=await capture();assert.equal(before.totals.expected_paise,'210000');assert.equal(before.totals.variance_paise,'-1000');assert.equal(before.totals.ledger_exception,false);
 assert.equal(before.cash_facts.length,1);assert.equal(before.receipts.length,1);assert.equal(before.receipts[0]!.receipt_id,s.receipt.receipt_id);
 const upiKey=randomUUID();await s.receipts.record(s.local.token,q,upiKey,headers(upiKey),{...s.receiptBody,account_id:s.upiAccount.id,method:'upi',external_reference:'SYNTHETIC-DAILY-PRIVATE',allocations:[]},randomUUID());
 const lateKey=randomUUID();await s.receipts.record(s.local.token,q,lateKey,headers(lateKey),{...s.receiptBody,amount_paise:1,allocations:[]},randomUUID());
 const after=await capture();assert.equal(after.counted_at,before.counted_at);assert.equal(after.totals.expected_paise,'210001');assert.equal(after.cash_facts.length,2);assert.equal(after.receipts.length,3);
 assert.equal(before.cash_facts.length,1);assert.equal(before.totals.expected_paise,'210000');assert.ok(BigInt(after.source_version)>BigInt(before.source_version));
 assert.ok(after.receipts.some(r=>r.method==='upi'));assert.ok(!JSON.stringify(after).includes('SYNTHETIC-DAILY-PRIVATE'));
 for(const fact of after.cash_facts)assert.deepEqual(Object.keys(fact).sort(),['source_kind','source_id','location_id','direction','amount_paise','occurred_at','recorded_at','request_id','correction_of'].sort());
 await assert.rejects(capture(randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(capture(s.agent.id,count,'2000-01-01'),{code:'VALIDATION_FAILED'});
 await assert.rejects(capture(s.agent.id,new Date(Date.now()+86400000).toISOString()),{code:'VALIDATION_FAILED'});
 await assert.rejects(capture(s.agent.id,count,day,s.agent.token),{code:'ACTION_FORBIDDEN'});
 const sourceCount=(await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_effects')).rows[0]!.n;
 assert.equal(sourceCount,0);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cash_handover_commands')).rows[0]!.n,0);
 const priorKey=randomUUID();await s.receipts.record(s.local.token,q,priorKey,headers(priorKey),{...s.receiptBody,amount_paise:2,allocations:[],occurred_at:new Date(Date.parse(day+'T00:00:00+05:30')-1).toISOString()},randomUUID());
 const carried=await capture();assert.equal(carried.totals.opening_known_paise,'2');assert.equal(carried.totals.day_in_paise,'210001');assert.equal(carried.totals.expected_paise,'210003');
 assert.equal((await capture(s.second.id)).totals.expected_paise,'0');
 await assert.rejects(withAgentMoneyScope(s.pool,s.admin.token,org,B,'agent_money.read',randomUUID(),scope=>dailyCashFrame(scope,s.agent.id,day,count,0n)),{code:'RESOURCE_NOT_FOUND'});
 const handoverKey=randomUUID(),handover=await s.handovers.request(s.agent.token,q,handoverKey,headers(handoverKey),await s.requestBody(s.office,209000),randomUUID()),receiveKey=randomUUID();
 await s.handovers.respond(s.operator.token,handover.id,q,receiveKey,headers(receiveKey),{kind:'accept',expected_version:1,expected_source_version:(await s.position()).source_version,amount_paise:209000,currency:'INR',reason:'Synthetic daily actual handover'},randomUUID());
 const historical=await capture();assert.equal(historical.totals.day_out_paise,'0');assert.equal(historical.totals.expected_paise,'210003');
 const currentAt=new Date().toISOString(),currentDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(currentAt)),current=await capture(s.agent.id,currentAt,currentDay);
 assert.equal(current.totals.expected_paise,'1003');assert.ok(current.cash_facts.some(f=>f.source_kind==='handover'&&f.direction==='out'&&f.amount_paise==='209000'));
 for(const fact of current.cash_facts){assert.ok(Date.parse(fact.recorded_at)<=Date.parse(current.as_of));assert.ok(Date.parse(fact.occurred_at)<=Date.parse(current.counted_at));}
 for(const receipt of current.receipts){assert.ok(Date.parse(receipt.recorded_at)<=Date.parse(current.as_of));assert.ok(Date.parse(receipt.occurred_at)<=Date.parse(current.counted_at));}
 assert.equal(current.receipts.length,4);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_effects')).rows[0]!.n,0);
});

await test('durable cash captures are server-derived, immutable, private and replayable after uncertain commit without settlement side effects',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),{createAgentCashCaptureService}=await import('../../src/modules/agent-settlements/cash-capture-service.ts'),service=createAgentCashCaptureService(s.pool,true),disabled=createAgentCashCaptureService(s.pool,false);
 const at=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(at)),body={agent_id:s.agent.id,day,counted_at:at,counted_paise:209000,reason:'Synthetic actual daily count'},key=randomUUID();
 const capture=(token:string,input=body,k=randomUUID(),handler=service)=>handler.capture(token,q,k,headers(k),input,randomUUID());
 const owner=s.db.ownerPool();t.after(()=>owner.close());
 const version=(await s.position()).source_version;
 await assert.rejects(capture(s.agent.token,body,key,disabled),{code:'AGENT_MONEY_DISABLED'});
 const first=await capture(s.agent.token,body,key),snapshot=first.source_snapshot as {kind:string;cash:{cash_facts:unknown[]};totals:{expected_paise:string;variance_paise:string}};
 const finance=first.source_snapshot.finance as {as_of:string;counted_at:string;seller_liability_is_agent_debt:boolean;totals:{freight_applied_paise:string;origin_receipt_seller_liability_paise:string;earned_fee_paise:string}};
 assert.equal(finance.as_of,first.recorded_at);assert.equal(finance.counted_at,first.counted_at);assert.equal(finance.seller_liability_is_agent_debt,false);assert.equal(finance.totals.freight_applied_paise,'10000');assert.equal(finance.totals.origin_receipt_seller_liability_paise,'200000');assert.equal(finance.totals.earned_fee_paise,'0');
 assert.equal(snapshot.kind,'physical_cash_capture');assert.equal(snapshot.totals.expected_paise,'210000');assert.equal(snapshot.totals.variance_paise,'-1000');assert.equal(snapshot.cash.cash_facts.length,1);
 assert.deepEqual(await capture(s.agent.token,body,key,disabled),first);
 await assert.rejects(capture(s.agent.token,{...body,counted_paise:209001},key),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(capture(s.agent.token,{...body,agent_id:s.second.id}),{code:'RESOURCE_NOT_FOUND'});
 const ownerCapture=await capture(s.admin.token);assert.equal(ownerCapture.agent_id,s.agent.id);
 await assert.rejects(service.read(s.operator.token,first.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.read(s.second.token,first.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const operator=await capture(s.operator.token);assert.deepEqual(await service.read(s.agent.token,operator.id,q,randomUUID()),operator);
 assert.deepEqual(await service.read(s.operator.token,operator.id,q,randomUUID()),operator);assert.deepEqual(await service.read(s.local.token,first.id,q,randomUUID()),first);
 await assert.rejects(service.read(s.admin.token,first.id,{organization_id:org,franchise_id:B},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 const failKey=randomUUID();await assert.rejects(capture(s.agent.token,body,failKey,createAgentCashCaptureService(paymentFault(s.pool,'INSERT INTO shipit.agent_daily_cash_captures','before'),true)),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_daily_cash_captures')).rows[0]!.n,3);
 const uncertainKey=randomUUID();await assert.rejects(capture(s.agent.token,body,uncertainKey,createAgentCashCaptureService(paymentFault(s.pool,'COMMIT','after'),true)),{code:'TEMPORARILY_UNAVAILABLE'});
 const replays=await Promise.all([capture(s.agent.token,body,uncertainKey),capture(s.agent.token,body,uncertainKey)]);assert.deepEqual(replays[0],replays[1]);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_daily_cash_captures')).rows[0]!.n,4);
 assert.equal((await s.position()).source_version,version);
 const browser=browserToken(s.keys),app=buildServer({config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'silent',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable',CASHBOOK_ENABLED:'true',MONEY_RECEIPTS_ENABLED:'true',AGENT_MONEY_ENABLED:'true'}),database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined}});t.after(()=>app.close());
 const call=(method:'GET'|'POST',path='',actor=s.agent.token,requestKey=randomUUID(),csrfEnabled=true)=>app.inject({method,url:'/api/v1/agent-settlements/cash-captures'+path+'?'+new URLSearchParams(q),cookies:{shipit_session:actor,shipit_browser:browser},headers:{origin:'http://localhost:5173',...(csrfEnabled?{'x-csrf-token':csrf(s.keys,browser)}:{}),'idempotency-key':requestKey,'content-type':'application/json'},...(method==='GET'?{}:{payload:JSON.stringify(body)})});
 assert.equal((await call('POST','',s.agent.token,randomUUID(),false)).statusCode,403);
 const httpKey=randomUUID(),posted=await call('POST','',s.agent.token,httpKey);assert.equal(posted.statusCode,201,posted.body);assert.match(String(posted.headers['cache-control']),/no-store/);
 assert.deepEqual((await call('POST','',s.agent.token,httpKey)).json(),posted.json());
 const opened=await call('GET','/'+posted.json().id);assert.equal(opened.statusCode,200,opened.body);assert.deepEqual(opened.json(),posted.json());assert.match(String(opened.headers['cache-control']),/private/);
 assert.equal((await call('GET','/'+posted.json().id,s.second.token)).statusCode,404);
 await assert.rejects(owner.query(`INSERT INTO shipit.agent_daily_cash_captures(id,organization_id,franchise_id,agent_id,day,counted_at,counted_paise,actor_id,reason,correlation_id,key_digest,fingerprint)
 SELECT $1,organization_id,franchise_id,$2,day,counted_at,counted_paise,actor_id,reason,$3,$4,fingerprint FROM shipit.agent_daily_cash_captures WHERE id=$5`,[randomUUID(),s.second.id,randomUUID(),'b'.repeat(64),first.id]),{sqlState:'23514'});
 for(const sql of ['UPDATE shipit.agent_daily_cash_captures SET counted_paise=0 WHERE id=$1','DELETE FROM shipit.agent_daily_cash_captures WHERE id=$1'])await assert.rejects(owner.query(sql,[first.id]),{sqlState:'23514'});
 await assert.rejects(owner.query(`INSERT INTO shipit.agent_daily_cash_captures(id,organization_id,franchise_id,agent_id,day,counted_at,counted_paise,actor_id,reason,correlation_id,key_digest,fingerprint,source_snapshot)
 SELECT $1,organization_id,franchise_id,agent_id,day,counted_at,counted_paise,actor_id,reason,$2,$3,fingerprint,source_snapshot FROM shipit.agent_daily_cash_captures WHERE id=$4`,[randomUUID(),randomUUID(),'a'.repeat(64),first.id]),{sqlState:'23514'});
 assert.equal((await s.db.adminQuery("SELECT has_function_privilege($1,'shipit.agent_daily_cash_source_frame(uuid,uuid,uuid,date,timestamptz)','EXECUTE') allowed",[s.db.runtimeRole])).rows[0]!.allowed,false);
 await s.memberships.revokeMembership(s.admin.token,s.agent.member.id,{expected_version:s.agent.member.version});
 await assert.rejects(service.read(s.agent.token,first.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});await assert.rejects(capture(s.agent.token,body,key),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(capture(s.operator.token),{code:'RESOURCE_NOT_FOUND'});
 const historyKey=randomUUID();assert.equal((await capture(s.local.token,body,historyKey)).agent_id,s.agent.id);assert.deepEqual(await disabled.read(s.local.token,first.id,q,randomUUID()),first);
 const localAgent=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:s.local.id,role:'delivery_agent',franchise_ids:[A]});await s.memberships.acceptInvitation(s.local.token,{token:localAgent.acceptance_token});
 await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:s.local.member.version});
 await assert.rejects(service.read(s.local.token,first.id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});await assert.rejects(capture(s.local.token,body,historyKey),{code:'RESOURCE_NOT_FOUND'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_effects')).rows[0]!.n,0);assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cash_handover_commands')).rows[0]!.n,0);
});


await test('combined cash and finance source limit rejects a real oversized capture atomically without truncation',{timeout:60000},async t=>{
 const s=await setupAgentMoney(t),{createAgentCashCaptureService}=await import('../../src/modules/agent-settlements/cash-capture-service.ts'),captures=createAgentCashCaptureService(s.pool,true),occurredAt=new Date().toISOString();
 // The fixture pool has three connections and a one-second acquisition deadline.
 // More queued seed commands add no concurrency at the database and can exhaust
 // acquisition time on CI. Preserve all 1,670 real writes and the existing deadline.
 for(let offset=0;offset<1670;offset+=3){await Promise.all(Array.from({length:Math.min(3,1670-offset)},async()=>{const key=randomUUID();return s.receipts.record(s.local.token,q,key,headers(key),{...s.receiptBody,amount_paise:1,allocations:[],occurred_at:occurredAt},randomUUID());}));}
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,1671);
 const count=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(count)),key=randomUUID(),body={agent_id:s.agent.id,day,counted_at:count,counted_paise:211670,reason:'Synthetic full source limit boundary'},version=(await s.position()).source_version;
 await assert.rejects(captures.capture(s.agent.token,q,key,headers(key),body,randomUUID()),{code:'REPORT_LIMIT_EXCEEDED'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.agent_daily_cash_captures')).rows[0]!.n,0);assert.equal((await s.position()).source_version,version);
 const oldAt=s.receiptBody.occurred_at,oldDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(oldAt)),validKey=randomUUID(),old=await captures.capture(s.agent.token,q,validKey,headers(validKey),{...body,day:oldDay,counted_at:oldAt,counted_paise:210000},randomUUID());
 assert.equal((old.source_snapshot.totals as {expected_paise:string}).expected_paise,'210000');assert.equal((old.source_snapshot.cash as {cash_facts:unknown[]}).cash_facts.length,1);assert.equal((old.source_snapshot.finance as {receipt_positions:unknown[]}).receipt_positions.length,1);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_effects')).rows[0]!.n,0);
});
