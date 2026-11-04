import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {OperationalPackages as Packages} from '../operations/Packages';
import Lots from '../operations/Lots';
import Routes from '../operations/Routes';
import {createScopeController} from '../operator/scope';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const controller=()=>{const value=createScopeController();value.runtime.bind({userId:id(1),organizationId:id(2),franchiseId:id(3),permissions:'operator'});return value;};
const empty=()=>new Response(JSON.stringify({items:[],page:{has_more:false,next_cursor:null}}),{status:200,headers:{'Content-Type':'application/json'}});
function Location(){return <output aria-label="Current query">{useLocation().search}</output>}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('keeps customer context on the server query and clears both customer and booked-today route filters',async()=>{
 const fetcher=vi.fn(async(_path:string)=>empty());vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter initialEntries={['/business/packages?customer_id='+id(4)+'&booked=today']}><Packages controller={controller()} roles={['operator']}/><Location/></MemoryRouter>);
 await screen.findByRole('heading',{name:'No parcels match'});
 const request=new URL(String(fetcher.mock.calls[0][0]),'https://example.test');
 expect(request.searchParams.get('customer_id')).toBe(id(4));expect(request.searchParams.get('franchise_id')).toBe(id(3));expect(request.searchParams.has('from')).toBe(true);
 expect(screen.getByText(/Selected customer/)).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Clear filters'}));
 await waitFor(()=>expect(screen.getByLabelText('Current query')).toHaveTextContent(''));
 await waitFor(()=>expect(fetcher.mock.calls.some(call=>{const q=new URL(String(call[0]),'https://example.test').searchParams;return !q.has('customer_id')&&!q.has('from');})).toBe(true));
 expect(screen.getByRole('link',{name:'Create a booking'})).toHaveAttribute('href','/business/new-booking');
});

it('keeps drafted filters separate from applied filters and rejects a reversed date range before a read',async()=>{
 const fetcher=vi.fn(async(_path:string)=>empty());vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter><Packages controller={controller()} roles={['read_only']}/></MemoryRouter>);
 await screen.findByRole('heading',{name:'No parcels yet'});const initial=fetcher.mock.calls.length;
 const disclosure=screen.getByText('Filters').closest('details')!;expect(disclosure).not.toHaveAttribute('open');fireEvent.click(screen.getByText('Filters'));
 fireEvent.change(screen.getByLabelText('Booked from (Asia/Kolkata)'),{target:{value:'2026-11-03'}});fireEvent.change(screen.getByLabelText('Booked through (Asia/Kolkata)'),{target:{value:'2026-11-01'}});
 expect(fetcher).toHaveBeenCalledTimes(initial);fireEvent.submit(screen.getByRole('form',{name:'Package filters'}));expect(screen.getByRole('alert')).toHaveTextContent('end date on or after');expect(fetcher).toHaveBeenCalledTimes(initial);expect(disclosure).toHaveAttribute('open');expect(screen.getByLabelText('Booked through (Asia/Kolkata)')).toHaveFocus();expect(screen.getByLabelText('Booked through (Asia/Kolkata)')).toHaveAttribute('aria-invalid','true');
 fireEvent.change(screen.getByLabelText('Booked through (Asia/Kolkata)'),{target:{value:'2026-11-04'}});fireEvent.submit(screen.getByRole('form',{name:'Package filters'}));
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(initial+1));expect(screen.queryByRole('alert')).not.toBeInTheDocument();expect(screen.getByText(/From 2026-11-03/)).toBeVisible();
 expect(screen.queryByRole('link',{name:'New booking'})).not.toBeInTheDocument();
});

it('offers first-use lot and route actions only to roles that can create them',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>empty()));
 const view=render(<MemoryRouter><Lots controller={controller()} roles={['read_only']}/></MemoryRouter>);
 await screen.findByRole('heading',{name:'No active lots'});expect(screen.queryByRole('button',{name:'Create a lot'})).not.toBeInTheDocument();expect(screen.getByText(/Your dispatch team can create/)).toBeVisible();
 view.unmount();const write=render(<MemoryRouter><Lots controller={controller()} roles={['operator']}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Create a lot'}));expect(screen.getByLabelText('Lot name')).toHaveFocus();write.unmount();
 render(<MemoryRouter><Routes controller={controller()} roles={['operator']}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Create a route'}));expect(screen.getByLabelText('Origin')).toHaveFocus();
});

it('recovers an empty filtered route list using the server all-states query',async()=>{
 const fetcher=vi.fn(async(_path:string)=>empty());vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter><Routes controller={controller()} roles={['read_only']}/></MemoryRouter>);
 await screen.findByRole('heading',{name:'No routes yet'});expect(screen.queryByRole('button',{name:'Create a route'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Route state'),{target:{value:'archived'}});
 fireEvent.click(await screen.findByRole('button',{name:'Show all routes'}));
 await screen.findByRole('heading',{name:'No routes yet'});expect(screen.getByLabelText('Route state')).toHaveValue('all');
 expect(new URL(fetcher.mock.calls.at(-1)![0],'https://example.test').searchParams.has('state')).toBe(false);
});
