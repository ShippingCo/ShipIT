import {ServiceActivity} from './ServiceActivity';
import {formatKolkata} from './format';
import {PageHeader,RecordTable,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { OperatorRole } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { support,type SupportSource,type SupportDetail } from '../data-access/support';
import { useCommand,usePagedResource,useResource } from './hooks';
import { Loading,Failure,Empty,CommandNotice } from './AsyncState';
import { SelectField,TextArea } from '../components/m3/Input';

const caseReason=(reason:string)=>reason==='human_requested'?'Customer asked for help':reason.replaceAll('_',' ');
export default function Support({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const source=useMemo(()=>support(scopedApi(controller)),[controller]);
 if(!(canAdminister(roles,'support.write')||roles.some(r=>['org_admin','franchise_admin','operator'].includes(r))))return <p role="alert">Support cases are unavailable for this role.</p>;
 return <SupportQueue source={source} canWrite={(canAdminister(roles,'support.write')||roles.some(r=>['franchise_admin','operator'].includes(r)))}/>;
}
export function SupportQueue({source,canWrite}:{source:SupportSource;canWrite:boolean}) {
 const page=usePagedResource('support',(cursor,signal)=>source.list(cursor,signal)),[selected,setSelected]=useState<string|null>(null),[locked,setLocked]=useState(false),trigger=useRef<HTMLButtonElement|null>(null),refresh=useRef<HTMLButtonElement|null>(null);
 return <section className="service-workspace logistics-workspace" aria-labelledby="workspace-title"><PageHeader title="Support" eyebrow="Customer service" description="Review customer requests and follow up." actions={<button ref={refresh} className="btn btn-outlined" onClick={page.reload}>Refresh cases</button>}/>
  {page.phase==='loading'?<Loading label="Loading support cases…"/>:page.phase==='error'?<Failure label="Support cases are unavailable." retry={page.reload}/>:page.phase==='empty'?<Empty title="No support cases" body="When a customer asks for help, their case appears here. Open it to see the reason and choose who will follow up."/>:
   <RecordTable mobile="stack" label="Support cases" caption="Cases in this branch · open a case for customer details" rows={page.items} rowKey={c=>c.id} selectedKey={selected} columns={[
    {key:'reference',label:'Case',cell:c=><div className="record-identity"><strong>{caseReason(c.reason)}</strong><span>Case {c.id.slice(0,8)}</span></div>},
    {key:'state',label:'State',cell:c=><StatusBadge tone={c.state==='resolved'?'success':c.state==='open'?'warning':'info'}>{c.state}</StatusBadge>},
    {key:'assigned',label:'Assigned to',cell:c=>c.assigned_staff_id?<span className="service-reference">{c.assigned_staff_id.slice(0,8)}</span>:'Unassigned'},
    {key:'updated',label:'Updated',cell:c=><time dateTime={c.updated_at}>{formatKolkata(c.updated_at)}</time>},
    {key:'action',label:'Action',cell:c=><button ref={button=>{if(button&&c.id===selected)trigger.current=button;}} className="btn btn-text" aria-label={`Review case ${c.id}`} onClick={e=>{trigger.current=e.currentTarget;setSelected(c.id);}}>Review case</button>},
   ]}/>}
  {page.page.has_more&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={page.loadMore}>Load more cases</button>}
  <Dialog.Root open={selected!==null} onOpenChange={open=>{if(!open&&!locked)setSelected(null);}}><Dialog.Portal><Dialog.Overlay className="scrim"/><Dialog.Content className="dialog history-dialog service-detail-dialog" onCloseAutoFocus={e=>{e.preventDefault();(trigger.current?.isConnected?trigger.current:refresh.current)?.focus();}}>
   <Dialog.Close disabled={locked} className="btn btn-outlined service-detail-close">Close</Dialog.Close>
   {locked&&<p role="status" className="ops-note">Keep this request open until its result is confirmed.</p>}<Dialog.Title>Support case</Dialog.Title><Dialog.Description>Private staff workspace. Internal notes are never sent to the customer.</Dialog.Description>
   {selected&&<SupportCaseDetail setLocked={setLocked} key={selected} id={selected} source={source} canWrite={canWrite} changed={page.reload}/>}

  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>;
}
export function SupportCaseDetail({id,source,canWrite,changed,setLocked}:{setLocked:(locked:boolean)=>void;id:string;source:SupportSource;canWrite:boolean;changed:()=>void}) {
 const current=useResource(id,signal=>source.detail(id,signal));
 if(current.phase==='loading')return <Loading/>;
 if(current.phase==='error'||!current.value)return <Failure label="The selected record is unavailable." retry={current.reload}/>;
 return <CaseCommands setLocked={setLocked} key={current.value.version} value={current.value} source={source} canWrite={canWrite} refresh={()=>{current.reload();changed();}}/>;
}
function CaseCommands({value:c,source,canWrite,refresh,setLocked}:{setLocked:(locked:boolean)=>void;value:SupportDetail;source:SupportSource;canWrite:boolean;refresh:()=>void}) {
 const mine=c.assigned_staff_id===c.current_actor_id;
 const actionLabels:Record<string,string>={claim:'Claim case',assign:'Assign case',respond:'Reply to customer',note:'Add internal note',resolve:'Resolve case',reopen:'Reopen case'};
 const actions=c.state==='resolved'?['reopen']:c.state==='open'?['claim','assign']:mine?['respond','note','resolve','assign']:['assign'];
 const [action,setAction]=useState(actions[0]!),[text,setText]=useState(''),[assigned,setAssigned]=useState(''),[reason,setReason]=useState('needs_followup');
 const command=useCommand(source.execute),busy=command.phase==='pending'||command.phase==='uncertain';
 useEffect(()=>{setLocked(busy);return()=>setLocked(false);},[busy,setLocked]);
 async function submit(e:React.FormEvent) {
  e.preventDefault();if(busy||action==='assign'&&!assigned)return;
  try{await command.run(source.command(c.id,{action,expected_version:c.version,...(action==='assign'?{assigned_staff_id:assigned}:{}),...(['respond','note'].includes(action)?{text}:{}),...(['resolve','reopen'].includes(action)?{reason}:{})}));refresh();}catch{/* preserve draft and use safe notice */}
 }
 return <><header className="service-record-head"><div><h3>{caseReason(c.reason)}</h3>
    <p>{c.assigned_staff_id===c.current_actor_id?'Owner: You':c.assigned_staff_id?'Owner: Assigned staff':'Owner: Unassigned'}</p></div>
    <StatusBadge tone={c.state==='resolved'?'success':'info'}>{c.state}</StatusBadge></header><p>{c.availability}</p>
  <details className="logistics-secondary"><summary>Case references</summary><p>Case reference: <span className="logistics-reference">{c.id}</span> · Version {c.version}</p>{c.assigned_staff_id&&<p>Assigned staff reference: <span className="logistics-reference">{c.assigned_staff_id}</span></p>}{c.parcel_id&&<p>Verified parcel: <span className="logistics-reference">{c.parcel_id}</span></p>}</details>
  <h3>Recent customer context</h3><p className="ops-note">Safe conversation outcomes only. Ask the customer for details if needed. Never ask for their delivery code.</p>
  {!c.context.length&&<p className="ops-note">No earlier customer activity is available for this case.</p>}<ServiceActivity label="Customer activity" items={c.context.map((event,index)=>({
    id:index,title:event.intent.replaceAll('_',' '),time:event.recorded_at,detail:event.outcome.replaceAll('_',' '),
  }))}/>
  {canWrite&&<form onSubmit={e=>{void submit(e);}}><fieldset disabled={busy} className="ops-form-grid"><legend>Handle case</legend>
   <SelectField aria-label="Action" label="Action" value={action} onChange={setAction} options={actions.map(v=>({value:v,label:actionLabels[v]!}))}/>
   {action==='assign'&&<SelectField aria-label="Assign to staff" label="Assign to staff" value={assigned} onChange={setAssigned} options={[{value:'',label:'Choose a staff member'},...c.staff.map(s=>({value:s.id,label:s.id===c.current_actor_id?'You':s.id}))]}/>}
   {['respond','note'].includes(action)&&<TextArea id="support-message" label={action==='note'?'Internal note':'Customer message'} value={text} onChange={setText} required maxLength={2000} rows={4} helper={action==='note'?'Visible only to staff. Do not include delivery codes or passwords.':'Outside the messaging window, replies are saved as blocked. Never include delivery codes or passwords.'}/>}
   {['resolve','reopen'].includes(action)&&<SelectField aria-label="Reason" label="Reason" value={reason} onChange={setReason} options={['customer_request','needs_followup','answered','operational_review','incorrect_resolution'].map(v=>({value:v,label:v.replaceAll('_',' ')}))}/>}
   <button className="btn btn-filled" disabled={action==='assign'&&!assigned} type="submit">{action==='respond'?'Submit reply':action==='note'?'Save internal note':actionLabels[action]}</button>
  </fieldset></form>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(refresh).catch(()=>{});}:undefined}/>
  <button className="btn btn-text" onClick={refresh} disabled={busy}>Reload case</button>
  <details className="logistics-secondary" open={c.history.some(event=>event.message_state&&!(['sent','delivered','read'].includes(event.message_state)))}><summary>Staff history</summary><ServiceActivity label="Case events" items={c.history.map(event=>({
    id:event.id,title:event.action==='noted'?'Internal note':event.action.replaceAll('_',' '),time:event.occurred_at,
    detail:<>{event.reason.replaceAll('_',' ')} · {event.actor_id===c.current_actor_id?'You':event.actor_id}
      {event.text&&<p>{event.text}</p>}
      {event.message_state&&<p role="status">Customer message: {event.message_state} · {event.message_reason?.replaceAll('_',' ')} · attempts {event.attempts}. {['failed','uncertain','suppressed'].includes(event.message_state)?'Franchise admin must review messaging recovery. Do not duplicate an uncertain send.':''}</p>}</>,
  }))}/></details>
 </>;
}
