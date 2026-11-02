import {useState} from 'react';
import {TextField} from '../components/m3/Input';
import type {ParcelRead,ParcelSource} from '../data-access/parcels';
import {useResource} from './hooks';
import {Failure,Loading} from './AsyncState';

/** An explicit docket search keeps internal parcel and booking references out of entry fields. */
export function ParcelLookup({source,label='Find a parcel',disabled=false,select}:{source:ParcelSource;label?:string;disabled?:boolean;select:(parcel:ParcelRead)=>void}){
 const [draft,setDraft]=useState(''),[query,setQuery]=useState('');
 const found=useResource(query,signal=>query?source.list({docket:query,limit:10},signal):Promise.resolve(null));
 return <section className="logistics-lookup" aria-label={label}>
  <form className="logistics-lookup-search" onSubmit={event=>{event.preventDefault();if(!disabled&&draft.trim())setQuery(draft.trim());}}>
   <TextField label="Tracking number" value={draft} onChange={setDraft} autoComplete="off" spellCheck={false}/>
   <button type="submit" className="btn btn-outlined" disabled={disabled||!draft.trim()}>Find parcel</button>
  </form>
  {query&&(found.phase==='loading'?<Loading label="Finding parcel…"/>:found.phase==='error'?<Failure label="Parcel search could not be completed." retry={found.reload}/>:found.value&&<div className="logistics-lookup-results">{found.value.items.length===0?<p role="status">No parcel found. Check the tracking number and selected branch.</p>:found.value.items.map(parcel=><button type="button" className="logistics-lookup-result" key={parcel.id} disabled={disabled} onClick={()=>select(parcel)}><strong>{parcel.docket}</strong><span>{parcel.sender.name} → {parcel.recipient.name}</span><span>{parcel.status.replaceAll('_',' ')} · {(parcel.weight_grams/1000).toLocaleString('en-IN')} kg</span><b>Use this parcel</b></button>)}</div>)}
 </section>;
}
