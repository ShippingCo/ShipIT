import {SelectField} from '../components/m3/Input';
import {AccountCreditEvidence} from '../operations/AccountCreditEvidence';
import {useSyncExternalStore} from 'react';
import type {BookingWorkflow} from './workflow';
import {usePagedResource,useResource} from '../operations/hooks';
import {Loading} from '../operations/AsyncState';
import {formatMoney} from '../operations/format';
export function AccountSelection({workflow,disabled}:{workflow:BookingWorkflow;disabled:boolean}) {
 const state=useSyncExternalStore(workflow.subscribe,workflow.snapshot),customer=state.customer;
 const choices=usePagedResource(customer?.id??'none',async(cursor,signal)=>{
  const page=customer?await workflow.accountApi.choices(customer.id,cursor??undefined,signal):{items:[],next_cursor:null};return {items:page.items,page:{has_more:page.next_cursor!==null,next_cursor:page.next_cursor}};
 });
 const credit=useResource(state.accountId??'none',signal=>state.accountId?workflow.accountApi.credit(state.accountId,signal):Promise.resolve(null));
 if(!customer)return <p>Confirm the shipping customer to choose an authorized monthly account.</p>;
 return <section aria-label="Bill-to account"><h3 className="t-title-md">Bill-to account</h3>
  <p>Only accounts explicitly linked to this shipping customer are available. Credit means pay later; it records no receipt.</p>
  {choices.phase==='loading'?<Loading label="Loading linked accounts…"/>:choices.phase==='error'?<div><p role="alert">Account lookup unavailable. Retry before choosing an account.</p><button type="button" disabled={disabled} onClick={choices.reload}>Retry account lookup</button></div>:<>
   <SelectField label="Bill-to account" aria-label="Bill-to account" disabled={disabled} value={state.accountId??''} onChange={workflow.selectAccount} options={[{value:'',label:'Ordinary booking customer'},...choices.items.map(a=>({value:a.id,label:a.name+(a.state==='held'?' · Held':'')}))]}/>{choices.page.has_more&&<button type="button" className="btn btn-text" disabled={disabled} onClick={choices.loadMore}>More linked accounts</button>}
   {!choices.items.length&&<p>No linked monthly accounts.</p>}
  </>}
  {state.accountId&&(credit.phase==='loading'?<Loading label="Checking available credit…"/>:credit.phase==='error'?<div><p role="alert">Credit unavailable. Retry the check.</p><button type="button" disabled={disabled} onClick={credit.reload}>Retry credit check</button></div>:credit.value&&<>
   <p>Available credit <strong>{formatMoney(credit.value.available_paise)}</strong> · Outstanding {formatMoney(credit.value.outstanding_paise)}</p>
   {(credit.value.state==='held'||BigInt(credit.value.overdue_paise)>0n)&&<p role="alert">{credit.value.state==='held'?'Account held.':'Account has overdue debt.'} Resolve this before a credit booking. A limit exception cannot bypass this restriction.</p>}
   <button type="button" className="btn btn-text" disabled={disabled} onClick={credit.reload}>Refresh credit</button><AccountCreditEvidence source={workflow.accountApi} account={state.accountId!} cutoff={credit.value.as_of}/>
  </>)}
  {state.accountId&&state.tax&&<div className="counter-actions">
   <button type="button" className="btn btn-outlined" disabled={state.busy||!!state.creditRequestId||!!state.booking} onClick={()=>{void workflow.requestCredit();}}>{state.creditPhase==='uncertain'?'Retry same credit request':'Request credit-limit exception'}</button>
   {state.creditRequestId&&<button type="button" className="btn btn-outlined" disabled={state.busy} onClick={()=>{void workflow.refreshCreditApproval();}}>Check owner approval</button>}
   {state.creditApprovalId&&<p role="status">Owner approved this booking: {state.creditReason}</p>}
  </div>}
 </section>;
}
