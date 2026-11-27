import React, {useEffect, useId, useRef, useState} from 'react';
import {Link, useLocation} from 'react-router-dom';
import {Msym} from '../components/m3/Icon';
import {cn} from '@/lib/utils';
import {ParcelMark} from '../operator/AccessLayout';
import {CounterScene, DispatchScene, HandoverScene} from '../operator/access-illustrations';
import {capabilities, plans, priceNotSet, product, stages, type Plan} from './catalog';
import './public-site.css';

/**
 * The public website: what ShippingCo is, how the work flows, and the two plans.
 *
 * Built from 21st.dev patterns adapted to this product's own vocabulary — one blue for the
 * single most important action, white surfaces with one hairline, the sign-in panel's dark
 * ground for the drawn scenes, Material Symbols for icons, and the 15px / 44px floors that
 * every other screen holds. No decorative gradients and no invented figures.
 *
 * - Header: the 21st.dev "Classic Header with Sheet Menu" (ln-dev7/header-17) layout — logo,
 *   centred links, a quiet sign-in and one filled call to action — with the phone menu as a
 *   plain disclosure panel, so every target stays 44px and Escape closes it.
 * - Hero and capability grid: the 21st.dev "Feature Hero" (uilayout.contact/feature-hero)
 *   arrangement of heading, lead and icon cards.
 * - Plans: the 21st.dev "Two-Plan Pricing Cards" (ln-dev7/pricing-16), retrieved as code and
 *   rewritten so a plan with no configured price says so instead of showing a number.
 */

export type Visitor = 'checking' | 'signed_out' | 'signed_in' | 'setup';
export type Section = 'home' | 'features' | 'how-it-works' | 'pricing';

/** Paths that always show the public site, whatever the session. `/` is decided by the caller. */
export function siteSection(pathname: string): Section | null {
  if (pathname === '/features') return 'features';
  if (pathname === '/how-it-works') return 'how-it-works';
  if (pathname === '/pricing') return 'pricing';
  return null;
}

/** The three shapes of action on these pages. One filled button per view, at most. */
export const action = {
  primary: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-[15px] font-semibold leading-5 text-primary-foreground no-underline transition-colors hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-60 [&_.msym]:text-[20px]',
  secondary: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--border-strong)] bg-background px-5 text-[15px] font-semibold leading-5 text-foreground no-underline transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 [&_.msym]:text-[20px]',
  quiet: 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-[15px] font-semibold leading-5 text-[var(--text-link)] no-underline transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 [&_.msym]:text-[20px]',
} as const;

const navigation: readonly {to: string; label: string; section: Section}[] = [
  {to: '/features', label: 'What it does', section: 'features'},
  {to: '/how-it-works', label: 'How it works', section: 'how-it-works'},
  {to: '/pricing', label: 'Pricing', section: 'pricing'},
];

function account(visitor: Visitor) {
  if (visitor === 'signed_in') return {to: '/business', label: 'Open your dashboard'};
  if (visitor === 'setup') return {to: '/start/individual', label: 'Continue setup'};
  return {to: '/sign-in', label: 'Sign in'};
}

export function Brand() {
  return <Link to="/" aria-label="ShippingCo home"
    className="inline-flex min-h-11 items-center gap-2.5 rounded-lg text-foreground no-underline">
    <ParcelMark/><span className="text-[21px] font-bold tracking-[-0.04em]">ShippingCo</span>
  </Link>;
}

export function PublicHeader({visitor, current, children}: {visitor: Visitor; current?: Section; children?: React.ReactNode}) {
  const [open, setOpen] = useState(false);
  const menuId = useId(), toggle = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  useEffect(() => { setOpen(false); }, [location.pathname]);
  const signIn = account(visitor);
  // A setup page passes its own right-hand side; the site shows the full navigation.
  if (children) return <header className="public-header">
    <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"><Brand/>{children}</div>
  </header>;
  return <header className="public-header" onKeyDown={event => {
    if (event.key === 'Escape' && open) { setOpen(false); toggle.current?.focus(); }
  }}>
    <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
      <Brand/>
      <nav aria-label="Main" className="ml-auto hidden items-center gap-1 md:flex">
        {navigation.map(link => <Link key={link.to} to={link.to}
          aria-current={current === link.section ? 'location' : undefined}
          className="public-nav-link">{link.label}</Link>)}
      </nav>
      <div className="hidden items-center gap-2 md:flex">
        <Link to={signIn.to} className={action.quiet}>{signIn.label}</Link>
        <Link to="/pricing" className={action.primary}>See plans</Link>
      </div>
      <button ref={toggle} type="button" aria-expanded={open} aria-controls={menuId}
        className="public-menu-button ml-auto md:hidden" onClick={() => setOpen(value => !value)}>
        <Msym name={open ? 'close' : 'menu'}/><span>Menu</span>
      </button>
    </div>
    {open && <div id={menuId} className="border-t border-border bg-background md:hidden">
      <nav aria-label="Main" className="mx-auto grid max-w-6xl gap-1 px-4 py-3 sm:px-6">
        {navigation.map(link => <Link key={link.to} to={link.to}
          aria-current={current === link.section ? 'location' : undefined}
          className="public-nav-link">{link.label}</Link>)}
        <Link to={signIn.to} className="public-nav-link">{signIn.label}</Link>
        <Link to="/pricing" className={cn(action.primary, 'mt-2')}>See plans</Link>
      </nav>
    </div>}
  </header>;
}

