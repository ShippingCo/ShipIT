import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {provisionDatabase} from '../support.ts';
import {setupCashClose} from '../../../../apps/api/test/cash-close-support.ts';
await test('reconciliation upgrades populated released52 without creating verification or changing money; private by default',{timeout:60000},async t=>{
 const db=await provisionDatabase(t),old=await mkdtemp(join(tmpdir(),'shipit-reconciliation-upgrade-')),directory=fileURLToPath(new URL('../../migrations/',import.meta.url));t.after(()=>rm(old,{recursive:true}));
 for(const name of (await readdir(directory)).filter(n=>n.endsWith('.cjs')&&n<'1793293200000-manual-reconciliation.cjs'))await copyFile(join(directory,name),join(old,name));
 const migrate=db.migrate;db.migrate=options=>migrate(options??{dir:old});t.after(()=>{db.migrate=migrate;});
 const s=await setupCashClose(t,{database:db});await s.receipt();await s.expense(1000,new Date(Date.parse(s.counted)-1000).toISOString());await s.command('open',null,s.openBody);
 const snapshot=async()=>(await db.adminQuery("SELECT jsonb_build_object('receipts',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM shipit.money_receipts r),'money',(SELECT jsonb_agg(to_jsonb(f) ORDER BY source_kind,source_id,location_id,direction) FROM shipit.cashbook_source_facts f),'physical',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM shipit.cash_close_commands c)) value")).rows[0]!.value;
 const before=await snapshot();assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,52);
 db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:4});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
 for(const table of ['commands','config_versions','mapping_versions','imports','transactions','row_outcomes','batches','matches','match_transactions','match_sources','unmatches','classifications','review_revisions','access_events']){
  assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.reconciliation_${table}`)).rows[0]!.n,0);
  assert.equal((await db.adminQuery('SELECT has_table_privilege($1,$2,\'INSERT\') allowed',[db.runtimeRole,'shipit.reconciliation_'+table])).rows[0]!.allowed,false);
 }
 assert.equal((await db.adminQuery('SELECT has_table_privilege($1,$2,\'SELECT\') allowed',[db.runtimeRole,'shipit.reconciliation_recorded_sources'])).rows[0]!.allowed,false);
 assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit.reconciliation_recorded_sources')).rows[0]!.n,0,'physical cash is not bank evidence');
});
