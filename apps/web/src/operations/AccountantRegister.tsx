import {RecordTable} from '../components/workspace/Workspace';
import {DatePresets} from './DatePresets';
import React,{useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {accountantColumns,type AccountantPage,type AccountantRow} from '@shippingco/shared';
import type {AccountantSource} from '../data-access/accountant';
import {csvBundle} from '../data-access/csv-bundle';
import {ApiFailure} from '../data-access/errors';
import {useCommand} from './hooks';
import {TextField,SelectField} from '../components/m3/Input';
const amount=(value:string)=>{const n=BigInt(value),a=n<0n?-n:n;return `${n<0n?'-':''}₹${(a/100n).toLocaleString('en-IN')}.${String(a%100n).padStart(2,'0')}`;};
export function AccountantRegister({source,canExport,franchises}:{source:AccountantSource;canExport:boolean;franchises:readonly {id:string;name:string}[]}) {
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const [from,setFrom]=useState(today),[to,setTo]=useState(today),[ids,setIds]=useState([source.franchise]),[references,setReferences]=useState(false);
 const [params,setParams]=useSearchParams(),snapshotId=params.get('accountant_snapshot');
 const [result,setResult]=useState<AccountantPage|null>(null),[detail,setDetail]=useState<AccountantRow|null>(null),[family,setFamily]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
 const [controlOffset,setControlOffset]=useState(0),[control,setControl]=useState<number|undefined>(),[dateError,setDateError]=useState(''),command=useCommand(source.execute),generation=useRef(0),alive=useRef(true),captured=useRef<string|null>(null),heading=useRef<HTMLHeadingElement>(null),returnFocus=useRef<HTMLButtonElement|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[source]);
 useEffect(()=>{if(detail)heading.current?.focus();},[detail]);
 const failure=(e:unknown)=>{
  if(e instanceof ApiFailure&&e.code==='VALIDATION_FAILED')setDateError('Choose a valid period of at most 31 days.');
  if(e instanceof ApiFailure&&['ACTION_FORBIDDEN','RESOURCE_NOT_FOUND','UNAUTHENTICATED','SCOPE_CHANGED'].includes(e.code)){setResult(null);setDetail(null);}
  setNotice(e instanceof ApiFailure&&e.code==='REPORT_QUOTA_EXCEEDED'?'Twenty captures are active. Reuse a saved capture or wait for expiry.':e instanceof ApiFailure&&e.code==='REPORT_LIMIT_EXCEEDED'?'This scope exceeds the combined source or file limit. Select fewer franchises or a shorter period. If earlier history alone exceeds the limit, request a reviewed storage remedy. No partial capture was saved.':e instanceof ApiFailure&&['REPORT_EXPIRED','RESOURCE_NOT_FOUND'].includes(e.code)?'Saved register unavailable or expired. Create a new capture if you still have access.':'Register could not be loaded. Check access and retry.');
 };
 useEffect(()=>{
  if(!snapshotId)return;if(captured.current===snapshotId){captured.current=null;return;}
  const abort=new AbortController(),request=++generation.current;setBusy(true);setResult(null);setDetail(null);
  void source.page(snapshotId,0,undefined,undefined,abort.signal).then(p=>{if(!abort.signal.aborted&&request===generation.current){setResult(p);setFrom(p.snapshot.filter.from_day);setTo(p.snapshot.filter.to_day);setIds(p.snapshot.filter.franchise_ids);setReferences(p.snapshot.filter.include_references);setFamily('');setControl(undefined);setControlOffset(0);}}).catch(e=>{if(!abort.signal.aborted&&request===generation.current)failure(e);}).finally(()=>{if(!abort.signal.aborted&&request===generation.current)setBusy(false);});return()=>abort.abort();
 },[source,snapshotId,revision]);
 const create=async(retry=false)=>{
  const request=++generation.current;setBusy(true);setNotice('');setDateError('');setResult(null);setDetail(null);
  try{const p=await(retry?command.retry():command.run(source.intent({from_day:from,to_day:to,sort:'confirmed_asc',franchise_ids:ids,include_references:references,format:'generic_csv_v1'})));if(p&&alive.current&&request===generation.current){setResult(p);setFamily('');setControl(undefined);setControlOffset(0);captured.current=p.snapshot.id===snapshotId?null:p.snapshot.id;setParams({accountant_snapshot:p.snapshot.id});setNotice('Register captured. Preview, controls and bundle share this saved source frame.');}}catch(e){if(alive.current&&request===generation.current)failure(e);}finally{if(alive.current&&request===generation.current)setBusy(false);}
 };
 const load=async(nextFamily:string,offset=0,rowId?:string,controlIndex?:number)=>{
  if(!result)return;const request=++generation.current;setBusy(true);setNotice('');
  try{const p=await source.page(result.snapshot.id,offset,nextFamily||undefined,rowId,undefined,controlIndex);if(alive.current&&request===generation.current){if(rowId)setDetail(p.rows[0]!);else{setResult(p);setFamily(nextFamily);setControl(controlIndex);setDetail(null);}}}catch(e){if(alive.current&&request===generation.current)failure(e);}finally{if(alive.current&&request===generation.current)setBusy(false);}
 };
 const download=async()=>{if(!result)return;setBusy(true);setNotice('');try{const data=await source.export(result.snapshot.id);if(!alive.current)return;const url=URL.createObjectURL(csvBundle(data.files)),link=document.createElement('a');link.href=url;link.download=`accountant-${data.snapshot.id}.tar`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Private CSV bundle downloaded. Extract the archive and read manifest.csv before importing.');}catch(e){if(alive.current)failure(e);}finally{if(alive.current)setBusy(false);}};
 const s=result?.snapshot,families=Object.keys(accountantColumns);
 return <section className="card ops-card service-report-view" aria-labelledby="accountant-title"><h2 id="accountant-title">Accountant register and exports</h2>
 <p>Sales, actual money receipts, customer advances, seller COD and cash custody retain separate meanings. Statements group existing debt. Receipts and adjustments are not qualified tax invoices or credit notes.</p>
 <form className="service-report-controls" aria-busy={busy} onSubmit={e=>{e.preventDefault();void create();}}><div className="ops-grid"><DatePresets disabled={busy||command.canRetry} change={(from,to)=>{setFrom(from);setTo(to);setDateError('');}}/><TextField label="Register from day" type="date" value={from} onChange={setFrom} error={dateError} disabled={busy||command.canRetry}/><TextField label="Register through day" type="date" value={to} onChange={setTo} disabled={busy||command.canRetry}/></div>
 <fieldset disabled={busy||command.canRetry}><legend>Permitted franchises</legend>{franchises.map(f=><label key={f.id} style={{display:'block'}}><input type="checkbox" checked={ids.includes(f.id)} disabled={f.id===source.franchise} onChange={e=>setIds(e.target.checked?[...ids,f.id]:ids.filter(id=>id!==f.id))}/>{f.name}</label>)}</fieldset>
 <label><input type="checkbox" checked={references} disabled={busy||command.canRetry} onChange={e=>setReferences(e.target.checked)}/> Include private payment and approval references</label>
 <SelectField label="Accounting format" value="generic_csv_v1" onChange={()=>{}} options={[{value:'generic_csv_v1',label:'Generic CSV v1 — no external software compatibility claimed'}]} disabled/>
 <p>Asia/Kolkata dates; up to 31 days, 5,000 combined source rows and 8 MiB. Earlier source history is included to explain opening positions. Captures expire after 24 hours. Target software formats await accountant qualification.</p>
 <button className="btn btn-filled" disabled={busy||command.canRetry}>Capture register</button>{command.canRetry&&<button className="btn btn-outlined" type="button" disabled={busy} onClick={()=>void create(true)}>Retry same register request</button>}</form>
 {busy&&<p role="status">Loading accountant evidence…</p>}<p role="status" aria-live="polite">{notice}</p>{snapshotId&&!result&&!busy&&<button className="btn btn-outlined" onClick={()=>setRevision(n=>n+1)}>Retry saved register</button>}
 {s&&<><p>Schema {s.schema_version} · mapping {s.mapping_version} · captured {s.as_of} UTC · saved until {s.expires_at}. Period position updated through capture; later or backdated changes appear only in a new capture. Reconciliation: {s.reconciliation_state}.</p>
 <button className="btn btn-outlined" disabled={busy||!canExport} onClick={()=>void download()}>Download CSV bundle</button>{!canExport&&<p>Your role permits reading; an explicit franchise admin or accountant export grant is required.</p>}
 <SelectField label="Evidence family" value={family} onChange={v=>void load(v)} disabled={busy} options={[{value:'',label:'All saved sources'},...families.map(value=>({value,label:value.replaceAll('_',' ')}))]}/>
 {result.rows.length===0?<p role="status">No matching source evidence. Empty files retain headers, manifest and control definitions.</p>:<RecordTable label="Accountant source register" rows={result.rows} rowKey={r=>r.id} columns={[
 {key:'source',label:'Saved source',cell:r=><span className="service-cell-stack"><strong>{r.family.replaceAll('_',' ')}</strong><span className="ops-note service-reference">{r.fields.source_id}</span></span>},
 {key:'meaning',label:'Meaning / basis',cell:r=><span className="service-cell-stack">{r.meaning}<span className="ops-note">{r.basis} · source version {r.fields.source_version??'immutable source'}</span></span>},
 {key:'date',label:'Source date / state',cell:r=><span className="service-cell-stack">{r.fields.occurred_at??r.fields.business_date??r.fields.position??'Date unknown'}<span className="ops-note">{r.fields.document_type??r.fields.kind??r.fields.state??''} {r.fields.document_number??''}</span></span>},
 {key:'amounts',label:'Exact recorded amounts',cell:r=><span>{Object.entries(r.fields).filter(([k,v])=>k.endsWith('_paise')&&v!==null).map(([k,v])=>`${k.replaceAll('_',' ')}: ${amount(v!)}`).join(' · ')}</span>},
 {key:'action',label:'Action',cell:r=><button className="btn btn-text" disabled={busy} aria-label={`Inspect saved source evidence ${r.fields.source_id??r.id}`} onClick={e=>{returnFocus.current=e.currentTarget;void load(family,0,r.id,control);}}>Inspect saved source evidence</button>},
 ]}/>}
 {result.next_offset!==null&&<button className="btn btn-outlined" disabled={busy} onClick={()=>void load(family,result.next_offset!,undefined,control)}>Next evidence page</button>}<button className="btn btn-text" disabled={busy} onClick={()=>void load(family,0,undefined,control)}>First evidence page</button>
 {detail&&<section aria-labelledby="accountant-source"><h3 id="accountant-source" tabIndex={-1} ref={heading}>Saved source and correction evidence</h3><p>{detail.meaning}. This is the authorized saved projection; it grants no mutation permission.</p><dl className="ops-facts">{Object.entries(detail.fields).map(([key,value])=><div key={key}><dt>{key.replaceAll('_',' ')}</dt><dd style={{overflowWrap:'anywhere'}}>{value??'Unknown / not selected'}</dd></div>)}</dl><button className="btn btn-outlined" onClick={()=>{setDetail(null);returnFocus.current?.focus();}}>Close source evidence</button></section>}
 <details><summary>Independent source controls ({s.controls.length})</summary><p>Exact INR paise; source and exported totals must agree before capture. Reference positions and allocation totals are not additional economic events.</p><div className="record-table-region" role="region" aria-label="Saved accountant register evidence table" tabIndex={0}><table className="ops-table record-table"><caption>Source totals versus saved export rows</caption><thead><tr><th scope="col">Family / basis</th><th scope="col">Measure</th><th scope="col">Source</th><th scope="col">Export</th><th scope="col">Difference</th><th scope="col">Evidence</th></tr></thead><tbody>{s.controls.slice(controlOffset,controlOffset+100).map((c,i)=><tr key={controlOffset+i}><td>{c.family} / {c.basis}</td><td>{c.column}</td><td>{c.source_paise}</td><td>{c.export_paise}</td><td>{c.difference_paise}</td><td><button className="btn btn-text" disabled={busy} onClick={()=>void load(c.family.split(':')[0]!,0,undefined,controlOffset+i)}>View sources</button></td></tr>)}</tbody></table></div><p>Controls {s.controls.length===0?0:controlOffset+1}–{Math.min(controlOffset+100,s.controls.length)} of {s.controls.length}</p>{controlOffset>0&&<button className="btn btn-outlined" onClick={()=>setControlOffset(n=>Math.max(0,n-100))}>Previous controls</button>}{controlOffset+100<s.controls.length&&<button className="btn btn-outlined" onClick={()=>setControlOffset(n=>n+100)}>Next controls</button>}</details>
 </>}
 </section>;
}
