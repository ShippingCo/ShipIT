import {CodeField} from '../components/m3/CodeField';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {useDetailReturn} from './detail-return';
import {PageHeader,RecordTable,SectionHeader,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import {Link} from 'react-router-dom';
import React,{useEffect,useMemo,useState} from 'react';
import type { OperatorRole } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { deliveries,type DeliveryState,type ExceptionalReason } from '../data-access/deliveries';
import { useCommand,useResource } from './hooks';
import { CommandNotice,Empty,Failure,Loading } from './AsyncState';
import { formatKolkata } from './format';
import { TextField,SelectField } from '../components/m3/Input';
import { Msym } from '../components/m3/Icon';
import { ApiFailure } from '../data-access/errors';

const challengeTones={pending:'warning',active:'info',expired:'warning',locked:'danger',consumed:'success',superseded:'neutral',closed:'neutral'} as const;
const has=(roles:readonly OperatorRole[],role:OperatorRole)=>roles.includes(role);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export default function Deliveries({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>deliveries(api),[api]);
 const paymentHelp=<section className="card ops-card logistics-help"><h2>Payment collected at delivery</h2><p>Delivery and payment are separate. Record received money against the correct bill and receiving agent. If the money is already recorded, use a cash handover; do not record a second customer payment.</p>{(canAdminister(roles,'money_receipts.record')||roles.includes('operator'))&&<Link className="btn btn-outlined" to="/business/money-receipts">Record collected To-Pay payment</Link>}{roles.includes('delivery_agent')&&<Link className="btn btn-outlined" to="/business/agent-settlements">Open my cash handovers and daily statement</Link>}</section>;
 const queue=useResource('delivery-queue',signal=>source.list(signal),value=>value.items.length===0),[selected,setSelected]=useState<string|null>(null);
 const [locked,setLocked]=useState(false);
 const remember=useDetailReturn(selected);
 useEffect(()=>locked?retainAccountNavigation(api.scope,()=>document.getElementById('delivery-retry-note')?.focus()):undefined,[api.scope,locked]);
 return <div className="ops-page logistics-workspace"><PageHeader title="Delivery work" eyebrow="Last-mile operations" description="Open an assigned parcel and record the delivery outcome." actions={<button className="btn btn-outlined" disabled={locked} onClick={queue.reload}><Msym name="refresh"/>Refresh</button>}/>
  {queue.phase==='loading'?<Loading label="Loading assigned delivery work…"/>:queue.phase==='error'?<Failure retry={queue.reload} label="Delivery work could not be loaded."/>:queue.phase==='empty'?<Empty icon="local_shipping" title="No active deliveries" body="Assigned deliveries appear here when they are ready to attempt. Check the branch, then refresh after an assignment is made."/>:<section className="card ops-card logistics-records"><SectionHeader title="Active attempts" description="Recipient proof is required to complete a delivery."/><RecordTable mobile="stack" label="Delivery work" rows={queue.value!.items} rowKey={item=>item.attempt_id} selectedKey={queue.value!.items.find(item=>item.parcel_id===selected)?.attempt_id} columns={[
   {key:'docket',label:'Tracking number',cell:item=><strong className="ops-mono">{item.docket}</strong>},
   {key:'attempt',label:'Attempt',align:'right',cell:item=>item.attempt_number+' of 2'},
   {key:'expires',label:'Code expiry',cell:item=>item.proof_channel_available===false?'No code':formatKolkata(item.expires_at)},
   {key:'actions',label:'Actions',className:'record-actions',cell:item=><button className="btn btn-text" disabled={locked} onClick={()=>{remember();setSelected(item.parcel_id);}}>Open</button>},
  ]}/></section>}
  {locked&&<p id="delivery-retry-note" tabIndex={-1} role="status">Keep this delivery open until the current action is confirmed.</p>}
  {selected&&queue.phase==='ready'&&<DeliveryDetail locked={locked} setLocked={setLocked} key={selected} parcelId={selected} roles={roles} source={source} close={()=>setSelected(null)} refreshQueue={queue.reload}/>}
  {paymentHelp}</div>;
}

function DeliveryDetail({parcelId,roles,source,close,refreshQueue,locked,setLocked}:{locked:boolean;setLocked:(v:boolean)=>void;parcelId:string;roles:readonly OperatorRole[];source:ReturnType<typeof deliveries>;close:()=>void;refreshQueue:()=>void}){
 const detail=useResource(parcelId,signal=>source.read(parcelId,signal));
 useEffect(()=>{if(detail.phase==='ready')document.getElementById('delivery-detail-title')?.focus();},[detail.phase]);
 if(detail.phase==='loading')return <Loading label="Loading current delivery state…"/>;
 if(detail.phase==='error')return <Failure retry={detail.reload} label="Delivery state is no longer available."/>;
 const current=detail.value!,hasPhone=current.proof_channel_available!==false,refresh=()=>{detail.reload();refreshQueue();};
 return <section className="card ops-card ops-detail logistics-selected" aria-labelledby="delivery-detail-title"><div className="u-between"><div><h2 id="delivery-detail-title" tabIndex={-1} className="t-headline-sm">{current.docket}</h2><StatusBadge tone={challengeTones[current.status]}>{current.status.replaceAll('_',' ')}</StatusBadge></div><button className="btn btn-text" disabled={locked} onClick={close}>Close detail</button></div>
  <section className="dispatch-summary" aria-label="Delivery attempt"><div><span>Physical attempt</span><strong>{current.attempt_number} of 2</strong></div>{hasPhone&&<div><span>Code expires</span><strong>{formatKolkata(current.expires_at)}</strong></div>}</section>
  {hasPhone&&<div className="delivery-code-limits"><Fact label="Proof attempts left" value={current.verification_attempts_remaining}/><Fact label="Resends left" value={current.resends_remaining}/></div>}
  <p role="status" aria-live="polite">{hasPhone?'Send state: '+current.send_state.replaceAll('_',' ')+' · '+current.send_reason.replaceAll('_',' '):'No receiver phone was provided. A delivery code cannot be sent.'}</p>
  {has(roles,'delivery_agent')&&<AgentActions locked={locked} setLocked={setLocked} current={current} source={source} confirmed={refresh}/>} {canAdminister(roles,'deliveries.exception.approve')&&current.exception?.state==='pending'&&<Approval locked={locked} setLocked={setLocked} current={current} source={source} confirmed={refresh}/>} </section>;
}
function Fact({label,value}:{label:string;value:React.ReactNode}){return <div className="ops-fact"><span className="ops-note">{label}</span><b>{value}</b></div>}

type ActionProps = {current:DeliveryState;source:ReturnType<typeof deliveries>;confirmed:()=>void;locked:boolean;setLocked:(value:boolean)=>void};

function AgentActions({current,source,confirmed,locked,setLocked}:ActionProps){
 const [proof,setProof]=useState(''),[evidence,setEvidence]=useState(''),[reason,setReason]=useState<ExceptionalReason>('recipient_channel_unavailable');
 const [present,setPresent]=useState(false);
 const command=useCommand(value=>source.execute(value));
 const pending=command.phase==='pending'||command.phase==='uncertain';
 useEffect(()=>{setLocked(pending);return()=>setLocked(false);},[pending,setLocked]);
 const cooldown=Date.now()<Date.parse(current.resend_available_at);
 const active=['pending','active'].includes(current.status);
 async function send(action?:Parameters<typeof source.intent>[0]){
  if(action&&(locked||pending))return;
  try{
   const result=action?await command.run(source.intent(action)):await command.retry();
   if(!result)return;
   setProof('');
   if(!('outcome' in result))confirmed();
  }catch(error){
   if(error instanceof ApiFailure&&['DELIVERY_CHALLENGE_EXPIRED','DELIVERY_CHALLENGE_LOCKED','DELIVERY_PROOF_INVALID'].includes(error.code))setProof('');
  }
 }
 return <>
  {current.proof_channel_available!==false&&<><section><h3>Recipient proof</h3>
   <form className="ops-form" onSubmit={event=>{event.preventDefault();if(active&&/^\d{6}$/.test(proof))void send({kind:'complete',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref,challenge_version:current.challenge_version,proof}});}}>
    <CodeField label="6-digit recipient code" digits={6} value={proof} onChange={setProof} disabled={locked||pending||!active} required/>
    <button className="btn btn-filled" disabled={!/^\d{6}$/.test(proof)||locked||pending||!active}>Verify and complete delivery</button>
   </form>
   {command.result&&'outcome' in command.result&&<p className="ops-alert" role="alert">Proof not accepted. {command.result.remaining_attempts} attempts remain.</p>}
  </section>
  <details className="logistics-secondary" open={!active}><summary>Customer did not receive the code?</summary>
   <div className="ops-actions">
    <button className="btn btn-outlined" disabled={locked||pending||cooldown||current.resends_remaining===0||!active} onClick={()=>void send({kind:'resend',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref}})}>Resend same code</button>
    {current.status==='expired'&&<button className="btn btn-outlined" disabled={locked||pending||current.resends_remaining===0} onClick={()=>void send({kind:'replace',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref,reason_code:'expired'}})}>Replace expired challenge</button>}
   </div><p className="ops-note">Resend available {formatKolkata(current.resend_available_at)}. A resend keeps the same expiry and number of proof attempts.</p>
  </details>
  </>}
  <details className="logistics-secondary" open={Boolean(current.exception)||current.proof_channel_available===false}><summary>Delivery needs an exception</summary>
   {current.exception?.state==='approved'&&current.exception.approval_ref?
    <button className="btn btn-filled" disabled={locked||pending} onClick={()=>void send({kind:'exception_complete',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,approval_ref:current.exception!.approval_ref!}})}>Complete with approved exception</button>:
    <form className="ops-form" onSubmit={event=>{event.preventDefault();if(present&&uuid.test(evidence))void send({kind:'exception_request',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,reason_code:reason,evidence_id:evidence,recipient_present:present as true}});}}>
     <fieldset disabled={locked||pending}><legend>Request a review</legend>
      <SelectField label="Exceptional reason" value={reason} onChange={value=>setReason(value as ExceptionalReason)} options={[{value:'recipient_channel_unavailable',label:'Recipient cannot receive the code'},{value:'provider_unavailable',label:'Message provider is unavailable'},{value:'challenge_locked_reviewed',label:'Locked code has been reviewed'}]}/>
      <TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label="Protected evidence ID (UUID)" helper="Use the reference for evidence recorded for this attempt." value={evidence} onChange={setEvidence} required/>
      <label><input type="checkbox" checked={present} onChange={event=>setPresent(event.target.checked)}/> The recipient is here with me</label>
      <button className="btn btn-outlined" disabled={!uuid.test(evidence)||!present}>Request independent approval</button>
     </fieldset>
    </form>}
  </details>
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>void send():undefined}/>
 </>;
}

function Approval({current,source,confirmed,locked,setLocked}:ActionProps){
 const approve=useCommand(value=>source.execute(value));
 const pending=approve.phase==='pending'||approve.phase==='uncertain';
 useEffect(()=>{setLocked(pending);return()=>setLocked(false);},[pending,setLocked]);
 async function submit(retry=false){
  if(!retry&&(locked||pending))return;
  try{
   if(retry)await approve.retry();
   else await approve.run(source.intent({kind:'exception_approve',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,request_id:current.exception!.request_id}}));
   confirmed();
  }catch{/* Preserve the command for its retry control. */}
 }
 return <section><h3>Independent exception review</h3><p>Reason: {current.exception!.reason_code.replaceAll('_',' ')}</p>
  <button className="btn btn-filled" disabled={locked||pending} onClick={()=>void submit()}>Approve exceptional proof</button>
  <CommandNotice phase={approve.phase} code={approve.error?.code} retry={approve.canRetry?()=>void submit(true):undefined}/>
 </section>;
}
