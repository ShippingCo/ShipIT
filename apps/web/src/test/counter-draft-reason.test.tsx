import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import * as f from './counter-fixture';
type Call={path:string;options:RequestInit};
let savedEntries:Record<string,unknown>[]=[];
let calls:Call[], override:((c:Call)=>Promise<Response>|undefined)|undefined;
const configured={id:f.id(82),mode:'courier18',supplier_state:'27',version:1};
let taxSettings:unknown=configured;
const posts=(part:string)=>calls.filter(c=>c.path.startsWith(part)&&c.options.method==='POST');
const body=(c:Call)=>JSON.parse(c.options.body as string);
beforeEach(()=>{
 window.location.hash='/business/new-booking';calls=[];override=undefined;savedEntries=[];taxSettings=configured;vi.stubEnv('VITE_DATA_MODE','production');
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  const c={path,options};calls.push(c);const result=override?.(c);if(result)return result;
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});
  if(path.startsWith('/api/v1/operator-context'))return f.json({...f.context,active_franchise_id:f.A});
  if(path.includes('/customers'))return f.json(options.method==='GET'&&path.includes('?')?{items:[f.customer],page:{has_more:false,next_cursor:null}}:f.customer,options.method==='POST'?201:200);
  if(path.startsWith('/api/v1/customer-account-choices'))return f.json({items:[],next_cursor:null});
  if(path.includes('/pricing/services'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
  if(path.includes('/tax/settings'))return f.json(taxSettings);
  if(path.includes('/pricing/versions'))return f.json(f.rateCard);
  if(path.startsWith('/api/v1/pricing/quote'))return f.json(f.quote);
  if(path.startsWith('/api/v1/tax/intents'))return f.json(f.intent);
  if(path.startsWith('/api/v1/tax/calculations'))return f.json(f.tax);
  if(path.startsWith('/api/v1/parcels'))return f.json({items:[],page:{next_cursor:null,has_more:false}});
  if(path.includes('/receipt'))return f.json(f.receipt);
  if(path.includes('/payments'))return f.json(f.balance);
  if(path.includes('/attachments'))return f.json({items:[]});
  if(path.startsWith('/api/v1/bookings/entries?')){if(options.method==='POST'){const entry={id:f.id(300+savedEntries.length),state:'confirmed',organization_id:f.org,franchise_id:f.A,confirmed_at:f.now,data:body(c)};savedEntries.push(entry);return f.json(entry,201);}return f.json({items:savedEntries});}
  if(path.startsWith('/api/v1/bookings?'))return f.json(f.booking,201);
  if(path==='/auth/logout')return f.json({ok:true});
  throw new Error('Unexpected synthetic endpoint '+path);
 }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
const fill=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label,{exact:true}),{target:{value}});
const summary=()=>within(screen.getByRole('complementary',{name:'Booking summary'}));
async function start(){render(<App/>);await screen.findByRole('heading',{name:'New booking',level:1});await waitFor(()=>expect(document.querySelector('#booking-cities option')).not.toBeNull());}
function core(){fill('Customer name',f.customer.name);fill('WhatsApp number',f.customer.phone_display);fill('Delivery address','21 Fictional Street');fill('Destination city','SYN DEST');fill('Docket number','DOCK1234');fill('Weight (kg)','0.999');chooseService();fill('Freight ₹','125.51');fill('Packing ₹','2.49');}
// Nothing is priced until a service is chosen: see the counter PRD's R-19.
const chooseService=()=>{const card=screen.queryByRole('radio',{name:/Standard/});if(card)fireEvent.click(card);else fill('Service','standard');};
async function complete(){await start();core();await waitFor(()=>expect(summary().getByText('₹151.04')).toBeVisible());}
const press=()=>fireEvent.click(screen.getByRole('button',{name:/^Save (booking|as draft)/}));

describe('a draft always says why it is a draft',{timeout:20000},()=>{
 it('names an unconfigured shop GST before the button is pressed, and does not promise a booking',async()=>{
  // A shop that has never set its GST cannot complete any booking at all: every press used to
  // become a draft with no explanation, which is what the counter reported.
  taxSettings={id:null,mode:null,supplier_state:'',version:0};
  // No GST treatment means no tax line at all, so wait on the rate-card quote instead.
  await start();core();await waitFor(()=>expect(summary().getByText('₹125.51')).toBeVisible());
  expect(screen.getByRole('button',{name:'Save as draft'})).toBeVisible();
  expect(screen.queryByRole('button',{name:/^Save booking/})).toBeNull();
  expect(screen.getByText(/GST is not set up/)).toBeVisible();
  press();
  await screen.findByRole('heading',{name:'Draft saved'});
  expect(screen.getByRole('alert')).toHaveTextContent(/GST is not set up/);
  // The way out is Settings, not another lap of the same form.
  expect(screen.getByRole('link',{name:'Open Settings'})).toHaveAttribute('href','#/business/settings');
  expect(screen.queryByRole('button',{name:'Finish this booking'})).toBeNull();
  expect(posts('/api/v1/bookings?')).toHaveLength(0);
 });
 it('names a docket the server has already used instead of a bare draft',async()=>{
  override=c=>c.path.startsWith('/api/v1/bookings?')&&c.options.method==='POST'?Promise.resolve(f.json({error:{code:'DOCKET_CONFLICT'}},409)):undefined;
  await complete();press();
  await screen.findByRole('heading',{name:'Draft saved'});
  expect(screen.getByRole('alert').textContent).toMatch(/docket/i);
  expect(posts('/api/v1/bookings/entries?')).toHaveLength(1);
 });
 it('names a refused tax calculation instead of a bare draft',async()=>{
  override=c=>c.path.startsWith('/api/v1/tax/intents')?Promise.resolve(f.json({error:{code:'TAX_POLICY_UNAVAILABLE'}},409)):undefined;
  await complete();press();
  await screen.findByRole('heading',{name:'Draft saved'});
  expect(screen.getByRole('alert').textContent?.trim()).not.toBe('');
  expect(screen.getByRole('alert').textContent).not.toMatch(/^Draft saved/);
 });
 it('still saves a deliberate draft with no alarm when the operator simply has less to type',async()=>{
  await start();fill('Customer name','Partial sender');
  fireEvent.click(screen.getByRole('button',{name:'Save as draft'}));
  await screen.findByRole('heading',{name:'Draft saved'});
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(/Still needed:/)).toBeVisible();
 });
 it('a configured shop still completes the booking', async()=>{
  await complete();
  // The button states the amount it will take, because the counter defaults to cash now.
  expect(screen.getByRole('button',{name:/^Save booking and collect /})).toBeVisible();
  press();await screen.findByRole('heading',{name:'Booking saved'});
  expect(posts('/api/v1/bookings?')).toHaveLength(1);
 });
});
