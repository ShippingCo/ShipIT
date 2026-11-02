import {RecordTable,SectionHeader} from '../components/workspace/Workspace';
import {useState} from 'react';
import type {ParcelSource} from '../data-access/parcels';
import {usePagedResource} from './hooks';
import {TextField,SelectField} from '../components/m3/Input';
import {dayStart,shiftDay} from './business-dates';
import {formatKolkata} from './format';
export function LotCandidates({source,destination,select,busy}:{source:ParcelSource;destination:string;select:(id:string,docket?:string)=>void;busy:boolean}) {
 const [from,setFrom]=useState(''),[to,setTo]=useState(''),[status,setStatus]=useState<'booked'|'checked_in'>('booked');
 const page=usePagedResource(JSON.stringify([destination,from,to,status]),(cursor,signal)=>source.list({destination_key:destination,ungrouped:true,status,from:from?dayStart(from):undefined,to:to?dayStart(shiftDay(to,1)):undefined,limit:50,cursor},signal));
 return <section className="logistics-candidates"><SectionHeader level={3} title="Select ungrouped packages" description={<>Choose parcels going to {destination}. Dates use Indian time. Only eligible parcels can be added.</>}/><details className="logistics-secondary"><summary>Filter eligible parcels</summary><div className="ops-form-grid"><TextField type="date" label="Lot selection booked from" value={from} onChange={setFrom} disabled={busy}/><TextField type="date" label="Lot selection booked through" value={to} min={from||undefined} onChange={setTo} disabled={busy}/><SelectField label="Ready package status" value={status} onChange={v=>setStatus(v as typeof status)} disabled={busy} options={[{value:'booked',label:'Booked'},{value:'checked_in',label:'Checked in'}]}/></div></details>{page.phase==='loading'?<p role="status">Loading candidate packages…</p>:page.phase==='error'?<button type="button" className="btn btn-outlined" onClick={page.reload}>Retry candidates</button>:<RecordTable mobile="stack" label="Ungrouped packages" empty={<div className="logistics-candidate-empty"><p>No ungrouped packages match these dates and status.</p><button type="button" className="btn btn-outlined" disabled={busy} onClick={()=>{setFrom('');setTo('');setStatus('booked');}}>Clear candidate filters</button></div>} rows={page.items} rowKey={p=>p.id} columns={[
  {key:'docket',label:'Tracking number',cell:p=><strong>{p.docket}</strong>},
  {key:'confirmed',label:'Confirmed',cell:p=>formatKolkata(p.confirmed_at)},
  {key:'actions',label:'Actions',className:'record-actions',cell:p=><button type="button" className="btn btn-text" disabled={busy} onClick={()=>select(p.id,p.docket)}>Select {p.docket}</button>},
 ]}/>}{page.page.has_more&&<button type="button" className="btn btn-outlined" disabled={busy||page.phase==='more'} onClick={page.loadMore}>More candidate packages</button>}</section>;
}
