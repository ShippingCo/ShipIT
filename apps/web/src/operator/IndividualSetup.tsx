import React, {useEffect, useId, useRef, useState} from 'react';
import {Link, Navigate} from 'react-router-dom';
import {Msym} from '../components/m3/Icon';
import {cn} from '@/lib/utils';
import {ApiFailure, recoveryFor} from '../data-access/errors';
import {individual, priceNotSet} from '../public/catalog';
import {action, PublicHeader} from '../public/PublicSite';
import SignIn from './SignIn';
import type {ScopeController, ScopeState} from './scope';
import {
  answerErrors, clearDraft, clearPending, emptyAnswers, pendingIntent, readDraft, rememberIntent, saveDraft,
  setupSteps, stepIndex, type Answers, type Intent, type SetupStep,
} from './setup-state';
import './access.css';
import '../public/public-site.css';

/**
 * Individual setup: plan, verified contact, shop details, review, payment and the open shop.
 *
 * Layout and states are adapted from the 21st.dev "Onboarding Wizard Form" (cnippet-dev/v-form-8):
 * a numbered step indicator that ticks off finished steps, one form per step with Back and
 * Continue side by side, a divided review list before the consequential action, and a success
 * state with a single check mark. The selected-plan card stays beside every step.
 *
 * What it rests on is the existing backend, unchanged:
 * - the account step is the existing OTP challenge (`/auth/challenges`), which only delivers a
 *   code to a contact ShippingCo has already enrolled (ADR 0011);
 * - the shop is the existing idempotent `POST /api/v1/onboarding`, with the same request-key
 *   recovery the old setup card had;
 * - there is no payment provider and no price, so the payment step says so and takes nothing.
 * The shop is shown as open only after the server's context says it is ready.
 */

function toTop() {
  try { if (typeof window.scrollTo === 'function') window.scrollTo({top: 0}); } catch { /* no layout to scroll */ }
}

type Failure = 'validate' | 'offline' | 'changed' | 'unknown' | null;
const failureCopy: Record<Exclude<Failure, null>, string> = {
  validate: 'Your shop was not created. Check the business and branch details, then try again. Nothing you typed was lost.',
  offline: 'Cannot reach ShippingCo. Check the shop’s internet, then press the button again. Nothing you typed was lost.',
  changed: 'Your access changed while this was saving. Check again to see whether your shop was created.',
  unknown: 'We do not know whether your shop was created. Press the button again — it checks the same request and cannot create a second shop.',
};

/** Adapted from the v-form-8 step indicator: done steps carry a tick, the current one a ring. */
function SetupProgress({current}: {current: SetupStep}) {
  const now = stepIndex(current);
  return <div className="mt-6">
    <p className="m-0 text-[15px] font-semibold text-[var(--text-secondary)] sm:hidden" aria-hidden="true">
      Step {now + 1} of {setupSteps.length} · {setupSteps[now]!.label}
    </p>
    <ol aria-label="Setup progress" className="m-0 mt-2 flex list-none items-center gap-2 p-0 sm:mt-0">
      {setupSteps.map((item, index) => {
        // Once the shop is open, every step is finished, the last one included.
        const finished = current === 'done', done = index < now || finished, here = index === now && !finished;
        return <li key={item.id} aria-current={here ? 'step' : undefined}
          className={cn('flex min-w-0 items-center gap-2', index < setupSteps.length - 1 && 'flex-1')}>
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-[15px] font-semibold',
            done ? 'bg-primary text-primary-foreground' : here ? 'border-2 border-primary text-[var(--text-accent)]' : 'border border-border text-[var(--text-secondary)]')}>
            {done ? <Msym name="check" size={18}/> : index + 1}
          </span>
          <span className={cn('hidden whitespace-nowrap text-[15px] sm:inline', here ? 'font-semibold text-foreground' : 'text-[var(--text-secondary)]')}>
            {item.label}<span className="sr-only">{done ? ', done' : here ? ', current step' : ''}</span>
          </span>
          <span className="sr-only sm:hidden">{item.label}{done ? ', done' : here ? ', current step' : ''}</span>
          {index < setupSteps.length - 1 && <span aria-hidden="true" className={cn('h-px min-w-3 flex-1', done ? 'bg-primary' : 'bg-border')}/>}
        </li>;
      })}
    </ol>
  </div>;
}

