import React from 'react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { act,fireEvent,render,screen,waitFor,within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { parcels } from '../data-access/parcels';
import { lots } from '../data-access/lots';
import { routes } from '../data-access/routes';
import { eway } from '../data-access/eway';
import { deliveries } from '../data-access/deliveries';
import Packages from '../operations/Packages';
import Lots from '../operations/Lots';
import Routes from '../operations/Routes';
import Eway from '../operations/Eway';
import Deliveries from '../operations/Deliveries';
import { instantToKolkataInput,kolkataInputToInstant } from '../operations/format';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const org=id(1),franchise=id(2),user=id(3),parcelId=id(4),bookingId=id(5),lotId=id(6),membershipId=id(7),routeId=id(8),manifestId=id(9),targetLotId=id(10),now='2099-01-01T00:00:00.000Z';
const page=(items:unknown[])=>({items,page:{has_more:false,next_cursor:null}});
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const controller=()=>{const value=createScopeController();value.runtime.bind({userId:user,organizationId:org,franchiseId:franchise,permissions:'operator'});return value;};
const parcel={id:parcelId,booking_id:bookingId,version:1,status:'booked',custody:'awaiting_intake',docket:'SYN-34',weight_grams:800,confirmed_at:now,sender:{source_customer_id:id(10),source_customer_version:1,name:'Synthetic Sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Synthetic address'},recipient:{name:'Synthetic Recipient',phone_normalized:'+12025550101',phone_display:'+1 202-555-0101',address:'Synthetic destination'}};
const lot={id:lotId,code:'LOT-SYN-34',name:'Synthetic East',destination_key:'SYN-EAST',state:'active',version:1,created_at:now,updated_at:now,archived_at:null,active_member_count:1};
const route={id:routeId,origin:'Synthetic Origin',destination:'Synthetic Destination',mode:'road',carrier_code:null,scheduled_departure_at:now,state:'finalized',version:4,current_manifest_id:manifestId,created_at:now,updated_at:now};
const state={reference_state:'recorded',official_validity_state:'unknown',estimate_state:'estimated',verification_state:'unverified_external',verified_at:null,applicability_state:'unknown',value_check_state:'unknown',reminder_reasons:['official_validity_unknown'],evaluated_at:now,policy:{state:'approved',id:id(20),version:1,effective_from:now,source_ref:'SYN-POLICY',approval_ref:'SYN-APPROVAL'}};

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('requires complete e-way evidence pairs and never drops partially entered evidence when another section is valid',async()=>{
 const fetcher=vi.fn(async(path:string)=>{if(path.includes('/parcels?'))return json(page([parcel]));if(path.includes('/eway/reminders'))return json(page([]));if(path.includes('/eway/history'))return json(page([]));if(path.includes('/eway'))return json({booking_id:bookingId,record:null,state});throw new Error(`Unexpected ${path}`);});vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter><Eway controller={controller()} roles={['operator']}/></MemoryRouter>);
 fireEvent.change(screen.getByLabelText('Tracking number'),{target:{value:'SYN-34'}});fireEvent.click(screen.getByRole('button',{name:'Find parcel'}));fireEvent.click(await screen.findByRole('button',{name:/Use this parcel/}));
 const create=await screen.findByRole('button',{name:'Create record'}),form=create.closest('form')!;
 fireEvent.click(screen.getByText('Declared goods value',{selector:'summary'}));fireEvent.click(screen.getByText('E-way document',{selector:'summary'}));fireEvent.click(screen.getByText('Vehicle and distance',{selector:'summary'}));expect(screen.getByRole('group',{name:'Declared value (optional)'})).toBeVisible();expect(screen.getByRole('group',{name:'External document (optional)'})).toBeVisible();
 fireEvent.change(screen.getByLabelText('Vehicle number (optional)'),{target:{value:'MH01AB1234'}});expect(create).toBeEnabled();
 fireEvent.change(screen.getByLabelText('Declared value (₹)'),{target:{value:'100.50'}});expect(screen.getByLabelText('Declaration source reference')).toBeRequired();expect(create).toBeDisabled();
 const before=fetcher.mock.calls.length;fireEvent.submit(form);expect(fetcher.mock.calls.length).toBe(before);
 fireEvent.change(screen.getByLabelText('Declaration source reference'),{target:{value:'Invoice 123'}});expect(create).toBeEnabled();
 fireEvent.change(screen.getByLabelText('Source reference (optional)'),{target:{value:'Portal copy'}});expect(screen.getByLabelText('External issuer')).toBeRequired();expect(screen.getByLabelText('External reference')).toBeRequired();expect(create).toBeDisabled();
 fireEvent.change(screen.getByLabelText('External issuer'),{target:{value:'Portal'}});fireEvent.change(screen.getByLabelText('External reference'),{target:{value:'AB-123'}});expect(create).toBeEnabled();
 fireEvent.change(screen.getByLabelText('Distance km (optional)'),{target:{value:'1.5'}});expect(create).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Distance km (optional)'),{target:{value:'25'}});expect(create).toBeEnabled();expect(form.checkValidity()).toBe(true);
});

