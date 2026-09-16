import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { paymentSetup,collectionInput,paymentFault } from '../payment-support.ts';
import { createPaymentService } from '../../src/modules/payments/service.ts';
import { org,A,B,otherOrg,C } from '../audit-support.ts';
await test('payments preserve opening evidence, partial collections, linked corrections and repeated settlement',{timeout:30000},async t=>{
 const s=await paymentSetup(t),opening=(await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows;
 const parcelBefore=(await s.db.adminQuery('SELECT * FROM shipit.parcels ORDER BY id')).rows;
 assert.equal(parcelBefore.length,2);assert.equal((await s.current()).json().outstanding_paise,s.gross);
 const one=await s.pay(collectionInput(4001));assert.equal(one.statusCode,200,one.body);assert.equal(one.json().payment.state,'partially_collected');
 assert.equal(one.json().payment.outstanding_paise,s.gross-4001);assert.equal((await s.paymentCounts())!.settlements,0);
 const key=randomUUID(),body={...collectionInput(s.gross-4001),context:'paid_counter' as const,method:'upi' as const};
 const final=await s.pay(body,key);assert.equal(final.statusCode,200,final.body);assert.equal(final.json().payment.outstanding_paise,0);
 const counts=await s.paymentCounts();assert.deepEqual((await s.pay(body,key)).json(),final.json());assert.deepEqual(await s.paymentCounts(),counts);
 const revKey=randomUUID(),rev=await s.reverse(final.json().entry.id,2000,revKey);assert.equal(rev.statusCode,200,rev.body);
 assert.equal(rev.json().payment.outstanding_paise,2000);assert.equal(rev.json().entry.reversal_of,final.json().entry.id);
 assert.equal(rev.json().entry.context,'paid_counter');assert.deepEqual((await s.reverse(final.json().entry.id,2000,revKey)).json(),rev.json());
 const again=await s.pay(collectionInput(2000));assert.equal(again.statusCode,200,again.body);
 assert.deepEqual((await s.db.adminQuery("SELECT aggregate_sequence FROM shipit.domain_events WHERE event_type='payment.settled' ORDER BY aggregate_sequence")).rows.map(r=>r.aggregate_sequence),['2','4']);
 assert.deepEqual((await s.pay(body,key)).json(),final.json());
 assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,opening);
 assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.parcels ORDER BY id')).rows,parcelBefore);
 const sum=(await s.db.adminQuery("SELECT sum(CASE WHEN kind='collection' THEN amount_paise::numeric ELSE -amount_paise::numeric END)::text n FROM shipit.payment_entries")).rows[0]!.n;
 assert.equal(Number(sum),(await s.current()).json().collected_paise);
 const detail=await s.request('GET',`${s.bookingId}/payments/${one.json().entry.id}`);assert.equal(detail.statusCode,200,detail.body);assert.equal(detail.json().payment.version,4);
 const facts=(await s.db.adminQuery("SELECT envelope FROM shipit.domain_events WHERE event_type='payment.settled'")).rows;
 for(const {envelope} of facts){const e=envelope as Record<string,unknown>;assert.equal(e.event_type,'payment.settled');assert.equal(e.aggregate_type,'payment_obligation');assert.equal(e.schema_version,1);assert.equal(e.command_id,e.causation_id);assert.deepEqual(Object.keys(e.payload as object).sort(),['booking_id','settlement_ref']);}
 assert.ok(!/phone|address|Synthetic Recipient|Fictional Street|key_digest|fingerprint|token|authorization/i.test(JSON.stringify({one:one.json(),facts})));
});
await test('full reversal retains original evidence and rejects excess, reversal targets and duplicate requests',{timeout:30000},async t=>{
 const s=await paymentSetup(t,50000),r=await s.pay();assert.equal(r.statusCode,200,r.body);
 const original=(await s.db.adminQuery('SELECT * FROM shipit.payment_entries')).rows;
 const before=await s.paymentCounts();const excessive=await s.reverse(r.json().entry.id,50001);assert.equal(excessive.json().error.code,'PAYMENT_REVERSAL_EXCEEDED');assert.deepEqual(await s.paymentCounts(),before);
 const key=randomUUID(),reversed=await s.reverse(r.json().entry.id,50000,key);assert.equal(reversed.statusCode,200,reversed.body);
 assert.equal(reversed.json().payment.collected_paise,0);assert.equal(reversed.json().payment.outstanding_paise,50000);
 assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.payment_entries WHERE id=$1',[r.json().entry.id])).rows,original);
 const after=await s.paymentCounts();assert.deepEqual((await s.reverse(r.json().entry.id,50000,key)).json(),reversed.json());
 assert.equal((await s.reverse(r.json().entry.id,1)).json().error.code,'PAYMENT_REVERSAL_EXCEEDED');
 assert.equal((await s.reverse(reversed.json().entry.id,1)).json().error.code,'RESOURCE_NOT_FOUND');assert.deepEqual(await s.paymentCounts(),after);
});
await test('scoped key and logical reference replay bind every identity while returning the original result',{timeout:30000},async t=>{
 const s=await paymentSetup(t),key=randomUUID(),body=collectionInput(3000);
 const result=await s.pay(body,key);assert.equal(result.statusCode,200,result.body);
 const alias=randomUUID(),replayed=await s.pay(body,alias);assert.deepEqual(replayed.json(),result.json());
 assert.deepEqual(await s.paymentCounts(),{commands:2,entries:1,audits:1,settlements:0});
 assert.equal((await s.pay({...body,amount_paise:3001},key)).json().error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await s.pay(collectionInput(3001),alias)).json().error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await s.pay({...body,amount_paise:3001})).json().error.code,'PAYMENT_REFERENCE_CONFLICT');
 const otherAdmin=await s.grant('franchise_admin',[A]);assert.deepEqual((await s.pay(body,key,otherAdmin)).json(),result.json());
 assert.deepEqual(await s.paymentCounts(),{commands:3,entries:1,audits:1,settlements:0});
 const before=await s.paymentCounts();
 const recovered=await createPaymentService(s.db.runtimePool()).execute(otherAdmin.token,s.bookingId,null,{organization_id:org,franchise_id:A},key,['idempotency-key',key],body,'payments.collect',randomUUID());
 assert.deepEqual(recovered,result.json());assert.deepEqual(await s.paymentCounts(),before);
 await s.memberships.revokeMembership(s.admin.token,otherAdmin.member.id,{expected_version:1});
 assert.equal((await s.pay(body,key,otherAdmin)).statusCode,404);assert.deepEqual(await s.paymentCounts(),before);
});
await test('race A: obligation row lock serializes two full collections with one settlement and no loser artifacts',{timeout:30000},async t=>{
 const s=await paymentSetup(t,50000),blocker=await s.pool.connect();await blocker.query('BEGIN');
 await blocker.query('SELECT id FROM shipit.booking_obligations WHERE id=$1 FOR UPDATE',[s.booked.payment_obligation.id]);
 const first=s.pay(collectionInput(50000)),second=s.pay(collectionInput(50000));
 // Observe a real PostgreSQL obligation-lock wait, not an in-memory scheduling assertion.
 let waiting=false;
 try {
  for(let i=0;i<100;i++){
   const r=await s.db.adminQuery("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FROM shipit.booking_obligations o%'");
   if(r.rows[0]!.n){waiting=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
 } finally {await blocker.query('COMMIT');blocker.release();}
 const results=await Promise.all([first,second]);assert.equal(waiting,true);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
 assert.equal(results.find(r=>r.statusCode===409)!.json().error.code,'PAYMENT_OVER_COLLECTION');
 assert.deepEqual(await s.paymentCounts(),{commands:1,entries:1,audits:1,settlements:1});assert.equal((await s.current()).json().outstanding_paise,0);
});
await test('race B: two fitting partial collections commit exactly the fixed gross',{timeout:30000},async t=>{
 const s=await paymentSetup(t,100000),responses=await Promise.all([s.pay(collectionInput(40000)),s.pay(collectionInput(60000))]);
 assert.ok(responses.every(r=>r.statusCode===200),responses.map(r=>r.body).join('\n'));
 assert.deepEqual(await s.paymentCounts(),{commands:2,entries:2,audits:2,settlements:1});assert.equal((await s.current()).json().collected_paise,100000);
});
await test('race C: competing partial collections cannot exceed the remaining amount',{timeout:30000},async t=>{
 const s=await paymentSetup(t,100000);assert.equal((await s.pay(collectionInput(60000))).statusCode,200);
 const results=await Promise.all([s.pay(collectionInput(30000)),s.pay(collectionInput(20000))]);assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);
 const p=(await s.current()).json();assert.ok([80000,90000].includes(p.collected_paise));assert.equal(p.collected_paise+p.outstanding_paise,100000);
 assert.deepEqual(await s.paymentCounts(),{commands:2,entries:2,audits:2,settlements:0});
});
for(const changed of [false,true])await test(`race D/E: concurrent collection reference ${changed?'conflicts on changed intent':'has one effect'}`,{timeout:30000},async t=>{
 const s=await paymentSetup(t),body=collectionInput(3000),results=await Promise.all([s.pay(body),s.pay({...body,amount_paise:changed?3001:3000})]);
 assert.deepEqual(results.map(r=>r.statusCode).sort(),changed?[200,409]:[200,200]);
 if(!changed)assert.deepEqual(results[0]!.json(),results[1]!.json());else assert.equal(results.find(r=>r.statusCode===409)!.json().error.code,'PAYMENT_REFERENCE_CONFLICT');
 assert.deepEqual(await s.paymentCounts(),{commands:changed?1:2,entries:1,audits:1,settlements:0});
});
await test('concurrent duplicate command and competing reversals never duplicate or over-reverse',{timeout:30000},async t=>{
 const s=await paymentSetup(t),key=randomUUID(),body=collectionInput(s.gross);
 const paid=await Promise.all([s.pay(body,key),s.pay(body,key)]);assert.ok(paid.every(r=>r.statusCode===200));assert.deepEqual(paid[0]!.json(),paid[1]!.json());
 const id=paid[0]!.json().entry.id,results=await Promise.all([s.reverse(id,s.gross),s.reverse(id,s.gross)]);
 assert.deepEqual(results.map(r=>r.statusCode).sort(),[200,409]);assert.equal(results.find(r=>r.statusCode===409)!.json().error.code,'PAYMENT_REVERSAL_EXCEEDED');
 assert.equal((await s.current()).json().collected_paise,0);assert.deepEqual(await s.paymentCounts(),{commands:2,entries:2,audits:2,settlements:1});
});
await test('strict HTTP validation rejects malformed money, browser authority, nested ownership and absent keys',{timeout:30000},async t=>{
 const s=await paymentSetup(t),before=await s.paymentCounts();
 for(const extra of [{amount_paise:0},{amount_paise:-1},{amount_paise:0.01},{amount_paise:'100'},{amount_paise:9007199254740992},{currency:'USD'},
  {method:'card'},{context:'delivered'},{collection_reference:'note'},{collection_reference:randomUUID()+' '},{settled:true},{paid:true},{paymentMode:'Paid'},
  {collected_paise:100},{outstanding_paise:0},{total_paise:0},{organization_id:org},{franchise_id:A},{actor:s.local.id},{obligation_id:randomUUID()}]){
   const r=await s.pay({...collectionInput(100),...extra});assert.ok([400,422].includes(r.statusCode),r.body);assert.ok(!/sql|constraint|stack|Synthetic Recipient|Fictional Street/i.test(r.body));
 }
 for(const path of [s.bookingId+'/payments',s.bookingId+'/payments/'+randomUUID()+'/reversals'])for(const token of ['1.0000000000000001','9007199254740991.1','1e-999']){
  const raw=JSON.stringify(collectionInput(1)).replace('"amount_paise":1','"amount_paise":'+token);
  const r=await s.app.inject({method:'POST',url:'/api/v1/bookings/'+path+'?organization_id='+org+'&franchise_id='+A,
   headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.local.token),payload:raw});
  assert.equal(r.statusCode,422,r.body);assert.equal(r.json().error.code,'VALIDATION_FAILED');
 }
 const missing=await s.request('POST',s.bookingId+'/payments',collectionInput(100),s.local,'');assert.equal(missing.json().error.code,'VALIDATION_FAILED');
 const noScope=await s.app.inject({method:'POST',url:`/api/v1/bookings/${s.bookingId}/payments`,headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(s.local.token),payload:collectionInput(100)});assert.equal(noScope.statusCode,422);
 const over=await s.pay(collectionInput(s.gross+1));assert.equal(over.json().error.code,'PAYMENT_OVER_COLLECTION');
 assert.deepEqual(await s.paymentCounts(),before);
 const unauth=await s.app.inject({method:'POST',url:`/api/v1/bookings/${s.bookingId}/payments?organization_id=${org}&franchise_id=${A}`,headers:{...s.headers,'idempotency-key':randomUUID()},cookies:s.cookies(''),payload:collectionInput(100)});assert.equal(unauth.statusCode,401,unauth.body);
});
await test('canonical role denials, finance-only audit/read projections and live replay authorization',{timeout:30000},async t=>{
 const s=await paymentSetup(t),paid=await s.pay(collectionInput(1000));assert.equal(paid.statusCode,200,paid.body);
 const before=await s.paymentCounts();
 for(const role of ['operator','dispatcher','delivery_agent','accountant','read_only']){
  const actor=await s.grant(role,[A]);assert.equal((await s.pay(collectionInput(1),randomUUID(),actor)).statusCode,403);
  assert.equal((await s.reverse(paid.json().entry.id,1,randomUUID(),actor)).statusCode,403);
  const read=await s.request('GET',s.bookingId+'/payments',undefined,actor);
  assert.equal(read.statusCode,role==='accountant'?200:403,read.body);
  if(role==='accountant'){
   const audit=await s.list(actor.token);assert.equal(audit.statusCode,200,audit.body);assert.equal(audit.json().items.length,1);
   assert.ok(audit.json().items.every((x:{resource:{type:string}})=>x.resource.type==='payment_obligation'));
   assert.equal(audit.json().items[0].id,'payment:'+paid.json().entry.id);
   const page=await s.list(actor.token,{limit:'1'});assert.equal(page.json().page.has_more,false);
  }
 }
 assert.equal((await s.request('POST',s.bookingId+'/payments',collectionInput(1),s.admin)).statusCode,403);
 assert.equal((await s.request('POST',s.bookingId+'/payments/'+paid.json().entry.id+'/reversals',{amount_paise:1,currency:'INR',reason_code:'incorrect_amount'},s.admin)).statusCode,403);
 assert.equal((await s.request('GET',s.bookingId+'/payments',undefined,s.admin)).statusCode,200);
 assert.deepEqual(await s.paymentCounts(),before);
 assert.ok(!/Synthetic Recipient|Fictional Street|collection_reference|amount_paise/.test(JSON.stringify((await s.list(s.local.token)).json())));
 assert.ok(!/Synthetic Recipient|Fictional Street|idempotency-key|cookie|authorization|collection_reference|amount_paise|SYN_SECRET/i.test(s.logs.join('\n')));
});
await test('failures and omitted components roll back receipts, ledger, audit and events; lost COMMIT response survives new pool',{timeout:30000},async t=>{
 const s=await paymentSetup(t),before=await s.paymentCounts(),body=collectionInput(s.gross),q={organization_id:org,franchise_id:A};
 for(const [point,mode] of [['INSERT INTO shipit.payment_commands','after'],['INSERT INTO shipit.payment_entries','after'],
  ['SELECT shipit.append_payment_audit','before'],['INSERT INTO shipit.domain_events','before'],['COMMIT','before'],
  ['INSERT INTO shipit.payment_entries','omit'],['SELECT shipit.append_payment_audit','omit'],['INSERT INTO shipit.domain_events','omit'],['UPDATE shipit.payment_commands','omit']] as const){
  const key=randomUUID();await assert.rejects(createPaymentService(paymentFault(s.pool,point,mode)).execute(s.local.token,s.bookingId,null,q,key,['idempotency-key',key],body,'payments.collect',randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.deepEqual(await s.paymentCounts(),before,point+mode);assert.equal((await s.current()).json().collected_paise,0);
 }
 const key=randomUUID();await assert.rejects(createPaymentService(paymentFault(s.pool,'COMMIT')).execute(s.local.token,s.bookingId,null,q,key,['idempotency-key',key],body,'payments.collect',randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 const counts=await s.paymentCounts();assert.deepEqual(counts,{commands:1,entries:1,audits:1,settlements:1});
 const result=await createPaymentService(s.db.runtimePool()).execute(s.local.token,s.bookingId,null,q,key,['idempotency-key',key],body,'payments.collect',randomUUID());
 assert.equal(result.payment.outstanding_paise,0);assert.deepEqual(await s.paymentCounts(),counts);
 // A failed reversal likewise cannot reopen a successfully collected obligation.
 const reversalKey=randomUUID();await assert.rejects(createPaymentService(paymentFault(s.pool,'SELECT shipit.append_payment_audit','before')).execute(s.local.token,s.bookingId,result.entry.id,q,reversalKey,['idempotency-key',reversalKey],{amount_paise:100,currency:'INR',reason_code:'incorrect_amount'},'payments.reverse',randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
 assert.deepEqual(await s.paymentCounts(),counts);assert.equal((await s.current()).json().outstanding_paise,0);
});
await test('physical delivery and delivery reversal never settle or reverse payment, and financial corrections preserve delivery',{timeout:30000},async t=>{
 const s=await paymentSetup(t),ids=s.booked.parcels.map((p:{id:string})=>p.id);
 async function fixture(status:string,custody:string){
  // #42 proof completion and T13 are not live on main. Seed only prerequisite
  // lifecycle state through the migration owner, restoring the prior-domain guard.
  await s.db.adminQuery('ALTER TABLE shipit.parcels DISABLE TRIGGER parcels_lifecycle_guard');
  try {await s.db.adminQuery('UPDATE shipit.parcels SET status=$1,custody=$2 WHERE id=ANY($3::uuid[])',[status,custody,ids]);}
  finally {await s.db.adminQuery('ALTER TABLE shipit.parcels ENABLE TRIGGER parcels_lifecycle_guard');}
 }
 await fixture('delivered','recipient');assert.equal((await s.current()).json().outstanding_paise,s.gross);assert.equal((await s.paymentCounts())!.settlements,0);
 const delivered=(await s.db.adminQuery('SELECT * FROM shipit.parcels ORDER BY id')).rows;
 const paid=await s.pay();assert.equal(paid.statusCode,200,paid.body);assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.parcels ORDER BY id')).rows,delivered);
 const reversed=await s.reverse(paid.json().entry.id,100);assert.equal(reversed.statusCode,200,reversed.body);assert.deepEqual((await s.db.adminQuery('SELECT * FROM shipit.parcels ORDER BY id')).rows,delivered);
 const counts=await s.paymentCounts(),projection=(await s.current()).json();await fixture('held_at_office','franchise_office');
 assert.deepEqual((await s.current()).json(),projection);assert.deepEqual(await s.paymentCounts(),counts);
});
await test('tenant A/B/C isolation covers real foreign bookings, nested collections, references, projections and replay',{timeout:30000},async t=>{
 const s=await paymentSetup(t),key=randomUUID(),reference=randomUUID(),body=collectionInput(1000,reference);
 const own=await s.pay(body,key);assert.equal(own.statusCode,200,own.body);
 const {draft,start,input}=await import('../pricing-support.ts');const {taxPolicy,taxFacts}=await import('../tax-support.ts');const {contact}=await import('../customer-support.ts');
 await s.memberships.bootstrapAdministrator(s.admin.id,otherOrg);
 for(const [organization,franchise] of [[org,B],[otherOrg,C]] as const){
  const admin=await s.grant('franchise_admin',[franchise],organization),operator=await s.grant('operator',[franchise],organization);
  s.setNow('2098-12-31T23:00:00Z');const price=await s.pricing.create(admin.token,organization,franchise,randomUUID(),draft,randomUUID());
  await s.pricing.publish(admin.token,organization,franchise,price.id,randomUUID(),{expected_version:1},randomUUID());
  const policy=await s.tax.create(admin.token,organization,franchise,randomUUID(),taxPolicy,randomUUID());
  await s.tax.publish(admin.token,organization,franchise,policy.id,randomUUID(),{expected_version:1},randomUUID());s.setNow(start);
  const customer=await s.customer.create(operator.token,organization,franchise,randomUUID(),contact,randomUUID());
  const quote=await s.pricing.quote(operator.token,organization,franchise,randomUUID(),input,randomUUID());
  const intentBody={quote_id:quote.id,pricing_input:input,facts:taxFacts};
  const intent=await s.tax.prepare(operator.token,organization,franchise,randomUUID(),intentBody,randomUUID());
  const tax=await s.tax.calculate(operator.token,organization,franchise,randomUUID(),{intent_id:intent.id},randomUUID());
  const booked=await s.book({...s.body,customer_id:customer.id,tax_calculation_id:tax.id,tax_intent:intentBody},randomUUID(),operator.token,franchise,organization);
  assert.equal(booked.statusCode,201,booked.body);const id=booked.json().id as string;
  const paid=await s.request('POST',id+'/payments',body,admin,key,organization,franchise);assert.equal(paid.statusCode,200,paid.body);
  assert.notEqual(paid.json().entry.id,own.json().entry.id);const baseline=await s.paymentCounts();
  for(const target of [id,randomUUID()]){
   const read=await s.request('GET',target+'/payments');assert.equal(read.statusCode,404);assert.equal(read.json().error.code,'RESOURCE_NOT_FOUND');
   const write=await s.request('POST',target+'/payments',body);assert.equal(write.statusCode,404);
  }
  assert.equal((await s.request('POST',id+'/payments',body,s.local,key,organization,franchise)).statusCode,404);
  assert.equal((await s.request('POST',s.bookingId+'/payments/'+paid.json().entry.id+'/reversals',{amount_paise:1,currency:'INR',reason_code:'incorrect_amount'})).statusCode,404);
  assert.equal((await s.request('GET',s.bookingId+'/payments/'+paid.json().entry.id)).statusCode,404);
  assert.deepEqual(await s.paymentCounts(),baseline);assert.equal((await s.current()).json().collected_paise,1000);
 }
 const second=await s.book();assert.equal(second.statusCode,201,second.body);
 const before=await s.paymentCounts();
 assert.equal((await s.request('POST',second.json().id+'/payments',body,s.local,key)).json().error.code,'IDEMPOTENCY_CONFLICT');
 assert.equal((await s.request('POST',second.json().id+'/payments',body)).json().error.code,'PAYMENT_REFERENCE_CONFLICT');
 assert.deepEqual(await s.paymentCounts(),before);
});
await test('runtime and owner cannot edit ledger/receipts/opening facts; SQL constraints reject impossible ownership and incomplete commands',{timeout:30000},async t=>{
 const s=await paymentSetup(t),paid=await s.pay(collectionInput(1000));assert.equal(paid.statusCode,200,paid.body);
 const owner=s.db.ownerPool(),before=await s.paymentCounts();
 for(const table of ['payment_entries','payment_commands','payment_audit_events','booking_obligations']){
  await assert.rejects(s.pool.query(`UPDATE shipit.${table} SET id=id`));await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`));await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));
  await assert.rejects(owner.query(`UPDATE shipit.${table} SET id=id`));await assert.rejects(owner.query(`DELETE FROM shipit.${table}`));
 }
 await assert.rejects(s.pool.query('SELECT shipit.payment_result($1,$2,$3)',[org,A,paid.json().entry.id]));
 await assert.rejects(s.pool.query('INSERT INTO shipit.payment_audit_events SELECT * FROM shipit.payment_audit_events'));
 const template=(await s.db.adminQuery('SELECT * FROM shipit.payment_commands LIMIT 1')).rows[0]!;
 const insert=`INSERT INTO shipit.payment_commands(id,organization_id,franchise_id,booking_id,obligation_id,principal_id,operation_id,key_digest,fingerprint,input,correlation_id,occurred_at)
   VALUES($1,$2,$3,$4,$5,$6,'api.v1.payments.collect',$7,$8,$9,$10,$11)`;
 const values=[randomUUID(),org,A,s.bookingId,s.booked.payment_obligation.id,s.local.id,'a'.repeat(64),template.fingerprint,collectionInput(1),randomUUID(),new Date()];
 // Valid owner tuples still cannot commit an abandoned reservation.
 await assert.rejects(s.pool.query(insert,values));
 for(const [index,value] of [[2,B],[1,otherOrg],[3,randomUUID()],[4,randomUUID()]] as const){
  const v=[...values];v[index]=value;await assert.rejects(s.pool.query(insert,v),e=>(e as {sqlState?:string}).sqlState==='23503');
 }
 // The unique command identity is enforced in SQL, independently of service replay.
 const duplicate=[...values];duplicate[6]=template.key_digest;
 await assert.rejects(s.pool.query(insert,duplicate),e=>(e as {sqlState?:string}).sqlState==='23505');
 // Amount and currency CHECKs remain effective under direct runtime SQL.
 for(const input of [{...collectionInput(1),amount_paise:0},{...collectionInput(1),amount_paise:-1},{...collectionInput(1),amount_paise:0.1},
   {...collectionInput(1),currency:'USD'},{...collectionInput(1),settled:true}]){
  const v=[...values];v[8]=input;await assert.rejects(s.pool.query(insert,v),e=>(e as {sqlState?:string}).sqlState==='23514');
 }
 assert.deepEqual(await s.paymentCounts(),before);
});
await test('payment audit pagination retains finance-only scope and disabled roots deny writes/replays',{timeout:30000},async t=>{
 const s=await paymentSetup(t),accountant=await s.grant('accountant',[A]),body=collectionInput(100),key=randomUUID();
 assert.equal((await s.pay(body,key)).statusCode,200);assert.equal((await s.pay(collectionInput(100))).statusCode,200);
 const first=await s.list(accountant.token,{limit:'1'});assert.equal(first.json().items.length,1);assert.equal(first.json().page.has_more,true);
 const second=await s.list(accountant.token,{limit:'1',cursor:first.json().page.next_cursor});assert.equal(second.statusCode,200,second.body);assert.equal(second.json().items.length,1);
 assert.notEqual(first.json().items[0].id,second.json().items[0].id);
 const before=await s.paymentCounts();await s.db.adminQuery("UPDATE shipit.franchises SET lifecycle='disabled',version=version+1,lifecycle_changed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",[A]);
 assert.equal((await s.pay(body,key)).json().error.code,'FRANCHISE_DISABLED');assert.equal((await s.current()).statusCode,200);assert.deepEqual(await s.paymentCounts(),before);
});
await test('runtime SQL independently enforces collection reference uniqueness, intent binding and reversal ceilings',{timeout:30000},async t=>{
 const s=await paymentSetup(t),paid=await s.pay(collectionInput(1000));assert.equal(paid.statusCode,200,paid.body);
 const reversal=await s.reverse(paid.json().entry.id,100);assert.equal(reversal.statusCode,200,reversal.body);
 const original=(await s.db.adminQuery('SELECT * FROM shipit.payment_entries WHERE id=$1',[paid.json().entry.id])).rows[0]!;
 const before=await s.paymentCounts();
 for(const scenario of ['duplicate_reference','over_collection','over_reversal','reversal_of_reversal','wrong_actor','wrong_amount','wrong_sequence']){
  const tx=await s.pool.connect();
  try {
   await tx.query('BEGIN');const command=randomUUID(),id=randomUUID(),correlation=randomUUID(),time=new Date();
   const reversing=scenario==='over_reversal'||scenario==='reversal_of_reversal';
   const amount=scenario==='over_collection'?s.gross:scenario==='over_reversal'?901:1;
   const target=scenario==='reversal_of_reversal'?reversal.json().entry.id:reversing?original.id:null;
   const input=reversing?{amount_paise:amount,currency:'INR',reason_code:'incorrect_amount'}:collectionInput(amount,scenario==='duplicate_reference'?String(original.collection_reference):randomUUID());
   await tx.query(`INSERT INTO shipit.payment_commands(id,organization_id,franchise_id,booking_id,obligation_id,principal_id,operation_id,key_digest,fingerprint,input,reversal_of,correlation_id,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[command,org,A,s.bookingId,s.booked.payment_obligation.id,s.local.id,
    reversing?'api.v1.payments.reverse':'api.v1.payments.collect',randomUUID().replaceAll('-','').repeat(2),'b'.repeat(64),input,target,correlation,time]);
   await assert.rejects(tx.query(`INSERT INTO shipit.payment_entries(id,organization_id,franchise_id,booking_id,obligation_id,command_id,kind,amount_paise,currency,context,method,collection_reference,reversal_of,reason_code,sequence,actor_id,correlation_id,occurred_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'INR','to_pay','cash',$9,$10,$11,$12,$13,$14,$15)`,
    [id,org,A,s.bookingId,s.booked.payment_obligation.id,command,reversing?'reversal':'collection',scenario==='wrong_amount'?2:amount,
     'collection_reference' in input?input.collection_reference:null,target,reversing?'incorrect_amount':null,scenario==='wrong_sequence'?4:3,
     scenario==='wrong_actor'?s.admin.id:s.local.id,correlation,time]),e=>(e as {sqlState?:string}).sqlState===(scenario==='duplicate_reference'?'23505':'23514'),scenario);
  } finally {await tx.query('ROLLBACK');tx.release();}
 }
 assert.deepEqual(await s.paymentCounts(),before);assert.equal((await s.current()).json().collected_paise,900);
});
