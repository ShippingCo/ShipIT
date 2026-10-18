import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {DailyMetrics,DailyPage} from '@shippingco/shared';
import DailyDashboard from '../operations/DailyDashboard';
import {createScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {dailyDashboard,dailyPage} from '../data-access/daily-dashboard';
import * as f from './counter-fixture';
const metrics:DailyMetrics={bookings:1,billed_gross:'100000',tax_exclusive_revenue:'95000',average_bill:'100000',collections:'60000',refunds:'0',outstanding:'40000',customers:1,new_customers:1,returning_customers:0,methods:[{method:'cash',paise:'60000'}]};
const saved:DailyPage={snapshot:{id:f.id(148),schema_version:1,definition:'owner_daily_v1',timezone:'Asia/Kolkata',organization_id:f.org,franchise_id:f.A,filter:{day:null,mode:'same_elapsed',franchise_ids:[f.A]},as_of:f.now,expires_at:f.expiry,count:1,windows:[{period:'today',from:f.now,to:f.now},{period:'yesterday',from:'2098-12-31T00:00:00.000Z',to:'2098-12-31T01:00:00.000Z'}],today:metrics,yesterday:{...metrics,bookings:0,average_bill:null},comparison:[{metric:'bookings',delta:'1',percent:null}]},rows:[{id:f.bookingId,franchise_id:f.A,period:'today',kind:'booking',occurred_at:f.now,customer_id:f.customerId,method:null,eligible:true,in_period:true,new_customer:true,billed_gross:'100000',tax_exclusive_revenue:'95000',collections:'0',refunds:'0',outstanding:'40000'}],next_offset:null};
const controller=()=>{const c=createScopeController();c.runtime.bind({userId:f.id(6),organizationId:f.org,franchiseId:f.A,permissions:'franchise_admin'});return c;};
const scopes={organization_id:f.org,active_franchise_id:f.A,items:[{id:f.A,name:'Synthetic A',can_export:true},{id:f.B,name:'Synthetic B',can_export:true}],next_cursor:null,maximum_selection:50};
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('owner daily dashboard',()=>{
 it('captures selected scope, uses server money, drills through exact saved metrics and reloads from URL',async()=>{
  const fetcher=vi.fn(async(path:string,options?:RequestInit)=>options?.method==='POST'&&JSON.parse(options.body as string).day==='9998-01-01'?f.json({error:{code:'VALIDATION_FAILED',details:[{field:'$',code:'OUT_OF_RANGE'}]}},422):path==='/auth/bootstrap'?f.json({csrf_token:'synthetic'}):path.includes('/reports/scopes')?f.json(scopes):f.json(saved));vi.stubGlobal('fetch',fetcher);
  const c=controller();const view=render(<MemoryRouter><DailyDashboard controller={c} canExport/></MemoryRouter>);
  await screen.findByLabelText('Synthetic B');fireEvent.click(screen.getByLabelText('Synthetic B'));fireEvent.change(screen.getByLabelText('Yesterday comparison'),{target:{value:'complete_day'}});fireEvent.submit(screen.getByRole('button',{name:'Load daily dashboard'}).closest('form')!);
  await screen.findByRole('button',{name:'View Billed gross source rows'});expect(screen.getByRole('button',{name:'View Billed gross source rows'})).toHaveTextContent('₹1,000.00');
  const post=fetcher.mock.calls.find(([,o])=>o?.method==='POST')!;expect(JSON.parse(post[1]!.body as string)).toMatchObject({mode:'complete_day',franchise_ids:[f.A,f.B]});
  await waitFor(()=>expect(screen.getByRole('button',{name:'View Billed gross source rows'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'View Billed gross source rows'}));
  await waitFor(()=>expect(fetcher.mock.calls.some(([p])=>p.includes('period=today&metric=billed_gross'))).toBe(true));await waitFor(()=>expect(screen.getByRole('heading',{name:'Source evidence · today · Billed gross'})).toHaveFocus());
  expect(fetcher.mock.calls.some(([p])=>p.includes('/reports/daily/')&&!p.includes('metric='))).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'View cash collection source rows'}));await waitFor(()=>expect(fetcher.mock.calls.some(([p])=>p.includes('metric=collections&method=cash'))).toBe(true));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Load daily dashboard'})).toBeEnabled());fireEvent.change(screen.getByLabelText('Business day (blank means today)'),{target:{value:'9998-01-01'}});fireEvent.click(screen.getByRole('button',{name:'Load daily dashboard'}));await screen.findByText('Choose a real date on or before today in Asia/Kolkata.');expect(screen.getByDisplayValue('9998-01-01')).toHaveAttribute('aria-invalid','true');expect(screen.queryByRole('button',{name:'View Billed gross source rows'})).toBeNull();
  view.unmount();render(<MemoryRouter initialEntries={['/?daily_snapshot='+saved.snapshot.id]}><DailyDashboard controller={c} canExport={false}/></MemoryRouter>);await screen.findByRole('button',{name:'View Collections received source rows'});expect(screen.queryByRole('button',{name:'Download matching CSV'})).toBeNull();
 });
 it('preserves exact uncertain request and rejects late responses after a scope change',async()=>{
  let attempts=0;const fetcher=vi.fn(async(path:string,options?:RequestInit)=>{if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic'});if(path.includes('/reports/scopes'))return f.json(scopes);if(options?.method==='POST'&&++attempts===1)throw new TypeError('Synthetic lost response');return f.json(saved);});vi.stubGlobal('fetch',fetcher);
  const c=controller();render(<MemoryRouter><DailyDashboard controller={c} canExport/></MemoryRouter>);await screen.findByLabelText('Synthetic A');fireEvent.click(screen.getByRole('button',{name:'Load daily dashboard'}));await screen.findByRole('button',{name:'Retry same dashboard request'});expect(screen.getByLabelText('Yesterday comparison')).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Retry same dashboard request'}));await screen.findByRole('button',{name:'View Billed gross source rows'});const posts=fetcher.mock.calls.filter(([,o])=>o?.method==='POST');expect(posts).toHaveLength(2);expect(posts[0]![1]!.body).toBe(posts[1]![1]!.body);expect(posts[0]![1]!.headers).toEqual(posts[1]![1]!.headers);
  const source=dailyDashboard(scopedApi(c));let release!:(v:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>{release=r;})));const late=source.page(saved.snapshot.id);act(()=>c.clear('signed_out'));release(f.json(saved));await expect(late).rejects.toMatchObject({code:'TEMPORARILY_UNAVAILABLE',kind:'aborted'});expect(localStorage.length).toBe(0);
 });
 it('rejects malformed and foreign success payloads and renders a safe empty snapshot',async()=>{
  expect(()=>dailyPage({...saved,snapshot:{...saved.snapshot,today:{...metrics,billed_gross:100000}}})).toThrow();
  vi.stubGlobal('fetch',vi.fn(async()=>f.json({...saved,snapshot:{...saved.snapshot,franchise_id:f.B}})));await expect(dailyDashboard(scopedApi(controller())).page(saved.snapshot.id)).rejects.toMatchObject({kind:'protocol'});
  const empty={...saved,snapshot:{...saved.snapshot,today:{...metrics,bookings:0,average_bill:null}},rows:[]};vi.stubGlobal('fetch',vi.fn(async(path:string)=>path==='/auth/bootstrap'?f.json({csrf_token:'synthetic'}):path.includes('/reports/scopes')?f.json(scopes):f.json(empty)));
  render(<MemoryRouter><DailyDashboard controller={controller()} canExport/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'Load daily dashboard'}));await screen.findByText('No eligible bookings in the selected day.');expect(screen.getByRole('button',{name:'View Average bill source rows'})).toHaveTextContent('Unavailable');expect(screen.getByText('No matching source rows.')).toBeVisible();
 });
});
