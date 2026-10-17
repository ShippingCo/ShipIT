import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {provisionDatabase} from '../support.ts';
import {paymentSetup} from '../../../../apps/api/test/payment-support.ts';
await test('populated released51 upgrades without reclassifying debtors, repricing or fabricating account evidence',{timeout:60000},async t=>{
 const db=await provisionDatabase(t),old=await mkdtemp(join(tmpdir(),'shipit-account-upgrade-')),directory=fileURLToPath(new URL('../../migrations/',import.meta.url));t.after(()=>rm(old,{recursive:true}));
 for(const name of (await readdir(directory)).filter(n=>n.endsWith('.cjs')&&n<'1793206800000-customer-accounts.cjs'))await copyFile(join(directory,name),join(old,name));
 const migrate=db.migrate;db.migrate=options=>migrate(options??{dir:old});t.after(()=>{db.migrate=migrate;});
 const s=await paymentSetup(t,undefined,db);const paid=await s.pay();assert.equal(paid.statusCode,200,paid.body);
 const snapshot=async()=>(await db.adminQuery(`SELECT jsonb_build_object('quotes',(SELECT jsonb_agg(to_jsonb(q)-'account_rate_id' ORDER BY id) FROM shipit.pricing_quotes q),
 'bookings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM shipit.bookings b),'payments',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM shipit.payment_entries p)) value`)).rows[0]!.value;
 const before=await snapshot();assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,51);
 db.migrate=migrate;assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual(await snapshot(),before);
 for(const name of ['customer_accounts','customer_account_revisions','customer_account_rates','customer_account_bookings','customer_account_customer_links','customer_credit_requests','customer_credit_approvals','customer_account_audit_events']){
  assert.equal((await db.adminQuery(`SELECT count(*)::int n FROM shipit.${name}`)).rows[0]!.n,0);
  assert.equal((await db.adminQuery("SELECT has_table_privilege($1,$2,'INSERT') allowed",[db.runtimeRole,'shipit.'+name])).rows[0]!.allowed,false);
 }
 const after=await s.pay();assert.equal(after.statusCode,409,after.body); // Already fully collected; upgrade cannot reset the ledger.
});
