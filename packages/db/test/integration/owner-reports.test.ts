import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {provisionDatabase} from '../support.ts';
import {paymentSetup,collectionInput} from '../../../../apps/api/test/payment-support.ts';

await test('owner reporting upgrades populated 54-migration history atomically without fabricating financial evidence or sends',{timeout:60000},async t=>{
 const db=await provisionDatabase(t),directory=fileURLToPath(new URL('../../migrations/',import.meta.url)),old=await mkdtemp(join(tmpdir(),'shipit-owner-old-')),broken=await mkdtemp(join(tmpdir(),'shipit-owner-broken-'));
 t.after(()=>rm(old,{recursive:true}));t.after(()=>rm(broken,{recursive:true}));
 const name='1793466000000-owner-report-schedules.cjs';
 for(const file of(await readdir(directory)).filter(n=>n.endsWith('.cjs')&&n<name)){await copyFile(join(directory,file),join(old,file));await copyFile(join(directory,file),join(broken,file));}
 await writeFile(join(broken,name),(await readFile(join(directory,name),'utf8')).replace('CREATE TABLE shipit.owner_report_access_events',"SELECT 1/0;\nCREATE TABLE shipit.owner_report_access_events"));
 const migrate=db.migrate;db.migrate=options=>migrate(options??{dir:old});t.after(()=>{db.migrate=migrate;});
 const s=await paymentSetup(t,100000,db);assert.equal((await s.pay(collectionInput(25000))).statusCode,200);
 const before=(await db.adminQuery('SELECT to_jsonb(b) booking,to_jsonb(e) payment FROM shipit.bookings b JOIN shipit.payment_entries e ON e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id')).rows;
 await assert.rejects(migrate({dir:broken}));assert.equal((await db.adminQuery("SELECT to_regclass('shipit.owner_report_schedules') relation")).rows[0]!.relation,null);
 assert.deepEqual(await migrate(),{applied:2});assert.deepEqual(await migrate(),{applied:0});
 assert.deepEqual((await db.adminQuery('SELECT to_jsonb(b) booking,to_jsonb(e) payment FROM shipit.bookings b JOIN shipit.payment_entries e ON e.organization_id=b.organization_id AND e.franchise_id=b.franchise_id AND e.booking_id=b.id')).rows,before);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.owner_report_runs')).rows[0]!.n,0);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.owner_report_deliveries')).rows[0]!.n,0);
 await db.prepareOwnerReports();
 await s.pool.query('SELECT * FROM shipit.owner_report_next(false)');await assert.rejects(s.pool.query('DELETE FROM shipit.owner_report_runs'));
});
