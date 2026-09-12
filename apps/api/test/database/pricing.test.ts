import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseError, withTransaction, type DatabasePool } from '@shippingco/db';
import type { PricingQuoteDto } from '@shippingco/shared';
import { pricingSetup, pricingPath, draft, input, start, end } from '../pricing-support.ts';
import { A,B,C,org,otherOrg } from '../audit-support.ts';
import { createPricingService, validatePricingSnapshot } from '../../src/modules/pricing/service.ts';
import * as pricingRepository from '../../src/modules/pricing/repository.ts';
import { withStaffTenantScope } from '../../src/modules/memberships/service.ts';
import { issueTenantAccess, scopedQuery } from '../../src/modules/security/scope.ts';
import { createTenancyService } from '../../src/modules/tenancy/service.ts';
import { approvedAuthority } from '../tenancy-support.ts';
const missing='00000000-0000-4000-8000-000000009999';
type Setup=Awaited<ReturnType<typeof pricingSetup>>;
async function counts(s:Setup) {return (await s.db.adminQuery(`SELECT
  (SELECT count(*)::integer FROM shipit.pricing_versions) AS versions,
  (SELECT count(*)::integer FROM shipit.pricing_versions WHERE state='published') AS published,
  (SELECT count(*)::integer FROM shipit.pricing_rules) AS rules,
  (SELECT count(*)::integer FROM shipit.pricing_quotes) AS quotes,
  (SELECT count(*)::integer FROM shipit.pricing_commands) AS commands,
  (SELECT count(*)::integer FROM shipit.pricing_audit_events) AS audits`)).rows[0];}
