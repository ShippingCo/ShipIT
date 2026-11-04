import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseError, type DatabasePool } from '@shippingco/db';
import { scopedQuery, assertTenantAccess, type TenantAccess } from '../../src/modules/security/scope.ts';
import { taxSetup, taxPolicy, taxFacts, taxPath } from '../tax-support.ts';
import { org, A, B, otherOrg, C } from '../audit-support.ts';
import { withTaxTenantScope } from '../../src/modules/memberships/service.ts';
import { validateTaxSnapshot } from '../../src/modules/tax/service.ts';
import { createTaxService } from '../../src/modules/tax/service.ts';

function faulty(pool: DatabasePool, point: string): DatabasePool {
  return { ...pool,async connect() {
    const client = await pool.connect();
    return { release: discard => client.release(discard),async query<Row extends Record<string,unknown>>(sql: string, params?: readonly unknown[]) {
      const result = await client.query<Row>(sql,params); if (sql.includes(point)) throw new DatabaseError('DB_CONNECTION_FAILED'); return result;
    } };
  } };
}

await test('tax proposal persists, replays concurrent retries, reconciles and excludes protected facts',{ timeout: 30000 },async t => {
  const s = await taxSetup(t); await s.published(); const { intent } = await s.prepared(); const key = randomUUID();
  const responses = await Promise.all([s.post('calculations',{ intent_id: intent.id },s.operator.token,key),s.post('calculations',{ intent_id: intent.id },s.operator.token,key)]);
  assert.deepEqual(responses.map(r => r.statusCode),[200,200]); const result = responses[0]!.json(); assert.deepEqual(responses[1]!.json(),result);
  assert.equal(result.pre_tax_paise,12800); assert.equal(result.tax_total_paise,640); assert.equal(result.final_payable_paise,13400); assert.equal(result.rounding_adjustment_paise,-40);
  assert.equal(result.cgst_paise+result.sgst_paise+result.igst_paise,result.tax_total_paise);
  const restarted = createTaxService(s.pool,s.clock); assert.deepEqual(await restarted.readCalculation(s.operator.token,org,A,result.id,randomUUID()),result);
  s.setNow('2099-01-01T01:00:00Z'); assert.deepEqual((await s.post('calculations',{ intent_id: intent.id },s.operator.token,key)).json(),result);
  assert.equal((await s.post('calculations',{ intent_id: intent.id })).json().error.code,'TAX_STALE');
  const history = await s.list(s.local.token,{ resource_type: 'tax' }); assert.equal(history.statusCode,200,history.body); assert.equal(history.json().items.length,4);
  const audits = JSON.stringify((await s.db.adminQuery('SELECT * FROM shipit.tax_audit_events')).rows);
  for (const secret of [s.operator.token,taxPolicy.supplier_gstin,taxFacts.service_recipient_ref,taxFacts.evidence_ref!]) {
    assert.ok(!audits.includes(secret)); assert.ok(!s.logs.join('').includes(secret)); assert.ok(!JSON.stringify(result).includes(secret));
  }
});
await test('unknown jurisdiction blocks; only the local administrator resolves immutable evidence',{ timeout: 30000 },async t => {
  const s = await taxSetup(t), policy = await s.published(); const { intent } = await s.prepared({ ...taxFacts,handover_state: null });
  const missing = await s.post('calculations',{ intent_id: intent.id }); assert.equal(missing.statusCode,422);
  assert.deepEqual(missing.json().error.details,[{ field: 'tax.jurisdiction',code: 'REQUIRED' }]);
  const body = { intent_id: intent.id,policy_id: policy.id,facts: taxFacts,evidence_ref: 'SYN_RESOLUTION' };
  assert.equal((await s.post('jurisdiction-resolutions',body)).statusCode,403);
  const resolved = await s.post('jurisdiction-resolutions',body,s.local.token); assert.equal(resolved.statusCode,200,resolved.body);
  assert.equal((await s.post('jurisdiction-resolutions',body,s.local.token)).json().error.code,'TAX_CONFLICT');
  const calc = await s.post('calculations',{ intent_id: intent.id,resolution_id: resolved.json().id }); assert.equal(calc.statusCode,200,calc.body);
  const another = await s.prepared({ ...taxFacts,handover_state: null });
  assert.equal((await s.post('calculations',{ intent_id: another.intent.id,resolution_id: resolved.json().id })).statusCode,404);
});
await test('role ceiling, sibling tenant, foreign nested IDs and creator binding remain enforced',{ timeout: 30000 },async t => {
  const s = await taxSetup(t), policy = await s.published(), prepared = await s.prepared();
  const sibling = await s.grant('operator',[B]), foreign = await s.beta(), accountant = await s.grant('accountant',[A]);
  const body = { intent_id: prepared.intent.id };
  for (const [actor,franchise,organization] of [[sibling,B,org],[foreign,C,otherOrg]] as const) {
    const response = await s.post('calculations',body,actor.token,randomUUID(),franchise,organization); assert.equal(response.statusCode,404,response.body);
  }
  assert.equal((await s.post('calculations',body,s.local.token)).statusCode,404);
  assert.equal((await s.post('calculations',body,accountant.token)).statusCode,403);
  for (const role of ['delivery_agent','read_only']) {
    const actor = await s.grant(role,[A]);
    assert.equal((await s.app.inject({ url: taxPath(),cookies: s.cookies(actor.token) })).statusCode,403);
    assert.equal((await s.post('calculations',body,actor.token)).statusCode,403);
  }
  const effective = await s.app.inject({ url: taxPath(),cookies: s.cookies(accountant.token) }); assert.equal(effective.statusCode,200); assert.ok(!effective.body.includes(taxPolicy.supplier_gstin));
  assert.equal((await s.app.inject({ url: taxPath()+'/'+policy.id,cookies: s.cookies(accountant.token) })).statusCode,403);
  assert.equal((await s.app.inject({ url: '/api/v1/tax/intents/'+prepared.intent.id+'/resolution-context?organization_id='+org+'&franchise_id='+A,cookies: s.cookies(s.operator.token) })).statusCode,403);
  const tampered = { ...prepared.body,quote_id: randomUUID() }; assert.equal((await s.post('intents',tampered)).statusCode,404);
});
await test('same-transaction confirmation validates trusted timing and rejects stale or changed inputs',{ timeout: 30000 },async t => {
  const s = await taxSetup(t); await s.published(); const prepared = await s.prepared(); const result = (await s.post('calculations',{ intent_id: prepared.intent.id })).json();
  const timing = { source: 'trusted-contemporaneous-records' as const,evidenceRef: 'SYN_TRUSTED_RECORDS',serviceAt: s.clock(),invoiceAt: s.clock(),paymentAt: null };
  const validate = (body = prepared.body,evidence: typeof timing|undefined = timing) => withTaxTenantScope(s.pool,s.operator.token,org,A,'tax.validate',randomUUID(),scopes => validateTaxSnapshot(scopes,result.id,body,evidence,s.clock()));
  assert.deepEqual(await validate(),result);
  const owner = s.db.ownerPool();
  await owner.query('CREATE TABLE shipit.tax_confirmation_probe(id uuid PRIMARY KEY,organization_id uuid NOT NULL,franchise_id uuid NOT NULL,snapshot jsonb NOT NULL)');
  await owner.query(`GRANT SELECT,INSERT ON shipit.tax_confirmation_probe TO "${s.db.runtimeRole}"`);
  let expired: TenantAccess|undefined;
  await assert.rejects(withTaxTenantScope(s.pool,s.operator.token,org,A,'tax.validate',randomUUID(),async scopes => {
    expired = scopes.tax;
    const snapshot = await validateTaxSnapshot(scopes,result.id,prepared.body,timing,s.clock());
    await scopedQuery(scopes.tax,['tax.validate'],`INSERT INTO shipit.tax_confirmation_probe(id,organization_id,franchise_id,snapshot)
      SELECT $1,{{organization}},$2,$3 WHERE {{franchise:$4:$2}}`,[randomUUID(),A,snapshot,org]);
    throw new Error('SYN_BOOKING_WRITE_FAILED');
  }));
  assert.equal((await owner.query('SELECT count(*)::integer AS n FROM shipit.tax_confirmation_probe')).rows[0]!.n,0);
  assert.throws(() => assertTenantAccess(expired!),{ code: 'ACTION_FORBIDDEN' });
  await assert.rejects(withTaxTenantScope(s.pool,s.operator.token,org,A,'tax.validate',randomUUID(),scopes => validateTaxSnapshot(scopes,result.id,prepared.body,undefined,s.clock())),{ code: 'TAX_TIME_UNSUPPORTED' });
  await assert.rejects(validate({ ...prepared.body,facts: { ...taxFacts,service_recipient_ref: 'SYN_DIFFERENT_BUYER' } }),{ code: 'TAX_STALE' });
  await assert.rejects(validate(prepared.body,{ ...timing,invoiceAt: new Date('2098-12-31T23:59:59Z') }),{ code: 'TAX_TIME_UNSUPPORTED' });
  s.setNow('2099-01-01T00:05:00Z'); await assert.rejects(validate(),{ code: 'TAX_STALE' });
});

