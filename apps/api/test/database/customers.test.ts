import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseError, withTransaction, type DatabasePool } from '@shippingco/db';
import { customerSnapshot } from '@shippingco/shared';
import { customerSetup, customerPath, contact } from '../customer-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createCustomerService } from '../../src/modules/customers/service.ts';
import { createTenancyService } from '../../src/modules/tenancy/service.ts';
import { approvedAuthority } from '../tenancy-support.ts';
import { issueTenantAccess,scopedQuery } from '../../src/modules/security/scope.ts';
import { appendCustomer } from '../../src/modules/audit/repository.ts';
import { buildServer } from '../../src/server.ts';
import { parseEnvironment } from '../../src/env.ts';
const missing='00000000-0000-4000-8000-000000009999';
const disabled={lifecycle:'disabled',reason_code:'administrative_disable',expected_version:1};
type Setup=Awaited<ReturnType<typeof customerSetup>>;
async function counts(s:Setup) {return (await s.db.adminQuery(`SELECT
  (SELECT count(*)::integer FROM shipit.customers) AS customers,
  (SELECT count(*)::integer FROM shipit.customer_commands) AS commands,
  (SELECT count(*)::integer FROM shipit.customer_audit_events) AS audits`)).rows[0];}
function faulty(pool:DatabasePool,point:string,entered:()=>void=()=>{}):DatabasePool {
  return {...pool,async connect(){const client=await pool.connect();return {release:discard=>client.release(discard),
    async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
      const result=await client.query<Row>(sql,params);if(sql.includes(point)){entered();throw new DatabaseError('DB_CONNECTION_FAILED');}return result;
    }};}};
}

await test('same phone stays distinct within A1 and across A2/B1; only authorized candidates and has_more',{timeout:30000},async t=>{
  const s=await customerSetup(t),a2=await s.grant('operator',[B]),b1=await s.beta();
  const one=await s.create(),two=await s.create(s.operator.token,{...contact,name:'Synthetic Household'});
  const sibling=await s.create(a2.token,contact,randomUUID(),B),foreign=await s.create(b1.token,contact,randomUUID(),C,otherOrg);
  for(const response of [one,two,sibling,foreign])assert.equal(response.statusCode,201);
  const ids=[one.json().id,two.json().id,sibling.json().id,foreign.json().id];assert.equal(new Set(ids).size,4);
  for(const [actor,franchise,organization,expected] of [[s.operator,A,org,ids.slice(0,2)],[a2,B,org,[ids[2]]],[b1,C,otherOrg,[ids[3]]]] as const) {
    const response=await s.search({},actor.token,franchise,organization);assert.equal(response.statusCode,200);
    assert.deepEqual(response.json().items.map((x:{id:string})=>x.id),expected);assert.equal(response.json().page.has_more,false);
    assert.deepEqual(Object.keys(response.json()).sort(),['items','page']);
  }
  const page=(await s.search({limit:'1'})).json();assert.equal(page.items.length,1);assert.equal(page.page.has_more,true);
  const last=(await s.search({limit:'1',cursor:page.page.next_cursor})).json();assert.equal(last.items.length,1);assert.equal(last.page.has_more,false);assert.equal(last.page.next_cursor,null);
  for(const id of ids.slice(2).concat(missing)) {
    const read=await s.read(id),edit=await s.update(id,{...contact,expected_version:999});
    assert.equal(read.statusCode,404);assert.equal(edit.statusCode,404);
    assert.equal(read.json().error.code,'RESOURCE_NOT_FOUND');assert.equal(edit.json().error.code,'RESOURCE_NOT_FOUND');
    assert.deepEqual(Object.keys(read.json().error).sort(),['code','correlation_id','message']);
  }
  for(const franchise of [B,C,missing])assert.equal((await s.search({},s.operator.token,franchise)).json().error.code,'RESOURCE_NOT_FOUND');
  assert.equal((await s.read(ids[0])).statusCode,200);assert.deepEqual(await counts(s),{customers:4,commands:4,audits:4});
});

