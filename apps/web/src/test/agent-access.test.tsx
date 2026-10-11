import React from 'react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import AgentAccess from '../operations/AgentAccess';
import {agentAccess} from '../data-access/agent-access';
import {scopedApi} from '../data-access/scoped-api';
import {createScopeController} from '../operator/scope';
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const org=id(1),franchise=id(2),user=id(3),agent=id(4),inviteId=id(5),memberId=id(6),secret='S'.repeat(43);
const invitation={id:inviteId,invitee_user_id:agent,organization_id:org,role:'delivery_agent',state:'pending',version:1,franchise_ids:[franchise],expires_at:'2026-10-18T00:00:00.000Z'};
const membership={id:memberId,user_id:agent,organization_id:org,role:'delivery_agent',lifecycle:'active',version:3,franchise_ids:[franchise]};
const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
function controller(){const c=createScopeController();c.runtime.bind({userId:user,organizationId:org,franchiseId:franchise,permissions:'franchise_admin'});return c;}
function fixture(lose=false){let pending=false,revoked=false;const writes:{path:string;body:unknown}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path:string,options:RequestInit={})=>{
  if(path==='/auth/bootstrap')return json({csrf_token:'synthetic_csrf'});
  if(options.method==='POST'){writes.push({path,body:JSON.parse(String(options.body))});if(path==='/api/v1/membership-invitations'){pending=true;if(lose)throw new TypeError('Synthetic lost invitation response');return json({...invitation,acceptance_token:secret});}if(path.includes('/membership-invitations/')){pending=false;return json({ok:true});}revoked=true;return json({ok:true});}
  if(path.endsWith('/invitations'))return json({items:pending?[invitation]:[]});
  return json({items:[{...membership,lifecycle:revoked||lose?'revoked':'active'}, {...membership,id:id(20),user_id:id(21),franchise_ids:[franchise,id(22)],private_phone:'DO_NOT_RENDER'}]});
 }));return writes;
}
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('existing identity-bound agent access UI',()=>{
 it('creates only this franchise agent grant, exposes one-time code in memory and revokes exact current membership version',async()=>{
  const writes=fixture(),c=controller();render(<AgentAccess controller={c} changed={()=>{}}/>);await screen.findByRole('button',{name:'Revoke agent '+agent.slice(0,8)});
  expect(screen.queryByText(/DO_NOT_RENDER/)).not.toBeInTheDocument();expect(screen.queryByText(new RegExp(id(21)))).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Verified account reference'),{target:{value:agent}});fireEvent.submit(screen.getByRole('form',{name:'Invite temporary agent'}));
  expect(await screen.findByLabelText('One-time agent invitation code')).toHaveValue(secret);expect(writes[0]!.body).toEqual({organization_id:org,invitee_user_id:agent,role:'delivery_agent',franchise_ids:[franchise]});
  fireEvent.click(screen.getByRole('button',{name:'Hide invitation code'}));expect(screen.queryByLabelText('One-time agent invitation code')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button',{name:'Revoke agent '+agent.slice(0,8)}));await screen.findByText('Agent access revoked. Custody history remains available to its owners.');expect(writes[1]).toEqual({path:'/api/v1/memberships/'+memberId+'/revoke',body:{expected_version:3}});
 });
 it('reconciles lost invitation by read and offers revocation, never replaying its unrecoverable token command',async()=>{
  const writes=fixture(true),c=controller();render(<><a href="/business">Leave workspace</a><AgentAccess controller={c} changed={()=>{}}/></>);await waitFor(()=>expect(screen.getByRole('button',{name:'Create agent invitation'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Verified account reference'),{target:{value:agent}});fireEvent.submit(screen.getByRole('form',{name:'Invite temporary agent'}));
  const check=await screen.findByRole('button',{name:'Check current access outcome'});expect(fireEvent.click(screen.getByRole('link',{name:'Leave workspace'}))).toBe(false);fireEvent.click(check);await screen.findByText(/one-time code cannot be recovered/);expect(writes).toHaveLength(1);expect(screen.queryByLabelText('One-time agent invitation code')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button',{name:'Revoke invitation '+inviteId.slice(0,8)}));await waitFor(()=>expect(writes).toHaveLength(2));expect(writes[1]).toEqual({path:'/api/v1/membership-invitations/'+inviteId+'/revoke',body:{expected_version:1}});
 });
 it('rejects foreign tenant projections and never mutates a multiple-franchise grant through this screen',async()=>{
  fixture();const c=controller(),source=agentAccess(scopedApi(c));await expect(source.apply({kind:'revoke_member',member:{...membership,role:'delivery_agent',lifecycle:'active',franchise_ids:[franchise,id(22)]}})).rejects.toThrow();
  vi.stubGlobal('fetch',vi.fn(async()=>json({items:[{...membership,organization_id:id(40)}]})));await expect(source.members()).rejects.toThrow();
  act(()=>c.clear());await expect(source.invitations()).rejects.toThrow();
 });
});
