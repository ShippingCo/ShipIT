import React from 'react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {createScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {messaging,historyDto,historyDetail} from '../data-access/messaging';
import Messaging from '../operations/Messaging';
import BusinessShell from '../pages/business/BusinessShell';
import {id,org,A,B,json,now,context,deferred} from './counter-fixture';
import type {OperatorContext,OperatorRole} from '@shippingco/shared';
const message={id:id(80),row_kind:'message',effective_time:now,source_id:id(81),source_kind:'event',affected_id:id(82),correlation_id:id(83),notification_kind:'booking_confirmation',decision:{id:id(84),policy_id:'booking-confirmation',policy_version:1,outcome:'queued',reason_code:'eligible'},message:{id:id(80),state:'accepted',reason_code:'provider_accepted',version:3,attempt_count:1,progress:'none',failure_observed:false,observed_at:null},fanout:null,recovery:{kind:'none',expected_version:3,allowed_reasons:[]}};
const detail={...message,attempts:[{attempt:1,outcome:'accepted',reason_code:'provider_accepted',recorded_at:now}],history_truncated:false,fanout_items:[],reminder:{eligible:false}};
const page=(items:unknown[])=>({items,page:{has_more:false,next_cursor:null}});
function controller(roles:OperatorRole[]=['operator']){const c=createScopeController();c.runtime.bind({userId:id(6),organizationId:org,franchiseId:A,permissions:JSON.stringify(roles)});return c;}
function mount(roles:OperatorRole[]=['operator']){return render(<MemoryRouter><Messaging controller={controller(roles)} roles={roles}/></MemoryRouter>);}
afterEach(()=>{vi.unstubAllGlobals();localStorage.clear();sessionStorage.clear();});
function serve(row:unknown=message,read:unknown=detail){vi.stubGlobal('fetch',vi.fn(async(path:string)=>path==='/auth/bootstrap'?json({csrf_token:'synthetic'}):path.includes('/'+id(80)+'?')?json(read):json(page([row]))));}
describe('production messaging history',()=>{
 it('shows loading, truthful acceptance and immutable automation independently, then read after refresh',async()=>{
  const gate=deferred<Response>();let first=true;let row=message;
  vi.stubGlobal('fetch',vi.fn(async()=>{if(first){first=false;return gate.promise;}return json(page([row]));}));mount();expect(screen.getByRole('status')).toHaveTextContent('Loading messaging history');
  await act(async()=>gate.resolve(json(page([row]))));expect(await screen.findByText('Accepted by provider',{selector:'span'})).toBeVisible();expect(screen.queryByText('Delivered',{selector:'span'})).not.toBeInTheDocument();
  row={...row,message:{...row.message,state:'read',progress:'read'}};fireEvent.click(screen.getByText('Refresh history'));expect(await screen.findByText('Read',{selector:'span'})).toBeVisible();
  fireEvent.change(screen.getByLabelText('History view'),{target:{value:'automation'}});expect(await screen.findByText('Automation: Waiting')).toBeVisible();expect(screen.getByText('Message: Read')).toBeVisible();
 });
 it.each(['suppressed','failed','uncertain'])('labels %s separately',async state=>{serve({...message,message:{...message.message,state}});mount();expect(await screen.findByText(state[0].toUpperCase()+state.slice(1),{selector:'span'})).toBeVisible();});
 it('shows empty/error/explicit retry without demo fallback',async()=>{
  let failing=true;vi.stubGlobal('fetch',vi.fn(async()=>failing?json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503):json(page([]))));mount();expect(await screen.findByRole('alert')).toHaveTextContent('Messaging history could not be loaded');
  failing=false;fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText('No matching history');expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
 });
 it('offers keyboard native filters and resets old cursors on filter changes',async()=>{
  serve();mount();await screen.findByText('Accepted by provider',{selector:'span'});const select=screen.getByLabelText('Message status');select.focus();expect(select).toHaveFocus();fireEvent.change(select,{target:{value:'uncertain'}});
  await waitFor(()=>expect(vi.mocked(fetch).mock.calls.at(-1)![0]).toContain('status=uncertain'));expect(String(vi.mocked(fetch).mock.calls.at(-1)![0])).not.toContain('cursor=');
 });
 it('always redacts delivery verification content and strips unknown response fields before UI state',async()=>{
  const unsafe={...detail,notification_kind:'delivery_otp',body:'synthetic-secret',phone:'555-private',variables:['123456'],message:{...detail.message,provider_message_id:'raw-provider'}};
  expect(JSON.stringify(historyDetail(unsafe))).not.toMatch(/synthetic-secret|555-private|123456|raw-provider/);
  serve({...message,notification_kind:'delivery_otp'},unsafe);mount();await screen.findByText('Delivery verification message');fireEvent.click(screen.getByRole('button',{name:'Inspect Delivery verification message'}));await screen.findByRole('heading',{name:'Delivery verification message'});
  expect(document.body.textContent).not.toMatch(/123456|synthetic-secret|Clear history|Clear automation|Reveal/);
 });
 it('traps dialog focus, closes on Escape and restores trigger focus',async()=>{
  serve();mount();const trigger=await screen.findByRole('button',{name:'Inspect Booking confirmation'});trigger.focus();fireEvent.click(trigger);
  const dialog=await screen.findByRole('dialog');await waitFor(()=>expect(dialog.contains(document.activeElement)).toBe(true));const close=within(dialog).getByText('Close');close.focus();fireEvent.keyDown(close,{key:'Tab'});expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(trigger).toHaveFocus();
 });
 it('operator cannot redrive even an erroneously offered recovery',async()=>{
  serve(message,{...detail,recovery:{kind:'redrive',expected_version:3,allowed_reasons:['dependency_repaired']}});mount();fireEvent.click(await screen.findByRole('button',{name:'Inspect Booking confirmation'}));await screen.findByText('Provider attempts');expect(screen.queryByRole('button',{name:'Redrive original message'})).not.toBeInTheDocument();
 });
 it('refreshes version, requires uncertain warning, then preserves the exact W44 request after transport uncertainty',async()=>{
  let reads=0;const writes:RequestInit[]=[];
  vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
   if(path==='/auth/bootstrap')return json({csrf_token:'synthetic'});
   if(options.method==='POST'){writes.push(options);if(writes.length===1)throw new TypeError('network');return json({id:id(80),version:6,state:'queued'});}
   if(path.includes('/'+id(80)+'?')){reads++;return json({...detail,message:{...detail.message,state:'uncertain',version:reads===1?3:5},recovery:{kind:'investigate_uncertain',expected_version:reads===1?3:5,allowed_reasons:['retry_uncertain_confirmed']}});}
   return json(page([message]));
  }));mount(['franchise_admin']);fireEvent.click(await screen.findByRole('button',{name:'Inspect Booking confirmation'}));fireEvent.click(await screen.findByRole('button',{name:'Redrive original message'}));
  await screen.findByText(/Retrying may deliver a duplicate/);expect(writes.length).toBe(0);fireEvent.click(screen.getByText('I investigated — retry despite duplicate risk'));
  fireEvent.click(await screen.findByText('Retry same request'));await waitFor(()=>expect(writes.length).toBe(2));expect(writes[1].body).toBe(writes[0].body);expect(writes[1].headers).toEqual(writes[0].headers);expect(JSON.parse(String(writes[0].body))).toEqual({expected_version:5,reason_code:'retry_uncertain_confirmed'});
  await waitFor(()=>expect(screen.getByText('Server update confirmed.')).toBeVisible());
  await screen.findByText('Accepted by provider',{selector:'span'});
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  await waitFor(()=>expect(screen.getByRole('button',{name:'Inspect Booking confirmation'})).toHaveFocus());

 });
 it('uses W19 for eligible route reminders, without redriving or modifying ETA',async()=>{
  const fanout={...detail,id:id(90),row_kind:'fanout',notification_kind:'route_delay',decision:null,message:null,recovery:{kind:'none',expected_version:null,allowed_reasons:[]},fanout:{id:id(90),route_id:id(91),original_event_id:id(92),state:'completed',total_count:1,completed_count:1,skipped_count:0,failed_count:0},reminder:{eligible:true}};
  const writes:{path:string;options:RequestInit}[]=[];vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
   if(path==='/auth/bootstrap')return json({csrf_token:'synthetic'});if(options.method==='POST'){writes.push({path,options});return json({id:id(93),event_type:'route.delay_reminder.requested',route_id:id(91),original_event_id:id(92),fanout_id:id(94),created_at:now});}
   return json(path.includes('/'+id(90)+'?')?fanout:page([fanout]));
  }));mount();fireEvent.change(screen.getByLabelText('History view'),{target:{value:'automation'}});fireEvent.click(await screen.findByRole('button',{name:'Inspect Route delay'}));fireEvent.click(await screen.findByText('Send route reminder'));
  await waitFor(()=>expect(writes.length).toBe(1));expect(writes[0].path).toContain(`/routes/${id(91)}/delay-reminders?`);expect(JSON.parse(String(writes[0].options.body))).toEqual({original_delay_event_id:id(92)});expect(screen.queryByText('Redrive original message')).not.toBeInTheDocument();
 });
 it('aborts old scope responses, rejects stale paint and purges on 401',async()=>{
  const c=controller(),source=messaging(scopedApi(c)),gate=deferred<Response>();let signal:AbortSignal|undefined;
  vi.stubGlobal('fetch',vi.fn(async(_path:string,options:RequestInit={})=>{signal=options.signal as AbortSignal;return gate.promise;}));const pending=source.list('messages');c.runtime.bind({userId:id(6),organizationId:org,franchiseId:B,permissions:'operator'});expect(signal?.aborted).toBe(true);gate.resolve(json(page([message])));await expect(pending).rejects.toThrow();
  vi.stubGlobal('fetch',vi.fn(async()=>json({error:{code:'UNAUTHENTICATED'}},401)));await expect(messaging(scopedApi(c)).list('messages')).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(c.snapshot().status).toBe('signed_out');expect(c.runtime.ticket().authority).toBeNull();
 });
 it.each(['accountant','read_only','delivery_agent'] as const)('denies %s navigation and direct route',role=>{
  const ctx={...context,franchises:context.franchises.map(f=>({...f,roles:[role]}))} as OperatorContext;render(<MemoryRouter initialEntries={['/business/automation']}><BusinessShell controller={controller([role])} context={ctx} select={()=>{}}/></MemoryRouter>);
  expect(screen.queryByRole('link',{name:'Automation & Messages'})).not.toBeInTheDocument();expect(screen.getByRole('alert')).toHaveTextContent('unavailable for this role');
 });
 it.each(['org_admin','franchise_admin','operator','dispatcher'] as const)('allows %s navigation',async role=>{
  serve();const ctx={...context,franchises:context.franchises.map(f=>({...f,roles:[role]}))} as OperatorContext;
  render(<MemoryRouter initialEntries={['/business/automation']}><BusinessShell controller={controller([role])} context={ctx} select={()=>{}}/></MemoryRouter>);expect(screen.getAllByRole('link',{name:'Automation & Messages'})).toHaveLength(2);await screen.findByText('Accepted by provider',{selector:'span'});
 });
 it('rejects malformed successful status DTOs',()=>{expect(()=>historyDto({...message,message:{...message.message,state:'sent_and_delivered'}})).toThrow();});
});
