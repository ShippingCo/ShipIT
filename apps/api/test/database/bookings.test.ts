import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseError, type DatabasePool } from '@shippingco/db';
import { bookingSetup } from '../booking-support.ts';
import { org, A, B, otherOrg, C } from '../audit-support.ts';
import { createBookingService } from '../../src/modules/bookings/service.ts';
import { contact } from '../customer-support.ts';
import { taxPolicy } from '../tax-support.ts';
import { draft } from '../pricing-support.ts';
function faulty(pool:DatabasePool,point:string):DatabasePool {
  return {...pool,async connect(){const client=await pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    const result=await client.query<Row>(sql,params);if(sql.includes(point))throw new DatabaseError('DB_CONNECTION_FAILED');return result;
  }};}};
}
await test('operator creates canonical booking and one child with frozen authoritative money and exact reference-only event/audit counts',{timeout:30000},async t=>{
  const s=await bookingSetup(t),key=randomUUID(),response=await s.book(s.body,key);assert.equal(response.statusCode,201,response.body);
  const r=response.json();assert.equal(r.version,1);assert.equal(r.state,'active');assert.equal(r.parcels[0].status,'booked');assert.equal(r.parcels[0].custody,'awaiting_intake');
  assert.match(r.parcels[0].docket,/^SIT-[0-9]{19}$/);assert.equal(r.charges.tax.final_payable_paise,13400);assert.equal(r.payment_obligation.collected_paise,0);assert.equal(r.payment_obligation.outstanding_paise,13400);
  assert.deepEqual(await s.counts(),{bookings:1,parcels:1,obligations:1,commands:1,audits:1,events:2});
  const events=JSON.stringify((await s.db.adminQuery('SELECT envelope FROM shipit.domain_events')).rows),audit=JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.booking_audit_events')).rows);
  for(const secret of [key,s.operator.token,contact.name,contact.phone,'Synthetic Recipient','21 Fictional Street']) {assert.ok(!events.includes(secret));assert.ok(!audit.includes(secret));assert.ok(!s.logs.join('').includes(secret));}
  for(const secret of [key,s.operator.token,'fingerprint','key_digest','supplier_gstin','recipient_gstin','payment.settled','receipt_issued','whatsapp'])assert.ok(!response.body.includes(secret));
  const history=await s.list(s.local.token,{resource_type:'booking'});assert.equal(history.statusCode,200,history.body);assert.equal(history.json().items.length,1);
  const receipt=(await s.db.adminQuery('SELECT committed_at,retain_until,http_status FROM shipit.booking_commands')).rows[0]!;
  assert.ok(Number(new Date(receipt.retain_until as string))-Number(new Date(receipt.committed_at as string))>=86400000);assert.equal(receipt.http_status,201);
});
await test('multiple children preserve order and normalized manual dockets, sharing only frozen commercial ownership',{timeout:30000},async t=>{
  const s=await bookingSetup(t);const p=s.body.parcels[0]!;
  const response=await s.book({...s.body,parcels:[{...p,weight_grams:400,docket:' syn-a '},{...p,weight_grams:599,docket:'syn-b'}]});
  assert.equal(response.statusCode,201,response.body);assert.deepEqual(response.json().parcels.map((p:{docket:string})=>p.docket),['SYN-A','SYN-B']);
  assert.deepEqual(await s.counts(),{bookings:1,parcels:2,obligations:1,commands:1,audits:1,events:3});
});
await test('twenty concurrent same-key HTTP creates return original 201 DTO with one logical mutation',{timeout:30000},async t=>{
  const s=await bookingSetup(t),key=randomUUID();const results=await Promise.all(Array.from({length:20},()=>s.book(s.body,key)));
  for(const r of results){assert.equal(r.statusCode,201,r.body);assert.deepEqual(r.json(),results[0]!.json());}
  assert.deepEqual(await s.counts(),{bookings:1,parcels:1,obligations:1,commands:1,audits:1,events:2});
  const conflict=await s.book({...s.body,expected_customer_version:2},key);assert.equal(conflict.json().error.code,'IDEMPOTENCY_CONFLICT');assert.equal((await s.counts())!.events,2);
});
await test('twenty distinct-key creates across independent pools allocate globally unique dockets',{timeout:30000},async t=>{
  const s=await bookingSetup(t);const pools=Array.from({length:4},()=>s.db.runtimePool({maxConnections:5,connectionTimeoutMs:5000}));
  const services=pools.map(pool=>createBookingService(pool,s.keys.browser,s.clock));
  const results=await Promise.all(Array.from({length:20},(_,i)=>services[i%4]!.create(s.operator.token,org,A,randomUUID(),s.body,randomUUID())));
  assert.equal(new Set(results.flatMap(r=>r.parcels.map(p=>p.docket))).size,20);assert.equal((await s.counts())!.bookings,20);assert.equal((await s.counts())!.events,40);
});
await test('lost COMMIT acknowledgement reconciles from durable receipt through fresh service and pool',{timeout:30000},async t=>{
  const s=await bookingSetup(t),key=randomUUID();const lost=createBookingService(faulty(s.pool,'COMMIT'),s.keys.browser,s.clock);
  await assert.rejects(lost.create(s.operator.token,org,A,key,s.body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  const original=(await s.db.adminQuery('SELECT result FROM shipit.booking_commands')).rows[0]!.result;
  const restart=createBookingService(s.db.runtimePool(),s.keys.browser,s.clock);assert.deepEqual(await restart.create(s.operator.token,org,A,key,s.body,randomUUID()),original);
  assert.equal((await s.counts())!.bookings,1);
});
for(const point of ['FROM shipit.customers','FROM shipit.pricing_quotes','FROM shipit.tax_calculations','INSERT INTO shipit.bookings','INSERT INTO shipit.parcels','INSERT INTO shipit.booking_obligations','append_booking_audit','INSERT INTO shipit.domain_events','UPDATE shipit.booking_commands']) {
  await test('atomic rollback and same-key recovery after injected '+point,{timeout:30000},async t=>{
    const s=await bookingSetup(t),key=randomUUID(),before=await s.counts();const bad=createBookingService(faulty(s.pool,point),s.keys.browser,s.clock);
    await assert.rejects(bad.create(s.operator.token,org,A,key,s.body,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});assert.deepEqual(await s.counts(),before);
    assert.equal((await s.book(s.body,key)).statusCode,201);
  });
}
await test('manual collision rolls back the complete multi-parcel command and sequence gaps cannot be manually reused',{timeout:30000},async t=>{
  const s=await bookingSetup(t),p=s.body.parcels[0]!,first=await s.book({...s.body,parcels:[{...p,docket:'SYN-TAKEN'}]});assert.equal(first.statusCode,201,first.body);
  const before=await s.counts();const collision=await s.book({...s.body,parcels:[{...p,weight_grams:400},{...p,weight_grams:599,docket:'syn-taken'}]});
  assert.equal(collision.statusCode,409,collision.body);assert.equal(collision.json().error.code,'DOCKET_CONFLICT');assert.deepEqual(await s.counts(),before);
  const gap=(await s.db.adminQuery('SELECT last_value FROM shipit.global_docket_sequence')).rows[0]!.last_value;
  assert.equal((await s.book({...s.body,parcels:[{...p,docket:'SIT-'+String(gap).padStart(19,'0')}]})).json().error.code,'DOCKET_CONFLICT');
});
await test('customer edits and future pricing/tax publication cannot rewrite persisted snapshots or replay',{timeout:30000},async t=>{
  const s=await bookingSetup(t),key=randomUUID(),first=await s.book(s.body,key);assert.equal(first.statusCode,201,first.body);const original=first.json();
  await s.customer.update(s.operator.token,org,A,s.source.id,randomUUID(),{...contact,name:'Changed Synthetic Contact',expected_version:1},randomUUID());
  const next={...draft,effective_from:'2099-01-02T00:00:00Z',effective_to:'2099-01-03T00:00:00Z'};
  const price=await s.pricing.create(s.local.token,org,A,randomUUID(),next,randomUUID());await s.pricing.publish(s.local.token,org,A,price.id,randomUUID(),{expected_version:1},randomUUID());
  const tax=await s.tax.create(s.local.token,org,A,randomUUID(),{...taxPolicy,effective_from:next.effective_from,effective_to:next.effective_to},randomUUID());await s.tax.publish(s.local.token,org,A,tax.id,randomUUID(),{expected_version:1},randomUUID());
  s.setNow(next.effective_from);assert.deepEqual((await s.book(s.body,key)).json(),original);
  const stored=(await s.db.adminQuery('SELECT customer_snapshot,tax_snapshot FROM shipit.bookings')).rows[0]!;assert.equal((stored.customer_snapshot as {name:string}).name,contact.name);
});
await test('strict mass-assignment including foreign lot_id produces no booking effects or audit mutation',{timeout:30000},async t=>{
  const s=await bookingSetup(t),before=await s.counts(),audit=(await s.db.adminQuery('SELECT count(*) FROM shipit.audit_history')).rows;
  for(const field of ['lot_id','organization_id','status','tax','total_paise','paid','settled','payment_mode','collected_paise','confirmed_at']) {
    const r=await s.book({...s.body,[field]:C});assert.equal(r.statusCode,422,r.body);assert.equal(r.json().error.details[0].code,'UNKNOWN_FIELD');
  }
  assert.deepEqual(await s.counts(),before);assert.deepEqual((await s.db.adminQuery('SELECT count(*) FROM shipit.audit_history')).rows,audit);
});
await test('only operator is activated; sibling and unrelated customer IDs are indistinguishable from unknown; guessed selectors cannot widen scope',{timeout:30000},async t=>{
  const s=await bookingSetup(t),before=await s.counts();
  for(const actor of [s.local,s.admin,await s.grant('read_only',[A]),await s.grant('accountant',[A]),await s.grant('dispatcher',[A]),await s.grant('delivery_agent',[A])])assert.equal((await s.book(s.body,randomUUID(),actor.token)).statusCode,403);
  const sibling=await s.grant('operator',[B]),foreign=await s.beta();
  const b=await s.customer.create(sibling.token,org,B,randomUUID(),contact,randomUUID()),c=await s.customer.create(foreign.token,otherOrg,C,randomUUID(),contact,randomUUID());
  const errors=[];
  for(const customer_id of [b.id,c.id,randomUUID()]) {const r=await s.book({...s.body,customer_id});assert.equal(r.statusCode,404,r.body);const e=r.json().error;delete e.correlation_id;errors.push(e);}
  assert.deepEqual(errors[0],errors[1]);assert.deepEqual(errors[0],errors[2]);
  assert.equal((await s.book(s.body,randomUUID(),sibling.token,B)).statusCode,404);assert.equal((await s.book(s.body,randomUUID(),foreign.token,C,otherOrg)).statusCode,404);
  assert.equal((await s.book(s.body,randomUUID(),s.operator.token,B)).statusCode,404);assert.deepEqual(await s.counts(),before);
});
await test('revoked operator cannot replay private receipt',{timeout:30000},async t=>{
  const s=await bookingSetup(t),key=randomUUID();assert.equal((await s.book(s.body,key)).statusCode,201);
  await s.memberships.revokeMembership(s.admin.token,s.operator.member.id,{expected_version:s.operator.member.version});
  const denied=await s.book(s.body,key);assert.equal(denied.statusCode,404,denied.body);assert.equal((await s.counts())!.bookings,1);
});
for(const table of ['organizations','franchises'])await test('disabled '+table+' rejects new booking with controlled lifecycle conflict',{timeout:30000},async t=>{
  const s=await bookingSetup(t);await s.db.ownerPool().query(`UPDATE shipit.${table} SET lifecycle='disabled',version=version+1 WHERE id=$1`,[table==='organizations'?org:A]);
  const response=await s.book();assert.equal(response.statusCode,409,response.body);assert.equal(response.json().error.code,table==='organizations'?'ORGANIZATION_DISABLED':'FRANCHISE_DISABLED');assert.equal((await s.counts())!.bookings,0);
});
await test('expired or mismatched pricing/tax evidence and stale customer preconditions fail atomically',{timeout:30000},async t=>{
  const s=await bookingSetup(t);
  assert.equal((await s.book({...s.body,expected_customer_version:2})).json().error.code,'VERSION_CONFLICT');
  assert.equal((await s.book({...s.body,tax_intent:{...s.body.tax_intent,pricing_input:{...s.body.tax_intent.pricing_input,destination_key:'DIFFERENT'}}})).json().error.code,'QUOTE_STALE');
  assert.equal((await s.book({...s.body,tax_intent:{...s.body.tax_intent,facts:{...s.body.tax_intent.facts,service_recipient_ref:'DIFFERENT'}}})).json().error.code,'TAX_STALE');
  s.setNow('2099-01-01T00:05:00Z');assert.equal((await s.book()).json().error.code,'TAX_STALE');s.setNow('2099-01-01T00:10:00Z');assert.equal((await s.book()).json().error.code,'QUOTE_STALE');assert.equal((await s.counts())!.bookings,0);
});
await test('booking audit cursor supports multiple pages without exposing commercial snapshots',{timeout:30000},async t=>{
  const s=await bookingSetup(t);for(let i=0;i<3;i++)assert.equal((await s.book()).statusCode,201);
  const first=await s.list(s.local.token,{resource_type:'booking',limit:'1'});assert.equal(first.statusCode,200,first.body);
  const second=await s.list(s.local.token,{resource_type:'booking',limit:'1',cursor:first.json().page.next_cursor});assert.equal(second.statusCode,200,second.body);
  assert.notEqual(first.json().items[0].id,second.json().items[0].id);assert.ok(!second.body.includes(contact.name));
});
await test('independent booking capabilities cannot cross actions and expire after coordinator completion',{timeout:30000},async t=>{
  const s=await bookingSetup(t);const {withBookingTenantScope}=await import('../../src/modules/memberships/service.ts');
  const {assertTenantAccess,scopedQuery}=await import('../../src/modules/security/scope.ts');
  const scopes=await withBookingTenantScope(s.pool,s.operator.token,org,A,randomUUID(),async scopes=>{
    assert.throws(()=>scopedQuery(scopes.customer,['bookings.create'],'SELECT id FROM shipit.bookings WHERE {{franchise:organization_id:franchise_id}}'),{code:'ACTION_FORBIDDEN'});
    assert.throws(()=>assertTenantAccess(scopes.bookings,['bookings.events']),{code:'ACTION_FORBIDDEN'});return scopes;
  });
  for(const scope of Object.values(scopes))assert.throws(()=>assertTenantAccess(scope),{code:'ACTION_FORBIDDEN'});
});
await test('fifty parcels with maximum Unicode contact lengths fit the bounded durable response',{timeout:30000},async t=>{
  const s=await bookingSetup(t);const recipient={name:'𐀀'.repeat(120),phone:'+1 202-555-0101',address:'𐀀'.repeat(500)};
  await s.customer.update(s.operator.token,org,A,s.source.id,randomUUID(),{...contact,...recipient,expected_version:1},randomUUID());
  const parcels=Array.from({length:50},(_,i)=>({weight_grams:i===49?950:1,recipient}));
  const response=await s.book({...s.body,expected_customer_version:2,parcels});assert.equal(response.statusCode,201,response.body);
  assert.equal(response.json().parcels.length,50);assert.ok(Buffer.byteLength(response.body)>262144);assert.ok(Buffer.byteLength(response.body)<524288);assert.equal((await s.counts())!.events,51);
});
await test('customer snapshot capability is read-only even for directly submitted scoped SQL',{timeout:30000},async t=>{
  const s=await bookingSetup(t);const {withBookingTenantScope}=await import('../../src/modules/memberships/service.ts');const {scopedQuery}=await import('../../src/modules/security/scope.ts');
  await withBookingTenantScope(s.pool,s.operator.token,org,A,randomUUID(),async scopes=>{
    assert.throws(()=>scopedQuery(scopes.customer,['customer.snapshot.read'],`UPDATE shipit.customers SET name='Synthetic' WHERE {{franchise:organization_id:franchise_id}}`),{code:'ACTION_FORBIDDEN'});
  });
});
await test('privileged pricing confirmation additionally requires live W43 while operator remains mandatory',{timeout:30000},async t=>{
  const s=await bookingSetup(t);const invitation=await s.memberships.createInvitation(s.admin.token,{organization_id:org,invitee_user_id:s.operator.id,role:'franchise_admin',franchise_ids:[A]});
  const approval=await s.memberships.acceptInvitation(s.operator.token,{token:invitation.acceptance_token});
  const pricing_input={...s.body.tax_intent.pricing_input,override:{freight_paise:14000,reason_code:'commercial_exception' as const}};
  const quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing_input,randomUUID());assert.equal(quote.override_status,'privileged');
  const tax_intent={...s.body.tax_intent,quote_id:quote.id,pricing_input};const intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),tax_intent,randomUUID());
  const tax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());const body={...s.body,tax_intent,tax_calculation_id:tax.id},key=randomUUID();
  const response=await s.book(body,key);assert.equal(response.statusCode,201,response.body);
  await s.memberships.revokeMembership(s.admin.token,approval.id,{expected_version:approval.version});
  assert.equal((await s.book(body,key)).statusCode,403);assert.equal((await s.counts())!.bookings,1);
});

