import assert from 'node:assert/strict';
import test from 'node:test';
import { atCommitBoundary, createFakeClock, createStaleVersionFixture, InjectedFailure } from './index.ts';

await test('fake clock now/advance/set is immediate, deterministic and defensive', () => {
  const clock = createFakeClock();
  const initial = clock.now().getTime();
  clock.now().setTime(0);
  assert.equal(clock.now().getTime(), initial);
  clock.advance(60_000);
  assert.equal(clock.now().getTime(), initial + 60_000);
  clock.set('2026-09-09T00:00:00Z');
  assert.equal(clock.now().toISOString(), '2026-09-09T00:00:00.000Z');
  assert.throws(() => clock.advance(-1), /INVALID_ADVANCE/);
  assert.throws(() => clock.advance(Infinity), /INVALID_ADVANCE/);
  assert.throws(() => clock.set('2026-09-09'), /INVALID_INSTANT/);
  assert.throws(() => clock.set('2026-02-30T00:00:00Z'), /INVALID_INSTANT/);
  assert.equal(clock.now().toISOString(), '2026-09-09T00:00:00.000Z');
});
await test('deadline equality can model expiry without sleep or actual challenge material', () => {
  const clock = createFakeClock();
  const expires = clock.now().getTime() + 600_000;
  clock.advance(599_999);
  assert.equal(clock.now().getTime() < expires, true);
  clock.advance(1);
  assert.equal(clock.now().getTime() < expires, false);
});
await test('commit-then-timeout awaits commit and retains committed evidence', async () => {
  const evidence: string[] = [];
  await assert.rejects(atCommitBoundary('commit-then-timeout', async () => {
    await Promise.resolve();
    evidence.push('business', 'audit', 'result', 'outbox');
    return 'committed-result';
  }), (error: unknown) => error instanceof InjectedFailure && error.point === 'commit-then-timeout');
  assert.deepEqual(evidence, ['business', 'audit', 'result', 'outbox']);
});
await test('failure-before-commit invokes no persistence; success and real commit failures propagate', async () => {
  let commits = 0;
  const commit = async () => { commits++; return 'result'; };
  await assert.rejects(atCommitBoundary('failure-before-commit', commit),
    (error: unknown) => error instanceof InjectedFailure && error.point === 'failure-before-commit');
  assert.equal(commits, 0);
  assert.equal(await atCommitBoundary('none', commit), 'result');
  assert.equal(commits, 1);
  const failure = new Error('SYNTHETIC_COMMIT_FAILED');
  await assert.rejects(atCommitBoundary('commit-then-timeout', () => Promise.reject(failure)), error => error === failure);
});
await test('stale expected N versus actual N+1 rejects overflow and invalid versions', () => {
  assert.deepEqual(createStaleVersionFixture(7), { expected_version: 7, actual_version: 8 });
  for (const value of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createStaleVersionFixture(value), /OUT_OF_RANGE/);
  }
});