await test('state and command/audit faults roll back; lost commit acknowledgement replays exactly once',{ timeout: 30000 },async t => {
  const s = await taxSetup(t); await s.published(); const prepared = await s.prepared();
  const counts = async () => (await s.db.adminQuery(`SELECT (SELECT count(*)::integer FROM shipit.tax_calculations) AS calculations,
    (SELECT count(*)::integer FROM shipit.tax_commands) AS commands,(SELECT count(*)::integer FROM shipit.tax_audit_events) AS audits`)).rows[0];
  for (const point of ['INSERT INTO shipit.tax_calculations','INSERT INTO shipit.tax_commands']) {
    const before = await counts();
    const bad = createTaxService(faulty(s.pool,point),s.clock);
    await assert.rejects(bad.calculate(s.operator.token,org,A,randomUUID(),{ intent_id: prepared.intent.id },randomUUID()),{ code: 'TEMPORARILY_UNAVAILABLE' });
    assert.deepEqual(await counts(),before);
  }
  const key = randomUUID(), lost = createTaxService(faulty(s.pool,'COMMIT'),s.clock);
  await assert.rejects(lost.calculate(s.operator.token,org,A,key,{ intent_id: prepared.intent.id },randomUUID()),{ code: 'TEMPORARILY_UNAVAILABLE' });
  const replay = await s.tax.calculate(s.operator.token,org,A,key,{ intent_id: prepared.intent.id },randomUUID());
  assert.equal(replay.tax_total_paise,640); assert.equal((await counts())!.calculations,1);
  assert.deepEqual(await s.tax.calculate(s.operator.token,org,A,key,{ intent_id: prepared.intent.id },randomUUID()),replay);
  await assert.rejects(s.tax.calculate(s.operator.token,org,A,key,{ intent_id: prepared.intent.id,resolution_id: randomUUID() },randomUUID()),{ code: 'IDEMPOTENCY_CONFLICT' });
});