/** The plan, beside every step, so the choice is never out of sight. */
function PlanSummary({compact}: {compact?: boolean}) {
  return <div className="rounded-2xl border border-border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p className="m-0 text-[15px] text-[var(--text-secondary)]">Selected plan</p>
        <p className="m-0 text-[20px] font-semibold leading-7 text-foreground">{individual.name}</p>
      </div>
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-subtle)] px-3 py-0.5 text-[15px] font-semibold text-[var(--accent-on-subtle)]">
        <Msym name="check_circle" size={17}/>Available now
      </span>
    </div>
    {!compact && <p className="m-0 mt-3 text-[15px] leading-[22px] text-[var(--text-secondary)]">{individual.summary}</p>}
    <dl className="m-0 mt-4 grid gap-2 text-[15px] leading-[22px]">
      <div className="flex justify-between gap-3"><dt className="text-[var(--text-secondary)]">Price</dt><dd className="m-0 text-right font-semibold">{priceNotSet.label}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-[var(--text-secondary)]">Charged at setup</dt><dd className="m-0 text-right font-semibold">Nothing</dd></div>
    </dl>
    <Link to="/pricing" className={cn(action.quiet, '-ml-3 mt-2')}>Compare plans</Link>
  </div>;
}

function StepHead({title, lead}: {title: string; lead?: React.ReactNode}) {
  return <div className="mb-6">
    <h2 id="setup-step-title" tabIndex={-1} className="m-0 text-[22px] font-bold leading-7 tracking-[-0.02em] text-foreground">{title}</h2>
    {lead && <p className="m-0 mt-2 text-[15px] leading-[22px] text-[var(--text-secondary)]">{lead}</p>}
  </div>;
}

function Actions({children}: {children: React.ReactNode}) {
  return <div className="mt-8 flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">{children}</div>;
}

function Notice({tone = 'info', icon, title, children}: {tone?: 'info' | 'success' | 'danger'; icon: string; title?: string; children: React.ReactNode}) {
  return <div className={cn('flex gap-3 rounded-xl border p-4 text-[15px] leading-[22px]',
    tone === 'success' ? 'border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success-on-subtle)]'
      : tone === 'danger' ? 'border-[var(--danger)] bg-[var(--danger-subtle)] text-[var(--danger-on-subtle)]'
      : 'border-border bg-[var(--surface-sunken)] text-foreground')}>
    <Msym name={icon} size={22} className="shrink-0"/>
    <div className="min-w-0">{title && <p className="m-0 font-semibold">{title}</p>}<div className={cn(title && 'mt-1')}>{children}</div></div>
  </div>;
}

/** A labelled field whose hint and refusal are both read with it. */
function SetupField({id, label, hint, error, children}: {id: string; label: string; hint?: string; error?: string; children: (describedBy: string | undefined) => React.ReactNode}) {
  const describedBy = [error && id + '-error', hint && id + '-hint'].filter(Boolean).join(' ') || undefined;
  return <div className="access-field">
    <label className="access-label" htmlFor={id}>{label}</label>
    {children(describedBy)}
    {error && <p id={id + '-error'} className="access-error"><Msym name="error"/><span>{error}</span></p>}
    {hint && <p id={id + '-hint'} className="access-hint">{hint}</p>}
  </div>;
}

/** Said before a code is asked for, to everyone: it never reveals whether a number is enrolled. */
function EnrolmentNote() {
  return <Notice icon="info" title="Online sign-up is not open yet">
    A code is only sent to a phone number or email that ShippingCo has already enrolled. If no code
    arrives within a minute, ShippingCo needs to enrol your number or email before you can continue.
  </Notice>;
}

