import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';
import { org,A,otherOrg } from '../../../../apps/api/test/audit-support.ts';
import { createParcelBulkService } from '../../../../apps/api/src/modules/parcels/bulk-service.ts';
const directory=fileURLToPath(new URL('../../migrations/',import.meta.url));
const migration='1789837200000-bounded-parcel-bulk.cjs';
await test('bulk additive upgrade from Issue 24, repeated no-op and failed migration rollback/retry',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:13}),{applied:13});
  const owner=db.ownerPool();await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic')",[org]);
  const before=(await owner.query('SELECT * FROM shipit.organizations')).rows;
  const temp=await mkdtemp(join(tmpdir(),'shipit-bulk-failure-'));t.after(()=>rm(temp,{recursive:true,force:true}));await cp(directory,temp,{recursive:true});
  const original=await readFile(join(temp,migration),'utf8');await writeFile(join(temp,migration),original+"\nconst up=exports.up;exports.up=pgm=>{up(pgm);pgm.sql('SELECT 1/0');};\n");
  await assert.rejects(db.migrate({dir:temp}),{code:'DB_MIGRATION_FAILED'});
  assert.equal((await owner.query("SELECT to_regclass('shipit.parcel_bulk_requests') AS table")).rows[0]!.table,null);
  assert.equal((await owner.query('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,13);
  assert.deepEqual(await db.migrate(),{applied:9});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual((await owner.query('SELECT * FROM shipit.organizations')).rows,before);
});
await test('bulk receipt runtime least privilege, immutable intent, bounded fields and composite owner constraint',{timeout:30000},async t=>{
  const s=await bookingSetup(t),key=randomUUID();
  const service=createParcelBulkService(s.pool);
  await service.execute(s.operator.token,{organization_id:org,franchise_id:A},key,['idempotency-key',key],
    {action:'check_in',items:[{parcel_id:randomUUID(),idempotency_key:randomUUID(),command:{expected_version:1,evidence_ref:randomUUID(),location_ref:randomUUID()}}]},randomUUID());
  const rows=(await s.pool.query('SELECT * FROM shipit.parcel_bulk_requests')).rows;
  assert.equal(rows.length,1);assert.ok(!JSON.stringify(rows).includes(key));
  for(const sql of ['UPDATE shipit.parcel_bulk_requests SET fingerprint=fingerprint','DELETE FROM shipit.parcel_bulk_requests',
    'TRUNCATE shipit.parcel_bulk_requests','ALTER TABLE shipit.parcel_bulk_requests ADD COLUMN unsafe text'])await assert.rejects(s.pool.query(sql));
  await assert.rejects(s.db.ownerPool().query('UPDATE shipit.parcel_bulk_requests SET fingerprint=fingerprint'));
  const insert=`INSERT INTO shipit.parcel_bulk_requests(id,organization_id,franchise_id,principal_id,key_digest,fingerprint,action,item_count,correlation_id)
    VALUES($1,$2,$3,$4,$5,$5,'parcels.check_in',$6,$7)`;
  for(const [organization,count] of [[otherOrg,1],[org,0],[org,51]] as const)await assert.rejects(s.pool.query(insert,[randomUUID(),organization,A,s.operator.id,'a'.repeat(64),count,randomUUID()]));
  assert.equal((await s.pool.query('SELECT count(*)::int n FROM shipit.parcel_bulk_requests')).rows[0]!.n,1);
});
