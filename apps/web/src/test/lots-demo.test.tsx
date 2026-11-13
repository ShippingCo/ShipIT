import React from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,within,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Lots,{allLotPages} from '../operations/LotsWorkspace';
import {createScopeController} from '../operator/scope';
import type {OperatorDataSource} from '../operator/data-source';
import * as f from './counter-fixture';
const entry={id:f.id(300),state:'confirmed',organization_id:f.org,franchise_id:f.A,confirmed_at:f.now,data:{fields:{name:'Synthetic customer',docket:'SYN-LOT-1',destination:'MUMBAI',weight:'800',packing:'3900',override:'2000'},additional_parcels:[]}};
const lot={id:f.id(301),code:'LOT-0000000000000000001',name:'Mumbai batch',destination_key:'MUMBAI',state:'active' as const,version:1,created_at:f.now,updated_at:f.now,archived_at:null,active_member_count:0,note:'Keep upright',planning_entry_ids:[entry.id]};
const page=(items:unknown[])=>({items,page:{has_more:false,next_cursor:null}});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
async function start(existing=false,post?:(path:string,init:RequestInit)=>Promise<Response>){
 let created=existing;
 const fetcher=vi.fn(async(path:string,init:RequestInit={})=>{
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf-token'});
  if(init.method&&init.method!=='GET'){if(post)return post(path,init);created=true;return f.json({...lot,...JSON.parse(init.body as string)},201);}
  if(path.startsWith('/api/v1/bookings/entries?'))return f.json({items:[entry]});
  if(path.startsWith('/api/v1/lots?'))return f.json(page(created?[lot]:[]));
  if(path.includes('/memberships?'))return f.json(page([]));
  if(path.startsWith('/api/v1/parcels?')||path.startsWith('/api/v1/routes?'))return f.json(page([]));
  throw new Error('Unexpected request '+path);
 });vi.stubGlobal('fetch',fetcher);
 const controller=createScopeController({loadContext:vi.fn().mockResolvedValue(f.context)} as unknown as OperatorDataSource);await controller.load();
 render(<MemoryRouter><Lots controller={controller} roles={['org_admin']}/></MemoryRouter>);
 await screen.findByText(existing?'Mumbai':'No bags yet');return fetcher;
}
// R-6: starting a bag asks one question — which city. The bag names itself, because an
// operator made to invent a name for a sack will invent "aaa".
it('starts a bag from its destination alone, pre-ticks that city and saves the staff note',async()=>{
 const fetcher=await start();fireEvent.click(screen.getByRole('button',{name:'Start a bag'}));
 const dialog=within(await screen.findByRole('dialog'));
 expect(dialog.getByRole('heading',{name:'Start a bag'})).toBeVisible();
 expect(dialog.getByRole('button',{name:'Mumbai 1'})).toHaveAttribute('aria-pressed','true');
 expect(dialog.getByRole('checkbox',{name:'Put SYN-LOT-1 in this bag'})).toBeChecked();
 expect(dialog.getByText('0.8',{exact:true})).toBeVisible();
 expect(dialog.queryByLabelText('Put on a route')).toBeNull();
 fireEvent.change(dialog.getByLabelText('Note for your staff'),{target:{value:'Handle carefully'}});
 fireEvent.click(dialog.getByRole('button',{name:'Start it with 1 parcel'}));
 await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 const request=fetcher.mock.calls.find(([,init])=>init?.method==='POST')!;
 expect(JSON.parse(request[1]!.body as string)).toMatchObject({destination_key:'MUMBAI',note:'Handle carefully',planning_entry_ids:[entry.id]});
});
// R-1, R-2, R-3: the destination leads, the card carries only what the PRD lists, and the
// words "lot", "membership", "candidate" and "archived" appear nowhere on the screen.
it('leads a bag card with its city and carries only the figures the PRD lists',async()=>{
 await start(true);
 expect(screen.getByText('Mumbai')).toBeVisible();expect(screen.getByText(lot.code)).toBeVisible();
 expect(screen.getByRole('heading',{name:'Open'})).toBeVisible();
 for(const label of ['parcels','kg','open'])expect(screen.getByText(label,{exact:true})).toBeVisible();
 expect(screen.getByText('Keep upright')).toBeVisible();
 expect(screen.getByText('1 planned, not booked yet')).toBeVisible();
 // Nothing has been put in this bag, so it says so rather than leaving the line blank.
 expect(screen.getByText('Nothing has been put in this bag yet.')).toBeVisible();
 for(const word of [/\blot\b/i,/membership/i,/candidate/i,/archived/i])expect(document.body.textContent).not.toMatch(word);
 // R-10: sealing is the only filled button, and it is unavailable while the bag holds no parcel.
 expect(screen.getByRole('button',{name:'Add parcels'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Seal and send this bag'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Message 1'})).toBeVisible();
 expect(screen.getByRole('button',{name:'Delete this bag'})).toBeVisible();
});
it('blocks closing an uncertain create and retries the identical idempotency key without a second lot',async()=>{
 const posts:RequestInit[]=[];await start(false,async(_path,init)=>{posts.push(init);if(posts.length===1)throw new TypeError('Synthetic lost response');return f.json(lot,201);});
 fireEvent.click(screen.getByRole('button',{name:'Start a bag'}));fireEvent.click(screen.getByRole('button',{name:'Start it with 1 parcel'}));
 const retry=await screen.findByRole('button',{name:'Check if it saved'});expect(screen.getByRole('button',{name:'Cancel'})).toBeDisabled();expect(screen.queryByRole('button',{name:'Close'})).toBeNull();
 fireEvent.click(retry);await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 expect(posts).toHaveLength(2);expect(posts[1]!.body).toBe(posts[0]!.body);expect(posts[1]!.headers).toEqual(posts[0]!.headers);
});
it('reports queued, suppressed and unverified planning recipients separately without claiming delivery',async()=>{
 await start(true,async(path)=>{expect(path).toContain('/messages?');return f.json({id:f.id(350),queued:0,suppressed:0,failed:0,unavailable:1});});
 fireEvent.click(screen.getByRole('button',{name:'Message 1'}));fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Synthetic update'}});fireEvent.click(screen.getByRole('button',{name:'Send to everyone in this bag'}));
 expect(await screen.findByText(/1 planning entries without verified customer records/)).toBeVisible();expect(screen.getByText(/Queued does not mean delivered/)).toBeVisible();
});
it('reads every cursor page and rejects a repeated cursor instead of presenting partial totals',async()=>{
 const load=vi.fn().mockResolvedValueOnce({items:[1],page:{has_more:true,next_cursor:'next'}}).mockResolvedValueOnce({items:[2],page:{has_more:false,next_cursor:null}});
 expect(await allLotPages(load)).toEqual([1,2]);expect(load.mock.calls).toEqual([[null],['next']]);
 await expect(allLotPages(async()=>({items:[],page:{has_more:true,next_cursor:'loop'}}))).rejects.toThrow('Invalid pagination');
});

it('reattaches an existing shipment route when only planning entries are added',async()=>{
 const {lotPlan}=await import('../operations/lot-plan');
 const current={...lot,active_member_count:1},routeCommands:unknown[]=[];
 const source={read:vi.fn(async()=>current),intent:vi.fn(command=>command),execute:vi.fn(async()=>({...current,version:2}))} as unknown as import('../data-access/lots').LotSource;
 const routeSource={read:vi.fn(async()=>({id:f.id(360),version:1})),intent:vi.fn(command=>command),execute:vi.fn(async(command:unknown)=>{routeCommands.push(command);return {};})} as unknown as import('../data-access/routes').RouteSource;
 const plan=lotPlan({lots:source,routes:routeSource,lot:current,attachedRouteId:f.id(360),name:current.name,destination:'MUMBAI',note:'Keep upright',entries:[entry.id],parcels:[],routeId:f.id(360)});
 await plan.execute();expect(routeCommands).toEqual([expect.objectContaining({kind:'detach_lot',lotId:lot.id}),expect.objectContaining({kind:'attach_lot',body:expect.objectContaining({lot_id:lot.id})})]);
});
