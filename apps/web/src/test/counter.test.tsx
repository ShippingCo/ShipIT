import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  if(path.startsWith('/api/v1/customer-account-choices'))return f.json({items:[],next_cursor:null});
  if(path.includes('/pricing/services'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
  if(path.includes('/tax/settings'))return f.json({id:f.id(82),mode:null,supplier_state:'27',version:1});
  if(path.includes('/pricing/versions'))return f.json(f.rateCard);
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
const fill=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}});
async function start(){render(<App/>);await screen.findByRole('heading',{name:'New booking',level:1});await waitFor(()=>expect(document.querySelector('#booking-cities option')).not.toBeNull());}
function core(paid=false){fill('Customer name',f.customer.name);fill('WhatsApp number',f.customer.phone_display);fill('Delivery address','21 Fictional Street');fill('Destination city','SYN DEST');fill('Docket number','00123-A');fill('Weight (kg)','0.999');fill('Freight ₹','125.51');fill('Packing ₹','2.49');if(!paid)fireEvent.click(screen.getByRole('button',{name:'To Pay'}));}
async function calculate(){options();fireEvent.click(screen.getByRole('button',{name:'Calculate total'}));await waitFor(()=>expect(summary().getByText('₹134.00')).toBeVisible());}
async function entered(paid=false){await start();core(paid);fill('Parcel handed over in','27');await calculate();}
const summary=()=>within(screen.getByRole('complementary',{name:'Booking summary'}));
const save=()=>fireEvent.click(screen.getByRole('button',{name:'Save booking'}));
function options(){const summary=screen.getByText('More booking options');if(!summary.closest('details')!.open)fireEvent.click(summary);}
async function recalculate(){await calculate();}
function addPackage(number:number){fireEvent.click(screen.getByRole('button',{name:'Add package'}));fill('Parcel '+number+' docket number','SYN-PACK-'+number);fill('Package '+number+' · Weight (kg)','0.5');fireEvent.click(screen.getAllByRole('button',{name:'Use receiver from parcel 1'}).at(-1)!);}

