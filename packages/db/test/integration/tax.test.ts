import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { taxSetup, taxPolicy } from '../../../../apps/api/test/tax-support.ts';
import { org, A } from '../../../../apps/api/test/audit-support.ts';
import { provisionDatabase } from '../support.ts';

await test('Issue 20 upgrades forward to tax without changing existing roots and repeats as a no-op',{ timeout: 30000 },async t => {
  const db = await provisionDatabase(t); assert.deepEqual(await db.migrate({ count: 9 }),{ applied: 9 });
  const owner = db.ownerPool(); await owner.query("INSERT INTO shipit.organizations(id,display_name) VALUES($1,'Synthetic')",[org]);
  await owner.query("INSERT INTO shipit.franchises(id,organization_id,franchise_code,display_name) VALUES($1,$2,'MAIN','Synthetic')",[A,org]);
  const before = (await owner.query('SELECT * FROM shipit.franchises')).rows;
  assert.deepEqual(await db.migrate(),{ applied: 1 }); assert.deepEqual(await db.migrate(),{ applied: 0 });
  assert.deepEqual((await owner.query('SELECT * FROM shipit.franchises')).rows,before);
  assert.equal((await owner.query('SELECT count(*)::integer AS n FROM shipit.tax_versions')).rows[0]!.n,0);
});
await test('SQL independently enforces tax rates, reconciliation, creator binding and least privileges',{ timeout: 30000 },async t => {
  const s = await taxSetup(t); await s.published(); const prepared = await s.prepared();
  const calculated = (await s.post('calculations',{ intent_id: prepared.intent.id })).json(); const owner = s.db.ownerPool();
  for (const sql of ['SELECT * FROM shipit.tax_audit_events','DELETE FROM shipit.tax_intents','TRUNCATE shipit.tax_calculations',
    'UPDATE shipit.tax_commands SET fingerprint=fingerprint','UPDATE shipit.tax_cards SET publication_revision=0',
    'ALTER TABLE shipit.tax_versions DISABLE TRIGGER ALL']) await assert.rejects(s.pool.query(sql));
  for (const modification of [{ tax_total_paise: 1 },{ pre_tax_paise: 0.5 },{ rounding_adjustment_paise: 100 },{ components: [] }]) {
    const id = randomUUID(), result = { ...calculated,...modification,id };
    await assert.rejects(owner.query(`INSERT INTO shipit.tax_calculations(id,organization_id,franchise_id,actor_id,intent_id,policy_id,result)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,org,A,s.operator.id,prepared.intent.id,calculated.policy_id,result]));
  }
  const p = await s.tax.create(s.local.token,org,A,randomUUID(),taxPolicy,randomUUID());
  for (const rate of [0,-1,0.5,1_000_001]) {
    const malformed = structuredClone(taxPolicy); malformed.rules[0]!.components[0]!.numerator = rate;
    await assert.rejects(owner.query('UPDATE shipit.tax_versions SET policy=$2,revision=revision+1 WHERE id=$1',[p.id,malformed]));
  }
  const duplicate = { ...taxPolicy,rules: [...taxPolicy.rules,...taxPolicy.rules] };
  await assert.rejects(owner.query('UPDATE shipit.tax_versions SET policy=$2,revision=revision+1 WHERE id=$1',[p.id,duplicate]));
  const id = randomUUID(), result = { ...calculated,id };
  await assert.rejects(owner.query(`INSERT INTO shipit.tax_calculations(id,organization_id,franchise_id,actor_id,intent_id,policy_id,result)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,org,A,s.local.id,prepared.intent.id,calculated.policy_id,result]));
});