function faulty(pool:DatabasePool,point:string):DatabasePool {
  return {...pool,async connect(){const client=await pool.connect();return {release:discard=>client.release(discard),
    async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
      const result=await client.query<Row>(sql,params);if(sql.includes(point))throw new DatabaseError('DB_CONNECTION_FAILED');return result;
    }};}};
}
await test('persisted deterministic slabs, gaps and exact paise survive pool/service reconstruction',{timeout:30000},async t=>{
  const s=await pricingSetup(t),v=await s.published();s.setNow(start);
  for(const [weight,freight] of [[1,12551],[999,12551],[1000,20001],[1001,20001],[1999,20001],[3000,30001],[Number.MAX_SAFE_INTEGER,30001]]) {
    const q=await s.quote({...input,weight_grams:weight});assert.equal(q.statusCode,200,q.body);
    assert.equal(q.json().freight_suggestion_paise,freight);assert.equal(q.json().subtotal_paise,freight!+249);assert.equal(q.json().rate_version_id,v.id);
  }
  for(const weight of [2000,2001,2999])assert.equal((await s.quote({...input,weight_grams:weight})).json().error.code,'NO_RATE');
  const key=randomUUID(),q=(await s.quote(input,s.operator.token,key)).json();
  const restarted=createPricingService(s.db.runtimePool(),s.clock);
  assert.deepEqual(await restarted.quote(s.operator.token,org,A,key,input,randomUUID()),q);
  assert.deepEqual(await restarted.read(s.local.token,org,A,v.id,randomUUID()),v);
  assert.deepEqual(await restarted.validate(s.operator.token,org,A,q.id,input,randomUUID()),q);
});
await test('W27 only local franchise_admin; R21 explicit role matrix; no implicit org writes',{timeout:30000},async t=>{
  const s=await pricingSetup(t);await s.published();
  const siblingAdmin=await s.grant('franchise_admin',[B]),sibling=(await s.create(draft,siblingAdmin.token,randomUUID(),B)).json();
  assert.equal((await s.publish(sibling.id,{expected_version:1},siblingAdmin.token,randomUUID(),B)).statusCode,200);
  s.setNow(start);
  assert.equal((await s.quote(input,s.admin.token,randomUUID(),B)).json().rate_version_id,sibling.id);
  assert.equal((await s.quote(input,s.operator.token,randomUUID(),B)).statusCode,404);
  for(const role of ['franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only','org_admin']) {
    const actor=role==='franchise_admin'?s.local:role==='operator'?s.operator:role==='org_admin'?s.admin:await s.grant(role,[A]);
    const allowed=!['delivery_agent','read_only'].includes(role);
    assert.equal((await s.quote(input,actor.token)).statusCode,allowed?200:403,role);
    const get=await s.app.inject({url:pricingPath(),cookies:s.cookies(actor.token)});assert.equal(get.statusCode,allowed?200:403,role);
    assert.equal((await s.create(draft,actor.token)).statusCode,role==='franchise_admin'?201:403,role);
    const over=await s.quote({...input,override:{freight_paise:12552,reason_code:'customer_agreement'}},actor.token);
    assert.equal(over.statusCode,['franchise_admin','operator','dispatcher'].includes(role)?200:403,role);
  }
});
await test('sibling B and unrelated C IDs/nested scopes cannot expose or mutate pricing',{timeout:30000},async t=>{
  const s=await pricingSetup(t),b=await s.grant('franchise_admin',[B]),c=await s.beta('franchise_admin');
  const own=(await s.create()).json(),sibling=(await s.create(draft,b.token,randomUUID(),B)).json(),foreign=(await s.create(draft,c.token,randomUUID(),C,otherOrg)).json();
  const before=await counts(s);
  for(const id of [sibling.id,foreign.id,missing]) {
    const response=await s.app.inject({url:pricingPath()+'/'+id,cookies:s.cookies(s.local.token)});
    assert.equal(response.statusCode,404);assert.equal((await s.publish(id)).statusCode,404);
    assert.equal((await s.replace(id)).statusCode,404);
    assert.deepEqual(Object.keys(response.json().error).sort(),['code','correlation_id','message']);
  }
  for(const [franchise,organization] of [[B,org],[C,otherOrg],[C,org],[missing,org]]) {
    assert.equal((await s.publish(own.id,{},s.local.token,randomUUID(),franchise,organization)).statusCode,404);
    const q=await s.quote(input,s.operator.token,randomUUID(),franchise,organization);assert.ok([403,404].includes(q.statusCode));
  }
  assert.equal((await s.create({...draft,rules:[{...draft.rules[0],franchise_id:B}]})).statusCode,422);
  assert.deepEqual(await counts(s),before);
  assert.equal((await s.db.adminQuery('SELECT count(*)::integer AS n FROM shipit.pricing_rules WHERE organization_id=$1 AND franchise_id=$2',[org,A])).rows[0]!.n,3);
});
await test('strict HTTP input, malicious totals, precision loss, malformed JSON and unauthenticated requests',{timeout:30000},async t=>{
  const s=await pricingSetup(t);await s.published();s.setNow(start);const before=await counts(s);
  for(const body of [{...input,weight_grams:0},{...input,weight_grams:-1},{...input,weight_grams:1.1},{...input,weight_grams:'1'},
    {...input,weight_grams:Number.MAX_SAFE_INTEGER+1},{...input,service:'overnight'},{...input,destination_key:'a city'},
    ...['organization_id','franchise_id','freight_total','packing_total','calculated_total','rate','price','managerApproved'].map(k=>({...input,[k]:1}))]) {
    const r=await s.quote(body);assert.equal(r.statusCode,422);assert.equal(r.json().error.code,'VALIDATION_FAILED');
  }
  const url='/api/v1/pricing/quote?'+new URLSearchParams({organization_id:org,franchise_id:A});
  for(const [payload,status] of [['{',400],['{"weight_grams":1,"weight_grams":2}',400],['{"weight_grams":1e999}',400],
    ['{"destination_key":"SYN_DEST","service":"standard","weight_grams":9007199254740991.1}',422],
    ['{"destination_key":"SYN_DEST","service":"standard","weight_grams":1e-999}',422]] as const) {
    assert.equal((await s.app.inject({method:'POST',url,headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.operator.token),payload})).statusCode,status);
  }
  assert.equal((await s.quote(input,'')).statusCode,401);
  assert.equal((await s.app.inject({method:'POST',url,headers:s.headers,cookies:s.cookies(s.operator.token),payload:input})).statusCode,422);
  assert.equal((await s.app.inject({method:'POST',url,headers:{'content-type':'application/json','idempotency-key':randomUUID()},cookies:s.cookies(s.operator.token),payload:input})).statusCode,403);
  assert.deepEqual(await counts(s),before);
});
await test('operator threshold denial, privileged reason approval, atomic audit and live revocation',{timeout:30000},async t=>{
  const s=await pricingSetup(t);await s.published();s.setNow(start);
  const inside={...input,override:{freight_paise:13051,reason_code:'customer_agreement'}};
  const outside={...input,override:{freight_paise:13052,reason_code:'commercial_exception'}};
  const q=await s.quote(inside);assert.equal(q.statusCode,200);assert.equal(q.json().variance_paise,500);
  const before=await counts(s);assert.equal((await s.quote(outside)).statusCode,403);assert.deepEqual(await counts(s),before);
  assert.equal((await s.quote({...input,override:{freight_paise:13052}},s.local.token)).statusCode,422);
  const key=randomUUID(),approved=await s.quote(outside,s.local.token,key);assert.equal(approved.statusCode,200,approved.body);
  assert.equal(approved.json().approval_actor_id,s.local.id);assert.equal(approved.json().override_status,'privileged');
  const audits=(await s.db.adminQuery("SELECT action,reason_code,quote_id FROM shipit.pricing_audit_events WHERE quote_id IS NOT NULL ORDER BY occurred_at")).rows;
  assert.deepEqual(audits.map(a=>a.action),['pricing.override','pricing.override.approve']);
  assert.equal(audits[1]!.quote_id,approved.json().id);
  await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:s.local.member.version});
  assert.equal((await s.quote(outside,s.local.token,key)).statusCode,403);
  assert.equal((await s.db.adminQuery('SELECT count(*)::integer AS n FROM shipit.pricing_quotes')).rows[0]!.n,2);
});
await test('draft replacement, version race, command replay/conflict and immutable publication',{timeout:30000},async t=>{
  const s=await pricingSetup(t),key=randomUUID(),one=await s.create(draft,s.local.token,key),id=one.json().id;
  assert.deepEqual((await s.create(draft,s.local.token,key)).json(),one.json());
  assert.equal((await s.create({...draft,override_tolerance_paise:501},s.local.token,key)).json().error.code,'IDEMPOTENCY_CONFLICT');
  const updates=await Promise.all([s.replace(id,{...draft,expected_version:1}),s.replace(id,{...draft,expected_version:1})]);
  assert.deepEqual(updates.map(r=>r.statusCode).sort(),[200,409]);
  const pubKey=randomUUID(),p=await s.publish(id,{expected_version:2},s.local.token,pubKey);assert.equal(p.statusCode,200,p.body);
  assert.deepEqual((await s.publish(id,{expected_version:2},s.local.token,pubKey)).json(),p.json());
  assert.equal((await s.publish(id,{expected_version:1})).json().error.code,'VERSION_CONFLICT');
  assert.equal((await s.replace(id,{...draft,expected_version:3})).json().error.code,'VERSION_CONFLICT');
  assert.deepEqual(await counts(s),{versions:1,published:1,rules:3,quotes:0,commands:3,audits:3});
});
await test('overlap cannot publish; concurrent API publications leave exactly one success',{timeout:30000},async t=>{
  const s=await pricingSetup(t),overlap={...draft,rules:[...draft.rules,{...draft.rules[0]!}]};
  const invalid=(await s.create(overlap)).json();assert.equal((await s.publish(invalid.id)).json().error.code,'RATE_CONFLICT');
  assert.equal((await s.db.adminQuery("SELECT state FROM shipit.pricing_versions WHERE id=$1",[invalid.id])).rows[0]!.state,'draft');
  const a=(await s.create()).json(),b=(await s.create()).json();
  const outcomes=await Promise.all([s.publish(a.id),s.publish(b.id)]);assert.deepEqual(outcomes.map(r=>r.statusCode).sort(),[200,409]);
  assert.equal((await counts(s))!.published,1);
  const facts=(await s.db.adminQuery("SELECT count(*)::integer AS n FROM shipit.pricing_audit_events WHERE action='pricing.publish'")).rows[0]!.n;assert.equal(facts,1);
});
await test('immutable v1 snapshot survives future v2; exact expiry and input/tamper/revocation stale seams',{timeout:30000},async t=>{
  const s=await pricingSetup(t),v1=await s.published();s.setNow(start);
  const q=(await s.quote()).json<PricingQuoteDto>(),snapshot=JSON.stringify(q);
  const v2=await s.published({...draft,effective_from:end,effective_to:'2099-01-03T00:00:00Z',rules:draft.rules.map(r=>({...r,freight_paise:r.freight_paise+111}))});
  assert.notEqual(v1.id,v2.id);assert.equal(JSON.stringify(q),snapshot);
  assert.deepEqual((await s.db.adminQuery('SELECT result FROM shipit.pricing_quotes WHERE id=$1',[q.id])).rows[0]!.result,q);
  s.setNow('2099-01-01T00:09:59.999Z');assert.deepEqual(await s.pricing.validate(s.operator.token,org,A,q.id,input,randomUUID()),q);
  await assert.rejects(s.pricing.validate(s.operator.token,org,A,q.id,{...input,weight_grams:1000},randomUUID()),{code:'QUOTE_STALE'});
  s.setNow(q.expires_at);await assert.rejects(s.pricing.validate(s.operator.token,org,A,q.id,input,randomUUID()),{code:'QUOTE_STALE'});
  s.setNow('2099-01-01T23:59:59Z');const last=(await s.quote()).json();assert.equal(last.expires_at,end);
  s.setNow(end);await assert.rejects(s.pricing.validate(s.operator.token,org,A,last.id,input,randomUUID()),{code:'QUOTE_STALE'});
  assert.equal((await s.quote()).json().rate_version_id,v2.id);
  s.setNow(start);const owner=s.db.ownerPool();await owner.query("UPDATE shipit.pricing_quotes SET result=jsonb_set(result,'{subtotal_paise}','1') WHERE id=$1",[q.id]);
  await assert.rejects(s.pricing.validate(s.operator.token,org,A,q.id,input,randomUUID()),{code:'QUOTE_STALE'});
  const b=await s.grant('operator',[B]);await assert.rejects(s.pricing.validate(b.token,org,B,q.id,input,randomUUID()),{code:'RESOURCE_NOT_FOUND'});
});
await test('fault at state/rules/audit/receipt rolls back all; lost COMMIT response reconciles once',{timeout:30000},async t=>{
  const s=await pricingSetup(t);
  for(const point of ['INSERT INTO shipit.pricing_versions','INSERT INTO shipit.pricing_rules','append_pricing_audit','INSERT INTO shipit.pricing_commands']) {
    const before=await counts(s),bad=createPricingService(faulty(s.pool,point),s.clock);
    await assert.rejects(bad.create(s.local.token,org,A,randomUUID(),draft,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
    assert.deepEqual(await counts(s),before);
  }
  const d=(await s.create()).json(),before=await counts(s),bad=createPricingService(faulty(s.pool,'append_pricing_audit'),s.clock);
  await assert.rejects(bad.publish(s.local.token,org,A,d.id,randomUUID(),{expected_version:1},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await counts(s),before);await s.publish(d.id);s.setNow(start);
  const qBefore=await counts(s);await assert.rejects(bad.quote(s.operator.token,org,A,randomUUID(),{...input,override:{freight_paise:12552,reason_code:'customer_agreement'}},randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await counts(s),qBefore);
  const key=randomUUID(),lost=createPricingService(faulty(s.pool,'COMMIT'),s.clock);
  await assert.rejects(lost.quote(s.operator.token,org,A,key,input,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  const q=await s.pricing.quote(s.operator.token,org,A,key,input,randomUUID());assert.equal(q.subtotal_paise,12800);
  assert.equal((await counts(s))!.quotes,1);
});
await test('database failure and no-rate outcomes remain generic; logs/audit have no prohibited values',{timeout:30000},async t=>{
  const s=await pricingSetup(t);assert.equal((await s.quote()).json().error.code,'NO_RATE');
  await s.published();s.setNow(start);const q=await s.quote();assert.equal(q.statusCode,200);
  await s.quote({...input,override:{freight_paise:99999,reason_code:'commercial_exception'}});
  const history=(await s.list(s.local.token,{resource_type:'pricing'}));assert.equal(history.statusCode,200,history.body);
  assert.equal(history.json().items.length,2);
  const audit=JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.pricing_audit_events')).rows);
  for(const forbidden of [s.operator.token,s.local.token,'Authorization','SYN_DEST','SYN_SOURCE_1','freight_paise','packing_paise','weight_grams']) {
    assert.ok(!audit.includes(forbidden));assert.ok(!s.logs.join('').includes(forbidden));
  }
  assert.ok(!s.logs.join('').includes('organization_id='+org));
  const denial=(await s.db.adminQuery("SELECT * FROM shipit.audit_records WHERE result='denied' ORDER BY occurred_at DESC LIMIT 1")).rows[0]!;
  assert.equal(denial.organization_id,null);assert.equal(denial.franchise_id,null);assert.equal(denial.resource_id,null);
  await s.db.setAvailable(false);
  try {const failed=await s.quote();assert.equal(failed.statusCode,503);assert.deepEqual(Object.keys(failed.json().error).sort(),['code','correlation_id','message']);assert.ok(!/sql|stack|password|select/i.test(failed.body));}
  finally {await s.db.setAvailable(true);}
  assert.equal((await s.quote()).statusCode,200);
});
await test('missing/wrong/read/expired capabilities fail before SQL; transaction-bound snapshot rolls back with coordinator',{timeout:30000},async t=>{
  const s=await pricingSetup(t);await s.published();const hidden=(await s.create()).json();s.setNow(start);const q=(await s.quote()).json();
  await withTransaction(s.pool,async tx=>{
    const scope=issueTenantAccess(tx,{action:'pricing.read',actor:{type:'user',id:s.operator.id},organizationId:org,permittedFranchiseIds:[A],organizationWide:false,provenance:'membership',correlationId:randomUUID()});
    assert.equal(await pricingRepository.find(scope,hidden.id),undefined);assert.deepEqual(await pricingRepository.rules(scope,hidden.id),[]);
    assert.throws(()=>scopedQuery(scope,['pricing.read'],'SELECT shipit.append_pricing_audit($1) WHERE {{franchise:organization_id:franchise_id}}',[]),{code:'ACTION_FORBIDDEN'});
    await assert.rejects(validatePricingSnapshot(scope,q.id,input),{code:'ACTION_FORBIDDEN'});
  });
  let expired:Parameters<typeof validatePricingSnapshot>[0]|undefined;
  const before=await counts(s);
  await assert.rejects(withStaffTenantScope(s.pool,s.operator.token,org,'pricing.validate',async scope=>{
    expired=scope;assert.deepEqual(await validatePricingSnapshot(scope,q.id,input,s.clock()),q);throw new Error('SYN_COORDINATOR_ROLLBACK');
  },{franchiseId:A,correlationId:randomUUID(),object:true}));
  await assert.rejects(validatePricingSnapshot(expired!,q.id,input,s.clock()),{code:'ACTION_FORBIDDEN'});assert.deepEqual(await counts(s),before);
  const tenancy=createTenancyService({database:s.pool,authorizer:approvedAuthority()});
  await tenancy.changeFranchiseLifecycle(A,{lifecycle:'disabled',reason_code:'administrative_disable',expected_version:1});
  assert.equal((await s.quote()).json().error.code,'FRANCHISE_DISABLED');
});
await test('direct runtime conflicting publications serialize at persistent card row and cannot both commit',{timeout:30000},async t=>{
  const s=await pricingSetup(t),a=(await s.create()).json(),b=(await s.create()).json(),owner=s.db.ownerPool();
  const hold=await owner.connect();await hold.query('BEGIN');await hold.query('UPDATE shipit.pricing_cards SET publication_revision=publication_revision+1 WHERE id=$1',[a.card_id]);
  const sql="UPDATE shipit.pricing_versions SET state='published',revision=revision+1,published_at=clock_timestamp(),published_by=$2 WHERE id=$1";
  const one=s.db.runtimePool(),two=s.db.runtimePool();
  const pending=Promise.allSettled([one.query(sql,[a.id,s.local.id]),two.query(sql,[b.id,s.local.id])]);
  let blocked=false;
  try {
    for(let i=0;i<50;i++) {
      const n=(await s.db.adminQuery("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0")).rows[0]!.n;
      if(n>=2){blocked=true;break;}await delay(10);
    }
  } finally {await hold.query('COMMIT');hold.release();}
  const outcomes=await pending;assert.equal(blocked,true);assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
  const rejected=outcomes.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.ok(rejected.reason instanceof DatabaseError);assert.equal(rejected.reason.sqlState,'23514');
  assert.equal((await counts(s))!.published,1);
});

await test('concurrent same-intent keys return one original authorized result and one override fact',{timeout:30000},async t=>{
  const s=await pricingSetup(t),draftKey=randomUUID();
  const drafts=await Promise.all([s.create(draft,s.local.token,draftKey),s.create(draft,s.local.token,draftKey)]);
  assert.deepEqual(drafts.map(r=>r.statusCode),[201,201]);assert.deepEqual(drafts[0]!.json(),drafts[1]!.json());
  assert.equal((await s.publish(drafts[0]!.json().id)).statusCode,200);s.setNow(start);
  const body={...input,override:{freight_paise:12552,reason_code:'customer_agreement'}},key=randomUUID();
  const outcomes=await Promise.all([s.quote(body,s.operator.token,key),s.quote(body,s.operator.token,key)]);
  assert.deepEqual(outcomes.map(r=>r.statusCode),[200,200]);assert.deepEqual(outcomes[0]!.json(),outcomes[1]!.json());
  assert.deepEqual(await counts(s),{versions:1,published:1,rules:3,quotes:1,commands:3,audits:3});
  assert.equal((await s.quote({...body,weight_grams:1000},s.operator.token,key)).json().error.code,'IDEMPOTENCY_CONFLICT');
  s.setNow('2099-01-01T01:00:00Z');
  assert.deepEqual((await s.quote(body,s.operator.token,key)).json(),outcomes[0]!.json());
  const fresh=await s.quote(body,s.local.token,key);assert.equal(fresh.statusCode,200);assert.notEqual(fresh.json().id,outcomes[0]!.json().id);
  assert.equal((await counts(s))!.quotes,2);
});
