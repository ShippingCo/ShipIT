import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import AgentSettlements from '../operations/AgentSettlements';
import {cashbook} from '../data-access/cashbook';
import {scopedApi} from '../data-access/scoped-api';
import {createScopeController} from '../operator/scope';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),org=id(1),fr=id(2),agent=id(3),location=id(4),target=id(5),request=id(6),revision=id(7),now='2026-10-11T06:00:00.120Z';
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function controller(){const c=createScopeController();c.runtime.bind({userId:agent,organizationId:org,franchiseId:fr,permissions:'delivery_agent'});return c;}
const own={id:location,name:'Your cash location',custodian_id:agent,kind:'cash',active:true};
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('agent opens handover-only controls and recovers the same request while settlement navigation is locked',async()=>{
 const c=controller(),writes:{key:string;body:Record<string,unknown>}[]=[];let saved:Record<string,unknown>|null=null;
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{const u=new URL(path,'https://example.test');
  if(u.pathname==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});
  if(options.method==='POST'){const body=JSON.parse(String(options.body));writes.push({key:(options.headers as Record<string,string>)['Idempotency-Key'],body});saved={...body,id:request,version:1,actor_id:agent,recorded_at:now,occurred_at:'2026-10-11T06:00:00Z'};if(writes.length===1)throw new TypeError('Synthetic committed handover response lost');return json(saved);}
  if(u.pathname.endsWith('/submissions'))return json({items:[],as_of:now,next_cursor:null});
  if(u.pathname.endsWith('/handover-sources'))return json({items:[own],next_cursor:null});
  if(u.pathname.endsWith('/handovers'))return json({items:[],next_cursor:null,current_source_version:9});
  if(u.pathname.endsWith('/handover-targets'))return json({source_location_id:location,source_revision_id:revision,current_source_version:9,items:[{id:target,revision_id:id(8),name:'Named office receiver',custodian_id:id(9)}],next_cursor:null});
  if(u.pathname.endsWith('/handovers/'+request))return json({request:saved,source_custodian_id:agent,target_custodian_id:id(9),version:1,accepted_paise:0,remaining_paise:209000,ended_paise:0,state:'requested',current_source_version:9,commands:[],next_cursor:null});
  throw new Error('Unexpected general finance path '+u.pathname);
 }));
 render(<AgentSettlements controller={c} roles={['delivery_agent']}/>);fireEvent.click(screen.getByRole('button',{name:'Open cash handovers'}));await waitFor(()=>expect(screen.getByRole('option',{name:'Your cash location'})).toBeInTheDocument());
 expect(screen.queryByRole('button',{name:'Expense and fund requests'})).toBeNull();expect(screen.queryByRole('button',{name:'Open COD and agent fees'})).toBeNull();
 fireEvent.change(screen.getByLabelText('Sending cash location'),{target:{value:location}});await waitFor(()=>expect(screen.getByRole('option',{name:'Named office receiver'})).toBeInTheDocument());fireEvent.change(screen.getByLabelText('Receiving custodian location'),{target:{value:target}});fireEvent.change(screen.getByLabelText('Handover amount (\u20b9)'),{target:{value:'2090.00'}});fireEvent.change(screen.getByLabelText('Cash handed over at (Kolkata)'),{target:{value:'2026-10-11T11:30'}});fireEvent.change(screen.getByLabelText('Handover reason'),{target:{value:'Synthetic actual cash handover'}});fireEvent.click(screen.getByRole('button',{name:'Request custody acknowledgement'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Retry same request'})).toBeInTheDocument());expect(screen.getByRole('button',{name:'Open daily statements'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Retry same request'}));await waitFor(()=>expect(screen.getByRole('heading',{name:'Saved custody handover'})).toBeInTheDocument());expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(writes[0]!.body).toMatchObject({source_location_id:location,target_location_id:target,amount_paise:209000,expected_source_version:9});expect(screen.getByRole('button',{name:'Open daily statements'})).toBeEnabled();
});
it('own-source adapter minimizes fields, rejects foreign or broken pages and handover recovery requires the identical instant and amount',async()=>{
 const c=controller(),source=cashbook(scopedApi(c));let response:unknown={items:[{...own,private_contact:'Synthetic excluded'}],next_cursor:null};vi.stubGlobal('fetch',vi.fn(async(path:string)=>json(path==='/auth/bootstrap'?{csrf_token:'synthetic_csrf'}:response)));
 const sources=await source.handoverSources();expect(sources.items[0]).toEqual(own);for(const bad of [{items:[{...own,custodian_id:id(99)}],next_cursor:null},{items:[own,own],next_cursor:null},{items:[own],next_cursor:location}]){response=bad;await expect(source.handoverSources()).rejects.toMatchObject({kind:'protocol'});}
 const input={source_location_id:location,source_revision_id:revision,target_location_id:target,target_revision_id:id(8),expected_source_version:9,amount_paise:1000,currency:'INR',reason:'Synthetic exact handover',occurred_at:now} as const,intent=source.requestHandover(input);response={...input,id:request,version:1,actor_id:agent,recorded_at:now,occurred_at:'2026-10-11T06:00:00.12Z'};expect((await source.executeHandover(intent)).id).toBe(request);
 for(const changed of [{occurred_at:'2026-10-11T06:00:00.121Z'},{amount_paise:999},{target_location_id:id(99)}]){response={...input,id:request,version:1,actor_id:agent,recorded_at:now,...changed};await expect(source.executeHandover(intent)).rejects.toMatchObject({kind:'protocol',dispatched:true});}
});
