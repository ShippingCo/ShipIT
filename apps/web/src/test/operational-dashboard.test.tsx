import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {ageingBuckets,ageingMeasures,dashboardSeriesDays,operationalParcelStatuses,type AgeingPage} from '@shippingco/shared';
import Dashboard from '../operations/Dashboard';
import {OperationalPackages as Packages} from '../operations/Packages';
import {createScopeController} from '../operator/scope';
import {operationalDashboardDto} from '../data-access/operational-dashboard';
import {lastClosedWeek} from '../data-access/assistant-metrics';
import {shiftDay} from '../operations/business-dates';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),franchise=id(2),now='2099-01-01T00:00:00.000Z',today='2099-01-01';
const page=(items:unknown[]=[])=>({items,page:{has_more:false,next_cursor:null}});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});

// The trailing series the tiles, the sparkline and the chart all read. Only the last day has
// anything in it, which is also the day the tile reports, so the two can be checked against
// each other: a series that disagrees with the figure beside it is rejected outright.
const first=shiftDay(today,-(dashboardSeriesDays-1));
const days=Array.from({length:dashboardSeriesDays},(_,index)=>({
  day:shiftDay(first,index),
  bookings:index===dashboardSeriesDays-1?3:index===dashboardSeriesDays-8?2:0,
  delivered:0,
}));
const summary={as_of:now,timezone:'Asia/Kolkata',day:today,booked_today:3,booked_yesterday:1,
  booked_same_weekday_last_week:2,delivered_today:0,
  stages:{...Object.fromEntries(operationalParcelStatuses.map(status=>[status,0])),booked:150},
  week:['2098-12-29','2098-12-30','2098-12-31','2099-01-01','2099-01-02','2099-01-03','2099-01-04']
    .map((day,i)=>({day,bookings:i===3?3:i===2?1:0})),
  days};

const report:AgeingPage={snapshot:{id:id(10),schema_version:1,definition:'to_pay_ageing_v1',timezone:'Asia/Kolkata',organization_id:org,franchise_id:franchise,filter:{anchor:'booking',status:'delivered',customer_id:null,balances:'outstanding'},as_of:now,expires_at:'2099-01-02T00:00:00.000Z',count:2,totals:Object.fromEntries(ageingMeasures.map(key=>[key,key==='outstanding'?'123456':'0'])) as AgeingPage['snapshot']['totals'],buckets:Object.fromEntries(ageingBuckets.map(key=>[key,key==='0_30'?'123456':'0'])) as AgeingPage['snapshot']['buckets'],customers:[],due_date_source:'unavailable',advance_source:'unavailable'},rows:[],next_offset:null};

function scope(){const c=createScopeController();c.runtime.bind({userId:id(3),organizationId:org,franchiseId:franchise,permissions:'operator'});return c;}
function Location(){return <output aria-label="Destination">{useLocation().pathname+useLocation().search}</output>;}

// Assistant outcomes for the week the component will actually ask for, including one cell the
// server has suppressed because fewer than five customers sit behind it.
const outcomes={definition_version:1,week:lastClosedWeek(),minimum_conversations:5,items:[
 {category:'success',suppressed:false,events:42,latency_ms:140},
 {category:'thanks',suppressed:false,events:7,latency_ms:null},
 {category:'handoff',suppressed:true,events:null,latency_ms:null},
 {category:'failure',suppressed:false,events:6,latency_ms:null},
 {category:'case_opened',suppressed:false,events:5,latency_ms:null},
]};
function fetcher(path:string){
 if(path.includes('/parcels/summary?'))return json(summary);
 if(path.includes('/assistant/metrics?'))return json(outcomes);
 if(path.includes('/support?'))return json({items:[],next:null});
 if(path.includes('/parcels?')||path.includes('/routes?'))return json(page());
 throw new Error('Unexpected dashboard request: '+path);
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('shows labels before figures, keeps every request inside the scope, and asks for no money data it may not read',async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 const request=vi.fn(async(path:string)=>{await gate;return fetcher(path);});vi.stubGlobal('fetch',request);
 render(<MemoryRouter><Dashboard controller={scope()} roles={['read_only']} workspaceName="Counter"/><Location/></MemoryRouter>);
 // R-31: the headings and the tile labels are static and render at once; only the figures wait.
 expect(screen.getByText('Booked today')).toBeVisible();
 expect(screen.getByText('Counting…')).toBeVisible();
 expect(document.querySelectorAll('.sk-value')).toHaveLength(2);
 await act(async()=>release());
 const booked=await screen.findByRole('link',{name:/Booked today/});
 expect(within(booked).getByText('3',{selector:'.value'})).toBeVisible();
 expect(request.mock.calls.every(([path])=>path.includes('organization_id='+org)&&path.includes('franchise_id='+franchise))).toBe(true);
 expect(request.mock.calls.some(([path])=>path.includes('/reports/'))).toBe(false);
 fireEvent.click(booked);
 expect(screen.getByLabelText('Destination')).toHaveTextContent('/business/packages?booked=today');
});

