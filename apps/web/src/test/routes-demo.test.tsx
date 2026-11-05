import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Routes from '../operations/RoutesWorkspace';
import {routeJourneyPlan} from '../operations/route-workflow';
import {createScopeController} from '../operator/scope';
import {routes} from '../data-access/routes';
import {parcels} from '../data-access/parcels';
import {scopedApi} from '../data-access/scoped-api';
import type {RouteDto,RouteManifestDto} from '@shippingco/shared';
import type {ParcelRead} from '../data-access/parcels';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now='2099-01-01T00:00:00.000Z';
const route:RouteDto={id:id(8),origin:'Ahmedabad',destination:'Mumbai',mode:'air',carrier_code:'SYN-888',scheduled_departure_at:now,state:'planning',version:1,current_manifest_id:id(9),created_at:now,updated_at:now,planning_entry_ids:[id(15)]};
const manifest:RouteManifestDto={id:id(9),route_id:route.id,version:1,finalized:false,parcel_count:0,created_at:now};
const json=(value:unknown)=>new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
const page=(items:unknown[]=[])=>({items,page:{has_more:false,next_cursor:null}});
function controller(){const c=createScopeController();c.runtime.bind({userId:id(1),organizationId:id(2),franchiseId:id(3),permissions:'operator'});return c;}
function reads(path:string,r=route){if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(path.includes('/history?'))return json(page([{id:id(16),type:'route.created',at:now,note:'Synthetic route history',total_delay_minutes:0,planning:false}]));if(path.includes('/events?'))return json({route_id:r.id,version:r.version,latest:null});if(path.includes('/routes/'+r.id+'/parcels?'))return json({...page(),manifest});if(path.includes('/routes?'))return json(page([r]));if(path.includes('/routes/'+r.id+'?'))return json(r);if(path.includes('/lots?')||path.includes('/parcels?')||path.includes('/bookings/entries?'))return json(page());throw new Error('Unexpected request');}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('matches the demo route hierarchy, keeps planning counts truthful, and shows expandable history',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(path:string)=>reads(path)));
 render(<MemoryRouter><Routes controller={controller()} roles={['operator']}/></MemoryRouter>);
 expect(await screen.findByText('Ahmedabad → Mumbai')).toBeVisible();expect(screen.getByText('1 planning entry')).toBeVisible();expect(screen.getByRole('button',{name:'Mark departed'})).toBeEnabled();
 const toggle=screen.getByRole('button',{name:'Show history (1)'});expect(toggle).toHaveAttribute('aria-expanded','false');fireEvent.click(toggle);expect(screen.getByText('Synthetic route history')).toBeVisible();expect(toggle).toHaveAttribute('aria-expanded','true');
 fireEvent.click(screen.getByRole('button',{name:'Plan Route'}));const dialog=screen.getByRole('dialog',{name:'Plan dispatch route'});expect(within(dialog).getByLabelText('From')).toHaveValue('Ahmedabad');expect(within(dialog).getByLabelText('Departure')).toHaveAttribute('type','datetime-local');expect(within(dialog).getByText('No lots yet. You can attach them later.')).toBeVisible();
});
it('records planning departure with an exact retry after a lost response and never dispatches a parcel',async()=>{
 let failed=true,current=route;const writes:RequestInit[]=[];
 const fetcher=vi.fn(async(path:string,options:RequestInit={})=>{if(options.method==='PATCH'){writes.push(options);if(failed)throw new TypeError('Synthetic lost acknowledgement');current={...route,version:2,planning_progress:'departed'};return json(current);}return reads(path,current);});vi.stubGlobal('fetch',fetcher);
 render(<MemoryRouter><Routes controller={controller()} roles={['operator']}/></MemoryRouter>);
 fireEvent.click(await screen.findByRole('button',{name:'Mark departed'}));const dialog=screen.getByRole('dialog');expect(within(dialog).getByText(/Parcel custody stays unchanged/)).toBeVisible();fireEvent.click(within(dialog).getByRole('button',{name:'Mark departed'}));
 const retry=await screen.findByRole('button',{name:'Retry same request'});expect(screen.queryByRole('button',{name:'Close'})).not.toBeInTheDocument();fireEvent.keyDown(document,{key:'Escape'});expect(dialog).toBeVisible();failed=false;fireEvent.click(retry);
 await screen.findByRole('button',{name:'Mark arrived'});expect(writes).toHaveLength(2);expect(writes[0]!.body).toBe(writes[1]!.body);expect(writes[0]!.headers).toEqual(writes[1]!.headers);expect(JSON.parse(String(writes[0]!.body)).planning_progress).toBe('departed');expect(fetcher.mock.calls.some(([p])=>p.includes('/dispatch?'))).toBe(false);
});
it('resumes a physical departure after a lost dispatch response without repeating finalization or changing evidence',async()=>{
 const physical={...route,planning_entry_ids:undefined},dispatchable={id:id(20),version:1,status:'checked_in'} as ParcelRead;
 let current=physical,failed=true;const effects:{path:string;options:RequestInit}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{if(path==='/auth/bootstrap')return json({csrf_token:'synthetic-csrf'});if(options.method==='POST'){
 effects.push({path,options});if(path.includes('/finalize?')){current={...physical,state:'finalized',version:2};return json(current);}if(path.includes('/dispatch?')){if(failed)throw new TypeError('Synthetic lost acknowledgement');return json({id:dispatchable.id,booking_id:id(21),docket:'SYN-20',version:2,status:'dispatched',custody:'route_dispatch',attempts_started:0,failed_attempt_count:0,event_id:id(23),transitioned_at:now});}
 if(path.includes('/events?'))return json({event_id:id(22),route_id:route.id,version:3,manifest_id:manifest.id,manifest_version:1,kind:'departure',effective_at:now,updated_count:1,skipped_count:0,eta:{state:'unavailable',base_at:null,revised_at:null,total_delay_minutes:0}});
 }if(path.includes('/parcels?'))return json({...page(),manifest:{...manifest,finalized:true,parcel_count:1}});return reads(path,current);}));
 const api=scopedApi(controller()),workflow=routeJourneyPlan({source:routes(api),parcels:parcels(api),route:physical,manifest:{...manifest,parcel_count:1},rows:[dispatchable],kind:'departure',note:'Synthetic departure',effectiveAt:now,baseEta:null,delayMinutes:0});
 await expect(workflow.execute()).rejects.toThrow();failed=false;await workflow.execute();expect(effects.filter(e=>e.path.includes('/finalize?'))).toHaveLength(1);const attempts=effects.filter(e=>e.path.includes('/dispatch?'));expect(attempts).toHaveLength(2);expect(attempts[0]!.options.body).toBe(attempts[1]!.options.body);expect(attempts[0]!.options.headers).toEqual(attempts[1]!.options.headers);expect(effects.filter(e=>e.path.includes('/events?'))).toHaveLength(1);
});
