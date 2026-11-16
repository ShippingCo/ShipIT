import React, { useEffect, useId, useRef, useState } from 'react';
import {CodeField} from '../components/m3/CodeField';
import {Msym} from '../components/m3/Icon';
import {ApiFailure} from '../data-access/errors';
import {dialCodes,nationalDigits,nationalLength,phoneDisplay} from '../utils/dial-codes';
import type { OperatorDataSource } from './data-source';
import {AccessCard, Field} from './access-ui';

const STEPS=['Phone number','Code'] as const;
const EMAIL_STEPS=['Email','Code'] as const;
/** The server mints and checks eight digits. The screen says eight because eight is the truth. */
const DIGITS=8;
/** `/auth/challenges` states a ten-minute life. After that the screen stops pretending. */
const LIFETIME_MS=600_000;

/**
 * One refusal, whatever the real reason.
 *
 * A wrong code and a number nobody has ever registered produce this exact string. That is not
 * laziness: distinguishing them turns the sign-in screen into a way to ask "does this shop use
 * ShipIT?" about any phone number in the country. The server already behaves this way — it
 * mints a challenge for an unknown number and sends nothing — so the screen must not undo it.
 */
const REFUSED='That code did not work. Check the '+DIGITS+' digits and try again.';
const OFFLINE='Cannot reach ShipIT. Check the shop’s internet and try again.';
/** After five failures the server will not accept this challenge again, whatever is typed. */
const SPENT=5;

