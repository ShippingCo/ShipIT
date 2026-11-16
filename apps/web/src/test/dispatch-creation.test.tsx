import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {fireEvent,render,screen,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import Lots from '../operations/LotsWorkspace';
import Routes from '../operations/RoutesWorkspace';
import {createScopeController} from '../operator/scope';
import * as f from './counter-fixture';

const page=(items:unknown[]=[])=>({items,page:{has_more:false,next_cursor:null}});
const lot={id:f.id(701),code:'LOT-701',name:'Mumbai evening',destination_key:'MUMBAI',state:'active',version:1,created_at:f.now,updated_at:f.now,archived_at:null,active_member_count:0,planning_entry_ids:[]};
const route={id:f.id(702),origin:'Ahmedabad',destination:'Mumbai',mode:'road',carrier_code:null,scheduled_departure_at:f.now,state:'planning',version:1,current_manifest_id:f.id(703),created_at:f.now,updated_at:f.now};

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function mount(area:'lots'|'routes',readState:'empty'|'failed'|'loading',readOnly=false){
 const writes:{path:string;body:Record<string,unknown>}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,init:RequestInit={})=>{
  if(path==='/auth/bootstrap')return f.json({csrf_token:'synthetic-csrf'});
  if(init.method==='POST'){
   const body=JSON.parse(String(init.body));writes.push({path,body});
   return f.json({...(area==='lots'?lot:route),...body},201);
  }
  if(readState==='failed')return f.json({error:{code:'TEMPORARILY_UNAVAILABLE'}},503);
  if(readState==='loading')return new Promise<Response>(()=>{});
  return f.json(page());
 }));
 const controller=createScopeController();controller.runtime.bind({userId:f.id(1),organizationId:f.org,franchiseId:f.A,permissions:readOnly?'read_only':'operator'});
 const View=area==='lots'?Lots:Routes;
 render(<MemoryRouter><View controller={controller} roles={readOnly?['read_only']:['operator']}/></MemoryRouter>);
 return writes;
}

it.each(['empty','failed'] as const)('starts an empty bag when saved data is %s',async state=>{
 const writes=mount('lots',state);
 if(state==='failed')await screen.findByRole('alert');else await screen.findByText('No bags yet');
 fireEvent.click(screen.getByRole('button',{name:'Start a bag'}));
 const dialog=within(screen.getByRole('dialog',{name:'Start a bag'}));
 // R-6: one question. The bag is named from its city and the day, so there is nothing to type.
 fireEvent.change(dialog.getByRole('textbox',{name:'City'}),{target:{value:'Mumbai'}});
 expect(dialog.queryByRole('textbox',{name:/name/i})).toBeNull();
 expect(dialog.getByRole('button',{name:'Start the bag'})).toBeEnabled();
 fireEvent.click(dialog.getByRole('button',{name:'Start the bag'}));
 expect(await screen.findByText('Mumbai bag saved with 0 parcels.')).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(writes[0]).toMatchObject({body:{destination_key:'MUMBAI',planning_entry_ids:[]}});
});

it.each(['empty','failed'] as const)('schedules a route without lots when saved data is %s',async state=>{
 const writes=mount('routes',state);
 if(state==='failed')await screen.findByRole('alert');else await screen.findByText('No trips yet');
 fireEvent.click(screen.getByRole('button',{name:'Plan a trip'}));
 const dialog=within(screen.getByRole('dialog',{name:'Plan a trip'}));
 // R-5: two things are asked. The plate is accepted exactly as typed.
 fireEvent.change(dialog.getByRole('textbox',{name:'Vehicle number'}),{target:{value:'gj-04-tr-1234'}});
 fireEvent.change(dialog.getByRole('textbox',{name:'Destination city'}),{target:{value:'Mumbai'}});
 fireEvent.change(dialog.getByRole('textbox',{name:'From'}),{target:{value:'Ahmedabad'}});
 fireEvent.click(dialog.getByRole('button',{name:'Plan the trip'}));
 expect(await screen.findByText(/planned\./)).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(writes[0]).toMatchObject({body:{origin:'Ahmedabad',destination:'Mumbai',carrier_code:'GJ-04-TR-1234'}});
});

it.each(['lots','routes'] as const)('opens the %s editor while initial data is still loading',area=>{
 mount(area,'loading');
 fireEvent.click(screen.getByRole('button',{name:area==='lots'?'Start a bag':'Plan a trip'}));
 const dialog=within(screen.getByRole('dialog'));
 const field=area==='lots'?'City':'Destination city';
 expect(dialog.getByRole('textbox',{name:field})).toBeEnabled();
 fireEvent.change(dialog.getByRole('textbox',{name:field}),{target:{value:'Pune'}});
 expect(dialog.getByRole('textbox',{name:field})).toHaveValue('Pune');
});

it.each(['lots','routes'] as const)('keeps %s creation unavailable to read-only users',async area=>{
 mount(area,'empty',true);
 await screen.findByText(area==='lots'?'No bags yet':'No trips yet');
 expect(screen.queryByRole('button',{name:area==='lots'?'Start a bag':'Plan a trip'})).not.toBeInTheDocument();
});
