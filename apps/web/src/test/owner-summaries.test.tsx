import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import type {OwnerSummaryWorkspace,OwnerSummarySnapshot,OwnerSummarySchedule} from '@shippingco/shared';
import {OwnerSummaryView} from '../operations/OwnerSummaries';
import {ownerSummaries,ownerWorkspace} from '../data-access/owner-summaries';
import {scopedApi} from '../data-access/scoped-api';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';
const user=f.id(6),runId=f.id(149),workspace:OwnerSummaryWorkspace={enabled:true,can_configure:true,schedules:[],runs:[],alerts:[],recipients:[{id:user}],consent:{enabled:false,has_verified_number:true,version:0}};
const snapshot:OwnerSummarySnapshot={definition:'owner_period_v1',period:{frequency:'daily',timezone:'Asia/Kolkata',from:f.now,to:f.expiry,label:'Synthetic saved day'},as_of:f.now,expires_at:f.expiry,franchise_ids:[f.A],metrics:{bookings:1,billed_gross:'100000',tax_exclusive_revenue:'95000',average_bill:'100000',collections:'60000',refunds:'0',outstanding:'40000',customers:1,new_customers:1,returning_customers:0,methods:[{method:'cash',paise:'60000'}]},expenses_paise:'5000',overdue_paise:'40000',unknown_due_count:0,agent_held_known_paise:'1000',unknown_custody_count:1,cash_differences_paise:'500',reconciliation_exceptions:0,reconciliation_state:'disabled',evidence:[],sales_rows:[]};
function mount(path='/') {const c=createScopeController();c.runtime.bind({userId:user,organizationId:f.org,franchiseId:f.A,permissions:'franchise_admin'});const source=ownerSummaries(scopedApi(c));return {c,source,...render(<MemoryRouter initialEntries={[path]}><OwnerSummaryView source={source} canExport franchises={[{id:f.A,name:'Synthetic A'},{id:f.B,name:'Synthetic B'}]}/></MemoryRouter>)};}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('owner summaries workspace',()=>{
 it('validates recipient selection and saves explicit scope, weekly timing, alert policy and optional channel',async()=>{
  const posts:{body:Record<string,unknown>;options:RequestInit}[]=[];let savedSchedule:OwnerSummarySchedule|undefined;
  vi.stubGlobal('fetch',vi.fn(async(path:string,options?:RequestInit)=>{
   if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic'});
   if(options?.method==='POST'){const body=JSON.parse(String(options.body));posts.push({body,options});savedSchedule={...body,id:runId,actor_id:user,organization_id:f.org,franchise_id:f.A,version:Number(body.expected_version)+1,expected_version:Number(body.expected_version)+1,updated_at:f.now,last_state:'pending',last_reason:null,last_check:null};return f.json(savedSchedule);}
   return f.json({...workspace,schedules:savedSchedule?[savedSchedule]:[]});
  }));
  mount();await screen.findByText('Create schedule');
  fireEvent.click(screen.getByLabelText('You'));fireEvent.submit(screen.getByRole('button',{name:'Save owner schedule'}).closest('form')!);await screen.findByRole('alert');expect(posts).toHaveLength(0);
  fireEvent.click(screen.getByLabelText('You'));fireEvent.click(screen.getByLabelText('Synthetic B'));fireEvent.change(screen.getByLabelText('Summary frequency'),{target:{value:'weekly'}});fireEvent.change(screen.getByLabelText('Weekly send day'),{target:{value:'3'}});fireEvent.change(screen.getByLabelText('Send after local time'),{target:{value:'19:30'}});fireEvent.click(screen.getByLabelText('Enable this schedule'));fireEvent.click(screen.getByLabelText('Also notify on WhatsApp'));
  fireEvent.submit(screen.getByRole('button',{name:'Save owner schedule'}).closest('form')!);await screen.findByText('Saved.');expect(posts).toHaveLength(1);expect(posts[0]!.body).toMatchObject({franchise_ids:[f.A,f.B],recipient_ids:[user],enabled:true,whatsapp:true,timing:{frequency:'weekly',timezone:'Asia/Kolkata',weekday:3,minute:1170},alerts:{enabled:false,notify:false,repeat_hours:null}});
  fireEvent.click(await screen.findByRole('button',{name:'Edit Owner summary'}));fireEvent.change(screen.getByLabelText('Schedule name'),{target:{value:'Updated owner summary'}});fireEvent.submit(screen.getByRole('button',{name:'Save owner schedule'}).closest('form')!);await waitFor(()=>expect(posts).toHaveLength(2));expect(posts[1]!.body.expected_version).toBe(1);for(const key of ['id','actor_id','organization_id','franchise_id','last_state'])expect(posts[1]!.body).not.toHaveProperty(key);
 });
 it('preserves the exact uncertain command and form until an explicit retry confirms it',async()=>{
  const posted:RequestInit[]=[];
  vi.stubGlobal('fetch',vi.fn(async(path:string,options?:RequestInit)=>{
   if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic'});
   if(options?.method==='POST'){posted.push(options);if(posted.length===1)throw new TypeError('synthetic lost acknowledgement');return f.json({...JSON.parse(String(options.body)),id:runId,actor_id:user,organization_id:f.org,franchise_id:f.A,version:1,updated_at:f.now,last_state:'pending',last_reason:null,last_check:null});}
   return f.json(workspace);
  }));
  mount();await screen.findByText('Create schedule');fireEvent.change(screen.getByLabelText('Schedule name'),{target:{value:'Keep this draft'}});fireEvent.submit(screen.getByRole('button',{name:'Save owner schedule'}).closest('form')!);
  const retry=await screen.findByRole('button',{name:'Retry the same owner request'});expect(screen.getByLabelText('Schedule name')).toHaveValue('Keep this draft');expect(screen.getByRole('button',{name:'Save owner schedule'})).toBeDisabled();fireEvent.click(retry);await screen.findByText('The original request is confirmed.');expect(posted).toHaveLength(2);expect(posted[0]!.body).toBe(posted[1]!.body);expect(posted[0]!.headers).toEqual(posted[1]!.headers);
 });
 it('loads the exact saved report, displays source states and limits response data to public fields',async()=>{
  const fetcher=vi.fn(async(path:string)=>path.includes('/runs/')?f.json({run_id:runId,snapshot:{...snapshot,raw_statement:'PRIVATE'}}):f.json({...workspace,raw_statement:'PRIVATE'}));vi.stubGlobal('fetch',fetcher);
  mount('/?owner_report='+runId);await screen.findByText('Saved period report');expect(screen.getByText('₹1,000.00')).toBeInTheDocument();expect(screen.getByText(/sources have unknown custody/)).toBeInTheDocument();expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Download saved owner evidence'})).toBeEnabled();expect(fetcher.mock.calls.some(([path])=>path.includes('/runs/'+runId))).toBe(true);
  expect(ownerWorkspace({...workspace,raw_statement:'PRIVATE'})).not.toHaveProperty('raw_statement');
  fireEvent.change(screen.getByLabelText('Saved source evidence'),{target:{value:'expense'}});expect(screen.getByRole('button',{name:'Next sources'})).toBeDisabled();
 });
 it('shows permission failures and supports loading retry without a local-data fallback',async()=>{
  let failed=true;vi.stubGlobal('fetch',vi.fn(async()=>failed?f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503):f.json({...workspace,can_configure:false,enabled:false,consent:{...workspace.consent,has_verified_number:false}})));
  mount();await screen.findByRole('button',{name:'Retry owner reports'});failed=false;fireEvent.click(screen.getByRole('button',{name:'Retry owner reports'}));await screen.findByText('No owner schedules yet.');expect(screen.queryByRole('button',{name:'Save owner schedule'})).not.toBeInTheDocument();expect(screen.getByLabelText('Allow owner report notifications on WhatsApp')).toBeDisabled();await waitFor(()=>expect(screen.queryByText('Loading owner reports…')).not.toBeInTheDocument());
 });
});
