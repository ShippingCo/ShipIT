import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { paymentSetup,collectionInput,paymentFault } from '../payment-support.ts';
import { org,A,B,C,otherOrg } from '../audit-support.ts';
import { createReportService } from '../../src/modules/reports/service.ts';
import type { ReportPage } from '@shippingco/shared';
import type { DatabasePool } from '@shippingco/db';

async function setup(t:Parameters<typeof paymentSetup>[0]) {
  const s=await paymentSetup(t);await s.db.prepareReports();
  const date=new Date(Date.parse(s.booked.charges.confirmed_at)+19800000).toISOString().slice(0,10);
  const filter={from_day:date,to_day:date,sort:'confirmed_desc'};
  const q={organization_id:org,franchise_id:A};
  const request=(method:'POST'|'GET',path='',body:unknown=filter,actor:{id:string;token:string}=s.local,key=randomUUID(),query:Record<string,string>=q)=>s.app.inject({method,
    url:'/api/v1/reports/snapshots'+path+'?'+new URLSearchParams(query),headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(actor.token),
    ...(method==='POST'?{payload:JSON.stringify(body)}:{})});
  return {...s,filter,q,report:request};
}
await test('report captures immutable cohort and ledger once, restarts, retries and exports the identical snapshot',{timeout:60000},async t=>{
  const s=await setup(t),key=randomUUID();
  assert.equal((await s.pay(collectionInput(100))).statusCode,200);
  const captured=await s.report('POST','',s.filter,s.local,key);assert.equal(captured.statusCode,200,captured.body);
  const p=captured.json<ReportPage>();assert.equal(p.snapshot.count,1);assert.equal(p.rows.length,1); // two parcels must not multiply the booking
  assert.deepEqual(p.snapshot.totals.collections,{state:'known',paise:'100'});
  assert.equal(p.rows[0]!.outstanding,String(s.gross-100));
  assert.equal(p.rows[0]!.source.id,s.bookingId);assert.equal(p.rows[0]!.payment_source.version,1);
  assert.equal(p.rows[0]!.due_at,null);assert.equal(p.rows[0]!.cost.state,'unknown');
  assert.equal((await s.pay(collectionInput(200))).statusCode,200);
  const reopened=createReportService(s.db.runtimePool());
  assert.deepEqual(await reopened.read(s.local.token,p.snapshot.id,s.q,randomUUID()),p);
  assert.deepEqual((await s.report('POST','',s.filter,s.local,key)).json(),p);
  assert.equal((await s.report('POST','',{...s.filter,sort:'confirmed_asc'},s.local,key)).statusCode,409);
  const exported=await s.report('GET','/'+p.snapshot.id+'/export');assert.equal(exported.statusCode,200,exported.body);
  assert.deepEqual(exported.json().snapshot,p.snapshot);assert.equal(exported.json().csv.split('\r\n').length,3);
  const saved=p.rows[0]!;
  assert.equal(exported.json().csv.split('\r\n')[1],[p.snapshot.id,p.snapshot.as_of,'Asia/Kolkata',s.filter.from_day,s.filter.to_day,
    saved.id,saved.confirmed_at,saved.source.version,saved.payment_source.version,saved.billed_gross,saved.tax_exclusive_revenue,
    saved.collections,saved.outstanding,'unknown','unknown'].map(value=>'"'+String(value)+'"').join(','));
  assert.ok(exported.json().csv.includes('"100"'));assert.equal(exported.headers['cache-control'],'no-store');
  const fresh=(await s.report('POST')).json<ReportPage>();assert.deepEqual(fresh.snapshot.totals.collections,{state:'known',paise:'300'});
  const uncertainKey=randomUUID(),uncertain=createReportService(paymentFault(s.pool,'COMMIT'));
  await assert.rejects(uncertain.create(s.local.token,s.q,uncertainKey,['Idempotency-Key',uncertainKey],s.filter,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,3);
  const replay=await s.report('POST','',s.filter,s.local,uncertainKey);assert.equal(replay.statusCode,200,replay.body);
  const count=await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots');assert.equal(count.rows[0]!.n,3);
  const safe=JSON.stringify({body:p,logs:s.logs,audit:(await s.db.adminQuery('SELECT * FROM shipit.report_access_events')).rows});
  for(const secret of [s.local.token,s.booked.customer.phone,s.booked.customer.address,'Synthetic Recipient'])assert.ok(!safe.includes(secret));
});
await test('report denies sibling/foreign IDs, read-only roles, revoked access and expired downloads',{timeout:60000},async t=>{
  const s=await setup(t),key=randomUUID(),p=(await s.report('POST','',s.filter,s.local,key)).json<ReportPage>(),id=p.snapshot.id;
  await assert.rejects(s.pool.query('UPDATE shipit.report_snapshots SET rows=rows WHERE id=$1',[id]));
  await assert.rejects(s.pool.query('UPDATE shipit.report_snapshots SET metadata=NULL,rows=NULL WHERE id=$1',[id]));
  const sibling=await s.grant('franchise_admin',[B]),readOnly=await s.grant('read_only',[A]);
  for(const actor of [sibling,readOnly,s.operator])assert.notEqual((await s.report('GET','/'+id+'/export',undefined,actor)).statusCode,200);
  for(const query of [{organization_id:org,franchise_id:B},{organization_id:otherOrg,franchise_id:C}]) {
    const real=await s.report('GET','/'+id+'/export',undefined,s.local,randomUUID(),query);
    const missing=await s.report('GET','/'+randomUUID()+'/export',undefined,s.local,randomUUID(),query);
    assert.equal(real.statusCode,404,real.body);assert.deepEqual(real.json().error.code,missing.json().error.code);
  }
  const ownOther=await s.grant('accountant',[A]);assert.equal((await s.report('GET','/'+id,undefined,ownOther)).statusCode,404);
  const adminSnapshot=await s.report('POST','',s.filter,s.admin);assert.equal(adminSnapshot.statusCode,200,adminSnapshot.body);
  assert.equal((await s.report('GET','/'+adminSnapshot.json().snapshot.id+'/export',undefined,s.admin)).statusCode,403);
  // Test-only owner operation advances both timestamps; production runtime cannot alter a snapshot.
  await s.db.adminQuery('ALTER TABLE shipit.report_snapshots DISABLE TRIGGER USER');
  await s.db.adminQuery("UPDATE shipit.report_snapshots SET created_at=created_at-interval '2 days',expires_at=expires_at-interval '2 days' WHERE id=$1",[id]);
  await s.db.adminQuery('ALTER TABLE shipit.report_snapshots ENABLE TRIGGER USER');
  assert.equal((await s.report('GET','/'+id+'/export')).statusCode,404);
  assert.equal((await s.report('POST','',s.filter,s.local,key)).statusCode,410);
  const active=await s.report('POST');assert.equal(active.statusCode,200);
  assert.deepEqual((await s.db.adminQuery('SELECT metadata,rows FROM shipit.report_snapshots WHERE id=$1',[id])).rows,[{metadata:null,rows:null}]);
  assert.equal((await s.report('POST','',s.filter,s.local,key)).statusCode,410);
  await s.db.adminQuery("UPDATE shipit.memberships SET lifecycle='revoked',version=version+1,revoked_at=clock_timestamp() WHERE user_id=$1 AND role='franchise_admin'",[s.local.id]);
  assert.notEqual((await s.report('POST')).statusCode,200);
  assert.equal((await s.report('GET','/'+active.json().snapshot.id+'/export')).statusCode,404);
});
await test('empty reports, controlled validation, concurrent replay and rollback leave no partial evidence',{timeout:60000},async t=>{
  const s=await setup(t),empty={from_day:'2000-01-01',to_day:'2000-01-01'},key=randomUUID();
  const responses=await Promise.all([s.report('POST','',empty,s.local,key),s.report('POST','',empty,s.local,key)]);
  responses.forEach(r=>assert.equal(r.statusCode,200,r.body));assert.deepEqual(responses[0]!.json(),responses[1]!.json());
  const p=responses[0]!.json<ReportPage>();assert.equal(p.snapshot.count,0);assert.deepEqual(p.snapshot.totals.billed_gross,{state:'known',paise:'0'});
  const csv=(await s.report('GET','/'+p.snapshot.id+'/export')).json().csv;assert.equal(csv.split('\r\n').length,2);
  for(const body of [{...empty,from_day:'2026-02-30'},{...empty,franchise_id:B},{...empty,to_day:'2001-01-01'}])assert.equal((await s.report('POST','',body)).statusCode,422);
  assert.equal((await s.report('GET','/'+p.snapshot.id,undefined,s.local,randomUUID(),{...s.q,offset:'-1'})).statusCode,422);
  const failing=createReportService(paymentFault(s.pool,'INSERT INTO shipit.report_access_events','before'));
  const failedKey=randomUUID();
  await assert.rejects(failing.create(s.local.token,s.q,failedKey,['Idempotency-Key',failedKey],s.filter,randomUUID()),{code:'TEMPORARILY_UNAVAILABLE'});
  assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,1);
});

