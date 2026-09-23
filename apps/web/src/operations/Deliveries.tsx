import React,{useMemo,useState} from 'react';
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

const has=(roles:readonly OperatorRole[],role:OperatorRole)=>roles.includes(role);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export default function Deliveries({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>deliveries(api),[api]);
 const queue=useResource('delivery-queue',signal=>source.list(signal),value=>value.items.length===0),[selected,setSelected]=useState<string|null>(null);
 if(queue.phase==='loading')return <Loading label="Loading assigned delivery work…"/>;
 if(queue.phase==='error')return <Failure retry={queue.reload} label="Delivery work could not be loaded."/>;
 if(queue.phase==='empty')return <Empty icon="local_shipping" title="No active deliveries" body="Only current assignments in this franchise appear here."/>;
 return <div className="ops-page"><section className="card ops-card"><div className="u-between"><div><h1 className="t-headline-sm">Delivery work</h1><p className="ops-note">Server-authorized active attempts only. Challenge values are never displayed.</p></div><button className="btn btn-outlined" onClick={queue.reload}><Msym name="refresh"/>Refresh</button></div>
  <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Docket</th><th>Attempt</th><th>Expires</th><th></th></tr></thead><tbody>{queue.value!.items.map(item=><tr key={item.attempt_id}><td className="ops-mono">{item.docket}</td><td>{item.attempt_number} of 2</td><td>{formatKolkata(item.expires_at)}</td><td><button className="btn btn-text" onClick={()=>setSelected(item.parcel_id)}>Open</button></td></tr>)}</tbody></table></div></section>
  {selected&&<DeliveryDetail key={selected} parcelId={selected} roles={roles} source={source} close={()=>setSelected(null)} refreshQueue={queue.reload}/>}</div>;
}

function DeliveryDetail({parcelId,roles,source,close,refreshQueue}:{parcelId:string;roles:readonly OperatorRole[];source:ReturnType<typeof deliveries>;close:()=>void;refreshQueue:()=>void}){
 const detail=useResource(parcelId,signal=>source.read(parcelId,signal));
 if(detail.phase==='loading')return <Loading label="Loading current delivery state…"/>;
 if(detail.phase==='error')return <Failure retry={detail.reload} label="Delivery state is no longer available."/>;
 const current=detail.value!,refresh=()=>{detail.reload();refreshQueue();};
 return <section className="card ops-card ops-detail" aria-labelledby="delivery-detail-title"><div className="u-between"><div><h2 id="delivery-detail-title" className="t-headline-sm">{current.docket}</h2><span className="ops-pill">{current.status.replaceAll('_',' ')}</span></div><button className="btn btn-text" onClick={close}>Close detail</button></div>
  <div className="ops-facts"><Fact label="Physical attempt" value={`${current.attempt_number} of 2`}/><Fact label="Expires" value={formatKolkata(current.expires_at)}/><Fact label="Proof attempts left" value={current.verification_attempts_remaining}/><Fact label="Resends left" value={current.resends_remaining}/></div>
  <p role="status" aria-live="polite">Send state: {current.send_state.replaceAll('_',' ')} · {current.send_reason.replaceAll('_',' ')}</p>
  {has(roles,'delivery_agent')&&<AgentActions current={current} source={source} confirmed={refresh}/>} {has(roles,'franchise_admin')&&current.exception?.state==='pending'&&<Approval current={current} source={source} confirmed={refresh}/>} </section>;
}
function Fact({label,value}:{label:string;value:React.ReactNode}){return <div className="ops-fact"><span className="ops-note">{label}</span><b>{value}</b></div>}

