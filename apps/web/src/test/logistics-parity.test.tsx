import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {OperationalPackages as Packages} from '../operations/Packages';
import {OperationalLots as Lots} from '../operations/Lots';
import {OperationalRoutes as Routes} from '../operations/Routes';
import {createScopeController} from '../operator/scope';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now='2099-01-01T00:00:00.000Z';
const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const page=(items:unknown[]=[])=>({items,page:{has_more:false,next_cursor:null}});
const lot={id:id(6),code:'LOT-SYN',name:'Synthetic lot',destination_key:'SYN-EAST',state:'active',version:1,created_at:now,updated_at:now,archived_at:null,active_member_count:0};
const route={id:id(8),origin:'Synthetic Origin',destination:'Synthetic Destination',mode:'road',carrier_code:null,scheduled_departure_at:now,state:'planning',version:1,current_manifest_id:id(9),created_at:now,updated_at:now};
const parcel={id:id(4),booking_id:id(5),version:1,status:'booked',custody:'awaiting_intake',docket:'SYN-34',weight_grams:800,confirmed_at:now,sender:{source_customer_id:id(10),source_customer_version:1,name:'Synthetic Sender',phone:'+12025550100',phone_display:'+1 202-555-0100',address:'Synthetic address'},recipient:{name:'Synthetic Recipient',phone_normalized:'+12025550101',phone_display:'+1 202-555-0101',address:'Synthetic destination'},details:{country:'IN',postal_code:'400001',city:'Mumbai',region:'MH',contents_type:'documents',contents_description:'Synthetic documents',liquid_quantity_ml:null}};
function controller(){const c=createScopeController();c.runtime.bind({userId:id(1),organizationId:id(2),franchiseId:id(3),permissions:'operator'});return c;}
const fill=(label:string,value:string)=>fireEvent.change(screen.getByLabelText(label),{target:{value}});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

