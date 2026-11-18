import React,{useEffect,useMemo,useRef,useState} from 'react';
import * as SheetPrimitive from '@radix-ui/react-dialog';
import {Link} from 'react-router-dom';
import type {LotDto,LotMembershipResult,OperatorRole,RouteDto} from '@shippingco/shared';
import type {ScopedApi} from '../data-access/scoped-api';
import {parcels,type ParcelRead} from '../data-access/parcels';
import {lots} from '../data-access/lots';
import {routes} from '../data-access/routes';
import {deliveries} from '../data-access/deliveries';
import {receipts} from '../data-access/receipts';
import {printReceiptFor} from '../utils/receipt';
import {useCommand,useResource} from './hooks';
import {CommandNotice} from './AsyncState';
import {Msym} from '../components/m3/Icon';
import {Journey} from '../components/m3/Journey';
import {HubPlacePicker} from './HubPlacePicker';
import {mintEventRef,readPlaces,type HubPlace} from './hub-places';
import {routeAttachmentPlan} from './route-workflow';
import {kolkataInputToInstant,instantToKolkataInput,formatKolkata} from './format';
import {paymentBadge,statusBadge} from './PackagesTable';
import type {SavedBookingRow} from './SavedBookings';
import type {ParcelStatus as JourneyStatus} from '../data/types';

/**
 * One parcel, and the one thing to do with it next.
 *
 * The window this replaces put a photo placeholder, a disabled WhatsApp box, the parcel's
 * details twice and its timeline twice above a form that asked for a "Route number" — a
 * 36-character internal id nobody at a counter has ever seen. This sheet (the 21st.dev
 * "Sheet with Scrollable Content" pattern, on Radix) answers three questions in order:
 * where is it, what do I do now, and what do I need to know about it.
 *
 * Every reference the server needs is either minted here (hub, handover, approval and
 * return-plan references are labels the server stores but never looks up) or chosen from a
 * list (a trip, a delivery agent). Nothing on this sheet asks the operator to type an id.
 */

const has=(roles:readonly OperatorRole[],...wanted:OperatorRole[])=>roles.some(role=>wanted.includes(role));
const money=(paise:number|null)=>paise===null?'—':'₹'+(paise/100).toLocaleString('en-IN',{maximumFractionDigits:2});
const when=(iso:string)=>formatKolkata(iso,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});
const tripName=(route:RouteDto)=>`${route.destination}${route.carrier_code?' · '+route.carrier_code:''}`;
const failure=(code?:string)=>code==='RTO_NOT_ELIGIBLE'?'This parcel cannot go back yet. Choose a reason below, or try delivering it again.'
  :code==='ACTION_FORBIDDEN'?'Your role cannot do this step. Ask the owner or a dispatcher.'
  :code==='VERSION_CONFLICT'?'Someone else just changed this parcel. Close and open it again.'
  :code==='ROUTE_STATE_CONFLICT'?'That trip has already been sealed or has left. Pick another trip or start a new one.'
  :code==='PARCEL_STATE_CONFLICT'?'This parcel is not in the right state for that any more. Close and open it again.':undefined;

function Step({icon,title,tone='accent',children}:{icon:string;title:React.ReactNode;tone?:'accent'|'done'|'warn'|'muted';children?:React.ReactNode}){
  return <section className={'ps-step tone-'+tone} aria-label="Next step">
    <div className="ps-step-head"><span className="ps-step-ico" aria-hidden="true"><Msym name={icon}/></span><h3>{title}</h3></div>
    {children&&<div className="ps-step-body">{children}</div>}
  </section>;
}
function Problem({code}:{code?:string}){const text=failure(code);return text?<p className="ps-problem" role="alert">{text}</p>:null;}
/** The shared notice, unless the failure already has a plain explanation above it. */
function Notice({command,retry}:{command:{phase:string;error:{code?:string}|null};retry?:()=>void}){
  if(command.phase==='error'&&failure(command.error?.code))return null;
  return <CommandNotice phase={command.phase} code={command.error?.code} retry={retry}/>;
}

