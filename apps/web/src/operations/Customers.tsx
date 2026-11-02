import React,{useId,useMemo,useState} from 'react';
import {Link} from 'react-router-dom';
import type {CustomerDto} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {customers} from '../data-access/customers';
import {scopedApi} from '../data-access/scoped-api';
import {PageHeader,RecordTable} from '../components/workspace/Workspace';
import {SearchField} from '../components/m3/Input';
import {ChoiceField} from '../components/workspace/ChoiceField';
import {usePagedResource} from './hooks';
import {Empty,Failure,Loading} from './AsyncState';
import {PhoneField} from '../booking/PhoneField';
import {customerSearchError} from '../booking/customer-search';

export default function Customers({controller,canReadAccounts}:{controller:ScopeController;canReadAccounts:boolean}){
 const source=useMemo(()=>customers(scopedApi(controller)),[controller]);
 const searchId=useId();
 const [by,setBy]=useState<'name'|'phone'>('name'),[query,setQuery]=useState(''),[error,setError]=useState('');
 const [applied,setApplied]=useState<{by:'name'|'phone';query:string}|null>(null),[selected,setSelected]=useState<CustomerDto|null>(null);
 const resource=usePagedResource(JSON.stringify(applied),(cursor,signal)=>applied?source.search(applied.by,applied.query,signal,cursor??undefined):Promise.resolve({items:[],page:{has_more:false,next_cursor:null}}));
 function search(event:React.FormEvent){event.preventDefault();const value=query.trim(),invalid=customerSearchError(by,query);if(invalid){setError(invalid);document.getElementById(searchId)?.focus();return;}setError('');setSelected(null);if(applied?.by===by&&applied.query===value)resource.reload();else setApplied({by,query:value});}
 return <section className="ops-page customers-workspace"><PageHeader title="Customers" eyebrow="Your business" description="Find a regular customer and start their next booking." actions={<Link className="btn btn-filled" to="/business/new-booking">Book for a new customer</Link>}/>
 <form className="workspace-filterbar" aria-label="Find a customer" onSubmit={search}><ChoiceField label="Search by" value={by} onChange={v=>{setBy(v as 'name'|'phone');setQuery('');setApplied(null);setSelected(null);setError('');}} options={[{value:'name',label:'Customer name'},{value:'phone',label:'Phone number'}]}/>{by==='name'?<SearchField id={searchId} label="Customer name" value={query} onChange={value=>{setQuery(value);setSelected(null);setError('');}} error={error} maxLength={120} helper="Use 3 or more letters and the same capital letters as the saved name."/>:<PhoneField id={searchId} label="Phone number" value={query} onChange={value=>{setQuery(value);setSelected(null);setError('');}} error={error} maxLength={40}/>}<button className="btn btn-filled" type="submit" disabled={resource.phase==='loading'&&!!applied}>Search</button>{(applied||query)&&<button className="btn btn-text" type="button" onClick={()=>{setApplied(null);setSelected(null);setQuery('');setError('');document.getElementById(searchId)?.focus();}}>Clear search</button>}</form>
 {!applied?<Empty icon="person_search" title="Find your customer" body="Search by name or full phone number. Choose the matching customer before starting a booking."/>:resource.phase==='loading'?<Loading label="Finding customers…"/>:resource.phase==='error'?<Failure retry={resource.reload} label="Customers could not be loaded."/>:resource.items.length===0?<Empty icon="search_off" title="No customers match" body="Check the name or phone number, or create the customer during a new booking."/>:<><p className="ops-note" role="status">{resource.items.length} customers loaded for {applied.query}{resource.page.has_more?' · more results available':''}</p><RecordTable label="Customers" mobile="stack" rows={resource.items} rowKey={row=>row.id} selectedKey={selected?.id} columns={[{key:'name',label:'Customer',cell:row=><strong>{row.name}</strong>},{key:'phone',label:'Phone',cell:row=>row.phone_display},{key:'address',label:'Address',cell:row=>row.address||'Not provided'},{key:'action',label:'Action',cell:row=><button type="button" className="btn btn-text" onClick={()=>setSelected(row)}>View {row.name}</button>}]}/>{resource.page.has_more&&<button className="btn btn-outlined" type="button" disabled={resource.phase==='more'} onClick={resource.loadMore}>{resource.phase==='more'?'Loading…':'Load more customers'}</button>}</>}
 {selected&&<section className="workspace-customer-detail ops-detail" aria-label="Selected customer"><h2>{selected.name}</h2><p>{selected.phone_display}</p><p>{selected.address||'No address saved.'}</p><div className="ops-actions"><Link className="btn btn-filled" to={'/business/new-booking?'+new URLSearchParams({customer_id:selected.id})}>New booking for {selected.name}</Link><Link className="btn btn-outlined" to={'/business/packages?'+new URLSearchParams({customer_id:selected.id})}>View bookings</Link>{canReadAccounts&&<Link className="btn btn-text" to="/business/customer-accounts">Customer accounts</Link>}</div></section>}
 </section>;
}