await test('canonical roles allow franchise_admin/operator only, fail V closed, no delete or selector authority',{timeout:30000},async t=>{
  const s=await customerSetup(t),own=(await s.create()).json();
  for(const role of ['franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only','org_admin']) {
    const actor=role==='org_admin'?s.admin:role==='operator'?s.operator:await s.grant(role,[A]);
    const allowed=role==='franchise_admin'||role==='operator';
    assert.equal((await s.search({},actor.token)).statusCode,allowed?200:403);
    assert.equal((await s.read(own.id,actor.token)).statusCode,allowed?200:404);
    assert.equal((await s.create(actor.token)).statusCode,allowed?201:403);
    const current=(await s.read(own.id)).json();
    assert.equal((await s.update(own.id,{...contact,expected_version:current.version},randomUUID(),actor.token)).statusCode,allowed?200:404);
  }
  assert.equal((await s.app.inject(customerPath()+'?search_by=name&q=Syn')).statusCode,401);
  assert.equal((await s.app.inject({method:'DELETE',url:customerPath()+'/'+own.id,headers:s.headers,cookies:s.cookies(s.operator.token),payload:{}})).statusCode,404);
  assert.equal((await s.create(s.operator.token,{...contact,organization_id:otherOrg,franchise_id:C,role:'org_admin'})).statusCode,422);
  assert.equal((await s.create(s.operator.token,contact,randomUUID(),C,otherOrg)).statusCode,403);
});

await test('strict HTTP validation returns safe field codes for phone/address/IDs/search/keys/version',{timeout:30000},async t=>{
  const s=await customerSetup(t),own=(await s.create()).json();
  for(const [body,field] of [[{...contact,phone:'2025550100'},'phone'],[{...contact,phone:'SYN_PRIVATE_PHONE'},'phone'],
    [{...contact,address:'x'.repeat(501)},'address'],[{...contact,name:''},'name'],[{...contact,SYN_UNKNOWN:'SYN_VALUE'},'$']] as const) {
    const response=await s.create(s.operator.token,body);assert.equal(response.statusCode,422);
    assert.equal(response.json().error.code,'VALIDATION_FAILED');assert.equal(response.json().error.details[0].field,field);
    assert.doesNotMatch(response.body,/SYN_PRIVATE|SYN_UNKNOWN|SYN_VALUE|2025550100/);
  }
  for(const key of ['', 'a b','a,b','x'.repeat(256)])assert.equal((await s.create(s.operator.token,contact,key)).json().error.code,'VALIDATION_FAILED');
  const missingKey=await s.app.inject({method:'POST',url:customerPath(),headers:s.headers,cookies:s.cookies(s.operator.token),payload:contact});
  assert.equal(missingKey.statusCode,422);
  const duplicate=await s.app.inject({method:'POST',url:customerPath(),headers:{...s.headers,'idempotency-key':['one','two']},cookies:s.cookies(s.operator.token),payload:contact});
  assert.equal(duplicate.statusCode,422);
  for(const id of ['bad-id','not-a-uuid'])assert.equal((await s.read(id)).statusCode,422);
  assert.equal((await s.create(s.operator.token,contact,randomUUID(),'invalid')).statusCode,422);
  for(const extra of [{limit:'0'},{limit:'101'},{limit:'01'},{limit:'1.1'},{q:'+1202555'},{q:'2025550100'},
    {q:'ab',search_by:'name'},{unknown:'SYN_QUERY'},{cursor:''}] as Record<string,string>[])assert.equal((await s.search(extra)).statusCode,422);
  for(const expected_version of [undefined,0,'1',1.1,2147483647])assert.equal((await s.update(own.id,{...contact,expected_version})).statusCode,422);
  assert.deepEqual(await counts(s),{customers:1,commands:1,audits:1});
  assert.doesNotMatch(s.logs.join(''),/SYN_PRIVATE|SYN_UNKNOWN|SYN_VALUE|SYN_QUERY|2025550100/);
});

