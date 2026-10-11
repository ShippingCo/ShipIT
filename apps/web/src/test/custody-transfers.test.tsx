import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import CustodyTransfers from '../operations/CustodyTransfers';
import {custody,custodyTransfers} from '../data-access/custody';
import {scopedApi} from '../data-access/scoped-api';
import {createScopeController} from '../operator/scope';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const grant={id:id(1),parcel_id:id(2),source_receipt_id:id(3),agent_id:id(4),destination_kind:'agent' as const,destination_agent_id:id(5),parcel_version:7,assigned_agent_id:id(4),can_prepare:true,instruction_id:id(6),office_release_id:null};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function fixture(wrongGrant=false){vi.stubGlobal('fetch',vi.fn(async(path:string)=>{
 if(new URL(path,'https://synthetic.example.test').pathname.endsWith('/manifests'))return json({grant_id:wrongGrant?id(50):grant.id,items:[{id:id(7),agent_id:grant.destination_agent_id,released:false,private_phone:'DO_NOT_RENDER'}],next_cursor:null});
 return json({items:[{...grant,private_phone:'DO_NOT_RENDER'}],next_cursor:null});
 }));const c=createScopeController();c.runtime.bind({userId:grant.agent_id,organizationId:id(10),franchiseId:id(11),permissions:'delivery_agent'});return custody(scopedApi(c));}
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('approved outgoing custody discovery',()=>{
 it('prepares and releases exact source evidence without manually entering approval, instruction or manifest references',async()=>{
  const source=fixture(),submit=vi.fn();render(<CustodyTransfers source={source} user={grant.agent_id} roles={['delivery_agent']} revision={0} locked={false} submit={submit}/>);
  fireEvent.click(await screen.findByRole('button',{name:'View approved transfer '+grant.id.slice(0,8)}));
  fireEvent.click(await screen.findByRole('button',{name:'Prepare handover under this approval'}));expect(submit).toHaveBeenCalledWith({kind:'prepare',body:{agent_id:grant.destination_agent_id,items:[{parcel_id:grant.parcel_id,expected_parcel_version:7,previous_receipt_id:grant.source_receipt_id,instruction_id:grant.instruction_id,grant_id:grant.id}]}});
  fireEvent.click(await screen.findByRole('button',{name:'Confirm parcel release for '+id(7).slice(0,8)}));expect(submit).toHaveBeenLastCalledWith({kind:'release',body:{parcel_id:grant.parcel_id,source_receipt_id:grant.source_receipt_id,grant_id:grant.id,manifest_id:id(7)}});
  expect(screen.queryByText(/DO_NOT_RENDER/)).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Revoke this transfer approval'})).not.toBeInTheDocument();
 });
 it('rejects a mismatched named approval and does not offer giver controls to another account',async()=>{
  const source=fixture(true);render(<CustodyTransfers source={source} user={id(40)} roles={['delivery_agent']} revision={0} locked={false} submit={vi.fn()}/>);fireEvent.click(await screen.findByRole('button',{name:'View approved transfer '+grant.id.slice(0,8)}));
  await screen.findByText(/Outgoing manifests unavailable/);expect(screen.queryByRole('button',{name:'Prepare handover under this approval'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:/Confirm parcel release/})).not.toBeInTheDocument();
 });
 it('rejects false preparation claims and office-grant destination/proof contradictions before display',()=>{
  const source={items:[grant],next_cursor:null};expect(custodyTransfers(source)).toEqual(source);
  for(const bad of [{...grant,instruction_id:null},{...grant,destination_kind:'office'},{...grant,office_release_id:id(8)},{...grant,destination_agent_id:grant.agent_id}])expect(()=>custodyTransfers({...source,items:[bad]})).toThrow();
 });
});
