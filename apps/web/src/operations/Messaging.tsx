import React,{useMemo,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { OperatorRole } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { messaging,messageStates,automationStates,kinds,type HistoryView,type HistoryRow,type HistoryDetail,type MessagingSource } from '../data-access/messaging';
import { SelectField,TextField } from '../components/m3/Input';
import { useCommand,usePagedResource,useResource } from './hooks';
import { Loading,Failure,Empty,CommandNotice } from './AsyncState';

export const statusLabel:Record<string,string>={queued:'Waiting',retry_wait:'Waiting to retry',dispatching:'Sending',accepted:'Accepted by provider',delivered:'Delivered',read:'Read',suppressed:'Suppressed',failed:'Failed',uncertain:'Uncertain',blocked:'Blocked',skipped:'Skipped',pending:'Pending',running:'Processing',completed:'Processing completed'};
export const kindLabel:Record<string,string>={updates:'Shipment update',requested_assistance:'Requested assistance',consent_disclosure:'Consent information',delivery_otp:'Delivery verification message',booking_confirmation:'Booking confirmation',parcel_checked_in:'Parcel checked in',parcel_dispatched:'Parcel dispatched',route_departed:'Route departed',route_delayed:'Route delay update',route_arrived:'Route arrived',delivery_attempt_failed:'Delivery unsuccessful update',rto_approved:'Return initiated',delivery_completed:'Delivery completed',route_delay:'Route delay',route_delay_reminder:'Route delay reminder'};
const allowed=['org_admin','franchise_admin','operator','dispatcher'];
export default function Messaging({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const source=useMemo(()=>messaging(scopedApi(controller)),[controller]);
 const [view,setView]=useState<HistoryView>('messages'),[status,setStatus]=useState(''),[kind,setKind]=useState(''),[correlation,setCorrelation]=useState(''),[filterCorrelation,setFilterCorrelation]=useState('');
 if(!roles.some(role=>allowed.includes(role)))return <p role="alert">Messaging history is unavailable for this role.</p>;
 return <section aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm" tabIndex={-1}>Automation &amp; Messages</h1>
  <p className="ops-note">Durable notification evidence. Provider acceptance is separate from delivery. Message content is private and is not retained here.</p>
  <div className="card ops-card ops-form-grid"><SelectField aria-label="History view" label="History view" value={view} onChange={value=>{setView(value as HistoryView);setStatus('');setKind('');}} options={[{value:'messages',label:'Messages'},{value:'automation',label:'Automation'}]}/>
   <SelectField aria-label={view==='messages'?'Message status':'Automation outcome'} label={view==='messages'?'Message status':'Automation outcome'} value={status} onChange={setStatus} options={[{value:'',label:'All'},...(view==='messages'?messageStates:automationStates).map(value=>({value,label:statusLabel[value]}))]}/>
   <SelectField aria-label="Notification kind" label="Notification kind" value={kind} onChange={setKind} options={[{value:'',label:'All'},...kinds.map(value=>({value,label:kindLabel[value]}))]}/>
   <form onSubmit={e=>{e.preventDefault();setFilterCorrelation(correlation);}}><TextField label="Correlation reference (UUID)" value={correlation} onChange={setCorrelation} pattern="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/><button className="btn btn-text">Apply correlation</button></form>
  </div>
  <Feed key={`${view}:${status}:${kind}:${filterCorrelation}`} source={source} view={view} status={status} kind={kind} correlation={filterCorrelation} roles={roles}/>
 </section>;
}
function Feed({source,view,status,kind,correlation,roles}:{source:MessagingSource;view:HistoryView;status:string;kind:string;correlation:string;roles:readonly OperatorRole[]}) {
 const page=usePagedResource('history',(cursor,signal)=>source.list(view,{status,kind,correlation_id:correlation,cursor},signal));
 const [selected,setSelected]=useState<string|null>(null),trigger=useRef<HTMLButtonElement|null>(null),refresh=useRef<HTMLButtonElement|null>(null);
 return <><div className="ops-row-actions"><button ref={refresh} className="btn btn-outlined" onClick={page.reload}>Refresh history</button></div>
  {page.phase==='loading'?<Loading label="Loading messaging history…"/>:page.phase==='error'?<Failure retry={page.reload} label="Messaging history could not be loaded."/>:page.phase==='empty'?<Empty title="No matching history" body="No durable records match these filters."/>:
   <ul className="ops-list">{page.items.map(row=><li key={row.id} className="ops-row"><div className="ops-row-main"><b>{kindLabel[row.notification_kind]}</b><span>{view==='automation'&&row.decision?`Automation: ${statusLabel[row.decision.outcome]}`:row.row_kind==='fanout'?statusLabel[row.fanout!.state]:statusLabel[row.message!.state]}</span>{view==='automation'&&row.message&&<span>Message: {statusLabel[row.message.state]}</span>}<time className="ops-note" dateTime={row.effective_time}>{new Date(row.effective_time).toLocaleString()}</time>{row.row_kind==='fanout'&&<span>{row.fanout!.completed_count+row.fanout!.skipped_count+row.fanout!.failed_count} / {row.fanout!.total_count} decisions processed</span>}</div><button ref={button=>{if(button&&row.id===selected)trigger.current=button;}} className="btn btn-text" onClick={e=>{trigger.current=e.currentTarget;setSelected(row.id);}} aria-label={`Inspect ${kindLabel[row.notification_kind]}`}>Inspect</button></li>)}</ul>}
  {page.page.has_more&&page.phase!=='error'&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={page.loadMore}>{page.phase==='more'?'Loading…':'Load older history'}</button>}
  <Dialog.Root open={selected!==null} onOpenChange={open=>{if(!open)setSelected(null);}}><Dialog.Portal><Dialog.Overlay className="scrim"/><Dialog.Content className="dialog history-dialog" aria-describedby="history-description" onCloseAutoFocus={event=>{event.preventDefault();(trigger.current?.isConnected?trigger.current:refresh.current)?.focus();}}>
   <Dialog.Title className="t-title-lg">Notification evidence</Dialog.Title><Dialog.Description id="history-description">Current server status and safe references. Message bodies and verification codes are never shown.</Dialog.Description>
   {selected&&<Detail key={selected} source={source} view={view} id={selected} roles={roles} changed={page.reload}/>}
   <Dialog.Close className="btn btn-text">Close</Dialog.Close>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </>;
}
function Detail({source,view,id,roles,changed}:{source:MessagingSource;view:HistoryView;id:string;roles:readonly OperatorRole[];changed:()=>void}) {
 const detail=useResource(id,signal=>source.detail(view,id,signal));
 const command=useCommand(source.execute),[confirm,setConfirm]=useState<HistoryDetail|null>(null),[preparing,setPreparing]=useState(false),[error,setError]=useState('');
 const confirmed=()=>{setConfirm(null);detail.reload();changed();};
 async function prepare(action:'redrive'|'reminder') {
  setPreparing(true);setError('');
  try {
   const fresh=await source.detail(view,id);
   if(action==='redrive') {
    if(fresh.recovery.kind==='investigate_uncertain'){setConfirm(fresh);return;}
    await command.run(source.redrive(fresh));
   } else await command.run(source.reminder(fresh));
   confirmed();
  } catch {setError('The action could not be confirmed. Refresh current evidence before a new action.');detail.reload();}
  finally {setPreparing(false);}
 }
 const row=detail.value,busy=preparing||command.phase==='pending'||command.phase==='uncertain';
 return <><button className="btn btn-text" onClick={()=>{setConfirm(null);detail.reload();}}>Refresh detail</button>
  {detail.phase==='loading'?<Loading/>:detail.phase==='error'?<Failure retry={detail.reload}/>:row&&<>
   <h3>{kindLabel[row.notification_kind]}</h3><Evidence row={row}/>
   {row.message&&<><h4>Provider attempts</h4>{row.attempts.length===0?<p>No recorded provider attempts.</p>:<ol className="ops-list">{row.attempts.map(attempt=><li key={attempt.attempt}>Attempt {attempt.attempt}: {attempt.outcome} · {attempt.reason_code.replaceAll('_',' ')} · {new Date(attempt.recorded_at).toLocaleString()}</li>)}</ol>}{row.history_truncated&&<p>Showing the newest 100 attempts. Earlier evidence is retained.</p>}</>}
   {row.fanout_items.length>0&&<><h4>Route fanout decisions</h4><ul className="ops-list">{row.fanout_items.map(item=><li className="ops-row" key={item.parcel_id}><span className="ops-row-main">Parcel {item.parcel_id}<span>{statusLabel[item.outcome]} · {item.reason_code.replaceAll('_',' ')}</span>{item.outbound_intent_id&&<span>Message reference: {item.outbound_intent_id}</span>}</span></li>)}</ul></>}
   {roles.includes('franchise_admin')&&row.recovery.kind!=='none'&&<button className="btn btn-outlined" disabled={busy||!!confirm} onClick={()=>{void prepare('redrive');}}>Redrive original message</button>}
   {roles.some(role=>['franchise_admin','operator','dispatcher'].includes(role))&&row.reminder.eligible&&<button className="btn btn-outlined" disabled={busy} onClick={()=>{void prepare('reminder');}}>Send route reminder</button>}
   {confirm&&<div className="ops-alert" role="alert"><p>This provider outcome is uncertain. Retrying may deliver a duplicate message. Confirm only after investigating provider evidence.</p><button autoFocus className="btn btn-filled" disabled={busy} onClick={()=>{void command.run(source.redrive(confirm)).then(confirmed).catch(()=>setConfirm(null));}}>I investigated — retry despite duplicate risk</button><button className="btn btn-text" onClick={()=>setConfirm(null)}>Cancel retry</button></div>}
  </>}
  {error&&<p role="alert">{error}</p>}<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(confirmed).catch(()=>{});}:undefined}/>
 </>;
}
function Evidence({row}:{row:HistoryRow}) {return <dl className="history-facts">
 <dt>History reference</dt><dd>{row.id}</dd><dt>Source</dt><dd>{row.source_kind} · {row.source_id}</dd><dt>Affected reference</dt><dd>{row.affected_id}</dd><dt>Correlation</dt><dd>{row.correlation_id}</dd>
 {row.decision&&<><dt>Automation</dt><dd>{row.decision.policy_id} v{row.decision.policy_version} · {statusLabel[row.decision.outcome]} · {row.decision.reason_code.replaceAll('_',' ')}</dd></>}
 {row.message&&<><dt>Message reference</dt><dd>{row.message.id}</dd><dt>Transport</dt><dd>{statusLabel[row.message.state]} · {row.message.reason_code.replaceAll('_',' ')}</dd><dt>Provider callback progress</dt><dd>{row.message.progress}{row.message.failure_observed?' · Failure also observed':''}</dd><dt>Attempt count</dt><dd>{row.message.attempt_count}</dd></>}
 {row.fanout&&<><dt>Route fanout</dt><dd>{row.fanout.id} · {statusLabel[row.fanout.state]}</dd><dt>Route reference</dt><dd>{row.fanout.route_id}</dd><dt>Business decisions</dt><dd>{row.fanout.completed_count} queued · {row.fanout.skipped_count} skipped/suppressed · {row.fanout.failed_count} blocked</dd></>}
 </dl>;}
