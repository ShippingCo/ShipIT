import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
await test('report migration preserves existing booking evidence and restricts runtime writes',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:41}),{applied:41});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db);
  assert.equal((await s.book()).statusCode,201);
  const before=(await db.adminQuery('SELECT id,tax_snapshot,final_payable_paise FROM shipit.bookings')).rows;
  db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:2});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual((await db.adminQuery('SELECT id,tax_snapshot,final_payable_paise FROM shipit.bookings')).rows,before);
  await db.prepareReports();
  await assert.rejects(s.pool.query('UPDATE shipit.report_snapshots SET fingerprint=fingerprint'));
  await assert.rejects(s.pool.query('DELETE FROM shipit.report_access_events'));
  assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.report_snapshots')).rows[0]!.n,0);
});