it('filters and sorts packages through scoped server queries while retaining the applied customer and date range',async()=>{
 const request=vi.fn(async(_path:string)=>json(page([parcel])));vi.stubGlobal('fetch',request);
 render(<MemoryRouter initialEntries={['/business/packages?customer_id='+id(10)+'&booked=today']}><Packages controller={controller()} roles={['operator']}/></MemoryRouter>);
 await screen.findByRole('button',{name:'Open'});expect(screen.getByText('Synthetic Sender')).toBeVisible();expect(screen.getByText('Mumbai')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Delivered'}));await waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('status=delivered'));
 const q=new URL(request.mock.calls.at(-1)![0],'http://localhost').searchParams;expect(q.get('customer_id')).toBe(id(10));expect(q.get('franchise_id')).toBe(id(3));expect(q.has('from')).toBe(true);
 await screen.findByRole('combobox',{name:'Sort packages'});fill('Sort packages','docket_asc');await waitFor(()=>expect(request.mock.calls.at(-1)![0]).toContain('sort=docket_asc'));
 expect(screen.getByRole('button',{name:'Delivered'})).toHaveAttribute('aria-pressed','true');expect(screen.getByRole('button',{name:'Delivered'}).querySelector('.fchip-n')).toBeNull();
});
it('opens package detail in a dialog and restores keyboard focus to its list action',async()=>{
 const withoutContact={...parcel,recipient:{...parcel.recipient,name:null,phone_display:null,phone_normalized:null}};
 const scroll=vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>{if(path.includes('/timeline'))return json({items:[]});if(path.includes('/lot-membership'))return json(null);if(path.includes('/parcels/'+parcel.id+'?'))return json(withoutContact);if(path.includes('/parcels?'))return json(page([withoutContact]));throw new Error('Unexpected read');}));
 render(<MemoryRouter><Packages controller={controller()} roles={['read_only']}/></MemoryRouter>);const open=await screen.findByRole('button',{name:'Open'});open.focus();fireEvent.click(open);const dialog=await screen.findByRole('dialog',{name:'Package details'});await within(dialog).findByRole('heading',{name:parcel.docket});
 expect(within(dialog).getByText('No receiver phone provided')).toBeVisible();expect(within(dialog).getByText(parcel.recipient.address)).toBeVisible();
 fireEvent.click(within(dialog).getByRole('button',{name:'Close detail'}));await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(open).toHaveFocus();expect(scroll).toHaveBeenCalled();
});
it('retains a delivery assignment after a lost response and retries the same handover evidence',async()=>{
 const writes:RequestInit[]=[];let failed=true;
 const delivery={parcel_id:parcel.id,docket:parcel.docket,parcel_version:2,attempt_id:id(11),assignment_id:id(12),attempt_number:1,challenge_ref:id(13),challenge_version:1,status:'pending',expires_at:now,resend_available_at:now,resends_remaining:2,verification_attempts_remaining:3,send_state:'queued',send_reason:'pending',proof_method:null,exception:null};
 vi.spyOn(window,'scrollTo').mockImplementation(()=>{});
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(path.includes('/deliveries/'+parcel.id+'/start?')){writes.push(options);if(failed)throw new TypeError('Synthetic lost acknowledgement');return json(delivery);}
  if(path.includes('/eligible-agents'))return json({items:[{id:id(14),label:'Synthetic agent'}]});
  if(path.includes('/timeline'))return json({items:[]});if(path.includes('/lot-membership'))return json(null);
  if(path.includes('/parcels/'+parcel.id+'?'))return json({...parcel,status:failed?'in_transit':'out_for_delivery'});
  if(path.includes('/parcels?'))return json(page([parcel]));throw new Error('Unexpected delivery request');
 }));
 render(<MemoryRouter><Packages controller={controller()} roles={['dispatcher']}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Open'}));await screen.findByLabelText('Assigned delivery agent');fill('Handover evidence reference (UUID)',id(15));expect(screen.getByRole('button',{name:'Assign and send challenge'})).toBeDisabled();fill('Assigned delivery agent',id(14));fireEvent.click(screen.getByRole('button',{name:'Assign and send challenge'}));
 const retry=await screen.findByRole('button',{name:'Retry same request'});expect(screen.getByRole('button',{name:'Assign and send challenge'})).toBeDisabled();expect(screen.getByRole('button',{name:'Close detail'})).toBeDisabled();fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog')).toBeVisible();
 failed=false;fireEvent.click(retry);await waitFor(()=>expect(screen.queryByRole('button',{name:'Assign and send challenge'})).not.toBeInTheDocument());expect(writes).toHaveLength(2);expect(writes[0]!.body).toBe(writes[1]!.body);expect(writes[0]!.headers).toEqual(writes[1]!.headers);expect(JSON.parse(String(writes[0]!.body))).toEqual({expected_version:1,agent_id:id(14),handover_evidence_ref:id(15)});
 expect(screen.getByRole('button',{name:'Close detail'})).toBeEnabled();
});
it('keeps a lot draft on dismissal and preserves its uncertain creation intent until the original request succeeds',async()=>{
 const writes:RequestInit[]=[];let failed=true;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/lots?')&&options.method==='POST'){writes.push(options);if(failed)throw new TypeError('Synthetic lost acknowledgement');return json(lot);}if(path.includes('/lots?'))return json(page());throw new Error('Unexpected lot request');}));
 render(<MemoryRouter><Lots controller={controller()} roles={['operator']}/></MemoryRouter>);const create=screen.getByRole('button',{name:'Create Lot'});create.focus();fireEvent.click(create);expect(screen.getByLabelText('Lot name')).toHaveFocus();fill('Lot name','Synthetic lot');fill('Destination key','SYN-EAST');
 fireEvent.click(screen.getByRole('button',{name:'Close'}));await waitFor(()=>expect(create).toHaveFocus());fireEvent.click(create);expect(screen.getByLabelText('Lot name')).toHaveValue('Synthetic lot');fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Create lot'}));
 const retry=await screen.findByRole('button',{name:'Retry same request'});expect(screen.queryByRole('button',{name:'Close'})).not.toBeInTheDocument();fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog',{name:'Create lot'})).toBeVisible();failed=false;fireEvent.click(retry);
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(writes).toHaveLength(2);expect(writes[0]!.body).toBe(writes[1]!.body);expect(writes[0]!.headers).toEqual(writes[1]!.headers);fireEvent.click(create);expect(screen.getByLabelText('Lot name')).toHaveValue('');
});
it('plans a route only after explicit submission and retains its retry identity when the response is lost',async()=>{
 const writes:RequestInit[]=[];let failed=true;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/routes?')&&options.method==='POST'){writes.push(options);if(failed)throw new TypeError('Synthetic lost acknowledgement');return json(route);}if(path.includes('/routes?'))return json(page());throw new Error('Unexpected route request');}));
 render(<MemoryRouter><Routes controller={controller()} roles={['operator']}/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'Plan Route'}));expect(screen.getByLabelText('Origin')).toHaveFocus();fill('Origin','Synthetic Origin');fill('Destination','Synthetic Destination');fill('Scheduled departure (Asia/Kolkata)','2099-01-01T05:30');fill('Mode','road');await act(async()=>Promise.resolve());expect(writes).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Create route'}));const retry=await screen.findByRole('button',{name:'Retry same request'});fireEvent.keyDown(document,{key:'Escape'});expect(screen.getByRole('dialog',{name:'Plan route'})).toBeVisible();failed=false;fireEvent.click(retry);
 await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());expect(writes).toHaveLength(2);expect(writes[0]!.body).toBe(writes[1]!.body);expect(writes[0]!.headers).toEqual(writes[1]!.headers);expect(JSON.parse(String(writes[0]!.body)).scheduled_departure_at).toBe(now);
});

