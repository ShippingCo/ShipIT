import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase,preReceiptEvent } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { legacyCarrierInstallation } from '../legacy-carrier.ts';
import { createCarrierService } from '../../../../apps/api/src/modules/carriers/service.ts';
import { randomUUID } from 'node:crypto';
import { org,A } from '../../../../apps/api/test/audit-support.ts';

await test('CSV migration preserves populated #54 evidence, rolls back failure and applies once', {timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:37}),{applied:37});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await bookingSetup(t,db),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);await db.prepareCarriers();
  const service=createCarrierService(s.pool,s.keys.browser,s.clock),q={organization_id:org,franchise_id:A};
  await legacyCarrierInstallation(db,{organization:org,franchise:A,actor:s.local.id,label:'PRE-55',now:s.clock()});db.migrate=migrate;
  const snapshot=async()=>Object.fromEntries(await Promise.all(['bookings','parcels','booking_obligations','domain_events','carrier_installations','carrier_commands'].map(async table=>
    [table,(await db.adminQuery(`SELECT ${table==='carrier_installations'?'id,organization_id,franchise_id,courier_id,label,revision,command_id,created_at':'*'} FROM shipit.${table} ORDER BY ${table==='domain_events'?'event_id':'id'}`)).rows.map(row=>table==='domain_events'?preReceiptEvent(row):row)])));
  const before=await snapshot(),dir=await mkdtemp(join(tmpdir(),'shipit-csv-upgrade-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),dir,{recursive:true});
  const file=join(dir,'1791997200000-carrier-csv-imports.cjs');
  await writeFile(file,(await readFile(file,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT 1/0');};\n");
  await assert.rejects(db.migrate({dir}),{code:'DB_MIGRATION_FAILED'});
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.carrier_import_runs') AS relation")).rows[0]!.relation,null);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await db.migrate(),{applied:8});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
  await db.prepareCarriers();
  // The replaced command constraint still accepts old manual provenance.
  await service.mutate('installation',s.local.token,null,randomUUID(),{label:'POST-55'},q,randomUUID());
  for(const table of ['carrier_import_runs','carrier_import_commits','carrier_import_outcomes']){
    await assert.rejects(s.pool.query(`TRUNCATE shipit.${table}`));
    await assert.rejects(s.pool.query(`ALTER TABLE shipit.${table} DISABLE TRIGGER ALL`));
  }
});