/** One plan, adapted from 21st.dev "Two-Plan Pricing Cards" (ln-dev7/pricing-16). */
function PlanCard({plan}: {plan: Plan}) {
  const available = plan.status === 'available';
  const titleId = `plan-${plan.id}-title`, statusId = `plan-${plan.id}-status`;
  return <article aria-labelledby={titleId} aria-describedby={statusId}
    className={cn('relative flex flex-col gap-6 rounded-2xl border p-6 sm:p-7',
      available ? 'border-[var(--border-accent)] bg-card shadow-[0_1px_2px_rgb(16_40_66/.06)]' : 'border-border bg-[var(--surface-sunken)]')}>
    <span id={statusId} className={cn('absolute -top-3.5 left-6 inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-[15px] font-semibold leading-6',
      available ? 'bg-primary text-primary-foreground' : 'border border-border bg-background text-[var(--text-secondary)]')}>
      <Msym name={available ? 'check_circle' : 'schedule'} size={17}/>{available ? 'Available now' : 'Coming soon'}
    </span>
    <div className="flex flex-col gap-1.5 pt-1">
      <h3 id={titleId} className="m-0 text-[24px] font-semibold leading-8 tracking-[-0.02em] text-foreground">{plan.name}</h3>
      <p className="m-0 text-[15px] leading-[22px] text-[var(--text-secondary)]">{plan.summary}</p>
    </div>
    <div className="border-y border-border py-5">
      {available
        ? <><p className="m-0 text-[26px] font-semibold leading-8 tracking-[-0.02em] text-foreground">{priceNotSet.label}</p>
            <p className="m-0 mt-1.5 text-[15px] leading-[22px] text-[var(--text-secondary)]">{priceNotSet.detail}</p></>
        : <><p className="m-0 text-[26px] font-semibold leading-8 tracking-[-0.02em] text-[var(--text-secondary)]">No price yet</p>
            <p className="m-0 mt-1.5 text-[15px] leading-[22px] text-[var(--text-secondary)]">No price, features or billing have been set for this plan, so it cannot be chosen or bought yet.</p></>}
    </div>
    {available && <div>
      <p className="m-0 mb-3 text-[15px] font-semibold text-foreground">What your shop can use</p>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
        {plan.includes.map(item => <li key={item} className="flex items-start gap-2.5 text-[15px] leading-[22px] text-foreground">
          <Msym name="check" size={20} className="shrink-0 text-[var(--accent)]"/>{item}
        </li>)}
      </ul>
    </div>}
    {available
      ? <Link to="/start/individual" className={cn(action.primary, 'mt-auto w-full')}>Choose Individual<Msym name="arrow_forward"/></Link>
      : <p className="m-0 mt-auto flex min-h-11 items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] text-[15px] font-semibold text-[var(--text-secondary)]">
          <Msym name="lock" size={20}/>Not available to choose yet
        </p>}
  </article>;
}

export function PricingPlans() {
  return <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-5">
    {plans.map(plan => <PlanCard key={plan.id} plan={plan}/>)}
  </div>;
}

const scenes = [CounterScene, DispatchScene, HandoverScene];

function SectionHead({id, kicker, title, lead}: {id: string; kicker: string; title: string; lead?: string}) {
  return <div className="mx-auto mb-10 max-w-2xl text-center">
    <p className="m-0 text-[15px] font-semibold text-[var(--text-accent)]">{kicker}</p>
    <h2 id={id} tabIndex={-1} className="m-0 mt-2 text-balance text-[clamp(26px,3.4vw,36px)] font-bold leading-[1.15] tracking-[-0.03em] text-foreground">{title}</h2>
    {lead && <p className="m-0 mt-3 text-pretty text-[17px] leading-7 text-[var(--text-secondary)]">{lead}</p>}
  </div>;
}

export function PublicFooter() {
  return <footer className="border-t border-border bg-background">
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex flex-col gap-1"><Brand/><p className="m-0 text-[15px] text-[var(--text-secondary)]">Courier counter software for Indian courier shops.</p></div>
      <nav aria-label="Footer" className="flex flex-wrap gap-1">
        <Link to="/pricing" className={action.quiet}>Pricing</Link>
        <Link to="/sign-in" className={action.quiet}>Sign in</Link>
      </nav>
    </div>
  </footer>;
}

