import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { createPaymentService } from '../../../../apps/api/src/modules/payments/service.ts';
import { org,A } from '../../../../apps/api/test/audit-support.ts';
import { randomUUID } from 'node:crypto';
await test('populated pre-29 upgrade preserves booked totals and opening IDs through failed rollback, upgrade and repeat',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:17}),{applied:17});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db);
 const response=await s.book({...s.body,parcels:[{...s.body.parcels[0],weight_grams:400},{...s.body.parcels[0],weight_grams:599}]});assert.equal(response.statusCode,201,response.body);
 const snapshot=async()=>({bookings:(await db.adminQuery('SELECT * FROM shipit.bookings')).rows,obligations:(await db.adminQuery('SELECT * FROM shipit.booking_obligations')).rows,
  commands:(await db.adminQuery('SELECT * FROM shipit.booking_commands')).rows,events:(await db.adminQuery('SELECT * FROM shipit.domain_events')).rows.map(({obligation_id:_o,payment_command_id:_c,...rest})=>rest)});
 const before=await snapshot();db.migrate=migrate;
 const dir=await mkdtemp(join(tmpdir(),'shipit-payment-upgrade-'));t.after(async()=>{assert.equal(dirname(dir),tmpdir());await rm(dir,{recursive:true,force:true});});
 await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),dir,{recursive:true});const path=join(dir,'1790182800000-payment-ledger.cjs');
 await writeFile(path,(await readFile(path,'utf8'))+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT 1/0');};\n");
 await assert.rejects(db.migrate({dir}),{code:'DB_MIGRATION_FAILED'});assert.equal((await db.adminQuery("SELECT to_regclass('shipit.payment_entries') relation")).rows[0]!.relation,null);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,17);assert.deepEqual(await snapshot(),before);
 assert.deepEqual(await db.migrate(),{applied:12});assert.deepEqual(await db.migrate(),{applied:0});await db.preparePayments();
 assert.deepEqual(await snapshot(),before);assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.payment_entries')).rows[0]!.n,0);
 const projection=await createPaymentService(s.pool).read(s.local.token,response.json().id,{organization_id:org,franchise_id:A},randomUUID());
 assert.equal(projection.obligation_id,response.json().payment_obligation.id);assert.equal(projection.gross_paise,response.json().payment_obligation.total_paise);
 assert.equal(projection.collected_paise,0);assert.equal(projection.outstanding_paise,projection.gross_paise);assert.equal(projection.state,'uncollected');assert.equal(projection.version,0);
});