it('compares today against the same weekday last week, not yesterday',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>fetcher(path)));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['read_only']} workspaceName="Counter"/></MemoryRouter>);
 // 3 today against 2 on the same weekday last week. Yesterday's 1 is deliberately not used:
 // courier volume is weekly-cyclical, so a day-on-day comparison is noise.
 const tile=(await screen.findByRole('link',{name:/Booked today/}));
 expect(within(tile).getByText(/vs last Thursday/)).toBeVisible();
 expect(within(tile).getByText('50%')).toBeVisible();
 expect(within(tile).queryByText(/yesterday/)).not.toBeInTheDocument();
});

it('draws the journey in the order a parcel moves, with each count agreeing with the list it opens',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>fetcher(path)));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['read_only']} workspaceName="Counter"/></MemoryRouter>);
 const booked=await screen.findByRole('link',{name:'150 parcels booked'});
 expect(booked).toHaveAttribute('href','/business/packages?status=booked');
 const labels=[...document.querySelectorAll('.journey .j-label')].map(node=>node.textContent);
 expect(labels).toEqual(['Booked','At hub','Sent out','On the way','Out for delivery','Delivered','Returned']);
 expect(screen.getByText('150 parcels in the network')).toBeVisible();
});

it('moves only the chart when the range changes, and leaves the figures on today',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>fetcher(path)));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['read_only']} workspaceName="Counter"/></MemoryRouter>);
 const chart=await screen.findByRole('img',{name:/Parcels booked each day over 7 days/});
 expect(chart).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Month'}));
 expect(screen.getByRole('img',{name:/Parcels booked each day over 30 days/})).toBeVisible();
 // R-18: the tiles are always today and do not follow the range control.
 expect(within(screen.getByRole('link',{name:/Booked today/})).getByText('3',{selector:'.value'})).toBeVisible();
 // R-15 and R-17: the newest value is labelled on the chart face and the same numbers exist
 // as a table, so the picture is never the only copy of the data.
 expect(document.querySelector('.bar.is-now .bar-value')).toHaveTextContent('3');
 expect(screen.getByRole('table',{name:'Parcels booked each day'})).toBeInTheDocument();
});

it('says a figure is missing rather than zero, keeps the tile inert, and retries only what failed',async()=>{
 let failing=true;
 const request=vi.fn(async(path:string)=>failing&&path.includes('/parcels/summary?')
   ?json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503):fetcher(path));
 vi.stubGlobal('fetch',request);
 render(<MemoryRouter><Dashboard controller={scope()} roles={['read_only']} workspaceName="Counter"/></MemoryRouter>);
 // The one sentence that matters: an owner who reads a dash as "nothing came in today" acts
 // on a number that does not exist.
 expect(await screen.findByRole('alert')).toHaveTextContent('Today’s figures could not be loaded');
 expect(screen.getByText(/These numbers are missing, not zero\./)).toBeVisible();
 const tile=screen.getByText('Booked today').closest('.kpi')! as HTMLElement;
 expect(within(tile).getByText('—')).toBeVisible();
 expect(within(tile).getByText('not loaded')).toBeVisible();
 expect(tile.tagName).toBe('DIV');
 expect(screen.queryByText('0',{selector:'.value'})).not.toBeInTheDocument();
 failing=false;
 const before=request.mock.calls.length;
 fireEvent.click(screen.getByRole('button',{name:'Try again'}));
 await screen.findByRole('link',{name:'150 parcels booked'});
 // Only the surface that failed is re-requested; the page is never reloaded.
 expect(request.mock.calls.slice(before).every(([path])=>path.includes('/parcels/summary?'))).toBe(true);
 expect(localStorage.length).toBe(0);
});

