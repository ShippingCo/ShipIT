import React, { useEffect, useState } from 'react';
import { TextField } from '../components/m3/Input';
import { ApiFailure, recoveryFor } from '../data-access/errors';
import type { OnboardingRequest } from '@shippingco/shared';
import { Msym } from '../components/m3/Icon';
import type { ScopeController } from './scope';
import './onboarding.css';

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

/**
 * Answers already given, kept where a reload cannot take them.
 *
 * R-16 says no failure loses an answered step. The request intent below already survives a
 * reload once it has been sent, but a shop that typed its name and then lost the tab before
 * pressing anything used to come back to an empty form. This keeps the two answers from the
 * moment they are given, on this device only, and is cleared the moment the shop exists.
 */
const DRAFT='shipit_setup_answers:';
function savedAnswers(userId:string):{name:string;location:string;code:string}|null {
  try {
    const value=JSON.parse(sessionStorage.getItem(DRAFT+userId)??'null') as Record<string,unknown>|null;
    return value&&typeof value.name==='string'&&typeof value.location==='string'&&typeof value.code==='string'
      ?{name:value.name,location:value.location,code:value.code}:null;
  } catch { return null; }
}

const validName = (value: string) => value.length > 0 && value === value.trim() && Array.from(value).length <= 120 &&
  !Array.from(value).some(character => { const n = character.codePointAt(0)!; return n < 32 || n === 127 || (n >= 0xd800 && n <= 0xdfff); });
const validCode = (value: string) => /^[A-Z][A-Z0-9_]{0,31}$/.test(value);

/**
 * How many questions there are, and which one you are on.
 *
 * Every step is on screen at once, and a step already answered collapses to its own answer
 * with one button to change it. A wizard that shows one question at a time and no end is a
 * wizard people abandon, and this one is shown to a shop owner who has not yet decided
 * whether this software is real.
 */
function Step({index,title,state,answer,change,children}:{
  index:number;title:string;state:'done'|'now'|'later';answer?:string;change?:()=>void;children?:React.ReactNode;
}) {
  return <li className={'setup-step is-'+state} aria-current={state==='now'?'step':undefined}>
    <span className="setup-mark" aria-hidden="true">{state==='done'?<Msym name="check"/>:index}</span>
    <div className="setup-body">
      <h2 className="setup-title">{title}</h2>
      {state==='done'
        ? <div className="setup-answer">
            <strong>{answer}</strong>
            {change&&<button type="button" className="setup-change" onClick={change}>Change</button>}
          </div>
        : state==='now' ? children : null}
    </div>
  </li>;
}

