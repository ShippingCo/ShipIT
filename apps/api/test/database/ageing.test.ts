import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { paymentSetup,collectionInput,paymentFault } from '../payment-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { contact } from '../customer-support.ts';
import { startTestDelivery,testDeliveryCode } from '../delivery-support.ts';
import { createAgeingService } from '../../src/modules/reports/ageing-service.ts';
import type { AgeingPage } from '@shippingco/shared';
import type { DatabasePool } from '@shippingco/db';
async function setup(t:Parameters<typeof paymentSetup>[0]) {
  const s=await paymentSetup(t);await s.db.prepareReports();const q={organization_id:org,franchise_id:A};
  const call=(path='',body?:unknown,actor:{token:string}=s.local,key=randomUUID(),query:Record<string,string>=q)=>s.app.inject({method:body===undefined?'GET':'POST',url:'/api/v1/reports/ageing'+path+'?'+new URLSearchParams(query),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),...(body===undefined?{}:{payload:JSON.stringify(body)})});
  return {...s,q,call};
}
await test('ageing reconciles delivered unpaid debt, partial collections, reversal history, saved export and restart',{timeout:60000},async t=>{
  const s=await setup(t),agent=await s.grant('delivery_agent',[A]),parcel=s.booked.parcels[0].id;
  const started=await startTestDelivery(s,parcel,agent),proof=await testDeliveryCode(s,parcel),deliveryKey=randomUUID();
  await started.service.complete(agent.token,parcel,s.q,deliveryKey,['idempotency-key',deliveryKey],{expected_version:5,challenge_ref:started.state.challenge_ref,challenge_version:started.state.challenge_version,proof},false,randomUUID());
  const unpaid=await s.call('',{status:'delivered'});assert.equal(unpaid.statusCode,200,unpaid.body);
  assert.equal(unpaid.json<AgeingPage>().snapshot.totals.outstanding,String(s.gross));assert.equal(unpaid.json<AgeingPage>().snapshot.count,1);
  const payment=await s.pay(collectionInput(1000));assert.equal(payment.statusCode,200,payment.body);
  const key=randomUUID(),response=await s.call('',{},s.local,key);assert.equal(response.statusCode,200,response.body);assert.equal(response.headers['cache-control'],'no-store');
  const saved=response.json<AgeingPage>(),row=saved.rows[0]!;assert.equal(row.parcels.length,2);assert.equal(saved.snapshot.count,1);
  assert.equal(row.original_gross,String(s.gross));assert.equal(row.outstanding,String(s.gross-1000));assert.equal(row.due_at,null);assert.equal(row.overdue,null);
  assert.equal(saved.snapshot.customers[0]!.totals.outstanding,row.outstanding);
  const unknown=(await s.call('',{anchor:'due'})).json<AgeingPage>();assert.equal(unknown.snapshot.buckets.unknown,row.outstanding);assert.equal(unknown.rows[0]!.age_days,null);
  assert.equal((await s.reverse(payment.json().entry.id,400)).statusCode,200);
  const reversed=(await s.call('',{})).json<AgeingPage>();assert.equal(reversed.snapshot.totals.outstanding,String(s.gross-600));assert.equal(reversed.rows[0]!.entries[1]!.reversal_of,payment.json().entry.id);
  assert.equal(reversed.rows[0]!.reversals,'400');assert.equal(reversed.rows[0]!.net_collections,'600');
  assert.equal((await s.current()).json().outstanding_paise,Number(reversed.snapshot.totals.outstanding));
  assert.deepEqual(await createAgeingService(s.db.runtimePool()).read(s.local.token,saved.snapshot.id,s.q,randomUUID()),saved);
  assert.deepEqual((await s.call('',{},s.local,key)).json(),saved);assert.equal((await s.call('',{anchor:'due'},s.local,key)).statusCode,409);
  const csv=await s.call('/'+saved.snapshot.id+'/export');assert.equal(csv.statusCode,200,csv.body);assert.deepEqual(csv.json().snapshot,saved.snapshot);
  const cells=csv.json().csv.split('\r\n')[1].match(/"(?:[^"]|"")*"(?=,|$)/g).map((v:string)=>v.slice(1,-1).replaceAll('""','"'));
  const outstanding=csv.json().columns.indexOf('outstanding_paise');assert.equal(BigInt(cells[outstanding]),BigInt(saved.snapshot.totals.outstanding));assert.ok(csv.json().csv.includes(payment.json().entry.id));
  assert.equal((await s.pay(collectionInput(s.gross-600))).statusCode,200);
  const empty=(await s.call('',{})).json<AgeingPage>();assert.equal(empty.snapshot.count,0);assert.equal(empty.snapshot.totals.outstanding,'0');assert.equal((await s.call('/'+empty.snapshot.id+'/export')).json().csv.split('\r\n').length,2);
  const settled=(await s.call('',{balances:'all',status:'delivered'})).json<AgeingPage>();assert.equal(settled.snapshot.count,1);assert.equal(settled.snapshot.totals.outstanding,'0');
  const safe=JSON.stringify({saved,logs:s.logs,audit:(await s.db.adminQuery('SELECT * FROM shipit.report_access_events')).rows});
  for(const secret of [s.local.token,s.booked.customer.phone,s.booked.customer.address,'Synthetic Recipient',proof])assert.ok(!safe.includes(secret));
});
await test('ageing excludes foreign customers, nested IDs and counts and rejects revoked or expired artifacts',{timeout:60000},async t=>{
  const s=await setup(t),saved=(await s.call('',{})).json<AgeingPage>();
  const sibling=await s.grant('franchise_admin',[B]),foreign=await s.beta(),reader=await s.grant('read_only',[A]);
  const siblingCustomer=await s.customer.create(sibling.token,org,B,randomUUID(),contact,randomUUID()),foreignCustomer=await s.customer.create(foreign.token,otherOrg,C,randomUUID(),contact,randomUUID());
  for(const id of [siblingCustomer.id,foreignCustomer.id,randomUUID()]){const r=await s.call('',{customer_id:id});assert.equal(r.statusCode,404,r.body);assert.ok(!r.body.includes('totals'));}
  for(const actor of [sibling,foreign,reader,s.operator]){assert.notEqual((await s.call('',{},actor)).statusCode,200);assert.notEqual((await s.call('/'+saved.snapshot.id+'/export',undefined,actor)).statusCode,200);}
  for(const q of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C}]) {
    const real=await s.call('/'+saved.snapshot.id,undefined,s.local,randomUUID(),q),missing=await s.call('/'+randomUUID(),undefined,s.local,randomUUID(),q);assert.equal(real.statusCode,404);assert.equal(real.json().error.code,missing.json().error.code);
  }
  const siblingReport=await s.call('',{},sibling,randomUUID(),{organization_id:org,franchise_id:B});assert.equal(siblingReport.statusCode,200,siblingReport.body);assert.equal(siblingReport.json().snapshot.count,0);assert.equal(siblingReport.json().snapshot.totals.outstanding,'0');
  const own=(await s.call('',{customer_id:s.source.id})).json<AgeingPage>();assert.equal(own.snapshot.count,1);
  const accountant=await s.grant('accountant',[A]);assert.equal((await s.call('',{},accountant)).statusCode,200);assert.equal((await s.call('/'+saved.snapshot.id,undefined,accountant)).statusCode,404);
  await s.db.adminQuery('ALTER TABLE shipit.report_snapshots DISABLE TRIGGER USER');
  await s.db.adminQuery("UPDATE shipit.report_snapshots SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[saved.snapshot.id]);
  await s.db.adminQuery('ALTER TABLE shipit.report_snapshots ENABLE TRIGGER USER');assert.equal((await s.call('/'+saved.snapshot.id+'/export')).statusCode,404);
  await s.memberships.revokeMembership(s.admin.token,s.local.member.id,{expected_version:1});assert.equal((await s.call('/'+own.snapshot.id+'/export')).statusCode,404);
});
await test('ageing captures clock boundaries, corrected tax debt and refunds, with atomic failures and uncertain replay',{timeout:60000},async t=>{
  const s=await setup(t);
  // Change only the capture clock in the real SQL query; do not rewrite immutable booking dates.
  let asOf=new Date(Date.parse(s.booked.charges.confirmed_at)+30*86400000).toISOString();
  const clockPool:DatabasePool={...s.pool,async connect(){const c=await s.pool.connect();return {release:discard=>c.release(discard),query:<R extends Record<string,unknown>>(sql:string,params?:readonly unknown[])=>c.query<R>(sql.replace('statement_timestamp() as_of',`'${asOf}'::timestamptz as_of`),params)};}};
  const capture=()=>{const key=randomUUID();return createAgeingService(clockPool).create(s.local.token,s.q,key,['Idempotency-Key',key],{},randomUUID());};
  assert.equal((await capture()).rows[0]!.bucket,'0_30');asOf=new Date(Date.parse(asOf)+86400000).toISOString();assert.equal((await capture()).rows[0]!.bucket,'31_60');
  assert.equal((await s.pay(collectionInput(s.gross))).statusCode,200);
  const tax=s.booked.charges.tax;
  const change={booking_id:s.bookingId,expected_version:0,payment_version:1,kind:'cancellation',reason:'booking_cancelled',approval_ref:'SYN_REVIEW',pre_tax:tax.pre_tax_paise,taxable:tax.taxable_basis_paise,cgst:tax.cgst_paise,sgst:tax.sgst_paise,igst:tax.igst_paise,rounding:tax.rounding_adjustment_paise};
  const finance=(body:unknown)=>s.app.inject({method:'POST',url:'/api/v1/finance/changes?'+new URLSearchParams(s.q),headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.local.token),payload:JSON.stringify(body)});
  const correction=await finance(change);assert.equal(correction.statusCode,200,correction.body);
  const credit=(await s.call('',{balances:'all'})).json<AgeingPage>();assert.equal(credit.rows[0]!.gross,'0');assert.equal(credit.rows[0]!.refundable_credit,String(s.gross));assert.equal(credit.rows[0]!.changes[0]!.id,correction.json().id);
  const refund=await finance({booking_id:s.bookingId,expected_version:1,payment_version:1,kind:'refund',reason:'customer_refund',approval_ref:'SYN_REVIEW',returned_to_ref:'SYN_RETURN',refund:s.gross});assert.equal(refund.statusCode,200,refund.body);
  const refunded=(await s.call('',{balances:'all'})).json<AgeingPage>();assert.equal(refunded.rows[0]!.net_collections,'0');assert.equal(refunded.rows[0]!.outstanding,'0');assert.equal(refunded.rows[0]!.refundable_credit,'0');assert.ok(!JSON.stringify(refunded).includes('SYN_RETURN'));
  const before=(await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n;
  const failing=createAgeingService(paymentFault(s.pool,'INSERT INTO shipit.report_access_events','before')),key=randomUUID();
  await assert.rejects(failing.create(s.local.token,s.q,key,['Idempotency-Key',key],{},randomUUID()));assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,before);
  const uncertain=createAgeingService(paymentFault(s.pool,'COMMIT')),retry=randomUUID();await assert.rejects(uncertain.create(s.local.token,s.q,retry,['Idempotency-Key',retry],{},randomUUID()));assert.equal((await s.call('',{},s.local,retry)).statusCode,200);
  for(const body of [{status:'paid'},{customer_id:'phone'},{as_of:'2026-01-01'},{franchise_id:B}])assert.equal((await s.call('',body)).statusCode,422);
  assert.equal((await s.call('/'+refunded.snapshot.id,undefined,s.local,randomUUID(),{...s.q,offset:'1'})).statusCode,422);
});
