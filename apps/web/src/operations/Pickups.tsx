import {formatKolkata} from './format';
import {PageHeader,RecordTable,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import React,{useEffect,useMemo,useRef,useState} from 'react';
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
 if(!(canAdminister(roles,'pickups.decide')||roles.some(r=>['org_admin','franchise_admin','operator'].includes(r))))return <p role="alert">Pickup requests are unavailable for this role.</p>;
 return <Queue source={source} canDecide={(canAdminister(roles,'pickups.decide')||roles.some(r=>['franchise_admin','operator'].includes(r)))}/>;
}
export function Queue({source,canDecide}:{source:PickupSource;canDecide:boolean}) {
 const page=usePagedResource('pickups',(cursor,signal)=>source.list(cursor,signal)),[selected,setSelected]=useState<string|null>(null),[locked,setLocked]=useState(false),trigger=useRef<HTMLButtonElement|null>(null),refresh=useRef<HTMLButtonElement|null>(null);
 return <section className="service-workspace logistics-workspace" aria-labelledby="workspace-title"><PageHeader title="Pickup requests" eyebrow="Customer service" description="Review requests and agree a collection time." actions={<button ref={refresh} className="btn btn-outlined" onClick={page.reload}>Refresh pickups</button>}/>
  {page.phase==='loading'?<Loading label="Loading pickup requests…"/>:page.phase==='error'?<Failure label="Pickup requests are unavailable." retry={page.reload}/>:page.phase==='empty'?<Empty title="No pickup requests" body="When a customer requests a pickup, open their request to check the address and agree a collection time."/>:
   <RecordTable mobile="stack" label="Pickup requests" caption="Open a request to check the contact, address and collection time." rows={page.items} rowKey={p=>p.id} selectedKey={selected} columns={[
    {key:'reference',label:'Request',cell:p=><strong className="service-reference">{p.id.slice(0,8)}</strong>},
    {key:'state',label:'State',cell:p=><StatusBadge tone={p.state==='accepted'?'success':p.state==='submitted'?'info':'neutral'}>{p.state}</StatusBadge>},
    {key:'requested',label:'Requested window',cell:p=><span className="service-cell-stack"><time dateTime={p.requested_window.start}>{formatKolkata(p.requested_window.start)}</time><span className="ops-note">to {formatKolkata(p.requested_window.end)}</span></span>},
    {key:'agreed',label:'Agreed window',cell:p=>p.agreed_window?<span className="service-cell-stack">{formatKolkata(p.agreed_window.start)}<span className="ops-note">to {formatKolkata(p.agreed_window.end)}</span></span>:'Not agreed'},
    {key:'review',label:'Review',cell:p=>p.review_reason?<StatusBadge tone="warning">Manual review required</StatusBadge>:'Standard handling'},
    {key:'action',label:'Action',cell:p=><button className="btn btn-text" aria-label={`Review pickup ${p.id}`} onClick={e=>{trigger.current=e.currentTarget;setSelected(p.id);}}>Review pickup</button>},
   ]}/>}
  {page.page.has_more&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={page.loadMore}>Load more pickups</button>}
  <Dialog.Root open={selected!==null} onOpenChange={open=>{if(!open&&!locked)setSelected(null);}}><Dialog.Portal><Dialog.Overlay className="scrim"/><Dialog.Content className="dialog history-dialog service-detail-dialog" onCloseAutoFocus={e=>{e.preventDefault();(trigger.current?.isConnected?trigger.current:refresh.current)?.focus();}}>
   <Dialog.Close disabled={locked} className="btn btn-outlined service-detail-close">Close</Dialog.Close>
   {locked&&<p role="status" className="ops-note">Keep this request open until its result is confirmed.</p>}<Dialog.Title>Review pickup</Dialog.Title><Dialog.Description>Check the address and parcel, then agree a pickup time with the customer. Accepting does not create a booking or guarantee courier arrival.</Dialog.Description>
   {selected&&<Detail setLocked={setLocked} key={selected} id={selected} source={source} canDecide={canDecide} changed={page.reload}/>}

  </Dialog.Content></Dialog.Portal></Dialog.Root>
 </section>;
}
function Detail({id,source,canDecide,changed,setLocked}:{setLocked:(locked:boolean)=>void;id:string;source:PickupSource;canDecide:boolean;changed:()=>void}) {
 const current=useResource(id,signal=>source.detail(id,signal));
 if(current.phase==='loading')return <Loading/>;
 if(current.phase==='error'||!current.value)return <Failure label="The selected record is unavailable." retry={current.reload}/>;
 return <Decision setLocked={setLocked} key={current.value.version} value={current.value} source={source} canDecide={canDecide} changed={()=>{current.reload();changed();}}/>;
}
function localInput(instant:number) {
 const date=new Date(instant);
 return new Date(instant-date.getTimezoneOffset()*60000).toISOString().slice(0,-1);
}
function Decision({value:p,source,canDecide,changed,setLocked}:{setLocked:(locked:boolean)=>void;value:PickupDetail;source:PickupSource;canDecide:boolean;changed:()=>void}) {
 const [decision,setDecision]=useState('accepted'),[start,setStart]=useState(''),[end,setEnd]=useState(''),[capacity,setCapacity]=useState(false),[reviewed,setReviewed]=useState(false),[error,setError]=useState('');
 const command=useCommand(source.execute),busy=command.phase==='pending'||command.phase==='uncertain';
 useEffect(()=>{setLocked(busy);return()=>setLocked(false);},[busy,setLocked]);
 const requestedStart=Date.parse(p.requested_window.start),requestedEnd=Date.parse(p.requested_window.end),now=Date.now();
 const canUseRequested=requestedStart>now && requestedStart<=now+30*86400000 && requestedEnd>requestedStart && requestedEnd-requestedStart<=86400000
  && Date.parse(localInput(requestedStart))===requestedStart && Date.parse(localInput(requestedEnd))===requestedEnd;
 async function submit(e:React.FormEvent) {
  e.preventDefault();if(busy)return;setError('');
  const a=Date.parse(start),b=Date.parse(end);
  if(decision==='accepted'&&(!Number.isFinite(a)||!Number.isFinite(b)||a<=Date.now()||a>Date.now()+30*86400000||b<=a||b-a>86400000||!capacity||p.review_reason&&!reviewed)) {setError('Choose a future start within 30 days and an end within 24 hours. Confirm capacity and any manual review.');return;}
  try {await command.run(source.decide(p.id,{expected_version:p.version,decision,...(decision==='accepted'?{agreed_start:new Date(a).toISOString(),agreed_end:new Date(b).toISOString(),capacity_checked:capacity,manual_reviewed:reviewed}:{})}));changed();}catch{/* safe notice below */}
 }
 return <><section className="logistics-pickup-summary" aria-label="Pickup details"><div className="pickup-request-heading"><h3>Collection details</h3><StatusBadge tone={p.state==='accepted'?'success':p.state==='submitted'?'info':'neutral'}>{p.state}</StatusBadge></div>
  <dl className="logistics-pickup-facts"><div><dt>Collection address</dt><dd>{p.address}</dd></div><div><dt>Verified WhatsApp contact</dt><dd>{p.contact??'Unavailable; review the original customer conversation.'}</dd></div><div><dt>Shipment</dt><dd>{p.shipment.origin_key} → {p.shipment.destination_key}<span className="ops-note">{p.shipment.weight_grams.toLocaleString('en-IN')} g · {p.shipment.service}</span></dd></div><div><dt>Requested time (India)</dt><dd>{formatKolkata(p.requested_window.start)} – {formatKolkata(p.requested_window.end)}</dd></div></dl><p className="ops-note">Record version {p.version}</p></section>
  {p.review_reason&&<p role="status">Manual review: {p.review_reason.replaceAll('_',' ')}</p>}
  {p.agreed_window&&<p role="status">Agreed: {formatKolkata(p.agreed_window.start)} – {formatKolkata(p.agreed_window.end)}</p>}
  {p.notification&&<p role="status">Customer message: {p.notification.state} · attempts {p.notification.attempts}. {['failed','uncertain','suppressed'].includes(p.notification.state)?'An administrator must review messaging recovery. The pickup decision remains saved.':''}</p>}
  {canDecide&&p.state==='submitted'&&<form className="pickup-window-form" onSubmit={e=>{void submit(e);}}><fieldset disabled={busy} className="ops-form-grid"><legend>Your pickup decision</legend>
   <SelectField aria-label="Decision" label="Decision" value={decision} onChange={setDecision} options={[{value:'accepted',label:'Accept'},{value:'declined',label:'Decline'}]}/>
   {decision==='accepted'&&<>{canUseRequested&&<button type="button" className="btn btn-outlined pickup-requested-window" onClick={()=>{setStart(localInput(requestedStart));setEnd(localInput(requestedEnd));}}>Use customer’s requested time</button>}<TextField label="Agreed start (your local time)" type="datetime-local" step="0.001" value={start} onChange={setStart} required aria-describedby="pickup-window-help"/><TextField label="Agreed end (your local time)" type="datetime-local" step="0.001" value={end} onChange={setEnd} min={start||undefined} required aria-describedby="pickup-window-help"/>
    <p className="ops-note" id="pickup-window-help">Choose a start in the next 30 days and an end within 24 hours of the start.</p>
    <label><input type="checkbox" checked={capacity} onChange={e=>setCapacity(e.target.checked)} required/> I checked capacity and agreed this window with the customer.</label>
    {p.review_reason&&<label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} required/> I reviewed the shipment requiring manual handling.</label>}</>}
   {error&&<p role="alert">{error}</p>}<button className="btn btn-filled" type="submit">Save decision</button>
  </fieldset></form>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(changed).catch(()=>{});}:undefined}/>
 </>;
}
