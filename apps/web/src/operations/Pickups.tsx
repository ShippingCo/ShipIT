import {formatKolkata,instantToKolkataInput,kolkataInputToInstant} from './format';
import {PageHeader,RecordTable,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { OperatorRole } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { pickups,type PickupSource,type PickupDetail } from '../data-access/pickups';
import { useCommand,usePagedResource,useResource } from './hooks';
import {DataRefresh,Loading,Failure,Empty,CommandNotice } from './AsyncState';
import { TextField } from '../components/m3/Input';
import './pickups.css';

/* The words a shop uses, against the words the schema uses. `submitted` is a request nobody
 * has answered; `declined` and `canceled` both end with the customer not being collected
 * from, and the difference between them is who said so. */
type Bucket='waiting'|'agreed'|'declined';
const bucketOf=(state:string):Bucket=>state==='submitted'?'waiting':state==='accepted'?'agreed':'declined';
const stateWord=(state:string)=>state==='submitted'?'Waiting':state==='accepted'?'Agreed'
 :state==='canceled'?'Cancelled':'Turned down';
const buckets:{id:Bucket;label:string}[]=[
 {id:'waiting',label:'Waiting'},{id:'agreed',label:'Agreed'},{id:'declined',label:'Turned down'},
];

const kolkataDay=(instant:string)=>instantToKolkataInput(instant)?.slice(0,10)??'';
const clock=(instant:string)=>formatKolkata(instant,{hour:'numeric',minute:'2-digit',hour12:true});

/**
 * A collection window in the words someone would say out loud.
 *
 * The screen used to print two medium-format timestamps side by side, which an operator had to
 * read twice to work out whether it was today. The time comes first because that is what
 * decides it, and the day is a word wherever a word exists.
 */
export function windowWords(w:{start:string;end:string},now=Date.now()):string {
 const day=kolkataDay(w.start);
 const when=day===kolkataDay(new Date(now).toISOString())?'today'
  :day===kolkataDay(new Date(now+86400000).toISOString())?'tomorrow'
  :formatKolkata(w.start,{weekday:'short',day:'numeric',month:'short'});
 return clock(w.start)+' to '+clock(w.end)+' '+when;
}

/**
 * Three windows the shop can offer instead, built from now.
 *
 * Never a window that has already begun: the first one starts at the next quarter hour, and
 * the fixed slots roll to tomorrow once the hour has gone. A suggestion the server would
 * refuse is worse than no suggestion.
 */
export function suggestedWindows(now=Date.now()):{label:string;start:string;end:string}[] {
 const quarter=new Date(Math.ceil((now+60_000)/900_000)*900_000);
 const out:{label:string;start:string;end:string}[]=[
  {label:'Next two hours',start:quarter.toISOString(),end:new Date(quarter.getTime()+7_200_000).toISOString()},
 ];
 const slot=(label:string,fromHour:string,toHour:string)=>{
  for(const days of [0,1]) {
   const day=kolkataDay(new Date(now+days*86400000).toISOString());
   const start=kolkataInputToInstant(day+'T'+fromHour),end=kolkataInputToInstant(day+'T'+toHour);
   if(start&&end&&Date.parse(start)>now+60_000){out.push({label,start,end});return;}
  }
 };
 slot('This evening, 5 to 7 pm','17:00','19:00');
 slot('Tomorrow morning, 10 am to 1 pm','10:00','13:00');
 return out;
}

export default function Pickups({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const source=useMemo(()=>pickups(scopedApi(controller)),[controller]);
 if(!(canAdminister(roles,'pickups.decide')||roles.some(r=>['org_admin','franchise_admin','operator'].includes(r))))return <p role="alert">Pickup requests are unavailable for this role.</p>;
 return <Queue source={source} canDecide={(canAdminister(roles,'pickups.decide')||roles.some(r=>['franchise_admin','operator'].includes(r)))}/>;
}

export function Queue({source,canDecide}:{source:PickupSource;canDecide:boolean}) {
 const page=usePagedResource('pickups',(cursor,signal)=>source.list(cursor,signal));
 const [bucket,setBucket]=useState<Bucket>('waiting');
 const [selected,setSelected]=useState<string|null>(null),[locked,setLocked]=useState(false);
 const trigger=useRef<HTMLButtonElement|null>(null),refresh=useRef<HTMLButtonElement|null>(null);
 const counts=useMemo(()=>{
  const tally:Record<Bucket,number>={waiting:0,agreed:0,declined:0};
  for(const item of page.items)tally[bucketOf(item.state)]+=1;
  return tally;
 },[page.items]);
 const rows=page.items.filter(item=>bucketOf(item.state)===bucket);
 // A module that is not registered answers 404. That is not a fault in the shop's connection.
 const absent=page.phase==='error'&&page.error?.code==='RESOURCE_NOT_FOUND';
 return <section className="service-workspace logistics-workspace pickups-workspace" aria-labelledby="workspace-title">
  <PageHeader title="Pickup requests" eyebrow="Customers asking to be collected from"
   actions={<DataRefresh resource={page} buttonRef={refresh}/>}/>
  {/* R-6, R-8: the three states are always on screen with their counts, so an empty queue
      still shows what else happened today rather than looking like a broken screen. */}
  {!absent&&<div className="pickup-states" role="group" aria-label="Which requests to show">
   {buckets.map(item=><button type="button" key={item.id} className={'pickup-state'+(bucket===item.id?' is-on':'')}
    aria-pressed={bucket===item.id} onClick={()=>setBucket(item.id)}>
    <strong>{counts[item.id]}</strong><span>{item.label}</span>
   </button>)}
  </div>}
  {page.phase==='loading'?<Loading label="Loading pickup requests…"/>
   :absent?<Empty title="Pickups over WhatsApp are not set up"
     body="Customers can only ask for a pickup once this shop's WhatsApp number is connected. Nothing is missing from this screen."/>
   :page.phase==='error'?<Failure label="Pickup requests are unavailable." retry={page.reload}/>
   :rows.length===0?<Empty title={bucket==='waiting'?'✓ Nothing waiting':bucket==='agreed'?'Nothing agreed yet':'Nothing turned down'}
     body={bucket==='waiting'?'When a customer asks to be collected from, their request appears here.':'Requests move here once you have answered them.'}/>
   :<RecordTable mobile="stack" label="Pickup requests" caption="Open a request to see where it is and answer it."
     rows={rows} rowKey={p=>p.id} selectedKey={selected} columns={[
     {key:'requested',label:'When they want it',cell:p=><strong className="pickup-when">{windowWords(p.requested_window)}</strong>},
     {key:'state',label:'State',cell:p=><StatusBadge tone={p.state==='accepted'?'success':p.state==='submitted'?'info':'neutral'}>{stateWord(p.state)}</StatusBadge>},
     {key:'agreed',label:'Agreed for',cell:p=>p.agreed_window?windowWords(p.agreed_window):'—'},
     {key:'review',label:'Needs a look',cell:p=>p.review_reason?<StatusBadge tone="warning">Check this one</StatusBadge>:'No'},
     {key:'reference',label:'Reference',cell:p=><span className="ops-mono">{p.id.slice(0,8).toUpperCase()}</span>},
     {key:'action',label:'',cell:p=><button className="btn btn-text" aria-label={'Open the '+windowWords(p.requested_window)+' request'}
       onClick={e=>{trigger.current=e.currentTarget;setSelected(p.id);}}>Open</button>},
    ]}/>}
  {page.page.has_more&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={page.loadMore}>Load more requests</button>}
  <Dialog.Root open={selected!==null} onOpenChange={open=>{if(!open&&!locked)setSelected(null);}}><Dialog.Portal><Dialog.Overlay className="scrim"/>
   <Dialog.Content className="dialog history-dialog service-detail-dialog pickup-dialog"
    onCloseAutoFocus={e=>{e.preventDefault();(trigger.current?.isConnected?trigger.current:refresh.current)?.focus();}}>
    <Dialog.Close disabled={locked} className="btn btn-outlined service-detail-close">Close</Dialog.Close>
    {locked&&<p role="status" className="ops-note">Keep this open until the result is confirmed.</p>}
    <Dialog.Title>This pickup request</Dialog.Title>
    <Dialog.Description>Agreeing tells the customer and puts the collection on your day. It does not create a booking.</Dialog.Description>
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

function Decision({value:p,source,canDecide,changed,setLocked}:{setLocked:(locked:boolean)=>void;value:PickupDetail;source:PickupSource;canDecide:boolean;changed:()=>void}) {
 const [other,setOther]=useState(false),[start,setStart]=useState(''),[end,setEnd]=useState('');
 const [reviewed,setReviewed]=useState(false),[error,setError]=useState('');
 const command=useCommand(source.execute),busy=command.phase==='pending'||command.phase==='uncertain';
 useEffect(()=>{setLocked(busy);return()=>setLocked(false);},[busy,setLocked]);
 const now=Date.now();
 const requestedStart=Date.parse(p.requested_window.start),requestedEnd=Date.parse(p.requested_window.end);
 // The customer's own window is only offerable while the server would still accept it.
 const canRepeat=requestedStart>now+60_000&&requestedStart<=now+30*86400000
  &&requestedEnd>requestedStart&&requestedEnd-requestedStart<=86400000;
 const gone=requestedStart<=now;
 const suggestions=useMemo(()=>suggestedWindows(now),[now]);
 const needsLook=!!p.review_reason;
 const blocked=needsLook&&!reviewed;

 async function decide(body:Record<string,unknown>) {
  setError('');
  try { await command.run(source.decide(p.id,{expected_version:p.version,...body})); changed(); }
  catch { /* the named failure below says what the customer was told */ }
 }
 function accept(from:string,to:string) {
  if(blocked){setError('Say you have looked at this one first.');return;}
  void decide({decision:'accepted',agreed_start:from,agreed_end:to,capacity_checked:true,manual_reviewed:reviewed||!needsLook});
 }
 function acceptTyped() {
  const from=kolkataInputToInstant(start),to=kolkataInputToInstant(end);
  if(!from||!to||Date.parse(from)<=now||Date.parse(to)<=Date.parse(from)||Date.parse(to)-Date.parse(from)>86400000) {
   setError('Choose a start later than now and an end within a day of it.');return;
  }
  accept(from,to);
 }

 const open=p.state==='submitted'&&canDecide;
 return <>
  {/* R-2: what decides it, before anything is asked. Two of the four facts the design calls
      for are not in the API at all and are named as unknown rather than guessed. */}
  <dl className="pickup-facts" aria-label="What decides this">
   <div><dt>Parcels</dt><dd>1</dd></div>
   <div><dt>When they want it</dt><dd>{windowWords(p.requested_window,now)}</dd></div>
   <div><dt>Where</dt><dd>{p.address}</dd></div>
   <div><dt>Sending</dt><dd>{p.shipment.origin_key} → {p.shipment.destination_key}
    <span className="ops-note">{p.shipment.weight_grams.toLocaleString('en-IN')} g · {p.shipment.service}</span></dd></div>
   <div><dt>Their number</dt><dd>{p.contact??'Not available. Open the WhatsApp conversation.'}</dd></div>
  </dl>
  <p className="pickup-unknown">How far away they are, and whether they have sent with you before, are not recorded against a pickup request.</p>
  {gone&&<p role="status" className="pickup-gone">They asked for {clock(p.requested_window.start)}, which has gone. Offer another time below.</p>}
  {needsLook&&<p role="status" className="pickup-look">Worth a look first: {p.review_reason!.replaceAll('_',' ')}.</p>}
  {p.agreed_window&&<p role="status" className="pickup-agreed">Agreed for {windowWords(p.agreed_window,now)}. The customer has been told.</p>}
  {p.state!=='submitted'&&!p.agreed_window&&<p role="status" className="pickup-agreed">{stateWord(p.state)}. Nothing is being collected.</p>}
  {p.notification&&<p role="status" className="ops-note">Message to the customer: {p.notification.state} · {p.notification.attempts} {p.notification.attempts===1?'try':'tries'}.
   {['failed','uncertain','suppressed'].includes(p.notification.state)?' The decision is saved, but the customer may not have been told. Message them yourself.':''}</p>}

  {open&&<div className="pickup-decision">
   {needsLook&&<label className="pickup-look-tick">
    <input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>
    I have looked at this one.
   </label>}
   {/* R-3: the common answer is yes to the time they asked for, so that is one button with
       their own window in its name. Pressing it is the capacity attestation the server
       requires — the sentence above says so, rather than a tick nobody reads. */}
   {canRepeat&&!other&&<>
    <p className="pickup-attest">Pressing this says you have someone to collect, and tells the customer.</p>
    <button className="btn btn-filled pickup-yes" disabled={busy}
     onClick={()=>accept(p.requested_window.start,p.requested_window.end)}>
     Yes — collect {windowWords(p.requested_window,now)}
    </button>
   </>}
   {!other
    ? <button type="button" className="btn btn-outlined" disabled={busy} onClick={()=>setOther(true)}>
        {canRepeat?'A different time':'Offer a time'}
      </button>
    : <div className="pickup-other">
       <p className="pickup-attest">Choose a window you can actually reach them in. The customer is told the time you choose.</p>
       <div className="pickup-chips" role="group" aria-label="Times you could offer">
        {suggestions.map(item=><button type="button" key={item.label} className="pickup-chip" disabled={busy}
          onClick={()=>accept(item.start,item.end)}>
          <strong>{item.label}</strong><span>{windowWords(item,now)}</span>
        </button>)}
       </div>
       <details className="pickup-custom"><summary>Another time altogether</summary>
        <TextField label="From (India time)" type="datetime-local" value={start} onChange={setStart} disabled={busy}/>
        <TextField label="Until (India time)" type="datetime-local" value={end} onChange={setEnd} min={start||undefined} disabled={busy}/>
        <button type="button" className="btn btn-filled" disabled={busy} onClick={acceptTyped}>Agree this time</button>
       </details>
       <button type="button" className="btn btn-text" disabled={busy} onClick={()=>{setOther(false);setError('');}}>Back</button>
      </div>}
   <div className="pickup-no">
    <p className="pickup-attest">The customer is told you cannot collect, and asked to message the shop. ShipIT cannot yet tell them why.</p>
    <button type="button" className="btn btn-outlined pickup-decline" disabled={busy}
     onClick={()=>{if(blocked){setError('Say you have looked at this one first.');return;}void decide({decision:'declined'});}}>
     No — we cannot collect
    </button>
   </div>
   {error&&<p role="alert" className="pickup-error">{error}</p>}
   {/* R-10: what happened to the customer, not what happened to the request. */}
   {command.phase==='error'&&<p className="pickup-outcome">Nothing was saved, and the customer has not been told anything.</p>}
   {command.phase==='uncertain'&&<p className="pickup-outcome">We do not know whether this was saved, and we do not know whether the customer was told anything.</p>}
   <CommandNotice phase={command.phase} code={command.error?.code}
    retry={command.canRetry?()=>{void command.retry().then(changed).catch(()=>{});}:undefined}/>
  </div>}
  {!open&&p.state==='submitted'&&<p className="ops-note">You cannot answer requests in this shop.</p>}
 </>;
}
