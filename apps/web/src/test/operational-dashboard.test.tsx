import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {ageingBuckets,ageingMeasures,operationalParcelStatuses,type AgeingPage} from '@shippingco/shared';
import Dashboard from '../operations/Dashboard';
import {OperationalPackages as Packages} from '../operations/Packages';
import {createScopeController} from '../operator/scope';
import {operationalDashboardDto} from '../data-access/operational-dashboard';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),franchise=id(2),now='2099-01-01T00:00:00.000Z';
const page=(items:unknown[]=[])=>({items,page:{has_more:false,next_cursor:null}});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const summary={as_of:now,timezone:'Asia/Kolkata',day:'2099-01-01',booked_today:3,booked_yesterday:1,delivered_today:0,stages:{...Object.fromEntries(operationalParcelStatuses.map(status=>[status,0])),booked:150},week:['2098-12-29','2098-12-30','2098-12-31','2099-01-01','2099-01-02','2099-01-03','2099-01-04'].map((day,i)=>({day,bookings:i===3?3:i===2?1:0}))};
const report:AgeingPage={snapshot:{id:id(10),schema_version:1,definition:'to_pay_ageing_v1',timezone:'Asia/Kolkata',organization_id:org,franchise_id:franchise,filter:{anchor:'booking',status:'delivered',customer_id:null,balances:'outstanding'},as_of:now,expires_at:'2099-01-02T00:00:00.000Z',count:2,totals:Object.fromEntries(ageingMeasures.map(key=>[key,key==='outstanding'?'123456':'0'])) as AgeingPage['snapshot']['totals'],buckets:Object.fromEntries(ageingBuckets.map(key=>[key,key==='0_30'?'123456':'0'])) as AgeingPage['snapshot']['buckets'],customers:[],due_date_source:'unavailable',advance_source:'unavailable'},rows:[],next_offset:null};
function scope(){const c=createScopeController();c.runtime.bind({userId:id(3),organizationId:org,franchiseId:franchise,permissions:'operator'});return c;}
function Location(){return <output aria-label="Destination">{useLocation().pathname+useLocation().search}</output>;}
function fetcher(path:string){if(path.includes('/parcels/summary?'))return json(summary);if(path.includes('/parcels?')||path.includes('/routes?'))return json(page());throw new Error('Unexpected dashboard request');}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('uses complete scoped counts, distinct booking totals and Monday week dates without guessing payment balances',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const request=vi.fn(async(path:string)=>{await gate;return fetcher(path);});vi.stubGlobal('fetch',request);
 render(<MemoryRouter><Dashboard controller={scope()} roles={['read_only']} workspaceName="Counter"/><Location/></MemoryRouter>);
 expect(screen.getByText('Loading dashboard…')).toBeVisible();expect(screen.queryByRole('button',{name:/Booked today/})).not.toBeInTheDocument();await act(async()=>release());
 expect(await screen.findByRole('link',{name:'150 parcels Booked'})).toHaveAttribute('href','/business/packages?status=booked');
 const booked=screen.getByRole('button',{name:/Booked today/});expect(within(booked).getByText('3')).toBeVisible();expect(within(screen.getByRole('button',{name:/Money to collect/})).getByText('—')).toBeVisible();
 const chart=screen.getByRole('img',{name:/Bookings by day, Monday to Sunday/});
 expect(chart).toHaveAccessibleName(/Monday, 29 Dec: 0/);
 expect(chart).toHaveAccessibleName(/Thursday, 1 Jan: 3/);
 expect(chart).toHaveAccessibleName(/Friday, 2 Jan: upcoming/);
 expect(within(chart).getByText('Today')).toBeVisible();
 expect(request.mock.calls.every(([path])=>path.includes('organization_id='+org)&&path.includes('franchise_id='+franchise))).toBe(true);
 expect(request.mock.calls.some(([path])=>path.includes('/reports/'))).toBe(false);expect(screen.queryByText('Every parcel is paid')).not.toBeInTheDocument();
 fireEvent.keyDown(booked,{key:'Enter'});expect(screen.getByLabelText('Destination')).toHaveTextContent('/business/packages?booked=today');
});
it('shows failed summaries as unavailable and retries without substituting mockup data',async()=>{
 let failing=true;vi.stubGlobal('fetch',vi.fn(async(path:string)=>failing?json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503):fetcher(path)));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['read_only']} workspaceName="Counter"/></MemoryRouter>);
 expect(await screen.findByRole('alert')).toHaveTextContent('The dashboard could not be loaded.');expect(screen.queryByText('Parcels moving')).not.toBeInTheDocument();failing=false;fireEvent.click(screen.getByRole('button',{name:/Retry/}));await screen.findByRole('link',{name:'150 parcels Booked'});expect(localStorage.length).toBe(0);
});
it('does not request operational or money data for a delivery agent',async()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request);render(<MemoryRouter><Dashboard controller={scope()} roles={['delivery_agent']} workspaceName="Counter"/></MemoryRouter>);await act(async()=>Promise.resolve());expect(request).not.toHaveBeenCalled();expect(screen.getByText(/Choose an available task/)).toBeVisible();
});
it('rejects unsafe counts, incomplete weeks and inconsistent business dates',()=>{
 expect(operationalDashboardDto(summary).booked_today).toBe(3);
 for(const changed of [{booked_today:4},{booked_today:Number.MAX_SAFE_INTEGER+1},{day:'2098-12-31'},{week:summary.week.slice(1)},{week:[...summary.week].reverse()},{delivered_today:1}])expect(()=>operationalDashboardDto({...summary,...changed})).toThrow();
});
it('applies dashboard stage links to the scoped package query',async()=>{
 const request=vi.fn(async(_path:string)=>json(page()));vi.stubGlobal('fetch',request);render(<MemoryRouter initialEntries={['/business/packages?status=held_at_office']}><Packages controller={scope()} roles={['read_only']}/></MemoryRouter>);
 await waitFor(()=>expect(request).toHaveBeenCalled());expect(request.mock.calls[0]![0]).toContain('status=held_at_office');expect(screen.getByLabelText('Parcel status')).toHaveValue('held_at_office');
});
it('uses the existing correction-aware accounting snapshot and retries an uncertain capture with the same intent',async()=>{
 const posts:RequestInit[]=[];let fail=true;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(path.includes('/reports/ageing')){posts.push(options);if(fail)throw new TypeError('Synthetic lost response');return json(report);}
  if(path.includes('/whatsapp/history/'))return json(page());if(path.includes('/support?'))return json({items:[],next:null});
  return fetcher(path);
 }));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['franchise_admin']} workspaceName="Counter"/></MemoryRouter>);
 await screen.findByRole('button',{name:'Retry payment balances'});expect(within(screen.getByRole('button',{name:/Money to collect/})).getByText('—')).toBeVisible();fail=false;fireEvent.click(screen.getByRole('button',{name:'Retry payment balances'}));
 await waitFor(()=>expect(within(screen.getByRole('button',{name:/Money to collect/})).getByText('₹1,234.56')).toBeVisible());expect(posts).toHaveLength(2);expect(posts[0]!.body).toBe(posts[1]!.body);expect(posts[0]!.headers).toEqual(posts[1]!.headers);expect(JSON.parse(String(posts[0]!.body))).toEqual(report.snapshot.filter);
 expect(screen.getByRole('link',{name:'Review payments'})).toHaveAttribute('href','/business/reports?ageing_snapshot='+report.snapshot.id);
});
it('discards a payment capture completed after the franchise scope changes',async()=>{
 let release!:(value:Response)=>void;const capture=new Promise<Response>(resolve=>{release=resolve;});const c=scope();
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/reports/ageing'))return capture;if(path.includes('/whatsapp/history/'))return json(page());if(path.includes('/support?'))return json({items:[],next:null});return fetcher(path);}));
 render(<MemoryRouter><Dashboard controller={c} roles={['franchise_admin']} workspaceName="Counter"/></MemoryRouter>);await screen.findByRole('link',{name:'150 parcels Booked'});
 c.runtime.bind({userId:id(3),organizationId:org,franchiseId:id(4),permissions:'operator'});await act(async()=>release(json(report)));expect(screen.queryByText('₹1,234.56')).not.toBeInTheDocument();
});
it('counts provider acceptance from durable progress and never calls a queued message sent',async()=>{
 const history=(n:number,progress:'none'|'sent')=>({id:id(20+n),row_kind:'message',effective_time:now,source_id:id(30+n),source_kind:'domain_event',affected_id:id(40+n),correlation_id:id(50+n),notification_kind:'updates',decision:null,fanout:null,recovery:{kind:'none',expected_version:null,allowed_reasons:[]},message:{id:id(60+n),state:progress==='none'?'queued':'accepted',reason_code:progress==='none'?'awaiting_dispatch':'provider_accepted',version:1,attempt_count:progress==='none'?0:1,progress,failure_observed:false,observed_at:progress==='none'?null:now}});
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.includes('/whatsapp/history/'))return json(page([history(1,'none'),history(2,'sent')]));if(path.includes('/support?'))return json({items:[],next:null});return fetcher(path);}));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['operator']} workspaceName="Counter"/></MemoryRouter>);
 const label=await screen.findByText('Updates accepted');expect(within(label.closest('.bot-cell')! as HTMLElement).getByText('1')).toBeVisible();expect(screen.getByText(/Accepted means the provider accepted/)).toBeVisible();expect(screen.queryByText(/2 sent/i)).not.toBeInTheDocument();
});