describe('production counter API composition',{timeout:20000},()=>{
 it('uses the original demo field order and controls without separate customer or pricing steps',async()=>{
  await start();
  expect(Array.from(document.querySelectorAll('.booking-layout .tf-label')).filter(e=>!e.closest('details')).map(e=>e.textContent)).toEqual(['WhatsApp number','Customer name','Delivery address','Docket number','Destination city','Weight (kg)','Service','Declared goods value ₹','Add to lot','Packing ₹','Freight ₹']);
  for(const name of ['Customer','Parcel','Charges','Booking summary'])expect(screen.getByRole('heading',{name})).toBeVisible();
  for(const name of ['Photo','Video','Voice note','Add package','Save booking','Cancel booking'])expect(screen.getByRole('button',{name})).toBeVisible();
  expect(screen.queryByRole('button',{name:'Create customer'})).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByLabelText('Weight (kg)')).toHaveValue('1');expect(screen.getByRole('button',{name:'Paid now'})).toHaveAttribute('aria-pressed','true');
 });
 it('looks up repeat customers on phone blur and only fills the selected customer',async()=>{
  await start();fill('WhatsApp number',f.customer.phone_display);fireEvent.blur(screen.getByLabelText('WhatsApp number'));
  const recall=await screen.findByRole('button',{name:/Synthetic Sender.*fill it in/});expect(screen.getByLabelText('Customer name')).toHaveValue('');fireEvent.click(recall);
  expect(screen.getByLabelText('Customer name')).toHaveValue(f.customer.name);expect(posts('/api/v1/bookings?')).toHaveLength(0);
 });
 it('creates a new customer as part of save and does not duplicate it after returning to the form',async()=>{
  override=c=>c.path.includes('/customers?')?Promise.resolve(f.json({items:[],page:{has_more:false,next_cursor:null}})):undefined;
  await start();core();fill('Parcel handed over in','27');await calculate();expect(posts(`/api/v1/organizations/${f.org}/franchises/${f.A}/customers`)).toHaveLength(1);
  await calculate();expect(posts(`/api/v1/organizations/${f.org}/franchises/${f.A}/customers`)).toHaveLength(1);
 });
 it('does not replace an existing customer with a different name or treat lookup failure as a new customer',async()=>{
  await start();core();fill('Customer name','Another sender');save();await screen.findByText(/Choose the matching customer below/);expect(posts(`/api/v1/organizations/${f.org}/franchises/${f.A}/customers`)).toHaveLength(0);
  override=c=>c.path.includes('/customers?')?Promise.reject(new TypeError('offline')):undefined;save();await screen.findByText(/Customer lookup could not finish/);expect(posts('/api/v1/bookings?')).toHaveLength(0);
 });
 it('loads an explicitly selected customer through the current scope and never creates a replacement',async()=>{
  window.location.hash='/business/new-booking?customer_id='+f.customerId;render(<App/>);await waitFor(()=>expect(screen.getByLabelText('Customer name')).toHaveValue(f.customer.name));
  expect(calls.some(c=>c.path===`/api/v1/organizations/${f.org}/franchises/${f.A}/customers/${f.customerId}`)).toBe(true);expect(posts(`/api/v1/organizations/${f.org}/franchises/${f.A}/customers`)).toHaveLength(0);
 });
 it('does not request an invalid customer link or substitute a customer when it fails',async()=>{
  window.location.hash='/business/new-booking?customer_id=invalid';render(<App/>);await screen.findByText(/selected customer could not be loaded/i);expect(calls.some(c=>c.path.includes('/customers/invalid'))).toBe(false);expect(posts('/api/v1/bookings?')).toHaveLength(0);
 });
 it('allows any destination and service when no rate card exists',async()=>{
  override=c=>c.path.includes('/pricing/versions')?Promise.resolve(f.json({error:{code:'NO_RATE'}},422)):c.path.startsWith('/api/v1/pricing/quote')?Promise.resolve(f.json({...f.quote,rate_version_id:null,rate_version_number:0,rule_id:null})):c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({...f.booking,parcels:[{...f.booking.parcels[0],weight_grams:6500}]},201)):undefined;
  render(<App/>);await screen.findByRole('heading',{name:'New booking',level:1});core();
  fill('Destination city','New City');fill('Service','express');fill('Weight (kg)','6.5');fill('Parcel handed over in','27');save();
  await screen.findByRole('heading',{name:'Booking saved'});
  expect(body(posts('/api/v1/pricing/quote').at(-1)!)).toMatchObject({destination_key:'NEW_CITY',service:'express',weight_grams:6500,charges:{freight_paise:12551,packing_paise:249}});
  expect(document.body.textContent).not.toMatch(/Set up booking rates|No configured rate|publish.*before you can book/);
 });
 it('saves from the single booking page with exact kg conversion and a reviewed quote',async()=>{
  await entered();expect(body(posts('/api/v1/pricing/quote').at(-1)!)).toMatchObject({weight_grams:999});save();await screen.findByRole('heading',{name:'Booking saved'});expect(posts('/api/v1/bookings?')).toHaveLength(1);
  expect(body(posts('/api/v1/bookings?')[0])).toMatchObject({customer_id:f.customerId,tax_calculation_id:f.tax.id,parcels:[{weight_grams:999,docket:'00123-A',recipient:{address:'21 Fictional Street'}}]});expect(body(posts('/api/v1/bookings?')[0]).parcels[0]).not.toHaveProperty('details');
  expect(posts(`/api/v1/bookings/${f.bookingId}/payments`)).toHaveLength(0);expect(screen.getByText('To Pay: no collection was recorded.')).toBeVisible();
 });
 it('saves declared goods value without making up structured delivery or contents facts',async()=>{
  await entered();fill('Declared goods value ₹','1000.01');save();await screen.findByRole('heading',{name:'Booking saved'});expect(body(posts('/api/v1/bookings?')[0]).parcels[0].details).toEqual({declared_value_paise:100001});
 });
 it('converts packing and freight to exact paise and rejects invalid non-empty amounts',async()=>{
  await entered();fill('Freight ₹','12.345');save();await waitFor(()=>expect(screen.getByLabelText('Freight ₹')).toHaveAttribute('aria-invalid','true'));expect(posts('/api/v1/bookings?')).toHaveLength(0);
  fill('Freight ₹','125.51');fill('Packing ₹','3.01');await recalculate();expect(body(posts('/api/v1/pricing/quote').at(-1)!)).toMatchObject({charges:{freight_paise:12551,packing_paise:301}});
 });
 it('invalidates the total and shows a missing handover fact inline',async()=>{
  await entered();options();fill('Parcel handed over in','');expect(summary().queryByText('₹134.00')).toBeNull();save();await waitFor(()=>expect(screen.getByLabelText('Parcel handed over in')).toHaveFocus());expect(screen.queryByRole('dialog')).toBeNull();expect(posts('/api/v1/bookings?')).toHaveLength(0);
 });
 it('payment choices and implicit form submission never confirm a booking',async()=>{
  await entered();fireEvent.click(screen.getByRole('button',{name:'Paid now'}));fireEvent.submit(screen.getByRole('form',{name:'New booking'}));expect(posts('/api/v1/bookings?')).toHaveLength(0);expect(screen.getByRole('button',{name:'Save booking'})).toHaveAttribute('type','button');
 });
 it('prints only after saving and does not recreate a booking when printing is cancelled',async()=>{
  const print=vi.spyOn(window,'print').mockImplementation(()=>{});await entered();expect(print).not.toHaveBeenCalled();save();await screen.findByRole('heading',{name:'Booking saved'});fireEvent.click(screen.getByRole('button',{name:'Print booking receipt'}));await waitFor(()=>expect(print).toHaveBeenCalledTimes(1));fireEvent.click(screen.getByRole('button',{name:'Print booking receipt'}));await waitFor(()=>expect(print).toHaveBeenCalledTimes(2));expect(posts('/api/v1/bookings?')).toHaveLength(1);
 });
 it('saves three dockets in one booking and cancels all three from the saved screen',async()=>{
  await entered();addPackage(2);addPackage(3);await recalculate();
  const parcels=[f.booking.parcels[0],...[2,3].map(number=>({...f.booking.parcels[0],id:f.id(80+number),docket:'SYN-PACK-'+number,weight_grams:500}))];const cancelPath='/api/v1/bookings/'+f.bookingId+'/cancellation';
  override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({...f.booking,parcels},201)):c.path.startsWith(cancelPath)?Promise.resolve(f.json(c.options.method==='POST'?{id:f.id(95),booking_id:f.bookingId,parcel_count:3,outstanding_paise:'13400',cancelled_at:f.now}:{booking_id:f.bookingId,parcel_count:3,outstanding_paise:'13400',financial_version:1,payment_version:0,blocked_reason:null})):undefined;
  save();await screen.findByRole('heading',{name:'Booking saved'});expect(body(posts('/api/v1/bookings?')[0]).parcels.map(p=>p.docket)).toEqual(['00123-A','SYN-PACK-2','SYN-PACK-3']);expect(body(posts('/api/v1/pricing/quote').at(-1)!).weight_grams).toBe(1999);
  fireEvent.click(screen.getByRole('button',{name:'Cancel saved booking'}));await screen.findByLabelText('Reason for cancellation');fireEvent.click(screen.getByRole('button',{name:'Keep booking'}));expect(posts(cancelPath)).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Cancel saved booking'}));await screen.findByLabelText('Reason for cancellation');fill('Reason for cancellation','Sender withdrew all packages');fireEvent.click(screen.getByRole('button',{name:'Confirm cancellation'}));await screen.findByText('Cancelled 3 parcels in this booking.');fireEvent.click(screen.getByRole('button',{name:'Done'}));expect(screen.getByRole('heading',{name:'Booking cancelled',level:1})).toBeVisible();expect(posts(cancelPath)).toHaveLength(1);
 });
 it('rejects duplicate extra dockets and focuses the field without creating a booking',async()=>{
  await entered();addPackage(2);fill('Parcel 2 docket number','00123-a');save();await screen.findByText('Another parcel in this booking already has this docket number.');await waitFor(()=>expect(screen.getByLabelText('Parcel 2 docket number')).toHaveFocus());expect(posts('/api/v1/bookings?')).toHaveLength(0);
 });
 it('copies a chosen earlier receiver only on request and confirms replacements without changing parcel contents',async()=>{
  await entered();addPackage(2);fill('Parcel 2 recipient address','Second address');addPackage(3);fill('Copy receiver for parcel 3 from','2');fireEvent.click(screen.getByRole('button',{name:'Use receiver from parcel 2'}));fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(screen.getByLabelText('Parcel 3 recipient address')).toHaveValue('21 Fictional Street');fireEvent.click(screen.getByRole('button',{name:'Use receiver from parcel 2'}));fireEvent.click(screen.getByRole('button',{name:'Replace receiver'}));expect(screen.getByLabelText('Parcel 3 recipient address')).toHaveValue('Second address');expect(screen.getByLabelText('Parcel 3 docket number')).toHaveValue('SYN-PACK-3');
 });
 it('double click and lost commit acknowledgement retain identical path/body/key with one displayed result',async()=>{
  await entered();const slow=f.deferred<Response>();let first=true;override=c=>c.path.startsWith('/api/v1/bookings?')&&first?(first=false,slow.promise):undefined;const button=screen.getByRole('button',{name:'Save booking'});fireEvent.click(button);fireEvent.click(button);await waitFor(()=>expect(posts('/api/v1/bookings?')).toHaveLength(1));await act(async()=>slow.resolve(f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503)));await screen.findByRole('button',{name:'Retry same booking'});expect(screen.getByLabelText('Customer name')).toBeDisabled();expect(sessionStorage.getItem(sessionStorage.key(0)!)!).not.toMatch(/Synthetic|Street|parcels|tax_intent/);fireEvent.click(screen.getByRole('button',{name:'Retry same booking'}));await screen.findByRole('heading',{name:'Booking saved'});const[a,b]=posts('/api/v1/bookings?');expect([a.path,a.options.body,key(a)]).toEqual([b.path,b.options.body,key(b)]);expect(sessionStorage.length).toBe(0);
 });
 it('network outage preserves draft and never fabricates a receipt or local booking',async()=>{
  await entered();override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.reject(new TypeError('offline')):undefined;save();await screen.findByRole('button',{name:'Retry same booking'});expect(screen.getByLabelText('Delivery address')).toHaveValue('21 Fictional Street');expect(screen.queryByRole('heading',{name:'Booking saved'})).toBeNull();expect(calls.some(c=>c.path.includes('/receipt'))).toBe(false);expect(localStorage.length).toBe(0);
 });
 it('rejects stale/forged commercial state, keeps edits and requires fresh reviewed evidence and new command identity',async()=>{
  await entered();summary().getByText('₹134.00').textContent='₹0.00';let reject=true;override=c=>c.path.startsWith('/api/v1/bookings?')&&reject?Promise.resolve(f.json({error:{code:'QUOTE_STALE'}},409)):undefined;save();await screen.findByText(/Pricing expired|Pricing changed|quote.*expired/i);expect(body(posts('/api/v1/bookings?')[0])).not.toHaveProperty('total_paise');reject=false;await recalculate();save();await screen.findByRole('heading',{name:'Booking saved'});expect(key(posts('/api/v1/bookings?')[0])).not.toBe(key(posts('/api/v1/bookings?')[1]));
 });
 it.each([1280,375])('discards late franchise A search at viewport %i through real scope generation',async width=>{
  Object.defineProperty(window,'innerWidth',{configurable:true,value:width});await start();const slow=f.deferred<Response>();override=c=>c.path.includes('/customers?')?slow.promise:undefined;fill('WhatsApp number',f.customer.phone_display);fireEvent.blur(screen.getByLabelText('WhatsApp number'));await waitFor(()=>expect(calls.some(c=>c.path.includes('/customers?'))).toBe(true));const prior=calls.find(c=>c.path.includes('/customers?'))!;fill('Franchise',f.B);await waitFor(()=>expect(screen.getByLabelText('Franchise')).toHaveValue(f.B));await act(async()=>slow.resolve(f.json({items:[f.customer],page:{next_cursor:null,has_more:false}})));expect(prior.options.signal?.aborted).toBe(true);expect(screen.getByLabelText('WhatsApp number')).toHaveValue('');expect(document.body.textContent).not.toContain(f.customer.address);
 });
 it('Paid Now preserves the saved booking and directs actual collection to owned receipt evidence without a legacy write',async()=>{
  await entered(true);save();await screen.findByRole('heading',{name:'Booking saved'});await screen.findByRole('region',{name:'Record this booking payment'});expect(screen.getByRole('link',{name:'Open payments / apply advance'})).toHaveAttribute('href',expect.stringContaining('context=paid_counter'));expect(posts(`/api/v1/bookings/${f.bookingId}/payments`)).toHaveLength(0);expect(posts('/api/v1/bookings?')).toHaveLength(1);
 });
 it('receipt outage has an independent retry and retains booking',async()=>{
  await entered();save();await screen.findByRole('heading',{name:'Booking saved'});let fail=true;override=c=>c.path.includes('/receipt')&&fail?Promise.resolve(f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503)):undefined;fireEvent.click(screen.getByRole('button',{name:'Load receipt'}));await screen.findByRole('button',{name:'Retry receipt'});fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry receipt'}));await screen.findByRole('button',{name:'Print receipt'});expect(posts('/api/v1/bookings?')).toHaveLength(1);
 });
 it('explicit save focuses the first missing sender field without creating a booking',async()=>{
  await start();save();await waitFor(()=>expect(screen.getByLabelText('Customer name')).toHaveFocus());expect(posts('/api/v1/bookings?')).toHaveLength(0);
 });
 it.each(['DOCKET_CONFLICT','VERSION_CONFLICT','ACTION_FORBIDDEN','RESOURCE_NOT_FOUND'])('handles safe %s without losing the draft or claiming success',async code=>{
  await entered();override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({error:{code,private_details:'SYN_PRIVATE'}},code==='ACTION_FORBIDDEN'?403:code==='RESOURCE_NOT_FOUND'?404:409)):undefined;save();await screen.findByRole('alert');expect(screen.getByLabelText('Customer name')).toHaveValue(f.customer.name);expect(screen.queryByRole('heading',{name:'Booking saved'})).toBeNull();expect(document.body.textContent).not.toContain('SYN_PRIVATE');
 });
 it('malformed committed response is uncertain and retry uses its original identity',async()=>{
  await entered();let fail=true;override=c=>c.path.startsWith('/api/v1/bookings?')&&fail?Promise.resolve(f.json({...f.booking,payment_obligation:{...f.booking.payment_obligation,total_paise:'0'},otp:'SYN_PRIVATE'},201)):undefined;save();await screen.findByRole('button',{name:'Retry same booking'});expect(document.body.textContent).not.toContain('SYN_PRIVATE');fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry same booking'}));await screen.findByRole('heading',{name:'Booking saved'});expect(key(posts('/api/v1/bookings?')[0])).toBe(key(posts('/api/v1/bookings?')[1]));
 });
 it('401 purges private form and requires sign in without local fallback',async()=>{
  await entered();override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({error:{code:'UNAUTHENTICATED'}},401)):undefined;save();await screen.findByRole('heading',{name:'Sign in to ShippingCo'});expect(screen.queryByLabelText('Customer name')).toBeNull();expect(localStorage.length).toBe(0);
 });
 it('reload with an unresolved marker forbids fresh-key booking and contains no persisted body',async()=>{
  await entered();override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({error:{code:'IDEMPOTENCY_IN_PROGRESS'}},409)):undefined;save();await screen.findByRole('button',{name:'Retry same booking'});fireEvent.click(screen.getAllByRole('link',{name:'Receipts'})[0]);await screen.findByRole('heading',{name:'Receipts'});fireEvent.click(screen.getAllByRole('link',{name:'New Booking'})[0]);await screen.findByRole('heading',{name:'Booking recovery required'});expect(posts('/api/v1/bookings?')).toHaveLength(1);expect(JSON.stringify(sessionStorage)).not.toMatch(/Synthetic|Street|parcels/);
 });
 it('scope switch during a dispatched booking retains opaque recovery and never replays under B',async()=>{
  await entered();const slow=f.deferred<Response>();override=c=>c.path.startsWith('/api/v1/bookings?')?slow.promise:undefined;save();await waitFor(()=>expect(posts('/api/v1/bookings?')).toHaveLength(1));const marker=sessionStorage.getItem(sessionStorage.key(0)!);fill('Franchise',f.B);await waitFor(()=>expect(screen.getByLabelText('Franchise')).toHaveValue(f.B));await act(async()=>slow.resolve(f.json(f.booking,201)));expect(screen.queryByRole('heading',{name:'Booking saved'})).toBeNull();expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(marker);expect(posts('/api/v1/bookings?')).toHaveLength(1);fill('Franchise',f.A);await screen.findByRole('heading',{name:'Booking recovery required'});
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
 it('does not claim an empty receipt result until the edited docket is searched',async()=>{
  window.location.hash='/business/receipts';render(<App/>);
  await screen.findByRole('table',{name:'Receipt bookings'});
  fill('Find receipt by docket','UNKNOWN');
  expect(screen.getByText('Search to load matching bookings.')).toBeVisible();
  expect(screen.queryByRole('heading',{name:'No receipts found'})).not.toBeInTheDocument();
  override=c=>c.path.startsWith('/api/v1/parcels')?Promise.resolve(f.json({items:[],page:{next_cursor:null,has_more:false}})):undefined;
  fireEvent.click(screen.getByRole('button',{name:'Find receipts'}));
  await screen.findByRole('heading',{name:'No receipts found'});
  expect(calls.filter(c=>c.path.startsWith('/api/v1/parcels')).at(-1)!.path).toContain('docket=UNKNOWN');
  fireEvent.click(screen.getByRole('button',{name:'Clear search'}));
  expect(screen.getByRole('searchbox',{name:'Find receipt by docket'})).toHaveFocus();
 });
 it('receipt discovery supports empty and safe denied/retry states',async()=>{
  window.location.hash='/business/receipts';let denied=true;override=c=>c.path.startsWith('/api/v1/parcels')?Promise.resolve(denied?f.json({error:{code:'ACTION_FORBIDDEN'}},403):f.json({items:[],page:{next_cursor:null,has_more:false}})):undefined;
  render(<App/>);await screen.findByRole('button',{name:'Retry receipts'});expect(screen.getByRole('alert')).toHaveTextContent('not permitted');denied=false;fireEvent.click(screen.getByRole('button',{name:'Retry receipts'}));await screen.findByText('No bookings found in this workspace.');
 });
});