it('does not request operational or money data for a delivery agent',async()=>{
 const request=vi.fn();vi.stubGlobal('fetch',request);
 render(<MemoryRouter><Dashboard controller={scope()} roles={['delivery_agent']} workspaceName="Counter"/></MemoryRouter>);
 await act(async()=>Promise.resolve());
 expect(request).not.toHaveBeenCalled();
 expect(screen.getByText(/Choose an available task/)).toBeVisible();
});

it('rejects unsafe counts, incomplete weeks, broken series and inconsistent business dates',()=>{
 expect(operationalDashboardDto(summary).booked_today).toBe(3);
 for(const changed of [
   {booked_today:4},{booked_today:Number.MAX_SAFE_INTEGER+1},{day:'2098-12-31'},
   {week:summary.week.slice(1)},{week:[...summary.week].reverse()},{delivered_today:1},
   // A series one day short, one that does not end today, one out of order, and one whose
   // last day contradicts the figure the tile beside it shows.
   {days:days.slice(1)},
   {days:days.map(day=>({...day,day:shiftDay(day.day,1)}))},
   {days:[...days].reverse()},
   {days:days.map((day,index)=>index===days.length-1?{...day,bookings:9}:day)},
 ])expect(()=>operationalDashboardDto({...summary,...changed})).toThrow();
});

it('applies dashboard stage links to the scoped package query',async()=>{
 const request=vi.fn(async(_path:string)=>json(page()));vi.stubGlobal('fetch',request);
 render(<MemoryRouter initialEntries={['/business/packages?status=held_at_office']}><Packages controller={scope()} roles={['read_only']}/></MemoryRouter>);
 await waitFor(()=>expect(request).toHaveBeenCalled());
 expect(request.mock.calls[0]![0]).toContain('status=held_at_office');
 expect(screen.getByLabelText('Parcel status')).toHaveValue('held_at_office');
});

it('uses the existing correction-aware accounting snapshot and retries an uncertain capture with the same intent',async()=>{
 const posts:RequestInit[]=[];let fail=true;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(path.includes('/reports/ageing')){posts.push(options);if(fail)throw new TypeError('Synthetic lost response');return json(report);}
  return fetcher(path);
 }));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['franchise_admin']} workspaceName="Counter"/></MemoryRouter>);
 await screen.findByRole('button',{name:'Retry payment balances'});
 const tile=()=>screen.getByText('Still to collect').closest('.kpi')! as HTMLElement;
 expect(within(tile()).getByText('—')).toBeVisible();
 fail=false;
 fireEvent.click(screen.getByRole('button',{name:'Retry payment balances'}));
 await waitFor(()=>expect(within(tile()).getByText('₹1,234.56')).toBeVisible());
 // The replay carries the original intent and idempotency key, so a lost response cannot
 // capture the report twice.
 expect(posts).toHaveLength(2);
 expect(posts[0]!.body).toBe(posts[1]!.body);
 expect(posts[0]!.headers).toEqual(posts[1]!.headers);
 expect(JSON.parse(String(posts[0]!.body))).toEqual(report.snapshot.filter);
 // R-4: a total an owner cannot act on is a total with no age beside it.
 expect(within(tile()).getByText(/none over a month old/)).toBeVisible();
});

it('discards a payment capture completed after the franchise scope changes',async()=>{
 let release!:(value:Response)=>void;const capture=new Promise<Response>(resolve=>{release=resolve;});const c=scope();
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(path.includes('/reports/ageing'))return capture;
  return fetcher(path);
 }));
 render(<MemoryRouter><Dashboard controller={c} roles={['franchise_admin']} workspaceName="Counter"/></MemoryRouter>);
 await screen.findByRole('link',{name:'150 parcels booked'});
 c.runtime.bind({userId:id(3),organizationId:org,franchiseId:id(4),permissions:'operator'});
 await act(async()=>release(json(report)));
 expect(screen.queryByText('₹1,234.56')).not.toBeInTheDocument();
});

