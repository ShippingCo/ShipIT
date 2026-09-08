import assert from 'node:assert/strict';
import test from 'node:test';
import { createFakeClock, createFakeProvider, createProviderCallbackFixture, ProviderTimeout, verifySyntheticCallback } from './index.ts';
const request = { logical_ref: 'effect_synthetic_01', recipient_ref: 'recipient_synthetic_01' };

await test('provider acceptance, rejection and both uncertain timeout boundaries are observable', async () => {
  const provider = createFakeProvider(['accepted', 'rejected', 'timeout-before-acceptance', 'accept-then-timeout']);
  assert.equal((await provider.send(request)).status, 'accepted');
  assert.equal((await provider.send(request)).status, 'rejected');
  await assert.rejects(provider.send(request), ProviderTimeout);
  assert.equal(provider.accepted().length, 1);
  await assert.rejects(provider.send(request), ProviderTimeout);
  assert.equal(provider.accepted().length, 2);
  assert.equal(provider.accepted()[1]?.message_id, 'provider_message_synthetic_04');
  await assert.rejects(provider.send(request), /SCRIPT_EXHAUSTED/);
});
await test('duplicate callback deliveries retain exact signed bytes and logical identity', () => {
  const provider = createFakeProvider();
  const callback = createProviderCallbackFixture();
  provider.scheduleCallback('duplicate', callback);
  const deliveries = provider.drainCallbacks();
  assert.deepEqual(deliveries, [callback, callback]);
  assert.notEqual(deliveries[0], deliveries[1]);
  assert.equal(verifySyntheticCallback(deliveries[0]!), true);
  assert.deepEqual(provider.drainCallbacks(), []);
});
await test('delayed callback is released at fake-clock deadline without waiting', () => {
  const clock = createFakeClock();
  const provider = createFakeProvider([], clock);
  provider.scheduleCallback('delayed', createProviderCallbackFixture(), 60_000);
  clock.advance(59_999);
  assert.equal(provider.drainCallbacks().length, 0);
  clock.advance(1);
  assert.equal(provider.drainCallbacks().length, 1);
});
await test('synthetic signatures bind exact bytes; invalid and malformed signatures fail', () => {
  const callback = createProviderCallbackFixture();
  assert.equal(verifySyntheticCallback(callback), true);
  assert.equal(verifySyntheticCallback({ ...callback, body: callback.body + ' ' }), false);
  assert.equal(verifySyntheticCallback({ ...callback, signature: 'invalid_synthetic_signature' }), false);
  const provider = createFakeProvider();
  provider.scheduleCallback('invalid-signature', callback);
  assert.equal(verifySyntheticCallback(provider.drainCallbacks()[0]!), false);
});
await test('stale and unknown-version callbacks remain signed synthetic inputs for consumer rejection tests', () => {
  const stale = createProviderCallbackFixture({ occurred_at: '2026-09-07T12:00:00Z' });
  const unknown = createProviderCallbackFixture({ schema_version: 99 });
  assert.equal(verifySyntheticCallback(stale), true);
  assert.equal(verifySyntheticCallback(unknown), true);
  assert.equal(JSON.parse(stale.body).occurred_at, '2026-09-07T12:00:00Z');
  assert.equal(JSON.parse(unknown.body).schema_version, 99);
  const provider = createFakeProvider();
  provider.scheduleCallback('normal', stale);
  provider.scheduleCallback('normal', unknown);
  assert.deepEqual(provider.drainCallbacks(), [stale, unknown]);
});