/* ---- booked: check in at the hub -------------------------------------------------- */
function CheckIn({api,parcel,done,busy}:{api:ScopedApi;parcel:ParcelRead;done:()=>void;busy:(v:boolean)=>void}){
  const source=useMemo(()=>parcels(api),[api]),command=useCommand(value=>source.execute(value));
  const [place,setPlace]=useState<HubPlace|null>(null),[evidence]=useState(()=>mintEventRef());
  const pending=command.phase==='pending'||command.phase==='uncertain';
  useEffect(()=>{busy(pending);},[pending,busy]);
  async function go(){if(!place||pending)return;try{await command.run(source.intent({kind:'check_in',parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,location_ref:place.id}}));done();}catch{/* notice */}}
  return <Step icon="warehouse" title="Check it in at the hub">
    <HubPlacePicker value={place} onChange={setPlace} disabled={pending} label="Which hub is it at?"/>
    <button type="button" className="ps-primary" disabled={!place||pending} onClick={()=>void go()}>
      <Msym name="warehouse"/>{pending?'Checking in…':place?`Check in at ${place.name}`:'Check in'}</button>
    <Problem code={command.error?.code}/>
    <Notice command={command} retry={command.canRetry?()=>{void command.retry().then(done).catch(()=>{});}:undefined}/>
  </Step>;
}

/* ---- at hub: put it on a trip ----------------------------------------------------- */
/** The trip a parcel sits on, if any, found from the open and sealed trips' lists. */
function useParcelTrip(api:ScopedApi,parcelIds:string[]){
  const source=useMemo(()=>routes(api),[api]),key=parcelIds.join(',');
  return useResource('trip-of-'+key,async signal=>{
    const [open,sealed]=await Promise.all([source.list({state:'planning',limit:50},signal),source.list({state:'finalized',limit:50},signal)]);
    const all=[...open.items,...sealed.items];
    const manifests=await Promise.all(all.map(async route=>[route,await source.manifest(route.id,undefined,{limit:100},signal).catch(()=>null)] as const));
    const on=new Map<string,RouteDto>();
    for(const [route,manifest] of manifests)for(const item of manifest?.items??[])if(parcelIds.includes(item.parcel_id))on.set(item.parcel_id,route);
    // Only trips still being loaded can take more parcels.
    return {open:open.items.filter(route=>!route.planning_progress||route.planning_progress==='scheduled'),on};
  });
}