describe('production operational adapters',()=>{
 it('projects only safe delivery state and builds immutable proof commands without browser persistence',async()=>{
  const delivery={parcel_id:parcelId,docket:'SYN-34',parcel_version:5,attempt_id:id(70),assignment_id:id(71),attempt_number:1,challenge_ref:id(72),challenge_version:1,status:'active',expires_at:now,resend_available_at:now,resends_remaining:3,verification_attempts_remaining:5,send_state:'accepted',send_reason:'provider_accepted',proof_method:null,exception:null,verifier:'private-verifier',encrypted_secret:'private-ciphertext'};
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json(delivery)));const source=deliveries(scopedApi(controller())),value=await source.read(parcelId);expect(JSON.stringify(value)).not.toContain('private-');
  const intent=source.intent({kind:'complete',parcelId,body:{expected_version:5,challenge_ref:id(72),challenge_version:1,proof:'123456'}});expect(intent).toMatchObject({operation:'api.v1.deliveries.complete',expectedVersion:5});expect(Object.isFrozen(intent)).toBe(true);expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
 });
 it('projects parcel data, rejects malformed success and binds exact scoped command identity',async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(json(page([{...parcel,private_secret:'discard'}]))).mockResolvedValueOnce(json(page([{...parcel,status:'invented'}])));vi.stubGlobal('fetch',fetcher);const scope=controller(),source=parcels(scopedApi(scope));
  const value=await source.list({docket:'SYN-34',status:'booked'});expect(value.items[0]).toEqual(parcel);expect(JSON.stringify(value)).not.toContain('private_secret');expect(String(fetcher.mock.calls[0][0])).toContain(`organization_id=${org}&franchise_id=${franchise}&docket=SYN-34&status=booked`);
  await expect(source.list()).rejects.toMatchObject({kind:'protocol'});const intent=source.intent({kind:'check_in',parcelId,body:{expected_version:1,evidence_ref:id(11),location_ref:id(12)}});expect(intent).toMatchObject({operation:'api.v1.parcels.check_in',expectedVersion:1});expect(intent.path).toContain(`/api/v1/parcels/${parcelId}/check-in`);
 });
 it('builds versioned lot/route/e-way intents and accepts the restricted accountant e-way projection',async()=>{
  const restricted={booking_id:bookingId,record:{record_id:id(30),booking_id:bookingId,version:2,declaration:{value_paise:5000,source_ref:'SYN-DECL'},external:{issuer:'synthetic_portal',reference:'AB-7',source_ref:null,issued_at:null,official_valid_until:null,validity_evidence_ref:null,provenance:'external_observation',verification_state:'unverified_external',verified_at:null},estimate:null,captured_at:now},state};vi.stubGlobal('fetch',vi.fn().mockResolvedValue(json({...restricted,private_vehicle:'discard'})));const api=scopedApi(controller()),lotSource=lots(api),routeSource=routes(api),ewaySource=eway(api);
  expect(lotSource.intent({kind:'remove',lotId,parcelId,body:{expected_version:3,membership_id:membershipId}})).toMatchObject({operation:'api.v1.lots.membership.remove',expectedVersion:3});
  const eventBase={expected_version:4,manifest_id:manifestId,manifest_version:2,effective_at:now,evidence_ref:id(31)};
  const eventIntents=[
   routeSource.intent({kind:'event',routeId,body:{kind:'departure',...eventBase,base_eta_at:now}}),
   routeSource.intent({kind:'event',routeId,body:{kind:'delay',...eventBase,total_delay_minutes:45}}),
   routeSource.intent({kind:'event',routeId,body:{kind:'arrival',...eventBase}}),
  ];
  expect(eventIntents.map(intent=>intent.operation)).toEqual(['api.v1.routes.departure','api.v1.routes.delay','api.v1.routes.arrival']);
  expect(eventIntents.every(intent=>intent.expectedVersion===4&&intent.path.includes(`/routes/${routeId}/events`)&&Object.isFrozen(intent))).toBe(true);
  expect(ewaySource.intent({kind:'estimate',bookingId,body:{expected_version:2,reason_ref:'SYN-REASON',starts_at:now}})).toMatchObject({operation:'api.v1.eway.estimate',expectedVersion:2});
  const value=await ewaySource.read(bookingId);expect(value.record?.external?.reference).toBe('AB-7');expect(value.record?.vehicle_number).toBeUndefined();expect(JSON.stringify(value)).not.toContain('private_vehicle');
 });
 it('executes only the three exact canonical route-event identities and rejects a generic or mismatched operation',async()=>{
  const api=scopedApi(controller()),source=routes(api),body={kind:'departure' as const,expected_version:4,manifest_id:manifestId,manifest_version:2,effective_at:now,evidence_ref:id(31),base_eta_at:now};
  const result={event_id:id(32),route_id:routeId,version:5,manifest_id:manifestId,manifest_version:2,kind:'departure',effective_at:now,updated_count:1,skipped_count:0,eta:{state:'available',base_at:now,revised_at:now,total_delay_minutes:0}};
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>path==='/auth/bootstrap'?json({csrf_token:'synthetic-csrf'}):json(result)));
  const intent=source.intent({kind:'event',routeId,body});await expect(source.execute(intent)).resolves.toMatchObject({kind:'departure'});
  const generic=Object.freeze({...intent,operation:'api.v1.routes.event'});expect(()=>source.execute(generic)).toThrow();
  const mismatched=Object.freeze({...intent,operation:'api.v1.routes.delay',key:id(33)});await expect(source.execute(mismatched)).rejects.toMatchObject({kind:'protocol'});
 });
});

