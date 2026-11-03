import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
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
 render(<MemoryRouter><Customers canBook controller={controller} canReadAccounts={false}/></MemoryRouter>);fireEvent.keyDown(screen.getByRole('combobox',{name:'Search by'}),{key:'ArrowDown'});fireEvent.click(await screen.findByRole('option',{name:'Phone number'}));
 expect(screen.getByRole('combobox',{name:'Phone number country code'})).toHaveValue('91');fireEvent.change(screen.getByRole('textbox',{name:'Phone number'}),{target:{value:'abc'}});fireEvent.submit(screen.getByRole('form',{name:'Find a customer'}));expect(screen.getByRole('textbox',{name:'Phone number'})).toHaveAttribute('aria-invalid','true');expect(screen.getByRole('textbox',{name:'Phone number'})).toHaveFocus();expect(fetcher).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('textbox',{name:'Phone number'}),{target:{value:'9876543210'}});fireEvent.submit(screen.getByRole('form',{name:'Find a customer'}));await screen.findByRole('heading',{name:'No customers match'});
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
 await screen.findByRole('heading',{name:'Find your customer'});expect(fetcher).not.toHaveBeenCalled();expect(screen.getByRole('searchbox',{name:'Customer name'})).toHaveAttribute('maxlength','120');expect(screen.getByText(/same capital letters as the saved name/)).toBeVisible();fireEvent.change(screen.getByRole('searchbox',{name:'Customer name'}),{target:{value:'A'.repeat(121)}});fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(screen.getByText('Use no more than 120 characters for the name.')).toBeVisible();expect(fetcher).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('searchbox',{name:'Customer name'}),{target:{value:'ab'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));expect(fetcher).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('searchbox',{name:'Customer name'}),{target:{value:'Synthetic'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));fireEvent.click(await screen.findByRole('button',{name:'View '+f.customer.name}));
 expect(screen.getByRole('link',{name:'New booking for '+f.customer.name})).toHaveAttribute('href','/business/new-booking?customer_id='+f.customer.id);expect(screen.queryByRole('link',{name:'Customer accounts'})).not.toBeInTheDocument();
 expect(screen.getByRole('dialog',{name:f.customer.name})).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Clear search'}));});expect(screen.queryByRole('dialog',{name:f.customer.name})).not.toBeInTheDocument();
});