export function TripPicker({api,parcelIds,done,busy,compact}:{api:ScopedApi;parcelIds:string[];done:()=>void;busy:(v:boolean)=>void;compact?:boolean}){
  const source=useMemo(()=>routes(api),[api]),lotSource=useMemo(()=>lots(api),[api]);
  const trips=useParcelTrip(api,parcelIds);
  const [choice,setChoice]=useState<string>(''),[destination,setDestination]=useState(''),[vehicle,setVehicle]=useState('');
  const [leaves,setLeaves]=useState(()=>(instantToKolkataInput(new Date(Date.now()+3600_000).toISOString())??'').slice(0,16));
  const plan=useRef<ReturnType<typeof routeAttachmentPlan>|null>(null);
  const command=useCommand<RouteDto>(()=>plan.current!.execute());
  const pending=command.phase==='pending'||command.phase==='uncertain';
  useEffect(()=>{busy(pending);},[pending,busy]);
  const already=parcelIds.filter(id=>trips.value?.on.has(id));
  const toAdd=parcelIds.filter(id=>!trips.value?.on.has(id));
  const open=useMemo(()=>trips.value?.open??[],[trips.value]);
  useEffect(()=>{if(!choice&&trips.value)setChoice(open[0]?.id??'new');},[choice,trips.value,open]);
  const instant=kolkataInputToInstant(leaves);
  const ready=toAdd.length>0&&(choice==='new'?destination.trim().length>1&&Boolean(instant):Boolean(choice));
  async function go(){
    if(!ready||pending)return;
    const hub=readPlaces()[0]?.name??'Our hub';
    plan.current??=routeAttachmentPlan({source,lots:lotSource,lotIds:[],parcelIds:toAdd,entryIds:[],
      ...(choice==='new'
        ?{create:{origin:hub,destination:destination.trim(),mode:'road',carrier_code:vehicle.trim().toUpperCase()||null,scheduled_departure_at:instant!}}
        :{route:open.find(route=>route.id===choice)})});
    try{await command.run(source.intent({kind:'finalize',routeId:'00000000-0000-4000-8000-000000000000',body:{expected_version:1}}));plan.current=null;trips.reload();done();}catch{/* notice */}
  }
  if(trips.phase==='loading'&&!trips.value)return <p className="ps-wait" role="status">Looking for open trips…</p>;
  if(trips.phase==='error')return <p className="ps-problem" role="alert">Trips could not be loaded. <button type="button" className="ps-link" onClick={trips.reload}>Try again</button></p>;
  if(toAdd.length===0){
    const route=trips.value?.on.get(parcelIds[0]!);
    return <div className="ps-note"><Msym name="local_shipping"/><span>{parcelIds.length===1?'Already on the trip to ':'All of them are already on a trip'}{parcelIds.length===1&&route?<b>{tripName(route)}</b>:null}. On <Link to="/business/routes">Trips</Link>, press <b>Finish loading</b> and then <b>Record that it has left</b> when the vehicle goes.</span></div>;
  }
  return <div className={'ps-trip'+(compact?' is-compact':'')}>
    {already.length>0&&<p className="ps-wait">{already.length} of these {already.length===1?'is':'are'} already on a trip and will be left as they are.</p>}
    <fieldset className="ps-choices" disabled={pending||plan.current!==null}>
      <legend>Which trip?</legend>
      {open.map(route=><label key={route.id} className={'ps-choice'+(choice===route.id?' is-on':'')}>
        <input type="radio" name="trip" value={route.id} checked={choice===route.id} onChange={()=>setChoice(route.id)}/>
        <span className="ps-choice-ico" aria-hidden="true"><Msym name="local_shipping"/></span>
        <span className="ps-choice-text"><b>To {route.destination}</b><span>{route.carrier_code??'No vehicle yet'} · leaves {when(route.scheduled_departure_at)}</span></span>
      </label>)}
      <label className={'ps-choice'+(choice==='new'?' is-on':'')}>
        <input type="radio" name="trip" value="new" checked={choice==='new'} onChange={()=>setChoice('new')}/>
        <span className="ps-choice-ico" aria-hidden="true"><Msym name="add"/></span>
        <span className="ps-choice-text"><b>Start a new trip</b><span>For a vehicle that is not planned yet</span></span>
      </label>
      {choice==='new'&&<div className="ps-new-trip">
        <label className="ps-field"><span>Going to</span><input value={destination} onChange={event=>setDestination(event.target.value)} placeholder="e.g. Mumbai" maxLength={80} autoComplete="off"/></label>
        <label className="ps-field"><span>Vehicle number <i>(optional)</i></span><input value={vehicle} onChange={event=>setVehicle(event.target.value)} placeholder="e.g. MH12AB4521" maxLength={20} autoComplete="off"/></label>
        <label className="ps-field"><span>Leaves at</span><input type="datetime-local" value={leaves} onChange={event=>setLeaves(event.target.value)}/></label>
      </div>}
    </fieldset>
    <button type="button" className="ps-primary" disabled={!ready||pending} onClick={()=>void go()}>
      <Msym name="local_shipping"/>{pending?'Adding…':plan.current?'Try again':`Add ${toAdd.length===1?'it':toAdd.length+' parcels'} to ${choice==='new'?'the new trip':'this trip'}`}</button>
    <p className="ps-hint">When the vehicle is loaded, open <Link to="/business/routes">Trips</Link>: press <b>Finish loading</b>, then <b>Record that it has left</b>. Every parcel on it moves on together.</p>
    <Problem code={command.error?.code}/>
    <Notice command={command} retry={command.canRetry?()=>{void command.retry().then(()=>{plan.current=null;trips.reload();done();}).catch(()=>{});}:undefined}/>
  </div>;
}

