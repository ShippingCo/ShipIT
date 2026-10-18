import {AccountStatements} from './AccountStatements';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {AccountCreditEvidence} from './AccountCreditEvidence';
import {useEffect,useMemo,useState} from 'react';
import type {CustomerAccountDto,CustomerAccountInput,OperatorRole,PricingRuleInput} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {customerAccounts} from '../data-access/customer-accounts';
import {customers} from '../data-access/customers';
import {useCommand,usePagedResource,useResource} from './hooks';
import {Loading,Failure,Empty,CommandNotice} from './AsyncState';
import {TextField,SelectField} from '../components/m3/Input';
import {formatMoney,formatKolkata,rupeesToPaise,kolkataInputToInstant} from './format';
import {failureMessage} from '../booking/failures';
type Source=ReturnType<typeof customerAccounts>;
const paged=<T,>(p:{items:T[];next_cursor:string|null})=>({items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}});
export default function CustomerAccounts({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 if(!roles.some(role=>['franchise_admin','org_admin','accountant'].includes(role)))return <Empty title="Customer account access unavailable" body="This role cannot manage or read billing profiles."/>;
 return <AccountWorkspace controller={controller} roles={roles}/>;
}
function AccountWorkspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>customerAccounts(api),[api]);
 const list=usePagedResource('accounts',(cursor,signal)=>source.list(cursor??undefined,signal).then(paged));
 const [selected,setSelected]=useState<CustomerAccountDto|null>(null),[editing,setEditing]=useState(false),[revision,setRevision]=useState(0);
 const [locked,setLocked]=useState(false),[blocked,setBlocked]=useState(false);
 useEffect(()=>{const leave=(e:BeforeUnloadEvent)=>{if(locked){e.preventDefault();e.returnValue='';}};const navigate=(e:MouseEvent)=>{if(locked&&e.target instanceof Element&&e.target.closest('a[href]')){e.preventDefault();e.stopPropagation();setBlocked(true);}};const change=(e:Event)=>{if(locked&&e.target instanceof Element&&e.target.matches('select[aria-label="Franchise"]')){e.stopPropagation();(e.target as HTMLSelectElement).value=api.franchise;setBlocked(true);}};window.addEventListener('beforeunload',leave);document.addEventListener('click',navigate,true);document.addEventListener('change',change,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true);document.removeEventListener('change',change,true);};},[locked,api.franchise]);
 useEffect(()=>locked?retainAccountNavigation(api.scope,()=>setBlocked(true)):undefined,[locked,api.scope]);
 const admin=roles.includes('franchise_admin');
 const saved=(account:CustomerAccountDto)=>{setSelected(account);setEditing(false);list.reload();setRevision(n=>n+1);};
 return <div className="ops-page customer-accounts-workspace"><section className="card ops-card"><h1 id="workspace-title" tabIndex={-1} className="t-headline-sm">Customer accounts</h1>
  <p>Monthly customer terms and negotiated rates belong to this franchise. Credit permits deferred payment; it is not a collection.</p>
  {admin&&<button className="btn btn-filled" disabled={locked} onClick={()=>{setSelected(null);setEditing(true);}}>New account</button>}
  {list.phase==='loading'?<Loading/>:list.phase==='error'?<Failure retry={list.reload}/>:!list.items.length?<Empty title="No customer accounts" body="An administrator can link an existing customer and attest the billing contact."/>:<ul className="ops-list">{list.items.map(a=><li key={a.id}><button className="btn btn-text" disabled={locked} onClick={()=>{setSelected(a);setEditing(false);}}>{a.name} · {a.state==='held'?'Held':'Active'} · Limit {formatMoney(a.credit_limit_paise)}</button></li>)}</ul>}
  {list.page.has_more&&<button className="btn btn-text" onClick={list.loadMore}>More accounts</button>}
 </section>
 {blocked&&locked&&<p role="alert">Resolve the retained command before leaving or changing accounts.</p>}
 {editing&&admin?<AccountEditor key={selected?.revision_id??'new'} busyChanged={setLocked} controller={controller} source={source} selected={selected} saved={saved} cancel={()=>{setEditing(false);setSelected(null);list.reload();}}/>:selected&&<>
  <AccountDetails key={selected.revision_id+revision} source={source} account={selected}/>
  <AccountStatements key={selected.id} api={api} controller={controller} account={selected} admin={admin} canExport={admin||roles.includes('accountant')} busyChanged={setLocked}/>
  {admin&&<section className="card ops-card"><button className="btn btn-outlined" disabled={locked} onClick={()=>setEditing(true)}>Revise terms, links or hold</button><RateEditor key={selected.id} source={source} account={selected} parentLocked={locked} busyChanged={setLocked} refreshed={()=>setRevision(n=>n+1)}/></section>}
 </>}
 {admin&&<CreditApprovals source={source} parentLocked={locked} busyChanged={setLocked}/>}
 </div>;
}
function CustomerPicker({controller,disabled,onSelect}:{controller:ScopeController;disabled:boolean;onSelect:(id:string,name:string)=>void}) {
 const source=useMemo(()=>customers(scopedApi(controller)),[controller]);const [search,setSearch]=useState(''),[query,setQuery]=useState('');
 const matches=usePagedResource(query,(cursor,signal)=>query?source.search('name',query,signal,cursor??undefined):Promise.resolve({items:[],page:{has_more:false,next_cursor:null}}));
 return <fieldset disabled={disabled}><legend>Find an existing franchise customer</legend><TextField label="Customer name prefix" value={search} onChange={setSearch}/><button type="button" className="btn btn-outlined" disabled={search.trim().length<3} onClick={()=>setQuery(search.trim())}>Search customers</button>
  {matches.phase==='loading'?<p role="status">Searching…</p>:matches.phase==='error'?<><p role="alert">Customer search failed.</p><button type="button" onClick={matches.reload}>Retry search</button></>:<ul className="ops-list">{matches.items.map(c=><li key={c.id}><button type="button" className="btn btn-text" onClick={()=>onSelect(c.id,c.name)}>{c.name} · {c.phone_display}</button></li>)}</ul>}
  {query&&matches.phase==='empty'&&<p>No customers matched. Create the customer through the existing customer workflow first.</p>}
  {matches.page.has_more&&<button type="button" onClick={matches.loadMore}>More customers</button>}
 </fieldset>;
}
function AccountEditor({controller,source,selected,saved,cancel,busyChanged}:{busyChanged:(value:boolean)=>void;controller:ScopeController;source:Source;selected:CustomerAccountDto|null;saved:(a:CustomerAccountDto)=>void;cancel:()=>void}) {
 const [name,setName]=useState(selected?.name??''),[debtor,setDebtor]=useState(selected?.debtor_customer_id??''),[debtorName,setDebtorName]=useState(selected?'Existing bill-to customer':''),[links,setLinks]=useState<{id:string;name:string}[]>(selected?.shipping_customer_ids.map(id=>({id,name:id===selected.debtor_customer_id?'Bill-to customer':'Linked shipping customer '+id.slice(-8)}))??[]);
 const [contact,setContact]=useState(selected?.billing_contact.name??''),[phone,setPhone]=useState(selected?.billing_contact.phone??''),[reference,setReference]=useState(selected?.billing_contact.authorization_ref??''),[attest,setAttest]=useState(false);
 const [closing,setClosing]=useState(String(selected?.closing_day??'')),[due,setDue]=useState(String(selected?.due_days??'')),[limit,setLimit]=useState(selected?`${BigInt(selected.credit_limit_paise)/100n}.${String(BigInt(selected.credit_limit_paise)%100n).padStart(2,'0')}`:''),[state,setState]=useState<'active'|'held'>(selected?.state??'active'),[reason,setReason]=useState(''),[error,setError]=useState('');
 const command=useCommand(source.executeAccount),locked=command.phase==='pending'||command.canRetry;
 useEffect(()=>{busyChanged(locked);return()=>busyChanged(false);},[locked,busyChanged]);
 async function submit(){
  const paise=rupeesToPaise(limit);if(!attest||!debtor||!links.length||paise===null||!/^\d+$/.test(closing)||!/^\d+$/.test(due)||Number(closing)<1||Number(closing)>31||Number(due)>366){setError('Choose a debtor, linked shipping customers, explicit valid terms, credit limit and contact attestation.');return;}
  const body:CustomerAccountInput={expected_version:selected?.version??0,debtor_customer_id:debtor,shipping_customer_ids:links.map(c=>c.id),name,billing_contact:{name:contact,phone,authorization_ref:reference},closing_day:Number(closing),due_days:Number(due),credit_limit_paise:paise,state,reason};
  try{const result=await command.run(source.configure(selected?.id??null,body));saved(result);}catch(e){setError(failureMessage(e));}
 }
 return <section className="card ops-card"><h2 className="t-title-lg">{selected?'Revise customer account':'New customer account'}</h2><form className="ops-form" onSubmit={e=>{e.preventDefault();void submit();}}>
  <fieldset disabled={locked}><TextField label="Account name" value={name} onChange={setName} required/>
   <p>Bill-to customer: {debtorName||'Select below'}. The debtor identity is fixed once created.</p>
   <CustomerPicker controller={controller} disabled={locked} onSelect={(id,label)=>{if(!debtor){setDebtor(id);setDebtorName(label);}setLinks(rows=>rows.some(r=>r.id===id)?rows:[...rows,{id,name:label}]);}}/>
   {!selected&&debtor&&<button type="button" className="btn btn-text" onClick={()=>{setDebtor('');setDebtorName('');}}>Choose a different bill-to customer</button>}
   <p>Authorized shipping customers (select search results to add):</p><ul>{links.map(c=><li key={c.id}>{c.name} <button type="button" className="btn btn-text" onClick={()=>setLinks(rows=>rows.filter(r=>r.id!==c.id))}>Remove shipping link</button></li>)}</ul>
   <div className="ops-grid"><TextField label="Billing contact name" value={contact} onChange={setContact} required/><TextField label="Billing contact phone" value={phone} onChange={setPhone} required/><TextField label="Contact authority evidence reference" value={reference} onChange={setReference} required/>
   <TextField label="Monthly closing day (1–31)" value={closing} onChange={setClosing} inputMode="numeric" required/><TextField label="Calendar days after closing" value={due} onChange={setDue} inputMode="numeric" required/><TextField label="Credit limit (₹)" value={limit} onChange={setLimit} inputMode="decimal" required/>
   <SelectField label="Account status" value={state} onChange={v=>setState(v as 'active'|'held')} options={[{value:'active',label:'Active'},{value:'held',label:'Held'}]}/><TextField label="Reason for this revision" value={reason} onChange={setReason} required/></div>
   <p>Closing is inclusive in Asia/Kolkata; short months use their last day. Changes apply to future bookings.</p>
   <label><input type="checkbox" checked={attest} onChange={e=>setAttest(e.target.checked)}/> I attest as franchise administrator that this contact is authorized for billing. This does not claim independent legal verification.</label>
   <div className="ops-actions"><button className="btn btn-filled">Save account revision</button><button type="button" className="btn btn-text" onClick={cancel}>Cancel</button></div>
  </fieldset>
 </form>{command.phase==='error'&&<button type="button" className="btn btn-text" onClick={()=>{command.reset();cancel();}}>Discard rejected draft and reload current accounts</button>}{error&&<p role="alert">{error}</p>}<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(result=>{if(result)saved(result);}).catch(()=>{});}:undefined}/></section>;
}
function AccountDetails({source,account}:{source:Source;account:CustomerAccountDto}) {
 const credit=useResource(account.id,s=>source.credit(account.id,s));
 const history=usePagedResource(account.revision_id,(cursor,s)=>source.history(account.id,cursor??undefined,s).then(paged));
 const rates=usePagedResource(account.revision_id,(cursor,s)=>source.rates(account.id,cursor??undefined,s).then(paged));
 return <section className="card ops-card"><h2 className="t-title-lg">{account.name}</h2><p>Version {account.version} · {account.state} · Closing day {account.closing_day} + {account.due_days} calendar days</p><p>Billing contact: {account.billing_contact.name} · {account.billing_contact.phone}</p><p>Admin attestation reference: {account.billing_contact.authorization_ref}</p>
  {credit.phase==='loading'?<Loading/>:credit.phase==='error'?<Failure retry={credit.reload}/>:credit.value&&<p>Outstanding {formatMoney(credit.value.outstanding_paise)} · Available {formatMoney(credit.value.available_paise)} · Overdue {formatMoney(credit.value.overdue_paise)}</p>}
  <>{credit.value&&<AccountCreditEvidence source={source} account={account.id} cutoff={credit.value.as_of}/>}</><h3 className="t-title-md">Terms and contact authority history</h3>{history.phase==='error'?<Failure retry={history.reload}/>:<ol>{history.items.map(h=><li key={h.revision_id}>Version {h.version} · {formatKolkata(h.recorded_at)} · {h.reason} · Limit {formatMoney(h.credit_limit_paise)} · {h.state} · Attested by {h.attested_by}</li>)}</ol>}{history.page.has_more&&<button className="btn btn-text" onClick={history.loadMore}>More revisions</button>}
  <h3 className="t-title-md">Negotiated rate history</h3>{rates.phase==='error'?<Failure retry={rates.reload}/>:!rates.items.length?<p>No negotiated rates. Normal franchise pricing applies.</p>:rates.items.map(r=><div key={r.id}><p>Version {r.version} · {formatKolkata(r.effective_from)} to {formatKolkata(r.effective_to)} · {r.approval_ref}</p><ul>{r.rules.map((rule,i)=><li key={i}>{rule.destination_key} · {rule.service} · {rule.min_weight_grams}–{rule.max_weight_grams??'unlimited'} g · Freight {formatMoney(rule.freight_paise)} · Packing {formatMoney(rule.packing_paise)}</li>)}</ul></div>)}{rates.page.has_more&&<button className="btn btn-text" onClick={rates.loadMore}>More rate history</button>}
 </section>;
}
function RateEditor({source,account,parentLocked,busyChanged,refreshed}:{source:Source;account:CustomerAccountDto;parentLocked:boolean;busyChanged:(value:boolean)=>void;refreshed:()=>void}) {
 const history=usePagedResource(account.id,(cursor,s)=>source.rates(account.id,cursor??undefined,s).then(paged));
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[reference,setReference]=useState(''),[message,setMessage]=useState('');
 const blank=()=>({destination:'',service:'standard' as PricingRuleInput['service'],min:'1',max:'',freight:'',packing:'0'}),[rules,setRules]=useState([blank()]);
 const command=useCommand(source.executeRate),ownLocked=command.phase==='pending'||command.canRetry,locked=parentLocked||ownLocked;
 useEffect(()=>{busyChanged(ownLocked);return()=>busyChanged(false);},[ownLocked,busyChanged]);
 async function submit(){
  const start=kolkataInputToInstant(from),end=kolkataInputToInstant(to);if(!start||!end||start>=end){setMessage('Supply a future effective interval in Asia/Kolkata.');return;}
  const parsed=rules.map(r=>({destination_key:r.destination,service:r.service,min_weight_grams:Number(r.min),max_weight_grams:r.max?Number(r.max):null,freight_paise:rupeesToPaise(r.freight),packing_paise:rupeesToPaise(r.packing)}));
  if(parsed.some(r=>r.freight_paise===null||r.packing_paise===null)){setMessage('Enter money with at most two decimal places.');return;}
  try{await command.run(source.rate(account.id,{expected_version:Math.max(0,...history.items.map(r=>r.version)),effective_from:start,effective_to:end,approval_ref:reference,rules:parsed as PricingRuleInput[]}));history.reload();refreshed();setMessage('Negotiated rate version saved. Existing bookings retain their original price.');}catch(e){setMessage(failureMessage(e));}
 }
 return <form className="ops-form" onSubmit={e=>{e.preventDefault();void submit();}}><h3 className="t-title-md">Publish negotiated rate version</h3><p>Each version replaces the previous schedule from its effective time. If no rule matches, normal franchise pricing applies.</p>
  {history.phase==='error'&&<><p role="alert">Rate history unavailable.</p><button type="button" className="btn btn-text" onClick={history.reload}>Retry rate history</button></>}{command.phase==='error'&&<button type="button" className="btn btn-text" onClick={()=>{command.reset();history.reload();refreshed();setMessage('Review current history and the retained rate draft before publishing again.');}}>Reload after rejected rate command</button>}
  {history.page.has_more&&<button type="button" className="btn btn-text" onClick={history.loadMore}>Load remaining rate versions before publishing</button>}
  <fieldset disabled={locked||history.phase==='loading'||history.phase==='error'||history.page.has_more}><div className="ops-grid"><TextField label="Effective from (Asia/Kolkata)" type="datetime-local" value={from} onChange={setFrom} required/><TextField label="Effective until (Asia/Kolkata)" type="datetime-local" value={to} onChange={setTo} required/><TextField label="Rate approval reference" value={reference} onChange={setReference} required/></div>
   {rules.map((r,i)=><fieldset key={i}><legend>Rate rule {i+1}</legend><div className="ops-grid">{(['destination','min','max','freight','packing'] as const).map((key)=><TextField key={key} label={{destination:'Destination key',min:'Minimum grams (inclusive)',max:'Maximum grams (exclusive, blank unlimited)',freight:'Freight (₹)',packing:'Packing (₹)'}[key]} value={r[key]} onChange={v=>setRules(rows=>rows.map((row,j)=>j===i?{...row,[key]:v}:row))}/>)}<SelectField label="Service" value={r.service} onChange={v=>setRules(rows=>rows.map((row,j)=>j===i?{...row,service:v as PricingRuleInput['service']}:row))} options={[{value:'standard',label:'Standard'},{value:'express',label:'Express'},{value:'same_city',label:'Same city'}]}/></div><button type="button" disabled={rules.length===1} onClick={()=>setRules(rows=>rows.filter((_,j)=>i!==j))}>Remove rule</button></fieldset>)}
   <button type="button" className="btn btn-text" disabled={rules.length>=100} onClick={()=>setRules(rows=>[...rows,blank()])}>Add rate rule</button><button className="btn btn-filled">Publish rate version</button>
  </fieldset><p role="status">{message}</p><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(()=>{history.reload();refreshed();}).catch(()=>{});}:undefined}/>
 </form>;
}
function CreditApprovals({source,parentLocked,busyChanged}:{source:Source;parentLocked:boolean;busyChanged:(value:boolean)=>void}) {
 const pending=usePagedResource('credit-requests',(cursor,s)=>source.pending(cursor??undefined,s).then(paged));
 const [selected,setSelected]=useState(''),[reason,setReason]=useState('');const command=useCommand(source.executeApproval),ownLocked=command.phase==='pending'||command.canRetry,locked=parentLocked||ownLocked;
 useEffect(()=>{busyChanged(ownLocked);return()=>busyChanged(false);},[ownLocked,busyChanged]);
 const review=useResource(selected,signal=>selected?source.review(selected,signal):Promise.resolve(null));
 return <section className="card ops-card"><h2 className="t-title-lg">Credit-limit exception requests</h2><p>Approval applies to one exact, unexpired booking. It never clears a hold or overdue debt.</p><button className="btn btn-outlined" disabled={locked} onClick={pending.reload}>Refresh requests</button>
  {pending.phase==='loading'?<Loading/>:pending.phase==='error'?<Failure retry={pending.reload}/>:!pending.items.length?<p>No unexpired requests waiting for approval.</p>:<ul className="ops-list">{pending.items.map(r=><li key={r.id}><label><input type="radio" name="credit-request" checked={selected===r.id} disabled={locked} onChange={()=>setSelected(r.id)}/>{r.name} · {formatMoney(r.total_paise)} · Expires {formatKolkata(r.expires_at)} · Operator {r.operator_id}</label></li>)}</ul>}
  {pending.page.has_more&&<button className="btn btn-text" onClick={pending.loadMore}>More requests</button>}
  {selected&&(review.phase==='loading'?<Loading label="Loading exact booking intent…"/>:review.phase==='error'?<Failure retry={review.reload}/>:review.value&&<div><h3 className="t-title-md">Review requested booking</h3><p>Shipping customer {review.value.customer_id}, version {review.value.customer_version} · {review.value.destination_key} · {review.value.service}</p><ul>{review.value.parcels.map((p,i)=><li key={i}>{p.recipient_name} · {p.weight_grams} g · Docket {p.docket??'Generated at booking'}</li>)}</ul><p>Credit limit {formatMoney(review.value.credit.credit_limit_paise)} · Available {formatMoney(review.value.credit.available_paise)} · Overdue {formatMoney(review.value.credit.overdue_paise)} · {review.value.account.state}</p><p>Quote {review.value.quote_id} · Tax calculation {review.value.tax_calculation_id}</p><AccountCreditEvidence source={source} account={review.value.account.id} cutoff={review.value.credit.as_of}/></div>)}
  <form className="ops-form" onSubmit={e=>{e.preventDefault();void command.run(source.approve(selected,reason)).then(()=>{pending.reload();setSelected('');setReason('');}).catch(()=>{});}}><TextField label="Credit exception approval reason" value={reason} onChange={setReason} disabled={locked} required/><button className="btn btn-filled" disabled={locked||!selected||review.phase!=='ready'||!review.value||!!review.value.approval_id||reason.trim().length<3}>Approve this booking only</button></form>
  {command.phase==='error'&&command.error&&<><p role="alert">{failureMessage(command.error)}</p><button type="button" className="btn btn-text" onClick={()=>{command.reset();pending.reload();review.reload();}}>Reload after rejected approval</button></>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(()=>pending.reload()).catch(()=>{});}:undefined}/>
 </section>;
}
