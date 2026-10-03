import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { carrierSetup } from '../carrier-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { rateFields } from '../../src/modules/carriers/rate-validation.ts';
import { createCarrierRateService } from '../../src/modules/carriers/rate-service.ts';
import { paymentFault } from '../payment-support.ts';
import type { DatabasePool } from '@shippingco/db';
import { createReceiptService } from '../../src/modules/receipts/service.ts';
async function setup(t:Parameters<typeof carrierSetup>[0]) {
  const s=await carrierSetup(t),iid=(await s.install()).json().id as string;
  async function mapping(kind:string,source:string){const result=await s.request('POST',`carriers/installations/${iid}/mappings`,{kind,source_code:source,normalized_id:null,expected_version:0,reason_code:'initial_mapping'});assert.equal(result.statusCode,201,result.body);return result.json().id as string;}
  const origin=await mapping('location','ORG'),destination=await mapping('location','DEST'),service=await mapping('service','STD');
  const config={purpose:'customer_selling',origin_mapping_id:origin,services:[{mapping_id:service,target:'standard'}],locations:[{mapping_id:destination,target:'SYN_DEST'}],
    expected_lanes:[{destination_key:'SYN_DEST',service:'standard'}],weight_unit:'kg',amount_unit:'rupees',
    policy:{effective_from:'2099-01-03T00:00:00Z',effective_to:'2099-01-04T00:00:00Z',quote_validity_seconds:600,override_tolerance_paise:0,approval_ref:'SYN_APPROVED'}};
  const body=(rows=['STD,ORG,DEST,0.001,2,kg,100.01,2.49,INR,rupees'])=>({...config,content_base64:Buffer.from(rateFields.join(',')+'\n'+rows.join('\n')).toString('base64')});
  const upload=(b:unknown=body(),key=randomUUID())=>s.request('POST',`carriers/installations/${iid}/rates`,b,s.local.token,key);
  const approve=(id:string,key=randomUUID())=>s.request('POST',`carriers/rates/${id}/approve`,{expected_version:1},s.local.token,key);
  return {...s,iid,origin,destination,service,config,body,upload,approve};
}
await test('rates publish through Pricing with exact provenance, durable retries and immutable old financial snapshots',{timeout:60000},async t=>{
  const s=await setup(t),before=(await s.db.adminQuery('SELECT * FROM shipit.bookings')).rows;
  await s.db.prepareReceipts();
  const receiptService=createReceiptService(s.pool),bookingId=(before[0]!.id as string);
  const receipt=await receiptService.read(s.local.token,bookingId,null,s.q,randomUUID());
  const key=randomUUID(),results=await Promise.all([s.upload(s.body(),key),s.upload(s.body(),key),s.upload()]);
  for(const result of results)assert.equal(result.statusCode,201,result.body);
  const run=results[0]!.json();assert.equal(run.state,'ready');assert.ok(results.every(r=>r.json().id===run.id));
  assert.equal((await s.upload({...s.body(),purpose:'courier_purchase_estimate'},key)).statusCode,409);
  const approvalKey=randomUUID(),approved=await Promise.all([s.approve(run.id,approvalKey),s.approve(run.id,approvalKey)]);
  for(const result of approved)assert.equal(result.statusCode,200,result.body);
  assert.equal(approved[0]!.json().approval.pricing_version_id,approved[1]!.json().approval.pricing_version_id);
  assert.equal((await s.approve(run.id)).statusCode,409);
  assert.equal((await s.quote()).json().policy.source_ref,'SYN_SOURCE_1');
  s.setNow('2099-01-03T00:00:00Z');const quote=await s.quote();assert.equal(quote.statusCode,200,quote.body);
  assert.equal(quote.json().policy.source_ref,'carrier-rate:'+run.id);assert.equal(quote.json().subtotal_paise,10250);
  const estimate=await s.upload({...s.body(['STD,ORG,DEST,0.001,2,kg,60.00,0,INR,rupees']),purpose:'courier_purchase_estimate',policy:{...s.config.policy,effective_from:'2099-01-03T01:00:00Z'}});
  assert.equal(estimate.statusCode,201,estimate.body);const purchase=await s.approve(estimate.json().id);assert.equal(purchase.statusCode,200,purchase.body);
  assert.equal(purchase.json().approval.pricing_version_id,null);assert.deepEqual(purchase.json().actual_cost,{state:'unknown'});
  assert.equal(purchase.json().rows[0].rule.freight_paise,6000);
  assert.equal((await s.quote()).json().subtotal_paise,10250);
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.bookings')).rows,before);
  assert.deepEqual(await receiptService.read(s.local.token,bookingId,null,s.q,randomUUID()),receipt);
  const pool=s.db.runtimePool();t.after(()=>pool.close());const restarted=createCarrierRateService(pool,s.clock);
  assert.deepEqual(await restarted.read(s.local.token,run.id,s.q,randomUUID()),approved[0]!.json());
  const count=(await s.db.adminQuery('SELECT count(*)::int AS n FROM shipit.carrier_rate_imports')).rows[0];assert.equal(count!.n,2);
  // Fictional source-to-total evidence: selling 10001 + packing 249; estimate is not actual expense.
  assert.equal(quote.json().freight_paise+quote.json().packing_paise,10250);
  const overlap=await s.upload({...s.body(['STD,ORG,DEST,0.001,2,kg,65.00,0,INR,rupees']),purpose:'courier_purchase_estimate',policy:{...s.config.policy,effective_from:'2099-01-03T01:00:00Z'}});
  assert.ok(overlap.json().issues.includes('EFFECTIVE_OVERLAP'));assert.equal((await s.approve(overlap.json().id)).statusCode,409);
});
await test('rates expose unit, mapping, overlap, lane and stale-state failures without partial publication',{timeout:60000},async t=>{
  const s=await setup(t);
  const cases=[{body:s.body(['STD,ORG,DEST,1,2,g,1,0,INR,rupees']),issue:'INVALID_ROWS'},
    {body:s.body(['MISSING,ORG,DEST,1,2,kg,1,0,INR,rupees']),issue:'INVALID_ROWS'},
    {body:s.body(['STD,ORG,DEST,1,2,kg,1,0,INR,rupees','STD,ORG,DEST,1.5,3,kg,2,0,INR,rupees']),issue:'OVERLAPPING_SLABS'},
    {body:{...s.body(),expected_lanes:[...s.config.expected_lanes,{destination_key:'MISSING',service:'express'}]},issue:'MISSING_LANES'}];
  for(const item of cases){const result=await s.upload(item.body);assert.equal(result.statusCode,201,result.body);assert.ok(result.json().issues.includes(item.issue));assert.equal((await s.approve(result.json().id)).statusCode,409);}
  const good=(await s.upload()).json();
  const corrected=await s.request('POST',`carriers/installations/${s.iid}/mappings`,{kind:'service',source_code:'STD',normalized_id:null,expected_version:1,reason_code:'mapping_correction'});assert.equal(corrected.statusCode,201,corrected.body);
  assert.equal((await s.approve(good.id)).statusCode,409);
  assert.equal((await s.db.adminQuery('SELECT count(*)::int AS n FROM shipit.carrier_rate_approvals')).rows[0]!.n,0);
  assert.equal((await s.upload({...s.body(),content_base64:Buffer.from('bad\nrow').toString('base64')})).statusCode,422);
});
await test('rate sheets enforce admin permissions and nested ownership on reads, approval and replay',{timeout:60000},async t=>{
  const s=await setup(t),key=randomUUID(),run=(await s.upload(s.body(),key)).json(),before=(await s.db.adminQuery('SELECT count(*)::int AS n FROM shipit.carrier_rate_imports')).rows;
  assert.equal((await s.request('GET',`carriers/rates/${run.id}`,undefined,s.admin.token)).statusCode,403);
  for(const role of ['operator','dispatcher','read_only','accountant','delivery_agent']){
    const actor=await s.grant(role,[A]);
    assert.equal((await s.request('GET',`carriers/rates/${run.id}`,undefined,actor.token)).statusCode,403);
    assert.equal((await s.request('POST',`carriers/rates/${run.id}/approve`,{expected_version:1},actor.token)).statusCode,403);
  }
  for(const [actor,q] of [[await s.grant('franchise_admin',[B]),{organization_id:org,franchise_id:B}],[await s.beta('franchise_admin'),{organization_id:otherOrg,franchise_id:C}]] as const){
    for(const id of [run.id,randomUUID()])assert.equal((await s.request('GET',`carriers/rates/${id}`,undefined,actor.token,randomUUID(),q)).statusCode,404);
    assert.equal((await s.request('POST',`carriers/installations/${s.iid}/rates`,s.body(),actor.token,randomUUID(),q)).statusCode,404);
    assert.equal((await s.request('POST',`carriers/rates/${run.id}/approve`,{expected_version:1},actor.token,randomUUID(),q)).statusCode,404);
    const installation=(await s.request('POST','carriers/installations',{label:'FOREIGN'},actor.token,randomUUID(),q)).json().id;
    assert.equal((await s.request('POST',`carriers/installations/${installation}/rates`,s.body(),actor.token,randomUUID(),q)).statusCode,404);
  }
  assert.deepEqual((await s.db.adminQuery('SELECT count(*)::int AS n FROM shipit.carrier_rate_imports')).rows,before);
  const audits=(await s.db.adminQuery("SELECT * FROM shipit.audit_history WHERE resource_type='carrier_rate'")).rows;
  const exposed=JSON.stringify({run,audits});for(const value of ['Synthetic Recipient','Fictional Street',s.local.token,'content_base64'])assert.ok(!exposed.includes(value));
  await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:1});
  assert.equal((await s.upload(s.body(),key)).statusCode,404);
});
await test('rate approval rolls back on failure and cannot mutate retained evidence',{timeout:60000},async t=>{
  const s=await setup(t),run=(await s.upload()).json();
  const before=(await s.db.adminQuery('SELECT count(*)::int AS n FROM shipit.pricing_versions')).rows;
  const fault=createCarrierRateService(paymentFault(s.pool,'INSERT INTO shipit.carrier_rate_approvals') as DatabasePool,s.clock);
  await assert.rejects(fault.approve(s.local.token,run.id,randomUUID(),{expected_version:1},s.q,randomUUID()));
  assert.deepEqual((await s.db.adminQuery('SELECT count(*)::int AS n FROM shipit.pricing_versions')).rows,before);
  const key=randomUUID(),uncertain=createCarrierRateService(paymentFault(s.pool,'COMMIT') as DatabasePool,s.clock);
  await assert.rejects(uncertain.approve(s.local.token,run.id,key,{expected_version:1},s.q,randomUUID()));
  assert.equal((await s.approve(run.id,key)).statusCode,200);
  for(const table of ['carrier_rate_imports','carrier_rate_approvals','carrier_rate_commands'])await assert.rejects(s.db.ownerPool().query(`DELETE FROM shipit.${table}`));
  const other=(await s.upload({...s.body(),policy:{...s.config.policy,approval_ref:'SECOND'}})).json();
  assert.equal((await s.approve(other.id)).statusCode,409);
});
