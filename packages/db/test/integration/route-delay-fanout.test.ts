import test from 'node:test';
import assert from 'node:assert/strict';
import { cp,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename,dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';

await test('populated #40 baseline upgrades forward; failed #41 migration rolls back and a clean retry is repeatable',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:27}),{applied:27});
  const organization='00000000-0000-4000-8000-000000000041',franchise='00000000-0000-4000-8000-000000000042';
  await db.adminQuery("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Issue 41 fixture')",[organization]);
  await db.adminQuery("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'FAN41','Issue 41 fixture')",[franchise,organization]);
  const before=(await db.adminQuery('SELECT id,display_name FROM shipit.organizations WHERE id=$1',[organization])).rows;
  const directory=await mkdtemp(join(tmpdir(),'shipit-route-delay-fanout-upgrade-'));
  t.after(()=>{assert.equal(dirname(directory),tmpdir());assert.ok(basename(directory).startsWith('shipit-route-delay-fanout-upgrade-'));return rm(directory,{recursive:true,force:true});});
  await cp(fileURLToPath(new URL('../../migrations/',import.meta.url)),directory,{recursive:true});
  const file=join(directory,'1791046800000-route-delay-fanout.cjs'),source=await readFile(file,'utf8');
  await writeFile(file,source+"\nconst original=exports.up;exports.up=p=>{original(p);p.sql('SELECT missing_issue41_function()');};\n");
  await assert.rejects(db.migrate({dir:directory}),{code:'DB_MIGRATION_FAILED'});
  assert.equal((await db.adminQuery("SELECT to_regclass('shipit.route_delay_fanouts') value")).rows[0]!.value,null);
  assert.deepEqual((await db.adminQuery('SELECT id,display_name FROM shipit.organizations WHERE id=$1',[organization])).rows,before);
  assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,27);
  assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual((await db.adminQuery('SELECT id,display_name FROM shipit.organizations WHERE id=$1',[organization])).rows,before);
  for(const table of ['route_delay_reminder_commands','route_delay_reminder_events','route_delay_fanouts','route_delay_fanout_items'])
    assert.equal((await db.adminQuery('SELECT to_regclass($1) value',[`shipit.${table}`])).rows[0]!.value,`shipit.${table}`);
});
