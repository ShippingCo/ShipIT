import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Receipts from '../booking/Receipts';
import Messaging from '../operations/Messaging';
import {createScopeController} from '../operator/scope';
import {businessDay,dayStart} from '../operations/business-dates';
import {dateWindow} from '../components/m3/Controls';
import * as fixture from './counter-fixture';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2099-01-01T00:00:00.000Z';
const controller=()=>{const c=createScopeController();c.runtime.bind({userId:id(1),organizationId:id(2),franchiseId:id(3),permissions:'operator'});return c;};
const page=(items:unknown[],more=false)=>({items,page:{has_more:more,next_cursor:more?'synthetic-next':null}});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('filters saved receipts by IST booking date and keeps the range while paging',async()=>{
 const record={id:id(4),booking_id:fixture.bookingId,version:1,status:'booked',custody:'awaiting_intake',docket:'SYN-RECEIPT',weight_grams:1000,confirmed_at:at,sender:{source_customer_id:fixture.customerId,source_customer_version:1,name:'Saved sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Saved address'},recipient:{name:null,phone_normalized:null,phone_display:null,address:'Saved destination'}};
 const request=vi.fn(async(path:string)=>path.includes('/parcels?')?Response.json(page([record],!path.includes('cursor='))):Response.json(fixture.receipt));vi.stubGlobal('fetch',request);
 render(<MemoryRouter><Receipts controller={controller()}/></MemoryRouter>);await screen.findByText('SYN-RECEIPT');
 fireEvent.click(screen.getByRole('button',{name:'All time'}));fireEvent.click(screen.getByRole('button',{name:'This week'}));expect(screen.getByText('No receipts match')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'More receipts'}));await waitFor(()=>expect(request.mock.calls.some(([path])=>path.includes('cursor=synthetic-next'))).toBe(true));expect(screen.getByRole('button',{name:'This week'})).toBeVisible();expect(new URL(request.mock.calls.find(([path])=>path.includes('cursor=synthetic-next'))![0],'http://localhost').searchParams.get('franchise_id')).toBe(id(3));
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));await screen.findAllByText('SYN-RECEIPT');
});
it('uses exclusive IST day boundaries and native custom-range constraints',async()=>{
 expect(dateWindow('today')).toEqual([Date.parse(dayStart(businessDay())),expect.any(Number)]);
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json(page([]))));render(<MemoryRouter><Receipts controller={controller()}/></MemoryRouter>);await screen.findByText('No receipts yet');fireEvent.click(screen.getByRole('button',{name:'All time'}));
 fireEvent.change(screen.getByLabelText('From'),{target:{value:'2026-11-03'}});expect(screen.getByLabelText('To')).toHaveAttribute('min','2026-11-03');
 const [start,end]=dateWindow('custom',{from:'2026-11-03',to:'2026-11-03'});expect(start).toBe(Date.parse('2026-11-02T18:30:00.000Z'));expect(end).toBe(Date.parse('2026-11-03T18:29:59.999Z'));
});
it('shows queued provider work as waiting in the feed and uses scoped notification filters without send claims',async()=>{
 const row={id:id(8),row_kind:'message',effective_time:at,source_id:id(9),source_kind:'event',affected_id:id(10),correlation_id:id(11),notification_kind:'booking_confirmation',decision:null,message:{id:id(8),state:'queued',reason_code:'pending',version:1,attempt_count:0,progress:'none',failure_observed:false,observed_at:null},fanout:null,recovery:{kind:'none',expected_version:1,allowed_reasons:[]}};
 const request=vi.fn(async(_path:string)=>Response.json(page([row])));vi.stubGlobal('fetch',request);render(<MemoryRouter initialEntries={['/business/automation?view=advanced']}><Messaging controller={controller()} roles={['operator']}/></MemoryRouter>);
 expect(await screen.findByRole('list',{name:'Message history'})).toHaveTextContent('Waiting');expect(screen.getByRole('list',{name:'Message history'})).toHaveTextContent('0 recorded attempts');expect(screen.getByRole('list',{name:'Message history'})).not.toHaveTextContent('Sent');
 fireEvent.click(screen.getByRole('button',{name:'Bookings'}));await waitFor(()=>expect(request.mock.calls.length).toBe(2));
 const url=new URL(request.mock.calls[1]![0],'http://localhost');expect(url.searchParams.get('kind')).toBe('booking_confirmation');expect(url.searchParams.get('franchise_id')).toBe(id(3));
});
