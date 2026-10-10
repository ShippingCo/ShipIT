import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyCarrierInstallation } from '../legacy-carrier.ts';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { org,A } from '../../../../apps/api/test/audit-support.ts';

await test('manual-only rollout preserves populated installations and immutable selection',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:40}),{applied:40});
  const migrate=db.migrate;db.migrate=async()=>({applied:0});
  const s=await bookingSetup(t,db);await db.prepareCarriers();db.migrate=migrate;
  const {id}=await legacyCarrierInstallation(db,{organization:org,franchise:A,actor:s.local.id,label:'LEGACY-FICTIONAL',now:s.clock()});
  const owner=db.ownerPool();
  const before=(await db.adminQuery('SELECT id,command_id,created_at FROM shipit.carrier_installations')).rows;
  assert.deepEqual(await db.migrate(),{applied:4});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual((await db.adminQuery('SELECT id,command_id,created_at FROM shipit.carrier_installations')).rows,before);
  assert.equal((await db.adminQuery('SELECT file_import FROM shipit.carrier_installations WHERE id=$1',[id])).rows[0]!.file_import,true);
  await assert.rejects(owner.query('UPDATE shipit.carrier_installations SET file_import=false WHERE id=$1',[id]));
  await assert.rejects(s.pool.query('UPDATE shipit.carrier_installations SET file_import=false WHERE id=$1',[id]));
  assert.ok((await db.adminQuery("SELECT indexname FROM pg_indexes WHERE schemaname='shipit' AND indexname='carrier_manual_health_idx'")).rows.length);
});
