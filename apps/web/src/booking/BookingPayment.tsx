import {useEffect,useMemo,useRef,useState} from 'react';
import type {ScopeController} from '../operator/scope';
import type {BookingConfirmation} from '../data-access/bookings';
import {moneyReceipts,receivingAccounts} from '../data-access/money-receipts';
import {scopedApi} from '../data-access/scoped-api';
import {resourceLoaded,useCommand,usePagedResource} from '../operations/hooks';
import {CommandNotice,Failure,Loading} from '../operations/AsyncState';
import {RecordReceipt} from '../operations/MoneyReceipts';
import {formatMoney} from '../operations/format';

const methodWords={cash:'cash',upi:'UPI'} as const;

/**
 * Records the money for a booking that was just saved.
 *
 * With `auto`, the counter already said how the customer paid (cash or UPI) before saving, so
 * asking again on this screen was a second entry of the same fact. The payment is recorded
 * straight away for the full amount, into the one receiving account that takes that method,
 * received and held by the person who saved the booking. The form below is only shown when that
 * cannot be decided here: no account takes the method, more than one does, or the save failed.
 */
export function BookingPayment({controller,booking,onPendingChange,auto,onRecorded}:{controller:ScopeController;booking:BookingConfirmation;onPendingChange:(value:boolean)=>void;
 auto?:{method:'cash'|'upi'};
 /** Paise applied to this booking by a payment recorded here. */
 onRecorded?:(appliedPaise:number)=>void}) {
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>moneyReceipts(api),[api]),accounts=useMemo(()=>receivingAccounts(api),[api]);
 const customer={id:booking.account?.debtor.source_customer_id??booking.customer.source_customer_id,name:booking.account?.debtor.name??booking.customer.name};
 const accountList=usePagedResource('booking-receiving-accounts',(cursor,signal)=>accounts.list(cursor??undefined,signal).then(p=>({items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}})));
 const bills=usePagedResource(booking.id,(cursor,signal)=>source.bills(customer.id,cursor??undefined,signal).then(p=>({items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}})));
 const [confirmed,setConfirmed]=useState(false),command=useCommand(intent=>source.execute(intent)),locked=command.phase==='pending'||command.phase==='uncertain';
 useEffect(()=>{onPendingChange(locked);return()=>onPendingChange(false);},[locked,onPendingChange]);
 const settle=(result:Awaited<ReturnType<typeof source.execute>>)=>{setConfirmed(true);onRecorded?.(result.allocations.filter(a=>a.booking_id===booking.id&&a.kind==='allocation').reduce((sum,a)=>sum+a.amount_paise,0));};
 const run=async(intent:Parameters<typeof source.execute>[0])=>{const result=await command.run(intent);settle(result);return result;};
 // One automatic attempt per saved booking. A second would be a second receipt.
 const attempted=useRef(false);
 const [autoSent,setAutoSent]=useState<number|null>(null),[autoNote,setAutoNote]=useState('');
 const bill=bills.items.find(b=>b.booking_id===booking.id);
 const settled=accountList.phase!=='loading'&&accountList.phase!=='error'&&bills.phase!=='loading'&&bills.phase!=='error';
 // Held in a ref so the effect below depends only on what decides when to try: the chosen
 // method, and the accounts and the bill having arrived.
 const attempt=useRef(()=>{});
 attempt.current=()=>{
  if(!auto||attempted.current||!settled||!bill)return;
  attempted.current=true;
  if(bill.outstanding_paise<=0)return;
  const word=methodWords[auto.method],takes=accountList.items.filter(a=>a.active&&a.methods.includes(auto.method));
  if(!takes.length){setAutoNote(`No receiving account takes ${word} yet, so this payment was not recorded. An administrator sets one up under Receiving accounts.`);return;}
  if(takes.length>1||accountList.page.has_more){setAutoNote(`More than one account takes ${word}. Choose where this money went.`);return;}
  const account=takes[0]!,self=api.scope.authority!.userId;
  setAutoSent(bill.outstanding_paise);
  // A moment in the past: the server refuses a receipt timed after its own clock.
  void run(source.record({customer_id:customer.id,account_id:account.id,expected_account_version:account.version,method:auto.method,amount_paise:bill.outstanding_paise,currency:'INR',
   receiver_id:self,custodian_id:self,occurred_at:new Date(Date.now()-2000).toISOString(),external_reference:null,
   allocations:[{booking_id:booking.id,amount_paise:bill.outstanding_paise,context:'paid_counter',expected_payment_version:bill.expected_payment_version}]})).catch(()=>{/* the notice below reports it */});
 };
 useEffect(()=>{attempt.current();},[auto,settled,bill]);
 const autoBusy=autoSent!==null&&locked;
 return <section className="booking-payment" aria-label="Record this booking payment">
 <CommandNotice phase={command.phase} code={command.error?.code}
  money="Do not take the payment again until you have checked. Checking cannot charge twice."
  retry={command.canRetry?()=>{void command.retry().then(result=>{if(result)settle(result);}).catch(()=>{});}:undefined}/>
 {!confirmed&&autoNote&&<p role="status">{autoNote}</p>}
 {!confirmed&&autoSent!==null&&command.phase==='error'&&<p role="alert">{formatMoney(autoSent)} was not recorded automatically. Record it below.</p>}
 {confirmed?<p role="status">{autoSent!==null&&auto?`${formatMoney(autoSent)} received by ${methodWords[auto.method]} has been recorded.`:'Money received has been recorded. This booking remains saved.'}</p>:autoBusy?null:accountList.phase==='loading'||bills.phase==='loading'?<Loading label="Loading payment accounts and current bill…"/>:accountList.phase==='error'?<Failure retry={accountList.reload} label="Receiving accounts could not be loaded."/>:bills.phase==='error'?<Failure retry={bills.reload} label="The current bill could not be loaded."/>:!bills.items.some(b=>b.booking_id===booking.id)?<p role="status">{bills.page.has_more?'Load more bills to find this booking before recording its payment.':'This booking’s bill is not available yet. Reload to check again.'}<button type="button" className="btn btn-text" onClick={bills.reload}>Reload bill</button></p>:<RecordReceipt source={source} customer={customer} accounts={accountList.items.filter(a=>a.active)} accountsReady={resourceLoaded(accountList)} bills={bills.items.filter(b=>b.booking_id===booking.id)} locked={locked} run={run} self={api.scope.authority!.userId} initialContext="paid_counter" focusOnMount={false}/>}
 {!confirmed&&accountList.page.has_more&&<button type="button" className="btn btn-text" disabled={locked} onClick={accountList.loadMore}>More receiving accounts</button>}
 {!confirmed&&bills.page.has_more&&!bills.items.some(b=>b.booking_id===booking.id)&&<button type="button" className="btn btn-text" disabled={locked} onClick={bills.loadMore}>Find this booking’s bill</button>}
 </section>;
}