it('cancels the whole booking from a docket and preserves retry identity after a lost acknowledgement',async()=>{
 const writes:RequestInit[]=[];let cancelled=false;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});
  if(path.includes('/cancellation?')){
   if(options.method==='POST'){writes.push(options);if(writes.length===1)throw new TypeError('Synthetic lost acknowledgement');cancelled=true;return json({id:id(15),booking_id:parcel.booking_id,parcel_count:2,outstanding_paise:'12000',cancelled_at:now});}
   return json({booking_id:parcel.booking_id,parcel_count:2,outstanding_paise:'12000',financial_version:1,payment_version:0,blocked_reason:null});
  }
  return json(page([{...parcel,status:cancelled?'cancelled':'booked'}]));
 }));
 render(<MemoryRouter><Packages controller={controller()} roles={['operator']}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Cancel booking'}));const dialog=await screen.findByRole('dialog');
 expect(await within(dialog).findByText('₹120.00')).toBeVisible();expect(within(dialog).getByRole('button',{name:'Confirm cancellation'})).toBeDisabled();
 fill('Reason for cancellation','Sender withdrew both parcels');fireEvent.click(within(dialog).getByRole('button',{name:'Confirm cancellation'}));
 const retry=await within(dialog).findByRole('button',{name:'Retry same cancellation'});fireEvent.keyDown(document,{key:'Escape'});expect(dialog).toBeVisible();fireEvent.click(retry);
 expect(await within(dialog).findByText('Cancelled 2 parcels in this booking.')).toBeVisible();expect(writes).toHaveLength(2);expect(writes[0]!.headers).toEqual(writes[1]!.headers);expect(writes[0]!.body).toBe(writes[1]!.body);
 expect(JSON.parse(String(writes[0]!.body))).toEqual({reason:'Sender withdrew both parcels',expected_financial_version:1,expected_payment_version:0});
 fireEvent.click(within(dialog).getByRole('button',{name:'Done'}));expect(screen.queryByRole('button',{name:'Cancel booking'})).not.toBeInTheDocument();
});
it('explains a payment block before offering any cancellation write',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>path.includes('/cancellation?')?json({booking_id:parcel.booking_id,parcel_count:1,outstanding_paise:'0',financial_version:2,payment_version:1,blocked_reason:'money_recorded'}):json(page([parcel]))));
 render(<MemoryRouter><Packages controller={controller()} roles={['operator']}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Cancel booking'}));expect(await screen.findByText(/Money has already been recorded/)).toBeVisible();
 expect(screen.queryByRole('button',{name:'Confirm cancellation'})).not.toBeInTheDocument();expect(screen.queryByLabelText('Reason for cancellation')).not.toBeInTheDocument();
});