await test('new customer endpoints inherit cookie, CSRF, Origin and safe error policy',{timeout:30000},async t=>{
  const s=await customerSetup(t);
  for(const headers of [{}, {origin:'https://foreign.example'}, {...s.headers,origin:'https://foreign.example'}, {...s.headers,'sec-fetch-site':'cross-site'}]) {
    const result=await s.app.inject({method:'POST',url:customerPath(),headers:{...headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.operator.token),payload:contact});
    assert.equal(result.statusCode,403);assert.equal(result.json().error.code,'ACTION_FORBIDDEN');
  }
  const anonymous=await s.app.inject({method:'POST',url:customerPath(),headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(''),payload:contact});assert.equal(anonymous.statusCode,401);
  const good=await s.create();assert.equal(good.statusCode,201);assert.equal(good.headers['cache-control'],'no-store');
  const invalid=await s.app.inject({method:'POST',url:customerPath(),headers:{...s.headers,'idempotency-key':randomUUID(),'content-type':'application/json'},cookies:s.cookies(s.operator.token),payload:'{"name":"Synthetic","name":"Duplicate"}'});
  assert.equal(invalid.statusCode,400);assert.deepEqual(await counts(s),{customers:1,commands:1,audits:1});
});

await test('create and edit replay original DTO/status exactly once, conflict across targets and reauthorize first',{timeout:30000},async t=>{
  const s=await customerSetup(t),key=randomUUID(),first=await s.create(s.operator.token,contact,key),one=first.json();assert.equal(first.statusCode,201);
  const same=await s.create(s.operator.token,{address:contact.address,phone:contact.phone,name:' Synthetic Contact '},key);
  assert.equal(same.statusCode,201);assert.deepEqual(same.json(),one);
  const conflict=await s.create(s.operator.token,{...contact,name:'Other Synthetic'},key);assert.equal(conflict.statusCode,409);assert.equal(conflict.json().error.code,'IDEMPOTENCY_CONFLICT');
  const editKey=randomUUID(),editBody={...contact,address:'Updated Synthetic',expected_version:1};
  const edit=await s.update(one.id,editBody,editKey);assert.equal(edit.statusCode,200);assert.equal(edit.json().version,2);
  assert.deepEqual((await s.update(one.id,editBody,editKey)).json(),edit.json());
  const later=await s.update(one.id,{...contact,expected_version:2});assert.equal(later.json().version,3);
  assert.deepEqual((await s.create(s.operator.token,contact,key)).json(),one);
  assert.deepEqual((await s.update(one.id,editBody,editKey)).json(),edit.json());
  assert.equal((await s.update(one.id,{...editBody,expected_version:3},editKey)).json().error.code,'IDEMPOTENCY_CONFLICT');
  const two=(await s.create()).json();assert.equal((await s.update(two.id,editBody,editKey)).json().error.code,'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(await counts(s),{customers:2,commands:4,audits:4});
  const receipt=(await s.db.adminQuery('SELECT * FROM shipit.customer_commands WHERE customer_id=$1 ORDER BY recorded_at',[one.id])).rows[0]!;
  assert.ok(!JSON.stringify(receipt).includes(key));assert.equal(receipt.normalization_version,1);assert.ok(receipt.retain_until-receipt.recorded_at>=86400000);
  await s.memberships.revokeMembership(s.admin.token,s.operator.member.id,{expected_version:1});
  assert.equal((await s.create(s.operator.token,contact,key)).statusCode,403);
  assert.equal((await s.update(one.id,editBody,editKey)).statusCode,404);
});

await test('concurrent same-key requests commit once and competing stale edits cannot overwrite',{timeout:30000},async t=>{
  const s=await customerSetup(t),key=randomUUID();
  const results=await Promise.all(Array.from({length:3},()=>s.create(s.operator.token,contact,key)));
  assert.ok(results.every(r=>r.statusCode===201));assert.ok(results.every(r=>r.json().id===results[0]!.json().id));
  const id=results[0]!.json().id;
  const edits=await Promise.all([s.update(id,{...contact,address:'Synthetic Winner One',expected_version:1}),s.update(id,{...contact,address:'Synthetic Winner Two',expected_version:1})]);
  assert.deepEqual(edits.map(r=>r.statusCode).sort(),[200,409]);assert.equal(edits.find(r=>r.statusCode===409)!.json().error.code,'VERSION_CONFLICT');
  const persisted=(await s.read(id)).json();assert.equal(persisted.version,2);assert.equal(persisted.address,edits.find(r=>r.statusCode===200)!.json().address);
  assert.deepEqual(await counts(s),{customers:1,commands:2,audits:2});
});

await test('snapshot values survive real contact correction; stale foreign requests disclose no current version',{timeout:30000},async t=>{
  const s=await customerSetup(t),one=(await s.create()).json(),snapshot=customerSnapshot(one);
  const updated=await s.update(one.id,{...contact,address:'New Synthetic Address',expected_version:1});assert.equal(updated.statusCode,200);
  assert.equal(snapshot.address,contact.address);assert.equal(snapshot.source_customer_version,1);
  const stale=await s.update(one.id,{...contact,expected_version:1});assert.equal(stale.json().error.code,'VERSION_CONFLICT');
  assert.deepEqual(Object.keys(stale.json().error).sort(),['code','correlation_id','message']);
  const a2=await s.grant('operator',[B]);assert.equal((await s.update(one.id,{...contact,expected_version:1},randomUUID(),a2.token,B)).json().error.code,'RESOURCE_NOT_FOUND');
});

await test('keyset/has_more are scoped, literal prefixes cannot become wildcards, cursors bind every context',{timeout:30000},async t=>{
  const s=await customerSetup(t),a2=await s.grant('operator',[B]),b1=await s.beta();
  const created=[];
  for(let i=0;i<5;i++) {
    const id=randomUUID();created.push(id);
    await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display,address,created_at)
      VALUES($1,$2,$3,$4,'+12025550100','+12025550100','','2026-09-12T00:00:00Z')`,[id,org,A,`Synthetic%_${i}`]);
  }
  created.sort();
  for(const [o,f,n] of [[org,B,25],[otherOrg,C,10]] as const)for(let i=0;i<n;i++) {
    await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display,address,created_at)
      VALUES($1,$2,$3,'Synthetic Other','+12025550100','+12025550100','','2026-09-12T00:00:00Z')`,[randomUUID(),o,f]);
  }
  // Force ties through initial fixture INSERT timestamps, preserving immutable production columns.
  const seen:string[]=[];let cursor:string|null=null,pages=0;
  do {const response=await s.search({limit:'2',...(cursor?{cursor}:{})});assert.equal(response.statusCode,200);const body=response.json();
    seen.push(...body.items.map((r:{id:string})=>r.id));cursor=body.page.next_cursor;pages++;assert.equal(body.page.has_more,!!cursor);
  }while(cursor&&pages<10);
  assert.equal(pages,3);assert.deepEqual(seen,created);assert.equal(new Set(seen).size,5);
  assert.equal((await s.search({search_by:'name',q:'Synthetic%_'})).json().items.length,5);
  assert.equal((await s.search({search_by:'name',q:'synthetic'})).json().items.length,0);
  const first=(await s.search({limit:'2'})).json(),token=first.page.next_cursor;
  for(const extra of [{limit:'3'},{q:'+1202555010'},{search_by:'name',q:'Synthetic'},{cursor:token.slice(1)}] as Record<string,string>[])assert.equal((await s.search({limit:'2',cursor:token,...extra})).json().error.code,'CURSOR_INVALID');
  assert.equal((await s.search({limit:'2',cursor:token},a2.token,B)).json().error.code,'CURSOR_INVALID');
  assert.equal((await s.search({limit:'2',cursor:token},b1.token,C,otherOrg)).json().error.code,'CURSOR_INVALID');
  await s.memberships.updateMembership(s.admin.token,s.operator.member.id,{role:'operator',franchise_ids:[A,B],expected_version:1});
  assert.equal((await s.search({limit:'2',cursor:token})).json().error.code,'CURSOR_INVALID');
  assert.equal((await s.search({limit:'2',cursor:token},s.operator.token,B)).json().error.code,'CURSOR_INVALID');
});

