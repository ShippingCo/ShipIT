import {useCallback,useEffect,useMemo,useState} from 'react';
import {Dialog} from '../components/m3/Dialog';
import {Msym} from '../components/m3/Icon';
import {array,choice,instant,integer,nullable,object,optional,protocol,text,uuid} from '../data-access/dto';
import {ApiFailure,recoveryFor} from '../data-access/errors';
import {retainAccountNavigation} from '../data-access/account-navigation';
import type {CommandIntent} from '../data-access/command-intent';
import type {ScopedApi} from '../data-access/scoped-api';
import {formatMoney} from './format';
import './cancel-bookings.css';

/**
 * Cancelling is instant: the server reverses the charges and refunds whatever was paid in
 * the same step, so the window's job is to say plainly what will happen to the parcels and
 * the money before the operator presses the button, and what to hand back afterwards.
 *
 * Each booking is its own request with its own retry identity. One booking that cannot be
 * cancelled never holds up the others, and a lost reply is retried with the same key.
 */
export type CancelTarget={bookingId:string;docket:string;customer:string|null};

const paise=(value:unknown)=>typeof value==='string'&&/^\d{1,24}$/.test(value)?value:protocol();
const refund=object({method:text,amount_paise:paise});
const preview=object({booking_id:uuid,parcel_count:integer(1),outstanding_paise:paise,refund_paise:paise,refunds:array(refund,20),
  financial_version:integer(),payment_version:integer(),blocked_reason:nullable(text),in_bag:optional(choice(true,false))});
const result=object({id:uuid,booking_id:uuid,parcel_count:integer(1),refunded_paise:paise,refunds:array(refund,20),cancelled_at:instant});
type Preview=ReturnType<typeof preview>;type Result=ReturnType<typeof result>;

const blocked:Record<string,string>={
  already_cancelled:'Already cancelled.',
  parcel_processed:'Already sent on a trip. Use a return instead.',
  operational_commitment:'On a trip or e-way bill. Use a return instead.',
  account_billed:'Already on a monthly account statement.',
  refund_source_missing:'We could not tell how this was paid, so it cannot be refunded here.',
};
const failed:Record<string,string>={
  BOOKING_CANCELLATION_BLOCKED:'It can no longer be cancelled. Check the parcel.',
  VERSION_CONFLICT:'A payment or change was recorded just now. Try again.',
  ACTION_FORBIDDEN:'You are not allowed to cancel bookings.',
};
const reasons=['Customer changed their mind','Booked by mistake','Duplicate booking'];
const method=(m:string)=>({cash:'cash',upi:'UPI',card:'card',bank_transfer:'bank transfer',cheque:'cheque'} as Record<string,string>)[m]??m.replace(/_/g,' ');
const sum=(values:string[])=>values.reduce((a,v)=>a+BigInt(v),0n);
const byMethod=(lists:{method:string;amount_paise:string}[][])=>{
  const totals=new Map<string,bigint>();
  for(const r of lists.flat())totals.set(r.method,(totals.get(r.method)??0n)+BigInt(r.amount_paise));
  return [...totals].filter(([,v])=>v>0n);
};
const plural=(n:number,one:string,many=one+'s')=>`${n} ${n===1?one:many}`;

type Row={target:CancelTarget;preview?:Preview;previewError?:boolean;state:'idle'|'sending'|'done'|'failed'|'uncertain';intent?:CommandIntent;done?:Result;error?:string};

