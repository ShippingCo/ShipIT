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

it.each(['empty','failed'] as const)('creates an empty lot when saved data is %s',async state=>{
 const writes=mount('lots',state);
 if(state==='failed')await screen.findByRole('alert');else await screen.findByText('No lots yet');
 fireEvent.click(screen.getByRole('button',{name:'Create Lot'}));
 const dialog=within(screen.getByRole('dialog',{name:'New lot'}));
 fireEvent.change(dialog.getByRole('textbox',{name:'Destination city'}),{target:{value:'Mumbai'}});
 fireEvent.change(dialog.getByRole('textbox',{name:'Lot name'}),{target:{value:'Mumbai evening'}});
 expect(dialog.getByRole('button',{name:'Create lot'})).toBeEnabled();
 fireEvent.click(dialog.getByRole('button',{name:'Create lot'}));
 expect(await screen.findByText('LOT-701 saved with 0 selected parcels.')).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(writes[0]).toMatchObject({body:{name:'Mumbai evening',destination_key:'MUMBAI',planning_entry_ids:[]}});
});

it.each(['empty','failed'] as const)('schedules a route without lots when saved data is %s',async state=>{
 const writes=mount('routes',state);
 if(state==='failed')await screen.findByRole('alert');else await screen.findByText('No routes yet');
 fireEvent.click(screen.getByRole('button',{name:'Plan Route'}));
 const dialog=within(screen.getByRole('dialog',{name:'Plan dispatch route'}));
 fireEvent.change(dialog.getByRole('textbox',{name:'From'}),{target:{value:'Ahmedabad'}});
 fireEvent.change(dialog.getByRole('textbox',{name:'Destination city'}),{target:{value:'Mumbai'}});
 fireEvent.click(dialog.getByRole('button',{name:'Schedule route'}));
 expect(await screen.findByText(/Route .* scheduled\./)).toBeVisible();
 expect(writes).toHaveLength(1);
 expect(writes[0]).toMatchObject({body:{origin:'Ahmedabad',destination:'Mumbai'}});
});

it.each(['lots','routes'] as const)('opens the %s editor while initial data is still loading',area=>{
 mount(area,'loading');
 fireEvent.click(screen.getByRole('button',{name:area==='lots'?'Create Lot':'Plan Route'}));
 const dialog=within(screen.getByRole('dialog'));
 expect(dialog.getByRole('textbox',{name:'Destination city'})).toBeEnabled();
 fireEvent.change(dialog.getByRole('textbox',{name:'Destination city'}),{target:{value:'Pune'}});
 expect(dialog.getByRole('textbox',{name:'Destination city'})).toHaveValue('Pune');
});

it.each(['lots','routes'] as const)('keeps %s creation unavailable to read-only users',async area=>{
 mount(area,'empty',true);
 await screen.findByText(area==='lots'?'No lots yet':'No routes yet');
 expect(screen.queryByRole('button',{name:area==='lots'?'Create Lot':'Plan Route'})).not.toBeInTheDocument();
});
