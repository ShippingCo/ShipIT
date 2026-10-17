import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {provisionDatabase} from '../support.ts';
import {setupCashClose} from '../../../../apps/api/test/cash-close-support.ts';
await test('populated released49 upgrades to51 with immutable money and physical evidence, no fabricated costs and explicit grants',{timeout:60000},async t=>{
 const db=await provisionDatabase(t),old=await mkdtemp(join(tmpdir(),'shipit-cost-upgrade-')),directory=fileURLToPath(new URL('../../migrations/',import.meta.url));t.after(()=>rm(old,{recursive:true}));
 for(const name of (await readdir(directory)).filter(n=>n.endsWith('.cjs')&&n<'1793034000000-shipment-costs.cjs'))await copyFile(join(directory,name),join(old,name));
 const migrate=db.migrate;db.migrate=options=>migrate(options??{dir:old});t.after(()=>{db.migrate=migrate;});
 const s=await setupCashClose(t,{database:db});await s.receipt();await s.expense(1000,new Date(Date.parse(s.counted)-1000).toISOString());const opening=await s.command('open',null,s.openBody);
 const before=(await db.adminQuery("SELECT jsonb_build_object('money',(SELECT jsonb_agg(to_jsonb(f) ORDER BY source_kind,source_id,location_id,direction) FROM shipit.cashbook_source_facts f),'physical',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM shipit.cash_close_commands c)) value")).rows[0]!.value;
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,49);
 db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:3});assert.deepEqual(await db.migrate(),{applied:0});
 const after=(await db.adminQuery("SELECT jsonb_build_object('money',(SELECT jsonb_agg(to_jsonb(f) ORDER BY source_kind,source_id,location_id,direction) FROM shipit.cashbook_source_facts f),'physical',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM shipit.cash_close_commands c)) value")).rows[0]!.value;assert.deepEqual(after,before);assert.ok(opening.session_id);
 for(const table of ['shipment_cost_sources','shipment_cost_revisions','shipment_cost_allocations','shipment_cost_aliases','shipment_cost_commands']){assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);assert.equal((await db.adminQuery('SELECT has_table_privilege($1,$2,\'INSERT\') allowed',[db.runtimeRole,'shipit.'+table])).rows[0]!.allowed,false);}
});