await test('tenant-scoped parcel list uses stable keyset pages and excludes a later insertion until refresh',{timeout:30000},async t=>{
  const s=await bookingSetup(t),created=[];
  for(let i=0;i<3;i++){const response=await s.book();assert.equal(response.statusCode,201,response.body);created.push(response.json().parcels[0].id);}
  const list=(extra:Record<string,string>={})=>s.app.inject({url:'/api/v1/parcels?'+new URLSearchParams({organization_id:org,franchise_id:A,...extra}),cookies:s.cookies(s.operator.token)});
  const first=await list({limit:'2'});assert.equal(first.statusCode,200,first.body);assert.equal(first.json().items.length,2);assert.equal(first.json().page.has_more,true);
  s.setNow('2099-01-01T00:01:00Z');const later=await s.book();assert.equal(later.statusCode,201,later.body);
  const second=await list({limit:'2',cursor:first.json().page.next_cursor});assert.equal(second.statusCode,200,second.body);assert.equal(second.json().items.length,1);
  const traversed=[...first.json().items,...second.json().items].map((item:{id:string})=>item.id);
  assert.deepEqual(new Set(traversed),new Set(created));assert.ok(!traversed.includes(later.json().parcels[0].id));
  const refreshed=await list({limit:'1'});assert.equal(refreshed.json().items[0].id,later.json().parcels[0].id);
});

