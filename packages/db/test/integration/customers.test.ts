import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseError } from '../../src/index.ts';
import { provisionDatabase } from '../support.ts';
const org='00000000-0000-4000-8000-000000000001',otherOrg='00000000-0000-4000-8000-000000000002',
  A='00000000-0000-4000-8000-000000000011',B='00000000-0000-4000-8000-000000000012',C='00000000-0000-4000-8000-000000000021';
const values=[A,org,'Synthetic Contact','+12025550100','+1 202-555-0100','19 Synthetic Lane'];
const insert=`INSERT INTO shipit.customers(id,franchise_id,organization_id,name,phone_normalized,phone_display,address) VALUES($1,$2,$3,$4,$5,$6,$7)`;
async function seed(db:Awaited<ReturnType<typeof provisionDatabase>>) {
  await db.prepareCustomers();const pool=db.runtimePool();
  for(const id of [org,otherOrg])await pool.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic Organization')",[id]);
  for(const [id,organization,code] of [[A,org,'A1'],[B,org,'A2'],[C,otherOrg,'B1']])await pool.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,$3,'Synthetic Franchise')",[id,organization,code]);
  return pool;
}
await test('customer composite ownership, same-phone nonuniqueness and database validation are enforced',{timeout:30000},async t=>{
  const db=await provisionDatabase(t),pool=await seed(db);
  for(const [franchise,organization] of [[A,org],[A,org],[B,org],[C,otherOrg]])await pool.query(insert,[randomUUID(),franchise,organization,...values.slice(2)]);
  assert.equal((await pool.query<{n:number}>('SELECT count(*)::integer AS n FROM shipit.customers')).rows[0]!.n,4);
  await assert.rejects(pool.query(insert,[randomUUID(),C,org,...values.slice(2)]),e=>e instanceof DatabaseError&&e.sqlState==='23503');
  for(const [name,normalized,display,address] of [['',values[3],values[4],values[5]],['n'.repeat(121),values[3],values[4],values[5]],
    [' Synthetic',values[3],values[4],values[5]],['\u00a0Synthetic',values[3],values[4],values[5]],['Synthetic\n',values[3],values[4],values[5]],
    ['Synthetic\u0085',values[3],values[4],values[5]],['Synthetic','2025550100','2025550100',''],
    ['Synthetic',values[3],'+12025550101',''],['Synthetic',values[3],values[4],'a'.repeat(501)],['Synthetic',values[3],values[4],'Address\n']]) {
    await assert.rejects(pool.query(insert,[randomUUID(),A,org,name,normalized,display,address]),e=>e instanceof DatabaseError&&e.sqlState==='23514');
  }
  const runtime=(await pool.query<{name:string;superuser:boolean;bypass:boolean}>(`SELECT current_user AS name,rolsuper AS superuser,rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`)).rows[0]!;
  assert.deepEqual(runtime,{name:db.runtimeRole,superuser:false,bypass:false});
});
await test('runtime cannot change Customer identity, delete/truncate, rewrite receipts/audit or own schema',{timeout:30000},async t=>{
  const db=await provisionDatabase(t),pool=await seed(db),id=randomUUID();await pool.query(insert,[id,...values]);
  for(const statement of ["UPDATE shipit.customers SET id=gen_random_uuid()",`UPDATE shipit.customers SET organization_id='${otherOrg}'`,
    `UPDATE shipit.customers SET franchise_id='${B}'`,"UPDATE shipit.customers SET created_at=clock_timestamp()",
    'DELETE FROM shipit.customers','TRUNCATE shipit.customers','ALTER TABLE shipit.customers DISABLE TRIGGER ALL',
    'ALTER TABLE shipit.customers DROP CONSTRAINT customers_franchise_owner_fk','DROP TABLE shipit.customers',
    'CREATE TABLE shipit.customer_bypass(id uuid)',`ALTER TABLE shipit.customers OWNER TO "${db.runtimeRole}"`,
    'DELETE FROM shipit.customer_commands','TRUNCATE shipit.customer_commands',"UPDATE shipit.customer_commands SET result='{}'",
    'SELECT * FROM shipit.customer_audit_events','INSERT INTO shipit.customer_audit_events(id) VALUES(gen_random_uuid())',
    'UPDATE shipit.customer_audit_events SET committed_version=2','DELETE FROM shipit.customer_audit_events','TRUNCATE shipit.customer_audit_events',
    'UPDATE shipit.audit_history SET committed_version=3','DELETE FROM shipit.audit_history',
    'ALTER FUNCTION shipit.append_customer_audit(uuid,uuid,uuid,uuid,text,integer,uuid) SECURITY INVOKER',
    `SET ROLE "${db.migrationRole}"`])await assert.rejects(pool.query(statement),e=>e instanceof DatabaseError&&e.code==='DB_QUERY_FAILED');
  const owner=db.ownerPool();
  for(const sql of [`UPDATE shipit.customers SET franchise_id='${B}'`, `UPDATE shipit.customers SET organization_id='${otherOrg}',franchise_id='${C}'`,
    'UPDATE shipit.customers SET id=gen_random_uuid()',"UPDATE shipit.customers SET created_at=clock_timestamp()+interval '1 day'"]) {
    await assert.rejects(owner.query(sql),e=>e instanceof DatabaseError&&e.sqlState==='23514');
  }
  const fn=(await owner.query<{definer:boolean;config:string[]}>("SELECT prosecdef AS definer,proconfig AS config FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='shipit' AND p.proname='append_customer_audit'")).rows[0]!;
  assert.equal(fn.definer,true);assert.deepEqual(fn.config,['search_path=pg_catalog']);
});
await test('released seven-migration main upgrades without altering old facts, repeats, and retains immutable contact data',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:7}),{applied:7});const owner=db.ownerPool();
  await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic')",[org]);
  await owner.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'MAIN','Synthetic')",[A,org]);
  await owner.query("SELECT shipit.append_tenancy_audit($1,$2,'service','synthetic','franchise.profile.update','franchise',$2,'profile_correction',$3,clock_timestamp(),'active','active',2)",[org,A,randomUUID()]);
  const before=(await owner.query('SELECT * FROM shipit.audit_history')).rows;
  assert.deepEqual(await db.migrate(),{applied:3});assert.deepEqual((await owner.query('SELECT * FROM shipit.audit_history')).rows,before);
  await owner.query(insert,[randomUUID(),...values]);assert.deepEqual(await db.migrate(),{applied:0});
  assert.equal((await owner.query<{n:number}>('SELECT count(*)::integer AS n FROM shipit.customers')).rows[0]!.n,1);
});
await test('representative phone/name prefix and deterministic ordering plans use tenant-leading indexes',{timeout:30000},async t=>{
  const db=await provisionDatabase(t),pool=await seed(db),owner=db.ownerPool();
  for(const [organization,franchise] of [[org,A],[org,B],[otherOrg,C]])await owner.query(`INSERT INTO shipit.customers
    (id,organization_id,franchise_id,name,phone_normalized,phone_display,address,created_at)
    SELECT gen_random_uuid(),$1,$2,'Synthetic '||lpad(n::text,5,'0'),'+120255'||lpad(n::text,5,'0'),'+120255'||lpad(n::text,5,'0'),'',
      '2026-09-12T00:00:00Z'::timestamptz FROM generate_series(1,3000) n`,[organization,franchise]);
  await owner.query('ANALYZE shipit.customers');
  for(const [column,prefix,index] of [['phone_normalized','+12025500100','customers_phone_prefix_idx'],['name','Synthetic 00100','customers_name_prefix_idx']] as const) {
    const result=await pool.query(`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM shipit.customers WHERE organization_id=$1 AND franchise_id=$2 AND ${column} LIKE $3 ORDER BY created_at,id LIMIT 3`,[org,A,prefix+'%']);
    const plan=JSON.stringify(result.rows);assert.ok(plan.includes(index),plan);assert.ok(plan.includes('organization_id'));assert.ok(plan.includes('franchise_id'));
  }
  const order=JSON.stringify((await pool.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM shipit.customers WHERE organization_id=$1 AND franchise_id=$2 ORDER BY created_at,id LIMIT 3',[org,A])).rows);
  assert.ok(order.includes('customers_order_idx'));
  const count=(await pool.query<{n:number}>('SELECT count(*)::integer AS n FROM shipit.customers WHERE organization_id=$1 AND franchise_id=$2 AND phone_normalized LIKE $3',[org,A,'+120255001%'])).rows[0]!.n;
  assert.equal(count,100);
});
