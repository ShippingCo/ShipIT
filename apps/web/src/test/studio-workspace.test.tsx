import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {ReportPage} from '@shippingco/shared';
import {weeklyDays,weeklySeries} from '../operations/WeeklyBusiness';
import Customers from '../operations/Customers';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';
const originalScroll=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
afterEach(()=>{vi.unstubAllGlobals();if(originalScroll)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScroll);else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');});
it('searches customers with an explicit country code and focuses invalid phone input before any request',async()=>{
 Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:vi.fn()});
 const controller=createScopeController();controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'operator'});
 const fetcher=vi.fn(async(_path:string)=>f.json({items:[],page:{has_more:false,next_cursor:null}}));vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter><Customers canBook controller={controller} canReadAccounts={false}/></MemoryRouter>);
 // One field. Typing digits is what makes it a phone search - there is no selector to set
 // first - but the country code is still explicit, shown beside the field and never assumed
 // after the fact.
 const field=()=>screen.getByRole('searchbox',{name:'Phone number or name'});
 expect(screen.queryByRole('combobox',{name:'Phone number country code'})).not.toBeInTheDocument();
 fireEvent.change(field(),{target:{value:'98765'}});
 expect(screen.getByRole('combobox',{name:'Phone number country code'})).toHaveValue('91');
 fireEvent.submit(screen.getByRole('form',{name:'Find a customer'}));
 expect(field()).toHaveAttribute('aria-invalid','true');expect(field()).toHaveFocus();expect(fetcher).not.toHaveBeenCalled();
 fireEvent.change(field(),{target:{value:'9876543210'}});fireEvent.submit(screen.getByRole('form',{name:'Find a customer'}));
 await screen.findByText(/No one saved matches/);
 expect(new URL(fetcher.mock.calls[0]![0],'https://example.test').searchParams.get('q')).toBe('+91 9876543210');expect(new URL(fetcher.mock.calls[0]![0],'https://example.test').searchParams.get('search_by')).toBe('phone');
});
it('builds complete weekly evidence at IST boundaries and rejects partial, duplicate and mismatched totals',()=>{
 expect(weeklyDays('2026-11-01')).toEqual(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
 const snapshot={filter:{from_day:'2026-10-26',to_day:'2026-11-01'},count:2,totals:{billed_gross:{state:'known',paise:'900719925474099300'}}} as ReportPage['snapshot'];
 const rows=[{id:f.id(1),confirmed_at:'2026-10-25T18:30:00Z',billed_gross:'900719925474099299'},{id:f.id(2),confirmed_at:'2026-11-01T18:29:59Z',billed_gross:'1'}] as ReportPage['rows'];
 const result=weeklySeries(snapshot,rows);expect(result[0]).toMatchObject({bookings:1,billed:900719925474099299n});expect(result[6]).toMatchObject({bookings:1,billed:1n});
 expect(()=>weeklySeries(snapshot,rows.slice(0,1))).toThrow('Incomplete');expect(()=>weeklySeries(snapshot,[rows[0]!,rows[0]!])).toThrow('Incomplete');expect(()=>weeklySeries(snapshot,[rows[0]!,{...rows[1]!,billed_gross:'2'}])).toThrow('totals');expect(()=>weeklySeries(snapshot,[rows[0]!,{...rows[1]!,confirmed_at:'2026-11-01T18:30:00Z'}])).toThrow('outside');
});
it('searches real scoped customers only after valid input and links the selected record into booking',async()=>{
 const controller=createScopeController();controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'operator'});
 const fetcher=vi.fn(async()=>f.json({items:[f.customer],page:{has_more:false,next_cursor:null}}));vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter><Customers canBook controller={controller} canReadAccounts={false}/></MemoryRouter>);
 const field=()=>screen.getByRole('searchbox',{name:'Phone number or name'});
 await screen.findByRole('heading',{name:'Find your customer'});expect(fetcher).not.toHaveBeenCalled();expect(field()).toHaveAttribute('maxlength','120');expect(screen.getByText(/Capital letters do not matter/)).toBeVisible();
 fireEvent.change(field(),{target:{value:'A'.repeat(121)}});fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(screen.getByText('Use no more than 120 characters.')).toBeVisible();expect(fetcher).not.toHaveBeenCalled();
 // P-5: under three characters there is no request, and no instruction either.
 fireEvent.change(field(),{target:{value:'ab'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(fetcher).not.toHaveBeenCalled();
 fireEvent.change(field(),{target:{value:'Synthetic'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 // The row is the control: its accessible name is the customer's name alone.
 fireEvent.click(await screen.findByRole('button',{name:f.customer.name}));
 expect(screen.getByRole('link',{name:'Book a parcel'})).toHaveAttribute('href','/business/new-booking?customer_id='+f.customer.id);expect(screen.queryByRole('link',{name:'Open customer accounts'})).not.toBeInTheDocument();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'All customers'}));});
 expect(screen.getByRole('button',{name:f.customer.name})).toBeVisible();
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Clear search'}));});expect(screen.queryByRole('button',{name:f.customer.name})).not.toBeInTheDocument();
});