/* ---- on the way / failed: hand it to a delivery agent ------------------------------ */
function Deliver({api,parcel,retry,done,busy}:{api:ScopedApi;parcel:ParcelRead;retry:boolean;done:()=>void;busy:(v:boolean)=>void}){
  const source=useMemo(()=>deliveries(api),[api]),agents=useResource('agents-'+parcel.id,signal=>source.agents(signal));
  const command=useCommand(value=>source.execute(value)),[agent,setAgent]=useState(''),[handover]=useState(()=>mintEventRef());
  const pending=command.phase==='pending'||command.phase==='uncertain';
  useEffect(()=>{busy(pending);},[pending,busy]);
  useEffect(()=>{if(!agent&&agents.value?.items.length===1)setAgent(agents.value.items[0]!.id);},[agent,agents.value]);
  async function go(){if(!agent||pending)return;try{await command.run(source.intent({kind:retry?'retry':'start',parcelId:parcel.id,body:{expected_version:parcel.version,agent_id:agent,handover_evidence_ref:handover}}));done();}catch{/* notice */}}
  if(agents.phase==='loading')return <p className="ps-wait" role="status">Finding delivery agents…</p>;
  // A shop that has not set up delivery codes cannot hand parcels to agents at all; say so
  // plainly instead of offering a retry that will fail the same way.
  if(agents.phase==='error'&&agents.error?.code==='DELIVERIES_DISABLED')return <div className="ps-note"><Msym name="info"/><span>Delivery codes are not set up for this shop yet, so parcels cannot be handed to delivery agents. Ask the owner to finish delivery setup in <b>Settings</b>.</span></div>;
  if(agents.phase==='error')return <p className="ps-problem" role="alert">Delivery agents could not be loaded. <button type="button" className="ps-link" onClick={agents.reload}>Try again</button></p>;
  if(!agents.value?.items.length)return <div className="ps-note"><Msym name="person_add"/><span>No delivery agent is set up for this branch yet. Invite one from <b>Account and invitations</b>, then come back here.</span></div>;
  return <>
    <fieldset className="ps-choices" disabled={pending}>
      <legend>Who is taking it?</legend>
      {agents.value.items.map(item=><label key={item.id} className={'ps-choice'+(agent===item.id?' is-on':'')}>
        <input type="radio" name="agent" value={item.id} checked={agent===item.id} onChange={()=>setAgent(item.id)}/>
        <span className="ps-choice-ico" aria-hidden="true"><Msym name="moped"/></span>
        <span className="ps-choice-text"><b>{item.label}</b></span>
      </label>)}
    </fieldset>
    <button type="button" className="ps-primary" disabled={!agent||pending} onClick={()=>void go()}>
      <Msym name="moped"/>{pending?'Sending…':retry?'Send it out again':'Send it out for delivery'}</button>
    <p className="ps-hint">The customer gets a delivery code on WhatsApp. The agent types it in when they hand the parcel over.</p>
    <Problem code={command.error?.code}/>
    <Notice command={command} retry={command.canRetry?()=>{void command.retry().then(done).catch(()=>{});}:undefined}/>
  </>;
}

/* ---- failed twice: send it back --------------------------------------------------- */
function ReturnToSender({api,parcel,failures,done,busy}:{api:ScopedApi;parcel:ParcelRead;failures:number;done:()=>void;busy:(v:boolean)=>void}){
  const source=useMemo(()=>parcels(api),[api]),command=useCommand(value=>source.execute(value));
  const [reason,setReason]=useState<''|'safety_risk'|'legal_restriction'|'operationally_unserviceable'>('');
  // After two failed tries a parcel may simply go back; before that the owner has to say why.
  const twice=failures>=2,ready=twice||reason!=='';
  const [refs]=useState(()=>({evidence:mintEventRef(),approval:mintEventRef(),plan:mintEventRef()}));
  const pending=command.phase==='pending'||command.phase==='uncertain';
  useEffect(()=>{busy(pending);},[pending,busy]);
  async function go(){if(pending||!ready)return;try{await command.run(source.intent({kind:'rto',parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:refs.evidence,approval_ref:refs.approval,return_plan_ref:refs.plan,...(reason?{override_reason_code:reason}:{})}}));done();}catch{/* notice */}}
  return <div className="ps-rto">
    <label className="ps-field"><span>Why is it going back?</span>
      <select value={reason} disabled={pending} onChange={event=>setReason(event.target.value as typeof reason)}>
        <option value="">{twice?'Delivery failed twice':'Choose a reason'}</option>
        <option value="operationally_unserviceable">We cannot deliver to this place</option>
        <option value="safety_risk">It is not safe to deliver</option>
        <option value="legal_restriction">The law does not allow it</option>
      </select></label>
    {!twice&&<p className="ps-hint">It has failed once. It can go back now only for one of these reasons; otherwise try delivering it again.</p>}
    <button type="button" className={twice?'ps-primary':'ps-secondary'} disabled={pending||!ready} onClick={()=>void go()}><Msym name="assignment_return"/>{pending?'Saving…':'Return to sender'}</button>
    <Problem code={command.error?.code}/>
    <Notice command={command} retry={command.canRetry?()=>{void command.retry().then(done).catch(()=>{});}:undefined}/>
  </div>;
}