describe('production operational screens',()=>{
 it('shows assigned-only delivery work, submits recipient proof, clears it, and reloads canonical state',async()=>{
  const queue={items:[{parcel_id:parcelId,docket:'SYN-34',attempt_id:id(70),attempt_number:1,expires_at:now,failed_verifications:0,resend_count:0}],scope_revision:'revision'};
  const active={parcel_id:parcelId,docket:'SYN-34',parcel_version:5,attempt_id:id(70),assignment_id:id(71),attempt_number:1,challenge_ref:id(72),challenge_version:1,status:'active',expires_at:now,resend_available_at:'2020-01-01T00:00:00.000Z',resends_remaining:3,verification_attempts_remaining:5,send_state:'accepted',send_reason:'provider_accepted',proof_method:null,exception:null};
  const consumed={...active,parcel_version:6,status:'consumed',proof_method:'otp_verified',resends_remaining:3};let delivered=false,writes=0,reads=0;
  vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes(`/deliveries/${parcelId}/complete`)&&options.method==='POST'){writes++;expect(JSON.parse(String(options.body))).toMatchObject({proof:'123456',challenge_ref:id(72)});delivered=true;return json(consumed);}if(path.includes(`/deliveries/${parcelId}?`)){reads++;return json(delivered?consumed:active);}if(path.includes('/deliveries?'))return json(delivered?{items:[],scope_revision:'revision-2'}:queue);throw new Error(`Unexpected ${path}`);}));
  render(<MemoryRouter><Deliveries controller={controller()} roles={['delivery_agent']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));const input=await screen.findByLabelText('6-digit recipient code');expect(screen.getByRole('heading',{name:'SYN-34'})).toHaveFocus();expect(screen.queryByText(/private|verifier|ciphertext/i)).not.toBeInTheDocument();fireEvent.change(input,{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Verify and complete delivery'}));await waitFor(()=>expect(writes).toBe(1));await waitFor(()=>expect(reads).toBeGreaterThanOrEqual(2));expect(input).toHaveValue('');expect(localStorage.length).toBe(0);expect(sessionStorage.length).toBe(0);
 });
 it('round-trips Asia/Kolkata route inputs independently of the browser timezone and across a date boundary',()=>{
  expect(instantToKolkataInput('2026-09-20T12:00:00.000Z')).toBe('2026-09-20T17:30');
  expect(kolkataInputToInstant('2026-09-20T17:30:00.000')).toBe('2026-09-20T12:00:00.000Z');
  expect(instantToKolkataInput('2026-09-20T20:30:00.000Z')).toBe('2026-09-21T02:00');
  expect(kolkataInputToInstant('2026-09-21T02:00:00.000')).toBe('2026-09-20T20:30:00.000Z');
  expect(instantToKolkataInput('2026-09-20T12:00:05.123Z')).toBe('2026-09-20T17:30:05.123');
  expect(kolkataInputToInstant('2026-09-20T17:30:05.123')).toBe('2026-09-20T12:00:05.123Z');
 });
 it('uses guarded package actions and directs new money recording to receipt evidence without OTP or delivery bypasses',async()=>{
  let paymentReads=0;const fetcher=vi.fn(async(path:string,options:RequestInit={})=>{
   if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/parcels?'))return json(page([parcel]));if(path.includes(`/parcels/${parcelId}/timeline`))return json({items:[]});if(path.includes(`/parcels/${parcelId}/lot-membership`))return json(null);if(path.includes(`/parcels/${parcelId}?`))return json(parcel);
   if(path.includes(`/bookings/${bookingId}/payments`)&&(!options.method||options.method==='GET')){paymentReads++;return json({booking_id:bookingId,obligation_id:id(40),currency:'INR',gross_paise:10000,collected_paise:0,outstanding_paise:10000,state:'uncollected',version:1});}throw new Error('Unexpected legacy financial mutation');
  });vi.stubGlobal('fetch',fetcher);render(<MemoryRouter><Packages controller={controller()} roles={['operator','franchise_admin']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));await screen.findByText('To-Pay ledger');await screen.findByText('uncollected');expect(paymentReads).toBe(1);
  expect(screen.getByRole('button',{name:'check in'})).toBeVisible();expect(screen.queryByText(/OTP/i)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/delivered/i})).not.toBeInTheDocument();expect(screen.getByRole('link',{name:'Open money receipts'})).toHaveAttribute('href','/business/money-receipts');expect(screen.queryByRole('button',{name:'Confirm money received'})).not.toBeInTheDocument();expect(fetcher.mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);
 });
 it('removes the exact lot membership with the keyboard-reachable action and confirms ungrouped from the server',async()=>{
  let removed=false;const member={id:membershipId,lot_id:lotId,parcel_id:parcelId,started_at:now,ended_at:null,end_reason:null};vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/lots?'))return json(page([{...lot,active_member_count:removed?0:1,version:removed?2:1}]));if(path.includes(`/lots/${lotId}/memberships`))return json(page(removed?[]:[member]));if(path.includes(`/lots/${lotId}?`))return json({...lot,active_member_count:removed?0:1,version:removed?2:1});if(path.includes(`/lots/${lotId}/parcels/${parcelId}/remove`)&&options.method==='POST'){removed=true;return json({lots:[{...lot,version:2,active_member_count:0}],membership:null});}if(path.includes(`/parcels/${parcelId}/lot-membership`))return json(null);throw new Error(`Unexpected ${path}`);}));render(<MemoryRouter><Lots controller={controller()} roles={['franchise_admin']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));const remove=await screen.findByRole('button',{name:'Remove'});remove.focus();expect(remove).toHaveFocus();fireEvent.click(remove);expect(await screen.findByText(/is now ungrouped/)).toHaveTextContent(parcelId);
 });
 it('loads an authoritative active target lot and sends its server version in the move command',async()=>{
  const member={id:membershipId,lot_id:lotId,parcel_id:parcelId,started_at:now,ended_at:null,end_reason:null},target={...lot,id:targetLotId,code:'LOT-TARGET',name:'Synthetic Target',version:7};let moveBody:Record<string,unknown>|null=null;
  vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/lots?'))return json(page(path.includes('destination_key=')?[target]:[lot]));if(path.includes(`/lots/${lotId}/memberships`))return json(page([member]));if(path.includes(`/lots/${targetLotId}?`))return json(target);if(path.includes(`/lots/${lotId}/parcels/${parcelId}/move`)&&options.method==='POST'){moveBody=JSON.parse(String(options.body));return json({lots:[{...lot,version:2,active_member_count:0},{...target,version:8,active_member_count:2}],membership:{...member,lot_id:targetLotId}});}if(path.includes(`/lots/${lotId}?`))return json(lot);throw new Error(`Unexpected ${path}`);}));
  render(<MemoryRouter><Lots controller={controller()} roles={['operator']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));fireEvent.click(await screen.findByRole('button',{name:'Move'}));await screen.findByRole('option',{name:/LOT-TARGET/});fireEvent.change(screen.getByLabelText('Target parcel group'),{target:{value:targetLotId}});expect(await screen.findByText('LOT-TARGET')).toBeVisible();expect(screen.getByText('Synthetic Target',{selector:'b'})).toBeVisible();expect(screen.getByText('7')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Confirm move'}));await waitFor(()=>expect(moveBody).not.toBeNull());expect(moveBody).toMatchObject({expected_version:1,membership_id:membershipId,target_lot_id:targetLotId,expected_target_version:7});expect(screen.queryByLabelText(/Target lot version/)).not.toBeInTheDocument();
 });
 it('refreshes source and target after a stale target conflict and requires a deliberate new submission',async()=>{
  const member={id:membershipId,lot_id:lotId,parcel_id:parcelId,started_at:now,ended_at:null,end_reason:null};let targetReads=0,sourceReads=0,moveWrites=0;const moveBodies:Record<string,unknown>[]=[];
  vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/lots?'))return json(page([lot]));if(path.includes(`/lots/${lotId}/memberships`))return json(page([member]));if(path.includes(`/lots/${targetLotId}?`)){targetReads++;return json({...lot,id:targetLotId,code:'LOT-TARGET',name:'Synthetic Target',version:targetReads===1?7:8});}if(path.includes(`/lots/${lotId}/parcels/${parcelId}/move`)&&options.method==='POST'){moveWrites++;moveBodies.push(JSON.parse(String(options.body)));return moveWrites===1?json({error:{code:'VERSION_CONFLICT'}},409):json({lots:[{...lot,version:2,active_member_count:0},{...lot,id:targetLotId,code:'LOT-TARGET',name:'Synthetic Target',version:9,active_member_count:2}],membership:{...member,lot_id:targetLotId}});}if(path.includes(`/lots/${lotId}?`)){sourceReads++;return json(lot);}throw new Error(`Unexpected ${path}`);}));
  render(<MemoryRouter><Lots controller={controller()} roles={['operator']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));fireEvent.click(await screen.findByRole('button',{name:'Move'}));fireEvent.change(screen.getByLabelText(/Target active lot ID/),{target:{value:targetLotId}});await screen.findByText('LOT-TARGET');fireEvent.click(screen.getByRole('button',{name:'Confirm move'}));expect(await screen.findByRole('alert',{name:''})).toHaveTextContent('VERSION_CONFLICT');await waitFor(()=>expect(targetReads).toBeGreaterThanOrEqual(2));expect(sourceReads).toBeGreaterThanOrEqual(2);expect(moveWrites).toBe(1);await waitFor(()=>expect(screen.getByRole('button',{name:'Confirm move'})).toBeEnabled());expect(moveWrites).toBe(1);fireEvent.click(screen.getByRole('button',{name:'Confirm move'}));await waitFor(()=>expect(moveWrites).toBe(2));expect(moveBodies.map(body=>body.expected_target_version)).toEqual([7,8]);
 });
 it('keeps malformed and foreign target lots safely unavailable',async()=>{
  const member={id:membershipId,lot_id:lotId,parcel_id:parcelId,started_at:now,ended_at:null,end_reason:null};let targetReads=0;
  vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.includes('/lots?'))return json(page([lot]));if(path.includes(`/lots/${lotId}/memberships`))return json(page([member]));if(path.includes(`/lots/${targetLotId}?`)){targetReads++;return json({error:{code:'RESOURCE_NOT_FOUND'}},404);}if(path.includes(`/lots/${lotId}?`))return json(lot);throw new Error(`Unexpected ${path}`);}));
  render(<MemoryRouter><Lots controller={controller()} roles={['operator']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));fireEvent.click(await screen.findByRole('button',{name:'Move'}));const input=screen.getByLabelText(/Target active lot ID/);fireEvent.change(input,{target:{value:'not-a-uuid'}});await act(async()=>Promise.resolve());expect(targetReads).toBe(0);expect(screen.getByRole('button',{name:'Confirm move'})).toBeDisabled();fireEvent.change(input,{target:{value:targetLotId}});expect(await screen.findByRole('alert')).toHaveTextContent('unavailable in this workspace');expect(targetReads).toBe(1);expect(screen.queryByText('Synthetic Target')).not.toBeInTheDocument();
 });
 it('shows authoritative archived target details but prevents move submission',async()=>{
  const member={id:membershipId,lot_id:lotId,parcel_id:parcelId,started_at:now,ended_at:null,end_reason:null};let moveWrites=0;
  vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path.includes('/lots?'))return json(page([lot]));if(path.includes(`/lots/${lotId}/memberships`))return json(page([member]));if(path.includes(`/lots/${targetLotId}?`))return json({...lot,id:targetLotId,code:'LOT-ARCHIVED',name:'Archived Target',state:'archived',version:9,archived_at:now});if(path.includes(`/lots/${lotId}/parcels/${parcelId}/move`)&&options.method==='POST'){moveWrites++;return json({});}if(path.includes(`/lots/${lotId}?`))return json(lot);throw new Error(`Unexpected ${path}`);}));
  render(<MemoryRouter><Lots controller={controller()} roles={['operator']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));fireEvent.click(await screen.findByRole('button',{name:'Move'}));fireEvent.change(screen.getByLabelText(/Target active lot ID/),{target:{value:targetLotId}});expect(await screen.findByText('LOT-ARCHIVED')).toBeVisible();expect(screen.getByRole('alert')).toHaveTextContent('Archived lots cannot');expect(screen.getByRole('button',{name:'Confirm move'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Confirm move'}));expect(moveWrites).toBe(0);
 });
 it('shows a route instant as Kolkata wall time and preserves it when only metadata changes',async()=>{
  const scheduled='2026-09-20T12:00:00.000Z',planning={...route,state:'planning',scheduled_departure_at:scheduled};let updateBody:Record<string,unknown>|null=null;
  const manifest={manifest:{id:manifestId,route_id:routeId,version:2,finalized:false,parcel_count:0,created_at:now},items:[],page:{has_more:false,next_cursor:null}};
  vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/routes?'))return json(page([planning]));if(path.includes(`/routes/${routeId}/parcels`))return json(manifest);if(path.includes(`/routes/${routeId}/events`))return json({route_id:routeId,version:4,latest:null});if(path.includes(`/routes/${routeId}?`)&&options.method==='PATCH'){updateBody=JSON.parse(String(options.body));return json({...planning,origin:'Changed Origin',version:5});}if(path.includes(`/routes/${routeId}?`))return json(planning);throw new Error(`Unexpected ${path}`);}));
  render(<MemoryRouter><Routes controller={controller()} roles={['operator']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));await screen.findByRole('heading',{name:'Synthetic Origin → Synthetic Destination'});fireEvent.click(screen.getByText('Edit journey details',{selector:'summary'}));await screen.findByRole('button',{name:'Save journey details'});expect(screen.getByRole('heading',{name:'Synthetic Origin → Synthetic Destination'})).toHaveFocus();const departure=screen.getAllByLabelText('Scheduled departure (Asia/Kolkata)').at(-1)!;expect(departure).toHaveValue('2026-09-20T17:30');fireEvent.change(screen.getAllByLabelText('Origin').at(-1)!,{target:{value:'Changed Origin'}});fireEvent.click(screen.getByRole('button',{name:'Save journey details'}));await waitFor(()=>expect(updateBody).not.toBeNull());expect(updateBody).toMatchObject({origin:'Changed Origin',scheduled_departure_at:scheduled});
 });
 it('re-reads and displays the server ETA after a full route component remount without inferring parcel delivery',async()=>{
  let revision=0,eventReads=0;const manifest={manifest:{id:manifestId,route_id:routeId,version:2,finalized:true,parcel_count:1,created_at:now},items:[{parcel_id:parcelId,sources:[{kind:'direct',source_id:id(50)}]}],page:{has_more:false,next_cursor:null}};vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.includes('/routes?'))return json(page([route]));if(path.includes(`/routes/${routeId}/parcels`))return json(manifest);if(path.includes(`/routes/${routeId}/events`)){eventReads++;return json({route_id:routeId,version:4,latest:{event_id:id(51),route_id:routeId,version:4,manifest_id:manifestId,manifest_version:2,kind:'delay',effective_at:now,updated_count:1,skipped_count:0,eta:{state:'available',base_at:now,revised_at:revision?'2099-01-01T02:00:00.000Z':'2099-01-01T01:00:00.000Z',total_delay_minutes:revision?120:60}}});}if(path.includes(`/routes/${routeId}?`))return json(route);throw new Error(`Unexpected ${path}`);}));const first=render(<MemoryRouter><Routes controller={controller()} roles={['read_only']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));await screen.findByText('60 min');expect(screen.queryByRole('button',{name:/delivered/i})).not.toBeInTheDocument();first.unmount();revision=1;render(<MemoryRouter><Routes controller={controller()} roles={['read_only']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));await screen.findByText('120 min');expect(eventReads).toBe(2);
 });
 it('separates official e-way validity and renders every immutable revision with a stable revision identity',async()=>{
  const record={record_id:id(60),booking_id:bookingId,version:2,declaration:null,external:{issuer:'synthetic_portal',reference:'AB-7',source_ref:null,issued_at:null,official_valid_until:null,validity_evidence_ref:null,provenance:'external_observation',verification_state:'unverified_external',verified_at:null},estimate:{estimated_valid_until:'2099-01-02T00:00:00.000Z',estimate_policy_id:id(20),estimate_policy_version:1,provenance:'shippingco_estimate',label:'ShippingCo estimate — verify on the government portal'},captured_at:now};const prior={...record,version:1,external:{...record.external,reference:'AB-6'},estimate:null};const reminder={booking_id:bookingId,record_id:record.record_id,version:2,external_reference:'AB-7',state};const consoleError=vi.spyOn(console,'error').mockImplementation(()=>{});vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.includes('/eway/reminders'))return json(page([reminder]));if(path.includes(`/bookings/${bookingId}/eway/history`))return json(page([record,prior]));if(path.includes(`/bookings/${bookingId}/eway`))return json({booking_id:bookingId,record,state});throw new Error(`Unexpected ${path}`);}));render(<MemoryRouter><Eway controller={controller()} roles={['accountant']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));expect((await screen.findAllByText('AB-7')).length).toBeGreaterThan(0);fireEvent.click(screen.getByText('Previous records',{selector:'summary'}));const history=await screen.findByRole('table',{name:'E-way revision history'});expect(screen.getByRole('heading',{name:'Booking e-way record'})).toHaveFocus();
  expect(within(history).getByRole('cell',{name:'AB-6'})).toBeVisible();
  expect(within(history).getAllByRole('columnheader').map(header=>header.textContent)).toEqual(['Version','External reference','Declared value','Captured','Reason']);
  const revisions=within(history).getAllByRole('row').slice(1);expect(revisions).toHaveLength(2);
  expect(revisions.map(row=>{const cells=within(row).getAllByRole('cell');expect(cells).toHaveLength(5);return cells.slice(0,3).map(cell=>cell.textContent);})).toEqual([
   ['2','AB-7','No declared value'],
   ['1','AB-6','No declared value'],
  ]);expect(screen.getByText('unverified external')).toBeVisible();expect(screen.getByText('ShippingCo estimate — verify on the government portal')).toBeVisible();expect(screen.getAllByText('Unknown').length).toBeGreaterThan(0);expect(screen.queryByText(/12 digit/i)).not.toBeInTheDocument();expect(consoleError.mock.calls.flat().join(' ')).not.toContain('same key');
 });
});

