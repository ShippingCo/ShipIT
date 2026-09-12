import React, { useEffect, useRef, useState } from 'react';
import { TextField } from '../components/m3/Input';
import type { OperatorDataSource } from './data-source';
export default function SignIn({ complete, source }: { complete: () => Promise<void>; source: OperatorDataSource }) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => { const abort = new AbortController(); active.current = abort; return () => abort.abort(); }, []);
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || !active.current) return; setBusy(true); setError('');
    const abort = active.current;
    try {
      if (!challenge) {
        const result = await source.startSignIn(email, abort.signal);
        setChallenge(result.challenge_id);
      } else {
        await source.verifySignIn(challenge, code, abort.signal);
        setCode(''); if (!abort.signal.aborted) await complete();
      }
    } catch { setCode(''); setError('Sign-in could not be completed. Check your details or request a new code.'); }
    finally { setBusy(false); }
  }
  return <section className="card operator-card">
    <h1 id="signin-title" tabIndex={-1} className="t-headline-sm">Sign in to ShippingCo</h1>
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