function NextStep({row,api,roles,attempts,failures,refresh,busy,finish}:{row:SavedBookingRow;api:ScopedApi;roles:readonly OperatorRole[];attempts:number;failures:number;refresh:()=>void;busy:(v:boolean)=>void;finish:()=>void}){
  const parcel=row.parcel;
  const office=has(roles,'operator','franchise_admin','org_admin','dispatcher');
  const owner=has(roles,'franchise_admin','org_admin');
  if(row.entry)return <Step icon="edit" title="Finish the booking" tone="warn">
    <p>No docket has been made yet, so it cannot be checked in or sent out. Fill in what is missing and save it.</p>
    <button type="button" className="ps-primary" onClick={finish}><Msym name="edit"/>Finish this booking</button>
  </Step>;
  if(!parcel)return null;
  if(!office)return <Step icon="visibility" title="You can view this parcel" tone="muted"><p>Moving parcels needs the owner, counter or dispatcher role.</p></Step>;
  switch(parcel.status){
    case 'booked':return <CheckIn api={api} parcel={parcel} done={refresh} busy={busy}/>;
    case 'checked_in':return <Step icon="local_shipping" title="Put it on a trip"><TripPicker api={api} parcelIds={[parcel.id]} done={refresh} busy={busy}/></Step>;
    case 'dispatched':return <Step icon="schedule" title="Waiting for the vehicle to leave">
      <p>It is on a sealed trip. When the vehicle goes, press <b>Record that it has left</b> on Trips and it moves to <b>In transit</b> by itself.</p>
      <Link className="ps-secondary" to="/business/routes"><Msym name="alt_route"/>Open Trips</Link>
    </Step>;
    case 'in_transit':return <Step icon="moped" title="Send it out for delivery"><Deliver api={api} parcel={parcel} retry={false} done={refresh} busy={busy}/></Step>;
    case 'out_for_delivery':return <Step icon="moped" title="With the delivery agent" tone="muted">
      <p>The customer has a delivery code. The agent marks it delivered, or says why it could not be delivered, from their <b>Deliveries</b> screen.</p>
      <Link className="ps-secondary" to="/business/deliveries"><Msym name="local_shipping"/>Open Deliveries</Link>
    </Step>;
    case 'failed_attempt':return <Step icon="error" title="Delivery did not happen" tone="warn">
      {attempts<2
        ?<><p>Try once more, or send it back if it cannot be delivered.</p><Deliver api={api} parcel={parcel} retry done={refresh} busy={busy}/></>
        :<p>It has been tried twice already.</p>}
      {owner&&<ReturnToSender api={api} parcel={parcel} failures={failures} done={refresh} busy={busy}/>}
    </Step>;
    case 'delivered':return <Step icon="task_alt" title="Delivered" tone="done"><p>Nothing more to do.</p></Step>;
    case 'rto':return <Step icon="assignment_return" title="Going back to the sender" tone="done"><p>Nothing more to do here.</p></Step>;
    case 'cancelled':return <Step icon="block" title="Booking cancelled" tone="muted"><p>Nothing more to do.</p></Step>;
    default:return null;
  }
}