await test('bounded query fixture covers Kolkata midnight, pagination, exact totals and 5001-row rejection',{timeout:60000},async t=>{
  const s=await setup(t),owner=s.db.ownerPool();
  // Query-plan fixtures clone fictional immutable sources, not business commands.
  // User triggers are disabled only in this disposable owner transaction; FKs/checks stay active.
  await owner.query('BEGIN');
  try {
    for(const table of ['booking_commands','bookings','booking_obligations'])await owner.query(`ALTER TABLE shipit.${table} DISABLE TRIGGER USER`);
    await owner.query(`CREATE TEMP TABLE report_seed AS SELECT gen_random_uuid() AS id,gen_random_uuid() AS command,gen_random_uuid() AS obligation,n,
      CASE WHEN n=1 THEN '2026-09-30T18:29:59.999Z'::timestamptz WHEN n=2 THEN '2026-09-30T18:30:00Z'::timestamptz
      WHEN n=3 THEN '2026-10-01T18:29:59.999Z'::timestamptz ELSE '2026-10-01T18:30:00Z'::timestamptz END AS instant FROM generate_series(1,5004) n`);
    for(let first=1;first<=5004;first+=250) {
    await owner.query(`INSERT INTO shipit.booking_commands SELECT (jsonb_populate_record(NULL::shipit.booking_commands,to_jsonb(c)||jsonb_build_object(
      'id',s.command,'booking_id',s.id,'key_digest',md5(s.id::text)||md5(s.id::text),'state','reserved','http_status',NULL,'result',NULL,'committed_at',NULL,'retain_until',NULL))).*
      FROM shipit.booking_commands c CROSS JOIN report_seed s WHERE c.booking_id=$1 AND s.n BETWEEN $2 AND $3`,[s.bookingId,first,first+249]);
    await owner.query(`INSERT INTO shipit.bookings SELECT (jsonb_populate_record(NULL::shipit.bookings,to_jsonb(b)||jsonb_build_object(
      'id',s.id,'command_id',s.command,'parcel_set_ref',s.id,'confirmed_at',s.instant))).* FROM shipit.bookings b CROSS JOIN report_seed s WHERE b.id=$1 AND s.n BETWEEN $2 AND $3`,[s.bookingId,first,first+249]);
    await owner.query(`INSERT INTO shipit.booking_obligations SELECT (jsonb_populate_record(NULL::shipit.booking_obligations,to_jsonb(o)||jsonb_build_object(
      'id',s.obligation,'booking_id',s.id))).* FROM shipit.booking_obligations o CROSS JOIN report_seed s WHERE o.booking_id=$1 AND s.n BETWEEN $2 AND $3`,[s.bookingId,first,first+249]);
    }
    await owner.query('SET CONSTRAINTS ALL IMMEDIATE');
    for(const table of ['booking_commands','bookings','booking_obligations'])await owner.query(`ALTER TABLE shipit.${table} ENABLE TRIGGER USER`);
    await owner.query('COMMIT');
  }catch(error){await owner.query('ROLLBACK');throw error;}
  let plan='';
  const measured:DatabasePool={...s.pool,async connect(){const client=await s.pool.connect();return {release:discard=>client.release(discard),async query<Row extends Record<string,unknown>>(sql:string,params?:readonly unknown[]){
    if(sql.includes('SELECT statement_timestamp() AS as_of'))plan=JSON.stringify((await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,params)).rows);
    return client.query<Row>(sql,params);
  }};}};
  const svc=createReportService(measured),filter={from_day:'2026-10-01',to_day:'2026-10-01',sort:'confirmed_asc'};
  const measuredKey=randomUUID(),p=await svc.create(s.local.token,s.q,measuredKey,['Idempotency-Key',measuredKey],filter,randomUUID());
  // Fixture's ordinary booking has its own clock/date; synthetic midnight pair is identified directly.
  const boundary=p.rows.filter(r=>['2026-09-30T18:30:00.000Z','2026-10-01T18:29:59.999Z'].includes(r.confirmed_at));assert.equal(boundary.length,2);
  assert.ok(!p.rows.some(r=>r.confirmed_at==='2026-09-30T18:29:59.999Z'||r.confirmed_at==='2026-10-01T18:30:00.000Z'));
  assert.ok(plan.includes('Limit'));assert.ok(plan.includes('bookings'));assert.ok(plan.includes('payment_entries'));
  const large=await s.report('POST','',{from_day:'2026-10-02',to_day:'2026-10-02'});assert.equal(large.statusCode,413,large.body);
  // Narrow the synthetic cohort to exactly 5000; report order and pagination stay fixed.
  await owner.query('ALTER TABLE shipit.bookings DISABLE TRIGGER USER');
  await owner.query("UPDATE shipit.bookings SET confirmed_at='2026-10-03T00:00:00Z' WHERE id=(SELECT id FROM report_seed WHERE n=4)");
  await owner.query('ALTER TABLE shipit.bookings ENABLE TRIGGER USER');
  const maximum=(await s.report('POST','',{from_day:'2026-10-02',to_day:'2026-10-02'})).json<ReportPage>();
  assert.equal(maximum.snapshot.count,5000);assert.equal(maximum.rows.length,100);assert.equal(maximum.next_offset,100);
  assert.deepEqual(maximum.snapshot.totals.billed_gross,{state:'known',paise:(5000n*BigInt(s.gross)).toString()});
  const next=await s.report('GET','/'+maximum.snapshot.id,undefined,s.local,randomUUID(),{...s.q,offset:'100'});
  assert.equal(next.statusCode,200,next.body);assert.equal(next.json().rows.length,100);assert.ok(!next.json().rows.some((r:{id:string})=>maximum.rows.some(first=>first.id===r.id)));
  const exported=await s.report('GET','/'+maximum.snapshot.id+'/export');assert.equal(exported.statusCode,200,exported.body);assert.equal(exported.json().csv.split('\r\n').length,5002);
});
