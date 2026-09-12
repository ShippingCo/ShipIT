import React, { useState } from 'react';
import { TextField } from '../components/m3/Input';
import { ApiFailure, recoveryFor } from '../data-access/errors';
import type { OnboardingRequest } from '@shippingco/shared';
import type { ScopeController } from './scope';

type Intent = { key: string; body: OnboardingRequest };
// Only a pending request intent, never workspace authority. GET context always runs first.
function pending(userId: string): Intent | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`shipit_onboarding_request:${userId}`) ?? 'null') as Intent | null;
    return value && typeof value.key === 'string' && typeof value.body?.display_name === 'string' &&
      typeof value.body.franchise?.display_name === 'string' && typeof value.body.franchise.franchise_code === 'string' ? value : null;
  } catch { return null; }
}
export function clearPending(userId: string) {
  try { sessionStorage.removeItem(`shipit_onboarding_request:${userId}`); } catch { /* context remains authoritative */ }
}
export default function Onboarding({ userId, complete, controller }: { userId: string; complete: () => Promise<void>; controller: ScopeController }) {
  const [intent, setIntent] = useState(() => pending(userId));
  const [name, setName] = useState(intent?.body.display_name ?? '');
  const [location, setLocation] = useState(intent?.body.franchise.display_name ?? '');
  const [code, setCode] = useState(intent?.body.franchise.franchise_code ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    const next: Record<string, string> = {};
    const validName = (value: string) => value.length > 0 && value === value.trim() && Array.from(value).length <= 120 && !Array.from(value).some(character => { const n = character.codePointAt(0)!; return n < 32 || n === 127 || (n >= 0xd800 && n <= 0xdfff); });
    if (!validName(name)) next.name = 'Enter a business name (1–120 characters, no surrounding spaces).';
    if (!validName(location)) next.location = 'Enter a location name (1–120 characters, no surrounding spaces).';
    if (!/^[A-Z][A-Z0-9_]{0,31}$/.test(code)) next.code = 'Start with A–Z; use up to 32 capital letters, digits or underscores.';
    setErrors(next);
    if (Object.keys(next).length) { document.getElementById(`onboarding-${Object.keys(next)[0]}`)?.focus(); return; }
    const command = intent ?? { key: crypto.randomUUID(), body: { display_name: name, franchise: { display_name: location, franchise_code: code } } };
    setIntent(command); setBusy(true); setMessage('');
    try { sessionStorage.setItem(`shipit_onboarding_request:${userId}`, JSON.stringify(command)); } catch { /* server identity guard also prevents duplicate workspaces */ }
    try {
      const approved = controller.source.onboardingIntent(command.body, controller.runtime.ticket(), command.key);
      await controller.command(() => controller.source.onboard(approved, controller.runtime.ticket));
      await complete();
    } catch (error) {
      if (error instanceof ApiFailure && recoveryFor(error, true) === 'validate') {
        setIntent(null); clearPending(userId); setMessage('Check the business and location details, then try again.');
      } else if (error instanceof ApiFailure && ['conflict', 'refresh'].includes(recoveryFor(error, true))) {
        setMessage('The request conflicts with current state. Refresh workspace access before reviewing a new action.');
      } else {
        setMessage('We could not confirm your workspace. Retry the same request, or refresh workspace access.');
      }
    } finally { setBusy(false); }
  }
  return <section className="card operator-card" aria-labelledby="onboarding-title">
    <h1 id="onboarding-title" className="t-headline-sm">Set up your shop</h1>
    <p className="muted">Create your independent business and its first location.</p>
    <form onSubmit={event => { void submit(event); }} noValidate>
      <TextField id="onboarding-name" label="Business name" value={name} onChange={setName} required disabled={busy || !!intent} aria-describedby={errors.name ? 'error-name' : undefined} aria-invalid={!!errors.name} />
      {errors.name && <p id="error-name" className="operator-error">{errors.name}</p>}
      <TextField id="onboarding-location" label="Location name" value={location} onChange={setLocation} required disabled={busy || !!intent} aria-describedby={errors.location ? 'error-location' : undefined} aria-invalid={!!errors.location} />
      {errors.location && <p id="error-location" className="operator-error">{errors.location}</p>}
      <TextField id="onboarding-code" label="Location code" value={code} onChange={setCode} required disabled={busy || !!intent} aria-describedby="code-help" aria-invalid={!!errors.code} />
      <p id="code-help" className={errors.code ? 'operator-error' : 'muted'}>{errors.code ?? 'A short permanent code, for example MAIN or PUNE_1.'}</p>
      {message && <p role="alert">{message}</p>}
      <button className="btn btn-filled" disabled={busy}>{busy ? 'Creating workspace…' : intent ? 'Retry same request' : 'Create workspace'}</button>
      <p role="status" aria-live="polite">{busy ? 'Saving your business and location securely…' : ''}</p>
    </form>
  </section>;
}
