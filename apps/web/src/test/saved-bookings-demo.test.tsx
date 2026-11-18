import React from 'react';
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {SavedBookings,counterBookingRow,filterSavedBookings} from '../operations/SavedBookings';
import {createScopeController} from '../operator/scope';
import type {OperatorDataSource} from '../operator/data-source';
import * as f from './counter-fixture';
const entry={id:f.id(300),state:'confirmed' as const,organization_id:f.org,franchise_id:f.A,confirmed_at:f.now,data:{fields:{name:'Saved customer',phone:'+919876543210',recipientAddress:'Saved address',docket:'REAL-123',destination:'MUMBAI',weight:'1000',service:'standard',packing:'3900',override:'2000',paymentMode:'paid_counter'},additional_parcels:[]}};
beforeEach(()=>vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
 if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[entry]});
 if(path.startsWith('/api/v1/parcels?')||path.startsWith('/api/v1/lots?'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
 throw Error('Unexpected read');
})));
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
async function start(){
 const controller=createScopeController({loadContext:vi.fn().mockResolvedValue(f.context)} as unknown as OperatorDataSource);await controller.load();
 render(<MemoryRouter><SavedBookings controller={controller} roles={['org_admin']} operationalDetail={()=>null}/></MemoryRouter>);
 await screen.findByText('REAL-123');
}
describe('saved bookings use the demo composition',()=>{
 it('shows the exact table columns, search, date menu and counted chips with real saved data',async()=>{
  await start();
  for(const label of ['Docket','Customer','To · Lot','Amount','Payment','Status'])expect(screen.getByRole('columnheader',{name:label})).toBeVisible();
  expect(screen.getByPlaceholderText('Search docket, name, phone or city')).toBeVisible();
  expect(screen.getByRole('button',{name:/All time/})).toBeVisible();
  expect(screen.getByRole('button',{name:'All 1'})).toHaveAttribute('aria-pressed','true');
  // The saved entry is a draft, so it is counted as one and never as work in motion.
  expect(screen.getByRole('button',{name:'Drafts 1'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Active 0'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Cancelled 0'})).toBeVisible();
  expect(screen.getByText('Draft — not booked')).toBeVisible();
  expect(screen.getByText('Mumbai')).toBeVisible();expect(screen.getByText('₹59')).toBeVisible();
  expect(screen.queryByRole('heading',{name:'Confirmed counter bookings'})).toBeNull();
 });
 it('searches the saved customer phone and filters delivered without inserting demo rows',async()=>{
  await start();fireEvent.change(screen.getByRole('textbox',{name:'Search packages'}),{target:{value:'987654'}});expect(screen.getByText('REAL-123')).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Delivered 0'}));expect(screen.queryByText('REAL-123')).toBeNull();expect(screen.getByText('Nothing matches that search')).toBeVisible();
 });
 it('opens the matching journey and two-column dialog on row click, with the actual confirmation timeline',async()=>{
  await start();fireEvent.click(screen.getByText('REAL-123'));
  const dialog=within(await screen.findByRole('dialog'));
  for(const text of ['Timeline','Draft saved at the counter','Saved address'])expect(dialog.getByText(text,{exact:true})).toBeVisible();
  // A draft never entered the parcel journey, so no stage of it is claimed.
  for(const text of ['At hub','Dispatched','In transit','Delivered'])expect(dialog.queryByText(text,{exact:true})).toBeNull();
  expect(dialog.getByText(/not a booking/)).toBeVisible();
  expect(dialog.queryByRole('button',{name:'Check In at Hub'})).toBeNull();
  expect(dialog.getByRole('button',{name:'Finish this booking'})).toBeVisible();
  expect(dialog.getByRole('button',{name:'Print receipt'})).toBeVisible();
  // Shown in the header badge and in the details: never as a paid or zero amount.
  expect(dialog.getAllByText('Not recorded',{exact:true})[0]).toBeVisible();
  fireEvent.click(dialog.getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 });
 it('does not misrepresent selected Paid now as recorded money or missing amounts as zero',()=>{
  const row=counterBookingRow(entry);expect(row.payment).toBe('unknown');expect(row.amount).toBe(5900);
  expect(row.status).toBe('draft');
  const empty=counterBookingRow({...entry,data:{fields:{},additional_parcels:[]}});expect(empty.amount).toBeNull();expect(empty.weight).toBeNull();
  // Without a typed docket the row shows a readable draft number, never a sliced identifier.
  expect(empty.docket).toMatch(/^D-[0-9A-HJ-NP-Z]{6}$/);
  expect(filterSavedBookings([row],'topay')).toHaveLength(0);
  expect(filterSavedBookings([row],'active')).toHaveLength(0);
  expect(filterSavedBookings([row],'drafts')).toHaveLength(1);
  // A cancelled booking is listed under Cancelled only; it owes nothing, so it is never To Pay.
  const cancelled={...row,status:'cancelled',payment:'topay' as const};
  expect(filterSavedBookings([cancelled],'cancelled')).toHaveLength(1);expect(filterSavedBookings([cancelled],'topay')).toHaveLength(0);expect(filterSavedBookings([cancelled],'active')).toHaveLength(0);
 });
});
it('keeps the saved-booking popup open while an embedded shipment command is pending or uncertain',async()=>{
 const parcel={...f.booking.parcels[0],booking_id:f.bookingId,version:1,custody:'awaiting_intake',confirmed_at:f.now,sender:{source_customer_id:f.customerId,source_customer_version:1,name:'Saved sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Saved address'},recipient:{name:null,phone_normalized:null,phone_display:null,address:'Saved destination'}};
 let release!:(value:Response)=>void;const checkIn=new Promise<Response>(resolve=>{release=resolve;});
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});
  if(path.includes('/check-in?'))return checkIn;
  if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[]});
  if(path.startsWith('/api/v1/parcels?'))return f.json({items:[parcel],page:{has_more:false,next_cursor:null}});
  if(path.includes('/lot-membership'))return f.json(null);
  if(path.includes('/timeline'))return f.json({items:[]});
  if(path.startsWith('/api/v1/lots?'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
  if(path.includes('/payments'))return f.json(f.balance);
  throw Error('Unexpected read');
 }));
 const controller=createScopeController({loadContext:vi.fn().mockResolvedValue(f.context)} as unknown as OperatorDataSource);await controller.load();
 render(<MemoryRouter><SavedBookings controller={controller} roles={['org_admin']}/></MemoryRouter>);
 // The parcel sheet carries the next step itself: name the hub once, then check in.
 fireEvent.click(await screen.findByText('SYN-33'));
 fireEvent.change(await screen.findByLabelText('Name of the hub'),{target:{value:'Synthetic hub'}});
 fireEvent.click(screen.getByRole('button',{name:'Save hub'}));
 fireEvent.click(await screen.findByRole('button',{name:'Check in at Synthetic hub'}));
 await screen.findByRole('button',{name:'Checking in…'});
 // While the check-in is in flight the sheet cannot be dismissed and nothing else moves.
 expect(screen.queryByRole('button',{name:'Close'})).toBeNull();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByLabelText('Move to lot')).toBeDisabled();
 release(f.json({id:parcel.id,booking_id:f.bookingId,docket:parcel.docket,version:2,status:'checked_in',custody:'franchise_office',attempts_started:0,failed_attempt_count:0,event_id:f.id(990),transitioned_at:f.now}));
 fireEvent.click(await screen.findByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});