export default function Onboarding({ userId, complete, controller }: { userId: string; complete: () => Promise<void>; controller: ScopeController }) {
  const [intent, setIntent] = useState(() => pending(userId));
  const kept=savedAnswers(userId);
  const [name, setName] = useState(intent?.body.display_name ?? kept?.name ?? '');
  const [location, setLocation] = useState(intent?.body.franchise.display_name ?? kept?.location ?? '');
  const [code, setCode] = useState(intent?.body.franchise.franchise_code ?? kept?.code ?? 'MAIN');
  // Which answers the owner has settled. Reopening one with Change moves the step back.
  const [settled,setSettled]=useState(()=>({
    shop:!!(intent?.body.display_name??kept?.name),
    branch:!!(intent?.body.franchise.display_name??kept?.location),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');

  useEffect(()=>{
    try { sessionStorage.setItem(DRAFT+userId,JSON.stringify({name,location,code})); }
    catch { /* an answer lost to a full or blocked store is retyped, never silently sent */ }
  },[userId,name,location,code]);

  function settleShop() {
    if(!validName(name)){
      setErrors({name:'Enter your business name as your customers know it (1 to 120 characters).'});
      document.getElementById('onboarding-name')?.focus();return;
    }
    setErrors({});setSettled(s=>({...s,shop:true}));
  }
  function settleBranch() {
    const next:Record<string,string>={};
    if(!validName(location))next.location='Enter the name of this shop or branch (1 to 120 characters).';
    if(!validCode(code))next.code='Start with A to Z; use up to 32 capital letters, digits or underscores.';
    setErrors(next);
    if(Object.keys(next).length){document.getElementById('onboarding-'+Object.keys(next)[0])?.focus();return;}
    setSettled(s=>({...s,branch:true}));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (busy) return;
    if(!validName(name)||!validName(location)||!validCode(code)){
      // A step reopened by a refusal is the step that has to be answered, and the field in it
      // takes the focus: nothing below is reachable until it is right.
      const next:Record<string,string>={};
      if(!validName(name))next.name='Enter your business name as your customers know it (1 to 120 characters).';
      else if(!validName(location))next.location='Enter the name of this shop or branch (1 to 120 characters).';
      else next.code='Start with A to Z; use up to 32 capital letters, digits or underscores.';
      setErrors(next);
      setSettled({shop:validName(name),branch:false});
      const target=Object.keys(next)[0]!;
      setTimeout(()=>document.getElementById('onboarding-'+target)?.focus(),0);
      return;
    }
    const command = intent ?? { key: crypto.randomUUID(), body: { display_name: name, franchise: { display_name: location, franchise_code: code } } };
    setIntent(command); setBusy(true); setMessage('');
    try { sessionStorage.setItem(`shipit_onboarding_request:${userId}`, JSON.stringify(command)); } catch { /* server identity guard also prevents duplicate workspaces */ }
    try {
      const approved = controller.source.onboardingIntent(command.body, controller.runtime.ticket(), command.key);
      await controller.command(() => controller.source.onboard(approved, controller.runtime.ticket));
      try { sessionStorage.removeItem(DRAFT+userId); } catch { /* the shop exists; the draft is spent */ }
      await complete();
    } catch (error) {
      if (error instanceof ApiFailure && recoveryFor(error, true) === 'validate') {
        setIntent(null); clearPending(userId);
        setMessage('Your shop was not created. Check the business and branch details, then try again. Nothing you typed was lost.');
      } else if (error instanceof ApiFailure && error.kind==='network') {
        setMessage('Cannot reach ShipIT. Check the shop’s internet, then press the button again. Nothing you typed was lost.');
      } else if (error instanceof ApiFailure && ['conflict', 'refresh'].includes(recoveryFor(error, true))) {
        setMessage('Your access changed while this was saving. Reload this page to see whether your shop was created.');
      } else {
        setMessage('We do not know whether your shop was created. Press the button again — it checks the same request and cannot create a second shop.');
      }
    } finally { setBusy(false); }
  }

  const step=!settled.shop?1:!settled.branch?2:3;
  return <section className="card operator-card operator-auth-card setup-card" aria-labelledby="onboarding-title">
    <h1 id="onboarding-title" tabIndex={-1} className="t-headline-sm">Set up your shop</h1>
    <p className="setup-lead">Three questions, and you can take your first booking.</p>
    <form aria-label="Set up your shop" onSubmit={event => { void submit(event); }} noValidate>
      <ol className="setup-steps">
        <Step index={1} title="Your business name" state={step===1?'now':'done'}
          answer={name} change={busy?undefined:()=>setSettled(s=>({...s,shop:false}))}>
          <TextField id="onboarding-name" name="organization" autoComplete="organization" maxLength={120}
            label="Business name" placeholder="Shree Balaji Courier" value={name} onChange={setName}
            required disabled={busy || !!intent} error={errors.name}
            helper="This is the name on your receipts."/>
          <button type="button" className="btn btn-filled setup-next" disabled={busy||!!intent} onClick={settleShop}>Next</button>
        </Step>
        <Step index={2} title="Your first branch" state={step<2?'later':step===2?'now':'done'}
          answer={location+' · '+code} change={busy?undefined:()=>setSettled(s=>({...s,branch:false}))}>
          <TextField id="onboarding-location" name="location" autoComplete="off" maxLength={120}
            label="Branch name" placeholder="Pune main shop" value={location} onChange={setLocation}
            required disabled={busy || !!intent} error={errors.location}
            helper="The shop you are standing in. You can add more later."/>
          <details open={!!errors.code} className="operator-branch-code">
            <summary>Branch code · optional</summary>
            <TextField id="onboarding-code" name="location-code" autoComplete="off" autoCapitalize="characters"
              spellCheck={false} maxLength={32} label="Branch code" placeholder="PUNE_1" value={code} onChange={setCode}
              required disabled={busy || !!intent} aria-describedby="code-help" aria-invalid={!!errors.code}/>
            <p id="code-help" className={errors.code ? 'operator-error' : 'muted'}>
              {errors.code ?? 'MAIN is filled in for your first branch. Change it only if your business already uses another code.'}
            </p>
          </details>
          <button type="button" className="btn btn-filled setup-next" disabled={busy||!!intent} onClick={settleBranch}>Next</button>
        </Step>
        <Step index={3} title="Open your shop" state={step<3?'later':'now'}>
          <p className="setup-after">
            Your shop opens on an empty counter, ready for the first booking. Two things are not set
            up yet and the counter will say so when it needs them: what you charge, and whether you
            charge GST. Both are in Settings.
          </p>
          {!!intent&&!busy&&<p className="setup-note">Your answers are kept unchanged while the earlier request is checked.</p>}
          {message && <p role="alert" className="setup-failure">{message}</p>}
          <button className="btn btn-filled setup-open" disabled={busy}>
            {busy ? 'Opening your shop…' : intent ? 'Check whether it saved' : 'Open my shop'}
          </button>
          <p role="status" aria-live="polite" className="setup-note">{busy ? 'Saving your business and branch.' : ''}</p>
        </Step>
      </ol>
    </form>
  </section>;
}
