import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { DatabaseError } from '../../src/index.ts';
import { provisionDatabase } from '../support.ts';
import { pricingSetup, draft } from '../../../../apps/api/test/pricing-support.ts';
import { org,A,B,C,otherOrg } from '../../../../apps/api/test/audit-support.ts';
await test('eight released migrations upgrade with existing tenant/customer/audit rows intact and repeat as no-op',{timeout:30000},async t=>{
  const db=await provisionDatabase(t);assert.deepEqual(await db.migrate({count:8}),{applied:8});const owner=db.ownerPool();
  await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic')",[org]);
  await owner.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'MAIN','Synthetic')",[A,org]);
  await owner.query("INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display,address) VALUES($1,$2,$3,'Synthetic','+12025550100','+12025550100','')",[randomUUID(),org,A]);
  const before=(await owner.query('SELECT * FROM shipit.customers')).rows,roots=(await owner.query('SELECT * FROM shipit.franchises')).rows;
  assert.deepEqual(await db.migrate(),{applied:1});assert.deepEqual(await db.migrate(),{applied:0});
  assert.deepEqual((await owner.query('SELECT * FROM shipit.customers')).rows,before);assert.deepEqual((await owner.query('SELECT * FROM shipit.franchises')).rows,roots);
  assert.equal((await owner.query('SELECT count(*)::integer AS n FROM shipit.pricing_cards')).rows[0]!.n,0);
});
await test('runtime cannot alter published content/ownership, history, privileges or trigger enforcement',{timeout:30000},async t=>{
  const s=await pricingSetup(t),v=await s.published(),pool=s.pool;
  const identity=(await pool.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0]!;
  assert.deepEqual(identity,{name:s.db.runtimeRole,rolsuper:false,rolbypassrls:false});
  const blocked=[
    "UPDATE shipit.pricing_versions SET override_tolerance_paise=0,revision=revision+1",
    "UPDATE shipit.pricing_versions SET effective_to='2100-01-01',revision=revision+1",
    "UPDATE shipit.pricing_versions SET state='draft',published_at=NULL,published_by=NULL,revision=revision+1",
    "UPDATE shipit.pricing_versions SET published_by=NULL,revision=revision+1",
    "UPDATE shipit.pricing_versions SET approval_ref='OTHER',revision=revision+1",
    'UPDATE shipit.pricing_versions SET version_number=2',
    `UPDATE shipit.pricing_versions SET franchise_id='${B}'`,
    'DELETE FROM shipit.pricing_versions','TRUNCATE shipit.pricing_versions',
    'UPDATE shipit.pricing_rules SET freight_paise=1','DELETE FROM shipit.pricing_rules','TRUNCATE shipit.pricing_rules',
    'UPDATE shipit.pricing_cards SET publication_revision=0','UPDATE shipit.pricing_cards SET id=gen_random_uuid()',
    'DELETE FROM shipit.pricing_quotes','TRUNCATE shipit.pricing_quotes',"UPDATE shipit.pricing_quotes SET result='{}'",
    'DELETE FROM shipit.pricing_commands','TRUNCATE shipit.pricing_commands',"UPDATE shipit.pricing_commands SET result='{}'",
    'SELECT * FROM shipit.pricing_audit_events','INSERT INTO shipit.pricing_audit_events(id) VALUES(gen_random_uuid())',
    'DELETE FROM shipit.pricing_audit_events','TRUNCATE shipit.pricing_audit_events',
    'ALTER TABLE shipit.pricing_versions DISABLE TRIGGER ALL','CREATE TABLE shipit.pricing_bypass(id uuid)',
    'ALTER FUNCTION shipit.guard_pricing_version() SECURITY INVOKER',`SET ROLE "${s.db.migrationRole}"`,
  ];
  for(const sql of blocked)await assert.rejects(pool.query(sql),e=>e instanceof DatabaseError&&e.code==='DB_QUERY_FAILED');
  await assert.rejects(pool.query(`INSERT INTO shipit.pricing_rules(id,organization_id,franchise_id,version_id,destination_key,service,min_weight_grams,max_weight_grams,freight_paise,packing_paise)
    VALUES($1,$2,$3,$4,'OTHER','express',1,NULL,1,0)`,[randomUUID(),org,A,v.id]),e=>e instanceof DatabaseError&&e.sqlState==='23514');
  assert.deepEqual(await s.pricing.read(s.local.token,org,A,v.id,randomUUID()),v);
});
await test('pricing composite owners and matching bounds enforced by PostgreSQL runtime',{timeout:30000},async t=>{
  const s=await pricingSetup(t),v=(await s.create()).json();
  await assert.rejects(s.pool.query('INSERT INTO shipit.pricing_cards(id,organization_id,franchise_id) VALUES($1,$2,$3)',[randomUUID(),org,C]),e=>e instanceof DatabaseError&&e.sqlState==='23503');
  const sql=`INSERT INTO shipit.pricing_rules(id,organization_id,franchise_id,version_id,destination_key,service,min_weight_grams,max_weight_grams,freight_paise,packing_paise)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
  for(const [o,f,min,max,freight,packing,service,destination] of [[org,B,1,null,1,0,'standard','SYN'],[otherOrg,C,1,null,1,0,'standard','SYN'],
    [org,A,0,null,1,0,'standard','SYN'],[org,A,1,1,1,0,'standard','SYN'],[org,A,1,null,-1,0,'standard','SYN'],
    [org,A,1,null,9007199254740991,1,'standard','SYN'],[org,A,1,null,1,0,'overnight','SYN'],[org,A,1,null,1,0,'standard','city']]) {
    await assert.rejects(s.pool.query(sql,[randomUUID(),o,f,v.id,destination,service,min,max,freight,packing]),e=>e instanceof DatabaseError&&['23503','23514'].includes(e.sqlState??''));
  }
  const raw=s.db.ownerPool();
  await assert.rejects(raw.query('UPDATE shipit.pricing_versions SET organization_id=$1,franchise_id=$2,revision=revision+1 WHERE id=$3',[otherOrg,C,v.id]),e=>e instanceof DatabaseError&&e.sqlState==='23514');
});
await test('database independently rejects equal-precedence overlap, direct published insertion and retroactive intervals',{timeout:30000},async t=>{
  const s=await pricingSetup(t),v=(await s.create({...draft,rules:[...draft.rules,draft.rules[0]]})).json();
  await assert.rejects(s.pool.query("SELECT shipit.append_pricing_audit($1,$2,$3,NULL,$4,'pricing.publish','policy_publication',1,$5)",[org,A,v.id,s.local.id,randomUUID()]),e=>e instanceof DatabaseError&&e.sqlState==='23514');
  const sql="UPDATE shipit.pricing_versions SET state='published',revision=revision+1,published_by=$2,published_at=clock_timestamp() WHERE id=$1";
  await assert.rejects(s.pool.query(sql,[v.id,s.local.id]),e=>e instanceof DatabaseError&&e.sqlState==='23514');
  assert.equal((await s.pool.query('SELECT state FROM shipit.pricing_versions WHERE id=$1',[v.id])).rows[0]!.state,'draft');
  assert.equal((await s.pool.query('SELECT publication_revision FROM shipit.pricing_cards WHERE id=$1',[v.card_id])).rows[0]!.publication_revision,'0');
  const back=(await s.create({...draft,effective_from:'2000-01-01T00:00:00Z',effective_to:'2001-01-01T00:00:00Z'})).json();
  await assert.rejects(s.pool.query(sql,[back.id,s.local.id]),e=>e instanceof DatabaseError&&e.sqlState==='23514');
  await assert.rejects(s.pool.query(`INSERT INTO shipit.pricing_versions(id,organization_id,franchise_id,card_id,version_number,state,effective_from,effective_to,quote_validity_seconds,override_tolerance_paise,approval_ref,source_ref,published_by,published_at)
    SELECT $1,organization_id,franchise_id,card_id,99,'published',effective_from,effective_to,quote_validity_seconds,override_tolerance_paise,approval_ref,source_ref,$2,clock_timestamp() FROM shipit.pricing_versions WHERE id=$3`,[randomUUID(),s.local.id,v.id]),e=>e instanceof DatabaseError&&e.sqlState==='23514');
});
