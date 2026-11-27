import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import type {OperatorContext} from '@shippingco/shared';
import App from '../App';

const user = '00000000-0000-4000-8000-000000000003', A = '00000000-0000-4000-8000-000000000001';
const empty: OperatorContext = {user_id: user, state: 'onboarding_required', active_franchise_id: null, franchises: []};
const ready: OperatorContext = {user_id: user, state: 'ready', active_franchise_id: A, franchises: [{id: A, display_name: 'Counter A',
  organization: {id: '00000000-0000-4000-8000-000000000004', display_name: 'Synthetic shop'}, roles: ['org_admin']}]};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
let context: OperatorContext | null = null;
let calls: {path: string; options: RequestInit}[] = [];

beforeEach(() => {
  window.location.hash = '/'; sessionStorage.clear(); localStorage.clear(); context = null; calls = [];
  vi.stubEnv('VITE_DATA_MODE', 'production');
  vi.stubGlobal('fetch', vi.fn(async (path: string, options: RequestInit = {}) => {
    calls.push({path, options});
    if (path === '/auth/bootstrap') return json({csrf_token: 'synthetic-csrf'});
    if (path.startsWith('/api/v1/operator-context')) return context ? json(context) : json({error: {code: 'UNAUTHENTICATED'}}, 401);
    if (path === '/auth/challenges') return json({challenge_id: 'synthetic-challenge', resend_after: 60});
    if (path === '/auth/challenges/verify') { context = empty; return json({authenticated: true}); }
    if (path === '/auth/contacts') return json({contacts: [{channel: 'whatsapp', address: '+919876543210'}]});
    if (path === '/api/v1/onboarding') { context = ready; return json({role: 'org_admin'}, 201); }
    throw new Error('Unexpected synthetic request');
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('shows a visitor what ShippingCo does, with Individual available and Franchise not configured', async () => {
  render(<App/>);
  await screen.findByRole('heading', {level: 1, name: /Book a parcel once/});
  const nav = screen.getAllByRole('navigation', {name: 'Main'})[0]!;
  expect(within(nav).getByRole('link', {name: 'Pricing'})).toHaveAttribute('href', '#/pricing');
  expect(screen.getAllByRole('link', {name: 'Sign in'})[0]).toHaveAttribute('href', '#/sign-in');
  const individual = screen.getByRole('article', {name: 'Individual'});
  expect(within(individual).getByText('Available now')).toBeVisible();
  expect(within(individual).getByText('Price not set yet')).toBeVisible();
  expect(within(individual).getByRole('link', {name: 'Choose Individual'})).toHaveAttribute('href', '#/start/individual');
  const franchise = screen.getByRole('article', {name: 'Franchise'});
  expect(within(franchise).getByText('Coming soon')).toBeVisible();
  expect(within(franchise).getByText('Not available to choose yet')).toBeVisible();
  // Not selectable or purchasable: nothing in the card can be pressed or followed.
  expect(within(franchise).queryAllByRole('link')).toHaveLength(0);
  expect(within(franchise).queryAllByRole('button')).toHaveLength(0);
  expect(within(franchise).queryAllByRole('listitem')).toHaveLength(0);
  // No price is configured anywhere in the project, so none is shown.
  expect(document.body.textContent).not.toMatch(/₹|\$|per month|\/month/i);
  expect(calls.some(call => call.path === '/api/v1/onboarding')).toBe(false);
});

it('starts Individual setup with the plan in view and verifies a contact before the shop step', async () => {
  window.location.hash = '/pricing'; render(<App/>);
  fireEvent.click(await screen.findByRole('link', {name: 'Choose Individual'}));
  await screen.findByRole('heading', {name: 'Your plan'});
  expect(screen.getByRole('heading', {level: 1, name: 'Set up your shop'})).toBeVisible();
  const plan = screen.getByRole('complementary', {name: 'Selected plan'});
  expect(within(plan).getByText('Individual')).toBeInTheDocument();
  expect(within(plan).getByText('Nothing')).toBeInTheDocument();
  expect(within(screen.getByRole('list', {name: 'Setup progress'})).getAllByRole('listitem')).toHaveLength(6);
  fireEvent.click(screen.getByRole('button', {name: 'Continue'}));
  await screen.findByRole('heading', {name: 'Verify your phone or email'});
  expect(screen.getByText('Online sign-up is not open yet')).toBeVisible();
  expect(screen.getByRole('radiogroup', {name: 'Verify with'})).toBeVisible();
  fireEvent.change(screen.getByLabelText('Phone number'), {target: {value: '9876543210'}});
  fireEvent.click(screen.getByRole('button', {name: 'Send the code on WhatsApp'}));
  fireEvent.change(await screen.findByLabelText('Your 8-digit code'), {target: {value: '12345678'}});
  await screen.findByRole('heading', {name: 'Shop details'});
  const start = calls.find(call => call.path === '/auth/challenges')!;
  expect(JSON.parse(start.options.body as string)).toEqual({channel: 'whatsapp', address: '+919876543210'});
  // Back reaches the verified contact, which is the one that signs in next time.
  fireEvent.click(screen.getByRole('button', {name: 'Back'}));
  expect(await screen.findByText('+919876543210')).toBeVisible();
});

it('keeps shop answers on this device, resumes them, and clears them once the shop is confirmed', async () => {
  context = empty; window.location.hash = '/start/individual';
  const view = render(<App/>);
  await screen.findByRole('heading', {name: 'Shop details'});
  fireEvent.change(screen.getByLabelText('Business name'), {target: {value: 'Synthetic shop'}});
  fireEvent.click(screen.getByRole('button', {name: 'Save and finish later'}));
  expect(screen.getByRole('status')).toHaveTextContent('Saved on this device');
  view.unmount(); render(<App/>);
  await screen.findByRole('heading', {name: 'Shop details'});
  expect(screen.getByLabelText('Business name')).toHaveValue('Synthetic shop');
  fireEvent.change(screen.getByLabelText('Branch name'), {target: {value: 'Counter A'}});
  fireEvent.click(screen.getByRole('button', {name: 'Continue'}));
  await screen.findByRole('heading', {name: 'Review before payment'});
  fireEvent.click(screen.getByRole('button', {name: 'Change plan'}));
  await screen.findByRole('heading', {name: 'Your plan'});
  fireEvent.click(screen.getByRole('button', {name: 'Continue'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Continue'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Continue'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Continue to payment'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Open my shop'}));
  await screen.findByRole('heading', {name: 'Your shop is open'});
  expect(JSON.stringify(localStorage)).not.toContain('Synthetic shop');
  expect(calls.filter(call => call.path === '/api/v1/onboarding')).toHaveLength(1);
});

it('sends a signed-in owner to the shop they already have instead of a second setup', async () => {
  context = ready; window.location.hash = '/pricing'; render(<App/>);
  await screen.findByRole('heading', {name: 'Two plans. One is ready today.'});
  expect(screen.getAllByRole('link', {name: 'Open your dashboard'})[0]).toHaveAttribute('href', '#/business');
  fireEvent.click(screen.getByRole('link', {name: 'Choose Individual'}));
  await waitFor(() => expect(screen.getByRole('heading', {name: 'Dashboard'})).toBeVisible());
  expect(window.location.hash).toBe('#/business');
  expect(calls.some(call => call.path === '/api/v1/onboarding')).toBe(false);
});