export function ParcelSheet({row,api,roles,lots:lotList,close,refresh,onCancel}:{row:SavedBookingRow;api:ScopedApi;roles:readonly OperatorRole[];lots:LotDto[];close:()=>void;refresh:()=>void;onCancel?:()=>void}){
  const source=useMemo(()=>parcels(api),[api]),lotSource=useMemo(()=>lots(api),[api]);
  const parcel=row.parcel;
  const timeline=useResource(row.id+'-'+(parcel?.version??0)+'-timeline',signal=>parcel?source.timeline(parcel.id,signal):Promise.resolve({items:[]}));
  const membership=useResource(row.id+'-'+(parcel?.version??0)+'-lot',signal=>parcel?lotSource.currentMembership(parcel.id,signal):Promise.resolve(null));
  const lotCommand=useCommand<LotDto|LotMembershipResult>(value=>lotSource.execute(value));
  const [stepBusy,setStepBusy]=useState(false),[printing,setPrinting]=useState(false),[printProblem,setPrintProblem]=useState('');
  const busy=stepBusy||lotCommand.phase==='pending'||lotCommand.phase==='uncertain';
  const busyRef=useRef(busy);busyRef.current=busy;
  const items=row.entry?[{event_id:row.entry.id,occurred_at:row.entry.confirmed_at,label:'Draft saved at the counter',status:'draft'}]
    :(timeline.value?.items??[]).map(item=>({...item,label:item.code==='parcel.booked'?'Booking created at the counter':item.label}));
  const flow=(['booked','checked_in','dispatched','in_transit','out_for_delivery','delivered','failed_attempt','rto'].includes(row.status)?row.status:'booked') as JourneyStatus;
  const recipient=parcel?.recipient;
  async function moveLot(id:string){
    if(!parcel||busy)return;
    try{
      const member=membership.value;
      if(member){const previous=lotList.find(l=>l.id===member.lot_id)??await lotSource.read(member.lot_id);
        if(id){const target=lotList.find(l=>l.id===id);if(!target||id===member.lot_id)return;await lotCommand.run(lotSource.intent({kind:'move',lotId:previous.id,parcelId:parcel.id,body:{expected_version:previous.version,membership_id:member.id,target_lot_id:target.id,expected_target_version:target.version}}));}
        else await lotCommand.run(lotSource.intent({kind:'remove',lotId:previous.id,parcelId:parcel.id,body:{expected_version:previous.version,membership_id:member.id}}));
      }else{const target=lotList.find(l=>l.id===id);if(!target)return;await lotCommand.run(lotSource.intent({kind:'add',lotId:target.id,body:{expected_version:target.version,parcel_id:parcel.id}}));}
      membership.reload();refresh();
    }catch{/* CommandNotice keeps the exact request */}
  }
  async function print(){
    if(printing||!parcel)return;setPrinting(true);setPrintProblem('');
    try{await printReceiptFor(api,await receipts(api).booking(parcel.booking_id));}
    catch{setPrintProblem('The receipt could not be opened. Try printing again.');}
    finally{setPrinting(false);}
  }
  const finish=()=>{window.location.hash='#/business/new-booking?draft='+row.entry!.id;close();};
  const canMoveLot=Boolean(parcel)&&['booked','checked_in'].includes(row.status);
  return <SheetPrimitive.Root open onOpenChange={next=>{if(!next&&!busyRef.current)close();}}>
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="ps-scrim"/>
      <SheetPrimitive.Content className="ps-sheet" aria-describedby={undefined}
        onEscapeKeyDown={event=>{if(busyRef.current)event.preventDefault();}}
        onPointerDownOutside={event=>{if(busyRef.current)event.preventDefault();}}>
        <header className="ps-head">
          <div className="ps-head-text">
            <SheetPrimitive.Title className="ps-title"><span className="ps-docket">{row.docket}</span></SheetPrimitive.Title>
            <div className="ps-head-meta">{statusBadge(row)}{paymentBadge(row)}</div>
          </div>
          {!busy&&<SheetPrimitive.Close className="ps-close" aria-label="Close"><Msym name="close"/></SheetPrimitive.Close>}
        </header>
        <div className="ps-body">
          {row.entry
            ? <p className="ps-draft" role="status"><Msym name="draft"/>This is a draft, not a booking.</p>
            : <div className="ps-journey"><Journey status={flow} timeline={items.map(item=>({ts:Date.parse(item.occurred_at),status:item.status as JourneyStatus,title:item.label}))} format={ts=>formatKolkata(new Date(ts).toISOString(),{day:'numeric',month:'short'})}/></div>}

          <NextStep key={row.status+'-'+(parcel?.version??0)} row={row} api={api} roles={roles} attempts={items.filter(item=>item.status==='out_for_delivery').length} failures={items.filter(item=>item.status==='failed_attempt').length} refresh={()=>{refresh();timeline.reload();}} busy={setStepBusy} finish={finish}/>

          <section className="ps-section" aria-labelledby="ps-details">
            <h3 id="ps-details">Details</h3>
            <dl className="ps-facts">
              <div><dt>From</dt><dd><b>{row.name}</b>{row.phone&&<span>{row.phone}</span>}</dd></div>
              <div><dt>To</dt><dd>{recipient?.name&&<b>{recipient.name}</b>}{recipient?.phone_display&&<span>{recipient.phone_display}</span>}<span>{row.address||'Saved address not recorded'}</span></dd></div>
              <div><dt>Weight</dt><dd>{row.weight===null?'—':row.weight.toLocaleString('en-IN')+' kg'}</dd></div>
              <div><dt>Amount</dt><dd>{money(row.amount)}</dd></div>
              <div><dt>Payment</dt><dd>{row.payment==='paid'?'Paid':row.payment==='topay'?'To Pay':'Not recorded'}</dd></div>
              <div><dt>Lot</dt><dd>{canMoveLot
                ? <select aria-label="Move to lot" className="ps-select" value={row.lotId||''} disabled={busy||membership.phase==='loading'} onChange={event=>void moveLot(event.target.value)}>
                    <option value="">Not in a lot</option>
                    {lotList.filter(l=>l.state==='active'||l.id===row.lotId).map(l=><option key={l.id} value={l.id}>{l.name} · {l.code}</option>)}
                  </select>
                : row.lotCode||'—'}</dd></div>
            </dl>
            <CommandNotice phase={lotCommand.phase} code={lotCommand.error?.code} retry={lotCommand.canRetry?()=>{void lotCommand.retry().then(()=>{membership.reload();refresh();}).catch(()=>{});}:undefined}/>
          </section>

          <section className="ps-section" aria-labelledby="ps-history">
            <h3 id="ps-history">Timeline</h3>
            {timeline.phase==='error'
              ? <button type="button" className="ps-link" onClick={timeline.reload}>Load the timeline again</button>
              : <ol className="ps-timeline">{[...items].reverse().map((item,index)=><li key={item.event_id} className={index===0?'is-now':undefined}>
                  <span className="ps-tl-dot" aria-hidden="true"/><span className="ps-tl-text"><b>{item.label}</b><time dateTime={item.occurred_at}>{when(item.occurred_at)}</time></span>
                </li>)}</ol>}
          </section>
        </div>
        <footer className="ps-foot">
          {row.entry
            ? <button type="button" className="ps-secondary" onClick={()=>void printDraft(row,api)}><Msym name="print"/>Print receipt</button>
            : <button type="button" className="ps-secondary" disabled={printing} onClick={()=>void print()}><Msym name="print"/>{printing?'Opening…':'Print receipt'}</button>}
          {onCancel&&parcel&&(row.status==='booked'||row.status==='checked_in')&&<button type="button" className="ps-cancel" disabled={busy} onClick={onCancel}>Cancel booking</button>}
          {printProblem&&<p role="alert" className="ps-problem">{printProblem}</p>}
        </footer>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  </SheetPrimitive.Root>;
}

/** A draft has no receipt; print what was entered, saying plainly that it is not one. */
async function printDraft(row:SavedBookingRow,api:ScopedApi){
  const {printCounterRecord}=await import('./SavedBookings');
  try{await printCounterRecord(row,api);}catch{/* the window was blocked; nothing was created */}
}
