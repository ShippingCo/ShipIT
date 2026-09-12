import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseError } from '../../src/index.ts';
import { provisionDatabase } from '../support.ts';
const org='00000000-0000-4000-8000-000000000001',franchise='00000000-0000-4000-8000-000000000011',user='00000000-0000-4000-8000-000000000101';

await test('runtime credential appends through granted functions, reads projection and cannot rewrite or own audit history',{timeout:20000},async t=>{
  const db=await provisionDatabase(t);await db.prepareMemberships();const pool=db.runtimePool();
  await pool.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic')",[org]);
  await pool.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'MAIN','Synthetic')",[franchise,org]);
  assert.equal((await pool.query<{name:string}>('SELECT current_user AS name')).rows[0]?.name,db.runtimeRole);
  await pool.query(`SELECT shipit.append_tenancy_audit($1,$2,'service','synthetic','franchise.profile.update','franchise',$2,
    'profile_correction',$3,clock_timestamp(),'active','active',2)`,[org,franchise,randomUUID()]);
  const row=(await pool.query('SELECT id,action FROM shipit.audit_history WHERE organization_id=$1',[org])).rows[0]!;
  assert.equal(row.action,'franchise.profile.update');
  await pool.query("SELECT shipit.append_security_denial('anonymous','anonymous','audit.read','audit','UNAUTHENTICATED',$1)",[randomUUID()]);
  const owner=db.ownerPool();
  await owner.query('INSERT INTO shipit.auth_users(id) VALUES($1)',[user]);
  await owner.query("INSERT INTO shipit.auth_security_events(id,user_id,action) VALUES($1,$2,'provision')",[randomUUID(),user]);
  for(const sql of [
    "INSERT INTO shipit.audit_records(id) VALUES(gen_random_uuid())", "UPDATE shipit.audit_records SET result='success'",'DELETE FROM shipit.audit_records',
    'TRUNCATE shipit.audit_records','DROP TABLE shipit.audit_records',`ALTER TABLE shipit.audit_records OWNER TO "${db.runtimeRole}"`,
    'ALTER TABLE shipit.audit_records DISABLE TRIGGER ALL','CREATE TABLE shipit.audit_forgery(id uuid)',
    'UPDATE shipit.audit_history SET actor_id=\'forged\'','DELETE FROM shipit.audit_history',
    'DELETE FROM shipit.auth_security_events',"UPDATE shipit.auth_security_events SET action='login'",'TRUNCATE shipit.auth_security_events',
    'DELETE FROM shipit.membership_audit_events',"UPDATE shipit.membership_audit_events SET action='membership_updated'",'TRUNCATE shipit.membership_audit_events',
    'ALTER FUNCTION shipit.append_security_denial(text,text,text,text,text,uuid) SECURITY INVOKER',
    `SET ROLE "${db.migrationRole}"`,
  ])await assert.rejects(pool.query(sql),e=>e instanceof DatabaseError&&e.code==='DB_QUERY_FAILED');
  assert.equal((await owner.query<{count:string}>('SELECT count(*) FROM shipit.audit_records')).rows[0]?.count,'2');
  const functions=await owner.query<{definer:boolean;config:string[]}>(`SELECT p.prosecdef AS definer,p.proconfig AS config FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='shipit' AND p.proname IN ('append_tenancy_audit','append_security_denial')`);
  assert.equal(functions.rows.length,2);assert.ok(functions.rows.every(f=>f.definer&&f.config.includes('search_path=pg_catalog')));
});

