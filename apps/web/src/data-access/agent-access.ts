import {array,choice,instant,integer,object,protocol,text,uuid} from './dto';
import type {ScopedApi} from './scoped-api';
const roles=choice('org_admin','franchise_admin','operator','dispatcher','delivery_agent','accountant','read_only');
const member=object({id:uuid,user_id:uuid,organization_id:uuid,role:roles,lifecycle:choice('active','revoked'),version:integer(1),franchise_ids:array(uuid,100)});
const invite=object({id:uuid,invitee_user_id:uuid,organization_id:uuid,role:roles,state:choice('pending','accepted','revoked','expired'),version:integer(1),franchise_ids:array(uuid,100),expires_at:instant});
export type AgentAccessMember=ReturnType<typeof member>;
export type AgentAccessInvitation=ReturnType<typeof invite>;
export type AgentAccessRequest={kind:'invite';user_id:string}|{kind:'revoke_member';member:AgentAccessMember}|{kind:'revoke_invitation';invitation:AgentAccessInvitation};
export function agentAccess(api:ScopedApi){
 const own=(value:{organization_id:string;role:string;franchise_ids:string[]})=>value.organization_id===api.organization&&value.role==='delivery_agent'&&value.franchise_ids.length===1&&value.franchise_ids[0]===api.franchise;
 const members=(value:unknown)=>{const r=object({items:array(member,10000)})(value);if(r.items.some(i=>i.organization_id!==api.organization))return protocol();return r.items.filter(own);};
 const invitations=(value:unknown)=>{const r=object({items:array(invite,10000)})(value);if(r.items.some(i=>i.organization_id!==api.organization))return protocol();return r.items.filter(own);};
 return {
  members:(signal?:AbortSignal)=>api.read('/api/v1/organizations/'+api.organization+'/memberships',members,signal),
  invitations:(signal?:AbortSignal)=>api.read('/api/v1/organizations/'+api.organization+'/invitations',invitations,signal),
  async apply(request:AgentAccessRequest){
   // Existing membership commands use versions and conflict constraints, not server idempotency.
   // A lost response is reconciled by reading current memberships/invitations before retry.
   if(request.kind==='invite'){
    const user=uuid(request.user_id),intent=api.intent('agent-access.invite','/api/v1/membership-invitations',{organization_id:api.organization,invitee_user_id:user,role:'delivery_agent',franchise_ids:[api.franchise]});
    return api.execute(intent,value=>{const result=object({invitation:invite,token:text})({invitation:value,token:(value as {acceptance_token?:unknown})?.acceptance_token});if(!own(result.invitation)||result.invitation.invitee_user_id!==user||result.invitation.state!=='pending'||! /^[A-Za-z0-9_-]{43}$/.test(result.token))return protocol();return {token:result.token};});
   }
   const record=request.kind==='revoke_member'?request.member:request.invitation;if(!own(record))return protocol();
   const path=request.kind==='revoke_member'?'/api/v1/memberships/':'/api/v1/membership-invitations/';
   const intent=api.intent('agent-access.'+request.kind,path+uuid(record.id)+'/revoke',{expected_version:integer(1)(record.version)});
   await api.execute(intent,object({ok:choice(true)}));return {token:null};
  }
 };
}
