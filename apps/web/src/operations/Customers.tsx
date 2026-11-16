import React,{useEffect,useId,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import type {CustomerDto} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {customers} from '../data-access/customers';
import {parcels} from '../data-access/parcels';
import {ageing} from '../data-access/ageing';
import {customerAccounts} from '../data-access/customer-accounts';
import {scopedApi} from '../data-access/scoped-api';
import {PageHeader} from '../components/workspace/Workspace';
import {SearchField,SelectField,TextField} from '../components/m3/Input';
import {Button} from '../components/m3/Button';
import {Msym} from '../components/m3/Icon';
import {ConfirmDialog} from '../components/m3/Dialog';
import {usePagedResource,useResource} from './hooks';
import {Failure,Loading} from './AsyncState';
import {PhoneField} from '../booking/PhoneField';
import {validPhone} from '../booking/form';
import {receiptMoney} from '../utils/receipt-view';
import './customers.css';

/**
 * Customers is a search box with a profile behind it.
 *
 * Nine times in ten the operator opens it because a person is standing at the counter, so
 * every path through it leads back to a booking: booking is the profile's first action, and a
 * destination the customer usually sends to is itself a press that starts one.
 *
 * It also holds the most sensitive data in the product — names, phone numbers and addresses —
 * which is why reading it is rate limited more strictly than anything else in the API, at
 * thirty searches a minute per signed-in session. When that limit is reached the screen says
 * so in those words, keeps what was typed, and re-enables itself: a limiter that silently
 * eats a search teaches the operator to press harder.
 *
 * One field takes either a phone number or a name. Which one it is, is decided by what was
 * typed, not by a selector the operator has to set first. A number still gets its country code
 * explicitly — the code is never assumed on the operator's behalf — but it appears beside the
 * field only once the typing looks like a number, so a name costs nothing.
 */

const initials=(name:string)=>name.trim().split(/\s+/).slice(0,2).map(part=>[...part][0]??'').join('').toUpperCase()||'?';
/** The part of an address a counter uses to tell two people with one name apart. */
const area=(address:string)=>address.split(',').map(part=>part.trim()).filter(Boolean).at(-1)??'';
const looksNumeric=(value:string)=>/[0-9]/.test(value)&&!/[\p{L}]/u.test(value);
const dialCodes=[{value:'91',label:'India (+91)'},{value:'1',label:'US / Canada (+1)'},{value:'44',label:'UK (+44)'},{value:'971',label:'UAE (+971)'},{value:'65',label:'Singapore (+65)'},{value:'61',label:'Australia (+61)'}];

function Figure({label,value,tone,foot}:{label:string;value:string;tone?:'owed'|'quiet';foot?:string}) {
  return <div className="cust-figure">
    <p className="cf-label">{label}</p>
    <p className={'cf-value'+(tone==='owed'?' is-owed':tone==='quiet'?' is-quiet':'')}>{value}</p>
    {foot&&<p className="cf-foot">{foot}</p>}
  </div>;
}

export default function Customers({controller,canReadAccounts,canBook}:{controller:ScopeController;canReadAccounts:boolean;canBook:boolean}){
  const api=useMemo(()=>scopedApi(controller),[controller]);
  const source=useMemo(()=>customers(api),[api]);
  const searchId=useId();
  const [query,setQuery]=useState(''),[error,setError]=useState(''),[dial,setDial]=useState('91');
  const [applied,setApplied]=useState<{by:'name'|'phone';query:string}|null>(null);
  const [selected,setSelected]=useState<CustomerDto|null>(null);
  const [limited,setLimited]=useState(false);
  useEffect(()=>{
    const land=window.setTimeout(()=>{
      const field=document.getElementById(searchId);
      if(field&&document.activeElement?.tagName!=='INPUT')field.focus();
    },0);
    return()=>window.clearTimeout(land);
  },[searchId]);

  // One field, and what was typed decides what it is. The country code appears beside it the
  // moment the typing looks like a number and is never assumed silently, but it is one control
  // the operator does not have to set before they can begin. The field itself never swaps out
  // from under the cursor: only the code beside it appears and disappears.
  const phone=looksNumeric(query)||query.trim().startsWith('+');
  const typed=query.trim();
  const full=!phone?typed:typed.startsWith('+')?typed:typed?'+'+dial+' '+typed:'';
  // P-5: below three characters there is no list and no instruction. An empty area is not a
  // failure, and a line telling the operator to keep typing is a line they read every time.
  const enough=phone?validPhone(full):(typed.match(/[\p{L}\p{N}]/gu)?.length??0)>=3;

  const resource=usePagedResource(JSON.stringify(applied),(cursor,signal)=>applied
    ?source.search(applied.by,applied.query,signal,cursor??undefined)
    :Promise.resolve({items:[],page:{has_more:false,next_cursor:null}}));

  // P-2: the limiter names itself, keeps the typed value, and the control comes straight back.
  useEffect(()=>{setLimited(resource.phase==='error'&&resource.error?.code==='RATE_LIMITED');},[resource.phase,resource.error]);

  /**
   * Owed, for everyone on screen at once.
   *
   * One ageing snapshot carries a per-customer total, so the figure costs a single report
   * rather than one request per row — which on a screen governed by a thirty-a-minute limiter
   * would be the difference between working and being cut off. Where the signed-in role cannot
   * read money the figure is absent, not zero.
   */
  const owed=useResource(canReadAccounts?api.franchise+':owed':'',async()=>{
    if(!canReadAccounts)return null;
    const page=await ageing(api).execute(ageing(api).intent({anchor:'booking',status:null,customer_id:null,balances:'outstanding'}));
    return page.snapshot;
  });
  const owedFor=(id:string)=>{
    const row=owed.value?.customers.find(entry=>entry.customer_id===id);
    return row?Number(row.totals.outstanding):null;
  };

  function search(event:React.FormEvent){
    event.preventDefault();
    const value=full;
    if(!enough){
      setError(phone
        ?'Choose the country code and enter the full phone number.'
        :'Enter the first 3 letters or numbers of the name, as saved.');
      document.getElementById(searchId)?.focus();
      return;
    }
    if([...typed].length>(phone?40:120)){setError('Use no more than '+(phone?40:120)+' characters.');return;}
    setError('');setSelected(null);
    const next={by:(phone?'phone':'name') as 'phone'|'name',query:value};
    if(applied?.by===next.by&&applied.query===next.query)resource.reload();else setApplied(next);
  }

  if(selected)return <CustomerProfile customer={selected} api={api} controller={controller} canBook={canBook}
    canReadAccounts={canReadAccounts} owed={owedFor(selected.id)} onBack={()=>setSelected(null)}
    onSaved={next=>setSelected(next)}/>;

  return <section className="ops-page customers-workspace">
    <PageHeader title="Customers" eyebrow="Your business"
      actions={canBook&&<Link className="btn btn-filled" to="/business/new-booking"><Msym name="add"/>Book for a new customer</Link>}/>

    <section aria-labelledby="customer-find-heading">
      <h2 id="customer-find-heading" className="t-title-sec">Find your customer</h2>
      <form className="customer-find" aria-label="Find a customer" onSubmit={search}>
        {phone&&!typed.startsWith('+')&&<SelectField label="Country code" aria-label="Phone number country code"
          value={dial} options={dialCodes} onChange={setDial}/>}
        <SearchField id={searchId} label="Phone number or name" value={query}
          onChange={value=>{setQuery(value);setSelected(null);setError('');}} error={error} maxLength={phone?40:120} autoFocus
          helper={phone?'Enter the whole number. The country code beside it is added for you.':'Type a name, or a phone number. Capital letters do not matter.'}/>
        <Button type="submit" disabled={resource.phase==='loading'&&!!applied}>Search</Button>
        {(applied||query)&&<Button type="button" variant="text" onClick={()=>{setApplied(null);setSelected(null);setQuery('');setError('');document.getElementById(searchId)?.focus();}}>Clear search</Button>}
      </form>
    </section>

    {limited&&<p className="customer-limited" role="alert">Too many searches. Wait a moment, then search again.</p>}

    {!applied?null
      :resource.phase==='loading'?<Loading label="Finding customers…"/>
      :resource.phase==='error'&&!limited?<div className="customer-search-failed">
        <Failure retry={resource.reload} label="Customers could not be searched."/>
        {/* R-7: lookup being down never closes the way to a booking. */}
        {canBook&&<Link className="btn btn-outlined" to="/business/new-booking">Book for a new customer</Link>}
      </div>
      :resource.items.length===0?<div className="customer-none">
        <Msym name="person_search"/>
        <p>No one saved matches <strong>{applied.query}</strong>.</p>
        {canBook&&<Link className="btn btn-filled" to={'/business/new-booking?'+new URLSearchParams({name:applied.by==='name'?applied.query:'',phone:applied.by==='phone'?applied.query:''})}>Book for a new customer</Link>}
      </div>
      :<>
        <p className="ops-note" role="status">{resource.items.length} {resource.items.length===1?'customer':'customers'} matching {applied.query}{resource.page.has_more?' · more to load':''}</p>
        <ul className="customer-results">
          {resource.items.map(row=>{
            const due=owedFor(row.id);
            return <li key={row.id}>
              <button type="button" className="customer-row" onClick={()=>setSelected(row)} aria-label={row.name}>
                <span className="cr-initials" aria-hidden="true">{initials(row.name)}</span>
                <span className="cr-body">
                  <span className="cr-name">{row.name}</span>
                  <span className="cr-meta">{row.phone_display}{area(row.address)?' · '+area(row.address):''}</span>
                </span>
                {canReadAccounts&&<span className={'cr-owed'+(due?' is-owed':'')}>
                  {owed.phase==='loading'?'…':due===null?'—':due?receiptMoney(due)+' owed':'Nothing owed'}
                </span>}
                <Msym name="chevron_right"/>
              </button>
            </li>;
          })}
        </ul>
        {resource.page.has_more&&<Button variant="outlined" disabled={resource.phase==='more'} onClick={resource.loadMore}>
          {resource.phase==='more'?'Loading…':'Load more customers'}</Button>}
      </>}
  </section>;
}

/**
 * One customer, answering the two questions an operator is actually asked at the counter:
 * what do they owe, and where are their parcels.
 */
function CustomerProfile({customer,api,controller,canBook,canReadAccounts,owed,onBack,onSaved}:{
  customer:CustomerDto; api:ReturnType<typeof scopedApi>; controller:ScopeController;
  canBook:boolean; canReadAccounts:boolean; owed:number|null; onBack:()=>void; onSaved:(next:CustomerDto)=>void;
}) {
  const [editing,setEditing]=useState(false);
  const sent=useResource(api.franchise+':parcels:'+customer.id,signal=>parcels(api).list({customer_id:customer.id,limit:50,sort:'created_at_desc'},signal));
  const accounts=useResource(canReadAccounts?api.franchise+':accounts:'+customer.id:'',signal=>
    canReadAccounts?customerAccounts(api).choices(customer.id,undefined,signal):Promise.resolve(null));
  const account=accounts.value?.items[0];
  const credit=useResource(account?api.franchise+':credit:'+account.id:'',signal=>
    account?customerAccounts(api).credit(account.id,signal):Promise.resolve(null));

  const rows=sent.value?.items??[];
  const moving=rows.filter(parcel=>!['delivered','rto','cancelled'].includes(parcel.status)).length;
  const destinations=[...rows.reduce((map,parcel)=>{
    const key=parcel.destination_key||parcel.details?.city||'';
    if(key)map.set(key,(map.get(key)??0)+1);
    return map;
  },new Map<string,number>())].sort((a,b)=>b[1]-a[1]).slice(0,5);

  const bookHref=(extra:Record<string,string>={})=>'/business/new-booking?'+new URLSearchParams({customer_id:customer.id,...extra});

  return <section className="ops-page customer-profile">
    <Button variant="text" icon="arrow_back" onClick={onBack}>All customers</Button>
    <PageHeader title={customer.name} eyebrow="Customer"
      actions={canBook&&<Link className="btn btn-filled" to={bookHref()}><Msym name="add"/>Book a parcel</Link>}/>

    <p className="customer-contact">{customer.phone_display}{customer.address?' · '+customer.address:''}</p>

    <div className="customer-figures">
      <Figure label="Parcels sent" value={sent.phase==='error'?'—':String(rows.length)+(sent.value?.page.has_more?'+':'')}
        foot={sent.phase==='error'?'Could not be loaded.':undefined}/>
      <Figure label="Owed now"
        value={!canReadAccounts?'Not shown':owed===null?'—':owed?receiptMoney(owed):'Nothing'}
        tone={owed?'owed':'quiet'}
        foot={!canReadAccounts?'Your role does not include money figures.':owed===null?'This figure could not be read. It is missing, not zero.':owed?'Unsettled bookings, oldest first in Reports.':'Everything booked has been settled.'}/>
      <Figure label="Moving now" value={sent.phase==='error'?'—':String(moving)} tone={moving?undefined:'quiet'}
        foot={moving?'Still on the way or at a hub.':'Nothing of theirs is in transit.'}/>
    </div>

    {/* R-12/R-13: the credit card exists only where this customer actually has an account. */}
    {account&&credit.value&&<div className="customer-credit">
      <h2 className="t-title-sec">{account.name}</h2>
      <dl>
        <div><dt>Credit limit</dt><dd>{receiptMoney(credit.value.credit_limit_paise)}</dd></div>
        <div><dt>Used</dt><dd>{receiptMoney(Number(credit.value.outstanding_paise))}</dd></div>
        <div><dt>Available</dt><dd>{receiptMoney(Number(credit.value.available_paise))}</dd></div>
      </dl>
      {Number(credit.value.available_paise)<=0&&<p className="customer-overlimit" role="alert">
        <Msym name="warning"/>This account is at its limit. A new booking on account needs an approval.</p>}
      <Link className="btn btn-outlined" to="/business/customer-accounts">Open customer accounts</Link>
    </div>}

    {destinations.length>0&&<section aria-labelledby="customer-where">
      <h2 id="customer-where" className="t-title-sec">Where they usually send</h2>
      <ul className="customer-chips">
        {destinations.map(([key,count])=><li key={key}>
          {canBook
            ?<Link className="customer-chip" to={bookHref({destination:key})}>{key.replaceAll('_',' ')} <b>{count}</b></Link>
            :<span className="customer-chip">{key.replaceAll('_',' ')} <b>{count}</b></span>}
        </li>)}
      </ul>
    </section>}

    <section aria-labelledby="customer-recent">
      <h2 id="customer-recent" className="t-title-sec">Recent parcels</h2>
      {sent.phase==='loading'?<Loading label="Loading their parcels…"/>
        :sent.phase==='error'?<Failure retry={sent.reload} label="Their parcels could not be loaded."/>
        :rows.length===0?<p className="ops-note">Nothing booked for them yet.</p>
        :<><ul className="customer-parcels">
          {rows.slice(0,3).map(parcel=><li key={parcel.id}>
            <span className="mono">{parcel.docket}</span>
            <span>{parcel.destination_key?.replaceAll('_',' ')||parcel.details?.city||'—'}</span>
            <span className="muted">{new Date(parcel.confirmed_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</span>
            <span className={'pill st-'+parcel.status}>{parcel.status.replaceAll('_',' ')}</span>
          </li>)}
        </ul>
        {rows.length>3&&<Link to={'/business/packages?'+new URLSearchParams({customer_id:customer.id})}>All {rows.length}{sent.value?.page.has_more?'+':''} parcels for {customer.name}</Link>}</>}
    </section>

    <Button variant="outlined" icon="edit" onClick={()=>setEditing(true)}>Edit their details</Button>
    {editing&&<CustomerEdit customer={customer} api={api} controller={controller}
      onClose={()=>setEditing(false)} onSaved={next=>{setEditing(false);onSaved(next);}}/>}
  </section>;
}

/**
 * Three fields, and a sentence about what changing them does.
 *
 * Operators avoid this form because nothing told them whether it rewrites history. It does
 * not: a parcel carries the name and address it was booked with, for ever. Saying so above the
 * button is the whole difference between a form people use and a form people work around.
 */
function CustomerEdit({customer,api,controller,onClose,onSaved}:{
  customer:CustomerDto; api:ReturnType<typeof scopedApi>; controller:ScopeController;
  onClose:()=>void; onSaved:(next:CustomerDto)=>void;
}) {
  const source=useMemo(()=>customers(api),[api]);
  const [name,setName]=useState(customer.name),[phone,setPhone]=useState(customer.phone_display),[address,setAddress]=useState(customer.address);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[clash,setClash]=useState<CustomerDto|null>(null);
  const [confirmClose,setConfirmClose]=useState(false);
  const dirty=name!==customer.name||phone!==customer.phone_display||address!==customer.address;

  async function save(){
    if(busy)return;
    if(!name.trim()){setMessage('Enter the customer name.');return;}
    if(!validPhone(phone)){setMessage('Choose the country code and enter the full phone number.');return;}
    setBusy(true);setMessage('');setClash(null);
    try{
      // R-16: a number already saved against someone else names them rather than refusing blankly.
      if(phone!==customer.phone_display){
        const found=await source.search('phone',phone,new AbortController().signal);
        const other=found.items.find(row=>row.id!==customer.id);
        if(other){setClash(other);setBusy(false);return;}
      }
      const intent=source.update(customer,{name:name.trim(),phone,address:address.trim(),expected_version:customer.version});
      const next=await source.execute(intent);
      if(!controller.runtime.isCurrent(api.scope))return;
      onSaved(next);
    }catch{
      // R-18: nothing typed is cleared by a failure.
      setMessage('That change was not saved. What you typed is still here — try again.');
    }finally{setBusy(false);}
  }

  return <div className="customer-edit" role="group" aria-label={'Edit '+customer.name}>
    <h2 className="t-title-sec">Edit their details</h2>
    <div className="form-grid">
      <TextField id="customer-edit-name" label="Name" value={name} onChange={setName} maxLength={120} disabled={busy}/>
      <PhoneField id="customer-edit-phone" label="Phone" value={phone} onChange={setPhone} maxLength={40} disabled={busy}/>
      <TextField id="customer-edit-address" label="Address" className="span2" value={address} onChange={setAddress} maxLength={500} disabled={busy}/>
    </div>
    {clash&&<p className="customer-clash" role="alert">
      <Msym name="info"/><span>{clash.phone_display} is already saved for <strong>{clash.name}</strong>. Check which of the two this is before changing it.</span>
    </p>}
    {message&&<p role="alert">{message}</p>}
    {/* R-15: the blast radius, stated above the button that applies it. */}
    <p className="customer-blast">Parcels already booked keep the name and address they were booked with. This changes what is used from the next booking on.</p>
    <div className="ops-actions">
      <Button disabled={busy||!dirty} onClick={()=>void save()}>Save their details</Button>
      <Button variant="text" disabled={busy} onClick={()=>{if(dirty)setConfirmClose(true);else onClose();}}>Cancel</Button>
    </div>
    {/* R-17: cancelling asks once, and only when there is something to lose. */}
    <ConfirmDialog open={confirmClose} onClose={()=>setConfirmClose(false)} title="Leave these changes?"
      body={'The changes to '+customer.name+' have not been saved. Leaving now discards them.'}
      confirmLabel="Discard changes" onConfirm={onClose}/>
  </div>;
}
