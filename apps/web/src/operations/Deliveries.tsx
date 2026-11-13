import React,{useEffect,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import {canAdminister,type OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {deliveries,type DeliveryState,type ExceptionalReason} from '../data-access/deliveries';
import {parcels} from '../data-access/parcels';
import {payments} from '../data-access/payments';
import {createAttachmentClient} from '../data-access/attachments';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {useDetailReturn} from './detail-return';
import {useCommand,useResource} from './hooks';
import {CommandNotice,DataRefresh,Empty,Failure,Loading} from './AsyncState';
import {PageHeader} from '../components/workspace/Workspace';
import {Button,SegmentedControl} from '../components/m3/Button';
import {Card} from '../components/m3/Surface';
import {CodeField} from '../components/m3/CodeField';
import {TextField} from '../components/m3/Input';
import {Msym} from '../components/m3/Icon';
import {BookingAttachments,useBookingAttachments} from '../booking/BookingAttachments';
import {formatKolkata} from './format';
import {ApiFailure} from '../data-access/errors';
import {receiptMoney} from '../utils/receipt-view';
import './deliveries.css';

/**
 * The last step of a parcel's life, and usually the step where money changes hands.
 *
 * Two things have to be right at the door: the right person takes it, and the right amount is
 * collected. The screen is ordered the way the handover actually happens — money first, then
 * identity — because that is the sequence the agent is standing in, and a screen that asks for
 * them in the other order gets filled in the wrong order.
 *
 * The other thing this screen is for is making a failed attempt a **normal outcome**. When
 * recording one feels like admitting an error, agents stop recording them and mark parcels
 * delivered instead, and the one dataset a shop's reputation rests on quietly rots. So the
 * outcomes are chips in plain words, nothing about them is styled as a failure, and the
 * supervised path for "they cannot give me the code" exists so that it does not become
 * "mark it delivered and move on".
 */

const has=(roles:readonly OperatorRole[],role:OperatorRole)=>roles.includes(role);

/**
 * How a delivery actually fails, in the words the agent would use on the phone.
 *
 * Each one is a different next step for the shop and a different message to the customer,
 * which is why they are five separate things and not one "failed" with a note.
 */
const outcomes=[
  {value:'customer_unavailable',label:'Nobody there'},
  {value:'customer_requests_pickup',label:'Asked to come later'},
  {value:'address_issue',label:'Address is wrong'},
  {value:'payment_not_collected',label:'Would not pay'},
  {value:'recipient_refusal',label:'Refused it'},
] as const;

/** Why the recipient cannot give a code. Each needs a supervisor, not a workaround. */
const exceptionReasons=[
  {value:'recipient_channel_unavailable',label:'Phone not with them'},
  {value:'provider_unavailable',label:'Cannot read the message'},
  {value:'challenge_locked_reviewed',label:'Code locked, already checked'},
] as const;

export default function Deliveries({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>deliveries(api),[api]);
 const queue=useResource('delivery-queue',signal=>source.list(signal),value=>value.items.length===0);
 const [selected,setSelected]=useState<string|null>(null);
 const [locked,setLocked]=useState(false);
 const remember=useDetailReturn(selected);
 useEffect(()=>locked?retainAccountNavigation(api.scope,()=>document.getElementById('delivery-retry-note')?.focus()):undefined,[api.scope,locked]);

 // Who the parcel is for and what it is worth. The delivery record carries neither, so the
 // parcel list supplies the receiver's number and the booking each parcel belongs to.
 const context=useResource(queue.phase==='ready'?'delivery-context':'',async signal=>{
  const list=await parcels(api).list({limit:100},signal);
  return new Map(list.items.map(p=>[p.id,{booking:p.booking_id,phone:p.recipient.phone_display,city:p.details?.city??p.destination_key??''}] as const));
 });

 /* Not configured is not a temporary failure: retrying it can never succeed. The screen says
    what is missing, what still works, and offers the one action that can change it. */
 if(queue.phase==='error'&&queue.error?.code==='DELIVERIES_DISABLED'){
  return <div className="ops-page deliveries-page">
   <PageHeader title="Deliveries" eyebrow="At the door"/>
   <Card className="delivery-off">
    <Msym name="lock" size={32}/>
    <h2>Proof at the door is not switched on for this shop</h2>
    <p><b>Parcels still move and still get delivered.</b> What is missing is the code and photo proof at the door, so a delivery cannot be recorded here with evidence against it.</p>
    <p className="ops-note">Until it is switched on, record what happened against the parcel in Packages, and record money received in Money received.</p>
    <div className="delivery-off-actions">
     <Button onClick={()=>{window.location.href='mailto:?subject='+encodeURIComponent('Please switch on delivery proof for our shop');}}>Ask ShippingCo to switch it on</Button>
     <Link className="btn btn-outlined" to="/business/bookings">Open Packages</Link>
    </div>
   </Card>
  </div>;
 }

 if(selected){
  return <DeliveryDetail key={selected} parcelId={selected} roles={roles} source={source} api={api} controller={controller}
    locked={locked} setLocked={setLocked} context={context.value?.get(selected)}
    close={()=>setSelected(null)} refreshQueue={queue.reload}/>;
 }

 return <div className="ops-page deliveries-page">
  <PageHeader title="Deliveries" eyebrow="At the door" actions={<DataRefresh resource={queue} disabled={locked}/>}/>
  {queue.phase==='loading'&&!queue.value?<Loading label="Loading today&rsquo;s deliveries…"/>
   :queue.phase==='error'?<Failure retry={queue.reload} label="Deliveries could not be loaded."/>
   :queue.phase==='empty'?<Empty icon="local_shipping" title="Nothing to deliver right now" body="Parcels appear here once they are out for delivery and assigned to you."/>
   :<ul className="delivery-queue">{queue.value!.items.map(item=>{
     const extra=context.value?.get(item.parcel_id);
     return <li key={item.attempt_id}>
      <button type="button" className="delivery-row" onClick={()=>{remember();setSelected(item.parcel_id);}} aria-label={'Open '+item.docket}>
       <span className="dq-docket mono">{item.docket}</span>
       <span className="dq-body">
        <span>{extra?.city||'Destination not recorded'}</span>
        <span className="dq-meta">Attempt {item.attempt_number} of 2{item.proof_channel_available===false?' · no code can be sent':''}</span>
       </span>
       <Msym name="chevron_right"/>
      </button>
     </li>;
    })}</ul>}
  {locked&&<p id="delivery-retry-note" tabIndex={-1} role="status">Keep this delivery open until the current action is confirmed.</p>}
 </div>;
}

/**
 * One parcel, at the door.
 *
 * The docket is the page heading at the largest size on the screen: it is the thing the agent
 * reads off the parcel in their hand and matches against the phone. Below it, money before
 * identity. On a prepaid parcel the money card is absent rather than showing a zero — "₹0 to
 * collect" and "no money involved here" are different statements, and only one of them is safe.
 */
function DeliveryDetail({parcelId,roles,source,api,controller,close,refreshQueue,locked,setLocked,context}:{
  parcelId:string;roles:readonly OperatorRole[];source:ReturnType<typeof deliveries>;
  api:ReturnType<typeof scopedApi>;controller:ScopeController;
  close:()=>void;refreshQueue:()=>void;locked:boolean;setLocked:(v:boolean)=>void;
  context?:{booking:string;phone:string|null;city:string};
}){
 const detail=useResource(parcelId,signal=>source.read(parcelId,signal));
 const due=useResource(context?.booking?'due-'+context.booking:'',signal=>
   context?.booking?payments(api,context.booking).read(signal).then(b=>Number(b.outstanding_paise)):Promise.resolve(null));
 useEffect(()=>{if(detail.phase==='ready')document.getElementById('delivery-detail-title')?.focus();},[detail.phase]);
 if(detail.phase==='loading')return <Loading label="Loading this delivery…"/>;
 if(detail.phase==='error')return <Failure retry={detail.reload} label="This delivery is no longer available."/>;
 const current=detail.value!,hasPhone=current.proof_channel_available!==false;
 const refresh=()=>{detail.reload();refreshQueue();};
 const owed=due.value??null;

 return <div className="ops-page deliveries-page delivery-one">
  <Button variant="text" icon="arrow_back" disabled={locked} onClick={close}>All deliveries</Button>
  {/* R-1: the docket is the heading, and the largest thing on the screen. */}
  <h1 id="delivery-detail-title" tabIndex={-1} className="delivery-docket mono">{current.docket}</h1>
  <p className="delivery-sub">{context?.city||'Destination not recorded'} · attempt {current.attempt_number} of 2</p>

  {/* R-2: money first, and absent when there is none to take. */}
  {owed!==null&&owed>0&&<Card className="delivery-money">
   <p className="dm-label">Take before you hand it over</p>
   <p className="dm-value">{receiptMoney(owed)}</p>
   <p className="dm-foot">Count it in your hand before you press anything below.</p>
  </Card>}
  {due.phase==='error'&&<p role="alert">The amount to collect could not be read. Do not hand the parcel over until you know whether money is due.</p>}

  <AtTheDoor current={current} source={source} api={api} controller={controller} roles={roles}
    owed={owed} phone={context?.phone??null} booking={context?.booking??null}
    hasPhone={hasPhone} locked={locked} setLocked={setLocked} confirmed={refresh}/>

  {canAdminister(roles,'deliveries.exception.approve')&&current.exception?.state==='pending'&&
    <Approval current={current} source={source} locked={locked} setLocked={setLocked} confirmed={refresh}/>}
 </div>;
}

function AtTheDoor({current,source,api,controller,roles,owed,phone,booking,hasPhone,locked,setLocked,confirmed}:{
  current:DeliveryState;source:ReturnType<typeof deliveries>;api:ReturnType<typeof scopedApi>;
  controller:ScopeController;roles:readonly OperatorRole[];owed:number|null;phone:string|null;booking:string|null;
  hasPhone:boolean;locked:boolean;setLocked:(v:boolean)=>void;confirmed:()=>void;
}){
 const [proof,setProof]=useState('');
 const [tab,setTab]=useState<'code'|'someone'|'failed'>('code');
 const [reason,setReason]=useState<ExceptionalReason>('recipient_channel_unavailable');
 const [taker,setTaker]=useState('');
 const [outcome,setOutcome]=useState('');
 const [done,setDone]=useState('');
 const command=useCommand(value=>source.execute(value));
 const parcelCommand=useCommand(value=>parcels(api).execute(value));
 const pending=command.phase==='pending'||command.phase==='uncertain'||parcelCommand.phase==='pending'||parcelCommand.phase==='uncertain';
 useEffect(()=>{setLocked(pending);return()=>setLocked(false);},[pending,setLocked]);

 // A photo is the only thing that can stand in for the code, so it is uploaded against this
 // parcel's own booking and its reference is what the supervisor reviews.
 const client=useMemo(()=>booking?createAttachmentClient(controller.runtime,booking):null,[booking,controller]);
 const photos=useBookingAttachments({runtime:controller.runtime,client});
 const photoId=photos.entries.find(entry=>entry.phase==='ready')?.dto?.id??'';

 const active=['pending','active'].includes(current.status);
 const complete=/^\d{6}$/.test(proof);
 const cooldown=Date.now()<Date.parse(current.resend_available_at);
 const isAgent=has(roles,'delivery_agent');

 async function send(action?:Parameters<typeof source.intent>[0]){
  if(action&&(locked||pending))return;
  try{
   const result=action?await command.run(source.intent(action)):await command.retry();
   if(!result)return;
   setProof('');
   if(!('outcome' in result)){
    // R-9: the confirmation names the money, because that is the fact in dispute later.
    setDone(owed&&owed>0?`Delivered. ${receiptMoney(owed)} recorded as collected in cash.`:'Delivered.');
    confirmed();
   }
  }catch(error){
   // R-7: a wrong code clears the boxes. Keeping a wrong code helps nobody, and this is the
   // only place in the product where input is cleared by a failure.
   if(error instanceof ApiFailure&&['DELIVERY_CHALLENGE_EXPIRED','DELIVERY_CHALLENGE_LOCKED','DELIVERY_PROOF_INVALID'].includes(error.code))setProof('');
  }
 }

 async function recordFailure(){
  if(!outcome||!photoId||locked||pending)return;
  try{
   await parcelCommand.run(parcels(api).intent({kind:'failed_attempt',parcelId:current.parcel_id,
     body:{expected_version:current.parcel_version,evidence_ref:photoId,attempt_id:current.attempt_id,
       reason_code:outcome as 'customer_unavailable'}}));
   setDone(current.attempt_number>=2?'Recorded. No attempts left — this now goes back to the sender.':'Recorded. One more attempt is left.');
   confirmed();
  }catch{/* the notice owns it */}
 }

 if(!isAgent&&!canAdminister(roles,'deliveries.exception.approve')){
  return <p className="ops-note">Only the agent carrying this parcel can record what happened at the door.</p>;
 }

 return <>
  {done&&<p className="delivery-done" role="status"><Msym name="check_circle"/><span>{done}</span></p>}

  <SegmentedControl radio className="delivery-tabs" label="What happened at the door" value={tab}
    options={[{value:'code',label:'They gave the code'},{value:'someone',label:'Someone else is taking it'},{value:'failed',label:'It could not be delivered'}]}
    onChange={value=>setTab(value as typeof tab)}/>

  {tab==='code'&&(hasPhone
   ? <Card className="delivery-card">
      {/* R-4: which number it went to. An agent asked "did you get a code?" needs to know
          which phone the shop actually sent it to. */}
      <p className="ops-note">The code was sent to <b>{phone??'a number that is not recorded here'}</b>. It expires {formatKolkata(current.expires_at)}.</p>
      <form onSubmit={event=>{event.preventDefault();if(active&&complete)void send({kind:'complete',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref,challenge_version:current.challenge_version,proof}});}}>
       <CodeField label="The 6 digits they read out" digits={6} value={proof} onChange={setProof} disabled={locked||pending||!active} required/>
       {/* R-5: the button names both halves of what it does. R-6: not pressable until the code is whole. */}
       <Button type="submit" disabled={!complete||locked||pending||!active}>
        {owed&&owed>0?`Take ${receiptMoney(owed)} and complete delivery`:'Complete delivery'}</Button>
      </form>
      {command.result&&'outcome' in command.result&&<p className="delivery-wrong" role="alert">
       That code is not right. {command.result.remaining_attempts} {command.result.remaining_attempts===1?'try':'tries'} left. Ask them to read it again.</p>}
      {/* R-8: an expired code says so and offers exactly one thing. */}
      {current.status==='expired'
       ? <div className="delivery-expired"><p role="alert">That code expired {formatKolkata(current.expires_at)}.</p>
          <Button variant="outlined" disabled={locked||pending||current.resends_remaining===0}
            onClick={()=>void send({kind:'replace',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref,reason_code:'expired'}})}>Send a new code</Button></div>
       : <div className="delivery-resend">
          <Button variant="text" disabled={locked||pending||cooldown||current.resends_remaining===0||!active}
            onClick={()=>void send({kind:'resend',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,challenge_ref:current.challenge_ref}})}>Send the same code again</Button>
          <span className="ops-note">{current.resends_remaining===0?'No more sends left. Use "Someone else is taking it" instead.':cooldown?'You can send again after '+formatKolkata(current.resend_available_at)+'.':'Keeps the same code and the same expiry.'}</span>
         </div>}
     </Card>
   : <Card className="delivery-card"><p role="status">No phone number was given for this parcel, so no code can be sent. Use <b>Someone else is taking it</b> below, which a manager has to approve.</p></Card>)}

  {tab==='someone'&&<Card className="delivery-card">
   {current.exception?.state==='approved'&&current.exception.approval_ref
    ? <>
       <p role="status">A manager approved this handover. The delivery will be recorded at the time you hand it over, not at the time it was approved.</p>
       <Button disabled={locked||pending} onClick={()=>void send({kind:'exception_complete',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,approval_ref:current.exception!.approval_ref!}})}>
        {owed&&owed>0?`Take ${receiptMoney(owed)} and complete delivery`:'Complete delivery'}</Button>
      </>
    : current.exception?.state==='pending'
     ? <p role="status">A manager has been asked. <b>This parcel is not delivered yet.</b> The customer has been told it needs checking, and nothing more will happen until the manager answers.</p>
     : <>
        <p className="field-legend">Why can they not give the code?</p>
        <SegmentedControl radio className="delivery-reasons" label="Why they cannot give the code" value={reason}
          options={exceptionReasons.map(r=>({value:r.value,label:r.label}))} onChange={value=>setReason(value as ExceptionalReason)}/>
        <TextField label="Who is taking it" value={taker} onChange={setTaker} maxLength={120} required
          helper="Their name, as they give it. A manager will read this."/>
        <div className="delivery-photo">
         <span className="field-legend">A photo of the handover</span>
         {/* R-13: why, not just what. */}
         <p className="ops-note">This is required. It is the only proof that replaces the code.</p>
         <BookingAttachments queue={photos} disabled={locked||pending}/>
        </div>
        {/* R-14: what happens next, before the press. */}
        <p className="delivery-before" role="status">
         A manager has to approve this. <b>The parcel is not delivered until they do.</b> The customer will be told that someone else is collecting it and that the shop is checking.
         {owed&&owed>0&&<> The {receiptMoney(owed)} you take is recorded straight away, separately from the approval — cash in your hand is a fact, whether the handover is allowed is a judgment.</>}
        </p>
        <Button disabled={locked||pending||!taker.trim()||!photoId}
          onClick={()=>void send({kind:'exception_request',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,reason_code:reason,evidence_id:photoId,recipient_present:true}})}>
         Ask a manager to approve this handover</Button>
        {!photoId&&<p className="ops-note">Add the photo first.</p>}
       </>}
  </Card>}

  {tab==='failed'&&<Card className="delivery-card">
   {/* R-24: a failed attempt is a normal outcome. Nothing here is styled as an error. */}
   <p className="field-legend">What happened?</p>
   <SegmentedControl radio className="delivery-outcomes" label="What happened" value={outcome}
     options={outcomes.map(o=>({value:o.value,label:o.label}))} onChange={setOutcome}/>
   {outcome==='address_issue'&&<p className="ops-note">If they told you the right address, say so in the photo or ring the shop — the customer confirms a corrected address before anyone tries again.</p>}
   {outcome==='payment_not_collected'&&<p className="ops-note">This goes to the shop to decide, not to the customer. Nobody is messaged about it.</p>}
   {outcome&&outcome!=='payment_not_collected'&&<p className="ops-note">The customer will be asked when to try again, and their answer lands in Pickup requests.</p>}
   <div className="delivery-photo">
    <span className="field-legend">A photo of where you are</span>
    <p className="ops-note">This is what shows the attempt really happened.</p>
    <BookingAttachments queue={photos} disabled={locked||pending}/>
   </div>
   {/* R-20: what is left, and what happens when it runs out, in the sender's words. */}
   <p className="delivery-before" role="status">
    {current.attempt_number>=2
     ? <>This is the last attempt. <b>After this it goes back to the sender.</b></>
     : <>One more attempt is left after this one. Then it goes back to the sender.</>}
   </p>
   <Button disabled={locked||pending||!outcome||!photoId} onClick={()=>void recordFailure()}>Record what happened</Button>
   {!photoId&&<p className="ops-note">Add the photo first.</p>}
  </Card>}

  {/* R-10: the one sentence that matters when a COD delivery fails in an unknown state. */}
  <CommandNotice phase={command.phase} code={command.error?.code}
    money={owed&&owed>0?`${receiptMoney(owed)} may or may not be recorded. Do not take the money again.`:undefined}
    retry={command.canRetry?()=>void send():undefined}/>
  <CommandNotice phase={parcelCommand.phase} code={parcelCommand.error?.code}
    retry={parcelCommand.canRetry?()=>{void parcelCommand.retry().then(()=>confirmed()).catch(()=>{});}:undefined}/>
 </>;
}

