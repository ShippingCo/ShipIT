import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {auditSetup,org,A,B,otherOrg,C} from '../audit-support.ts';
import {paymentFault} from '../payment-support.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
import {createCashbookRequestService} from '../../src/modules/cashbook/request-service.ts';
import {createCashLocationService} from '../../src/modules/cashbook/location-service.ts';
const headers=(key:string)=>['idempotency-key',key],q={organization_id:org,franchise_id:A};
await test('cash location service preserves exact scoped outcomes and current account/member authority across selection, replay and deactivation',{timeout:30000},async t=>{
 const s=await auditSetup(t);await s.db.prepareCashbook();const admin=await s.grant('franchise_admin',[A]),operator=await s.grant('operator',[A]),other=await s.grant('operator',[A]),sibling=await s.grant('operator',[B]);
 const accounts=createReceivingAccountService(s.pool),service=createCashLocationService(s.pool,true),disabled=createCashLocationService(s.pool,false);
 const makeAccount=async(method:'cash'|'upi')=>{const key=randomUUID();return accounts.configure(admin.token,null,q,key,headers(key),{name:'Synthetic '+method,methods:[method],other_method_name:null,active:true,expected_version:0},randomUUID());};
 const cash=await makeAccount('cash'),upi=await makeAccount('upi');
 const body={account_id:cash.id,expected_account_version:1,custodian_id:operator.id,name:'Synthetic operator drawer',active:true,expected_version:0},key=randomUUID();
 const saved=await service.configure(admin.token,null,q,key,headers(key),body,randomUUID());assert.equal(saved.kind,'cash');assert.equal(saved.custodian_id,operator.id);assert.equal(saved.version,1);
 assert.deepEqual(await disabled.configure(admin.token,null,q,key,headers(key),body,randomUUID()),saved);
 await assert.rejects(service.configure(admin.token,null,q,key,headers(key),{...body,name:'different'},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 await assert.rejects(disabled.configure(admin.token,null,q,randomUUID(),headers('disabled'),{...body,custodian_id:other.id},randomUUID()),{code:'CASHBOOK_DISABLED'});
 const secondKey=randomUUID(),second=await service.configure(admin.token,null,q,secondKey,headers(secondKey),{...body,custodian_id:other.id},randomUUID());
 const bankKey=randomUUID(),bank=await service.configure(admin.token,null,q,bankKey,headers(bankKey),{...body,account_id:upi.id,custodian_id:null,name:'Synthetic UPI recorded funds'},randomUUID());
 assert.equal(bank.kind,'noncash');
 const selected=await service.list(operator.token,q,randomUUID());assert.deepEqual(new Set(selected.items.map(x=>x.id)),new Set([saved.id,bank.id]));
 const page1=await service.list(operator.token,{...q,limit:'1'},randomUUID());assert.equal(page1.items.length,1);assert.ok(page1.next_cursor);
 const page2=await service.list(operator.token,{...q,limit:'1',cursor:page1.next_cursor},randomUUID());assert.equal(page2.items.length,1);assert.equal(page2.next_cursor,null);assert.deepEqual(new Set([...page1.items,...page2.items].map(x=>x.id)),new Set([saved.id,bank.id]));
 assert.deepEqual(await service.read(operator.token,saved.id,q,randomUUID()),saved);
 for(const id of [second.id,randomUUID()])await assert.rejects(service.read(operator.token,id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(service.configure(admin.token,null,q,randomUUID(),headers('foreign'),{...body,custodian_id:sibling.id},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 for(const role of ['operator','accountant','read_only','dispatcher','delivery_agent']){
  const actor=role==='operator'?operator:await s.grant(role,[A]);
  await assert.rejects(service.configure(actor.token,null,q,randomUUID(),headers('denied'),body,randomUUID()),{code:'ACTION_FORBIDDEN'});
  if(role==='accountant')assert.equal((await service.list(actor.token,q,randomUUID())).items.length,3);
  if(['read_only','dispatcher','delivery_agent'].includes(role))await assert.rejects(service.list(actor.token,q,randomUUID()),{code:'ACTION_FORBIDDEN'});
 }
 await assert.rejects(service.configure(s.admin.token,null,q,randomUUID(),headers('orgadmin'),body,randomUUID()),{code:'ACTION_FORBIDDEN'});
 for(const query of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C}]){
  await assert.rejects(service.read(admin.token,saved.id,query,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(service.configure(admin.token,null,query,key,headers(key),body,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 }
 const accountKey=randomUUID();await accounts.configure(admin.token,cash.id,q,accountKey,headers(accountKey),{name:'Synthetic closed cash source',methods:['cash'],other_method_name:null,active:false,expected_version:1},randomUUID());
 assert.deepEqual(await service.configure(admin.token,null,q,key,headers(key),body,randomUUID()),saved);
 await assert.rejects(service.configure(admin.token,saved.id,q,randomUUID(),headers('stale'),{...body,expected_version:1},randomUUID()),{code:'VERSION_CONFLICT'});
 await s.memberships.revokeMembership(s.admin.token,operator.member.id,{expected_version:operator.member.version});
 const deactivateKey=randomUUID(),deactivated=await service.configure(admin.token,saved.id,q,deactivateKey,headers(deactivateKey),{...body,expected_account_version:2,expected_version:1,active:false},randomUUID());assert.equal(deactivated.active,false);assert.equal(deactivated.version,2);
 assert.deepEqual((await s.db.adminQuery('SELECT name,active,version FROM shipit.cash_location_revisions WHERE id=$1',[saved.revision_id])).rows[0],{name:saved.name,active:true,version:1});
 await s.memberships.revokeMembership(s.admin.token,admin.member.id,{expected_version:admin.member.version});
 await assert.rejects(service.configure(admin.token,null,q,key,headers(key),body,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});
await test('cash location races and atomic failures retain one revision and one exact outcome after lost commit acknowledgement',{timeout:30000},async t=>{
 const s=await auditSetup(t);await s.db.prepareCashbook();const admin=await s.grant('franchise_admin',[A]),operator=await s.grant('operator',[A]);
 const accounts=createReceivingAccountService(s.pool),service=createCashLocationService(s.pool,true),key=randomUUID(),a=await accounts.configure(admin.token,null,q,key,headers(key),{name:'Synthetic cash',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const body={account_id:a.id,expected_account_version:1,custodian_id:operator.id,name:'Synthetic drawer',active:true,expected_version:0},createKey=randomUUID(),saved=await service.configure(admin.token,null,q,createKey,headers(createKey),body,randomUUID());
 const updates=await Promise.allSettled(['Synthetic first','Synthetic second'].map(name=>{const k=randomUUID();return service.configure(admin.token,saved.id,q,k,headers(k),{...body,name,expected_version:1},randomUUID());}));
 assert.equal(updates.filter(x=>x.status==='fulfilled').length,1);assert.equal(updates.filter(x=>x.status==='rejected'&&x.reason.code==='VERSION_CONFLICT').length,1);
 const counts=async()=>(await s.db.adminQuery('SELECT (SELECT count(*)::int FROM shipit.cash_locations) locations,(SELECT count(*)::int FROM shipit.cash_location_revisions) revisions,(SELECT version::text FROM shipit.cashbook_source_versions WHERE organization_id=$1 AND franchise_id=$2) version',[org,A])).rows[0];
 assert.deepEqual(await counts(),{locations:1,revisions:2,version:'2'});
 const before=await counts(),failKey=randomUUID();await assert.rejects(createCashLocationService(paymentFault(s.pool,'INSERT INTO shipit.cash_location_revisions','before'),true).configure(admin.token,null,q,failKey,headers(failKey),{...body,custodian_id:admin.id},randomUUID()));assert.deepEqual(await counts(),before);
 const uncertainKey=randomUUID(),uncertainBody={...body,custodian_id:admin.id};await assert.rejects(createCashLocationService(paymentFault(s.pool,'COMMIT','after'),true).configure(admin.token,null,q,uncertainKey,headers(uncertainKey),uncertainBody,randomUUID()));
 const committed=await counts();assert.deepEqual(committed,{locations:2,revisions:3,version:'3'});
 const fresh=createCashLocationService(s.db.runtimePool(),true),recovered=await fresh.configure(admin.token,null,q,uncertainKey,headers(uncertainKey),uncertainBody,randomUUID());assert.equal(recovered.version,1);assert.equal(recovered.custodian_id,admin.id);assert.deepEqual(await counts(),committed);
 assert.deepEqual(await service.configure(admin.token,null,q,uncertainKey,headers(uncertainKey),uncertainBody,randomUUID()),recovered);assert.deepEqual(await counts(),committed);
});

async function requestSetup(t:Parameters<typeof auditSetup>[0]) {
 const s=await auditSetup(t);await s.db.prepareCashbook();const admin=await s.grant('franchise_admin',[A]),reviewer=await s.grant('franchise_admin',[A]),operator=await s.grant('operator',[A]),other=await s.grant('operator',[A]);
 const accounts=createReceivingAccountService(s.pool),locations=createCashLocationService(s.pool,true),service=createCashbookRequestService(s.pool,true);
 const accountKey=randomUUID(),account=await accounts.configure(admin.token,null,q,accountKey,headers(accountKey),{name:'Synthetic cash source',methods:['cash'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const makeLocation=async(custodian:string)=>{const k=randomUUID();return locations.configure(admin.token,null,q,k,headers(k),{account_id:account.id,expected_account_version:1,custodian_id:custodian,name:'Synthetic drawer',active:true,expected_version:0},randomUUID());};
 const location=await makeLocation(operator.id),otherLocation=await makeLocation(other.id);
 const body={kind:'expense',source_location_id:location.id,source_revision_id:location.revision_id,target_location_id:null,target_revision_id:null,expected_source_version:2,amount_paise:50000,currency:'INR',category:'supplies',payee:'Synthetic private vendor',responsible_employee_id:operator.id,reason:'Synthetic expense evidence',occurred_at:'2026-01-01T00:00:00.000Z'};
 return {...s,orgAdmin:s.admin,admin,reviewer,operator,other,account,location,otherLocation,accounts,locations,service,body};
}
await test('cashbook requests keep private immutable proposals, require a different admin and deny stale or out-of-scope sources',{timeout:30000},async t=>{
 const s=await requestSetup(t),key=randomUUID(),saved=await s.service.submit(s.operator.token,q,key,headers(key),s.body,randomUUID()),disabled=createCashbookRequestService(s.pool,false);
 assert.equal(saved.amount_paise,50000);assert.equal(saved.payee,s.body.payee);assert.equal(saved.actor_id,s.operator.id);
 assert.deepEqual(await disabled.submit(s.operator.token,q,key,headers(key),s.body,randomUUID()),saved);
 await assert.rejects(s.service.submit(s.operator.token,q,key,headers(key),{...s.body,amount_paise:50001},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 assert.deepEqual((await s.service.read(s.operator.token,saved.id,q,randomUUID())).request,saved);
 for(const id of [saved.id,randomUUID()])await assert.rejects(s.service.read(s.other.token,id,q,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 for(const role of ['accountant','read_only','dispatcher','delivery_agent']){
  const actor=await s.grant(role,[A]);await assert.rejects(s.service.submit(actor.token,q,randomUUID(),headers('denied'),s.body,randomUUID()),{code:'ACTION_FORBIDDEN'});
  await assert.rejects(s.service.decide(actor.token,saved.id,q,randomUUID(),headers('denied'),{decision:'approved',reason:'Synthetic review',expected_version:1},randomUUID()),{code:'ACTION_FORBIDDEN'});
  if(role==='accountant')assert.deepEqual((await s.service.read(actor.token,saved.id,q,randomUUID())).request,saved);
 }
 await assert.rejects(s.service.submit(s.orgAdmin.token,q,randomUUID(),headers('orgadmin'),s.body,randomUUID()),{code:'ACTION_FORBIDDEN'});
 for(const query of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C}]){
  await assert.rejects(s.service.read(s.admin.token,saved.id,query,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  await assert.rejects(s.service.decide(s.reviewer.token,saved.id,query,randomUUID(),headers('foreign'),{decision:'approved',reason:'Synthetic review',expected_version:1},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 }
 for(const source of [s.otherLocation,{id:randomUUID(),revision_id:randomUUID()}])await assert.rejects(s.service.submit(s.operator.token,q,randomUUID(),headers('private'),{...s.body,source_location_id:source.id,source_revision_id:source.revision_id},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
 await assert.rejects(s.service.submit(s.operator.token,q,randomUUID(),headers('stale'),{...s.body,expected_source_version:1},randomUUID()),{code:'VERSION_CONFLICT'});
 await assert.rejects(s.service.submit(s.operator.token,q,randomUUID(),headers('future'),{...s.body,occurred_at:'2099-01-01T00:00:00.000Z'},randomUUID()),{code:'VALIDATION_FAILED'});
 const ownKey=randomUUID(),own=await s.service.submit(s.admin.token,q,ownKey,headers(ownKey),s.body,randomUUID());
 await assert.rejects(s.service.decide(s.admin.token,own.id,q,randomUUID(),headers('self'),{decision:'approved',reason:'Synthetic self review',expected_version:1},randomUUID()),{code:'CASHBOOK_APPROVAL_REQUIRED'});
 const decisionKey=randomUUID(),decisionInput={decision:'approved',reason:'Synthetic independent review',expected_version:1},decision=await s.service.decide(s.reviewer.token,own.id,q,decisionKey,headers(decisionKey),decisionInput,randomUUID());
 assert.equal(decision.actor_id,s.reviewer.id);assert.equal(decision.version,2);assert.deepEqual(await disabled.decide(s.reviewer.token,own.id,q,decisionKey,headers(decisionKey),decisionInput,randomUUID()),decision);
 await assert.rejects(s.service.decide(s.reviewer.token,own.id,q,decisionKey,headers(decisionKey),{...decisionInput,decision:'rejected'},randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
 assert.equal((await s.service.read(s.admin.token,own.id,q,randomUUID())).version,2);
 const accountKey=randomUUID();await s.accounts.configure(s.admin.token,s.account.id,q,accountKey,headers(accountKey),{name:'Synthetic closed source',methods:['cash'],other_method_name:null,active:false,expected_version:1},randomUUID());
 await assert.rejects(s.service.decide(s.reviewer.token,saved.id,q,randomUUID(),headers('inactive'),decisionInput,randomUUID()),{code:'VERSION_CONFLICT'});
 const rejectKey=randomUUID(),rejected=await s.service.decide(s.reviewer.token,saved.id,q,rejectKey,headers(rejectKey),{...decisionInput,decision:'rejected'},randomUUID());assert.equal(rejected.decision,'rejected');
 assert.deepEqual((await s.service.read(s.operator.token,saved.id,q,randomUUID())).request,saved);
 assert.deepEqual(await s.service.submit(s.operator.token,q,key,headers(key),s.body,randomUUID()),saved);
 assert.deepEqual((await s.db.adminQuery('SELECT version::text v FROM shipit.cashbook_source_versions WHERE organization_id=$1 AND franchise_id=$2',[org,A])).rows[0],{v:'2'});
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.money_receipts')).rows[0]!.n,0);
 await s.memberships.revokeMembership(s.orgAdmin.token,s.reviewer.member.id,{expected_version:s.reviewer.member.version});
 await assert.rejects(s.service.decide(s.reviewer.token,own.id,q,decisionKey,headers(decisionKey),decisionInput,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});
await test('cashbook request and decision races and failures retain exact outcomes without duplicate or partial financial evidence',{timeout:30000},async t=>{
 const s=await requestSetup(t),counts=async()=>(await s.db.adminQuery('SELECT (SELECT count(*)::int FROM shipit.cashbook_requests) requests,(SELECT count(*)::int FROM shipit.cashbook_request_decisions) decisions,(SELECT version::text FROM shipit.cashbook_source_versions WHERE organization_id=$1 AND franchise_id=$2) version',[org,A])).rows[0];
 const failKey=randomUUID();await assert.rejects(createCashbookRequestService(paymentFault(s.pool,'INSERT INTO shipit.cashbook_requests','before'),true).submit(s.operator.token,q,failKey,headers(failKey),s.body,randomUUID()));assert.deepEqual(await counts(),{requests:0,decisions:0,version:'2'});
 const uncertainKey=randomUUID();await assert.rejects(createCashbookRequestService(paymentFault(s.pool,'COMMIT','after'),true).submit(s.operator.token,q,uncertainKey,headers(uncertainKey),s.body,randomUUID()));assert.deepEqual(await counts(),{requests:1,decisions:0,version:'2'});
 const fresh=createCashbookRequestService(s.db.runtimePool(),true),saved=await fresh.submit(s.operator.token,q,uncertainKey,headers(uncertainKey),s.body,randomUUID());
 const replayRace=await Promise.all([fresh.submit(s.operator.token,q,uncertainKey,headers(uncertainKey),s.body,randomUUID()),s.service.submit(s.operator.token,q,uncertainKey,headers(uncertainKey),s.body,randomUUID())]);assert.deepEqual(replayRace,[saved,saved]);
 const decisionInput={decision:'approved',reason:'Synthetic reviewed proposal',expected_version:1},failDecisionKey=randomUUID();
 await assert.rejects(createCashbookRequestService(paymentFault(s.pool,'INSERT INTO shipit.cashbook_request_decisions','before'),true).decide(s.reviewer.token,saved.id,q,failDecisionKey,headers(failDecisionKey),decisionInput,randomUUID()));assert.deepEqual(await counts(),{requests:1,decisions:0,version:'2'});
 const dk=randomUUID();await assert.rejects(createCashbookRequestService(paymentFault(s.pool,'COMMIT','after'),true).decide(s.reviewer.token,saved.id,q,dk,headers(dk),decisionInput,randomUUID()));
 const decision=await fresh.decide(s.reviewer.token,saved.id,q,dk,headers(dk),decisionInput,randomUUID());assert.deepEqual(await counts(),{requests:1,decisions:1,version:'2'});assert.deepEqual((await fresh.read(s.operator.token,saved.id,q,randomUUID())).decision,decision);
 const nextKey=randomUUID(),next=await s.service.submit(s.operator.token,q,nextKey,headers(nextKey),s.body,randomUUID());
 const raced=await Promise.allSettled([s.admin,s.reviewer].map(actor=>{const k=randomUUID();return s.service.decide(actor.token,next.id,q,k,headers(k),decisionInput,randomUUID());}));assert.equal(raced.filter(r=>r.status==='fulfilled').length,1);assert.equal(raced.filter(r=>r.status==='rejected'&&r.reason.code==='VERSION_CONFLICT').length,1);assert.deepEqual(await counts(),{requests:2,decisions:2,version:'2'});
 // Database authority also rejects a forged self approval and history edits through the owner role.
 const ownKey=randomUUID(),own=await s.service.submit(s.admin.token,q,ownKey,headers(ownKey),s.body,randomUUID());
 await assert.rejects(s.db.adminQuery(`INSERT INTO shipit.cashbook_request_decisions(id,organization_id,franchise_id,request_id,decision,reason,actor_id,correlation_id,key_digest,fingerprint)
 VALUES($1,$2,$3,$4,'approved','Synthetic forged approval',$5,$6,repeat('a',64),repeat('b',64))`,[randomUUID(),org,A,own.id,s.admin.id,randomUUID()]));
 const original=(await s.db.adminQuery('SELECT * FROM shipit.cashbook_requests WHERE id=$1',[saved.id])).rows[0];
 for(const sql of ['UPDATE shipit.cashbook_requests SET amount_paise=amount_paise+1','DELETE FROM shipit.cashbook_requests','UPDATE shipit.cashbook_request_decisions SET decision=decision','DELETE FROM shipit.cashbook_request_decisions'])await assert.rejects(s.db.adminQuery(sql));
 await assert.rejects(s.pool.query('UPDATE shipit.cashbook_requests SET reason=reason'));
 assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.cashbook_requests WHERE id=$1',[saved.id])).rows[0],original);
});

await test('cashbook movement proposals capture owned paired locations and database guards reject forged roles, revisions, categories and time',{timeout:30000},async t=>{
 const s=await requestSetup(t),accountKey=randomUUID(),account=await s.accounts.configure(s.admin.token,null,q,accountKey,headers(accountKey),{name:'Synthetic UPI recorded funds',methods:['upi'],other_method_name:null,active:true,expected_version:0},randomUUID());
 const locationKey=randomUUID(),bank=await s.locations.configure(s.admin.token,null,q,locationKey,headers(locationKey),{account_id:account.id,expected_account_version:1,custodian_id:null,name:'Synthetic UPI source',active:true,expected_version:0},randomUUID());
 const base={...s.body,expected_source_version:3,category:null,payee:null},proposals=[
 {...base,kind:'opening_float'},
 {...base,kind:'owner_funds',source_location_id:bank.id,source_revision_id:bank.revision_id},
 {...base,kind:'deposit',target_location_id:bank.id,target_revision_id:bank.revision_id},
 {...base,kind:'withdrawal',source_location_id:bank.id,source_revision_id:bank.revision_id,target_location_id:s.location.id,target_revision_id:s.location.revision_id}
 ];
 for(const input of proposals){const k=randomUUID(),saved=await s.service.submit(s.operator.token,q,k,headers(k),input,randomUUID()),dk=randomUUID();assert.equal(saved.kind,input.kind);assert.equal(saved.target_location_id,input.target_location_id);assert.equal((await s.service.decide(s.reviewer.token,saved.id,q,dk,headers(dk),{decision:'approved',reason:'Synthetic manual evidence',expected_version:1},randomUUID())).decision,'approved');}
 for(const input of [{...proposals[1],kind:'opening_float'},{...proposals[3],kind:'deposit'},{...proposals[2],kind:'withdrawal'}])await assert.rejects(s.service.submit(s.operator.token,q,randomUUID(),headers('wrong-kind'),input,randomUUID()),{code:'VALIDATION_FAILED'});
 const k=randomUUID(),expense=await s.service.submit(s.operator.token,q,k,headers(k),{...s.body,expected_source_version:3},randomUUID()),original=(await s.db.adminQuery('SELECT * FROM shipit.cashbook_requests WHERE id=$1',[expense.id])).rows[0]!;
 const forged=async(changes:Record<string,unknown>)=>{
  const candidate={...original,id:randomUUID(),key_digest:randomUUID().replaceAll('-','').repeat(2),fingerprint:'c'.repeat(64),recorded_at:null,...changes};
  return s.db.adminQuery('INSERT INTO shipit.cashbook_requests SELECT * FROM jsonb_populate_record(NULL::shipit.cashbook_requests,$1::jsonb)',[JSON.stringify(candidate)]);
 };
 const accountant=await s.grant('accountant',[A]),foreign=await s.grant('operator',[B]);
 for(const changes of [{actor_id:accountant.id},{actor_id:s.orgAdmin.id},{actor_id:s.other.id},{responsible_employee_id:foreign.id},{expected_source_version:2},{source_revision_id:s.otherLocation.revision_id},{category:'refund'},{amount_paise:0},{currency:'USD'},{occurred_at:'2099-01-01T00:00:00Z'},{recorded_at:'2026-01-01T00:00:00Z'},{payee:' x '}])await assert.rejects(forged(changes));
 assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.cashbook_requests WHERE id=$1',[expense.id])).rows[0],original);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.cashbook_requests')).rows[0]!.n,5);
 assert.equal((await s.db.adminQuery('SELECT version::text v FROM shipit.cashbook_source_versions WHERE organization_id=$1 AND franchise_id=$2',[org,A])).rows[0]!.v,'3');
});
