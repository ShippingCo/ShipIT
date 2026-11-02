import {useCallback,useEffect,useId,useRef,useState} from 'react';
import type {CustomerListDto} from '@shippingco/shared';
import {SearchField} from '../components/m3/Input';
import type {BookingWorkflow} from './workflow';
import {failureMessage} from './failures';
export function CustomerLookup({workflow,disabled,onAdd}:{workflow:BookingWorkflow;disabled:boolean;onAdd?:(name:string,phone:string)=>void}) {
 const [q,setQ]=useState(''),[result,setResult]=useState<CustomerListDto>(),[phase,setPhase]=useState<'idle'|'loading'|'ready'|'error'>('idle'),[message,setMessage]=useState('');
 const input=useId(),list=useId(),pending=useRef<AbortController>();
 const phone=/^[+\d ()-]+$/.test(q.trim()),query=phone?(q.trim().startsWith('+')?q.trim():'+91'+q.replace(/[^\d]/g,'')):q.trim();
 const searchable=phone?/^\+[1-9][0-9 -]{7,39}$/.test(query):query.length>=3;
 const search=useCallback(async(cursor?:string)=>{
  if(!searchable||disabled)return;pending.current?.abort();const abort=new AbortController();pending.current=abort;setPhase('loading');setMessage('Searching customers…');
  try{const value=await workflow.customerApi.search(phone?'phone':'name',query,abort.signal,cursor);if(abort.signal.aborted||workflow.api.scope.signal.aborted)return;setResult(value);setPhase('ready');setMessage(value.items.length?'Choose the matching customer.':'No matching customer. Add them below.');}
  catch(error){if(abort.signal.aborted||workflow.api.scope.signal.aborted)return;setResult(undefined);setPhase('error');setMessage(failureMessage(error));}
 },[disabled,searchable,phone,query,workflow]);
 useEffect(()=>{pending.current?.abort();setResult(undefined);setPhase('idle');setMessage('');if(!searchable||disabled)return;const timeout=window.setTimeout(()=>{void search();},350);return()=>{window.clearTimeout(timeout);pending.current?.abort();};},[search,searchable,disabled]);
 useEffect(()=>()=>pending.current?.abort(),[]);
 return <section className="booking-customer-search" aria-label="Find a customer">
  <SearchField id={input} label="Customer name or phone" value={q} disabled={disabled} placeholder="Search or add a customer" maxLength={120} onChange={setQ} role="combobox" aria-autocomplete="list" aria-expanded={!!result||!!q.trim()} aria-controls={list} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();document.getElementById(list)?.querySelector<HTMLButtonElement>('button')?.focus();}if(event.key==='Enter'){event.preventDefault();void search();}}}/>
  <p className="counter-help">Enter at least 3 letters, or a full phone number. India +91 is added to local numbers.</p>
  <p role={phase==='error'?'alert':'status'} aria-live="polite">{message}</p>
  <div id={list} className="booking-customer-results" role="listbox" aria-label="Matching customers" onKeyDown={event=>{const buttons=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button'));const index=buttons.indexOf(document.activeElement as HTMLButtonElement);if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();document.getElementById(input)?.focus();}}}>
   {result?.items.map(c=><button role="option" aria-selected="false" type="button" key={c.id} disabled={disabled} onClick={()=>{workflow.select(c);workflow.useLatestCustomer();}}><strong>{c.name}</strong><span>{c.phone_display}{c.address?' · '+c.address:''}</span></button>)}
   {q.trim()&&onAdd&&<button role="option" aria-selected="false" type="button" className="booking-customer-add" disabled={disabled||phase==='loading'} onClick={()=>onAdd(phone?'':q.trim(),phone?query:'')}>+ Add {phone?'a new customer':`“${q.trim()}”`} to customers</button>}
  </div>
  {phase==='error'&&<button type="button" className="btn btn-outlined" onClick={()=>{void search();}}>Retry customer search</button>}
  {result?.page.has_more&&<button type="button" className="btn btn-text" disabled={disabled||phase==='loading'} onClick={()=>{void search(result.page.next_cursor!);}}>More customers</button>}
  {!q.trim()&&onAdd&&<button type="button" className="btn btn-text" disabled={disabled} onClick={()=>onAdd('','')}>New customer</button>}
 </section>;
}