await test('released main upgrades by compatibility projection without rewriting or duplicating legacy facts',{timeout:20000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:5}),{applied:5});const owner=db.ownerPool();
  await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic')",[org]);
  await owner.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'MAIN','Synthetic')",[franchise,org]);
  await owner.query('INSERT INTO shipit.auth_users(id) VALUES($1)',[user]);
  const member=randomUUID(),identity=randomUUID(),audit=randomUUID();
  await owner.query("INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'operator')",[member,user,org]);
  await owner.query("INSERT INTO shipit.auth_security_events(id,user_id,action,occurred_at) VALUES($1,$2,'login','2026-09-10T00:00:00.123456Z')",[identity,user]);
  await owner.query(`INSERT INTO shipit.membership_audit_events(id,organization_id,actor_type,actor_user_id,affected_user_id,membership_id,action,role,franchise_ids)
    VALUES($1,$2,'user',$3,$3,$4,'membership_updated','operator',$5)`,[audit,org,user,member,[franchise]]);
  const before=await owner.query('SELECT to_jsonb(a) AS value FROM shipit.membership_audit_events a');
  assert.deepEqual(await db.migrate(),{applied:2});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual((await owner.query("SELECT to_jsonb(a)-'correlation_id' AS value FROM shipit.membership_audit_events a")).rows,before.rows);
  const rows=(await owner.query('SELECT * FROM shipit.audit_history ORDER BY id')).rows;
  assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.id),[`identity:${identity}`,`membership:${audit}`]);
  assert.equal(rows[0]!.organization_id,null);assert.equal(rows[0]!.correlation_id,identity);
  assert.equal(rows[1]!.correlation_id,audit);assert.deepEqual(rows[1]!.franchise_ids,[franchise]);
  assert.equal((await owner.query<{count:string}>('SELECT count(*) FROM shipit.audit_records')).rows[0]?.count,'0');
  // Compatible older application INSERTs still appear once, with deterministic fallback correlation.
  const next=randomUUID();await owner.query("INSERT INTO shipit.auth_security_events(id,user_id,action) VALUES($1,$2,'logout')",[next,user]);
  assert.equal((await owner.query<{count:string}>('SELECT count(*) FROM shipit.audit_history WHERE id=$1',[`identity:${next}`])).rows[0]?.count,'1');
});

await test('invalid historical franchise ownership fails the additive upgrade and leaves history intact',{timeout:20000},async t=>{
  const db=await provisionDatabase(t);await db.migrate({count:5});const owner=db.ownerPool(),other=randomUUID(),member=randomUUID(),audit=randomUUID();
  await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic A'),($2,'Synthetic B')",[org,other]);
  await owner.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'MAIN','Synthetic Foreign')",[franchise,other]);
  await owner.query('INSERT INTO shipit.auth_users(id) VALUES($1)',[user]);
  await owner.query("INSERT INTO shipit.memberships(id,user_id,organization_id,role) VALUES($1,$2,$3,'operator')",[member,user,org]);
  await owner.query(`INSERT INTO shipit.membership_audit_events(id,organization_id,actor_type,actor_user_id,affected_user_id,membership_id,action,role,franchise_ids)
    VALUES($1,$2,'user',$3,$3,$4,'membership_updated','operator',$5)`,[audit,org,user,member,[franchise]]);
  await assert.rejects(db.migrate(),{code:'DB_MIGRATION_FAILED'});
  assert.deepEqual((await owner.query('SELECT franchise_ids FROM shipit.membership_audit_events WHERE id=$1',[audit])).rows[0]?.franchise_ids,[franchise]);
  assert.equal((await owner.query<{count:string}>('SELECT count(*) FROM shipit_migrations.pgmigrations')).rows[0]?.count,'5');
  assert.equal((await owner.query<{name:string|null}>("SELECT to_regclass('shipit.audit_records')::text AS name")).rows[0]?.name,null);
});

await test('database rejects foreign owners, unbounded fields and secret-bearing arbitrary audit data',{timeout:20000},async t=>{
  const db=await provisionDatabase(t);await db.prepareMemberships();const owner=db.ownerPool();
  await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic')",[org]);
  const other=randomUUID();await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic Other')",[other]);
  await owner.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'MAIN','Synthetic')",[franchise,other]);
  await assert.rejects(owner.query(`SELECT shipit.append_tenancy_audit($1,$2,'service','synthetic','franchise.profile.update','franchise',$2,
    'profile_correction',$3,clock_timestamp(),'active','active',2)`,[org,franchise,randomUUID()]));
  for(const actor of ['SYN_FULL_ADDRESS 99 Test Road','x'.repeat(129)])await assert.rejects(owner.query(
    "SELECT shipit.append_security_denial('user',$1,'audit.read','audit','ACTION_FORBIDDEN',$2)",[actor,randomUUID()]));
  await assert.rejects(owner.query("SELECT shipit.append_security_denial('anonymous','anonymous','SYN_SECRET','audit','ACTION_FORBIDDEN',$1)",[randomUUID()]));
  await assert.rejects(owner.query("INSERT INTO shipit.audit_records(id,raw_payload) VALUES($1,$2)",[randomUUID(),'SYN_RAW_BODY']));
  assert.equal((await owner.query<{count:string}>('SELECT count(*) FROM shipit.audit_records')).rows[0]?.count,'0');
});