function Approval({current,source,locked,setLocked,confirmed}:{
  current:DeliveryState;source:ReturnType<typeof deliveries>;locked:boolean;setLocked:(v:boolean)=>void;confirmed:()=>void;
}){
 const approve=useCommand(value=>source.execute(value));
 const pending=approve.phase==='pending'||approve.phase==='uncertain';
 useEffect(()=>{setLocked(pending);return()=>setLocked(false);},[pending,setLocked]);
 const label=exceptionReasons.find(r=>r.value===current.exception!.reason_code)?.label??current.exception!.reason_code.replaceAll('_',' ');
 async function submit(retry=false){
  if(!retry&&(locked||pending))return;
  try{
   if(retry)await approve.retry();
   else await approve.run(source.intent({kind:'exception_approve',parcelId:current.parcel_id,body:{expected_version:current.parcel_version,request_id:current.exception!.request_id}}));
   confirmed();
  }catch{/* keep the command for its retry control */}
 }
 return <Card className="delivery-card">
  <h2 className="t-title-sec">A manager needs to decide</h2>
  <p>The agent says: <b>{label}</b>. Approving records the delivery at the time of the handover, not now. Refusing sends it back to &ldquo;out for delivery&rdquo; and the agent is told why.</p>
  <Button disabled={locked||pending} onClick={()=>void submit()}>Approve this handover</Button>
  <CommandNotice phase={approve.phase} code={approve.error?.code} retry={approve.canRetry?()=>void submit(true):undefined}/>
 </Card>;
}
