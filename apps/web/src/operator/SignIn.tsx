import React, { useState } from 'react';
import { TextField } from '../components/m3/Input';
import { request } from './api';
export default function SignIn({ complete }: { complete: () => Promise<void> }) {
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      if (!challenge) {
        const result = await request<{ challenge_id: string }>('/auth/challenges', { body: { channel: 'email', address: email } });
        setChallenge(result.challenge_id);
      } else {
        await request('/auth/challenges/verify', { body: { challenge_id: challenge, code } });
        setCode(''); await complete();
      }
    } catch { setCode(''); setError('Sign-in could not be completed. Check your details or request a new code.'); }
    finally { setBusy(false); }
  }
  return <section className="card operator-card">
    <h1 className="t-headline-sm">Sign in to ShippingCo</h1>
    <p className="muted">Use your verified operator email. If you have not been enrolled, contact your administrator to verify your identity first.</p>
    <form onSubmit={event => { void submit(event); }}>
      {!challenge ? <TextField label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} required disabled={busy} /> : <>
        <p role="status">If your account is eligible, a code is on its way. Codes expire after 10 minutes.</p>
        <TextField label="Sign-in code" type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" value={code} onChange={setCode} required disabled={busy} autoFocus />
      </>}
      {error && <p role="alert">{error}</p>}
      <button className="btn btn-filled" disabled={busy}>{busy ? 'Please wait…' : challenge ? 'Verify and continue' : 'Send sign-in code'}</button>
      {challenge && <button type="button" className="btn btn-text" disabled={busy} onClick={() => { setChallenge(''); setCode(''); }}>Use email again</button>}
    </form>
  </section>;
}