export default function PublicSite({visitor, section}: {visitor: Visitor; section: Section}) {
  const location = useLocation();
  const first = useRef(true);
  const signIn = account(visitor);
  useEffect(() => {
    const initial = first.current; first.current = false;
    const target = section === 'home' ? null : document.getElementById(section);
    const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (target) {
      if (typeof target.scrollIntoView === 'function') target.scrollIntoView({behavior: reduced || initial ? 'auto' : 'smooth', block: 'start'});
      document.getElementById(section + '-title')?.focus({preventScroll: true});
    } else if (!initial) {
      if (typeof window.scrollTo === 'function') try { window.scrollTo({top: 0}); } catch { /* jsdom */ }
      document.getElementById('home-title')?.focus({preventScroll: true});
    }
  }, [section, location.key]);
  return <div className="public-site">
    <a href="#home-title" className="public-skip" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <PublicHeader visitor={visitor} current={section}/>
    <main id="main-content" tabIndex={-1} className="outline-none">
      <section aria-labelledby="home-title" className="border-b border-border">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.05fr_1fr] md:py-20">
          <div className="min-w-0">
            <p className="m-0 inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-[15px] font-medium text-[var(--text-secondary)]">
              <Msym name="local_shipping" size={18}/>{product.audience}
            </p>
            <h1 id="home-title" tabIndex={-1} className="m-0 mt-5 text-balance text-[clamp(32px,5vw,52px)] font-bold leading-[1.06] tracking-[-0.035em] text-foreground">{product.headline}</h1>
            <p className="m-0 mt-5 max-w-[62ch] text-pretty text-[17px] leading-7 text-[var(--text-secondary)]">{product.lead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/pricing" className={action.primary}>See plans<Msym name="arrow_forward"/></Link>
              <Link to={signIn.to} className={action.secondary}>{signIn.label}</Link>
            </div>
          </div>
          <figure className="public-scene m-0">
            <CounterScene/>
            <figcaption className="mt-4"><span className="public-scene-name block">{stages[0].name}</span>
              <span className="mt-1 block text-[19px] font-medium leading-7">{stages[0].caption}</span></figcaption>
          </figure>
        </div>
      </section>

      <section id="features" aria-labelledby="features-title" className="public-section border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
          <SectionHead id="features-title" kicker="What it does" title="One counter for booking, dispatch, delivery and money"
            lead="Each of these is a working screen in ShippingCo today."/>
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {capabilities.map(item => <li key={item.title} className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6">
              <span className="grid size-11 place-items-center rounded-xl bg-[var(--accent-subtle)] text-[var(--accent)]"><Msym name={item.icon} size={24}/></span>
              <h3 className="m-0 text-[17px] font-semibold leading-6 text-foreground">{item.title}</h3>
              <p className="m-0 text-[15px] leading-[22px] text-[var(--text-secondary)]">{item.text}</p>
            </li>)}
          </ul>
        </div>
      </section>

      <section id="how-it-works" aria-labelledby="how-it-works-title" className="public-section border-b border-border bg-[var(--surface-sunken)]">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 md:py-20">
          <SectionHead id="how-it-works-title" kicker="How it works" title="From the counter to the customer’s door"/>
          <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
            {stages.map((stage, index) => {
              const Scene = scenes[index]!;
              return <li key={stage.name} className="public-scene flex flex-col">
                <Scene/>
                <p className="public-scene-name m-0 mt-4 flex items-center gap-2">
                  <span className="public-scene-step" aria-hidden="true">{index + 1}</span>{stage.name}
                </p>
                <p className="m-0 mt-2 text-[17px] font-medium leading-6">{stage.caption}</p>
              </li>;
            })}
          </ol>
        </div>
      </section>

      <section id="pricing" aria-labelledby="pricing-title" className="public-section border-b border-border">
        <div className="mx-auto max-w-4xl px-4 py-14 sm:px-6 md:py-20">
          <SectionHead id="pricing-title" kicker="Pricing" title="Two plans. One is ready today."
            lead="Choose Individual to set up your own shop now. Franchise is not configured yet."/>
          <PricingPlans/>
          <p className="m-0 mt-8 text-center text-[15px] leading-[22px] text-[var(--text-secondary)]">
            Prices and billing are not configured in ShippingCo yet. Nothing on this site takes a payment.
          </p>
        </div>
      </section>

      <section aria-labelledby="start-title" className="public-section">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-5 px-4 py-14 text-center sm:px-6 md:py-20">
          <h2 id="start-title" className="m-0 text-balance text-[clamp(24px,3vw,32px)] font-bold leading-tight tracking-[-0.03em] text-foreground">Ready to set up your shop?</h2>
          <p className="m-0 max-w-xl text-[17px] leading-7 text-[var(--text-secondary)]">Verify your phone or email, name your business and first branch, review, and open your counter.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/start/individual" className={action.primary}>Set up your shop<Msym name="arrow_forward"/></Link>
            <Link to={signIn.to} className={action.secondary}>{visitor === 'signed_out' || visitor === 'checking' ? 'I already have an account' : signIn.label}</Link>
          </div>
        </div>
      </section>
    </main>
    <PublicFooter/>
  </div>;
}