export default function IndividualSetup({controller, state, opened, signedIn, retry, signOut, markOpened, finish}: {
  controller: ScopeController; state: ScopeState;
  /** Set once the server has accepted this person's onboarding request in this session. */
  opened: boolean;
  signedIn: () => Promise<void>; retry: () => Promise<void>; signOut: () => void;
  markOpened: () => void; finish: (path: string) => void;
}) {
  const context = state.context;
  const checking = state.status === 'loading' && !context;
  const signedOut = state.status === 'signed_out';
  const userId = context?.user_id;
  const eligible = context?.state === 'onboarding_required';
  const [step, setStep] = useState<SetupStep | null>(null);
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Answers, string>>>({});
  const [failure, setFailure] = useState<Failure>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState('');
  const [contact, setContact] = useState<{channel: string; address: string} | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const loadedFor = useRef<string | null>(null);
  const moved = useRef(false);
  const ids = useId();

  // Decide where to start once the server has said who, if anyone, is signed in.
  useEffect(() => {
    if (checking || step !== null) return;
    if (eligible && userId) {
      const kept = pendingIntent(userId), draft = readDraft(userId);
      setStep(kept ? 'payment' : draft && stepIndex(draft.step) >= stepIndex('shop') && draft.step !== 'done' ? draft.step : 'shop');
    } else setStep(opened ? 'done' : 'plan');
  }, [checking, step, eligible, userId, opened]);

  // The answers belong to one verified person. Load theirs, and only theirs.
  useEffect(() => {
    if (!eligible || !userId || loadedFor.current === userId) return;
    loadedFor.current = userId;
    const kept = pendingIntent(userId), draft = readDraft(userId);
    setIntent(kept);
    setAnswers(kept ? {name: kept.body.display_name, location: kept.body.franchise.display_name, code: kept.body.franchise.franchise_code}
      : draft ? {name: draft.name, location: draft.location, code: draft.code} : emptyAnswers);
    setCodeOpen(!!draft && draft.code !== 'MAIN');
    // Verifying on the account step moves straight on to the next unanswered step.
    setStep(current => current === 'account' ? (kept ? 'payment' : draft && stepIndex(draft.step) > stepIndex('account') && draft.step !== 'done' ? draft.step : 'shop') : current);
  }, [eligible, userId]);

  // A session that ends mid-setup keeps the answers on this device but takes them off screen.
  useEffect(() => {
    if (!signedOut) return;
    if (loadedFor.current) {
      setNotice('Your sign-in ended. Verify your phone or email again to continue. Your shop answers are kept on this device.');
    }
    loadedFor.current = null;
    setAnswers(emptyAnswers); setIntent(null); setContact(null); setErrors({}); setFailure(null); setSaved('');
    setStep(current => current && stepIndex(current) > stepIndex('account') ? 'account' : current);
  }, [signedOut]);

  // Who the code went to, shown back as proof the contact works for the next sign-in.
  useEffect(() => {
    if (!userId || !eligible) return;
    const abort = new AbortController();
    void controller.source.contacts(abort.signal).then(result => {
      const chosen = result.contacts.find(item => item.channel === 'whatsapp') ?? result.contacts[0];
      if (!abort.signal.aborted) setContact(chosen ?? null);
    }).catch(() => { /* the step is still correct without it */ });
    return () => abort.abort();
  }, [controller, userId, eligible]);

  // Arriving from the website keeps no scroll position from it: the page starts at its title.
  useEffect(() => {
    toTop();
    document.getElementById('onboarding-title')?.focus({preventScroll: true});
  }, []);
  // A step change starts at the top, with the progress in view, and moves focus to the step's
  // heading so a screen reader hears where it is.
  useEffect(() => {
    if (!step) return;
    document.title = (setupSteps[stepIndex(step)]?.title ?? 'Set up your shop') + ' · Set up your shop · ShippingCo';
    if (!moved.current) { moved.current = true; if (step !== 'done') return; }
    toTop();
    (document.getElementById('setup-step-title') ?? document.getElementById('signin-title'))?.focus({preventScroll: true});
  }, [step]);

  function go(next: SetupStep) {
    setFailure(current => current === 'validate' && next === 'shop' ? current : null);
    setSaved('');
    setStep(next);
    if (userId && eligible && next !== 'done' && stepIndex(next) >= stepIndex('shop')) saveDraft(userId, {...answers, step: next});
  }
  function change(field: keyof Answers, value: string) {
    const next = {...answers, [field]: value};
    setAnswers(next); setSaved('');
    setErrors(current => { const rest = {...current}; delete rest[field]; return rest; });
    if (userId && eligible) saveDraft(userId, {...next, step: step ?? 'shop'});
  }
  function checkAnswers() {
    const found = answerErrors(answers);
    setErrors(found);
    const first = (['name', 'location', 'code'] as const).find(key => found[key]);
    if (first === 'code') setCodeOpen(true);
    if (first) { window.setTimeout(() => document.getElementById(ids + '-' + first)?.focus(), 0); return false; }
    return true;
  }

  async function open() {
    if (busy || !userId) return;
    if (Object.keys(answerErrors(answers)).length) { setStep('shop'); window.setTimeout(checkAnswers, 0); return; }
    const command = intent ?? {key: crypto.randomUUID(), body: {display_name: answers.name, franchise: {display_name: answers.location, franchise_code: answers.code}}};
    setIntent(command); rememberIntent(userId, command); setBusy(true); setFailure(null);
    try {
      const approved = controller.source.onboardingIntent(command.body, controller.runtime.ticket(), command.key);
      await controller.command(() => controller.source.onboard(approved, controller.runtime.ticket));
      clearDraft(userId);
      markOpened();
      setStep('done');
      await retry();
    } catch (error) {
      if (!(error instanceof ApiFailure)) setFailure('unknown');
      else if (error.code === 'UNAUTHENTICATED') { /* the signed-out effect takes the person back to verification */ }
      else if (recoveryFor(error, true) === 'validate') { setIntent(null); clearPending(userId); setFailure('validate'); setStep('shop'); }
      else if (error.kind === 'network') setFailure('offline');
      else if (['conflict', 'refresh', 'unavailable'].includes(recoveryFor(error, true))) setFailure('changed');
      else setFailure('unknown');
    } finally { setBusy(false); }
  }

  const header = <PublicHeader visitor={signedOut ? 'signed_out' : 'setup'}>
    <Link to="/pricing" className={action.quiet}><Msym name="arrow_back"/>Plans</Link>
  </PublicHeader>;
  const frame = (content: React.ReactNode, current: SetupStep = step ?? 'plan') => <div className="setup-page">
    {header}
    <main id="setup-main" className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6 md:pt-12">
      <p className="m-0 text-[15px] font-semibold text-[var(--text-accent)]">Individual plan</p>
      <h1 id="onboarding-title" tabIndex={-1} className="m-0 mt-1 text-[clamp(28px,4vw,36px)] font-bold leading-tight tracking-[-0.03em] text-foreground">Set up your shop</h1>
      <SetupProgress current={current}/>
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="lg:hidden"><PlanSummary compact/></div>
        <section aria-labelledby={current === 'account' && signedOut ? 'signin-title' : 'setup-step-title'}
          className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgb(16_40_66/.04)] sm:p-8">
          {content}
        </section>
        <aside aria-label="Selected plan" className="hidden lg:sticky lg:top-24 lg:block"><PlanSummary/></aside>
      </div>
    </main>
  </div>;

  // A shop that already exists is the dashboard's business, not this flow's.
  if (context?.state === 'ready' && !opened) return <Navigate to="/business" replace/>;

  if (checking || step === null) return frame(<p role="status" className="m-0 flex items-center gap-3 text-[15px] text-[var(--text-secondary)]">
    <Msym name="pending" size={22}/>{opened ? 'Opening your shop…' : 'Checking whether you are already signed in…'}
  </p>, opened ? 'done' : step ?? 'plan');

  if (state.status === 'error') {
    const unreachable = state.reason === 'unreachable';
    return frame(<>
      <StepHead title={unreachable ? 'Cannot reach the server' : 'Workspace access unavailable'}/>
      <Notice tone="danger" icon={unreachable ? 'error' : 'lock_reset'}>
        {opened ? 'ShippingCo accepted your shop, but it could not be loaded yet. Nothing needs to be typed again.'
          : unreachable ? 'The internet or the server did not answer. Nothing you typed was lost.'
          : 'Your session or access may have changed. Try again, or sign in again.'}
      </Notice>
      <Actions><span/><button type="button" className={action.primary} onClick={() => { void retry(); }}>Try again</button></Actions>
    </>, opened ? 'done' : step);
  }

  if (context?.state === 'scope_unavailable') return frame(<>
    <StepHead title="This account cannot open a new shop"/>
    <Notice icon="storefront">
      This account already belongs, or used to belong, to a shop, so ShippingCo will not open another one for it.
      Ask the shop owner to invite you, or sign out and verify a different phone number or email.
    </Notice>
    <Actions><Link to="/pricing" className={action.secondary}>Back to plans</Link>
      <button type="button" className={action.primary} onClick={signOut}><Msym name="logout"/>Sign out</button></Actions>
  </>, 'account');

  if (step === 'done') {
    const shop = context?.state === 'ready' ? context.franchises.find(item => item.id === context.active_franchise_id) ?? context.franchises[0] : undefined;
    if (!shop) return frame(<p role="status" className="m-0 flex items-center gap-3 text-[15px] text-[var(--text-secondary)]"><Msym name="pending" size={22}/>Opening your shop…</p>, 'done');
    return frame(<div className="flex flex-col items-center gap-5 py-4 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-[var(--success-subtle)] text-[var(--success)]"><Msym name="check_circle" size={32} fill/></span>
      <div>
        <h2 id="setup-step-title" tabIndex={-1} className="m-0 text-[24px] font-bold leading-8 tracking-[-0.02em] text-foreground">Your shop is open</h2>
        <p className="m-0 mt-2 text-[15px] leading-[22px] text-[var(--text-secondary)]">ShippingCo confirmed your business and first branch.</p>
      </div>
      <dl className="m-0 w-full max-w-md divide-y divide-border rounded-xl border border-border text-left text-[15px]">
        {[['Business', shop.organization.display_name], ['Branch', shop.display_name], ['Plan', individual.name], ['Payment', 'None taken']].map(([label, value]) =>
          <div key={label} className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-[var(--text-secondary)]">{label}</dt><dd className="m-0 min-w-0 break-words text-right font-semibold">{value}</dd></div>)}
      </dl>
      <p className="m-0 max-w-md text-[15px] leading-[22px] text-[var(--text-secondary)]">
        Your counter opens empty, ready for the first booking. Two things are not set up yet and the counter will
        say so when it needs them: what you charge, and whether you charge GST. Both are in Settings.
      </p>
      <div className="flex w-full max-w-md flex-col gap-3 sm:flex-row">
        <button type="button" className={cn(action.secondary, 'flex-1')} onClick={() => finish('/business/settings')}>Open Settings</button>
        <button type="button" className={cn(action.primary, 'flex-1')} onClick={() => finish('/business')}>Go to your dashboard<Msym name="arrow_forward"/></button>
      </div>
    </div>, 'done');
  }

  if (step === 'plan') return frame(<>
    <StepHead title="Your plan" lead={<>You chose <strong className="text-foreground">Individual</strong>. {individual.summary}</>}/>
    <Notice icon="sell" title={priceNotSet.label}>{priceNotSet.detail}</Notice>
    <div className="mt-6 grid gap-6 md:grid-cols-2">
      <div>
        <h3 className="m-0 text-[17px] font-semibold text-foreground">What your shop can use</h3>
        <ul className="m-0 mt-3 flex list-none flex-col gap-2.5 p-0">
          {individual.includes.map(item => <li key={item} className="flex items-start gap-2.5 text-[15px] leading-[22px]">
            <Msym name="check" size={20} className="shrink-0 text-[var(--accent)]"/>{item}</li>)}
        </ul>
      </div>
      <div>
        <h3 className="m-0 text-[17px] font-semibold text-foreground">What happens next</h3>
        <ol className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
          {[['Verify your phone or email', 'We send an 8-digit code. The same contact signs you in next time.'],
            ['Shop details', 'Your business name and your first branch.'],
            ['Review', 'Check everything before payment.'],
            ['Payment', 'Online payment is not connected yet, so nothing is charged.'],
            ['Open your shop', 'Your counter is ready for the first booking.']].map(([title, text], index) =>
            <li key={title} className="flex gap-3 text-[15px] leading-[22px]">
              <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full border border-border font-semibold text-[var(--text-secondary)]">{index + 2}</span>
              <span><strong className="block font-semibold text-foreground">{title}</strong><span className="text-[var(--text-secondary)]">{text}</span></span>
            </li>)}
        </ol>
      </div>
    </div>
    <Actions>
      <Link to="/pricing" className={action.secondary}><Msym name="arrow_back"/>Back to plans</Link>
      <button type="button" className={action.primary} onClick={() => go('account')}>Continue<Msym name="arrow_forward"/></button>
    </Actions>
  </>);

  if (step === 'account') {
    if (signedOut) return frame(<>
      {notice && <div className="mb-5"><Notice tone="danger" icon="lock_reset">{notice}</Notice></div>}
      <SignIn variant="setup" source={controller.source} complete={async () => { setNotice(''); await signedIn(); }} note={<EnrolmentNote/>}/>
      <Actions><button type="button" className={action.secondary} onClick={() => go('plan')}><Msym name="arrow_back"/>Back</button><span/></Actions>
    </>);
    return frame(<>
      <StepHead title="Verify your phone or email" lead="This is the contact you sign in with next time."/>
      <Notice tone="success" icon="check_circle" title="Verified">
        {contact ? <>You are signed in as <strong className="break-all">{contact.address}</strong>.</> : 'You are signed in.'}
      </Notice>
      <p className="m-0 mt-4 text-[15px] leading-[22px] text-[var(--text-secondary)]">Not you?{' '}
        <button type="button" className={cn(action.quiet, 'px-1')} onClick={signOut}>Sign out and use another number or email</button></p>
      <Actions>
        <button type="button" className={action.secondary} onClick={() => go('plan')}><Msym name="arrow_back"/>Back</button>
        <button type="button" className={action.primary} onClick={() => go('shop')}>Continue<Msym name="arrow_forward"/></button>
      </Actions>
    </>);
  }

  const locked = busy || !!intent;
  if (step === 'shop') return frame(<form noValidate aria-label="Shop details" onSubmit={event => { event.preventDefault(); if (checkAnswers()) go('review'); }}>
    <StepHead title="Shop details" lead="Two names and an optional code. This is everything ShippingCo needs to open your shop."/>
    {failure === 'validate' && <div className="mb-5" role="alert"><Notice tone="danger" icon="error">{failureCopy.validate}</Notice></div>}
    {intent && <div className="mb-5"><Notice icon="lock">Your answers are kept unchanged while the earlier request is checked. Continue to finish it.</Notice></div>}
    <div className="grid gap-5">
      <SetupField id={ids + '-name'} label="Business name" hint="This is the name on your receipts." error={errors.name}>
        {describedBy => <input id={ids + '-name'} className="access-input" name="organization" autoComplete="organization" maxLength={120}
          placeholder="Shree Balaji Courier" value={answers.name} disabled={locked} aria-invalid={!!errors.name || undefined}
          aria-describedby={describedBy} onChange={event => change('name', event.target.value)}/>}
      </SetupField>
      <SetupField id={ids + '-location'} label="Branch name" hint="The shop you are standing in." error={errors.location}>
        {describedBy => <input id={ids + '-location'} className="access-input" name="location" autoComplete="off" maxLength={120}
          placeholder="Pune main shop" value={answers.location} disabled={locked} aria-invalid={!!errors.location || undefined}
          aria-describedby={describedBy} onChange={event => change('location', event.target.value)}/>}
      </SetupField>
      <details open={codeOpen} onToggle={event => setCodeOpen(event.currentTarget.open)} className="setup-code">
        <summary className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-[15px] font-semibold text-[var(--text-link)]">
          <Msym name="expand_more" size={20} className="setup-code-mark"/>Branch code · optional
        </summary>
        <div className="mt-2">
          <SetupField id={ids + '-code'} label="Branch code" error={errors.code}
            hint={errors.code ? undefined : 'MAIN is filled in for your first branch. Change it only if your business already uses another code.'}>
            {describedBy => <input id={ids + '-code'} className="access-input" name="location-code" autoComplete="off" autoCapitalize="characters"
              spellCheck={false} maxLength={32} placeholder="PUNE_1" value={answers.code} disabled={locked}
              aria-invalid={!!errors.code || undefined} aria-describedby={describedBy} onChange={event => change('code', event.target.value)}/>}
          </SetupField>
        </div>
      </details>
    </div>
    {saved && <p role="status" className="m-0 mt-5 flex items-center gap-2 text-[15px] text-[var(--success)]"><Msym name="check_circle" size={20}/>{saved}</p>}
    <Actions>
      <button type="button" className={action.secondary} onClick={() => go('account')}><Msym name="arrow_back"/>Back</button>
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <button type="button" className={action.quiet} onClick={() => {
          if (userId && saveDraft(userId, {...answers, step: 'shop'})) setSaved('Saved on this device. Sign in here again and setup opens at this step.');
          else setSaved('');
        }}><Msym name="save"/>Save and finish later</button>
        <button type="submit" className={action.primary}>Continue<Msym name="arrow_forward"/></button>
      </div>
    </Actions>
  </form>);

  if (step === 'review') return frame(<>
    <StepHead title="Review before payment" lead="Check your plan and shop. You can change anything before you continue."/>
    <dl className="m-0 divide-y divide-border rounded-xl border border-border text-[15px]">
      {([
        ['Plan', 'Individual · Available now', () => go('plan')],
        ['Price', priceNotSet.label, null],
        ['Signs in with', contact?.address ?? 'Your verified contact', null],
        ['Business name', answers.name, () => go('shop')],
        ['Branch name', answers.location, () => go('shop')],
        ['Branch code', answers.code, () => { setCodeOpen(true); go('shop'); }],
      ] as const).map(([label, value, edit]) =>
        <div key={label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
          <dt className="text-[var(--text-secondary)]">{label}</dt>
          <dd className="m-0 flex min-w-0 items-center gap-2 font-semibold text-foreground">
            <span className="min-w-0 break-all">{value}</span>
            {edit && !locked && <button type="button" className={cn(action.quiet, 'px-2')} onClick={edit} aria-label={'Change ' + label.toLowerCase()}>Change</button>}
          </dd>
        </div>)}
    </dl>
    <Actions>
      <button type="button" className={action.secondary} onClick={() => go('shop')}><Msym name="arrow_back"/>Back</button>
      <button type="button" className={action.primary} onClick={() => go('payment')}>Continue to payment<Msym name="arrow_forward"/></button>
    </Actions>
  </>);

  // Payment: nothing is connected, so nothing is charged and nothing is asked for.
  return frame(<>
    <StepHead title="Payment"/>
    <Notice icon="account_balance_wallet" title="Online payment is not connected yet">
      ShippingCo has not set up a payment provider or a price for the Individual plan. You will not be asked
      for card, UPI or bank details, and nothing is charged.
    </Notice>
    <dl className="m-0 mt-5 divide-y divide-border rounded-xl border border-border text-[15px]">
      {[['Plan', individual.name], ['Price', priceNotSet.label], ['Charged today', 'Nothing']].map(([label, value]) =>
        <div key={label} className="flex items-center justify-between gap-4 px-4 py-3"><dt className="text-[var(--text-secondary)]">{label}</dt><dd className="m-0 text-right font-semibold">{value}</dd></div>)}
    </dl>
    <p className="m-0 mt-5 text-[15px] leading-[22px] text-[var(--text-secondary)]">
      Open my shop asks ShippingCo to create <strong className="text-foreground">{answers.name || 'your business'}</strong> and
      its first branch. The shop opens only after ShippingCo confirms it.
    </p>
    {failure && failure !== 'validate' && <div className="mt-5" role="alert"><Notice tone="danger" icon="error" title="Your shop is not open yet">
      <p className="m-0">{failureCopy[failure]}</p>
      {userId && <p className="m-0 mt-2">If it keeps failing, give ShippingCo this account reference: <span className="break-all font-mono">{userId}</span></p>}
    </Notice></div>}
    {intent && !busy && !failure && <p className="m-0 mt-4 text-[15px] text-[var(--text-secondary)]">Your answers are kept unchanged while the earlier request is checked.</p>}
    <Actions>
      <button type="button" className={action.secondary} disabled={busy} onClick={() => go('review')}><Msym name="arrow_back"/>Back</button>
      <button type="button" className={action.primary} disabled={busy} aria-busy={busy} onClick={() => { void open(); }}>
        {busy ? 'Opening your shop…' : intent ? 'Check whether it saved' : 'Open my shop'}
      </button>
    </Actions>
    <p role="status" aria-live="polite" className="sr-only">{busy ? 'Saving your business and branch.' : ''}</p>
  </>);
}
