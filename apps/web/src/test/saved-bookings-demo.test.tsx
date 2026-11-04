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
  expect(screen.getByRole('button',{name:'Active 1'})).toBeVisible();
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
  for(const text of ['At hub','Dispatched','In transit','Out','Delivered','No parcel photo','Timeline','Booking created at counter','Send custom WhatsApp update','Saved address'])expect(dialog.getByText(text,{exact:true})).toBeVisible();
  expect(dialog.getByLabelText('Message to customer')).toBeVisible();expect(dialog.getByRole('button',{name:'Print receipt'})).toBeVisible();expect(dialog.getByLabelText('Move to lot')).toBeVisible();
  expect(dialog.getByRole('button',{name:'Check In at Hub'})).toBeDisabled();
  expect(dialog.getByText('Not recorded',{exact:true})).toBeVisible();
  fireEvent.click(dialog.getByRole('button',{name:'Close'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 });
 it('does not misrepresent selected Paid now as recorded money or missing amounts as zero',()=>{
  const row=counterBookingRow(entry);expect(row.payment).toBe('unknown');expect(row.amount).toBe(5900);
  const empty=counterBookingRow({...entry,data:{fields:{},additional_parcels:[]}});expect(empty.amount).toBeNull();expect(empty.weight).toBeNull();
  expect(filterSavedBookings([row],'topay')).toHaveLength(0);expect(filterSavedBookings([row],'active')).toHaveLength(1);
 });
});
