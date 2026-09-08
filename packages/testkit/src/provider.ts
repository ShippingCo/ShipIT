import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from './clock.ts';
import { createFakeClock } from './clock.ts';
import { fixtureInstant, replayFixture } from './fixtures.ts';

// Public fictional key, ONLY for this synthetic protocol. Never an operational secret.
const syntheticKey = 'SHIPIT_PUBLIC_SYNTHETIC_CALLBACK_KEY_NOT_A_CREDENTIAL';
export type ProviderOutcome = 'accepted' | 'rejected' | 'timeout-before-acceptance' | 'accept-then-timeout';
export type CallbackCase = 'normal' | 'duplicate' | 'delayed' | 'invalid-signature';
export interface ProviderRequest { logical_ref: string; recipient_ref: string }
export interface FakeProviderPort {
  send(request: ProviderRequest): Promise<{ status: 'accepted' | 'rejected'; message_id: string }>;
}
export class ProviderTimeout extends Error {
  constructor() { super('SYNTHETIC_PROVIDER_TIMEOUT'); }
}
function sign(body: string): string { return createHmac('sha256', syntheticKey).update(body).digest('hex'); }
export function createProviderCallbackFixture(overrides: Partial<{
  provider_event_id: string; provider_message_id: string; occurred_at: string; schema_version: number;
  organization_id: string; franchise_id: string;
}> = {}) {
  const payload = { provider: 'synthetic', installation_ref: 'installation_synthetic_01',
    provider_event_id: 'provider_event_synthetic_01', provider_message_id: 'provider_message_synthetic_01',
    organization_id: '00000000-0000-4000-8000-000000000001',
    franchise_id: '00000000-0000-4000-8000-000000000011',
    occurred_at: fixtureInstant, schema_version: 1, status: 'accepted', ...overrides };
  const body = JSON.stringify(payload);
  return { body, signature: sign(body) };
}
export type SyntheticCallback = ReturnType<typeof createProviderCallbackFixture>;
// Proves raw-byte tampering in the synthetic protocol only, not Meta/carrier compatibility.
export function verifySyntheticCallback(callback: SyntheticCallback): boolean {
  if (!/^[a-f0-9]{64}$/.test(callback.signature)) return false;
  return timingSafeEqual(Buffer.from(sign(callback.body), 'hex'), Buffer.from(callback.signature, 'hex'));
}
export function createFakeProvider(outcomes: readonly ProviderOutcome[] = ['accepted'], clock: Clock = createFakeClock()) {
  const script = [...outcomes];
  const accepted: { request: ProviderRequest; message_id: string }[] = [];
  const pending: { due: number; callback: SyntheticCallback }[] = [];
  let attempts = 0;
  return {
    async send(request: ProviderRequest) {
      const outcome = script[attempts++];
      if (!outcome) throw new Error('SYNTHETIC_PROVIDER_SCRIPT_EXHAUSTED');
      const message_id = `provider_message_synthetic_${String(attempts).padStart(2, '0')}`;
      if (outcome === 'timeout-before-acceptance') throw new ProviderTimeout();
      if (outcome === 'rejected') return { status: 'rejected' as const, message_id };
      accepted.push({ request: replayFixture(request), message_id });
      if (outcome === 'accept-then-timeout') throw new ProviderTimeout();
      return { status: 'accepted' as const, message_id };
    },
    // Test-side evidence. The consumer receives the same uncertainty for both timeouts.
    accepted: () => replayFixture(accepted),
    scheduleCallback(kind: CallbackCase = 'normal', callback = createProviderCallbackFixture(), delayMs = 1000) {
      if (!Number.isSafeInteger(delayMs) || delayMs < 0) throw new Error('SYNTHETIC_CALLBACK_INVALID_DELAY');
      const copy = replayFixture(callback);
      if (kind === 'invalid-signature') copy.signature = '0'.repeat(64);
      const due = clock.now().getTime() + (kind === 'delayed' ? delayMs : 0);
      pending.push({ due, callback: copy });
      if (kind === 'duplicate') pending.push({ due, callback: replayFixture(copy) });
    },
    drainCallbacks(): SyntheticCallback[] {
      const ready = pending.filter((item) => item.due <= clock.now().getTime());
      for (const item of ready) pending.splice(pending.indexOf(item), 1);
      return ready.map((item) => replayFixture(item.callback));
    },
  } satisfies FakeProviderPort & Record<string, unknown>;
}
