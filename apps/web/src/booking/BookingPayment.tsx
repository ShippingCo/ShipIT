import {useEffect,useMemo,useState} from 'react';
import type {ScopeController} from '../operator/scope';
import type {BookingConfirmation} from '../data-access/bookings';
import {moneyReceipts,receivingAccounts} from '../data-access/money-receipts';
import {scopedApi} from '../data-access/scoped-api';
import {useCommand,usePagedResource} from '../operations/hooks';
import {CommandNotice,Failure,Loading} from '../operations/AsyncState';
import {RecordReceipt} from '../operations/MoneyReceipts';
export function BookingPayment({controller,booking,onPendingChange}:{controller:ScopeController;booking:BookingConfirmation;onPendingChange:(value:boolean)=>void}) {
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>moneyReceipts(api),[api]),accounts=useMemo(()=>receivingAccounts(api),[api]);
 const customer={id:booking.account?.debtor.source_customer_id??booking.customer.source_customer_id,name:booking.account?.debtor.name??booking.customer.name};
 const accountList=usePagedResource('booking-receiving-accounts',(cursor,signal)=>accounts.list(cursor??undefined,signal).then(p=>({items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}})));
 const bills=usePagedResource(booking.id,(cursor,signal)=>source.bills(customer.id,cursor??undefined,signal).then(p=>({items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}})));
 const [confirmed,setConfirmed]=useState(false),command=useCommand(intent=>source.execute(intent)),locked=command.phase==='pending'||command.phase==='uncertain';
 useEffect(()=>{onPendingChange(locked);return()=>onPendingChange(false);},[locked,onPendingChange]);
 const run=async(intent:Parameters<typeof source.execute>[0])=>{const result=await command.run(intent);setConfirmed(true);return result;};
 return <section className="booking-payment" aria-label="Record this booking payment">
 <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(()=>setConfirmed(true)).catch(()=>{});}:undefined}/>
 {confirmed?<p role="status">Money received has been recorded. This booking remains saved.</p>:accountList.phase==='loading'||bills.phase==='loading'?<Loading label="Loading payment accounts and current bill…"/>:accountList.phase==='error'?<Failure retry={accountList.reload} label="Receiving accounts could not be loaded."/>:bills.phase==='error'?<Failure retry={bills.reload} label="The current bill could not be loaded."/>:!bills.items.some(b=>b.booking_id===booking.id)?<p role="status">{bills.page.has_more?'Load more bills to find this booking before recording its payment.':'This booking’s bill is not available yet. Reload to check again.'}<button type="button" className="btn btn-text" onClick={bills.reload}>Reload bill</button></p>:<RecordReceipt source={source} customer={customer} accounts={accountList.items.filter(a=>a.active)} bills={bills.items.filter(b=>b.booking_id===booking.id)} locked={locked} run={run} self={api.scope.authority!.userId} initialContext="paid_counter" focusOnMount={false}/>}
 {!confirmed&&accountList.page.has_more&&<button type="button" className="btn btn-text" disabled={locked} onClick={accountList.loadMore}>More receiving accounts</button>}
 {!confirmed&&bills.page.has_more&&!bills.items.some(b=>b.booking_id===booking.id)&&<button type="button" className="btn btn-text" disabled={locked} onClick={bills.loadMore}>Find this booking’s bill</button>}
 </section>;
}
