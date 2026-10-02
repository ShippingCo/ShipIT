import React,{useMemo,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { OperatorRole } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { support,type SupportSource,type SupportDetail } from '../data-access/support';
import { useCommand,usePagedResource,useResource } from './hooks';
import { Loading,Failure,Empty,CommandNotice } from './AsyncState';
import { SelectField } from '../components/m3/Input';

export default function Support({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const source=useMemo(()=>support(scopedApi(controller)),[controller]);
 if(!roles.some(r=>['org_admin','franchise_admin','operator'].includes(r)))return <p role="alert">Support cases are unavailable for this role.</p>;
 return <SupportQueue source={source} canWrite={roles.some(r=>['franchise_admin','operator'].includes(r))}/>;
}
export function SupportQueue({source,canWrite}:{source:SupportSource;canWrite:boolean}) {
 const page=usePagedResource('support',(cursor,signal)=>source.list(cursor,signal)),[selected,setSelected]=useState<string|null>(null),trigger=useRef<HTMLButtonElement|null>(null);
 return <section aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm" tabIndex={-1}>Human support</h1>
  <p className="ops-note">Claim a case before replying. Automated answers stay paused until the case is resolved.</p>
  <button className="btn btn-outlined" onClick={page.reload}>Refresh cases</button>
  {page.phase==='loading'?<Loading/>:page.phase==='error'?<Failure retry={page.reload}/>:page.phase==='empty'?<Empty title="No support cases" body="Customer requests for help will appear here."/>:
   <ul className="ops-list">{page.items.map(c=><li className="ops-row" key={c.id}><div className="ops-row-main"><b>{c.state}</b><span>{c.reason.replaceAll('_',' ')}</span><span>Updated {new Date(c.updated_at).toLocaleString()}</span></div><button ref={button=>{if(button&&c.id===selected)trigger.current=button;}} className="btn btn-outlined" onClick={e=>{trigger.current=e.currentTarget;setSelected(c.id);}}>Review case {c.id.slice(0,8)}</button></li>)}</ul>}
  {page.page.has_more&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={page.loadMore}>Load more cases</button>}
  <Dialog.Root open={selected!==null} onOpenChange={open=>{if(!open)setSelected(null);}}><Dialog.Portal><Dialog.Overlay className="scrim"/><Dialog.Content className="dialog history-dialog" onCloseAutoFocus={e=>{e.preventDefault();trigger.current?.focus();}}>
   <Dialog.Title>Support case</Dialog.Title><Dialog.Description>Private staff workspace. Internal notes are never sent to the customer.</Dialog.Description>
   {selected&&<Detail key={selected} id={selected} source={source} canWrite={canWrite} changed={page.reload}/>}
   <Dialog.Close className="btn btn-text">Close</Dialog.Close>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>;
}
function Detail({id,source,canWrite,changed}:{id:string;source:SupportSource;canWrite:boolean;changed:()=>void}) {
 const current=useResource(id,signal=>source.detail(id,signal));
 if(current.phase==='loading')return <Loading/>;
 if(current.phase==='error'||!current.value)return <Failure retry={current.reload}/>;
 return <CaseCommands key={current.value.version} value={current.value} source={source} canWrite={canWrite} refresh={()=>{current.reload();changed();}}/>;
}
function CaseCommands({value:c,source,canWrite,refresh}:{value:SupportDetail;source:SupportSource;canWrite:boolean;refresh:()=>void}) {
 const mine=c.assigned_staff_id===c.current_actor_id;
 const actions=c.state==='resolved'?['reopen']:c.state==='open'?['claim','assign']:mine?['respond','note','resolve','assign']:['assign'];
 const [action,setAction]=useState(actions[0]!),[text,setText]=useState(''),[assigned,setAssigned]=useState(c.staff[0]?.id??''),[reason,setReason]=useState('needs_followup');
 const command=useCommand(source.execute),busy=command.phase==='pending'||command.phase==='uncertain';
 async function submit(e:React.FormEvent) {
  e.preventDefault();if(busy)return;
  try{await command.run(source.command(c.id,{action,expected_version:c.version,...(action==='assign'?{assigned_staff_id:assigned}:{}),...(['respond','note'].includes(action)?{text}:{}),...(['resolve','reopen'].includes(action)?{reason}:{})}));refresh();}catch{/* preserve draft and use safe notice */}
 }
 return <><p role="status"><b>{c.state}</b> · version {c.version}</p><p>Owner: {c.assigned_staff_id===c.current_actor_id?'You':c.assigned_staff_id??'Unassigned'}</p><p>{c.availability}</p>
  {c.parcel_id&&<p>Verified parcel: {c.parcel_id}</p>}
  <h3>Recent customer context</h3><p className="ops-note">Safe conversation outcomes only. Ask the customer for details if needed. Never ask for their delivery code.</p>
  <ul>{c.context.map((t,i)=><li key={i}>{t.intent} · {t.outcome} · {new Date(t.recorded_at).toLocaleString()}</li>)}</ul>
  {canWrite&&<form onSubmit={e=>{void submit(e);}}><fieldset disabled={busy} className="ops-form-grid"><legend>Handle case</legend>
   <SelectField aria-label="Action" label="Action" value={action} onChange={setAction} options={actions.map(v=>({value:v,label:({claim:'Claim case',assign:'Assign case',respond:'Reply to customer',note:'Add internal note',resolve:'Resolve case',reopen:'Reopen case'} as Record<string,string>)[v]!}))}/>
   {action==='assign'&&<SelectField aria-label="Assign to staff" label="Assign to staff" value={assigned} onChange={setAssigned} options={c.staff.map(s=>({value:s.id,label:s.id===c.current_actor_id?'You':s.id}))}/>}
   {['respond','note'].includes(action)&&<><label htmlFor="support-message">{action==='note'?'Internal note':'Customer message'}</label><textarea id="support-message" value={text} onChange={e=>setText(e.target.value)} required maxLength={2000} aria-describedby="support-message-help"/><p id="support-message-help">Do not include delivery codes, credentials or unnecessary personal details. Customer replies outside the service window are saved as blocked.</p></>}
   {['resolve','reopen'].includes(action)&&<SelectField aria-label="Reason" label="Reason" value={reason} onChange={setReason} options={['customer_request','needs_followup','answered','operational_review','incorrect_resolution'].map(v=>({value:v,label:v.replaceAll('_',' ')}))}/>}
   <button className="btn btn-filled" type="submit">Save action</button>
  </fieldset></form>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(refresh).catch(()=>{});}:undefined}/>
  <button className="btn btn-text" onClick={refresh} disabled={busy}>Reload case</button>
  <h3>Staff history</h3><ol>{c.history.map(e=><li key={e.id}><b>{e.action==='noted'?'Internal note':e.action}</b> · {e.reason.replaceAll('_',' ')} · {e.actor_id===c.current_actor_id?'You':e.actor_id}<span> · {new Date(e.occurred_at).toLocaleString()}</span>{e.text&&<p>{e.text}</p>}{e.message_state&&<p role="status">Customer message: {e.message_state} · {e.message_reason?.replaceAll('_',' ')} · attempts {e.attempts}. {['failed','uncertain','suppressed'].includes(e.message_state)?'Franchise admin must review messaging recovery. Do not duplicate an uncertain send.':''}</p>}</li>)}</ol>
 </>;
}