export default function SignIn({ complete, source }: { complete: () => Promise<void>; source: OperatorDataSource }) {
  const active = useRef<AbortController | null>(null);
  useEffect(() => { const abort = new AbortController(); active.current = abort; return () => abort.abort(); }, []);
  const [onEmail,setOnEmail]=useState(false);
  const [dial,setDial]=useState('91'),[typed,setTyped]=useState(''),[email,setEmail]=useState('');
  const [code,setCode]=useState(''),[challenge,setChallenge]=useState('');
  const [busy, setBusy] = useState(false), [resending,setResending]=useState(false);
  const [error, setError] = useState(''), [field,setField]=useState(''), [notice,setNotice]=useState('');
  const [sentAt,setSentAt]=useState(0),[retryAt,setRetryAt]=useState(0),[waitUntil,setWaitUntil]=useState(0);
  const [wrong,setWrong]=useState(0);
  const [now,setNow]=useState(()=>Date.now());

  // One clock for the whole screen: the resend countdown, the stated wait after three wrong
  // codes, and the age of the code. Three timers would drift against each other.
  useEffect(()=>{
    if(!challenge)return;
    const timer=window.setInterval(()=>setNow(Date.now()),1000);
    return ()=>window.clearInterval(timer);
  },[challenge]);

  const digits=nationalDigits(typed,dial),expected=nationalLength(dial);
  const resendIn=Math.max(0,Math.ceil((retryAt-now)/1000));
  const waitIn=Math.max(0,Math.ceil((waitUntil-now)/1000));
  const stale=sentAt>0&&now-sentAt>=LIFETIME_MS;
  const spent=wrong>=SPENT;
  const sentTo=onEmail?email:phoneDisplay(dial,digits);

  const fieldId=useId(),errorId=fieldId+'-error';
  const previous=useRef('');
  useEffect(()=>{
    if(busy)return;
    if(challenge||previous.current)document.getElementById(fieldId)?.focus();
    previous.current=challenge;
  },[challenge,fieldId,busy]);

  function report(failure:unknown) {
    if(failure instanceof ApiFailure&&failure.kind==='network'){setError(OFFLINE);return 'offline';}
    if(failure instanceof ApiFailure&&failure.code==='RATE_LIMITED'){
      const seconds=failure.retryAfterSeconds??60;
      setWaitUntil(Date.now()+seconds*1000);
      setError('Too many tries from this shop. Wait '+seconds+' seconds. Nothing is locked.');
      return 'limited';
    }
    return 'refused';
  }

  async function sendCode() {
    const abort=active.current;
    if(!abort||busy||resending)return;
    if(onEmail){ if(!email){setField('Enter the email address the shop signs in with.');return;} }
    else if(expected!==null&&digits.length!==expected){
      setField('A phone number is '+expected+' digits. This one has '+digits.length+'.');return;
    } else if(digits.length<7){setField('Enter the shop’s WhatsApp number.');return;}
    setBusy(true);setError('');setField('');setNotice('');
    try {
      const result=await source.startSignIn(onEmail?'email':'whatsapp',onEmail?email:'+'+dial+digits,abort.signal);
      if(abort.signal.aborted||active.current!==abort)return;
      setChallenge(result.challenge_id);
      setSentAt(Date.now());setNow(Date.now());
      setRetryAt(Date.now()+(result.resend_after??60)*1000);
      setWrong(0);setWaitUntil(0);
    } catch(failure) {
      if(abort.signal.aborted||active.current!==abort)return;
      // Nothing typed is cleared on any failure here: the number is the one thing the person
      // cannot get back without reading it off a phone.
      if(report(failure)==='refused')setError(onEmail
        ?'Could not send a code to that email address.'
        :'Could not send a code to that number on WhatsApp.');
    } finally { if(!abort.signal.aborted&&active.current===abort)setBusy(false); }
  }

  async function verify(value:string) {
    const abort=active.current;
    if(!abort||busy||resending||spent||waitIn>0||value.length!==DIGITS)return;
    setBusy(true);setError('');setNotice('');
    try {
      await source.verifySignIn(challenge,value,abort.signal);
      setCode('');
      if(!abort.signal.aborted)await complete();
    } catch(failure) {
      if(abort.signal.aborted||active.current!==abort)return;
      const kind=report(failure);
      if(kind==='offline')return;
      if(kind==='limited'){setCode('');return;}
      setCode('');
      const count=wrong+1;setWrong(count);
      if(count>=SPENT)setError('This code has been tried too many times. Ask for a new one.');
      else {
        // No lockout, ever. A counter that cannot sign in is a shop that cannot trade.
        if(count%3===0)setWaitUntil(Date.now()+60_000);
        setError(REFUSED);
      }
    } finally { if(!abort.signal.aborted&&active.current===abort)setBusy(false); }
  }

  async function resend() {
    const abort=active.current;
    if(!abort||busy||resending||!challenge||spent||resendIn>0)return;
    setResending(true);setError('');setNotice('');
    try {
      const result=await source.resendSignIn(challenge,abort.signal);
      if(abort.signal.aborted)return;
      setSentAt(Date.now());setNow(Date.now());
      setRetryAt(Date.now()+(result.resend_after??60)*1000);
      setNotice('Another code is on its way to '+sentTo+'.');
    } catch(failure) {
      if(abort.signal.aborted)return;
      if(report(failure)==='refused'){
        setRetryAt(Date.now()+60_000);
        setError('Could not send another code. Try the one you have, or change the number.');
      }
    } finally { if(!abort.signal.aborted)setResending(false); }
  }

  function changeNumber() {
    setChallenge('');setCode('');setError('');setField('');setNotice('');
    setRetryAt(0);setWaitUntil(0);setSentAt(0);setWrong(0);
  }

  const locked=busy||resending;
  const title=challenge?'Enter your code':'Sign in to ShippingCo';
  return <AccessCard title={title}
    lead={challenge?undefined:onEmail
      ?'We will send an '+DIGITS+'-digit code to your email.'
      :'We will send an '+DIGITS+'-digit code on WhatsApp.'}
    steps={onEmail?EMAIL_STEPS:STEPS} current={challenge?1:0}
    aside={!challenge?<div className="access-switch">
      <button type="button" className="access-quiet" disabled={locked}
        onClick={()=>{setOnEmail(!onEmail);setError('');setField('');}}>
        {onEmail?'Use a phone number instead':'Use an email address instead'}
      </button>
    </div>:undefined}>
    <form aria-label={challenge?'Enter your code':onEmail?'Sign in with an email address':'Sign in with a phone number'}
      onSubmit={event=>{event.preventDefault();if(challenge)void verify(code);else void sendCode();}} noValidate>
      {!challenge
        ? onEmail
          ? <Field id={fieldId} label="Email" error={field||undefined}>
              <input className="access-input" id={fieldId} type="email" autoComplete="email" autoCapitalize="none"
                spellCheck={false} maxLength={254} placeholder="name@yourbusiness.in" value={email}
                onChange={event=>{setEmail(event.target.value);setError('');setField('');}}
                aria-invalid={!!(error||field)||undefined} aria-describedby={error?errorId:undefined}
                disabled={locked}/>
            </Field>
          : <div className="access-phone">
              <div className="access-field">
                <label className="access-label" htmlFor={fieldId+'-dial'}>Country code</label>
                <select className="access-input access-dial" id={fieldId+'-dial'} value={dial} disabled={locked}
                  onChange={event=>{setDial(event.target.value);setField('');}}>
                  {dialCodes.map(entry=><option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </div>
              <Field id={fieldId} label="Phone number" error={field||undefined}>
                <input className="access-input" id={fieldId} type="tel" inputMode="numeric"
                  autoComplete="tel-national" spellCheck={false} maxLength={20} placeholder="98765 43210"
                  value={typed} disabled={locked}
                  onChange={event=>{setTyped(event.target.value);setError('');setField('');}}
                  onBlur={()=>{
                    // R-3: named the moment the field is left, with the value kept as typed.
                    if(!typed)return;
                    setField(expected!==null&&digits.length!==expected
                      ?'A phone number is '+expected+' digits. This one has '+digits.length+'.':'');
                  }}
                  aria-invalid={!!(error||field)||undefined} aria-describedby={error?errorId:undefined}/>
              </Field>
              {/* The hint is about the pair, not the number alone, so it sits under both
                  columns instead of wrapping to three lines inside the narrower one — and it
                  goes away once the field is refused, because the refusal already says it. */}
              {expected!==null&&!field&&<p className="access-hint access-phone-hint">{expected} digits, the number WhatsApp is on.</p>}
            </div>
        : <>
            <div className="access-sent">
              <p>{onEmail?'Code sent to':'Code sent on WhatsApp to'}</p>
              <div className="access-sent-to">
                <strong>{sentTo}</strong>
                <button type="button" className="access-quiet" disabled={locked} onClick={changeNumber}>Change</button>
              </div>
              {stale&&!spent&&<p role="status" className="access-stale">
                That code was sent more than 10 minutes ago. Ask for a new one.
              </p>}
            </div>
            <CodeField id={fieldId} label={'Your '+DIGITS+'-digit code'} digits={DIGITS} value={code} reveal
              onChange={value=>{
                setCode(value);setError('');
                // R-6: the last digit submits on its own. The button below stays for a paste,
                // for a keyboard, and for anyone who does not trust it.
                if(value.length===DIGITS)void verify(value);
              }}
              aria-invalid={!!error||undefined} aria-describedby={error?errorId:undefined}
              disabled={locked||spent} autoFocus/>
          </>}
      {error && <p id={errorId} role="alert" className="access-error">
        <Msym name="error" aria-hidden="true"/><span>{error}</span>
      </p>}
      {waitIn>0&&<p role="status" className="access-wait">Try again in {waitIn}s. Your account is not locked.</p>}
      <button className="access-submit" disabled={locked||(!!challenge&&(spent||waitIn>0))} aria-busy={busy}>
        {busy?(challenge?'Checking the code…':'Sending the code…')
          :challenge?'Sign in':onEmail?'Send the code by email':'Send the code on WhatsApp'}
      </button>
      {notice&&<p role="status" className="access-notice">{notice}</p>}
      {challenge && <div className="access-actions">
        <button type="button" className="access-quiet" disabled={locked||spent||resendIn>0} onClick={()=>void resend()}>
          {resending?'Sending another code…':resendIn>0?'Another code in '+resendIn+'s':'Send another code'}
        </button>
      </div>}
    </form>
  </AccessCard>;
}