await test('M07 future policy and new runtime pool cannot alter historical proposal; revoked authority cannot replay',{ timeout: 30000 },async t => {
  const s = await taxSetup(t); await s.published(); const prepared = await s.prepared(), key = randomUUID();
  const original = await s.tax.calculate(s.operator.token,org,A,key,{ intent_id: prepared.intent.id },randomUUID());
  const next = structuredClone(taxPolicy); next.effective_from = '2099-01-02T00:00:00Z'; next.effective_to = '2099-01-03T00:00:00Z';
  next.rules[0]!.components.forEach(c => { c.denominator = 20; });
  const draft = await s.tax.create(s.local.token,org,A,randomUUID(),next,randomUUID());
  await s.tax.publish(s.local.token,org,A,draft.id,randomUUID(),{ expected_version: 1 },randomUUID());
  const restarted = createTaxService(s.db.runtimePool(),s.clock);
  assert.deepEqual(await restarted.readCalculation(s.operator.token,org,A,original.id,randomUUID()),original);
  s.setNow(next.effective_from); assert.equal((await restarted.effective(s.operator.token,org,A,randomUUID())).id,draft.id);
  assert.deepEqual(await restarted.readCalculation(s.operator.token,org,A,original.id,randomUUID()),original);
  await s.memberships.revokeMembership(s.admin.token,s.operator.member.id,{ expected_version: s.operator.member.version });
  await assert.rejects(restarted.calculate(s.operator.token,org,A,key,{ intent_id: prepared.intent.id },randomUUID()),{ code: 'RESOURCE_NOT_FOUND' });
});
await test('SQL immutability, stale draft updates, overlaps and outage fail closed',{ timeout: 30000 },async t => {
  const s = await taxSetup(t); const policy = await s.published(); const prepared = await s.prepared(); const result = (await s.post('calculations',{ intent_id: prepared.intent.id })).json();
  const owner = s.db.ownerPool();
  await assert.rejects(owner.query('UPDATE shipit.tax_calculations SET result=result WHERE id=$1',[result.id]));
  await assert.rejects(owner.query('UPDATE shipit.tax_versions SET revision=revision+1 WHERE id=$1',[policy.id]));
  s.setNow('2098-12-31T23:00:00Z'); const overlap = await s.tax.create(s.local.token,org,A,randomUUID(),taxPolicy,randomUUID());
  await assert.rejects(s.tax.publish(s.local.token,org,A,overlap.id,randomUUID(),{ expected_version: 1 },randomUUID()),{ code: 'TAX_CONFLICT' });
  await assert.rejects(s.tax.replace(s.local.token,org,A,overlap.id,randomUUID(),{ expected_version: 2,policy: taxPolicy },randomUUID()),{ code: 'VERSION_CONFLICT' });
  await s.db.setAvailable(false);
  try { const failed = await s.post('calculations',{ intent_id: prepared.intent.id }); assert.equal(failed.statusCode,503); assert.ok(!/select|password|stack/i.test(failed.body)); }
  finally { await s.db.setAvailable(true); }
});