await test('search limiter is stricter than global, cannot be reset with new query or selector, safe Retry-After',{timeout:30000},async t=>{
  const s=await customerSetup(t),row=(await s.create()).json();
  for(let i=0;i<30;i++)assert.equal((await s.search({q:i%2?'+12025550100':'+12025550'},s.operator.token,A,org,'192.0.2.19')).statusCode,200);
  const limited=await s.search({q:'+12025550101'},s.operator.token,A,org,'192.0.2.19');
  assert.equal(limited.statusCode,429);assert.equal(limited.json().error.code,'RATE_LIMITED');assert.ok(Number(limited.headers['retry-after'])>0);
  assert.equal((await s.search({},s.operator.token,B,org,'192.0.2.19')).statusCode,429);
  assert.equal((await s.search({},s.operator.token,A,org,'192.0.2.20')).statusCode,200);
  const fact=(await s.db.adminQuery('SELECT * FROM shipit.audit_records WHERE correlation_id=$1',[limited.headers['x-request-id']])).rows[0]!;
  assert.equal(fact.action,'customer.list');assert.equal(fact.resource_type,'customer');assert.equal(fact.organization_id,null);assert.equal(fact.resource_id,null);
  assert.ok(!s.logs.join('').includes('+12025550101'));
  // Customer searches also consume the unchanged global 120/minute budget.
  for(let i=0;i<30;i++)assert.equal((await s.search({},s.operator.token,A,org,'192.0.2.21')).statusCode,200);
  for(let i=0;i<90;i++)assert.equal((await s.app.inject({url:customerPath()+'/'+row.id,cookies:s.cookies(s.operator.token),remoteAddress:'192.0.2.21'})).statusCode,200);
  const global=await s.app.inject({url:customerPath()+'/'+row.id,cookies:s.cookies(s.operator.token),remoteAddress:'192.0.2.21'});
  assert.equal(global.statusCode,429);assert.equal(global.json().error.code,'RATE_LIMITED');
});

