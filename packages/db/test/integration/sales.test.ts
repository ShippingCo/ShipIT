import test from 'node:test';
import assert from 'node:assert/strict';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
await test('sales finance upgrade preserves populated tax evidence and old report tables',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:42}),{applied:42});
 const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db);assert.equal((await s.book()).statusCode,201);
 const before=(await db.adminQuery('SELECT id,customer_snapshot,tax_snapshot,final_payable_paise FROM shipit.bookings')).rows;db.migrate=migrate;
 assert.deepEqual(await db.migrate(),{applied:3});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual((await db.adminQuery('SELECT id,customer_snapshot,tax_snapshot,final_payable_paise FROM shipit.bookings')).rows,before);
 await db.prepareReports();await assert.rejects(s.pool.query('UPDATE shipit.financial_changes SET pre_tax=0'));await assert.rejects(s.pool.query('DELETE FROM shipit.account_statement_lines'));
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.financial_changes')).rows[0]!.n,0);
});