describe('monthly account booking',{timeout:20000},()=>{
 const account=f.id(80),request=f.id(81),approval=f.id(82),debtor=f.id(83);
 function accountResponses(c:Call){
  if(c.path.startsWith('/api/v1/customer-account-choices'))return f.json({items:[{id:account,name:'Synthetic Monthly',version:1,state:'active'}],next_cursor:null});
  if(c.path.includes('/credit-sources'))return f.json({items:[{booking_id:f.id(84),due_date:'2099-01-01',gross_paise:'60000',reduction_paise:'0',collected_paise:'0',refund_paise:'0',outstanding_paise:'60000'}],next_cursor:null});
  if(c.path.includes('/credit'))return f.json({outstanding_paise:'60000',available_paise:'40000',overdue_paise:'0',credit_limit_paise:100000,state:'active',as_of:f.now});
  if(c.path.startsWith('/api/v1/pricing/quote'))return f.json({...f.quote,account:{id:account,revision_id:f.id(85),version:1,rate_source:'account',rate_revision_id:f.id(86),rule_index:0},rule_id:null});
  if(c.path.startsWith('/api/v1/customer-credit-requests'))return f.json(c.options.method==='POST'?{id:request}:{id:request,approval_id:approval,expires_at:f.expiry,reason:'Owner reviewed this shipment'});
  if(c.path.startsWith('/api/v1/bookings?'))return f.json({...f.booking,account:{account_id:account,debtor:{source_customer_id:debtor,name:'Separate Debtor'},due_date:'2099-02-10',rate_source:'account',approval_id:approval}},201);
 }
 async function selected(){
  override=c=>{const value=accountResponses(c);return value?Promise.resolve(value):undefined;};
  await entered();options();fireEvent.change(await screen.findByRole('combobox',{name:'Bill-to account'}),{target:{value:account}});await screen.findByText('₹400.00',{selector:'strong'});expect(screen.getByRole('combobox',{name:'Bill-to account'})).toHaveValue(account);
  await calculate();
 }
 it('shows source credit, retains an uncertain request identity and saves the exact approved debtor',async()=>{
  await selected();fireEvent.click(screen.getByRole('button',{name:'Credit source bookings'}));
  const sources=await screen.findByRole('table',{name:'Credit source bookings'});
  expect(within(sources).getByRole('columnheader',{name:'Original'})).toBeInTheDocument();
  const originalIndex=within(sources).getAllByRole('columnheader',{}).findIndex(header=>header.textContent==='Original');
  expect(within(within(sources).getAllByRole('row',{})[1]).getAllByRole('cell',{})[originalIndex]).toHaveTextContent('₹600.00');
  let first=true;override=c=>{if(c.path.startsWith('/api/v1/customer-credit-requests')&&c.options.method==='POST'&&first){first=false;return Promise.reject(new TypeError('SYN_ACK_LOST'));}const value=accountResponses(c);return value?Promise.resolve(value):undefined;};
  fireEvent.click(screen.getByRole('button',{name:'Request credit-limit exception'}));await screen.findByRole('button',{name:'Retry same credit request'});expect(screen.getByLabelText('Recipient name')).toBeDisabled();
  expect(screen.getByRole('button',{name:'Cancel booking'})).toBeDisabled();
  const unload=new Event('beforeunload',{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
  fireEvent.click(screen.getByRole('button',{name:'Retry same credit request'}));await screen.findByRole('button',{name:'Check owner approval'});
  const attempts=posts('/api/v1/customer-credit-requests');expect(attempts).toHaveLength(2);expect([attempts[0].path,attempts[0].options.body,key(attempts[0])]).toEqual([attempts[1].path,attempts[1].options.body,key(attempts[1])]);
  fireEvent.click(screen.getByRole('button',{name:'Check owner approval'}));await screen.findByText(/Owner approved this booking: Owner reviewed/);fireEvent.click(screen.getByRole('button',{name:'Save booking'}));await screen.findByRole('heading',{name:'Booking saved'});
  expect(body(posts('/api/v1/bookings?')[0]).credit_approval_id).toBe(approval);expect(body(posts('/api/v1/bookings?')[0]).tax_intent.pricing_input.customer_account_id).toBe(account);
  expect(screen.getByText(/Bill to Separate Debtor/)).toBeVisible();expect(screen.getByRole('link',{name:'Open payments / apply advance'})).toHaveAttribute('href',expect.stringContaining(debtor));
 });
 it('invalidates approval after any shipment edit and gives a clear held-account denial',async()=>{
  await selected();fireEvent.click(screen.getByRole('button',{name:'Request credit-limit exception'}));await screen.findByRole('button',{name:'Check owner approval'});fireEvent.click(screen.getByRole('button',{name:'Check owner approval'}));await screen.findByText(/Owner approved this booking:/);
  fill('Recipient name','Different Recipient');expect(screen.queryByText(/Owner approved this booking:/)).toBeNull();expect(screen.queryByRole('button',{name:'Check owner approval'})).toBeNull();
  override=c=>c.path.startsWith('/api/v1/bookings?')?Promise.resolve(f.json({error:{code:'ACCOUNT_HELD'}},409)):undefined;fireEvent.click(screen.getByRole('button',{name:'Save booking'}));await screen.findByText(/account is held/i);expect(body(posts('/api/v1/bookings?')[0]).credit_approval_id).toBeUndefined();expect(screen.queryByRole('heading',{name:'Booking saved'})).toBeNull();
 });
});

describe('counter service setup',()=>{
 it('can save a booking immediately after creating and using a service in its dialog',async()=>{
  await entered();options();
  const service={id:f.id(91),name:'New counter service',service:'standard',destination_key:'SYN_DEST',accepts_liquids:false,
   pricing:{kind:'flat',first_kg_paise:12551,additional_kg_paise:0,packing_paise:249},created_at:f.now};
  let published=false;
  override=c=>{
   if(c.path.includes('/pricing/services')){
    if(c.options.method==='POST'){
     published=true;
     return Promise.resolve(f.json(service,201));
    }
    return Promise.resolve(f.json({items:published?[service]:[],page:{has_more:false,next_cursor:null}}));
   }
   if(c.path.startsWith('/api/v1/pricing/quote'))return Promise.resolve(f.json({...f.quote,service_option:{id:service.id,name:service.name}}));
  };
  fireEvent.click(screen.getByRole('button',{name:'Add a service and its rates'}));
  const dialog=within(await screen.findByRole('dialog',{name:'Add a service'}));
  fireEvent.change(dialog.getByLabelText('Service name'),{target:{value:service.name}});
  fireEvent.click(dialog.getByRole('button',{name:'Continue setup'}));
  fireEvent.change(dialog.getByLabelText('Charge per booking (₹)'),{target:{value:'125.51'}});
  fireEvent.click(dialog.getByRole('button',{name:'Continue setup'}));
  fireEvent.click(dialog.getByRole('checkbox',{name:'I reviewed these prices and the service category.'}));
  fireEvent.click(dialog.getByRole('button',{name:'Save and use service'}));
  await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Service',{exact:true})).toHaveValue('option:'+service.id);
  await recalculate();
  await summary().findByText(service.name);
  expect(summary().getByRole('button',{name:'Save booking'})).toBeEnabled();
  save();
  await screen.findByRole('heading',{name:'Booking saved'});
  expect(posts('/api/v1/bookings?')).toHaveLength(1);
 });
});

describe('counter post-save and scope boundaries',()=>{
 it('retries only the unconfirmed lot assignment after a multi-package booking is saved',async()=>{
  await entered();addPackage(2);await recalculate();
  const lot={id:f.id(91),code:'SYN-LOT',name:'Mumbai run',destination_key:'SYN_DEST',state:'active',version:2,created_at:f.now,updated_at:f.now,archived_at:null,active_member_count:0};
  const second={id:f.id(90),docket:'SYN-PACK-2',weight_grams:500,status:'booked'},lotPath='/api/v1/lots/'+lot.id+'/parcels';let fail=true;
  override=c=>{
   if(c.path.startsWith('/api/v1/lots?'))return Promise.resolve(f.json({items:[lot],page:{has_more:false,next_cursor:null}}));
   if(c.path.startsWith('/api/v1/bookings?'))return Promise.resolve(f.json({...f.booking,parcels:[f.booking.parcels[0],second]},201));
   if(!c.path.startsWith(lotPath))return;
   const {parcel_id,expected_version}=body(c);if(parcel_id===second.id&&fail){fail=false;return Promise.reject(new TypeError('lost acknowledgement'));}
   return Promise.resolve(f.json({lots:[{...lot,version:expected_version+1}],membership:{id:f.id(parcel_id===second.id?93:92),lot_id:lot.id,parcel_id,started_at:f.now,ended_at:null,end_reason:null}}));
  };
  fireEvent.click(screen.getByRole('button',{name:'Retry loading lots'}));await screen.findByRole('option',{name:'SYN-LOT · Mumbai run'});fill('Add to lot',lot.id);save();await screen.findByRole('heading',{name:'Booking saved'});fireEvent.click(await screen.findByRole('button',{name:'Retry same lot assignment'}));await screen.findByText(/2 of 2 parcels confirmed/);
  const attempts=posts(lotPath);expect(attempts).toHaveLength(3);expect([attempts[1].options.body,key(attempts[1])]).toEqual([attempts[2].options.body,key(attempts[2])]);expect(posts('/api/v1/bookings?')).toHaveLength(1);
 });
 it.each(['/api/v1/pricing/quote','/api/v1/tax/calculations'])('scope change cancels late %s and prevents private totals repaint',async path=>{
  await entered();fill('Weight (kg)','0.998');const slow=f.deferred<Response>();override=c=>c.path.startsWith(path)?slow.promise:undefined;
  options();fireEvent.click(screen.getByRole('button',{name:'Calculate total'}));await waitFor(()=>expect(calls.filter(c=>c.path.startsWith(path)).length).toBeGreaterThan(1));fill('Franchise',f.B);await waitFor(()=>expect(screen.getByLabelText('Franchise')).toHaveValue(f.B));await act(async()=>slow.resolve(f.json(path.includes('pricing')?f.quote:f.tax)));expect(summary().queryByText('₹134.00')).toBeNull();expect(screen.getByLabelText('Customer name')).toHaveValue('');
 });
 it('scope change cancels late receipt and drops its private snapshot',async()=>{
  await entered();save();await screen.findByRole('heading',{name:'Booking saved'});const slow=f.deferred<Response>();override=c=>c.path.includes('/receipt')?slow.promise:undefined;fireEvent.click(screen.getByRole('button',{name:'Load receipt'}));await waitFor(()=>expect(calls.some(c=>c.path.includes('/receipt'))).toBe(true));fill('Franchise',f.B);await waitFor(()=>expect(screen.getByLabelText('Franchise')).toHaveValue(f.B));await act(async()=>slow.resolve(f.json(f.receipt)));expect(document.body.textContent).not.toContain(f.receipt.number);
 });
});

it('keeps the entered booking when leaving the draft is cancelled',async()=>{
 await start();fill('Customer name','Unsaved sender');fireEvent.click(within(screen.getByRole('navigation',{name:'Workspace navigation'})).getByRole('link',{name:'Receipts'}));await screen.findByRole('dialog',{name:'Discard this booking draft?'});fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));expect(screen.getByLabelText('Customer name')).toHaveValue('Unsaved sender');expect(posts('/api/v1/bookings?')).toHaveLength(0);
});

