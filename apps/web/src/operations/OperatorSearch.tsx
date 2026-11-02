import React,{useEffect,useId,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {Dialog} from '../components/m3/Dialog';
import {SearchField,SelectField} from '../components/m3/Input';
import {Msym} from '../components/m3/Icon';
import type {ConsoleLink} from '../components/workspace/console-navigation';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {parcels} from '../data-access/parcels';
import {customers} from '../data-access/customers';
import {customerSearchError} from '../booking/customer-search';

type Result={id:string;label:string;detail:string;to:string};
export function OperatorSearch({controller,links,close}:{controller:ScopeController;links:readonly ConsoleLink[];close:()=>void}) {
  const api=useMemo(()=>scopedApi(controller),[controller]);
  const [query,setQuery]=useState(''),[kind,setKind]=useState('tasks');
  const [state,setState]=useState<{phase:'idle'|'loading'|'ready'|'error';items:Result[];more:boolean}>({phase:'idle',items:[],more:false});
  const [error,setError]=useState(''),request=useRef<AbortController|null>(null);
  const fieldId=useId();
  useEffect(()=>()=>request.current?.abort(),[]);
  const options=[{value:'tasks',label:'Tasks'},...(links.some(link=>link.area==='packages')?[{value:'tracking',label:'Full tracking number'}]:[]),...(links.some(link=>link.area==='customers')?[{value:'name',label:'Customer name'},{value:'phone',label:'Customer phone'}]:[])];
  const clear=()=>{request.current?.abort();setState({phase:'idle',items:[],more:false});setError('');};
  const search=async(event:React.FormEvent)=>{
    event.preventDefault();if(kind==='tasks')return;
    clear();const q=query.trim();
    const invalid=kind==='tracking'?(!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(q)||q.length>32?'Enter a full tracking number, up to 32 letters, numbers or hyphens.':''):customerSearchError(kind as 'name'|'phone',q);
    if(invalid){setError(invalid);document.getElementById(fieldId)?.focus();return;}
    const abort=new AbortController();request.current=abort;setState({phase:'loading',items:[],more:false});
    try {
      let items:Result[],more:boolean;
      if(kind==='tracking') {
        const result=await parcels(api).list({docket:q,limit:20},abort.signal);more=result.page.has_more;
        items=result.items.map(item=>({id:item.id,label:item.docket,detail:item.sender.name+' · '+item.status.replaceAll('_',' '),to:'/business/packages?'+new URLSearchParams({parcel:item.id})}));
      } else {
        const result=await customers(api).search(kind as 'name'|'phone',q,abort.signal);more=result.page.has_more;
        items=result.items.map(item=>({id:item.id,label:item.name,detail:item.phone_display,to:'/business/packages?'+new URLSearchParams({customer_id:item.id})}));
      }
      if(!abort.signal.aborted)setState({phase:'ready',items,more});
    } catch {if(!abort.signal.aborted&&controller.runtime.isCurrent(api.scope))setState({phase:'error',items:[],more:false});}
  };
  return <Dialog open onClose={close} title="Search anything">
    <form onSubmit={event=>{void search(event);}} className="console-search-form" aria-label="Search workspace">
      <SelectField label="Search for" value={kind} options={options} onChange={value=>{clear();setKind(value);}}/>
      <SearchField id={fieldId} label={kind==='tasks'?'Find a task':kind==='tracking'?'Full tracking number':kind==='name'?'Customer name':'Customer phone'} value={query} onChange={value=>{clear();setQuery(value);}} maxLength={kind==='tracking'?32:kind==='phone'?40:120} autoComplete="off" error={error} helper={kind==='name'?'Use the same capital letters as the saved name.':kind==='phone'?'Include + and country code, for example +919876543210.':undefined}/>
      {kind!=='tasks'&&<button type="submit" className="btn btn-filled" disabled={state.phase==='loading'}>Search</button>}
    </form>
    {kind==='tasks'?<nav className="console-search-results" aria-label="Matching tasks">{links.filter(link=>link.label.toLowerCase().includes(query.trim().toLowerCase())).map(link=><Link key={link.area} to={link.to} onClick={close} className="drawer-item"><Msym name={link.icon}/>{link.label}</Link>)}</nav>:<div className="console-search-results" aria-live="polite">
      {state.phase==='loading'&&<p role="status">Searching this franchise…</p>}
      {state.phase==='error'&&<p role="alert">Search could not be completed. Try again.</p>}
      {state.phase==='ready'&&state.items.length===0&&<p>No matches in this franchise. Check the search and try again.</p>}
      {state.items.map(item=><Link className="drawer-item" key={item.id} to={item.to} onClick={close}><Msym name={kind==='tracking'?'inventory_2':'person'}/><span><strong>{item.label}</strong><span className="t-body-sm muted console-search-detail">{item.detail}</span></span></Link>)}
      {state.more&&<p>More matches are available. Refine the search to find the right record.</p>}
    </div>}
    <p className="t-body-sm muted">Search only includes this franchise. Open Lots or Dispatch Routes to browse those records.</p>
  </Dialog>;
}
