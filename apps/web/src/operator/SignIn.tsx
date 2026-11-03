import {CodeField} from '../components/m3/CodeField';
import React, { useEffect, useId, useRef, useState } from 'react';
import { TextField } from '../components/m3/Input';
import type { OperatorDataSource } from './data-source';
import {AccessStep} from './AccessStep';
export default function SignIn({ complete, source }: { complete: () => Promise<void>; source: OperatorDataSource }) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => { const abort = new AbortController(); active.current = abort; return () => abort.abort(); }, []);
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [challenge, setChallenge] = useState('');
  const [setup,setSetup]=useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [resending,setResending]=useState(false),[notice,setNotice]=useState('');
  const [retryAt,setRetryAt]=useState(0),[seconds,setSeconds]=useState(0);
  function startCooldown(delay=60) {
    const wait=Number.isFinite(delay)?Math.max(1,Math.ceil(delay)):60;
    setSeconds(wait);setRetryAt(Date.now()+wait*1000);
  }
  useEffect(()=>{
    if(!retryAt||!challenge)return;
    const timer=window.setInterval(()=>{
      const left=Math.max(0,Math.ceil((retryAt-Date.now())/1000));
      setSeconds(left);if(left===0)window.clearInterval(timer);
    },1000);
    return ()=>window.clearInterval(timer);
  },[retryAt,challenge]);
  async function resend() {
    const abort=active.current;
    if(!abort||busy||resending||!challenge||Date.now()<retryAt)return;
    setResending(true);setError('');setNotice('');
    try {
      const result=await source.resendSignIn(challenge,abort.signal);
      if(!abort.signal.aborted){startCooldown(result.resend_after);setNotice('Another code was requested. Check your email.');}
    } catch {
      if(!abort.signal.aborted){startCooldown();setError('Could not resend the code. Try your existing code or return to email.');}
    } finally {if(!abort.signal.aborted)setResending(false);}
  }
  const fieldId=useId(),errorId=fieldId+'-error',previousChallenge=useRef('');
  useEffect(()=>{if(busy)return;if(challenge||previousChallenge.current)document.getElementById(fieldId)?.focus();previousChallenge.current=challenge;},[challenge,fieldId,busy]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy || resending || !active.current) return; setBusy(true); setError('');setNotice('');
    const abort = active.current;
    try {
      if (!challenge) {
        const result = await source.startSignIn(email, abort.signal);
        if(!abort.signal.aborted&&active.current===abort){setChallenge(result.challenge_id);startCooldown(result.resend_after);}
      } else {
        await source.verifySignIn(challenge, code, abort.signal);
        setCode(''); if (!abort.signal.aborted) await complete();
      }
    } catch { if(!abort.signal.aborted&&active.current===abort){setCode('');setError('Sign-in could not be completed. Check your details or request a new code.');} }
    finally { if(!abort.signal.aborted&&active.current===abort)setBusy(false); }
  }
  return <section className="card operator-card operator-auth-card">
    <AccessStep stage={challenge?'verify':'email'}/>
    <h1 id="signin-title" tabIndex={-1} className="t-headline-sm">{challenge?'Enter your sign-in code':setup?'Start your shop setup':'Sign in to ShippingCo'}</h1>
    {!challenge && <p className="muted">{setup?'Verify the email enabled for your business. Then add your shop and first branch.':'We’ll send a sign-in code to your registered email.'}</p>}
    <form aria-label={challenge?'Verify sign-in code':setup?'Start shop setup':'Sign in with email'} onSubmit={event => { void submit(event); }}>
      {!challenge ? <TextField id={fieldId} label="Email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} maxLength={254} placeholder="name@yourbusiness.in" value={email} onChange={value=>{setEmail(value);setError('');}} aria-invalid={!!error||undefined} aria-describedby={error?errorId:undefined} required disabled={busy||resending} /> : <>
        <div className="operator-code-destination"><p>Code requested for <strong>{email}</strong></p><p role="status">If this email has access, you’ll receive an 8-digit code. Check your inbox and spam folder. The code expires after 10 minutes.</p></div>
        <CodeField id={fieldId} label="Sign-in code" digits={8} value={code} onChange={value=>{setCode(value);setError('');}} aria-invalid={!!error||undefined} aria-describedby={error?errorId:undefined} required disabled={busy||resending} autoFocus />
      </>}
      {error && <p id={errorId} role="alert">{error}</p>}
      <button className="btn btn-filled" disabled={busy||resending} aria-busy={busy}>{busy ? challenge?'Checking code…':'Sending code…' : challenge ? 'Verify and continue' : setup ? 'Send verification code' : 'Send sign-in code'}</button>
      {notice&&<p role="status" className="access-notice">{notice}</p>}
      {challenge && <div className="access-code-actions"><button type="button" disabled={busy||resending||seconds>0} className="btn btn-text" onClick={()=>void resend()}>
        {resending?'Requesting code…':seconds>0?'Resend in '+seconds+'s':'Resend code'}</button>
        <button type="button" className="btn btn-text" disabled={busy||resending} onClick={() => { setChallenge('');setCode('');setError('');setNotice('');setRetryAt(0); }}>Use email again</button></div>}
    </form>
    {!challenge&&<div className="access-switch"><span>{setup?'Already have a shop?':'Setting up for the first time?'}</span>
      <button type="button" disabled={busy||resending} onClick={()=>{setSetup(!setup);setError('');document.getElementById(fieldId)?.focus();}}>
        {setup?'Sign in':'Set up your shop'}
      </button>
    </div>}
    {!challenge&&setup&&<details className="access-help"><summary>Which email should I use?</summary>
      <p>Use the email enabled for your business. If you don’t have access yet, ask your ShippingCo administrator to enable it.</p></details>}
  </section>;
}
