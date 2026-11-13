import { operatorContext } from './context-dto';
import type { OperatorContext, OnboardingRequest } from '@shippingco/shared';
import { createApiClient } from '../data-access/api-client';
import { createCommandIntent, executeIntent } from '../data-access/command-intent';
import type { CommandIntent } from '../data-access/command-intent';
import type { ScopeTicket } from '../data-access/scope-runtime';
export interface OperatorDataSource {
  loadContext(selected?: string, signal?: AbortSignal): Promise<OperatorContext>;
  onboardingIntent(body: OnboardingRequest, scope: ScopeTicket, key?: string): CommandIntent;
  onboard(intent: CommandIntent, current: () => ScopeTicket): Promise<unknown>;
  acceptInvitation(token: string, signal?: AbortSignal): Promise<unknown>;
  logout(signal?: AbortSignal): Promise<unknown>;
  contacts(signal?: AbortSignal): Promise<{ contacts: { channel: string; address: string }[] }>;
  startSignIn(channel: 'whatsapp' | 'email', address: string, signal?: AbortSignal): Promise<{ challenge_id: string; resend_after?: number }>;
  resendSignIn(challenge: string, signal?: AbortSignal): Promise<{resend_after: number}>;
  verifySignIn(challenge: string, code: string, signal?: AbortSignal): Promise<unknown>;
}
export function createOperatorDataSource(client = createApiClient()): OperatorDataSource {
  return {
    loadContext: async (selected, signal) => operatorContext(await client.request('/api/v1/operator-context' + (selected ? `/franchises/${encodeURIComponent(selected)}` : ''), { signal })),
    onboardingIntent: (body, scope, key) => createCommandIntent({ operation: 'independent-onboarding:v1', path: '/api/v1/onboarding', body, scope, key }),
    onboard: (intent, current) => executeIntent(intent, current, (path, options) => client.request(path, { ...options,
      validationFields: ['$', 'display_name', 'franchise', 'franchise.display_name', 'franchise.franchise_code', 'Idempotency-Key'] })),
    acceptInvitation: (token, signal) => client.request('/api/v1/membership-invitations/accept', { body: { token }, signal }),
    logout: signal => client.request('/auth/logout', { body: {}, signal }),
    // Which number or address this session signed in with. Read only where it is shown back
    // to the person who typed it, so an owner can be told which contact to invite.
    contacts: async signal => {
      const body = await client.request('/auth/contacts', { signal }) as { contacts?: unknown };
      const list = Array.isArray(body.contacts) ? body.contacts : [];
      return { contacts: list.flatMap(item => {
        const row = item as { channel?: unknown; address?: unknown };
        return typeof row.channel === 'string' && typeof row.address === 'string' && row.address.length <= 254
          ? [{ channel: row.channel, address: row.address }] : [];
      }) };
    },
    startSignIn: (channel, address, signal) => client.request('/auth/challenges', { body: { channel, address }, signal }),
    resendSignIn: (challenge, signal) => client.request('/auth/challenges/resend', {body:{challenge_id:challenge}, signal}),
    verifySignIn: (challenge, code, signal) => client.request('/auth/challenges/verify', { body: { challenge_id: challenge, code }, signal }),
  };
}
