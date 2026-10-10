import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {auditSetup,org,A,B,otherOrg,C} from '../audit-support.ts';
import {paymentFault} from '../payment-support.ts';
import {createReceivingAccountService} from '../../src/modules/payments/account-service.ts';
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