it('shows the server planning lot on an incomplete saved booking without fabricating a shipment membership',async()=>{
 const lot={id:f.id(420),code:'LOT-0000000000000000001',name:'Synthetic planning lot',destination_key:'MUMBAI',state:'active',version:1,created_at:f.now,updated_at:f.now,archived_at:null,active_member_count:0,planning_entry_ids:[entry.id]};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[entry]});
  if(path.startsWith('/api/v1/lots?'))return f.json({items:[lot],page:{has_more:false,next_cursor:null}});
  if(path.startsWith('/api/v1/parcels?'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
  throw Error('Unexpected read');
 }));
 await start();expect(await screen.findByText(lot.code)).toBeVisible();
});

it('keeps the parcels a check-in sheet opened with while the list behind it reloads, and closes it on done',async()=>{
 // The sheet used to read its parcels live from the list. The list reloads as soon as a
 // check-in succeeds, the parcel is then "at hub", and the sheet threw away its own success
 // and said none of the chosen parcels was waiting to be checked in.
 const parcel={...f.booking.parcels[0],booking_id:f.bookingId,version:1,custody:'awaiting_intake',confirmed_at:f.now,sender:{source_customer_id:f.customerId,source_customer_version:1,name:'Saved sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Saved address'},recipient:{name:null,phone_normalized:null,phone_display:null,address:'Saved destination'}};
 let current={...parcel,status:'booked'};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[]});
  if(path.startsWith('/api/v1/parcels?'))return f.json({items:[current],page:{has_more:false,next_cursor:null}});
  if(path.includes('/lot-membership'))return f.json(null);
  if(path.startsWith('/api/v1/lots?'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
  if(path.includes('/payments'))return f.json(f.balance);
  throw Error('Unexpected read');
 }));
 const controller=createScopeController({loadContext:vi.fn().mockResolvedValue(f.context)} as unknown as OperatorDataSource);await controller.load();
 render(<MemoryRouter><SavedBookings controller={controller} roles={['org_admin']} operationalDetail={()=>null}
  operationalBulk={(rows,action,_busy,refresh,done)=><><p>Sheet holds {rows.map(row=>row.docket+' '+row.status).join(', ')} for {action}</p>
   <button onClick={refresh}>Reload synthetic list</button><button onClick={done}>Finish synthetic sheet</button></>}/></MemoryRouter>);
 // The next step sits on the parcel's own row, so one parcel needs no ticking.
 fireEvent.click(await screen.findByRole('button',{name:'Check in SYN-33'}));
 expect(screen.getByText('Sheet holds SYN-33 booked for check_in')).toBeVisible();
 current={...parcel,status:'checked_in',version:2};
 fireEvent.click(screen.getByRole('button',{name:'Reload synthetic list'}));
 // The open sheet hides the list from assistive technology, so the row is found as hidden.
 await screen.findByRole('button',{name:'Add to trip SYN-33',hidden:true});
 expect(screen.getByText('Sheet holds SYN-33 booked for check_in')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Finish synthetic sheet'}));
 await waitFor(()=>expect(screen.queryByText(/Sheet holds/)).toBeNull());
});
it("cancels a booked parcel's booking from its sheet and offers no cancel once the parcel has left on a trip",async()=>{
 const base={...f.booking.parcels[0],booking_id:f.bookingId,version:1,custody:'awaiting_intake',confirmed_at:f.now,sender:{source_customer_id:f.customerId,source_customer_version:1,name:'Saved sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Saved address'},recipient:{name:null,phone_normalized:null,phone_display:null,address:'Saved destination'}};
 const onTrip={...base,id:f.id(401),docket:'SYN-TRIP',status:'dispatched'};
 const posts:RequestInit[]=[];let cancelled=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});
  if(path.includes('/cancellation?')){
   if(options.method==='POST'){posts.push(options);cancelled=true;return f.json({id:f.id(402),booking_id:f.bookingId,parcel_count:1,outstanding_paise:'0',reversed_paise:'15000',refunded_paise:'15000',refunds:[{method:'upi',amount_paise:'15000'}],cancelled_at:f.now});}
   return f.json({booking_id:f.bookingId,parcel_count:1,outstanding_paise:'0',reversed_paise:'15000',refund_paise:'15000',refunds:[{method:'upi',amount_paise:'15000'}],financial_version:1,payment_version:1,blocked_reason:null});
  }
  if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[]});
  if(path.startsWith('/api/v1/parcels?'))return f.json({items:[{...base,status:cancelled?'cancelled':'booked'},onTrip],page:{has_more:false,next_cursor:null}});
  if(path.includes('/lot-membership'))return f.json(null);
  if(path.includes('/timeline'))return f.json({items:[]});
  if(path.startsWith('/api/v1/lots?'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
  if(path.includes('/payments'))return f.json(f.balance);
  throw Error('Unexpected read');
 }));
 const controller=createScopeController({loadContext:vi.fn().mockResolvedValue(f.context)} as unknown as OperatorDataSource);await controller.load();
 render(<MemoryRouter><SavedBookings controller={controller} roles={['operator']}/></MemoryRouter>);
 // A parcel already on a trip has left; its sheet offers no cancel.
 fireEvent.click(await screen.findByText('SYN-TRIP'));await screen.findByRole('dialog');
 expect(screen.queryByRole('button',{name:'Cancel booking'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 // A booked parcel can be cancelled: the sheet gives way to the confirmation, which says what
 // happens to the money and needs a reason before the red button works.
 fireEvent.click(screen.getByText('SYN-33'));
 fireEvent.click(await screen.findByRole('button',{name:'Cancel booking'}));
 const dialog=await screen.findByRole('dialog');await within(dialog).findByText('₹150.00');
 const confirm=within(dialog).getByRole('button',{name:'Cancel booking'});
 fireEvent.click(within(dialog).getByRole('button',{name:'Booked by mistake'}));
 fireEvent.click(confirm);
 fireEvent.click(await within(dialog).findByRole('button',{name:'Yes, cancel booking'}));
 expect(await screen.findByText('1 parcel cancelled.')).toBeVisible();expect(screen.getByText('₹150.00 by UPI')).toBeVisible();
 expect(posts).toHaveLength(1);expect(JSON.parse(String(posts[0]!.body))).toEqual({reason:'Booked by mistake',expected_financial_version:1,expected_payment_version:1});
 fireEvent.click(screen.getByRole('button',{name:'Done'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
});
it("cancels several bookings at once from the chosen-parcel bar and skips one that cannot be cancelled",async()=>{
 const base={...f.booking.parcels[0],version:1,custody:'awaiting_intake',confirmed_at:f.now,sender:{source_customer_id:f.customerId,source_customer_version:1,name:'Saved sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Saved address'},recipient:{name:null,phone_normalized:null,phone_display:null,address:'Saved destination'}};
 const items=[{...base,id:f.id(511),docket:'SYN-A',booking_id:f.id(501),status:'booked'},{...base,id:f.id(512),docket:'SYN-B',booking_id:f.id(502),status:'checked_in'},{...base,id:f.id(513),docket:'SYN-C',booking_id:f.id(503),status:'booked'}];
 const posts:{path:string;init:RequestInit}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});
  const booking=/bookings\/([0-9a-f-]{36})\/cancellation/.exec(path)?.[1];
  if(booking){
   if(options.method==='POST'){posts.push({path,init:options});return f.json({id:f.id(520+posts.length),booking_id:booking,parcel_count:1,outstanding_paise:'0',reversed_paise:'10000',refunded_paise:'10000',refunds:[{method:'cash',amount_paise:'10000'}],cancelled_at:f.now});}
   return f.json({booking_id:booking,parcel_count:1,outstanding_paise:'0',reversed_paise:'10000',refund_paise:'10000',refunds:[{method:'cash',amount_paise:'10000'}],financial_version:1,payment_version:1,blocked_reason:booking===f.id(503)?'account_billed':null,in_bag:booking===f.id(502)});
  }
  if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[]});
  if(path.startsWith('/api/v1/parcels?'))return f.json({items,page:{has_more:false,next_cursor:null}});
  if(path.startsWith('/api/v1/lots?'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
  if(path.includes('/payments'))return f.json(f.balance);
  throw Error('Unexpected read '+path);
 }));
 const controller=createScopeController({loadContext:vi.fn().mockResolvedValue(f.context)} as unknown as OperatorDataSource);await controller.load();
 render(<MemoryRouter><SavedBookings controller={controller} roles={['operator']}/></MemoryRouter>);
 await screen.findByText('SYN-A');
 for(const d of ['SYN-A','SYN-B','SYN-C'])fireEvent.click(screen.getByRole('checkbox',{name:'Select '+d}));
 fireEvent.click(screen.getByRole('button',{name:'Cancel booking'}));
 const dialog=await screen.findByRole('dialog',{name:'Cancel these bookings?'});
 await within(dialog).findByText(/in 2 bookings will be cancelled right away/);
 expect(within(dialog).getByText('Already on a monthly account statement.')).toBeVisible();
 // A parcel in a bag is no obstacle: it is taken out as part of the cancel, and the window says so.
 expect(within(dialog).getByText('1 booking is in a bag and will be taken out of it.')).toBeVisible();expect(within(dialog).getByText('Comes out of its bag')).toBeVisible();
 expect(within(dialog).getByText('₹200.00')).toBeVisible();
 // The reason is optional: cancelling without one records that none was given.
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel 2 bookings'}));
 // A second, explicit yes is needed; going back sends nothing.
 expect(within(dialog).getByText(/Cancel 2 bookings and refund ₹200.00\?/)).toBeVisible();fireEvent.click(within(dialog).getByRole('button',{name:'Go back'}));expect(posts).toHaveLength(0);
 fireEvent.click(within(dialog).getByRole('button',{name:'Cancel 2 bookings'}));fireEvent.click(within(dialog).getByRole('button',{name:'Yes, cancel 2 bookings'}));
 expect(await within(dialog).findByText('2 parcels cancelled.')).toBeVisible();expect(within(dialog).getByText('₹200.00 by cash')).toBeVisible();
 // One request per booking, each with its own retry identity; the skipped booking is never sent.
 expect(posts.map(p=>p.path.includes(f.id(503)))).toEqual([false,false]);
 const keys=posts.map(p=>new Headers(p.init.headers).get('idempotency-key'));expect(new Set(keys).size).toBe(2);
 expect(posts.map(p=>JSON.parse(String(p.init.body)).reason)).toEqual(['No reason given','No reason given']);
});
