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
  startSignIn(email: string, signal?: AbortSignal): Promise<{ challenge_id: string }>;
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
    startSignIn: (email, signal) => client.request('/auth/challenges', { body: { channel: 'email', address: email }, signal }),
    verifySignIn: (challenge, code, signal) => client.request('/auth/challenges/verify', { body: { challenge_id: challenge, code }, signal }),
  };
}
