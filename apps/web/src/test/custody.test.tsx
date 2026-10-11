import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import type {OperatorRole} from '@shippingco/shared';
import Custody from '../operations/Custody';
import {createScopeController} from '../operator/scope';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const user=id(1),org=id(2),franchise=id(3),manifestId=id(4),parcel=id(5),receipt=id(6),time='2026-10-11T00:00:00.000Z';
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture(agent=user,lose=false){let acknowledged=false,lost=false;const writes:{body:unknown;key:string}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  const url=new URL(path,'https://synthetic.example.test');if(url.pathname==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});
  if(options.method==='POST'){writes.push({body:options.body,key:(options.headers as Record<string,string>)['Idempotency-Key']});acknowledged=true;if(lose&&!lost){lost=true;throw new TypeError('Synthetic lost response');}return json({command_id:id(8),resource_id:manifestId,receipt_ids:[receipt],recorded_at:time});}
  const state=acknowledged?'acknowledged':'prepared';
  if(url.pathname.endsWith('/transfer-grants'))return json({items:[],next_cursor:null});
  if(url.pathname.endsWith('/worklist'))return json({as_of:time,next_cursor:null,items:[{parcel_id:parcel,docket:'SYN-PARCEL',parcel_version:5,status:'out_for_delivery',assigned_agent_id:agent,attempt_id:id(9),receipt_id:acknowledged?receipt:null,physical_custody:acknowledged?'agent':'unknown',proof_id:null}]});
  if(url.pathname.endsWith('/manifests'))return json({next_cursor:null,items:[{id:manifestId,agent_id:agent,recorded_at:time,item_count:1,state}]});
  if(url.pathname.endsWith('/report'))return json({manifest_id:manifestId,agent_id:agent,as_of:time,totals:{total:1,delivered:0,returned:0,held:acknowledged?1:0,reassigned:0,pending:acknowledged?0:1,failed:0},failure_count:0,items:[{item_id:id(7),parcel_id:parcel,outcome:acknowledged?'held':'pending',origin_receipt_id:acknowledged?receipt:null,current_receipt_id:acknowledged?receipt:null,proof_id:null,failure_ids:[],private_contact:'DO_NOT_RENDER'}]});
  return json({id:manifestId,agent_id:agent,recorded_at:time,state,version:acknowledged?2:1,items:[{id:id(7),parcel_id:parcel,expected_parcel_version:5,previous_receipt_id:null,receipt_id:acknowledged?receipt:null}]});
 }));return writes;
}
function view(roles:OperatorRole[]){const c=createScopeController();c.runtime.bind({userId:user,organizationId:org,franchiseId:franchise,permissions:JSON.stringify(roles)});render(<><a href="/business">Workspace link</a><select aria-label="Franchise"><option value={franchise}>First</option><option value={id(30)}>Second</option></select><Custody controller={c} roles={roles}/></>);return c;}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('custody evidence and named receipt recovery',()=>{
 it('retains exact acknowledgement after a lost response and blocks replacement navigation',async()=>{
  const writes=fixture(user,true);view(['delivery_agent']);fireEvent.click(await screen.findByRole('button',{name:'View handover'}));
  fireEvent.click(await screen.findByRole('button',{name:'Confirm I received every listed parcel'}));
  const retry=await screen.findByRole('button',{name:'Retry same request'});expect(writes).toHaveLength(1);
  expect(fireEvent.click(screen.getByRole('link',{name:'Workspace link'}))).toBe(false);
  fireEvent.change(screen.getByRole('combobox',{name:'Franchise'}),{target:{value:id(30)}});expect(screen.getByRole('combobox',{name:'Franchise'})).toHaveValue(franchise);
  fireEvent.click(retry);await screen.findByText('Server update confirmed.');expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(JSON.parse(String(writes[0]!.body))).toEqual({expected_version:1});
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Confirm I received every listed parcel'})).not.toBeInTheDocument());expect(screen.queryByText(/DO_NOT_RENDER/)).not.toBeInTheDocument();
 });
 it('does not offer acknowledgement for another agent or export to readers, and purges private evidence on scope loss',async()=>{
  fixture(id(20));const c=view(['delivery_agent']);fireEvent.click(await screen.findByRole('button',{name:'View handover'}));await screen.findByText(/Evidence as of/);
  expect(screen.queryByRole('button',{name:'Confirm I received every listed parcel'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Capture private custody report'})).not.toBeInTheDocument();
  act(()=>c.clear());expect(screen.queryByText('SYN-PARCEL')).not.toBeInTheDocument();expect(screen.getByRole('heading',{name:'Parcel custody unavailable'})).toBeInTheDocument();
 });
});