export function CancelBookings({api,targets,close,onCancelled}:{api:ScopedApi;targets:CancelTarget[];close:()=>void;onCancelled:()=>void}){
  const [rows,setRows]=useState<Row[]>(()=>targets.map(target=>({target,state:'idle'})));
  const [pick,setPick]=useState(''),[other,setOther]=useState(''),[running,setRunning]=useState(false),[confirming,setConfirming]=useState(false);
  const reason=(pick==='other'?other:pick).trim();
  const update=useCallback((id:string,change:Partial<Row>)=>setRows(list=>list.map(r=>r.target.bookingId===id?{...r,...change}:r)),[]);
  const path=useCallback((id:string)=>api.path('/api/v1/bookings/'+uuid(id)+'/cancellation'),[api]);
  const load=useCallback((id:string)=>{
    update(id,{preview:undefined,previewError:false,intent:undefined,error:undefined,state:'idle'});
    api.read(path(id),value=>{const dto=preview(value);return dto.booking_id===id?dto:protocol();})
      .then(p=>update(id,{preview:p}),()=>update(id,{previewError:true}));
  },[api,path,update]);
  useEffect(()=>{for(const t of targets)load(t.bookingId);},[targets,load]);

  // Until every reply is confirmed the window stays open, so a retry can reuse the same request.
  const locked=running||rows.some(r=>r.state==='uncertain');
  useEffect(()=>locked?retainAccountNavigation(api.scope,()=>{}):undefined,[locked,api.scope]);
  useEffect(()=>{
    if(!locked)return;
    const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',prevent);
    return ()=>window.removeEventListener('beforeunload',prevent);
  },[locked]);

  const loading=rows.some(r=>!r.preview&&!r.previewError);
  const ready=rows.filter(r=>r.preview&&!r.preview.blocked_reason&&r.state!=='done');
  const finished=rows.filter(r=>r.state==='done');
  const pending=rows.filter(r=>r.state==='failed'||r.state==='uncertain');
  const phase=finished.length&&!running&&!ready.some(r=>r.state==='idle')?'done':'review';
  // A reason is optional. Without one the record says so plainly rather than inventing one.
  const sentReason=reason.length>=3?reason:'No reason given';
  const canSubmit=!running&&!loading&&ready.some(r=>r.state==='idle');

  async function send(row:Row){
    const p=row.preview!;const id=row.target.bookingId;
    const intent=row.intent??api.intent('api.v1.bookings.cancel',path(id),{reason:sentReason,expected_financial_version:p.financial_version,expected_payment_version:p.payment_version});
    update(id,{state:'sending',intent,error:undefined});
    try{
      const done=await api.execute(intent,value=>{const dto=result(value);return dto.booking_id===id?dto:protocol();},['reason','expected_financial_version','expected_payment_version']);
      update(id,{state:'done',done});return true;
    }catch(error){
      const failure=error instanceof ApiFailure?error:new ApiFailure('TEMPORARILY_UNAVAILABLE');
      const uncertain=recoveryFor(failure,true)==='uncertain';
      update(id,uncertain?{state:'uncertain',error:'No reply from the server. Try again to check.'}
        :{state:'failed',intent:undefined,error:failed[failure.code]??'It was not cancelled. Try again.'});
      return false;
    }
  }
  async function run(list:Row[]){
    if(running)return;setRunning(true);let any=false;
    try{for(const row of list)if(await send(row))any=true;}finally{setRunning(false);if(any)onCancelled();}
  }
  function retry(){
    for(const row of pending){if(row.state==='uncertain')continue;load(row.target.bookingId);}
    const again=pending.filter(r=>r.state==='uncertain');if(again.length)void run(again);
  }

  // The money summary covers only the bookings that will actually be cancelled.
  const goingAhead=rows.filter(r=>r.preview&&!r.preview.blocked_reason);
  const refundTotal=sum(goingAhead.map(r=>r.preview!.refund_paise));
  const owedTotal=sum(goingAhead.map(r=>r.preview!.outstanding_paise));
  const parcels=goingAhead.reduce((n,r)=>n+r.preview!.parcel_count,0);
  const skipped=rows.filter(r=>r.preview?.blocked_reason||r.previewError);
  const count=goingAhead.length;
  const bagged=goingAhead.filter(r=>r.preview!.in_bag).length;

  const refunded=sum(finished.map(r=>r.done!.refunded_paise));
  const handBack=byMethod(finished.map(r=>r.done!.refunds));

  const title=phase==='done'?(finished.length===1?'Booking cancelled':`${finished.length} bookings cancelled`)
    :rows.length===1?'Cancel this booking?':'Cancel these bookings?';
  return <Dialog open size="lg" title={title} hideClose={locked} onClose={()=>{if(!locked)close();}}>
   <div className="cb">
    {phase==='done'?<>
      <div className="cb-done" role="status">
        <span className="cb-done-icon" aria-hidden="true"><Msym name="check"/></span>
        <div><b>{plural(finished.reduce((n,r)=>n+r.done!.parcel_count,0),'parcel')} cancelled.</b>
          <span>{refunded>0n?`${formatMoney(refunded.toString())} has been recorded as refunded. Nothing is owed.`:'Nothing was paid, so there is nothing to refund. Nothing is owed.'}</span></div>
      </div>
      {handBack.length>0&&<div className="cb-handback">
        <h3>Give the money back</h3>
        <ul>{handBack.map(([m,v])=><li key={m}><Msym name={m==='cash'?'payments':'account_balance'}/><span>{formatMoney(v.toString())} by {method(m)}</span></li>)}</ul>
        {handBack.some(([m])=>m==='cash')&&<p>In the books, cash comes out of your drawer if it holds enough, otherwise out of the drawer that took the money.</p>}
      </div>}
      {pending.length>0&&<List rows={pending} running={running}/>}
      <div className="cb-actions">
        {pending.length>0&&<button type="button" className="cb-secondary" disabled={running} onClick={retry}>Try the rest again</button>}
        <button type="button" className="cb-primary" disabled={locked} onClick={close}>Done</button>
      </div>
    </>:<>
      {loading?<p className="cb-loading" role="status"><span className="cb-spin" aria-hidden="true"/>Checking {rows.length===1?'the booking':'the bookings'}…</p>:<>
        {count>0?<ul className="cb-facts">
          <li><Msym name="inventory_2"/><span><b>{plural(parcels,'parcel')}</b> in {plural(count,'booking')} will be cancelled right away.</span></li>
          <li><Msym name="currency_rupee"/>{refundTotal>0n
            ?<span><b>{formatMoney(refundTotal.toString())}</b> paid will be refunded to {count===1?'the customer':'the customers'}.</span>
            :<span>Nothing was paid, so there is nothing to refund.</span>}</li>
          {bagged>0&&<li><Msym name="layers"/><span>{bagged===1?'1 booking is':`${bagged} bookings are`} in a bag and will be taken out of it.</span></li>}
          {owedTotal>0n&&<li><Msym name="receipt_long"/><span><b>{formatMoney(owedTotal.toString())}</b> still owed will be cleared.</span></li>}
        </ul>:<p className="cb-none" role="status">{rows.length===1?'This booking cannot be cancelled.':'None of these bookings can be cancelled.'}</p>}
        {(rows.length>1||skipped.length>0||pending.length>0)&&<List rows={rows} running={running} onRetryPreview={load}/>}
      </>}
      {count>0&&<fieldset className="cb-reason" disabled={running}>
        <legend>Why is it being cancelled? <span className="cb-optional">Optional</span></legend>
        <div className="cb-chips">
          {reasons.map(r=><button type="button" key={r} className="cb-chip" aria-pressed={pick===r} onClick={()=>setPick(pick===r?'':r)}>{r}</button>)}
          <button type="button" className="cb-chip" aria-pressed={pick==='other'} onClick={()=>setPick(pick==='other'?'':'other')}>Something else</button>
        </div>
        {pick==='other'&&<label className="cb-other"><span>Reason for cancellation</span>
          <input autoFocus value={other} maxLength={200} onChange={e=>setOther(e.target.value)} placeholder="Type the reason"/></label>}
      </fieldset>}
      {/* A second, explicit yes before anything is sent: cancelling moves money and cannot be undone. */}
      {confirming&&!running&&canSubmit?<div className="cb-confirm" role="alertdialog" aria-labelledby="cb-confirm-q">
        <p id="cb-confirm-q"><Msym name="warning"/><span><b>{count===1?'Cancel this booking':`Cancel ${count} bookings`}{refundTotal>0n?` and refund ${formatMoney(refundTotal.toString())}`:''}?</b> This cannot be undone.</span></p>
        <div className="cb-actions">
          <button type="button" className="cb-secondary" onClick={()=>setConfirming(false)}>Go back</button>
          <button type="button" className="cb-danger" autoFocus onClick={()=>{setConfirming(false);void run(ready.filter(r=>r.state==='idle'));}}>
            {count===1?'Yes, cancel booking':`Yes, cancel ${count} bookings`}</button>
        </div>
      </div>:<>
      <div className="cb-actions">
        <button type="button" className="cb-secondary" disabled={locked} onClick={close}>{count>0?(rows.length===1?'Keep booking':'Keep bookings'):'Close'}</button>
        {pending.length>0&&!running&&!ready.some(r=>r.state==='idle')
          ?<button type="button" className="cb-danger" onClick={retry}>Try again</button>
          :count>0&&<button type="button" className="cb-danger" disabled={!canSubmit} onClick={()=>setConfirming(true)}>
          {running?<><span className="cb-spin" aria-hidden="true"/>Cancelling…</>:count===1?'Cancel booking':`Cancel ${count} bookings`}</button>}
      </div>
      {count>0&&!loading&&<p className="cb-note">This cannot be undone.</p>}
      </>}
    </>}
   </div>
  </Dialog>;
}

