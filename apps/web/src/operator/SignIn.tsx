import React, { useEffect, useId, useRef, useState } from 'react';
import { TextField } from '../components/m3/Input';
import type { OperatorDataSource } from './data-source';
import {Msym} from '../components/m3/Icon';
export default function SignIn({ complete, source }: { complete: () => Promise<void>; source: OperatorDataSource }) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => { const abort = new AbortController(); active.current = abort; return () => abort.abort(); }, []);
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const fieldId=useId(),errorId=fieldId+'-error',previousChallenge=useRef('');
  useEffect(()=>{if(busy)return;if(challenge||previousChallenge.current)document.getElementById(fieldId)?.focus();previousChallenge.current=challenge;},[challenge,fieldId,busy]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || !active.current) return; setBusy(true); setError('');
    const abort = active.current;
    try {
      if (!challenge) {
        const result = await source.startSignIn(email, abort.signal);
        if(!abort.signal.aborted&&active.current===abort)setChallenge(result.challenge_id);
      } else {
        await source.verifySignIn(challenge, code, abort.signal);
        setCode(''); if (!abort.signal.aborted) await complete();
      }
    } catch { if(!abort.signal.aborted&&active.current===abort){setCode('');setError('Sign-in could not be completed. Check your details or request a new code.');} }
    finally { if(!abort.signal.aborted&&active.current===abort)setBusy(false); }
  }
  return <section className="card operator-card operator-auth-card">
    <span className="workspace-auth-mark"><Msym name="inventory_2"/></span>
    <h1 id="signin-title" tabIndex={-1} className="t-headline-sm">Sign in to ShippingCo</h1>
    <p className="muted">Welcome to your shop. Sign in with your registered email.</p>
    <form aria-label={challenge?'Verify sign-in code':'Sign in with email'} onSubmit={event => { void submit(event); }}>
      {!challenge ? <TextField id={fieldId} label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="name@yourbusiness.in" helper="No password needed. Use the email registered for your shop." value={email} onChange={value=>{setEmail(value);setError('');}} aria-invalid={!!error||undefined} aria-describedby={error?errorId:undefined} required disabled={busy} /> : <>
        <div className="operator-code-destination"><p>Code requested for <strong>{email}</strong></p><p role="status">If this email has access, you’ll receive an 8-digit code. Check your inbox and spam folder. The code expires after 10 minutes.</p></div>
        <TextField id={fieldId} label="Sign-in code" type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" minLength={8} maxLength={8} helper="Paste or type all 8 digits." value={code} onChange={value=>{setCode(value);setError('');}} aria-invalid={!!error||undefined} aria-describedby={error?errorId:undefined} required disabled={busy} autoFocus />
      </>}
      {error && <p id={errorId} role="alert">{error}</p>}
      <button className="btn btn-filled" disabled={busy} aria-busy={busy}>{busy ? challenge?'Checking code…':'Sending code…' : challenge ? 'Verify and continue' : 'Send sign-in code'}</button>
      {challenge && <button type="button" className="btn btn-text" disabled={busy} onClick={() => { setChallenge(''); setCode('');setError(''); }}>Use email again</button>}
    </form>
  </section>;
}