it('adds and removes packages directly below the docket row before saving a customer',async()=>{
 await start();
 const add=screen.getByRole('button',{name:'Add package'});
 expect(screen.getByLabelText('Docket number').compareDocumentPosition(add)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(add.compareDocumentPosition(screen.getByLabelText('Weight (kg)'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 fireEvent.click(add);fill('Parcel 2 docket number','SECOND-001');fireEvent.click(add);
 expect(screen.getByLabelText('Parcel 2 docket number')).toHaveValue('SECOND-001');expect(screen.getByLabelText('Parcel 3 docket number')).toHaveValue('');expect(screen.getByText('3 packages in this booking')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Remove package 3'}));expect(screen.queryByLabelText('Parcel 3 docket number')).toBeNull();expect(screen.getByText('2 packages in this booking')).toBeVisible();
 expect(posts(`/api/v1/organizations/${f.org}/franchises/${f.A}/customers`)).toHaveLength(0);expect(posts('/api/v1/bookings?')).toHaveLength(0);
});
it('cancels an unsaved booking only after confirming discard and can keep editing',async()=>{
 await start();fill('Customer name','Unsaved sender');fireEvent.click(screen.getByRole('button',{name:'Add package'}));fill('Parcel 2 docket number','KEEP-002');
 fireEvent.click(screen.getByRole('button',{name:'Cancel booking'}));await screen.findByRole('dialog',{name:'Discard this booking draft?'});fireEvent.click(screen.getByRole('button',{name:'Keep editing'}));
 expect(screen.getByLabelText('Customer name')).toHaveValue('Unsaved sender');expect(screen.getByLabelText('Parcel 2 docket number')).toHaveValue('KEEP-002');
 fireEvent.click(screen.getByRole('button',{name:'Cancel booking'}));fireEvent.click(screen.getByRole('button',{name:'Discard booking draft'}));await waitFor(()=>expect(window.location.hash).toBe('#/business/bookings'));
 expect(posts('/api/v1/bookings')).toHaveLength(0);
});

it('saves directly from the page without a billing confirmation popup or declaration checkbox',async()=>{
 await start();core();fill('Parcel handed over in','27');save();
 await screen.findByRole('heading',{name:'Booking saved'});expect(screen.queryByRole('dialog')).toBeNull();
 expect(posts('/api/v1/bookings?')).toHaveLength(1);expect(body(posts('/api/v1/tax/intents')[0]).facts).toMatchObject({handover_state:'27',evidence_ref:'COUNTER_ENTRY'});
 expect(screen.queryByLabelText('I checked these billing and handover details with the customer.')).toBeNull();
});

it.each(['/api/v1/pricing/quote','/api/v1/tax/intents','/api/v1/tax/calculations'])('direct save retains the exact %s request after a lost acknowledgement',async path=>{
 await start();core();fill('Parcel handed over in','27');let first=true;
 override=c=>c.path.startsWith(path)&&first?(first=false,Promise.reject(new TypeError('lost acknowledgement'))):undefined;
 save();await screen.findByRole('button',{name:'Retry booking request'});expect(posts('/api/v1/bookings?')).toHaveLength(0);expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Retry booking request'}));await screen.findByRole('heading',{name:'Booking saved'});
 const attempts=posts(path);expect(attempts.length).toBeGreaterThanOrEqual(2);expect([attempts[0].options.body,key(attempts[0])]).toEqual([attempts[1].options.body,key(attempts[1])]);expect(posts('/api/v1/bookings?')).toHaveLength(1);
});
it('keeps required registered billing facts inline and does not save an invalid GSTIN',async()=>{
 await start();core();fill('GST registration','registered');fill('Billing state','27');fill('GSTIN','invalid');save();
 await waitFor(()=>expect(screen.getByLabelText('GSTIN')).toHaveAttribute('aria-invalid','true'));expect(screen.queryByRole('dialog')).toBeNull();expect(posts('/api/v1/bookings?')).toHaveLength(0);expect(posts('/api/v1/tax/intents')).toHaveLength(0);
});

it('uses the saved demo GST setting for a live summary and saves without billing steps',async()=>{
 override=c=>c.path.includes('/tax/settings')?Promise.resolve(f.json({id:f.id(82),mode:'courier18',supplier_state:'27',version:2})):undefined;
 await start();core();await waitFor(()=>expect(screen.getByLabelText('Parcel handed over in')).toHaveValue('27'));
 await waitFor(()=>expect(summary().getByText('CGST 9%')).toBeVisible());expect(summary().getByText('SGST 9%')).toBeVisible();
 expect(screen.getByRole('button',{name:'Calculate total'})).not.toBeVisible();expect(screen.getByLabelText('GST registration')).not.toBeVisible();
 save();await screen.findByRole('heading',{name:'Booking saved'});
 expect(posts('/api/v1/bookings?')).toHaveLength(1);expect(body(posts('/api/v1/tax/intents')[0]).facts.handover_state).toBe('27');
});