await test('mutation/audit/receipt failures roll back all effects and lost COMMIT reply safely replays',{timeout:30000},async t=>{
  const s=await customerSetup(t);
  for(const point of ['INSERT INTO shipit.customers','append_customer_audit','INSERT INTO shipit.customer_commands']) {
    let entered=false;const service=createCustomerService(faulty(s.pool,point,()=>{entered=true;}),s.keys.browser);
    await assert.rejects(service.create(s.operator.token,org,A,randomUUID(),contact,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
    assert.equal(entered,true);assert.deepEqual(await counts(s),{customers:0,commands:0,audits:0});
  }
  const id=(await s.create()).json().id,before=await counts(s),original=(await s.read(id)).json();
  for(const point of ['UPDATE shipit.customers','append_customer_audit','INSERT INTO shipit.customer_commands']) {
    const service=createCustomerService(faulty(s.pool,point),s.keys.browser);
    await assert.rejects(service.update(s.operator.token,org,A,id,randomUUID(),{...contact,address:'Failed Synthetic Edit',expected_version:1},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
    assert.deepEqual(await counts(s),before);assert.deepEqual((await s.read(id)).json(),original);
  }
  const key=randomUUID(),uncertain=createCustomerService(faulty(s.pool,'COMMIT'),s.keys.browser);
  await assert.rejects(uncertain.create(s.operator.token,org,A,key,contact,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await counts(s),{customers:2,commands:2,audits:2});
  const replay=await s.create(s.operator.token,contact,key);assert.equal(replay.statusCode,201);assert.notEqual(replay.json().id,id);
  assert.deepEqual(await counts(s),{customers:2,commands:2,audits:2});
});

await test('disabled roots block new writes/search but preserve authorized detail and committed replay',{timeout:30000},async t=>{
  const s=await customerSetup(t),key=randomUUID(),created=await s.create(s.operator.token,contact,key),one=created.json();
  const tenancy=createTenancyService({database:s.pool,authorizer:approvedAuthority()});
  await tenancy.changeFranchiseLifecycle(A,disabled);
  assert.equal((await s.create()).json().error.code,'FRANCHISE_DISABLED');
  assert.equal((await s.update(one.id)).json().error.code,'FRANCHISE_DISABLED');
  assert.equal((await s.search()).json().error.code,'FRANCHISE_DISABLED');
  assert.equal((await s.read(one.id)).statusCode,200);assert.deepEqual((await s.create(s.operator.token,contact,key)).json(),one);
  await tenancy.changeFranchiseLifecycle(A,{lifecycle:'active',reason_code:'administrative_reactivate',expected_version:2});
  const root=createTenancyService({database:s.pool,authorizer:approvedAuthority(org,[],'service')});await root.changeOrganizationLifecycle(disabled);
  assert.equal((await s.create()).json().error.code,'ORGANIZATION_DISABLED');assert.equal((await s.update(one.id)).json().error.code,'ORGANIZATION_DISABLED');
  assert.equal((await s.read(one.id)).statusCode,200);assert.deepEqual(await counts(s),{customers:1,commands:1,audits:1});
});

await test('customer write committed first serializes both franchise and organization disable',{timeout:30000},async t=>{
  const s=await customerSetup(t);
  for(const target of ['franchise','organization'] as const) {
    let release!:()=>void,entered!:()=>void,pid=0;
    const hold=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
    const held:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();pid=(await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
        if(sql==='COMMIT'){entered();await hold;}return client.query<Row>(sql,params);
      }};}};
    const customer=createCustomerService(held,s.keys.browser),write=customer.create(s.operator.token,org,A,randomUUID(),contact,randomUUID());
    await ready;const blocking=pid;
    const tenant=createTenancyService({database:s.pool,authorizer:approvedAuthority(org,[A],'service')});
    const disable=target==='franchise'?tenant.changeFranchiseLifecycle(A,disabled):tenant.changeOrganizationLifecycle(disabled);
    void disable.catch(()=>{});
    try {
      const deadline=Date.now()+3000;let blocked=false;
      while(Date.now()<deadline){const result=await s.db.adminQuery<{blocked:boolean}>('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[blocking]);
        if(result.rows[0]!.blocked){blocked=true;break;}await delay(10);}
      assert.equal(blocked,true);release();await write;await disable;
      assert.equal((await s.create()).json().error.code,target==='franchise'?'FRANCHISE_DISABLED':'ORGANIZATION_DISABLED');
    }finally{release();await Promise.allSettled([write,disable]);}
    if(target==='franchise')await tenant.changeFranchiseLifecycle(A,{lifecycle:'active',reason_code:'administrative_reactivate',expected_version:2});
  }
});

await test('restart restores authorized customer, original receipt and cursor; outage cannot fabricate success',{timeout:30000},async t=>{
  const s=await customerSetup(t),key=randomUUID(),first=(await s.create(s.operator.token,contact,key)).json();await s.create();
  const cursor=(await s.search({limit:'1'})).json().page.next_cursor;
  await s.app.close();await s.pool.close();const replacement=s.db.runtimePool();
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const app=buildServer({config,database:replacement,auth:{keys:s.keys,delivery:{},webhook:undefined},logSink:{write:x=>s.logs.push(x)}});t.after(()=>app.close());
  const detail=await app.inject({url:customerPath()+'/'+first.id,cookies:s.cookies(s.operator.token)});assert.equal(detail.statusCode,200);assert.deepEqual(detail.json(),first);
  const service=createCustomerService(replacement,s.keys.browser);
  assert.deepEqual(await service.create(s.operator.token,org,A,key,contact,randomUUID()),first);
  const second=await service.list(s.operator.token,org,A,{search_by:'phone',q:contact.phone,limit:'1',cursor},randomUUID());assert.equal(second.items.length,1);assert.notEqual(second.items[0]!.id,first.id);
  await s.db.setAvailable(false);
  try {const outage=await app.inject({url:customerPath()+'/'+first.id,cookies:s.cookies(s.operator.token)});assert.equal(outage.statusCode,503);
    await assert.rejects(service.create(s.operator.token,org,A,randomUUID(),contact,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  }finally{await s.db.setAvailable(true);}
  assert.deepEqual(await counts(s),{customers:2,commands:2,audits:2});
});

await test('customer audit is reference-only, R28 scoped, denied probes have no targets, read/expired capabilities cannot append',{timeout:30000},async t=>{
  const s=await customerSetup(t),one=(await s.create()).json();await s.update(one.id);
  const facts=(await s.db.adminQuery('SELECT * FROM shipit.audit_history WHERE resource_type=$1',['customer'])).rows;
  assert.equal(facts.length,2);assert.deepEqual(facts.map(r=>r.committed_version).sort(),[1,2]);
  assert.ok(facts.every(r=>r.id.startsWith('customer:')&&r.previous_lifecycle===null&&r.new_lifecycle===null));
  const a2=await s.grant('franchise_admin',[B]);assert.equal((await s.list(a2.token,{resource_type:'customer'})).json().items.length,0);
  for(const id of [one.id,missing]) {
    const denied=await s.read(id,a2.token,B);assert.equal(denied.statusCode,404);
    const fact=(await s.db.adminQuery('SELECT * FROM shipit.audit_records WHERE correlation_id=$1',[denied.headers['x-request-id']])).rows[0]!;
    assert.equal(fact.action,'customer.read');assert.equal(fact.resource_id,null);assert.equal(fact.organization_id,null);assert.ok(!JSON.stringify(fact).includes(id));
  }
  const surfaces=JSON.stringify(facts)+s.logs.join('');for(const value of [contact.name,contact.phone,contact.address!,one.phone,s.operator.token])assert.ok(!surfaces.includes(value));
  let captured:Parameters<typeof appendCustomer>[0]|undefined;
  await withTransaction(s.pool,async tx=>{
    captured=issueTenantAccess(tx,{action:'customer.read',actor:{type:'user',id:s.operator.id},organizationId:org,permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'membership'});
    assert.throws(()=>scopedQuery(captured!,['customer.read'],`SELECT shipit.append_customer_audit($1,$2,$3,$4,'customer.create',1,$5) WHERE {{franchise:$1:$2}}`,[org,A,one.id,s.operator.id,randomUUID()]),{code:'ACTION_FORBIDDEN'});
    await assert.rejects(appendCustomer(captured,A,one.id,1),{code:'ACTION_FORBIDDEN'});
  });
  await assert.rejects(appendCustomer(captured!,A,one.id,1),{code:'ACTION_FORBIDDEN'});
});

await test('disable committed first makes a concurrently waiting customer write fail without partial state',{timeout:30000},async t=>{
  const s=await customerSetup(t);
  for(const target of ['franchise','organization'] as const) {
    let release!:()=>void,entered!:()=>void,pid=0;
    const hold=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;});
    const held:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();pid=(await client.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
      return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
        if(sql==='COMMIT'){entered();await hold;}return client.query<Row>(sql,params);
      }};}};
    const tenant=createTenancyService({database:held,authorizer:approvedAuthority(org,[A],'service')});
    const disable=target==='franchise'?tenant.changeFranchiseLifecycle(A,disabled):tenant.changeOrganizationLifecycle(disabled);
    await ready;const blocking=pid,write=s.customer.create(s.operator.token,org,A,randomUUID(),contact,randomUUID());
    const denied=assert.rejects(write,{code:target==='franchise'?'FRANCHISE_DISABLED':'ORGANIZATION_DISABLED'});
    try {
      const deadline=Date.now()+3000;let blocked=false;
      while(Date.now()<deadline){const result=await s.db.adminQuery<{blocked:boolean}>('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[blocking]);
        if(result.rows[0]!.blocked){blocked=true;break;}await delay(10);}
      assert.equal(blocked,true);release();await disable;await denied;
      assert.deepEqual(await counts(s),{customers:0,commands:0,audits:0});
    }finally{release();await Promise.allSettled([disable,denied]);}
    if(target==='franchise')await createTenancyService({database:s.pool,authorizer:approvedAuthority()})
      .changeFranchiseLifecycle(A,{lifecycle:'active',reason_code:'administrative_reactivate',expected_version:2});
  }
});
