import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {paymentSetup,collectionInput} from '../payment-support.ts';
import {statementSetup} from '../account-statement-support.ts';
import {org,A,B} from '../audit-support.ts';

async function setup(t:TestContext) {
  const s=await paymentSetup(t);
  const query=new URLSearchParams({organization_id:org,franchise_id:A});
  const url=`/api/v1/bookings/${s.bookingId}/cancellation?${query}`;
  const input={reason:'Customer withdrew the booking',expected_financial_version:0,expected_payment_version:0};
  const cancel=(body=input,key=randomUUID(),token=s.operator.token)=>s.app.inject({method:'POST',url,
    cookies:s.cookies(token),headers:{...s.headers,'idempotency-key':key},payload:body});
  const preview=(token=s.operator.token)=>s.app.inject({method:'GET',url,cookies:s.cookies(token)});
  const checkIn=(parcelId:string)=>s.app.inject({method:'POST',url:`/api/v1/parcels/${parcelId}/check-in?${query}`,
    cookies:s.cookies(s.operator.token),headers:{...s.headers,'idempotency-key':randomUUID()},payload:{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()}});
  return {...s,query,url,input,cancel,preview,checkIn};
}

await test('cancels the complete untouched booking atomically, retains the outstanding charge and replays the original command',async t=>{
  const s=await setup(t),before=await s.preview();
  assert.equal(before.statusCode,200,before.body);
  assert.deepEqual(before.json(),{booking_id:s.bookingId,parcel_count:2,outstanding_paise:String(s.gross),financial_version:0,payment_version:0,blocked_reason:null});
  const opening=await s.db.adminQuery('SELECT * FROM shipit.booking_obligations');
  const key=randomUUID();const [first,replay]=await Promise.all([s.cancel(s.input,key),s.cancel(s.input,key)]);
  assert.equal(first.statusCode,200,first.body);assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(first.json(),replay.json());
  assert.equal(first.json().booking_id,s.bookingId);assert.equal(first.json().parcel_count,2);assert.equal(first.json().outstanding_paise,String(s.gross));
  assert.equal((await s.cancel({...s.input,reason:'A different reason'},key)).json().error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await s.cancel()).json().error.code,'BOOKING_CANCELLATION_BLOCKED');
  assert.equal((await s.preview()).json().blocked_reason,'already_cancelled');
  assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,opening.rows);
  assert.deepEqual((await s.db.adminQuery('SELECT state,version FROM shipit.bookings')).rows,[{state:'cancelled',version:2}]);
  assert.deepEqual((await s.db.adminQuery('SELECT status,version FROM shipit.parcels')).rows,[{status:'cancelled',version:2},{status:'cancelled',version:2}]);
  assert.deepEqual((await s.db.adminQuery('SELECT actor_id,reason FROM shipit.booking_cancellations')).rows,[{actor_id:s.operator.id,reason:s.input.reason}]);
  const audit=await s.list(s.local.token,{resource_type:'booking'});
  assert.equal(audit.statusCode,200,audit.body);assert.ok(audit.json().items.some((e:{action:string})=>e.action==='bookings.cancel'));
  assert.ok(!audit.body.includes(s.input.reason));
  const list=await s.app.inject({url:`/api/v1/parcels?${s.query}&status=cancelled`,cookies:s.cookies(s.operator.token)});
  assert.equal(list.statusCode,200,list.body);assert.equal(list.json().items.length,2);
  const firstParcel=s.booked.parcels[0].id;
  const timeline=await s.app.inject({url:`/api/v1/parcels/${firstParcel}/timeline?${s.query}`,cookies:s.cookies(s.operator.token)});
  assert.equal(timeline.statusCode,200,timeline.body);assert.equal(timeline.json().items.at(-1).code,'booking.cancelled');
  assert.equal((await s.checkIn(firstParcel)).json().error.code,'PARCEL_STATE_CONFLICT');
});

await test('refuses stale revisions, cross-branch and unauthorized access, payment history and partly processed parcel sets',async t=>{
  const s=await setup(t);
  const reader=await s.grant('read_only',[A]);assert.equal((await s.preview(reader.token)).statusCode,403);
  assert.equal((await s.cancel(s.input,randomUUID(),reader.token)).statusCode,403);
  const offBranch=await s.app.inject({url:s.url.replace(A,B),cookies:s.cookies(s.operator.token)});assert.equal(offBranch.statusCode,404);
  assert.equal((await s.cancel({...s.input,expected_financial_version:1})).json().error.code,'VERSION_CONFLICT');
  assert.equal((await s.cancel({...s.input,reason:' '})).statusCode,422);
  const paid=await s.pay(collectionInput(1));assert.equal(paid.statusCode,200,paid.body);
  assert.equal((await s.preview()).json().blocked_reason,'money_recorded');
  assert.equal((await s.cancel()).json().error.code,'BOOKING_CANCELLATION_BLOCKED');
  const checked=await s.checkIn(s.booked.parcels[0].id);assert.equal(checked.statusCode,200,checked.body);
  assert.equal((await s.preview()).json().blocked_reason,'parcel_processed');
  assert.equal((await s.cancel()).json().error.code,'BOOKING_CANCELLATION_BLOCKED');
  assert.equal((await s.db.adminQuery('SELECT id FROM shipit.booking_cancellations')).rows.length,0);
  assert.deepEqual((await s.db.adminQuery('SELECT status FROM shipit.parcels ORDER BY position')).rows,[{status:'checked_in'},{status:'booked'}]);
});

await test('requires a parcel to leave its active lot before cancelling its whole booking',async t=>{
  const s=await setup(t);
  await s.db.prepareLots();
  const post=(path:string,body:Record<string,unknown>)=>s.app.inject({method:'POST',url:`/api/v1/${path}?${s.query}`,
    cookies:s.cookies(s.operator.token),headers:{...s.headers,'idempotency-key':randomUUID()},payload:body});
  const lot=await post('lots',{name:'Synthetic cancellation lot',destination_key:'SYN_DEST'});assert.equal(lot.statusCode,201,lot.body);
  const attach=await post(`lots/${lot.json().id}/parcels`,{parcel_id:s.booked.parcels[0].id,expected_version:1});assert.equal(attach.statusCode,200,attach.body);
  assert.equal((await s.preview()).json().blocked_reason,'operational_commitment');assert.equal((await s.cancel()).statusCode,409);
});

await test('keeps monthly account bookings under the existing account billing workflow',async t=>{
  const s=await statementSetup(t),booked=await s.book();
  const q={organization_id:org,franchise_id:A};
  const preview=await s.booking.cancellationPreview(s.operator.token,q,booked.id,randomUUID());
  assert.equal(preview.blocked_reason,'account_billed');
  await assert.rejects(s.booking.cancelBooking(s.operator.token,q,booked.id,randomUUID(),{reason:'Account booking requested cancellation',expected_financial_version:0,expected_payment_version:0},randomUUID()),{code:'BOOKING_CANCELLATION_BLOCKED'});
});

await test('commits just one of a concurrent cancellation and first intake without splitting the booking',async t=>{
  const s=await setup(t);
  const [cancelled,checked]=await Promise.all([s.cancel(),s.checkIn(s.booked.parcels[0].id)]);
  assert.equal([cancelled,checked].filter(r=>r.statusCode===200).length,1);
  assert.equal([cancelled,checked].filter(r=>r.statusCode===409).length,1);
  const statuses=(await s.db.adminQuery('SELECT status FROM shipit.parcels ORDER BY position')).rows.map(r=>r.status);
  assert.deepEqual(statuses,cancelled.statusCode===200?['cancelled','cancelled']:['checked_in','booked']);
});