function List({rows,running,onRetryPreview}:{rows:Row[];running:boolean;onRetryPreview?:(id:string)=>void}){
  return <ul className="cb-list">{rows.map(r=>{
    const p=r.preview,why=p?.blocked_reason?blocked[p.blocked_reason]??'It cannot be cancelled.':null;
    const status=r.state==='done'?<span className="cb-ok"><Msym name="check_circle"/>Cancelled</span>
      :r.state==='sending'?<span className="cb-wait"><span className="cb-spin" aria-hidden="true"/>Cancelling</span>
      :r.error?<span className="cb-bad">{r.error}</span>
      :r.previewError?<span className="cb-bad">Could not check it.{onRetryPreview&&<> <button type="button" className="cb-link" disabled={running} onClick={()=>onRetryPreview(r.target.bookingId)}>Check again</button></>}</span>
      :why?<span className="cb-skip">{why}</span>
      :p?<span className="cb-amt">{BigInt(p.refund_paise)>0n?`Refund ${formatMoney(p.refund_paise)}`:'Nothing to refund'}
          {p.in_bag&&<small>Comes out of its bag</small>}</span>:null;
    return <li key={r.target.bookingId} className={why&&r.state!=='done'?'is-skipped':undefined}>
      <span className="cb-who"><code>{r.target.docket}</code>{r.target.customer&&<span>{r.target.customer}</span>}</span>{status}
    </li>;
  })}</ul>;
}

/** The single-booking entry used by New Booking and the older package list. */
export function CancelBooking({api,bookingId,docket,close,refresh,onConfirmed}:{api:ScopedApi;bookingId:string;docket:string;close:()=>void;refresh:()=>void;onConfirmed?:()=>void;canReviewCharges?:boolean}){
  const targets=useMemo(()=>[{bookingId,docket,customer:null}],[bookingId,docket]);
  return <CancelBookings api={api} targets={targets} close={close} onCancelled={()=>{onConfirmed?.();refresh();}}/>;
}
