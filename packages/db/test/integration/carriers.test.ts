import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';

await test('carrier migration preserves populated #53 schema, rolls back failure and applies once', {timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:36}),{applied:36});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await bookingSetup(t,db),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);db.migrate=migrate;
  const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','parcels','booking_obligations','domain_events'].map(async table=>
    [table,(await db.adminQuery(`SELECT * FROM shipit.${table} ORDER BY ${table==='domain_events'?'event_id':'id'}`)).rows])));
  const before=await snapshot(),dir=await mkdtemp(join(tmpdir(),'shipit-carrier-upgrade-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),dir,{recursive:true});
  const file=join(dir,'1791910800000-manual-carriers.cjs');
  await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT 1/0');};\n");
  await assert.rejects(db.migrate({dir}),{code:'DB_MIGRATION_FAILED'});
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.carrier_installations') AS relation")).rows[0]!.relation,null);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await db.migrate(),{applied:5});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual(await snapshot(),before);
  assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.carrier_installations')).rows[0]!.n,0);
  await db.prepareCarriers();
  for(const table of ['carrier_installations','carrier_mappings','carrier_dockets','carrier_references','carrier_observations','carrier_commands']){
    await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));
    await assert.rejects(s.pool.query(`ALTER TABLE shipit.${table} DISABLE TRIGGER ALL`));
  }
});
