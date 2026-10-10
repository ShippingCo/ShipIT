import React,{useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import type {PerformancePage,PerformanceFilter} from '@shippingco/shared';
import type {PerformanceSource} from '../data-access/performance';
import {useCommand} from './hooks';
import {TextField,SelectField} from '../components/m3/Input';
import {ApiFailure} from '../data-access/errors';
export function PerformanceView({source,canExport}:{source:PerformanceSource;canExport:boolean}) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [params,setParams]=useSearchParams(),id=params.get('performance_snapshot');
  const [from,setFrom]=useState(today),[to,setTo]=useState(today),[eta,setEta]=useState<PerformanceFilter['eta']>('original');
  const [destination,setDestination]=useState(''),[route,setRoute]=useState(''),[revision,setRevision]=useState(0);
  const [result,setResult]=useState<PerformancePage|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const command=useCommand(source.execute),pending=busy||command.phase==='pending';
  const fail=(e:unknown)=>setNotice(e instanceof ApiFailure&&e.code==='REPORT_LIMIT_EXCEEDED'?'Report is too large. Choose a shorter period.':
    e instanceof ApiFailure&&e.code==='REPORT_QUOTA_EXCEEDED'?'Twenty saved reports are active. Reuse one or wait for expiry.':
    e instanceof ApiFailure&&['RESOURCE_NOT_FOUND','ACTION_FORBIDDEN','REPORT_EXPIRED'].includes(e.code)?'Report unavailable or expired. Check access or create a new snapshot.':'Could not load performance. Check the filters and retry.');
  useEffect(()=>{
    const abort=new AbortController();setResult(null);setBusy(false);if(!id)return()=>abort.abort();setBusy(true);setNotice('');
    void source.page(id,0,abort.signal,destination||null,route||null).then(p=>{if(!abort.signal.aborted){setResult(p);setFrom(p.snapshot.filter.from_day);setTo(p.snapshot.filter.to_day);setEta(p.snapshot.filter.eta);}})
      .catch(e=>{if(!abort.signal.aborted)fail(e);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});return()=>abort.abort();
  },[id,source,revision,destination,route]);
  async function create(retry=false){if(pending)return;setNotice('');try{const p=await(retry?command.retry():command.run(source.intent({from_day:from,to_day:to,sort:'confirmed_desc',eta})));if(p){setDestination('');setRoute('');setParams({performance_snapshot:p.snapshot.id});}}catch(e){fail(e);}}
  async function more(){if(!result||result.next_offset===null||pending)return;setBusy(true);try{const p=await source.page(result.snapshot.id,result.next_offset,undefined,destination||null,route||null);setResult({...p,rows:[...result.rows,...p.rows]});}catch(e){fail(e);}finally{setBusy(false);}}
  async function download(){if(!result||pending)return;setBusy(true);try{const p=await source.export(result.snapshot.id,destination||null,route||null),url=URL.createObjectURL(new Blob([p.csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`performance-${p.snapshot.id}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Matching CSV ready. Check your downloads.');}catch(e){fail(e);}finally{setBusy(false);}}
  const s=result?.selection.summary;
  return <section aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm">Delivery and route performance</h1>
    <p>Booking-date parcel cohort · Asia/Kolkata. One parcel is counted once, including overlapping lot and direct route membership.</p>
    <p>On-time uses delivered parcels with actual proof and the chosen saved ETA version. Open parcels and RTO are separate; missing timing is excluded explicitly.</p>
    <form onSubmit={e=>{e.preventDefault();void create();}}><fieldset disabled={pending||command.canRetry}>
      <TextField label="From day" type="date" value={from} onChange={setFrom}/><TextField label="Through day" type="date" value={to} onChange={setTo}/>
      <SelectField label="ETA basis" value={eta} onChange={v=>setEta(v as typeof eta)} options={[{value:'original',label:'Original dispatch-route ETA'},{value:'revised',label:'Last applied ETA before delivery'}]}/>
      <p>Up to 31 days and 5,000 parcels. Snapshots expire after 24 hours.</p><button className="btn btn-filled">Create performance snapshot</button>
    </fieldset></form>
    {command.canRetry&&<button className="btn btn-outlined" disabled={pending} onClick={()=>void create(true)}>Retry same performance request</button>}
    {pending&&<p role="status">Loading performance…</p>}<p role="status" aria-live="polite">{notice}</p>
    {!pending&&notice&&id&&!result&&<button className="btn btn-outlined" onClick={()=>setRevision(n=>n+1)}>Retry saved performance</button>}
    {result&&s&&<><p>{result.snapshot.audience==='assignment'?'Your latest assigned parcels only; no franchise totals.':'Owning franchise parcel cohort.'}</p><p>Saved {result.snapshot.filter.from_day} through {result.snapshot.filter.to_day}; {result.snapshot.filter.eta} ETA basis.</p>
      <p>Captured {new Date(result.snapshot.as_of).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST · {result.snapshot.count} total cohort parcels; {result.selection.count} selected.</p>
      <fieldset disabled={pending}><legend>Saved cohort selection</legend><SelectField label="Destination drill-through" value={destination} onChange={v=>{setDestination(v);setRoute('');}} options={[{value:'',label:'All destinations'},...result.snapshot.destinations.map(g=>({value:g.key??'$unknown',label:`${g.key??'Unknown destination'} · ${g.summary.booked} parcels`}))]}/>
      <SelectField label="Route drill-through" value={route} onChange={setRoute} options={[{value:'',label:'All routes'},...result.snapshot.routes.map(g=>({value:g.key??'$unknown',label:`${g.key??'Unknown route'} · ${g.summary.booked} parcels`}))]}/>
      </fieldset><div className="ops-facts">{(['booked','dispatched','delivered','open','rto','failed_parcels','failed_attempts'] as const).map(k=><div key={k}><span>{k.replaceAll('_',' ')}</span><p className="t-headline-sm">{s[k]}</p></div>)}</div>
      <p>On-time: {s.on_time.denominator?`${s.on_time.numerator}/${s.on_time.denominator} (${(s.on_time.numerator*100/s.on_time.denominator).toFixed(1)}%)`:'Unavailable (no eligible deliveries)'} · {s.on_time.excluded} delivered parcels excluded for missing timing.</p>
      <p>Dispatch-to-delivery mean: {s.duration.denominator?`${(s.duration.total_seconds/s.duration.denominator/3600).toFixed(2)} hours`:'Unknown'} · {s.duration.denominator} eligible; {s.duration.excluded} excluded. Unknown destination: {s.unknown_destination}; unknown courier: {s.unknown_courier}.</p>
      <button className="btn btn-outlined" disabled={pending||!canExport} onClick={()=>void download()}>Download matching performance CSV</button>
      {!canExport&&<p>Your role can read performance but cannot export it.</p>}
      {result.selection.count===0?<p role="status">No parcels match this selection. CSV contains headers.</p>:<ul className="ops-list">{result.rows.map(r=><li className="ops-row" key={r.id}><div><b>Parcel {r.id}</b><p>{r.destination??'Unknown destination'} · {r.service??'Unknown service'} · {r.courier??'Unknown courier'}</p><p>{r.status.replaceAll('_',' ')} · {r.failed_attempts} failed attempts · {r.outcome.replaceAll('_',' ')}</p><p>Actual delivered: {r.delivered_at??'Unknown'}; original estimate: {r.original_eta_at??'Unknown'} (version {r.original_eta_version??'unknown'}); revised estimate: {r.revised_eta_at??'Unknown'} (version {r.revised_eta_version??'unknown'}).</p><p>Route {r.route_id??'Unknown'} · actual departed {r.route_departed_at??'Unknown'} · actual arrived {r.route_arrived_at??'Unknown'}</p></div></li>)}</ul>}
      {result.next_offset!==null&&<button className="btn btn-outlined" disabled={pending} onClick={()=>void more()}>Load more parcels</button>}
    </>}
  </section>;
}
