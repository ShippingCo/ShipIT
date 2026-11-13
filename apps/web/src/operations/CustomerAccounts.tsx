import {FinancePosition} from './FinancePosition';
import {PageHeader,WorkflowTabs,RecordTable,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import {AccountStatements} from './AccountStatements';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {AccountCreditEvidence} from './AccountCreditEvidence';
import {useEffect,useMemo,useRef,useState} from 'react';
import './customer-report-flows.css';
import type {CustomerAccountDto,CustomerAccountInput,OperatorRole,PricingRuleInput} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {customerAccounts} from '../data-access/customer-accounts';
import {customers} from '../data-access/customers';
import {useCommand,usePagedResource,useResource} from './hooks';
import {DataRefresh,Loading,Failure,Empty,CommandNotice} from './AsyncState';
import {TextField,SelectField} from '../components/m3/Input';
import {formatMoney,formatKolkata,rupeesToPaise,kolkataInputToInstant} from './format';
import {failureMessage} from '../booking/failures';
import {PhoneField} from '../booking/PhoneField';
type Source=ReturnType<typeof customerAccounts>;
const paged=<T,>(p:{items:T[];next_cursor:string|null})=>({items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}});
export default function CustomerAccounts({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 if(!(canAdminister(roles,'customer_accounts.configure')||roles.some(role=>['franchise_admin','org_admin','accountant'].includes(role))))return <Empty title="Customer account access unavailable" body="This role cannot manage or read billing profiles."/>;
 return <AccountWorkspace controller={controller} roles={roles}/>;
}
/**
 * Customers who pay by monthly bill, and how much rope each of them has left.
 *
 * The list is ordered by risk rather than by name: the account closest to its limit is the one
 * a manager has to do something about, and alphabetical order buries it. Usage is drawn as a
 * bar and written as a figure, and past the limit both of them change — the shape and the
 * number say the same thing, so neither has to be read on its own.
 *
 * An account over its limit carries the consequence rather than the state: what stops is new
 * bookings, and what starts is a manager being asked to approve each one.
 */
function AccountWorkspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>customerAccounts(api),[api]);
 const list=usePagedResource('accounts',(cursor,signal)=>source.list(cursor??undefined,signal).then(paged));
 const [selected,setSelected]=useState<CustomerAccountDto|null>(null),[editing,setEditing]=useState(false),[revision,setRevision]=useState(0);
 const [accountView,setAccountView]=useState('overview');
 const [locked,setLocked]=useState(false),[blocked,setBlocked]=useState(false);
 useEffect(()=>{const leave=(e:BeforeUnloadEvent)=>{if(locked){e.preventDefault();e.returnValue='';}};const navigate=(e:MouseEvent)=>{if(locked&&e.target instanceof Element&&e.target.closest('a[href]')){e.preventDefault();e.stopPropagation();setBlocked(true);}};const change=(e:Event)=>{if(locked&&e.target instanceof Element&&e.target.matches('select[aria-label="Franchise"]')){e.stopPropagation();(e.target as HTMLSelectElement).value=api.franchise;setBlocked(true);}};window.addEventListener('beforeunload',leave);document.addEventListener('click',navigate,true);document.addEventListener('change',change,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true);document.removeEventListener('change',change,true);};},[locked,api.franchise]);
 useEffect(()=>locked?retainAccountNavigation(api.scope,()=>setBlocked(true)):undefined,[locked,api.scope]);
 const admin=canAdminister(roles,'customer_accounts.configure');
 /**
  * What each account currently owes against its limit.
  *
  * One read per account. There is no list endpoint that carries credit, and a shop has a
  * handful of monthly accounts rather than hundreds, so the first twenty are enriched and the
  * rest say plainly that their figures were not read — never that they owe nothing.
  */
 const credit=useResource('credit-'+list.items.map(a=>a.id).join(',')+'-'+revision,async signal=>{
  const rows=await Promise.all(list.items.slice(0,20).map(async account=>{
   const value=await source.credit(account.id,signal).catch(()=>null);
   return [account.id,value] as const;
  }));
  return new Map(rows);
 });
 const owedOf=(id:string)=>{const row=credit.value?.get(id);return row?Number(row.outstanding_paise):null;};
 const usageOf=(account:CustomerAccountDto)=>{
  const owed=owedOf(account.id);
  return owed===null||!account.credit_limit_paise?null:owed/account.credit_limit_paise;
 };
 // R-3: ordered by risk. The account nearest its limit is the one somebody has to act on.
 const byRisk=[...list.items].sort((a,b)=>(usageOf(b)??-1)-(usageOf(a)??-1));
 const onCredit=list.items.length;
 const totalOwed=list.items.reduce((sum,a)=>sum+(owedOf(a.id)??0),0);
 const overLimit=list.items.filter(a=>(usageOf(a)??0)>1).length;
 useEffect(()=>{if(selected&&!editing)document.getElementById('customer-accounts-title')?.focus();},[selected,editing]);
 const saved=(account:CustomerAccountDto)=>{setSelected(account);setAccountView('overview');setEditing(false);list.reload();setRevision(n=>n+1);};
 return <div className="ops-page customer-accounts-workspace"><section className="finance-workspace-intro"><PageHeader id="customer-accounts-title" title={selected&&!editing?selected.name:"Customer accounts"} eyebrow="Money · Customer dues"/>
  {!editing&&!selected&&<>{admin&&<button className="btn btn-filled finance-account-create" disabled={locked} onClick={()=>{setSelected(null);setEditing(true);}}>New account</button>}
  {/* R-1: three figures, and only the one that needs acting on is coloured. */}
  {list.phase==='ready'&&list.items.length>0&&<section className="credit-figures" aria-label="Customers on credit">
   <div><span className="cf-value">{onCredit}</span><span className="cf-label">{onCredit===1?'customer on credit':'customers on credit'}</span></div>
   <div><span className="cf-value">{credit.phase==='ready'?formatMoney(totalOwed):'—'}</span><span className="cf-label">owed in total</span></div>
   <div><span className={'cf-value'+(overLimit?' is-over':'')}>{credit.phase==='ready'?overLimit:'—'}</span><span className="cf-label">over their limit</span></div>
  </section>}
  {/* R-6: the consequence, not the state. */}
  {overLimit>0&&<p className="credit-warning" role="alert">
   {overLimit===1?'One account is':overLimit+' accounts are'} over the limit. New bookings on {overLimit===1?'it':'them'} will stop and ask a manager to approve each one.</p>}
  {credit.phase==='error'&&<p role="alert">How much each account owes could not be read. Those figures are missing, not zero.</p>}
  {list.items.length>20&&<p className="ops-note">Owed figures are shown for the twenty accounts nearest their limit.</p>}
  {list.phase==='loading'?<Loading/>:list.phase==='error'?<Failure retry={list.reload}/>:!list.items.length?<Empty icon="business" title="No customer accounts" body={admin?'Create an account for customers who pay by monthly bill.':'Monthly billing accounts appear here when your administrator sets them up.'}/>:<RecordTable mobile="stack" label="Customer accounts" rows={byRisk} rowKey={a=>a.id} columns={[
 {key:'account',label:'Account',cell:a=><button id={'customer-account-row-'+a.id} className="btn btn-text" disabled={locked} aria-label={a.name+' · '+(a.state==='held'?'Held':'Active')+' · Limit '+formatMoney(a.credit_limit_paise)} onClick={()=>{setSelected(a);setAccountView('overview');setEditing(false);}}>{a.name}</button>},
 {key:'state',label:'Status',cell:a=><StatusBadge tone={a.state==='held'?'warning':'success'}>{a.state==='held'?'Held':'Active'}</StatusBadge>},
 {key:'limit',label:'Credit limit',align:'right',cell:a=>formatMoney(a.credit_limit_paise)},
 /* R-2: a bar and a figure, both of which change past the limit. A percentage on its own is
    read as a number; a bar on its own cannot be read out to anyone. */
 {key:'used',label:'Used',cell:a=>{
   const owed=owedOf(a.id),usage=usageOf(a);
   if(usage===null)return <span className="ops-note">—</span>;
   const over=usage>1;
   return <span className={'credit-bar'+(over?' is-over':'')}>
    <span className="cb-track"><span className="cb-fill" style={{width:Math.min(100,Math.round(usage*100))+'%'}}/></span>
    <b>{formatMoney(owed!)}{over?' · over the limit':''}</b>
   </span>;
 }},
 ]}/>}
  {list.page.has_more&&<button className="btn btn-text" onClick={list.loadMore}>More accounts</button>}</>}
 {selected&&!editing&&<><button type="button" className="btn btn-text" disabled={locked} onClick={()=>{const id=selected.id;setSelected(null);requestAnimationFrame(()=>document.getElementById('customer-account-row-'+id)?.focus());}}>Back to accounts</button>
 <WorkflowTabs label="Account tasks" value={accountView} onChange={setAccountView} items={[
  {value:'overview',label:'Account details',disabled:locked},{value:'statements',label:'Monthly statements',disabled:locked},
  ...(admin?[{value:'terms',label:'Terms and rates',disabled:locked}]:[])
 ]}/></>}
 </section>
 {blocked&&locked&&<p role="alert">Resolve the retained command before leaving or changing accounts.</p>}
 {editing&&admin?<AccountEditor key={selected?.revision_id??'new'} busyChanged={setLocked} controller={controller} source={source} selected={selected} saved={saved} cancel={()=>{setEditing(false);setSelected(null);list.reload();}}/>:selected&&<>
  <div hidden={accountView!=='overview'}><AccountDetails key={selected.revision_id+revision} source={source} account={selected}/></div>
  <div hidden={accountView!=='statements'}><AccountStatements key={selected.id} api={api} controller={controller} account={selected} admin={admin} canExport={admin||roles.includes('accountant')} busyChanged={setLocked}/></div>
  {admin&&<section hidden={accountView!=='terms'} className="card ops-card"><button className="btn btn-outlined" disabled={locked} onClick={()=>setEditing(true)}>Revise terms, links or hold</button><RateEditor key={selected.id} source={source} account={selected} parentLocked={locked} busyChanged={setLocked} refreshed={()=>setRevision(n=>n+1)}/></section>}
 </>}
 {admin&&!editing&&!selected&&<CreditApprovals source={source} parentLocked={locked} busyChanged={setLocked}/>}
 </div>;
}
function CustomerPicker({controller,disabled,onSelect,busyChanged}:{controller:ScopeController;disabled:boolean;onSelect:(id:string,name:string)=>void;busyChanged:(busy:boolean)=>void}) {
 const source=useMemo(()=>customers(scopedApi(controller)),[controller]);const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[adding,setAdding]=useState(false),[phone,setPhone]=useState(''),[address,setAddress]=useState('');
 const command=useCommand(source.execute),pending=command.phase==='pending'||command.canRetry;
 useEffect(()=>{busyChanged(pending);return()=>busyChanged(false);},[busyChanged,pending]);
 const matches=usePagedResource(query,(cursor,signal)=>query?source.search('name',query,signal,cursor??undefined):Promise.resolve({items:[],page:{has_more:false,next_cursor:null}}));
 const selected=(customer:{id:string;name:string}|null)=>{if(customer){onSelect(customer.id,customer.name);setAdding(false);setPhone('');setAddress('');}};
 return <><fieldset disabled={disabled||pending}><legend>{adding?'Add customer':'Find a customer'}</legend><TextField label="Customer name prefix" type="search" maxLength={120} autoComplete="off" value={search} onChange={setSearch}/>
 {adding?<><PhoneField label="New customer phone" value={phone} onChange={setPhone}/><TextField label="New customer address (optional)" value={address} onChange={setAddress}/><div className="ops-actions"><button type="button" className="btn btn-filled" disabled={!search.trim()||!phone.trim()} onClick={()=>{void command.run(source.create({name:search.trim(),phone:phone.trim(),address:address.trim()})).then(selected).catch(()=>{});}}>Save customer and select</button><button type="button" className="btn btn-text" onClick={()=>{setAdding(false);command.reset();}}>Back to customer search</button></div></>:<><button type="button" className="btn btn-outlined" disabled={search.trim().length<3} onClick={()=>setQuery(search.trim())}>Search customers</button>
 {matches.phase==='loading'?<p role="status">Searching…</p>:matches.phase==='error'?<><p role="alert">Customer search failed.</p><button type="button" onClick={matches.reload}>Retry search</button></>:<ul className="ops-list">{matches.items.map(c=><li key={c.id}><button type="button" className="btn btn-text" onClick={()=>onSelect(c.id,c.name)}>{c.name} · {c.phone_display}</button></li>)}</ul>}
 {query&&matches.phase!=='loading'&&matches.phase!=='error'&&<button type="button" className="btn btn-text" onClick={()=>{setSearch(query);setAdding(true);command.reset();}}>Add “{query}” as a customer</button>}
 {matches.page.has_more&&<button type="button" onClick={matches.loadMore}>More customers</button>}</>}
 </fieldset><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(selected).catch(()=>{});}:undefined}/></>;
}
function AccountEditor({controller,source,selected,saved,cancel,busyChanged}:{busyChanged:(value:boolean)=>void;controller:ScopeController;source:Source;selected:CustomerAccountDto|null;saved:(a:CustomerAccountDto)=>void;cancel:()=>void}) {
 const [name,setName]=useState(selected?.name??''),[debtor,setDebtor]=useState(selected?.debtor_customer_id??''),[debtorName,setDebtorName]=useState(selected?'Existing bill-to customer':''),[links,setLinks]=useState<{id:string;name:string}[]>(selected?.shipping_customer_ids.map(id=>({id,name:id===selected.debtor_customer_id?'Bill-to customer':'Linked shipping customer '+id.slice(-8)}))??[]);
 const [contact,setContact]=useState(selected?.billing_contact.name??''),[phone,setPhone]=useState(selected?.billing_contact.phone??''),[reference,setReference]=useState(selected?.billing_contact.authorization_ref??''),[attest,setAttest]=useState(false);
 const [closing,setClosing]=useState(String(selected?.closing_day??'')),[due,setDue]=useState(String(selected?.due_days??'')),[limit,setLimit]=useState(selected?`${BigInt(selected.credit_limit_paise)/100n}.${String(BigInt(selected.credit_limit_paise)%100n).padStart(2,'0')}`:''),[state,setState]=useState<'active'|'held'>(selected?.state??'active'),[reason,setReason]=useState(''),[error,setError]=useState('');
 const customerSource=useMemo(()=>customers(scopedApi(controller)),[controller]);
 const billTo=useResource(selected?.debtor_customer_id??'',signal=>selected?customerSource.read(selected.debtor_customer_id,signal):Promise.resolve(null));
 useEffect(()=>{if(billTo.value)setDebtorName(billTo.value.name);},[billTo.value]);
 const [customerBusy,setCustomerBusy]=useState(false);
 const [step,setStep]=useState(0),stepTitle=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{stepTitle.current?.focus();},[step]);
 const command=useCommand(source.executeAccount),accountLocked=command.phase==='pending'||command.canRetry,locked=accountLocked||customerBusy;
 function next(){
  if(step===0&&(!name.trim()||!debtor||!links.length||!contact.trim()||!phone.trim()||!reference.trim())){setError('Enter an account name, choose the customers, and complete the billing contact.');return;}
  if(step===1&&(rupeesToPaise(limit)===null||!/^\d+$/.test(closing)||Number(closing)<1||Number(closing)>31||!/^\d+$/.test(due)||Number(due)>366||reason.trim().length<3)){setError('Enter the closing day, payment days, credit limit and a reason for these terms.');return;}
  setError('');setStep(n=>Math.min(2,n+1));
 }
 useEffect(()=>{busyChanged(locked);return()=>busyChanged(false);},[locked,busyChanged]);
 async function submit(){
  const paise=rupeesToPaise(limit);if(!attest||!debtor||!links.length||paise===null||!/^\d+$/.test(closing)||!/^\d+$/.test(due)||Number(closing)<1||Number(closing)>31||Number(due)>366){setError('Choose a debtor, linked shipping customers, explicit valid terms, credit limit and contact attestation.');return;}
  const body:CustomerAccountInput={expected_version:selected?.version??0,debtor_customer_id:debtor,shipping_customer_ids:links.map(c=>c.id),name,billing_contact:{name:contact,phone,authorization_ref:reference},closing_day:Number(closing),due_days:Number(due),credit_limit_paise:paise,state,reason};
  try{const result=await command.run(source.configure(selected?.id??null,body));saved(result);}catch(e){setError(failureMessage(e));}
 }
 return <section className="ops-detail customer-account-editor"><h2 className="t-title-lg">{selected?'Revise customer account':'New customer account'}</h2><ol className="customer-account-steps" aria-label="Account setup progress">{['Customer','Billing terms','Review'].map((label,index)=><li key={label} aria-current={step===index?'step':undefined}><span>{index+1}</span>{label}</li>)}</ol><h3 ref={stepTitle} tabIndex={-1}>{['Who will pay the bill?','When should this customer pay?','Check the account before saving'][step]}</h3><form noValidate className="ops-form finance-grouped-form" onSubmit={e=>{e.preventDefault();if(locked)return;if(step<2)next();else void submit();}}>
  <fieldset disabled={accountLocked} className="finance-account-fields"><section hidden={step!==0} aria-label="Account and customers"><TextField disabled={locked} label="Account name" value={name} onChange={setName} required/>
   <p>Bill-to customer: {debtorName||'Select below'}. This customer remains responsible for the account after it is created.</p>
   <CustomerPicker controller={controller} disabled={locked} busyChanged={setCustomerBusy} onSelect={(id,label)=>{if(!debtor){setDebtor(id);setDebtorName(label);}setLinks(rows=>rows.some(r=>r.id===id)?rows:[...rows,{id,name:label}]);}}/>
   {!selected&&debtor&&<button type="button" disabled={locked} className="btn btn-text" onClick={()=>{setDebtor('');setDebtorName('');}}>Choose a different bill-to customer</button>}
   <p>Authorized shipping customers (select search results to add):</p><ul>{links.map(c=><li key={c.id}>{c.name} <button type="button" disabled={locked} className="btn btn-text" onClick={()=>setLinks(rows=>rows.filter(r=>r.id!==c.id))}>Remove shipping link</button></li>)}</ul>
   <fieldset disabled={locked} className="finance-form-section"><legend>Billing contact</legend><div className="ops-grid"><TextField label="Billing contact name" value={contact} onChange={setContact} required/><PhoneField label="Billing contact phone" maxLength={40} value={phone} onChange={setPhone} required/><TextField label="Contact authority evidence reference" value={reference} onChange={setReference} required/>
   </div></fieldset></section><section hidden={step!==1} aria-label="Billing terms"><fieldset disabled={locked} className="finance-form-section"><legend>Billing cycle and credit</legend><div className="ops-grid"><TextField label="Monthly closing day (1–31)" type="number" min="1" max="31" step="1" value={closing} onChange={setClosing} inputMode="numeric" required/><TextField label="Calendar days after closing" type="number" min="0" max="366" step="1" value={due} onChange={setDue} inputMode="numeric" required/><TextField label="Credit limit (₹)" value={limit} onChange={setLimit} inputMode="decimal" required/>
   <SelectField label="Account status" value={state} onChange={v=>setState(v as 'active'|'held')} options={[{value:'active',label:'Active'},{value:'held',label:'Held'}]}/><TextField label="Reason for this revision" value={reason} onChange={setReason} minLength={3} maxLength={256} required/></div></fieldset>
   <p>Closing is inclusive in Asia/Kolkata; short months use their last day. Changes apply to future bookings.</p>
   </section><section hidden={step!==2} aria-label="Review account"><dl className="customer-account-review"><div><dt>Account</dt><dd>{name}</dd></div><div><dt>Bill to</dt><dd>{debtorName}</dd></div><div><dt>Shipping customers</dt><dd>{links.map(c=>c.name).join(', ')}</dd></div><div><dt>Billing contact</dt><dd>{contact} · {phone}</dd></div><div><dt>Payment terms</dt><dd>Close on day {closing}; payment due {due} days later</dd></div><div><dt>Credit limit</dt><dd>{rupeesToPaise(limit)!==null?formatMoney(rupeesToPaise(limit)!):'Check amount'}</dd></div><div><dt>Status</dt><dd>{state==='held'?'Held':'Active'}</dd></div><div><dt>Reason</dt><dd>{reason}</dd></div></dl><label><input type="checkbox" checked={attest} onChange={e=>setAttest(e.target.checked)}/> I attest as franchise administrator that this contact is authorized for billing. This does not claim independent legal verification.</label>
   </section><div className="ops-actions customer-account-footer"><button disabled={locked} type="button" className="btn btn-text" onClick={cancel}>Cancel</button>{step>0&&<button disabled={locked} type="button" className="btn btn-outlined" onClick={()=>{setError('');setStep(n=>n-1);}}>Back</button>}<button disabled={locked} className="btn btn-filled">{step===0?'Continue to billing terms':step===1?'Review account':'Save account revision'}</button></div>
  </fieldset>
 </form>{command.phase==='error'&&<button type="button" className="btn btn-text" onClick={()=>{command.reset();cancel();}}>Discard rejected draft and reload current accounts</button>}{error&&<p role="alert">{error}</p>}<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(result=>{if(result)saved(result);}).catch(()=>{});}:undefined}/></section>;
}
function AccountDetails({source,account}:{source:Source;account:CustomerAccountDto}) {
 const credit=useResource(account.id,s=>source.credit(account.id,s));
 const history=usePagedResource(account.revision_id,(cursor,s)=>source.history(account.id,cursor??undefined,s).then(paged));
 const rates=usePagedResource(account.revision_id,(cursor,s)=>source.rates(account.id,cursor??undefined,s).then(paged));
 return <section className="card ops-card"><h2 className="t-title-lg">Billing overview</h2>
  {credit.phase==='loading'?<Loading/>:credit.phase==='error'?<Failure retry={credit.reload}/>:credit.value&&<FinancePosition label="Customer credit position" primary={{label:'Outstanding',value:formatMoney(credit.value.outstanding_paise)}} items={[
   {label:'Available credit',value:formatMoney(credit.value.available_paise)},
   {label:'Overdue',value:formatMoney(credit.value.overdue_paise)}
  ]}/>}
  <dl className="finance-review-list"><div><dt>Payment terms</dt><dd>Close on day {account.closing_day}, due {account.due_days} days later</dd></div><div><dt>Billing contact</dt><dd>{account.billing_contact.name} · {account.billing_contact.phone}</dd></div><div><dt>Attestation reference</dt><dd>{account.billing_contact.authorization_ref}</dd></div><div><dt>Account status</dt><dd>{account.state} · Version {account.version}</dd></div></dl>
  <>{credit.value&&<AccountCreditEvidence source={source} account={account.id} cutoff={credit.value.as_of}/>}</>
  {history.phase==='error'?<Failure retry={history.reload} label="Billing terms history unavailable."/>:<details className="finance-source-disclosure"><summary>Terms and contact authority history</summary>
   {history.phase==='loading'?<Loading label="Loading billing terms history…"/>:<RecordTable mobile="stack" label="Billing terms revisions" rows={history.items} rowKey={row=>row.revision_id} empty="No saved revisions." columns={[
    {key:'reason',label:'Reason',cell:row=><strong>{row.reason}</strong>},
    {key:'terms',label:'Credit limit',align:'right',cell:row=>formatMoney(row.credit_limit_paise)},
    {key:'status',label:'Status',cell:row=>row.state},
    {key:'record',label:'Revision',cell:row=><details className="finance-bill-reference"><summary>Version {row.version}</summary><p>{formatKolkata(row.recorded_at)}</p><span className="finance-record-ref">Attested by {row.attested_by}</span></details>}
   ]}/>}
   {history.page.has_more&&<button className="btn btn-text" onClick={history.loadMore}>More revisions</button>}
  </details>}
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
 return <form className="ops-form finance-grouped-form" onSubmit={e=>{e.preventDefault();void submit();}}><h3 className="t-title-md">Publish negotiated rate version</h3><p>Each version replaces the previous schedule from its effective time. If no rule matches, normal franchise pricing applies.</p>
  {history.phase==='error'&&<><p role="alert">Rate history unavailable.</p><button type="button" className="btn btn-text" onClick={history.reload}>Retry rate history</button></>}{command.phase==='error'&&<button type="button" className="btn btn-text" onClick={()=>{command.reset();history.reload();refreshed();setMessage('Review current history and the retained rate draft before publishing again.');}}>Reload after rejected rate command</button>}
  {history.page.has_more&&<button type="button" className="btn btn-text" onClick={history.loadMore}>Load remaining rate versions before publishing</button>}
  <fieldset disabled={locked||history.phase==='loading'||history.phase==='error'||history.page.has_more}><div className="ops-grid"><TextField label="Effective from (Asia/Kolkata)" type="datetime-local" value={from} onChange={setFrom} required/><TextField label="Effective until (Asia/Kolkata)" type="datetime-local" value={to} onChange={setTo} required/><TextField label="Rate approval reference" value={reference} onChange={setReference} required/></div>
   {rules.map((r,i)=><fieldset key={i}><legend>Rate rule {i+1}</legend><div className="ops-grid">{(['destination','min','max','freight','packing'] as const).map((key)=><TextField key={key} label={{destination:'Destination key',min:'Minimum grams (inclusive)',max:'Maximum grams (exclusive, blank unlimited)',freight:'Freight (₹)',packing:'Packing (₹)'}[key]} value={r[key]} inputMode={key==='min'||key==='max'?'numeric':key==='freight'||key==='packing'?'decimal':'text'} spellCheck={key==='destination'?false:undefined} onChange={v=>setRules(rows=>rows.map((row,j)=>j===i?{...row,[key]:v}:row))}/>)}<SelectField label="Service" value={r.service} onChange={v=>setRules(rows=>rows.map((row,j)=>j===i?{...row,service:v as PricingRuleInput['service']}:row))} options={[{value:'standard',label:'Standard'},{value:'express',label:'Express'},{value:'same_city',label:'Same city'}]}/></div><button type="button" disabled={rules.length===1} onClick={()=>setRules(rows=>rows.filter((_,j)=>i!==j))}>Remove rule</button></fieldset>)}
   <button type="button" className="btn btn-text" disabled={rules.length>=100} onClick={()=>setRules(rows=>[...rows,blank()])}>Add rate rule</button><button className="btn btn-filled">Publish rate version</button>
  </fieldset><p role="status">{message}</p><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(()=>{history.reload();refreshed();}).catch(()=>{});}:undefined}/>
 </form>;
}
function CreditApprovals({source,parentLocked,busyChanged}:{source:Source;parentLocked:boolean;busyChanged:(value:boolean)=>void}) {
 const pending=usePagedResource('credit-requests',(cursor,s)=>source.pending(cursor??undefined,s).then(paged));
 const [selected,setSelected]=useState(''),[reason,setReason]=useState('');const command=useCommand(source.executeApproval),ownLocked=command.phase==='pending'||command.canRetry,locked=parentLocked||ownLocked;
 useEffect(()=>{busyChanged(ownLocked);return()=>busyChanged(false);},[ownLocked,busyChanged]);
 const review=useResource(selected,signal=>selected?source.review(selected,signal):Promise.resolve(null));
 return <section className="card ops-card"><h2 className="t-title-lg">Credit-limit exception requests</h2><p>Approval applies to one exact, unexpired booking. It never clears a hold or overdue debt.</p><DataRefresh resource={pending} disabled={locked}/>
  {pending.phase==='loading'?<Loading/>:pending.phase==='error'?<Failure retry={pending.reload}/>:!pending.items.length?<p>No unexpired requests waiting for approval.</p>:<ul className="ops-list">{pending.items.map(r=><li key={r.id}><label><input type="radio" name="credit-request" checked={selected===r.id} disabled={locked} onChange={()=>setSelected(r.id)}/>{r.name} · {formatMoney(r.total_paise)} · Expires {formatKolkata(r.expires_at)} · Operator {r.operator_id}</label></li>)}</ul>}
  {pending.page.has_more&&<button className="btn btn-text" onClick={pending.loadMore}>More requests</button>}
  {selected&&(review.phase==='loading'?<Loading label="Loading exact booking intent…"/>:review.phase==='error'?<Failure retry={review.reload}/>:review.value&&<div><h3 className="t-title-md">Review requested booking</h3><p>Shipping customer {review.value.customer_id}, version {review.value.customer_version} · {review.value.destination_key} · {review.value.service}</p><ul>{review.value.parcels.map((p,i)=><li key={i}>{p.recipient_name??'Parcel '+(i+1)} · {p.weight_grams} g · Docket {p.docket??'Generated at booking'}</li>)}</ul><p>Credit limit {formatMoney(review.value.credit.credit_limit_paise)} · Available {formatMoney(review.value.credit.available_paise)} · Overdue {formatMoney(review.value.credit.overdue_paise)} · {review.value.account.state}</p><p>Quote {review.value.quote_id} · Tax calculation {review.value.tax_calculation_id}</p><AccountCreditEvidence source={source} account={review.value.account.id} cutoff={review.value.credit.as_of}/></div>)}
  {selected&&<form className="ops-form finance-grouped-form" onSubmit={e=>{e.preventDefault();void command.run(source.approve(selected,reason)).then(()=>{pending.reload();setSelected('');setReason('');}).catch(()=>{});}}><TextField label="Credit exception approval reason" value={reason} onChange={setReason} disabled={locked} required/><button className="btn btn-filled" disabled={locked||!selected||review.phase!=='ready'||!review.value||!!review.value.approval_id||reason.trim().length<3}>Approve this booking only</button></form>}
  {command.phase==='error'&&command.error&&<><p role="alert">{failureMessage(command.error)}</p><button type="button" className="btn btn-text" onClick={()=>{command.reset();pending.reload();review.reload();}}>Reload after rejected approval</button></>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(()=>pending.reload()).catch(()=>{});}:undefined}/>
 </section>;
}