await test('docket, UUID, status, customer and date reads return only allowlisted parcel and timeline projections',{timeout:30000},async t=>{
  const s=await bookingSetup(t),created=await s.book();assert.equal(created.statusCode,201,created.body);const parcel=created.json().parcels[0];
  const base={organization_id:org,franchise_id:A};
  const list=await s.app.inject({url:'/api/v1/parcels?'+new URLSearchParams({...base,docket:parcel.docket,status:'booked',customer_id:s.source.id,
    from:'2099-01-01T00:00:00Z',to:'2099-01-01T00:01:00Z',sort:'docket_asc'}),cookies:s.cookies(s.operator.token)});
  assert.equal(list.statusCode,200,list.body);assert.equal(list.json().items.length,1);assert.equal(list.json().items[0].id,parcel.id);
  const detail=await s.app.inject({url:'/api/v1/parcels/'+parcel.id+'?'+new URLSearchParams(base),cookies:s.cookies(s.operator.token)});
  assert.equal(detail.statusCode,200,detail.body);assert.deepEqual(Object.keys(detail.json()).sort(),['booking_id','confirmed_at','custody','docket','id','recipient','sender','status','version','weight_grams']);
  const timeline=await s.app.inject({url:'/api/v1/parcels/'+parcel.id+'/timeline?'+new URLSearchParams(base),cookies:s.cookies(s.operator.token)});
  assert.equal(timeline.statusCode,200,timeline.body);assert.deepEqual(timeline.json().items.map((item:{sequence:number;code:string;label:string})=>[item.sequence,item.code,item.label]),[[1,'parcel.booked','Booking received']]);
  const surfaces=list.body+detail.body+timeline.body;
  for(const prohibited of ['key_digest','fingerprint','token_hash','challenge','verifier','supplier_gstin','recipient_gstin','private_note'])assert.ok(!surfaces.includes(prohibited));
  for(const query of [{sort:'created_at_desc;SELECT 1'},{docket:'SYN%'},{status:'anything'},{limit:'101'},{from:'not-a-date'}]) {
    const invalid=await s.app.inject({url:'/api/v1/parcels?'+new URLSearchParams(Object.fromEntries(Object.entries({...base,...query}).map(([key,value])=>[key,String(value)]))),cookies:s.cookies(s.operator.token)});
    assert.equal(invalid.statusCode,422,invalid.body);
  }
});

