import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {OperatorSearch} from '../operations/OperatorSearch';
import {createScopeController} from '../operator/scope';
import {consoleTasks} from '../components/workspace/console-navigation';
import * as f from './counter-fixture';

afterEach(()=>vi.unstubAllGlobals());
function setup(areas=['workspace','packages','booking']) {
 const controller=createScopeController();controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'operator'});
 const links=[...consoleTasks,{area:'customers',to:'/business/customers',label:'Customers',icon:'group'}];
 const close=vi.fn();const view=render(<MemoryRouter><OperatorSearch controller={controller} links={links.filter(task=>areas.includes(task.area))} close={close}/></MemoryRouter>);
 return {controller,close,...view};
}
const parcel={id:f.id(14),booking_id:f.bookingId,version:1,status:'booked',custody:'awaiting_intake',docket:'SYN-33',weight_grams:999,confirmed_at:f.now,sender:{source_customer_id:f.customerId,source_customer_version:1,name:f.customer.name,phone:f.customer.phone,phone_display:f.customer.phone_display,address:f.customer.address},recipient:{name:'Synthetic Receiver',phone_normalized:'+12025550101',phone_display:'+1 202-555-0101',address:'Synthetic Road'}};
const page={has_more:false,next_cursor:null};

it('searches only permitted tasks without fetching or confirming a booking',()=>{
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);setup(['workspace']);
 expect(screen.queryByRole('link',{name:'New Booking'})).not.toBeInTheDocument();
 expect(screen.queryByRole('option',{name:'Full tracking number'})).not.toBeInTheDocument();
 expect(screen.queryByRole('option',{name:'Customer name'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByRole('searchbox',{name:'Find a task'}),{target:{value:'Dashboard'}});
 fireEvent.submit(screen.getByRole('form',{name:'Search workspace'}));
 expect(screen.getByRole('link',{name:'Dashboard'})).toHaveAttribute('href','/business');expect(fetcher).not.toHaveBeenCalled();
});

it('looks up a full tracking number in the active franchise and opens the real parcel',async()=>{
 const fetcher=vi.fn(async(_path:string)=>f.json({items:[parcel],page}));vi.stubGlobal('fetch',fetcher);setup();
 fireEvent.change(screen.getByRole('combobox',{name:'Search for'}),{target:{value:'tracking'}});
 fireEvent.change(screen.getByRole('searchbox',{name:'Full tracking number'}),{target:{value:'SYN-33'}});
 expect(fetcher).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByRole('link',{name:/SYN-33/})).toHaveAttribute('href','/business/packages?parcel='+parcel.id);
 const url=new URL(String(fetcher.mock.calls[0]![0]),'https://example.test');
 expect(url.searchParams.get('organization_id')).toBe(f.org);expect(url.searchParams.get('franchise_id')).toBe(f.A);expect(url.searchParams.get('docket')).toBe('SYN-33');
});

it('discards late private results after the active franchise changes',async()=>{
 const pending=f.deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>pending.promise));const {controller}=setup();
 fireEvent.change(screen.getByRole('combobox',{name:'Search for'}),{target:{value:'tracking'}});
 fireEvent.change(screen.getByRole('searchbox',{name:'Full tracking number'}),{target:{value:'SYN-33'}});
 fireEvent.click(screen.getByRole('button',{name:'Search'}));
 controller.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.B,permissions:'operator'});
 await act(async()=>pending.resolve(f.json({items:[parcel],page})));
 expect(screen.queryByRole('link',{name:/Synthetic Sender/})).not.toBeInTheDocument();
});

it('cancels the old search immediately when the query changes',async()=>{
 const pending=f.deferred<Response>();vi.stubGlobal('fetch',vi.fn(()=>pending.promise));setup();
 fireEvent.change(screen.getByRole('combobox',{name:'Search for'}),{target:{value:'tracking'}});
 const query=screen.getByRole('searchbox',{name:'Full tracking number'});
 fireEvent.change(query,{target:{value:'SYN-33'}});fireEvent.click(screen.getByRole('button',{name:'Search'}));
 fireEvent.change(query,{target:{value:'SYN-34'}});
 await act(async()=>pending.resolve(f.json({items:[parcel],page})));
 expect(screen.queryByRole('link',{name:/SYN-33/})).not.toBeInTheDocument();expect(query).toHaveValue('SYN-34');
});

it('validates customer input and searches scoped contacts using the existing API',async()=>{
 const fetcher=vi.fn(async(_path:string)=>f.json({items:[f.customer],page}));vi.stubGlobal('fetch',fetcher);setup(['workspace','packages','customers']);
 fireEvent.change(screen.getByRole('combobox',{name:'Search for'}),{target:{value:'name'}});
 fireEvent.change(screen.getByRole('searchbox',{name:'Customer name'}),{target:{value:'ab'}});
 fireEvent.submit(screen.getByRole('form',{name:'Search workspace'}));expect(fetcher).not.toHaveBeenCalled();expect(screen.getByRole('searchbox',{name:'Customer name'})).toHaveFocus();
 fireEvent.change(screen.getByRole('searchbox',{name:'Customer name'}),{target:{value:'Synthetic'}});
 fireEvent.submit(screen.getByRole('form',{name:'Search workspace'}));
 expect(await screen.findByRole('link',{name:/Synthetic Sender/})).toHaveAttribute('href','/business/packages?customer_id='+f.customerId);
 const url=new URL(fetcher.mock.calls[0]![0],'https://example.test');expect(url.pathname).toBe(`/api/v1/organizations/${f.org}/franchises/${f.A}/customers`);expect(url.searchParams.get('q')).toBe('Synthetic');
});

it('reports a failed API lookup without displaying sample records or success',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503)));setup();
 fireEvent.change(screen.getByRole('combobox',{name:'Search for'}),{target:{value:'tracking'}});
 fireEvent.change(screen.getByRole('searchbox',{name:'Full tracking number'}),{target:{value:'SYN-33'}});
 fireEvent.click(screen.getByRole('button',{name:'Search'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Search could not be completed');
 expect(screen.queryByRole('link',{name:/SYN-33/})).not.toBeInTheDocument();
});