it('booked-today links and destination/date filters use scoped IST boundaries, and close restores the list position',async()=>{
 const fetcher=vi.fn(async(path:string)=>{if(path.includes('/timeline'))return json({items:[]});if(path.includes('/lot-membership'))return json({membership:null});if(path.includes('/parcels/'+parcelId+'?'))return json(parcel);if(path.includes('/parcels?'))return json(page([parcel]));return json({membership:null});});vi.stubGlobal('fetch',fetcher);
 const scroll=vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 render(<MemoryRouter initialEntries={['/business/packages?booked=today']}><Packages controller={controller()} roles={['read_only']}/></MemoryRouter>);
 const open=await screen.findByRole('button',{name:'Open'});const initial=new URL(fetcher.mock.calls.find(([path])=>path.includes('/parcels?'))![0],'https://synthetic.test');
 expect(initial.searchParams.get('from')).toMatch(/T18:30:00.000Z$/);expect(initial.searchParams.get('franchise_id')).toBe(franchise);
 fireEvent.change(screen.getByLabelText(/Destination city/),{target:{value:'mumbai'}});fireEvent.change(screen.getByLabelText('Booked from (Asia/Kolkata)'),{target:{value:'2026-10-26'}});fireEvent.change(screen.getByLabelText('Booked through (Asia/Kolkata)'),{target:{value:'2026-10-26'}});fireEvent.submit(screen.getByRole('form',{name:'Package filters'}));
 await waitFor(()=>expect(fetcher.mock.calls.some(([path])=>path.includes('destination_key=MUMBAI')&&path.includes('2026-10-25T18%3A30%3A00.000Z')&&path.includes('2026-10-26T18%3A30%3A00.000Z'))).toBe(true));
 const opener=await screen.findByRole('button',{name:'Open'});opener.focus();fireEvent.click(opener);await screen.findByRole('button',{name:'Close detail'});fireEvent.click(screen.getByRole('button',{name:'Close detail'}));expect(opener).toHaveFocus();expect(scroll).toHaveBeenCalled();expect(open).toBeDefined();
});

