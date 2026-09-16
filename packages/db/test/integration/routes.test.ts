import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,cp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
const directory=fileURLToPath(new URL('../../migrations/',import.meta.url));
await test('route upgrade from all 15 released migrations, failed additive rollback/retry, old view and repeat no-op',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:15}),{applied:15});const owner=db.ownerPool();
  const prior=(await owner.query('SELECT * FROM shipit.audit_history')).rows;
  const temp=await mkdtemp(join(tmpdir(),'shipit-routes-failure-'));t.after(()=>rm(temp,{recursive:true,force:true}));await cp(directory,temp,{recursive:true});
  const path=join(temp,'1790010000000-dispatch-route-manifests.cjs'),original=await readFile(path,'utf8');
  await writeFile(path,original+"\nconst up=exports.up;exports.up=pgm=>{up(pgm);pgm.sql('SELECT 1/0');};\n");
  await assert.rejects(db.migrate({dir:temp}),{code:'DB_MIGRATION_FAILED'});
  assert.equal((await owner.query("SELECT to_regclass('shipit.routes') relation")).rows[0]!.relation,null);
  assert.equal((await owner.query('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,15);
  assert.deepEqual(await db.migrate(),{applied:4});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual((await owner.query('SELECT * FROM shipit.audit_history')).rows,prior);
  await db.prepareRoutes();
  const runtime=db.runtimePool();
  for(const table of ['routes','route_commands','route_lots','route_parcels','route_manifests','route_manifest_parcels','route_manifest_sources','route_audit_events','parcel_dispatch_manifests']){
    await assert.rejects(runtime.query(`DELETE FROM shipit.${table}`));
    await assert.rejects(runtime.query(`TRUNCATE shipit.${table}`));
    await assert.rejects(runtime.query(`ALTER TABLE shipit.${table} ADD COLUMN bypass text`));
  }
  await assert.rejects(runtime.query('SELECT * FROM shipit.route_audit_events'));
  await assert.rejects(runtime.query('SELECT * FROM shipit.parcel_dispatch_manifests'));
  await assert.rejects(runtime.query('UPDATE shipit.route_manifests SET parcel_count=0'));
  await assert.rejects(runtime.query('UPDATE shipit.routes SET organization_id=gen_random_uuid()'));
  const fks=(await owner.query("SELECT confdeltype FROM pg_constraint WHERE contype='f' AND conrelid IN ('shipit.routes'::regclass,'shipit.route_lots'::regclass,'shipit.route_parcels'::regclass,'shipit.route_manifests'::regclass,'shipit.route_manifest_parcels'::regclass,'shipit.route_manifest_sources'::regclass,'shipit.parcel_dispatch_manifests'::regclass)")).rows;
  assert.ok(fks.length>=20);assert.ok(fks.every(row=>row.confdeltype==='r'));
});