await test('business GST saves immediately, covers Haryana and all services, and preserves paise',{timeout:30000},async t=>{
 const s=await taxSetup(t);await s.published();
 const input={mode:'courier18',supplier_state:'27',supplier_gstin:'27ABCDE1234F1Z5',expected_version:1};
 const path=taxPath().replace('/versions','/settings'),key=randomUUID();
 const save=()=>s.app.inject({method:'POST',url:path,headers:{...s.headers,'idempotency-key':key},cookies:s.cookies(s.local.token),payload:input});
 const [a,b]=await Promise.all([save(),save()]);assert.equal(a.statusCode,200,a.body);assert.deepEqual(a.json(),b.json());
 assert.equal(a.json().mode,'courier18');
 const current=await s.tax.effective(s.operator.token,org,A,randomUUID());assert.equal(current.rules.length,12);
 for(const rule of current.rules)assert.equal(rule.components.reduce((n,c)=>n+c.numerator/c.denominator,0),0.18);
 const {intent}=await s.prepared({...taxFacts,handover_state:'06'});
 const calculated=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
 assert.equal(calculated.jurisdiction,'inter');assert.equal(calculated.igst_paise,Math.round(calculated.pre_tax_paise*0.18));
 assert.equal(calculated.final_payable_paise,calculated.pre_tax_paise+calculated.tax_total_paise);assert.equal(calculated.rounding_adjustment_paise,0);
 assert.equal((await s.db.adminQuery("SELECT count(*)::int AS n FROM shipit.tax_commands WHERE operation='configure'")).rows[0]!.n,1);
 assert.ok(!(await s.app.inject({url:path,cookies:s.cookies(s.operator.token)})).body.includes(input.supplier_gstin));
});
await test('GST preference changes are versioned, authorized and leave saved calculations immutable',{timeout:30000},async t=>{
 const s=await taxSetup(t);await s.published();
 const input={mode:'courier18',supplier_state:'27',supplier_gstin:'27ABCDE1234F1Z5',expected_version:1};
 const configure=(body=input,token=s.local.token,franchise=A)=>s.tax.configure(token,org,franchise,randomUUID(),body,randomUUID());
 await assert.rejects(configure(input,s.operator.token),{code:'ACTION_FORBIDDEN'});
 await assert.rejects(configure(input,s.local.token,B),{code:'RESOURCE_NOT_FOUND'});
 const first=await configure();const {intent}=await s.prepared();const calculation=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
 await assert.rejects(configure({...input,mode:'gta5'}),{code:'VERSION_CONFLICT'});
 const next=await configure({...input,mode:'gta5',supplier_gstin:'',expected_version:first.version});
 assert.equal(next.version,first.version+1);assert.equal((await s.tax.settings(s.operator.token,org,A,randomUUID())).mode,'gta5');
 assert.deepEqual(await s.tax.readCalculation(s.operator.token,org,A,calculation.id,randomUUID()),calculation);
 await assert.rejects(s.db.adminQuery('UPDATE shipit.tax_versions SET policy=policy,revision=revision+1 WHERE id=$1',[first.id]));
});
await test('first GST setup is atomic and concurrent changes cannot silently replace each other',{timeout:30000},async t=>{
 const s=await taxSetup(t);
 assert.deepEqual(await s.tax.settings(s.operator.token,org,A,randomUUID()),{id:null,mode:null,supplier_state:'',version:0});
 const input={mode:'courier18',supplier_state:'27',supplier_gstin:'27ABCDE1234F1Z5',expected_version:0};
 const outcomes=await Promise.allSettled([1,2].map(()=>s.tax.configure(s.local.token,org,A,randomUUID(),input,randomUUID())));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
 const rejected=outcomes.find(r=>r.status==='rejected');assert.equal(rejected?.status==='rejected'&&rejected.reason.code,'VERSION_CONFLICT');
 const current=await s.tax.settings(s.local.token,org,A,randomUUID());assert.equal(current.version,1);
 await s.tax.configure(s.local.token,org,A,randomUUID(),{...input,mode:'none',supplier_gstin:'',expected_version:1},randomUUID());
 const rules=(await s.tax.effective(s.operator.token,org,A,randomUUID())).rules;
 assert.equal(rules.length,12);assert.ok(rules.every(r=>r.treatment==='exempt'&&r.components.length===0));
});