it('requires an explicit archive confirmation for lots and planning routes without changing server versions',async()=>{
 const writes:{path:string;body:unknown}[]=[];
 vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(options.method==='POST'){writes.push({path,body:JSON.parse(String(options.body))});return json(path.includes('/lots/')?{...lot,state:'archived',archived_at:now,version:2}:{...route,state:'archived',version:5});}
  if(path.includes('/lots?'))return json(page([lot]));if(path.includes('/memberships'))return json(page([]));if(path.includes('/lots/'))return json(lot);if(path.includes('/parcels?'))return json(page([]));
  if(path.includes('/routes?'))return json(page([{...route,state:'planning'}]));if(path.includes('/parcels'))return json({manifest:{id:manifestId,route_id:routeId,version:2,finalized:false,parcel_count:0,created_at:now},items:[],page:{has_more:false,next_cursor:null}});if(path.includes('/events'))return json({route_id:routeId,version:4,latest:null});return json({...route,state:'planning'});
 }));
 for(const item of [{Component:Lots,trigger:'Archive lot',confirm:'Confirm archive lot',version:1,resource:'lots',id:lotId},{Component:Routes,trigger:'Archive planning route',confirm:'Confirm archive route',version:4,resource:'routes',id:routeId}]){
  const mounted=render(<MemoryRouter><item.Component controller={controller()} roles={['franchise_admin']}/></MemoryRouter>);fireEvent.click(await screen.findByRole('button',{name:'Open'}));
  const trigger=await screen.findByRole('button',{name:item.trigger});trigger.focus();const before=writes.length;fireEvent.click(trigger);expect(screen.getByRole('dialog')).toBeVisible();expect(writes).toHaveLength(before);
  fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await waitFor(()=>expect(trigger).toHaveFocus());expect(writes).toHaveLength(before);
  fireEvent.click(trigger);fireEvent.click(screen.getByRole('button',{name:item.confirm}));await waitFor(()=>expect(writes).toHaveLength(before+1));expect(writes.at(-1)?.path).toContain(`/${item.resource}/${item.id}/archive`);expect(writes.at(-1)?.body).toEqual({expected_version:item.version});mounted.unmount();
 }
});


