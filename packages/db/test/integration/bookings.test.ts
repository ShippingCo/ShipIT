import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { org,A,B } from '../../../../apps/api/test/audit-support.ts';
const directory=fileURLToPath(new URL('../../migrations/',import.meta.url));
const migration='1789578000000-atomic-bookings.cjs';
await test('Issue 21 upgrades through booking retrieval without changing existing tenant/customer/audit rows; repeated install is a no-op',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:10}),{applied:10});const owner=db.ownerPool();
  await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic')",[org]);await owner.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'MAIN','Synthetic')",[A,org]);
  const before=(await owner.query('SELECT * FROM shipit.franchises')).rows;assert.deepEqual(await db.migrate(),{applied:18});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual((await owner.query('SELECT * FROM shipit.franchises')).rows,before);
  const key=(await owner.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname='parcels_docket_key'")).rows[0]!;
  assert.equal(key.definition,'UNIQUE (docket)');
  const indexes=(await owner.query("SELECT indexname FROM pg_indexes WHERE schemaname='shipit' AND indexname IN ('parcels_owner_docket_idx','parcels_owner_status_booking_idx','bookings_owner_created_idx','bookings_owner_customer_created_idx','domain_events_parcel_timeline_idx') ORDER BY indexname")).rows.map(row=>row.indexname);
  assert.deepEqual(indexes,['bookings_owner_created_idx','bookings_owner_customer_created_idx','domain_events_parcel_timeline_idx','parcels_owner_docket_idx','parcels_owner_status_booking_idx']);
});
await test('failed additive booking migration rolls back schema/ledger; retry and later forward repair preserve history',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);await db.migrate({count:10});const temp=await mkdtemp(join(tmpdir(),'shipit-booking-migration-'));t.after(()=>rm(temp,{recursive:true,force:true}));await cp(directory,temp,{recursive:true});
  const original=await readFile(join(temp,migration),'utf8');await writeFile(join(temp,migration),original+"\nconst originalUp=exports.up; exports.up=pgm=>{originalUp(pgm);pgm.sql('SELECT 1/0');};\n");
  await assert.rejects(db.migrate({dir:temp}),{code:'DB_MIGRATION_FAILED'});const owner=db.ownerPool();assert.equal((await owner.query("SELECT to_regclass('shipit.bookings') AS table")).rows[0]!.table,null);
  assert.equal((await owner.query('SELECT count(*)::int AS n FROM shipit_migrations.pgmigrations')).rows[0]!.n,10);
  await writeFile(join(temp,migration),original);
  // A fresh migration module path models a restarted migrator (CommonJS caches loaded failures).
  const repaired=await mkdtemp(join(tmpdir(),'shipit-booking-repair-'));t.after(()=>rm(repaired,{recursive:true,force:true}));await cp(temp,repaired,{recursive:true});
  assert.deepEqual(await db.migrate({dir:repaired}),{applied:18});
  await writeFile(join(repaired,'1791046800001-synthetic-forward-repair.cjs'),"exports.up=pgm=>pgm.sql('CREATE INDEX synthetic_booking_repair_idx ON shipit.bookings(confirmed_at)');");
  assert.deepEqual(await db.migrate({dir:repaired}),{applied:1});assert.deepEqual(await db.migrate({dir:repaired}),{applied:0});
});
await test('runtime least privilege and owner triggers protect snapshots, dockets, obligation, receipts and append-only evidence',{timeout:30000},async t=>{
  const s=await bookingSetup(t),response=await s.book();assert.equal(response.statusCode,201,response.body);const owner=s.db.ownerPool();
  for(const table of ['bookings','parcels','booking_commands','booking_obligations','domain_events','booking_audit_events']) {
    for(const sql of [`DELETE FROM shipit.${table}`,`TRUNCATE shipit.${table}`,`ALTER TABLE shipit.${table} DISABLE TRIGGER ALL`])await assert.rejects(s.pool.query(sql));
    await assert.rejects(owner.query(`UPDATE shipit.${table} SET organization_id=organization_id`));
    await assert.rejects(owner.query(`DELETE FROM shipit.${table}`));
  }
  for(const sql of ["SELECT nextval('shipit.global_docket_sequence')","SELECT setval('shipit.global_docket_sequence',1)",'SELECT * FROM shipit.booking_audit_events','UPDATE shipit.bookings SET customer_snapshot=customer_snapshot','UPDATE shipit.parcels SET docket=docket'])await assert.rejects(s.pool.query(sql));
  // Immutable command gates reject new children/events after confirmation.
  await assert.rejects(owner.query('INSERT INTO shipit.parcels SELECT $1,organization_id,franchise_id,booking_id,2,$2,version,status,custody,weight_grams,sender_snapshot,recipient_snapshot FROM shipit.parcels',[randomUUID(),'SYN-EXTRA']));
  const functions=(await owner.query("SELECT proname,has_function_privilege('public',oid,'EXECUTE') AS public FROM pg_proc WHERE pronamespace='shipit'::regnamespace AND proname IN ('allocate_docket','guard_booking_child','append_booking_audit','check_booking_complete','reject_booking_mutation','guard_booking_command')")).rows;
  assert.equal(functions.length,6);assert.ok(functions.every(f=>f.public===false));assert.equal((await s.counts())!.parcels,1);
});
await test('SQL forbids partial commands, mixed ownership, incorrect money and duplicate logical events',{timeout:30000},async t=>{
  const s=await bookingSetup(t),owner=s.db.ownerPool();
  await assert.rejects(owner.query(`INSERT INTO shipit.booking_commands(id,principal_type,principal_id,organization_id,franchise_id,operation_id,key_digest,fingerprint,normalization_version,booking_id,correlation_id)
    VALUES($1,'user',$2,$3,$4,'api.v1.bookings.create',$5,$5,1,$6,$7)`,[randomUUID(),s.operator.id,org,A,'a'.repeat(64),randomUUID(),randomUUID()]));
  assert.equal((await s.counts())!.commands,0);
  const response=await s.book();assert.equal(response.statusCode,201,response.body);const b=response.json();
  // Explicit FK catalog verifies both ownership dimensions on every child dependency.
  for(const name of ['parcels_booking_fk','bookings_customer_fk','booking_obligations_payable_fk','domain_events_parcel_fk','booking_commands_booking_fk']) {
    const row=(await owner.query('SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname=$1',[name])).rows[0]!;
    assert.match(String(row.definition),/FOREIGN KEY \(organization_id, franchise_id,/);
  }
  await assert.rejects(owner.query('INSERT INTO shipit.booking_obligations(id,organization_id,franchise_id,booking_id,total_paise,collected_paise,outstanding_paise) VALUES($1,$2,$3,$4,13400,1,13400)',[randomUUID(),org,B,b.id]));
  await assert.rejects(owner.query('INSERT INTO shipit.domain_events SELECT $1,organization_id,franchise_id,booking_id,parcel_id,command_id,event_type,aggregate_id,envelope FROM shipit.domain_events LIMIT 1',[randomUUID()]));
  assert.equal((await s.counts())!.events,2);
});
