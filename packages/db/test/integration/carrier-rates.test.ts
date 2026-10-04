import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';

await test('carrier rates additive migration preserves existing prices and bookings with atomic failure and repeat no-op',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:39}),{applied:39});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await bookingSetup(t,db);assert.equal((await s.book()).statusCode,201);db.migrate=migrate;
  const snapshot=async()=>({bookings:(await db.adminQuery('SELECT * FROM shipit.bookings')).rows,
    rates:(await db.adminQuery('SELECT * FROM shipit.pricing_versions')).rows,quotes:(await db.adminQuery('SELECT * FROM shipit.pricing_quotes')).rows});
  const before=await snapshot(),dir=await mkdtemp(join(tmpdir(),'shipit-rate-upgrade-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),dir,{recursive:true});
  const file=join(dir,'1792170000000-carrier-rates.cjs');
  await writeFile(file,(await readFile(file,'utf8')).replace('CREATE TABLE shipit.carrier_rate_commands','SELECT missing_synthetic_rate_function(); CREATE TABLE shipit.carrier_rate_commands'));
  await assert.rejects(db.migrate({dir}));
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.carrier_rate_imports') AS relation")).rows[0]!.relation,null);
  assert.deepEqual(await snapshot(),before);
  assert.deepEqual(await db.migrate(),{applied:4});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
  await db.prepareCarriers();
  for(const table of ['carrier_rate_imports','carrier_rate_approvals','carrier_rate_commands']){
    await assert.rejects(s.pool.query(`UPDATE shipit.${table} SET franchise_id=franchise_id`));
    await assert.rejects(s.pool.query(`DELETE FROM shipit.${table}`));
  }
});
