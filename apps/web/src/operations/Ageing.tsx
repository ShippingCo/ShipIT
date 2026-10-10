import React,{useEffect,useState} from 'react';
import { useSearchParams } from 'react-router-dom';
import { ageingBuckets,ageingStatuses,type AgeingPage,type AgeingFilter } from '@shippingco/shared';
import type { AgeingSource } from '../data-access/ageing';
import { ApiFailure } from '../data-access/errors';
import { useCommand } from './hooks';
import { TextField,SelectField } from '../components/m3/Input';
import { salesAmount } from './Sales';
const bucketLabels={ '0_30':'0–30 days','31_60':'31–60 days', '61_plus':'61+ days',unknown:'Unknown date',future:'Future date' };
export function AgeingView({source,canExport}:{source:AgeingSource;canExport:boolean}) {
  const [params,setParams]=useSearchParams(),id=params.get('ageing_snapshot');
  const [anchor,setAnchor]=useState<AgeingFilter['anchor']>('booking'),[status,setStatus]=useState(''),[customer,setCustomer]=useState(''),[balances,setBalances]=useState<AgeingFilter['balances']>('outstanding');
  const [result,setResult]=useState<AgeingPage|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
  const command=useCommand(source.execute),pending=busy||command.phase==='pending';
  const fail=(e:unknown)=>setNotice(e instanceof ApiFailure&&e.code==='REPORT_LIMIT_EXCEEDED'?'Report is too large. Filter by customer or parcel status.':
    e instanceof ApiFailure&&e.code==='REPORT_QUOTA_EXCEEDED'?'Twenty reports are still active. Reuse a saved report or wait for expiry.':
    e instanceof ApiFailure&&['RESOURCE_NOT_FOUND','ACTION_FORBIDDEN','REPORT_EXPIRED'].includes(e.code)?'Report or customer unavailable. Check access, or create a new snapshot.':'Could not load the report. Check the filters and retry.');
  useEffect(()=>{
    const abort=new AbortController();setResult(null);setBusy(false);if(!id)return()=>abort.abort();setBusy(true);
    void source.page(id,0,abort.signal).then(p=>{if(!abort.signal.aborted){setResult(p);setAnchor(p.snapshot.filter.anchor);setStatus(p.snapshot.filter.status??'');setCustomer(p.snapshot.filter.customer_id??'');setBalances(p.snapshot.filter.balances);}})
      .catch(e=>{if(!abort.signal.aborted)fail(e);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return()=>abort.abort();
  },[id,source,revision]);
  async function create(retry=false) {
    if(pending)return;setNotice('');
    try {const p=await(retry?command.retry():command.run(source.intent({anchor,status:(status||null) as AgeingFilter['status'],customer_id:customer.trim()||null,balances})));
      if(p){setResult(p);setParams({ageing_snapshot:p.snapshot.id});setNotice('Ageing snapshot saved. Reload and CSV use the same evidence.');}
    }catch(e){fail(e);}
  }
  async function more(){if(!result||result.next_offset===null||pending)return;setBusy(true);try{const p=await source.page(result.snapshot.id,result.next_offset);setResult({...p,rows:[...result.rows,...p.rows]});}catch(e){fail(e);}finally{setBusy(false);}}
  async function download(){if(!result||pending)return;setBusy(true);try{const exported=await source.export(result.snapshot.id),url=URL.createObjectURL(new Blob([exported.csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`ageing-${exported.snapshot.id}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('CSV ready. Check your downloads.');}catch(e){fail(e);}finally{setBusy(false);}}
  return <section aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm">To-Pay ageing</h1>
    <p>Tax-inclusive debt after approved changes, funds applied to bills, reversals and refunds. Customer advances stay in Money receipts. Delivery does not settle payment.</p>
    <p>Booking age is not days overdue. Due dates, monthly terms, advances and combined allocations are not yet available; missing dates remain unknown.</p>
    <form onSubmit={e=>{e.preventDefault();void create();}}>
      <SelectField aria-label="Age from" label="Age from" value={anchor} onChange={v=>setAnchor(v as AgeingFilter['anchor'])} options={[{value:'booking',label:'Booking date'},{value:'due',label:'Due date (unknown without terms)'}]}/>
      <SelectField aria-label="Parcel status" label="Parcel status" value={status} onChange={setStatus} options={[{value:'',label:'All statuses'},...ageingStatuses.map(value=>({value,label:value.replaceAll('_',' ')}))]}/>
      <TextField label="Customer ID (optional)" value={customer} onChange={setCustomer}/>
      <SelectField aria-label="Balances" label="Balances" value={balances} onChange={v=>setBalances(v as AgeingFilter['balances'])} options={[{value:'outstanding',label:'Outstanding only'},{value:'all',label:'All, including settled and credit'}]}/>
      <p>All booking dates, up to 5,000 matching bookings. A status match includes the whole booking once. Snapshots expire after 24 hours.</p>
      <button className="btn btn-filled" disabled={pending||command.canRetry}>Create ageing snapshot</button>
    </form>
    {command.canRetry&&<button className="btn btn-outlined" disabled={pending} onClick={()=>void create(true)}>Retry same ageing request</button>}
    {pending&&<p role="status">Loading ageing report…</p>}<p role="status" aria-live="polite">{notice}</p>
    {!pending&&notice&&id&&!result&&<button className="btn btn-outlined" onClick={()=>setRevision(v=>v+1)}>Retry saved ageing report</button>}
    {result&&<>
      <p>Saved {result.snapshot.filter.anchor==='booking'?'booking age':'due-date age'} · {result.snapshot.filter.status??'all statuses'} · {result.snapshot.filter.balances} · Customer {result.snapshot.filter.customer_id??'all'}</p>
      <p>Captured {new Date(result.snapshot.as_of).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST · {result.snapshot.count} bookings</p>
      <div className="ops-facts">{(['gross','net_collections','outstanding','refundable_credit'] as const).map(k=><div key={k}><span>{k.replaceAll('_',' ')}</span><p className="t-headline-sm">{salesAmount(result.snapshot.totals[k])}</p></div>)}</div>
      <ul>{ageingBuckets.map(k=><li key={k}>{bucketLabels[k]}: {salesAmount(result.snapshot.buckets[k])} outstanding</li>)}</ul>
      <button className="btn btn-outlined" disabled={pending||!canExport} onClick={()=>void download()}>Download matching ageing CSV</button>
      {!canExport&&<p>Your role can read reports but cannot export them.</p>}
      <details><summary>Customer totals ({result.snapshot.customers.length})</summary><ul>{result.snapshot.customers.map(c=><li key={c.customer_id}>Customer {c.customer_id}: {salesAmount(c.totals.outstanding)} outstanding · {c.count} bookings</li>)}</ul></details>
      {result.snapshot.count===0?<p role="status">No matching balances. CSV contains headers.</p>:<ul className="ops-list">{result.rows.map(r=><li className="ops-row" key={r.id}><div style={{minWidth:0,overflowWrap:'anywhere'}}>
        <b>Booking {r.id}</b><p>Customer {r.customer_id}</p><p>{salesAmount(r.outstanding)} outstanding · {bucketLabels[r.bucket]} · Due date: {r.due_at??'Unknown'}</p>
        <details><summary>Collection history and parcels</summary>
          <p>Original gross {salesAmount(r.original_gross)} − reductions {salesAmount(r.reductions)} = {salesAmount(r.gross)}. Collections {salesAmount(r.collections)} − reversals {salesAmount(r.reversals)} − refunds {salesAmount(r.refunds)} = net {salesAmount(r.net_collections)}.</p>
          <p>Obligation {r.obligation_id} · Payment version {r.payment_version} · Financial version {r.financial_version}</p>
          <ul>{r.parcels.map(p=><li key={p.id}>Parcel {p.id}: {p.status.replaceAll('_',' ')}</li>)}</ul>
          {r.entries.length===0?<p>No recorded collections.</p>:<ol>{r.entries.map(e=><li key={e.id}>{e.kind}: {salesAmount(e.amount)} · {e.occurred_at} · Entry {e.id}{e.reversal_of&&<> · Reverses {e.reversal_of}</>}</li>)}</ol>}
          <ul>{r.changes.map(c=><li key={c.id}>{c.kind}: reduction {salesAmount(c.reduction)}, refund {salesAmount(c.refund)} · {c.occurred_at} · Source {c.id}</li>)}</ul>
        </details>
      </div></li>)}</ul>}
      {result.next_offset!==null&&<button className="btn btn-outlined" disabled={pending} onClick={()=>void more()}>Load more bookings</button>}
    </>}
  </section>;
}
