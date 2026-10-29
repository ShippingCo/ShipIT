import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {provisionDatabase} from '../support.ts';import {setupCashClose} from '../../../../apps/api/test/cash-close-support.ts';
await test('populated migration48 upgrades additively through50 without changing actual source evidence or fabricating closing history',{timeout:60000},async t=>{
 const db=await provisionDatabase(t),old=await mkdtemp(join(tmpdir(),'shipit-close-upgrade-')),directory=fileURLToPath(new URL('../../migrations/',import.meta.url));t.after(()=>rm(old,{recursive:true}));
 for(const name of (await readdir(directory)).filter(n=>n.endsWith('.cjs')&&n<'1792947600000-cash-closing.cjs'))await copyFile(join(directory,name),join(old,name));
 const migrate=db.migrate;db.migrate=options=>migrate(options??{dir:old});t.after(()=>{db.migrate=migrate;});
 const s=await setupCashClose(t,{database:db,closing:false});await s.receipt();await s.expense(80000,new Date(Date.parse(s.counted)-1000).toISOString());
 const before=(await db.adminQuery("SELECT jsonb_agg(to_jsonb(f) ORDER BY source_kind,source_id,location_id,direction) sources FROM shipit.cashbook_source_facts f")).rows[0]!.sources;
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,48);
 db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:8});assert.deepEqual((await db.adminQuery("SELECT jsonb_agg(to_jsonb(f) ORDER BY source_kind,source_id,location_id,direction) sources FROM shipit.cashbook_source_facts f")).rows[0]!.sources,before);
 for(const table of ['cash_close_sessions','cash_close_commands','cash_close_dependencies']){assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${table}`)).rows[0]!.n,0);assert.equal((await db.adminQuery('SELECT has_table_privilege($1,$2,\'INSERT\') allowed',[db.runtimeRole,'shipit.'+table])).rows[0]!.allowed,false);}
 assert.deepEqual(await db.migrate(),{applied:0});
});