it('adds a route parcel by tracking lookup while retaining server references and version',async()=>{
 let version=4,attached:unknown=null;
 const planning={...route,state:'planning'};
 const manifest={manifest:{id:manifestId,route_id:routeId,version:2,finalized:false,parcel_count:0,created_at:now},items:[],page:{has_more:false,next_cursor:null}};
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(path.includes(`/routes/${routeId}/parcels`)&&options.method==='POST'){attached=JSON.parse(String(options.body));version=5;return json({...planning,version});}
  if(path.includes('/routes?'))return json(page([{...planning,version}]));
  if(path.includes(`/routes/${routeId}/parcels`))return json(manifest);
  if(path.includes(`/routes/${routeId}/events`))return json({route_id:routeId,version,latest:null});
  if(path.includes(`/routes/${routeId}?`))return json({...planning,version});
  if(path.includes('/lots?'))return json(page([]));
  if(path.includes('/parcels?')){expect(path).toContain('docket=SYN-34');expect(path).toContain('franchise_id='+franchise);return json(page([parcel]));}
  throw new Error('Unexpected fixture request');
 }));
 render(<MemoryRouter><Routes controller={controller()} roles={['operator']}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Open'}));
 fireEvent.change(await screen.findByLabelText('Add to dispatch list'),{target:{value:'parcel'}});
 fireEvent.change(screen.getByLabelText('Tracking number'),{target:{value:'SYN-34'}});
 fireEvent.click(screen.getByRole('button',{name:'Find parcel'}));
 fireEvent.click(await screen.findByRole('button',{name:/Use this parcel/}));
 expect(screen.getByLabelText('Parcel ID (UUID)')).not.toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Add to dispatch list'}));
 await waitFor(()=>expect(attached).toEqual({expected_version:4,parcel_id:parcelId}));
});
