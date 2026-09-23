import test from 'node:test';
import assert from 'node:assert/strict';
import { cp,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { provisionDatabase } from '../support.ts';
import { bookingSetup } from '../../../../apps/api/test/booking-support.ts';

const migrations=fileURLToPath(new URL('../../migrations/',import.meta.url)),name='1791133200000-secure-delivery-proof.cjs';
await test('Issue 42 upgrades a populated Issue 41 database without rewriting existing shipment evidence',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:28}),{applied:28});const migrate=db.migrate;db.migrate=async()=>({applied:0});const s=await bookingSetup(t,db),booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
 const before=(await db.adminQuery('SELECT id,version,status,custody,attempts_started,failed_attempt_count FROM shipit.parcels ORDER BY id')).rows;db.migrate=migrate;
 assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});assert.deepEqual((await db.adminQuery('SELECT id,version,status,custody,attempts_started,failed_attempt_count FROM shipit.parcels ORDER BY id')).rows,before);
 for(const table of ['delivery_commands','delivery_recipients','delivery_attempts','delivery_challenges','delivery_challenge_sends','delivery_exception_requests','delivery_exception_approvals','delivery_proofs','delivery_audit_events'])assert.ok((await db.adminQuery('SELECT to_regclass($1) relation',[`shipit.${table}`])).rows[0]!.relation);
});

await test('failed Issue 42 migration rolls back fully, then unchanged repair applies once',{timeout:30000},async t=>{
 const db=await provisionDatabase(t);await db.migrate({count:28});const broken=await mkdtemp(join(tmpdir(),'shipit-delivery-migration-'));t.after(()=>rm(broken,{recursive:true,force:true}));await cp(migrations,broken,{recursive:true});
 const original=await readFile(join(broken,name),'utf8');await writeFile(join(broken,name),original+"\nconst originalUp=exports.up;exports.up=p=>{originalUp(p);p.sql('SELECT 1/0');};\n");await assert.rejects(db.migrate({dir:broken}),{code:'DB_MIGRATION_FAILED'});
 assert.equal((await db.adminQuery("SELECT to_regclass('shipit.delivery_attempts') relation")).rows[0]!.relation,null);assert.equal((await db.adminQuery('SELECT count(*)::int n FROM shipit_migrations.pgmigrations')).rows[0]!.n,28);
 const repaired=await mkdtemp(join(tmpdir(),'shipit-delivery-repair-'));t.after(()=>rm(repaired,{recursive:true,force:true}));await cp(migrations,repaired,{recursive:true});assert.deepEqual(await db.migrate({dir:repaired}),{applied:1});assert.deepEqual(await db.migrate({dir:repaired}),{applied:0});
});
