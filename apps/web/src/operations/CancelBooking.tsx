import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {TextField} from '../components/m3/Input';
import {OperationDialog} from '../components/workspace/OperationDialog';
import {choice,instant,integer,nullable,object,protocol,uuid} from '../data-access/dto';
import type {ScopedApi} from '../data-access/scoped-api';
import {useCommand,useResource} from './hooks';
import {formatMoney} from './format';
import {Failure,Loading} from './AsyncState';

const reasons={
  already_cancelled:'This booking has already been cancelled.',
  parcel_processed:'A parcel has already been processed. Contact the branch handling the parcel.',
  operational_commitment:'A parcel is linked to delivery work. Review its lot, route and handover before cancelling.',
  money_recorded:'Money has already been recorded against this booking. Ask your accounts team to review it.',
  account_billed:'This booking has already entered account billing. Ask your accounts team to review it.',
};
const paise=(value:unknown)=>typeof value==='string'&&/^\d{1,24}$/.test(value)?value:protocol();
const preview=object({booking_id:uuid,parcel_count:integer(1),outstanding_paise:paise,financial_version:integer(),payment_version:integer(),
  blocked_reason:nullable(choice('already_cancelled','parcel_processed','operational_commitment','money_recorded','account_billed'))});
const response=object({id:uuid,booking_id:uuid,parcel_count:integer(1),outstanding_paise:paise,cancelled_at:instant});

export function CancelBooking({api,bookingId,docket,close,refresh,canReviewCharges}:{api:ScopedApi;bookingId:string;docket:string;close:()=>void;refresh:()=>void;canReviewCharges:boolean}) {
  const path=api.path('/api/v1/bookings/'+uuid(bookingId)+'/cancellation');
  const [reason,setReason]=useState('');
  const review=useResource(bookingId,signal=>api.read(path,value=>{
    const dto=preview(value);return dto.booking_id===bookingId?dto:protocol();
  },signal));
  const command=useCommand<ReturnType<typeof response>>(intent=>api.execute(intent,value=>{
    const dto=response(value);return dto.booking_id===bookingId?dto:protocol();
  },['reason','expected_financial_version','expected_payment_version']));
  const sending=useRef(false);
  const busy=command.phase==='pending'||command.phase==='uncertain';
  useEffect(()=>{
    if(!busy)return;
    const prevent=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',prevent);
    return ()=>window.removeEventListener('beforeunload',prevent);
  },[busy]);
  async function submit(retry=false) {
    if(sending.current||!review.value||review.value.blocked_reason)return;
    sending.current=true;
    try {
      if(retry)await command.retry();
      else await command.run(api.intent('api.v1.bookings.cancel',path,{reason:reason.trim(),
        expected_financial_version:review.value.financial_version,expected_payment_version:review.value.payment_version}));
      refresh();
    } catch { /* The command retains the original request for uncertain outcomes. */ }
    finally {sending.current=false;}
  }
  const info=review.value,done=command.result,valid=reason.trim().length>=3&&reason.trim().length<=200&&Array.from(reason).every(char=>{const code=char.charCodeAt(0);return code>=32&&(code<127||code>159);});
  return <OperationDialog title={done?'Booking cancelled':'Cancel booking'} close={close} busy={busy}>
    {done?<><p role="status">Cancelled {done.parcel_count} {done.parcel_count===1?'parcel':'parcels'} in this booking.</p>
      {BigInt(done.outstanding_paise)>0n&&<p>The bill still shows {formatMoney(done.outstanding_paise)} outstanding. Ask accounts to review the charges.{canReviewCharges&&<> <Link to={'/business/financials?booking_id='+bookingId}>Financial approvals</Link></>}</p>}
      <button type="button" className="btn btn-filled" onClick={close}>Done</button></>:
      review.phase==='error'?<Failure label="Could not check this booking." retry={review.reload}/>:!info?<Loading label="Checking booking…"/>:
      info.blocked_reason?<><p role="status">{reasons[info.blocked_reason]}</p><button className="btn btn-outlined" type="button" onClick={close}>Close</button></>:
      <form className="ops-form" onSubmit={event=>{event.preventDefault();if(valid&&!busy&&command.phase!=='error')void submit();}}>
        <p>Cancel all <strong>{info.parcel_count}</strong> {info.parcel_count===1?'parcel':'parcels'} in the booking containing docket <strong>{docket}</strong>? They will no longer be available for intake or dispatch.</p>
        {BigInt(info.outstanding_paise)>0n&&<p>The bill will still show <strong>{formatMoney(info.outstanding_paise)}</strong> outstanding. Accounts handles charge reversals separately.</p>}
        <TextField label="Reason for cancellation" value={reason} maxLength={200} onChange={setReason} disabled={busy} required/>
        {command.phase==='uncertain'?<><p role="alert">The result is unconfirmed. Retry the same cancellation to check it.</p><button type="button" className="btn btn-filled" onClick={()=>void submit(true)}>Retry same cancellation</button></>:
        command.phase==='error'?<><p role="alert">Cancellation was not confirmed. Check the current booking before trying again.</p><button type="button" className="btn btn-outlined" onClick={()=>{command.reset();review.reload();}}>Check booking again</button></>:
        <div className="ops-actions"><button type="button" className="btn btn-outlined" disabled={busy} onClick={close}>Keep booking</button>
          <button type="submit" className="btn btn-filled" disabled={!valid||busy}>{busy?'Cancelling…':'Confirm cancellation'}</button></div>}
      </form>}
  </OperationDialog>;
}