function AgentActions({current,source,confirmed}:{current:DeliveryState;source:ReturnType<typeof deliveries>;confirmed:()=>void}){
 const [proof,setProof]=useState(''),[evidence,setEvidence]=useState(''),[reason,setReason]=useState<ExceptionalReason>('recipient_channel_unavailable');
 const complete=useCommand(value=>source.execute(value)),resend=useCommand(value=>source.execute(value)),exception=useCommand(value=>source.execute(value)),exceptional=useCommand(value=>source.execute(value));
 async function run(command:Parameters<typeof source.intent>[0],clearProof=false){try{const result=await (command.kind==='complete'?complete:command.kind==='exception_request'?exception:command.kind==='exception_complete'?exceptional:resend).run(source.intent(command));if(clearProof)setProof('');if('outcome' in result)return;confirmed();}catch(error){if(clearProof&&error instanceof ApiFailure&&['DELIVERY_CHALLENGE_EXPIRED','DELIVERY_CHALLENGE_LOCKED','DELIVERY_PROOF_INVALID'].includes(error.code))setProof('');}}
 const cooldown=Date.now()<Date.parse(current.resend_available_at),active=['pending','active'].includes(current.status);
 return <><section><h3>Recipient proof</h3><form className="ops-form" onSubmit={event=>{event.preventDefault();void run({kind:'complete',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref,challenge_version:current.challenge_version,proof}},true);}}><TextField label="6-digit recipient code" value={proof} onChange={setProof} inputMode="numeric" autoComplete="one-time-code" required/><button className="btn btn-filled" disabled={!/^\d{6}$/.test(proof)||complete.phase==='pending'||!active}>Verify and complete delivery</button></form><CommandNotice phase={complete.phase} code={complete.error?.code}/>{complete.result&&'outcome' in complete.result&&<p className="ops-alert" role="alert">Proof not accepted. {complete.result.remaining_attempts} attempts remain.</p>}</section>
 <section><h3>Challenge recovery</h3><div className="ops-actions"><button className="btn btn-outlined" disabled={cooldown||current.resends_remaining===0||resend.phase==='pending'||!active} onClick={()=>{void run({kind:'resend',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref}});}}>Resend same code</button>{current.status==='expired'&&<button className="btn btn-outlined" disabled={current.resends_remaining===0||resend.phase==='pending'} onClick={()=>{void run({kind:'replace',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref,reason_code:'expired'}});}}>Replace expired challenge</button>}</div><p className="ops-note">Resend available {formatKolkata(current.resend_available_at)}. A resend does not extend expiry or reset proof attempts.</p><CommandNotice phase={resend.phase} code={resend.error?.code}/></section>
 <section><h3>Exceptional proof</h3>{current.exception?.state==='approved'&&current.exception.approval_ref?<button className="btn btn-filled" disabled={exceptional.phase==='pending'} onClick={()=>{void run({kind:'exception_complete',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,approval_ref:current.exception!.approval_ref!}});}}>Complete with approved exception</button>:<form className="ops-form" onSubmit={event=>{event.preventDefault();void run({kind:'exception_request',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,reason_code:reason,evidence_id:evidence,recipient_present:true}});}}><SelectField label="Exceptional reason" value={reason} onChange={value=>setReason(value as ExceptionalReason)} options={['recipient_channel_unavailable','provider_unavailable','challenge_locked_reviewed'].map(value=>({value,label:value.replaceAll('_',' ')}))}/><TextField label="Protected evidence ID (UUID)" value={evidence} onChange={setEvidence} required/><button className="btn btn-outlined" disabled={!uuid.test(evidence)||exception.phase==='pending'}>Request independent approval</button></form>}<CommandNotice phase={exception.phase} code={exception.error?.code}/><CommandNotice phase={exceptional.phase} code={exceptional.error?.code}/></section></>;
}

function Approval({current,source,confirmed}:{current:DeliveryState;source:ReturnType<typeof deliveries>;confirmed:()=>void}){
 const approve=useCommand(value=>source.execute(value));async function run(){try{await approve.run(source.intent({kind:'exception_approve',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,request_id:current.exception!.request_id}}));confirmed();}catch{/* safe notice */}}
 return <section><h3>Independent exception review</h3><p>Reason: {current.exception!.reason_code.replaceAll('_',' ')}</p><button className="btn btn-filled" disabled={approve.phase==='pending'} onClick={()=>{void run();}}>Approve exceptional proof</button><CommandNotice phase={approve.phase} code={approve.error?.code}/></section>;
}