it('states what the assistant did in work the owner did not do, and says when a group is too small to show',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>fetcher(path)));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['franchise_admin']} workspaceName="Counter"/></MemoryRouter>);
 const panel=(await screen.findByRole('region',{name:'What ShipIT did for you this week'}));
 expect(within(panel).getByText('questions answered without you')).toBeVisible();
 expect(within(panel).getByText('42')).toBeVisible();
 // R-21: no percentage without a count beside it. 42 finished of 42 + 6 failed + a suppressed
 // handoff, which contributes nothing it could reveal.
 expect(within(panel).getByText(/handled start to finish \(42 of 48\)/)).toBeVisible();
 expect(within(panel).getByText('88%')).toBeVisible();
 // R-22: the hours figure is explicitly approximate and its basis is off the face of the card.
 const hours=within(panel).getByText('≈ 2 hrs');
 expect(hours).toHaveAttribute('title',expect.stringContaining('two and a half minutes'));
 // A suppressed cell says it is suppressed. Zero would be a lie; a dash would read as a bug.
 expect(within(panel).getByText('under 5')).toBeVisible();
 expect(within(panel).getByText(/fewer than five customers/)).toBeVisible();
 // The tile above repeats the headline figure as work avoided, in the accent tint.
 const tile=screen.getByText('Answered by ShipIT').closest('.kpi')!;
 expect(tile).toHaveClass('kpi-accent');
 expect(within(tile as HTMLElement).getByText(/customers you did not have to call/)).toBeVisible();
});

it('says "Nothing" rather than zero when nothing needs a person, and renders no list at all',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>fetcher(path)));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['read_only']} workspaceName="Counter"/></MemoryRouter>);
 await screen.findByRole('link',{name:'150 parcels booked'});
 const tile=screen.getByText('Needs you').closest('.kpi')! as HTMLElement;
 expect(within(tile).getByText('Nothing')).toBeVisible();
 expect(within(tile).queryByText('0')).not.toBeInTheDocument();
 expect(within(tile).getByText('Nothing')).toHaveClass('muted');
 // R-28: no empty state and no reassurance. The absence is the message.
 expect(screen.queryByRole('region',{name:'Needs you'})).not.toBeInTheDocument();
 expect(screen.queryByText(/no items/i)).not.toBeInTheDocument();
});

it('names the decision each waiting row will ask for, ranked money first',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(path.includes('/reports/ageing'))return json(report);
  if(path.includes('/parcels/summary?'))return json({...summary,
    stages:{...summary.stages,failed_attempt:2,held_at_office:1}});
  void options;return fetcher(path);
 }));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['franchise_admin']} workspaceName="Counter"/></MemoryRouter>);
 const list=await screen.findByRole('region',{name:'Needs you'});
 const rows=[...list.querySelectorAll('.todo-row .t-body b')].map(node=>node.textContent);
 // R-25: money at risk, then the unhappy customer, then stuck parcels. At most three, and the
 // fourth is disclosed rather than dropped.
 expect(rows).toEqual(['₹1,234.56 is still to collect','2 parcels came back','1 parcel is held at the office']);
 expect(within(list).getByText(/Decide: try again or return to sender\./)).toBeVisible();
 // R-27: a full hairline and a wash, never an edge stripe.
 const row=list.querySelector('.todo-row.tone-danger')!;
 expect(getComputedStyle(row).borderStyle).not.toBe('none');
});

it('says what the value panel will show rather than printing six dashes at a shop with no conversations yet',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.includes('/assistant/metrics?')
   ?json({...outcomes,items:outcomes.items.map(item=>({...item,suppressed:false,events:0}))})
   :fetcher(path)));
 render(<MemoryRouter><Dashboard controller={scope()} roles={['franchise_admin']} workspaceName="Counter"/></MemoryRouter>);
 // An em dash on this screen means "we could not load this". Six of them, on the panel that
 // has to justify the subscription, would say the software is broken on the morning it is
 // most likely to be judged.
 const panel=await screen.findByRole('region',{name:'What ShipIT did for you this week'});
 expect(within(panel).getByText(/Once customers start messaging your shop/)).toBeVisible();
 expect(within(panel).queryByText('—')).not.toBeInTheDocument();
 expect(within(panel).getByRole('link',{name:'Open conversations'})).toHaveAttribute('href','/business/automation');
 // The tile above still reports its true zero, because nought answered is a fact.
 const tile=screen.getByText('Answered by ShipIT').closest('.kpi')! as HTMLElement;
 expect(within(tile).getByText('0')).toBeVisible();
});