await test('foreign and unknown parcel selectors are indistinguishable and cursors cannot cross scope or filters',{timeout:30000},async t=>{
  const s=await bookingSetup(t),created=await s.book();assert.equal(created.statusCode,201,created.body);const parcel=created.json().parcels[0];
  await s.book();const first=await s.app.inject({url:'/api/v1/parcels?'+new URLSearchParams({organization_id:org,franchise_id:A,limit:'1'}),cookies:s.cookies(s.operator.token)});
  const cursor=first.json().page.next_cursor;assert.equal(typeof cursor,'string');
  const sibling=await s.grant('read_only',[B]),foreign=await s.beta('read_only'),missing=randomUUID(),errors:Array<Record<string,unknown>>=[];
  for(const [actor,organization,franchise,id] of [[sibling,org,B,parcel.id],[sibling,org,B,missing],[foreign,otherOrg,C,parcel.id],[foreign,otherOrg,C,missing]] as const) {
    const response=await s.app.inject({url:'/api/v1/parcels/'+id+'?'+new URLSearchParams({organization_id:organization,franchise_id:franchise}),cookies:s.cookies(actor.token)});
    assert.equal(response.statusCode,404,response.body);const error=response.json().error;delete error.correlation_id;errors.push(error);
  }
  assert.ok(errors.every(error=>JSON.stringify(error)===JSON.stringify(errors[0])));
  const crossed=await s.app.inject({url:'/api/v1/parcels?'+new URLSearchParams({organization_id:org,franchise_id:B,limit:'1',cursor}),cookies:s.cookies(sibling.token)});
  assert.equal(crossed.statusCode,422,crossed.body);assert.equal(crossed.json().error.code,'CURSOR_INVALID');
  const changed=await s.app.inject({url:'/api/v1/parcels?'+new URLSearchParams({organization_id:org,franchise_id:A,limit:'1',status:'booked',cursor}),cookies:s.cookies(s.operator.token)});
  assert.equal(changed.statusCode,422,changed.body);assert.equal(changed.json().error.code,'CURSOR_INVALID');
});

