import { templateReason, validVariables } from './rules.ts';
import type { RegisteredTemplate } from './types.ts';

export const consentPolicyVersion = 'whatsapp-consent-v1';
export type ConsentIntent = 'stop' | 'start' | 'other';
/** Closed commands take precedence over every conversational intent. */
export function consentIntent(text: string): ConsentIntent {
  const value = text.trim().replace(/\s+/g, ' ').toUpperCase();
  if (['STOP', 'STOP UPDATES', 'UNSUBSCRIBE'].includes(value)) return 'stop';
  if (value === 'START' || value === 'START UPDATES') return 'start';
  return 'other';
}

export interface ConsentPolicyInput {
  purpose: 'updates' | 'requested_assistance' | 'delivery_otp' | 'marketing';
  state: 'unknown' | 'granted' | 'revoked';
  currentContact: boolean;
  pendingInbound: boolean;
  installationActive: boolean;
  lastInboundAt: Date | null;
  requestedInboxMatches: boolean;
  now: Date;
  format: 'text' | 'template';
  template: RegisteredTemplate | null;
  credentialRevision: number;
  variables: unknown;
}
/** Evaluate again immediately before dispatch; a queued result is never permission to send. */
export function evaluateConsentPolicy(input: ConsentPolicyInput) {
  const deny = (reason: string) => ({ allowed: false, reason, policy_version: consentPolicyVersion });
  if (!Number.isFinite(input.now.getTime())) return deny('policy_clock_invalid');
  if (!input.installationActive) return deny('installation_unavailable');
  if (input.pendingInbound) return deny('consent_processing_pending');
  if (!input.currentContact) return deny('contact_unconfirmed');
  if (input.purpose === 'marketing') return deny('purpose_unsupported');
  // Authentication templates and scoped delivery challenges are not implemented by #36/#38.
  if (input.purpose === 'delivery_otp') return deny('operational_exception_unapproved');
  if (input.state === 'revoked') return deny('consent_revoked');
  const age = input.lastInboundAt ? input.now.getTime() - input.lastInboundAt.getTime() : Infinity;
  const windowOpen = age >= 0 && age < 24 * 60 * 60 * 1000;
  if (input.purpose === 'requested_assistance') {
    if (!input.requestedInboxMatches || !windowOpen) return deny('requested_context_expired');
  } else if (input.state !== 'granted') return deny('consent_unknown');
  if (input.format === 'text') {
    if (!windowOpen) return deny('approved_template_required');
  } else {
    const reason = templateReason(input.template);
    if (reason) return deny(reason);
    const template = input.template!;
    const checkedAge = input.now.getTime() - template.checked_at.getTime();
    if (template.credential_revision !== input.credentialRevision || checkedAge < 0 || checkedAge >= 900000)
      return deny('template_validation_stale');
    if (!validVariables(template, input.variables)) return deny('template_variables_invalid');
  }
  return { allowed: true, reason: 'eligible', policy_version: consentPolicyVersion };
}
