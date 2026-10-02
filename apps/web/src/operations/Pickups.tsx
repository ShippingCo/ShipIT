import React,{useMemo,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { OperatorRole } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { pickups,type PickupSource,type PickupDetail } from '../data-access/pickups';
import { useCommand,usePagedResource,useResource } from './hooks';
import { Loading,Failure,Empty,CommandNotice } from './AsyncState';
import { TextField,SelectField } from '../components/m3/Input';

export default function Pickups({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const source=useMemo(()=>pickups(scopedApi(controller)),[controller]);
 if(!roles.some(r=>['org_admin','franchise_admin','operator'].includes(r)))return <p role="alert">Pickup requests are unavailable for this role.</p>;
 return <Queue source={source} canDecide={roles.some(r=>['franchise_admin','operator'].includes(r))}/>;
}
export function Queue({source,canDecide}:{source:PickupSource;canDecide:boolean}) {
 const page=usePagedResource('pickups',(cursor,signal)=>source.list(cursor,signal)),[selected,setSelected]=useState<string|null>(null),trigger=useRef<HTMLButtonElement|null>(null);
 return <section aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm" tabIndex={-1}>Pickup requests</h1>
  <p className="ops-note">Review capacity before accepting. A pickup request does not book a shipment or guarantee courier arrival.</p>
  <button className="btn btn-outlined" onClick={page.reload}>Refresh pickups</button>
  {page.phase==='loading'?<Loading/>:page.phase==='error'?<Failure retry={page.reload}/>:page.phase==='empty'?<Empty title="No pickup requests" body="Customer requests will appear here."/>:
   <ul className="ops-list">{page.items.map(p=><li className="ops-row" key={p.id}><div className="ops-row-main"><b>{p.state}</b><span>{new Date(p.requested_window.start).toLocaleString()}</span>{p.review_reason&&<span>Manual review required</span>}</div><button className="btn btn-outlined" onClick={e=>{trigger.current=e.currentTarget;setSelected(p.id);}}>Review pickup {p.id.slice(0,8)}</button></li>)}</ul>}
  {page.page.has_more&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={page.loadMore}>Load more pickups</button>}
  <Dialog.Root open={selected!==null} onOpenChange={open=>{if(!open)setSelected(null);}}><Dialog.Portal><Dialog.Overlay className="scrim"/><Dialog.Content className="dialog history-dialog" onCloseAutoFocus={e=>{e.preventDefault();trigger.current?.focus();}}>
   <Dialog.Title>Review pickup</Dialog.Title><Dialog.Description>Private address and requested shipment. Accept only after checking capacity and agreeing the window with the customer.</Dialog.Description>
   {selected&&<Detail key={selected} id={selected} source={source} canDecide={canDecide} changed={page.reload}/>}
   <Dialog.Close className="btn btn-text">Close</Dialog.Close>
  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>;
}
function Detail({id,source,canDecide,changed}:{id:string;source:PickupSource;canDecide:boolean;changed:()=>void}) {
 const current=useResource(id,signal=>source.detail(id,signal));
 if(current.phase==='loading')return <Loading/>;
 if(current.phase==='error'||!current.value)return <Failure retry={current.reload}/>;
 return <Decision key={current.value.version} value={current.value} source={source} canDecide={canDecide} changed={()=>{current.reload();changed();}}/>;
}
function Decision({value:p,source,canDecide,changed}:{value:PickupDetail;source:PickupSource;canDecide:boolean;changed:()=>void}) {
 const [decision,setDecision]=useState('accepted'),[start,setStart]=useState(''),[end,setEnd]=useState(''),[capacity,setCapacity]=useState(false),[reviewed,setReviewed]=useState(false),[error,setError]=useState('');
 const command=useCommand(source.execute),busy=command.phase==='pending'||command.phase==='uncertain';
 async function submit(e:React.FormEvent) {
  e.preventDefault();if(busy)return;setError('');
  const a=Date.parse(start),b=Date.parse(end);
  if(decision==='accepted'&&(!Number.isFinite(a)||!Number.isFinite(b)||a<=Date.now()||a>Date.now()+30*86400000||b<=a||b-a>86400000||!capacity||p.review_reason&&!reviewed)) {setError('Choose a future start within 30 days and an end within 24 hours. Confirm capacity and any manual review.');return;}
  try {await command.run(source.decide(p.id,{expected_version:p.version,decision,...(decision==='accepted'?{agreed_start:new Date(a).toISOString(),agreed_end:new Date(b).toISOString(),capacity_checked:capacity,manual_reviewed:reviewed}:{})}));changed();}catch{/* safe notice below */}
 }
 return <><p><b>{p.state}</b> · version {p.version}</p><p>{p.address}</p><p>Verified WhatsApp contact: {p.contact??'Unavailable; review the original customer conversation.'}</p><p>{p.shipment.origin_key} → {p.shipment.destination_key} · {p.shipment.weight_grams} g · {p.shipment.service}</p>
  <p>Requested: {new Date(p.requested_window.start).toLocaleString()} – {new Date(p.requested_window.end).toLocaleString()}</p>
  {p.review_reason&&<p role="status">Manual review: {p.review_reason.replaceAll('_',' ')}</p>}
  {p.agreed_window&&<p role="status">Agreed: {new Date(p.agreed_window.start).toLocaleString()} – {new Date(p.agreed_window.end).toLocaleString()}</p>}
  {p.notification&&<p role="status">Customer message: {p.notification.state} · attempts {p.notification.attempts}. {['failed','uncertain','suppressed'].includes(p.notification.state)?'Franchise admin must review messaging recovery. The pickup decision remains saved.':''}</p>}
  {canDecide&&p.state==='submitted'&&<form onSubmit={e=>{void submit(e);}}><fieldset disabled={busy} className="ops-form-grid"><legend>Staff decision</legend>
   <SelectField aria-label="Decision" label="Decision" value={decision} onChange={setDecision} options={[{value:'accepted',label:'Accept'},{value:'declined',label:'Decline'}]}/>
   {decision==='accepted'&&<><TextField label="Agreed start (your local time)" type="datetime-local" value={start} onChange={setStart} required aria-describedby="pickup-window-help"/><TextField label="Agreed end (your local time)" type="datetime-local" value={end} onChange={setEnd} required aria-describedby="pickup-window-help"/>
    <p id="pickup-window-help">Choose a future window agreed with the customer. At most 24 hours long and starting within 30 days.</p>
    <label><input type="checkbox" checked={capacity} onChange={e=>setCapacity(e.target.checked)} required/> I checked capacity and agreed this window with the customer.</label>
    {p.review_reason&&<label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} required/> I reviewed the shipment requiring manual handling.</label>}</>}
   {error&&<p role="alert">{error}</p>}<button className="btn btn-filled" type="submit">Save decision</button>
  </fieldset></form>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(changed).catch(()=>{});}:undefined}/>
 </>;
}