await test('parcel reads survive pool restart while revoked and unapproved roles fail closed',{timeout:30000},async t=>{
  const s=await bookingSetup(t),created=await s.book();assert.equal(created.statusCode,201,created.body);const parcel=created.json().parcels[0];
  const readOnly=await s.grant('read_only',[A]),agent=await s.grant('delivery_agent',[A]),accountant=await s.grant('accountant',[A]);
  const replacement=s.db.runtimePool(),service=createBookingService(replacement,s.keys.browser,s.clock);
  const detail=await service.read(readOnly.token,parcel.id,{organization_id:org,franchise_id:A},randomUUID());assert.equal(detail.id,parcel.id);
  assert.deepEqual((await service.timeline(readOnly.token,parcel.id,{organization_id:org,franchise_id:A},randomUUID())).items.map(x=>x.code),['parcel.booked']);
  for(const actor of [agent,accountant]) {
    await assert.rejects(service.read(actor.token,parcel.id,{organization_id:org,franchise_id:A},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
    await assert.rejects(service.list(actor.token,{organization_id:org,franchise_id:A},randomUUID()),{code:'ACTION_FORBIDDEN'});
  }
  await s.memberships.revokeMembership(s.admin.token,readOnly.member.id,{expected_version:readOnly.member.version});
  await assert.rejects(service.read(readOnly.token,parcel.id,{organization_id:org,franchise_id:A},randomUUID()),{code:'RESOURCE_NOT_FOUND'});
  await replacement.close();
});
