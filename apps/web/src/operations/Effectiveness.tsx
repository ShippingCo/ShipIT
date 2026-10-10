import React,{useEffect,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import type {EffectivenessPage,EffectivenessSection} from '@shippingco/shared';
import type {EffectivenessSource} from '../data-access/effectiveness';
import {useCommand} from './hooks';
import {TextField,SelectField} from '../components/m3/Input';
import {ApiFailure} from '../data-access/errors';
const human=(v:string)=>v.replaceAll('_',' ');
const label=(v:string)=>v==='accepted'?'Accepted · delivery unknown':v==='sent'?'Sent · delivery unknown':human(v);
export function EffectivenessView({source}:{source:EffectivenessSource}) {
  const lastWeek=new Date();lastWeek.setUTCHours(0,0,0,0);lastWeek.setUTCDate(lastWeek.getUTCDate()-((lastWeek.getUTCDay()+6)%7)-7);
  const [params,setParams]=useSearchParams(),id=params.get('effectiveness_snapshot');
  const [week,setWeek]=useState(lastWeek.toISOString().slice(0,10)),[section,setSection]=useState(''),[category,setCategory]=useState(''),[revision,setRevision]=useState(0);
  const [result,setResult]=useState<EffectivenessPage|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const command=useCommand(source.execute),pending=busy||command.phase==='pending';
  const fail=(e:unknown)=>setNotice(e instanceof ApiFailure&&['RESOURCE_NOT_FOUND','ACTION_FORBIDDEN','REPORT_EXPIRED'].includes(e.code)?'Report unavailable or expired. Check access or create a new snapshot.':e instanceof ApiFailure&&e.code==='REPORT_QUOTA_EXCEEDED'?'Twenty saved reports are active. Reuse one or wait for expiry.':'Could not load effectiveness. Choose a closed Monday week and retry.');
  useEffect(()=>{
    const abort=new AbortController();setResult(null);setBusy(false);if(!id)return()=>abort.abort();setBusy(true);setNotice('');
    void source.page(id,abort.signal,(section||null) as EffectivenessSection|null,category||null).then(p=>{if(!abort.signal.aborted){setResult(p);setWeek(p.snapshot.filter.week);}}).catch(e=>{if(!abort.signal.aborted)fail(e);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});return()=>abort.abort();
  },[id,source,revision,section,category]);
  async function create(retry=false){if(pending)return;setNotice('');try{const p=await(retry?command.retry():command.run(source.intent({week})));if(p){setSection('');setCategory('');setParams({effectiveness_snapshot:p.snapshot.id});}}catch(e){fail(e);}}
  return <section aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm">Messaging and assistant effectiveness</h1>
    <p>Fixed closed Monday-to-Monday weeks in UTC. Logical messages and known customers are counted once; recorded send attempts are separate. Accepted, sent and uncertain do not establish delivery.</p>
    <p>Tool success, thanks and staff resolution are separate signals. Calls saved and ROI are unmeasured.</p>
    <form onSubmit={e=>{e.preventDefault();void create();}}><fieldset disabled={pending||command.canRetry}>
      <TextField label="Week beginning Monday (UTC)" type="date" value={week} onChange={setWeek}/><p>Up to 53 weeks of history. The week must have closed at least 15 minutes ago. Snapshots expire after 24 hours.</p>
      <button className="btn btn-filled">Create effectiveness snapshot</button></fieldset></form>
    {command.canRetry&&<button className="btn btn-outlined" disabled={pending} onClick={()=>void create(true)}>Retry same effectiveness request</button>}
    {pending&&<p role="status">Loading effectiveness…</p>}<p role="status" aria-live="polite">{notice}</p>
    {!pending&&notice&&id&&!result&&<button className="btn btn-outlined" onClick={()=>setRevision(v=>v+1)}>Retry saved effectiveness</button>}
    {result&&<><p>Saved week {result.snapshot.filter.week} · captured {new Date(result.snapshot.as_of).toLocaleString('en-GB',{timeZone:'UTC'})} UTC</p>
      <p>Small nonzero groups have counts hidden below five subjects. Related totals and exclusions may also be hidden to protect small groups. Zero is separate from unknown.</p>
      <p>Staff queue is current at capture, including older cases. Age uses the captured current weekly schedule in {result.snapshot.staffing.timezone??'an unconfigured timezone'}; historical staffing changes and holidays are unmeasured. {result.snapshot.staffing.state==='unavailable'?'Staffing is unavailable; business age is unknown.':'This schedule projection is not a response deadline.'}</p>
      {result.snapshot.staffing.state==='configured'&&<p>Captured schedule: {result.snapshot.staffing.weekdays.map(d=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')} · {String(Math.floor((result.snapshot.staffing.start_minute??0)/60)).padStart(2,'0')}:{String((result.snapshot.staffing.start_minute??0)%60).padStart(2,'0')}–{String(Math.floor((result.snapshot.staffing.end_minute??0)/60)).padStart(2,'0')}:{String((result.snapshot.staffing.end_minute??0)%60).padStart(2,'0')}.</p>}
      <SelectField label="Report section" value={section} disabled={pending} onChange={v=>{setSection(v);setCategory('');}} options={[{value:'',label:'All sections'},...(['messaging','assistant','queue'] as const).map(value=>({value,label:human(value)}))]}/>
      {category&&<><p>Selected category: {human(category)}</p><button className="btn btn-outlined" disabled={pending} onClick={()=>setCategory('')}>Back to all categories</button></>}
      {result.items.every(r=>r.count===0)&&<p role="status">No measured events in this selection.</p>}
      <ul className="ops-list">{result.items.map(r=><li className="ops-row" key={r.section+':'+r.category}><div>
        <b>{human(r.section)} · {label(r.category)}</b><p className="t-headline-sm">{r.suppressed?'Suppressed':r.count===null?'Unknown':r.count.toLocaleString('en-IN')}</p>
        <p>Eligible {human(r.denominator_kind)}: {r.denominator===null?'Unavailable':r.denominator} · excluded: {r.excluded===null?'Unavailable':r.excluded}</p>
        {r.latency_ms!==null&&<p>Mean receipt-to-record latency: {r.latency_ms} ms</p>}
        {r.section==='queue'&&<p>Mean business age: {r.age_suppressed?'Suppressed':r.business_minutes===null?'Unknown':r.business_minutes.toFixed(1)+' minutes'}</p>}
        <button className="btn btn-text" disabled={pending} onClick={()=>{setSection(r.section);setCategory(r.category);}}>Inspect {human(r.category)}</button>
      </div></li>)}</ul><p>Drill-through contains aggregate evidence only. No transcript, phone, docket or customer list is included.</p>
    </>}
  </section>;
}

