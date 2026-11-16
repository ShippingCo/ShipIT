import {RecordTable,SectionHeader,StatusBadge} from '../components/workspace/Workspace';
import {formatKolkata} from './format';
import React,{useEffect,useMemo,useState} from 'react';
import {Dialog} from '../components/m3/Dialog';
import {retainAccountNavigation} from '../data-access/account-navigation';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {agentAccess,type AgentAccessRequest} from '../data-access/agent-access';
import {ApiFailure,recoveryFor} from '../data-access/errors';
import {TextField} from '../components/m3/Input';
import {useResource} from './hooks';
import {DataRefresh,Loading,Failure} from './AsyncState';
export default function AgentAccess({controller,changed}:{controller:ScopeController;changed:()=>void}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>agentAccess(api),[api]),[revision,setRevision]=useState(0),[user,setUser]=useState(''),[token,setToken]=useState<string|null>(null),[phase,setPhase]=useState<'idle'|'pending'|'uncertain'>('idle'),[request,setRequest]=useState<AgentAccessRequest|null>(null),[notice,setNotice]=useState('');
 const current=useResource('access-'+revision,async signal=>({members:await source.members(signal),invitations:await source.invitations(signal)}));
 const locked=phase!=='idle';
 const [revocation,setRevocation]=useState<Extract<AgentAccessRequest,{kind:'revoke_member'|'revoke_invitation'}>|null>(null);
 useEffect(()=>locked?retainAccountNavigation(api.scope,()=>setNotice('Reconcile this access request before leaving.')):undefined,[locked,api.scope]);
 useEffect(()=>{const leave=(e:BeforeUnloadEvent)=>{if(locked){e.preventDefault();e.returnValue='';}},navigation=(e:MouseEvent)=>{if(locked&&e.target instanceof Element&&e.target.closest('a[href]')){e.preventDefault();e.stopPropagation();setNotice('Reconcile this access request before leaving.');}},scope=(e:Event)=>{if(locked&&e.target instanceof Element&&e.target.matches('select[aria-label="Franchise"]')){e.stopPropagation();(e.target as HTMLSelectElement).value=api.franchise;setNotice('Reconcile this access request before changing franchise.');}};window.addEventListener('beforeunload',leave);document.addEventListener('click',navigation,true);document.addEventListener('change',scope,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigation,true);document.removeEventListener('change',scope,true);};},[locked,api.franchise]);
 async function run(value:AgentAccessRequest){if(locked)return;setRequest(value);setPhase('pending');setToken(null);setNotice('');try{const r=await source.apply(value);if(!controller.runtime.isCurrent(api.scope))return;setToken(r.token);setRequest(null);setPhase('idle');setRevision(v=>v+1);changed();setNotice(r.token?'Invitation recorded. The named verified account must accept it within seven days.':'Agent access revoked. Custody history remains available to its owners.');}catch(e){if(!controller.runtime.isCurrent(api.scope))return;const uncertain=e instanceof ApiFailure&&['uncertain','pending'].includes(recoveryFor(e,true));setPhase(uncertain?'uncertain':'idle');setNotice(uncertain?'We could not tell whether this saved. Check the current access list before sending it again.':'Not saved. Check the account you named and try again.');}}
 async function reconcile(){if(!request)return;setPhase('pending');try{const members=await source.members(),invitations=await source.invitations();if(!controller.runtime.isCurrent(api.scope))return;
  if(request.kind==='invite'){
   const recorded=invitations.some(i=>i.invitee_user_id===request.user_id&&i.state==='pending'),active=members.some(m=>m.user_id===request.user_id&&m.lifecycle==='active');
   setNotice(active?'Agent access is active.':recorded?'A pending invitation exists. Its one-time code cannot be recovered here. Revoke that invitation and create a replacement if the named account did not receive its code.':'No pending invitation or active access is recorded. Refresh before submitting again.');
  }else {const found=request.kind==='revoke_member'?members.find(m=>m.id===request.member.id):invitations.find(i=>i.id===request.invitation.id);if(!found)throw new Error('No visible reconciliation record');const revoked='lifecycle' in found?found.lifecycle==='revoked':found.state==='revoked'||found.state==='expired';setNotice(revoked?'Revocation confirmed by current server records.':'Access is still recorded. Refresh current evidence before submitting its current version again.');}
  setRequest(null);setPhase('idle');setRevision(v=>v+1);changed();
 }catch{if(controller.runtime.isCurrent(api.scope)){setPhase('uncertain');setNotice('Current access evidence is unavailable. Keep this request pending and check again.');}}}
 return <section className="card ops-card ops-detail"><SectionHeader title="Temporary agent access" description="Invite a verified account to this branch. They must accept before working as a delivery agent. Revoking access keeps parcel history; restoring access needs a new invitation."/>{notice&&<p role={phase==='uncertain'?'alert':'status'}>{notice}</p>}{phase==='pending'&&<p role="status">Checking access with the server…</p>}{phase==='uncertain'&&<button className="btn btn-outlined" onClick={()=>void reconcile()}>Check current access outcome</button>}
 <form className="ops-form" aria-label="Invite temporary agent" onSubmit={e=>{e.preventDefault();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(user)){setNotice('Enter the named agent’s valid verified account reference.');return;}void run({kind:'invite',user_id:user});}}><TextField label="Verified account reference" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} value={user} onChange={setUser} required disabled={locked}/><button className="btn btn-filled" disabled={locked||current.phase!=='ready'}>Create agent invitation</button></form>
 {token&&<div><p>Share this code securely with the named account. It appears only in this session.</p><TextField label="One-time agent invitation code" value={token} onChange={()=>{}} readOnly autoComplete="off"/><button className="btn btn-text" onClick={()=>setToken(null)}>Hide invitation code</button></div>}
 {current.phase==='loading'?<Loading/>:current.phase==='error'?<Failure retry={current.reload} label="Agent access records unavailable."/>:current.value&&<><SectionHeader level={3} title="Recorded memberships"/>
 <RecordTable mobile="stack" label="Agent memberships" rows={current.value.members} rowKey={m=>m.id} empty="No agent memberships recorded for this franchise." columns={[
  {key:'account',label:'Account',cell:m=><strong className="ops-mono logistics-reference">Account {m.user_id}</strong>},
  {key:'lifecycle',label:'Lifecycle',cell:m=><StatusBadge tone={m.lifecycle==='active'?'success':'neutral'}>{m.lifecycle}</StatusBadge>},
  {key:'actions',label:'Actions',className:'record-actions',cell:m=>m.lifecycle==='active'&&m.user_id!==api.scope.authority?.userId?<button className="btn btn-outlined" disabled={locked} onClick={()=>{setRevocation({kind:'revoke_member',member:m});}}>Revoke agent {m.user_id.slice(0,8)}</button>:<span className="ops-note">—</span>},
 ]}/>
 <SectionHeader level={3} title="Invitations"/>
 <RecordTable mobile="stack" label="Agent invitations" rows={current.value.invitations} rowKey={i=>i.id} empty="No agent invitations recorded for this franchise." columns={[
  {key:'account',label:'Account',cell:i=><strong className="ops-mono logistics-reference">Account {i.invitee_user_id}</strong>},
  {key:'state',label:'State',cell:i=><StatusBadge tone={i.state==='pending'?'warning':i.state==='accepted'?'info':'neutral'}>{i.state}</StatusBadge>},
  {key:'expiry',label:'Expires (IST)',cell:i=><time dateTime={i.expires_at} title={i.expires_at}>{formatKolkata(i.expires_at)} IST</time>},
  {key:'actions',label:'Actions',className:'record-actions',cell:i=>i.state==='pending'?<button className="btn btn-outlined" disabled={locked} onClick={()=>{setRevocation({kind:'revoke_invitation',invitation:i});}}>Revoke invitation {i.id.slice(0,8)}</button>:<span className="ops-note">—</span>},
 ]}/><DataRefresh disabled={locked} resource={{phase:'ready',reload:()=>{setToken(null);setRevision(v=>v+1);}}}/></>}
 <Dialog open={revocation!==null} onClose={()=>setRevocation(null)} title={revocation?.kind==='revoke_member'?'Revoke this agent’s access?':'Revoke this invitation?'} hideClose actions={<><button type="button" className="btn btn-outlined" onClick={()=>setRevocation(null)}>Keep access unchanged</button><button type="button" className="btn btn-danger" disabled={locked} onClick={()=>{if(revocation){const exact=revocation;setRevocation(null);void run(exact);}}}>{revocation?.kind==='revoke_member'?'Confirm revoke access':'Confirm revoke invitation'}</button></>}>
  <p>{revocation?.kind==='revoke_member'?'The agent will lose access to this branch. Parcel and custody history stays saved. To restore access, create a new invitation.':'The account will no longer be able to accept this invitation. Create a new invitation if access is needed later.'}</p>
  <p className="logistics-reference ops-mono">{revocation?.kind==='revoke_member'?revocation.member.user_id:revocation?.invitation.invitee_user_id}</p>
 </Dialog>
 </section>;
}
