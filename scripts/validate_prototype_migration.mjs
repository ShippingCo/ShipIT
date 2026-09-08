import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory, root } from './prototype-inventory.mjs';

const dispositions = new Set(['preserve', 'replace', 'demo_only', 'blocked']);
export function validate(fixture, observed) {
  assert.equal(fixture.synthetic_only, true);
  assert.deepEqual(fixture.inventory, observed, 'Source inventory drift: review changed behavior; do not blindly refresh evidence');
  const contracts = new Set(Object.keys(fixture.groups));
  const index = readFileSync(path.join(root, 'docs/ISSUE_INDEX.md'), 'utf8');
  for (const [id, group] of Object.entries(fixture.groups)) {
    assert(dispositions.has(group.disposition), `Disposition: ${id}`);
    for (const key of ['current', 'target', 'verification', 'retire_when']) assert(group[key]?.trim(), `${id}: ${key}`);
    assert(group.owners.length && group.rules.length, `${id}: ownership/rules`);
    for (const owner of group.owners) assert(index.includes(`[#${owner}]`), `${id}: unknown issue ${owner}`);
    for (const rule of group.rules) {
      const [file, anchor] = rule.split('#');
      const content = readFileSync(path.join(root, file), 'utf8');
      assert(content.length > 0 && (!anchor || content.includes(anchor)), `${id}: missing rule ${rule}`);
    }
  }
  const expectedExports = [...new Set([...observed.exports, ...observed.store_members])].sort();
  assert.deepEqual(Object.keys(fixture.exports).sort(), expectedExports, 'Every export and Store member needs a disposition');
  for (const group of Object.values(fixture.exports)) assert(contracts.has(group), 'Unknown export group');
  assert.deepEqual(Object.keys(fixture.callers).sort(), observed.consumers, 'Every transitive caller needs ownership');
  for (const groups of Object.values(fixture.callers)) {
    assert(groups.length && groups.every((group) => contracts.has(group)), 'Caller ownership');
  }
  assert.equal(fixture.regressions.length, observed.tests.length, 'Every test declaration needs a decision');
  fixture.regressions.forEach((row, i) => {
    assert.deepEqual({ file: row.file, name: row.name, cases: row.cases }, observed.tests[i]);
    assert(contracts.has(row.group) && dispositions.has(row.disposition) && row.reason?.trim(), 'Regression disposition');
  });
  for (const key of ['no_production_local_writes', 'no_automatic_import', 'demo_reset_unavailable',
    'late_scope_response_discarded', 'uncertain_retry_same_intent', 'no_otp_persistence']) {
    assert.equal(fixture.safety[key], true, key);
  }
  for (const name of ['revealOTP', 'confirmDelivered', 'updateStatus', 'placeOfSupply', 'MAX_ATTEMPTS', 'RTO_WINDOW_HOURS']) {
    assert.notEqual(fixture.groups[fixture.exports[name]].disposition, 'preserve', `Unsafe preservation: ${name}`);
  }
  assert.equal(fixture.scenarios.length, 12, 'Required scenario catalog');
  for (const scenario of fixture.scenarios) {
    assert(scenario.id && scenario.given && scenario.when && scenario.then && contracts.has(scenario.group));
  }
  const document = readFileSync(path.join(root, 'docs/architecture/prototype-migration-inventory.md'), 'utf8');
  for (const [name, group] of Object.entries(fixture.exports)) {
    assert(document.includes(`| ${name} | ${group} |`), `Export document drift: ${name}`);
  }
  for (const [name, groups] of Object.entries(fixture.callers)) {
    assert(document.includes(`| ${name} | ${groups.join(', ')} |`), `Caller document drift: ${name}`);
  }
  for (const row of fixture.regressions) {
    assert(document.includes(`| ${row.file}: ${row.name} | ${row.disposition} | ${row.group} |`), 'Test document drift');
  }
  for (const group of Object.values(fixture.groups)) {
    for (const key of ['current', 'target', 'verification', 'retire_when']) assert(document.includes(group[key]), 'Behavior document drift');
  }
  for (const scenario of fixture.scenarios) {
    for (const key of ['given', 'when', 'then']) assert(document.includes(scenario[key]), 'Scenario document drift');
  }
}

export function negativeControls(fixture, observed) {
  const mutations = [
    (f) => { delete f.exports.addBooking; },
    (f) => { f.exports.newUnreviewedExport = 'booking'; },
    (f) => { delete f.callers['apps/web/src/data/bot.ts']; },
    (f) => { f.regressions.pop(); },
    (f) => { f.groups.booking.owners = []; },
    (f) => { f.groups.booking.rules = ['missing-contract.md']; },
    (f) => { f.groups.proof.disposition = 'preserve'; },
    (f) => { f.safety.no_production_local_writes = false; },
    (f) => { f.safety.late_scope_response_discarded = false; },
    (f) => { f.inventory.store_members.push('unreviewed'); },
    (f) => { f.scenarios.pop(); },
  ];
  for (const mutate of mutations) {
    const broken = structuredClone(fixture); mutate(broken);
    assert.throws(() => validate(broken, observed), 'Broken contract unexpectedly accepted');
  }
  for (const key of ['exports', 'consumers', 'routes', 'tests', 'effects']) {
    const changed = structuredClone(observed); changed[key].push('new-source-evidence');
    assert.throws(() => validate(fixture, changed), `Undetected source drift: ${key}`);
  }
  const changed = structuredClone(observed);
  changed.fingerprints['apps/web/src/data/bot.ts'] = 'changed-direct-mutation';
  assert.throws(() => validate(fixture, changed), 'Undetected mutation drift');
  return mutations.length + 6;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fixture = JSON.parse(readFileSync(path.join(root, 'docs/architecture/fixtures/prototype-migration.json'), 'utf8'));
  const observed = inventory();
  validate(fixture, observed);
  const negatives = negativeControls(fixture, observed);
  console.log(`Prototype migration PASS: ${observed.exports.length} exports, ${observed.store_members.length} Store members, ${observed.consumers.length} callers, ${observed.routes.length} routes, ${observed.tests.length} test declarations; ${negatives} negative controls. Contract coverage only, not production behavior.`);
}
