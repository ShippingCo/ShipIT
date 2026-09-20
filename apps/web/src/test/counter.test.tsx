import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { createScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { createBookingWorkflow } from '../booking/workflow';
import { receiptDto } from '../data-access/receipts';
import { quoteDto, taxDto } from '../data-access/commercial';
import { customerDto } from '../data-access/customers';
import * as f from './counter-fixture';
type Call={path:string;options:RequestInit};
let calls:Call[], override:((c:Call)=>Promise<Response>|undefined)|undefined;
const posts=(part:string)=>calls.filter(c=>c.path.startsWith(part)&&c.options.method==='POST');
const body=(c:Call)=>JSON.parse(c.options.body as string);
const key=(c:Call)=>(c.options.headers as Record<string,string>)['Idempotency-Key'];
beforeEach(()=>{
 window.location.hash='/business/new-booking';calls=[];override=undefined;vi.stubEnv('VITE_DATA_MODE','production');
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  const c={path,options};calls.push(c);const result=override?.(c);if(result)return result;
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});
  if(path.startsWith('/api/v1/operator-context'))return f.json({...f.context,active_franchise_id:path.includes(f.B)?f.B:f.A});
  if(path.includes('/customers'))return f.json(options.method==='GET'&&path.includes('?')?{items:[f.customer],page:{has_more:false,next_cursor:null}}:f.customer,options.method==='POST'?201:200);
  if(path.startsWith('/api/v1/pricing/quote'))return f.json(f.quote);
  if(path.startsWith('/api/v1/tax/intents'))return f.json(f.intent);
  if(path.startsWith('/api/v1/tax/calculations'))return f.json(f.tax);
  if(path.startsWith('/api/v1/parcels'))return f.json({items:[{...f.booking.parcels[0],booking_id:f.bookingId,confirmed_at:f.now}],page:{next_cursor:null,has_more:false}});
  if(path.includes('/receipt'))return f.json(f.receipt);
  if(path.includes('/payments'))return f.json(options.method==='GET'?f.balance:{payment:f.balance,entry:{...body(c),id:f.id(16),kind:'collection',reversal_of:null,reason_code:null,version:1,occurred_at:f.now}},options.method==='POST'?201:200);
  if(path.includes('/attachments'))return f.json({items:[]});
  if(path.startsWith('/api/v1/bookings?'))return f.json(f.booking,201);
  if(path==='/auth/logout')return f.json({ok:true});
  throw new Error('Unexpected synthetic endpoint');
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
const fill=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label,{exact:false}),{target:{value}});
async function start() {render(<App/>);await screen.findByRole('heading',{name:'New Booking'});}
async function entered(paid=false) {
 await start();fill('Customer name',f.customer.name);fill('Customer phone',f.customer.phone_display);fill('Customer address',f.customer.address);
 fireEvent.click(screen.getByRole('button',{name:'Create customer'}));await screen.findByText('Customer: ready');
 fill('Recipient name','Synthetic Recipient');fill('Recipient phone','+1 202-555-0101');fill('Recipient address','21 Fictional Street');fill('Destination key','SYN_DEST');fill('Weight (grams)','999');fill('Service recipient reference','SYN_BUYER');fill('Handover state','27');fill('Tax evidence reference','SYN_HANDOVER');
 if(paid){fill('Payment choice','paid_counter');fill('Payment method','upi');}
 fireEvent.click(screen.getByRole('button',{name:'Get server price and tax'}));await screen.findByText('Server payable ₹134.00');
}
const save=()=>fireEvent.click(screen.getByRole('button',{name:'Save booking'}));
describe('production counter API composition',()=>{
 it('creates approved wire commands, To Pay obligation, optional immutable printing and fresh receipt discovery',async()=>{
  const print=vi.spyOn(window,'print').mockImplementation(()=>{});await entered();save();await screen.findByRole('heading',{name:'Booking saved'});
  expect(posts('/api/v1/bookings?')).toHaveLength(1);expect(body(posts('/api/v1/bookings?')[0])).toEqual({customer_id:f.customerId,expected_customer_version:1,tax_calculation_id:f.tax.id,tax_intent:{quote_id:f.quote.id,pricing_input:{destination_key:'SYN_DEST',service:'standard',weight_grams:999},facts:{service_recipient_ref:'SYN_BUYER',registration:'unregistered',recipient_state:null,recipient_gstin:null,handover_state:'27',evidence_ref:'SYN_HANDOVER',special_case:'none'}},parcels:[{weight_grams:999,recipient:{name:'Synthetic Recipient',phone:'+1 202-555-0101',address:'21 Fictional Street'}}]});
  expect(screen.getByText('Outstanding ₹134.00 at booking confirmation')).toBeVisible();expect(posts(`/api/v1/bookings/${f.bookingId}/payments`)).toHaveLength(0);
  expect(screen.getByText('Booking saved.',{selector:'p[role="status"]'})).toHaveAttribute('aria-live','polite');expect(print).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Load receipt'}));await screen.findByText(/RCT-0000000000000000033/);expect(print).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Print receipt'}));expect(print).toHaveBeenCalledTimes(1);expect(document.getElementById('print-root')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Reload receipt'}));await screen.findByRole('button',{name:'Print receipt'});
  fireEvent.click(screen.getByRole('link',{name:'Open Receipts'}));await screen.findByRole('heading',{name:'Receipts'});await screen.findByRole('button',{name:/SYN-33/});
  expect(calls.some(c=>c.path.startsWith('/api/v1/parcels?'))).toBe(true);expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);expect(document.body.textContent).not.toMatch(/WhatsApp sent|customer notified/);
 });
 it('double click and lost commit acknowledgement retain identical path/body/key with one displayed result',async()=>{
  await entered();const slow=f.deferred<Response>();let first=true;override=c=>c.path.startsWith('/api/v1/bookings?')&&first?(first=false,slow.promise):undefined;
  const button=screen.getByRole('button',{name:'Save booking'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(posts('/api/v1/bookings?')).toHaveLength(1));
  await act(async()=>slow.resolve(f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503)));
  await screen.findByRole('button',{name:'Retry same booking'});expect(screen.getByRole('alert')).toHaveTextContent(/may have|uncertain|confirmed/i);expect(screen.getByLabelText('Recipient name')).toHaveValue('Synthetic Recipient');
  expect(screen.queryByRole('heading',{name:'Booking saved'})).toBeNull();expect(screen.getByLabelText('Recipient name')).toBeDisabled();
  const marker=sessionStorage.getItem(sessionStorage.key(0)!)!;expect(marker).not.toMatch(/Synthetic|Street|0101|parcels|tax_intent/);
  fireEvent.click(screen.getByRole('button',{name:'Retry same booking'}));await screen.findByRole('heading',{name:'Booking saved'});
  const [a,b]=posts('/api/v1/bookings?');expect([a.path,a.options.body,key(a)]).toEqual([b.path,b.options.body,key(b)]);expect(sessionStorage.length).toBe(0);
 });
 it('network outage preserves draft and never fabricates a receipt or local booking',async()=>{
  await entered();override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.reject(new TypeError('SYN_DISCONNECT')):undefined;save();await screen.findByRole('button',{name:'Retry same booking'});
  expect(screen.getByLabelText('Customer address')).toHaveValue(f.customer.address);expect(screen.queryByRole('heading',{name:'Booking saved'})).toBeNull();expect(calls.some(c=>c.path.includes('/receipt'))).toBe(false);expect(localStorage.length).toBe(0);
 });
 it('rejects stale/forged commercial state, keeps edits and requires fresh reviewed evidence and new command identity',async()=>{
  await entered();screen.getByText('Server payable ₹134.00').textContent='Server payable ₹0.00';let reject=true;
  override=c=>c.path.startsWith('/api/v1/bookings?')&&reject?Promise.resolve(f.json({error:{code:'QUOTE_STALE'}},409)):undefined;save();await screen.findByText(/Pricing expired|Pricing changed|quote.*expired/i);
  expect(body(posts('/api/v1/bookings?')[0])).not.toHaveProperty('total_paise');expect(screen.getByLabelText('Recipient name')).toHaveValue('Synthetic Recipient');expect(screen.queryByText('Server payable ₹0.00')).toBeNull();
  reject=false;fireEvent.click(screen.getByRole('button',{name:'Get server price and tax'}));await screen.findByText('Server payable ₹134.00');save();await screen.findByRole('heading',{name:'Booking saved'});
  expect(key(posts('/api/v1/bookings?')[0])).not.toBe(key(posts('/api/v1/bookings?')[1]));
 });
 it.each([1280,375])('discards late franchise A search at viewport %i through real scope generation',async width=>{
  Object.defineProperty(window,'innerWidth',{configurable:true,value:width});await start();const slow=f.deferred<Response>();override=c=>c.path.includes('/customers?')?slow.promise:undefined;
  fill('Find repeat customer','Syn');fireEvent.click(screen.getByRole('button',{name:'Search customers'}));await waitFor(()=>expect(calls.some(c=>c.path.includes('/customers?'))).toBe(true));
  const old=calls.find(c=>c.path.includes('/customers?'))!;fill('Franchise',f.B);await screen.findByRole('heading',{name:'New Booking'});await waitFor(()=>expect(screen.getByLabelText('Franchise')).toHaveValue(f.B));
  await act(async()=>slow.resolve(f.json({items:[f.customer],page:{next_cursor:null,has_more:false}})));
  expect(old.options.signal?.aborted).toBe(true);expect(document.body.textContent).not.toContain(f.customer.address);expect(screen.getByLabelText('Customer name')).toHaveValue('');expect(screen.getByLabelText('Customer phone')).toHaveValue('');
 });
 it('repeat selection fills empty values while preserving deliberate edits',async()=>{
  await start();fill('Customer name','Synthetic deliberate edit');fill('Find repeat customer','Syn');fireEvent.click(screen.getByRole('button',{name:'Search customers'}));fireEvent.click(await screen.findByRole('button',{name:/Synthetic Sender ·/}));
  expect(screen.getByLabelText('Customer name')).toHaveValue('Synthetic deliberate edit');expect(screen.getByLabelText('Customer phone')).toHaveValue(f.customer.phone_display);expect(screen.getByRole('button',{name:'Save customer changes'})).toBeEnabled();
 });
 it('Paid Now uses server obligation and stable reference; failed payment never undoes saved booking',async()=>{
  await entered(true);let fail=true;override=c=>c.path.includes('/payments')&&c.options.method==='POST'&&fail?Promise.resolve(f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503)):undefined;save();await screen.findByRole('button',{name:'Retry payment'});await waitFor(()=>expect(screen.getByRole('button',{name:'Retry payment'})).toBeEnabled());
  expect(screen.getByRole('heading',{name:'Booking saved'})).toBeVisible();expect(screen.getByText('Payment: not confirmed')).toBeVisible();const request=posts(`/api/v1/bookings/${f.bookingId}/payments`)[0];expect(body(request)).toMatchObject({amount_paise:13400,currency:'INR',context:'paid_counter',method:'upi'});
  fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry payment'}));await screen.findByText('Payment: recorded');await screen.findByText('Outstanding ₹0.00');
  const retry=posts(`/api/v1/bookings/${f.bookingId}/payments`)[1];expect([request.options.body,key(request)]).toEqual([retry.options.body,key(retry)]);expect(posts('/api/v1/bookings?')).toHaveLength(1);
 });
 it('receipt outage has an independent retry and retains booking',async()=>{
  await entered();save();await screen.findByRole('heading',{name:'Booking saved'});let fail=true;override=c=>c.path.includes('/receipt')&&fail?Promise.resolve(f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503)):undefined;
  fireEvent.click(screen.getByRole('button',{name:'Load receipt'}));await screen.findByRole('button',{name:'Retry receipt'});expect(screen.getByRole('alert')).toHaveTextContent('Booking saved. Receipt is temporarily unavailable.');
  fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry receipt'}));await screen.findByRole('button',{name:'Print receipt'});expect(posts('/api/v1/bookings?')).toHaveLength(1);
 });
 it('keyboard form submission focuses first invalid field and describes the error',async()=>{
  await start();screen.getByRole('button',{name:'Save booking'}).focus();fireEvent.submit(screen.getByRole('form',{name:'New booking'}));
  const first=document.getElementById('counter-name')!;await waitFor(()=>expect(first).toHaveFocus());expect(first).toHaveAttribute('aria-invalid','true');expect(first).toHaveAccessibleDescription('Enter a customer name, up to 120 characters.');expect(screen.getByRole('alert')).toHaveTextContent('Review the highlighted fields.');expect(posts('/api/v1/bookings?')).toHaveLength(0);
 });
 it.each(['/api/v1/pricing/quote','/api/v1/tax/calculations'])('scope change cancels late %s and prevents private totals repaint',async path=>{
  await entered();fill('Weight (grams)','998');const slow=f.deferred<Response>();override=c=>c.path.startsWith(path)?slow.promise:undefined;fireEvent.click(screen.getByRole('button',{name:'Get server price and tax'}));await waitFor(()=>expect(calls.filter(c=>c.path.startsWith(path)).length).toBe(2));
  fill('Franchise',f.B);await waitFor(()=>expect(screen.getByLabelText('Franchise')).toHaveValue(f.B));await act(async()=>slow.resolve(f.json(path.includes('pricing')?f.quote:f.tax)));
  expect(screen.queryByText('Server payable ₹134.00')).toBeNull();expect(screen.getByLabelText('Customer name')).toHaveValue('');
 });
 it('scope change cancels late receipt and drops its private snapshot',async()=>{
  await entered();save();await screen.findByRole('heading',{name:'Booking saved'});const slow=f.deferred<Response>();override=c=>c.path.includes('/receipt')?slow.promise:undefined;fireEvent.click(screen.getByRole('button',{name:'Load receipt'}));await waitFor(()=>expect(calls.some(c=>c.path.includes('/receipt'))).toBe(true));
  fill('Franchise',f.B);await waitFor(()=>expect(screen.getByLabelText('Franchise')).toHaveValue(f.B));await act(async()=>slow.resolve(f.json(f.receipt)));expect(document.body.textContent).not.toContain(f.receipt.number);
 });
 it('malformed successes fail safely and unknown private fields are projected out',()=>{
  for(const [parse,value] of [[receiptDto,f.receipt],[quoteDto,f.quote],[taxDto,f.tax],[customerDto,f.customer]] as const){expect(()=>parse({...value,id:'foreign'})).toThrow();expect(parse({...value,otp:'SYN_SECRET',address_internal:'SYN_PRIVATE'})).not.toHaveProperty('otp');}
  expect(()=>receiptDto({...f.receipt,charges:{...f.receipt.charges,tax:{...f.evidence,final_payable_paise:1.2}}})).toThrow();
 });
 it('focus revalidation preserves draft for unchanged permissions; revocation purges actual generation',async()=>{
  const controller=createScopeController();await controller.load();const flow=createBookingWorkflow(controller);flow.activate();flow.change('name','Synthetic private draft');const generation=controller.runtime.ticket().generation;
  await controller.revalidate();expect(controller.runtime.ticket().generation).toBe(generation);expect(flow.snapshot().draft.name).toBe('Synthetic private draft');
  override=c=>c.path.startsWith('/api/v1/operator-context')?Promise.resolve(f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503)):undefined;
  await controller.revalidate();expect(flow.snapshot().draft.name).toBe('Synthetic private draft');expect(controller.snapshot().notice).toContain('could not be refreshed');
  override=c=>c.path.startsWith('/api/v1/operator-context')?Promise.resolve(f.json({...f.context,franchises:f.context.franchises.map(x=>({...x,roles:['read_only']}))})):undefined;
  await controller.revalidate();expect(controller.runtime.ticket().generation).not.toBe(generation);expect(flow.snapshot().draft.name).toBe('');expect(()=>scopedApi(controller)).not.toThrow();flow.dispose();
 });
 it.each(['DOCKET_CONFLICT','VERSION_CONFLICT','ACTION_FORBIDDEN','RESOURCE_NOT_FOUND'])('handles safe %s without losing the draft or claiming success',async code=>{
  await entered();override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({error:{code,private_details:'SYN_PRIVATE'}},code==='ACTION_FORBIDDEN'?403:code==='RESOURCE_NOT_FOUND'?404:409)):undefined;
  save();await waitFor(()=>expect(screen.getByRole('alert')).not.toHaveTextContent('Saving booking'));
  expect(screen.getByLabelText('Recipient name')).toHaveValue('Synthetic Recipient');expect(screen.queryByRole('heading',{name:'Booking saved'})).toBeNull();expect(document.body.textContent).not.toContain('SYN_PRIVATE');
  if(code==='DOCKET_CONFLICT')expect(document.getElementById('counter-docket')).toHaveFocus();
  if(code==='VERSION_CONFLICT')expect(screen.getByRole('alert')).toHaveTextContent('Refresh the customer');
 });
 it('malformed committed response is uncertain and retry uses its original identity',async()=>{
  await entered();let fail=true;override=c=>c.path.startsWith('/api/v1/bookings?')&&fail?Promise.resolve(f.json({...f.booking,payment_obligation:{...f.booking.payment_obligation,total_paise:'0'},otp:'SYN_PRIVATE'},201)):undefined;
  save();await screen.findByRole('button',{name:'Retry same booking'});expect(document.body.textContent).not.toContain('SYN_PRIVATE');fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry same booking'}));await screen.findByRole('heading',{name:'Booking saved'});
  expect(key(posts('/api/v1/bookings?')[0])).toBe(key(posts('/api/v1/bookings?')[1]));
 });
 it('401 purges private form and requires sign in without local fallback',async()=>{
  await entered();override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({error:{code:'UNAUTHENTICATED'}},401)):undefined;save();await screen.findByRole('heading',{name:'Sign in to ShippingCo'});
  expect(document.body.textContent).not.toContain(f.customer.address);expect(screen.queryByLabelText('Customer name')).toBeNull();expect(localStorage.length).toBe(0);
 });
 it('reload with an unresolved marker forbids fresh-key booking and contains no persisted body',async()=>{
  await entered();override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({error:{code:'IDEMPOTENCY_IN_PROGRESS'}},409)):undefined;save();await screen.findByRole('button',{name:'Retry same booking'});
  fireEvent.click(screen.getAllByRole('link',{name:'Receipts'})[0]);await screen.findByRole('heading',{name:'Receipts'});fireEvent.click(screen.getAllByRole('link',{name:'New Booking'})[0]);await screen.findByRole('heading',{name:'Booking recovery required'});
  expect(screen.queryByRole('button',{name:'Save booking'})).toBeNull();expect(posts('/api/v1/bookings?')).toHaveLength(1);expect(JSON.stringify(sessionStorage)).not.toMatch(/Synthetic|Street|parcels/);
 });
 it('receipt discovery supports empty and safe denied/retry states',async()=>{
  window.location.hash='/business/receipts';let denied=true;override=c=>c.path.startsWith('/api/v1/parcels')?Promise.resolve(denied?f.json({error:{code:'ACTION_FORBIDDEN'}},403):f.json({items:[],page:{next_cursor:null,has_more:false}})):undefined;
  render(<App/>);await screen.findByRole('button',{name:'Retry receipts'});expect(screen.getByRole('alert')).toHaveTextContent('not permitted');denied=false;fireEvent.click(screen.getByRole('button',{name:'Retry receipts'}));await screen.findByText('No bookings found in this workspace.');
 });

 it('scope switch during a dispatched booking retains opaque recovery and never replays under B',async()=>{
  await entered();const slow=f.deferred<Response>();override=c=>c.path.startsWith('/api/v1/bookings?')?slow.promise:undefined;save();await waitFor(()=>expect(posts('/api/v1/bookings?')).toHaveLength(1));
  const marker=sessionStorage.getItem(sessionStorage.key(0)!);fill('Franchise',f.B);await waitFor(()=>expect(screen.getByLabelText('Franchise')).toHaveValue(f.B));
  await act(async()=>slow.resolve(f.json(f.booking,201)));expect(screen.queryByRole('heading',{name:'Booking saved'})).toBeNull();expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(marker);expect(posts('/api/v1/bookings?')).toHaveLength(1);
  fill('Franchise',f.A);await screen.findByRole('heading',{name:'Booking recovery required'});
 });

});
