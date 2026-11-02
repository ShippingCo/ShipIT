import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Receipts from '../booking/Receipts';
import Messaging from '../operations/Messaging';
import {createScopeController} from '../operator/scope';
import {businessDay,weekMonday,dayStart,shiftDay} from '../operations/business-dates';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const at='2099-01-01T00:00:00.000Z';
const controller=()=>{const c=createScopeController();c.runtime.bind({userId:id(1),organizationId:id(2),franchiseId:id(3),permissions:'operator'});return c;};
const page=(items:unknown[],more=false)=>({items,page:{has_more:more,next_cursor:more?'synthetic-next':null}});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('filters receipts by the IST booking date and preserves applied bounds while paging an edited draft',async()=>{
 const request=vi.fn(async(path:string)=>Response.json(page([{id:id(4),booking_id:id(5),docket:'SYN-RECEIPT',confirmed_at:at}],!path.includes('cursor='))));vi.stubGlobal('fetch',request);
 render(<MemoryRouter><Receipts controller={controller()}/></MemoryRouter>);await screen.findByRole('table',{name:'Receipt bookings'});
 fireEvent.click(screen.getByRole('button',{name:'This week'}));expect(screen.getByLabelText('Booked from')).toHaveValue(weekMonday(businessDay()));
 fireEvent.click(screen.getByRole('button',{name:'Find receipts'}));await waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('from='));
 const original=new URL(request.mock.calls.at(-1)![0],'http://localhost').searchParams;
 expect(original.get('from')).toBe(dayStart(weekMonday(businessDay())));expect(original.get('to')).toBe(dayStart(shiftDay(businessDay(),1)));expect(original.get('franchise_id')).toBe(id(3));
 await screen.findByRole('button',{name:'More bookings'});fireEvent.change(screen.getByLabelText('Booked from'),{target:{value:'2020-01-01'}});fireEvent.click(screen.getByRole('button',{name:'More bookings'}));
 await waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('cursor=synthetic-next'));const next=new URL(request.mock.calls.at(-1)![0],'http://localhost').searchParams;expect(next.get('from')).toBe(original.get('from'));expect(next.get('to')).toBe(original.get('to'));
 await screen.findByRole('table',{name:'Receipt bookings'});fireEvent.click(screen.getByRole('button',{name:'All dates'}));await waitFor(()=>expect(new URL(request.mock.calls.at(-1)![0],'http://localhost').searchParams.has('from')).toBe(false));
});
it('rejects an inverted receipt date range without sending a new read',async()=>{
 const request=vi.fn(async()=>Response.json(page([])));vi.stubGlobal('fetch',request);render(<MemoryRouter><Receipts controller={controller()}/></MemoryRouter>);await screen.findByRole('heading',{name:'No receipts found'});
 fireEvent.change(screen.getByLabelText('Booked from'),{target:{value:'2026-11-03'}});fireEvent.change(screen.getByLabelText('Booked through'),{target:{value:'2026-11-02'}});const count=request.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'Find receipts'}));expect(screen.getByRole('alert')).toHaveTextContent('Choose an end date');expect(request).toHaveBeenCalledTimes(count);
});
it('shows queued provider work as waiting in the feed and uses scoped notification filters without send claims',async()=>{
 const row={id:id(8),row_kind:'message',effective_time:at,source_id:id(9),source_kind:'event',affected_id:id(10),correlation_id:id(11),notification_kind:'booking_confirmation',decision:null,message:{id:id(8),state:'queued',reason_code:'pending',version:1,attempt_count:0,progress:'none',failure_observed:false,observed_at:null},fanout:null,recovery:{kind:'none',expected_version:1,allowed_reasons:[]}};
 const request=vi.fn(async(_path:string)=>Response.json(page([row])));vi.stubGlobal('fetch',request);render(<MemoryRouter><Messaging controller={controller()} roles={['operator']}/></MemoryRouter>);
 expect(await screen.findByRole('list',{name:'Message history'})).toHaveTextContent('Waiting');expect(screen.getByRole('list',{name:'Message history'})).toHaveTextContent('0 recorded attempts');expect(screen.getByRole('list',{name:'Message history'})).not.toHaveTextContent('Sent');
 fireEvent.click(screen.getByRole('button',{name:'Bookings'}));await waitFor(()=>expect(request.mock.calls.length).toBe(2));
 const url=new URL(request.mock.calls[1]![0],'http://localhost');expect(url.searchParams.get('kind')).toBe('booking_confirmation');expect(url.searchParams.get('franchise_id')).toBe(id(3));
});