await test('two parcels save with entered charges and 18 percent GST without any published pricing',{timeout:30000},async t=>{
 const s=await taxSetup(t);await s.db.prepareBookings();
 const {createCustomerService}=await import('../../src/modules/customers/service.ts');
 const {createBookingService}=await import('../../src/modules/bookings/service.ts');
 const {contact}=await import('../customer-support.ts');
 const customer=await createCustomerService(s.pool,s.keys.browser).create(s.operator.token,org,A,randomUUID(),contact,randomUUID());
 await s.tax.configure(s.local.token,org,A,randomUUID(),{mode:'courier18',supplier_state:'27',supplier_gstin:taxPolicy.supplier_gstin,expected_version:0},randomUUID());
 const pricing_input={destination_key:'NEW_CITY',service:'express' as const,weight_grams:6500,charges:{freight_paise:15000,packing_paise:3000}};
 const quote=await s.pricing.quote(s.operator.token,org,A,randomUUID(),pricing_input,randomUUID());
 const tax_intent={quote_id:quote.id,pricing_input,facts:{...taxFacts,handover_state:'06'}};
 const intent=await s.tax.prepare(s.operator.token,org,A,randomUUID(),tax_intent,randomUUID());
 const tax=await s.tax.calculate(s.operator.token,org,A,randomUUID(),{intent_id:intent.id},randomUUID());
 assert.equal(tax.final_payable_paise,21240);assert.equal(tax.igst_paise,3240);
 const service=createBookingService(s.pool,s.keys.browser,s.clock),key=randomUUID();
 const body={customer_id:customer.id,expected_customer_version:customer.version,tax_calculation_id:tax.id,tax_intent,
 parcels:[{docket:'ENTERED-A',weight_grams:3000,recipient:{address:'21 Fictional Street'}},{docket:'ENTERED-B',weight_grams:3500,recipient:{address:'21 Fictional Street'}}]};
 const booking=await service.create(s.operator.token,org,A,key,body,randomUUID());
 assert.equal(booking.parcels.length,2);assert.equal(booking.payment_obligation.total_paise,21240);
 assert.deepEqual(booking.charges.pricing.inputs.charges,pricing_input.charges);
 assert.deepEqual(await service.create(s.operator.token,org,A,key,body,randomUUID()),booking);
 assert.equal((await s.db.adminQuery('SELECT count(*)::int n FROM shipit.pricing_versions')).rows[0]!.n,0);
});
