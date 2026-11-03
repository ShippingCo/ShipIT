import React, { useState } from 'react';
import { TextField } from '../components/m3/Input';
import { ApiFailure, recoveryFor } from '../data-access/errors';
import type { OnboardingRequest } from '@shippingco/shared';
import type { ScopeController } from './scope';
import {AccessStep} from './AccessStep';

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
  const [code, setCode] = useState(intent?.body.franchise.franchise_code ?? 'MAIN');
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
        setMessage('Workspace access has changed. Reload this page to check whether your workspace was created.');
      } else {
        setMessage('Workspace creation could not be confirmed. Retry the same request to check the result without creating a duplicate.');
      }
    } finally { setBusy(false); }
  }
  return <section className="card operator-card operator-auth-card" aria-labelledby="onboarding-title">
    <AccessStep stage="shop"/>
    <h1 id="onboarding-title" tabIndex={-1} className="t-headline-sm">Set up your shop</h1>
    <p className="muted">Add your business and the first place you book parcels from.</p>
    <form aria-label="Set up your shop" onSubmit={event => { void submit(event); }} noValidate>
      <TextField id="onboarding-name" name="organization" autoComplete="organization" maxLength={120} label="Business name" placeholder="Shree Balaji Courier" value={name} onChange={setName} required disabled={busy || !!intent} error={errors.name} />
      <fieldset className="operator-onboarding-location"><legend>Your first location</legend>
      <TextField id="onboarding-location" name="location" autoComplete="off" maxLength={120} label="Location name" placeholder="Pune main shop" value={location} onChange={setLocation} required disabled={busy || !!intent} error={errors.location} />
      <details open={!!errors.code} className="operator-branch-code"><summary>Branch code · optional</summary><TextField id="onboarding-code" name="location-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={32} label="Location code" placeholder="PUNE_1" value={code} onChange={setCode} required disabled={busy || !!intent} aria-describedby="code-help" aria-invalid={!!errors.code} />
      <p id="code-help" className={errors.code ? 'operator-error' : 'muted'}>{errors.code ?? 'MAIN is filled in for your first branch. Change it only if your business uses another code.'}</p></details>
      </fieldset>
      {!!intent&&!busy&&<p className="operator-intent-note">Your details are kept unchanged while the earlier request is checked.</p>}
      {message && <p role="alert">{message}</p>}
      <button className="btn btn-filled" disabled={busy}>{busy ? 'Creating workspace…' : intent ? 'Retry same request' : 'Create workspace'}</button>
      <p role="status" aria-live="polite">{busy ? 'Saving your business and location securely…' : ''}</p>
    </form>
  </section>;
}
