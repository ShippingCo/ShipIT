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
  for(const label of ['Docket','Customer','To','Lot','Amount','Payment','Status'])expect(screen.getByRole('columnheader',{name:label})).toBeVisible();
  expect(screen.getByPlaceholderText('Search docket, name, phone or city')).toBeVisible();
  expect(screen.getByRole('button',{name:/All time/})).toBeVisible();
  expect(screen.getByRole('button',{name:'All 1'})).toHaveAttribute('aria-pressed','true');
  // The saved entry is a draft, so it is counted as one and never as work in motion.
  expect(screen.getByRole('button',{name:'Drafts 1'})).toBeVisible();
  expect(screen.getByRole('button',{name:'Active 0'})).toBeVisible();
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
  for(const text of ['No parcel photo','Timeline','Draft saved at the counter','Send custom WhatsApp update','Saved address'])expect(dialog.getByText(text,{exact:true})).toBeVisible();
  // A draft never entered the parcel journey, so no stage of it is claimed.
  for(const text of ['At hub','Dispatched','In transit','Delivered'])expect(dialog.queryByText(text,{exact:true})).toBeNull();
  expect(dialog.getByText(/not a booking/)).toBeVisible();
  expect(dialog.queryByRole('button',{name:'Check In at Hub'})).toBeNull();
  expect(dialog.getByRole('button',{name:'Finish this booking'})).toBeVisible();
  expect(dialog.getByLabelText('Message to customer')).toBeVisible();expect(dialog.getByRole('button',{name:'Print receipt'})).toBeVisible();
  expect(dialog.getByText('Not recorded',{exact:true})).toBeVisible();
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
 });
});
it('keeps the saved-booking popup open while an embedded shipment command is pending or uncertain',async()=>{
 const parcel={...f.booking.parcels[0],booking_id:f.bookingId,version:1,custody:'awaiting_intake',confirmed_at:f.now,sender:{source_customer_id:f.customerId,source_customer_version:1,name:'Saved sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Saved address'},recipient:{name:null,phone_normalized:null,phone_display:null,address:'Saved destination'}};
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[]});
  if(path.startsWith('/api/v1/parcels?'))return f.json({items:[parcel],page:{has_more:false,next_cursor:null}});
  if(path.includes('/lot-membership'))return f.json(null);
  if(path.includes('/timeline'))return f.json({items:[]});
  if(path.startsWith('/api/v1/lots?'))return f.json({items:[],page:{has_more:false,next_cursor:null}});
  if(path.includes('/payments'))return f.json(f.balance);
  throw Error('Unexpected read');
 }));
 const controller=createScopeController({loadContext:vi.fn().mockResolvedValue(f.context)} as unknown as OperatorDataSource);await controller.load();
 render(<MemoryRouter><SavedBookings controller={controller} roles={['org_admin']} operationalDetail={(_id,_close,_refresh,busy)=><><button onClick={()=>busy(true)}>Start synthetic shipment command</button><button onClick={()=>busy(false)}>Resolve synthetic shipment command</button></>}/></MemoryRouter>);
 fireEvent.click(await screen.findByText('SYN-33'));fireEvent.click(screen.getByRole('button',{name:'Check In at Hub'}));fireEvent.click(screen.getByRole('button',{name:'Start synthetic shipment command'}));
 expect(screen.queryByRole('button',{name:'Close'})).toBeNull();fireEvent.keyDown(screen.getByRole('dialog'),{key:'Escape'});expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByLabelText('Move to lot')).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Resolve synthetic shipment command'}));fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
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
