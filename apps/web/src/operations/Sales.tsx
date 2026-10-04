import React,{useEffect,useState} from 'react';

import { useSearchParams } from 'react-router-dom';

import { salesMeasures,type SalesPage,type SalesRow } from '@shippingco/shared';

import type { SalesSource } from '../data-access/sales';

import { ApiFailure } from '../data-access/errors';

import { useCommand } from './hooks';

import { TextField,SelectField } from '../components/m3/Input';

export const salesAmount=(s:string)=>{const n=BigInt(s),a=n<0n?-n:n;return `${n<0n?'−':''}₹${(a/100n).toLocaleString('en-IN')}.${String(a%100n).padStart(2,'0')}`;};

const label=(s:string)=>s.replaceAll('_',' ');

const moneyKeys=['pre_tax','taxable','cgst','sgst','igst','rounding'] as const;

function paise(value:string){if(!/^-?\d+(\.\d{1,2})?$/.test(value))throw new Error('Enter rupees with at most two decimal places.');const [whole,fraction='']=value.replace('-','').split('.'),n=BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));if(n>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Amount is too large.');return Number(value.startsWith('-')?-n:n);}

function rupees(value:string){const n=BigInt(value),a=n<0n?-n:n;return `${n<0n?'-':''}${a/100n}.${String(a%100n).padStart(2,'0')}`;}

export function SalesView({source,canExport,canManage,franchises}:{source:SalesSource;canExport:boolean;canManage:boolean;franchises:{id:string;name:string}[]}){

 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());

 const [params,setParams]=useSearchParams(),id=params.get('sales_snapshot'),[from,setFrom]=useState(today),[to,setTo]=useState(today),[rate,setRate]=useState(''),[selected,setSelected]=useState([source.franchise]);

 const [result,setResult]=useState<SalesPage|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0),[detail,setDetail]=useState<SalesRow|null>(null);

 const [state,setState]=useState<Awaited<ReturnType<SalesSource['current']>>|null>(null),[kind,setKind]=useState('cancellation'),[approval,setApproval]=useState(''),[returned,setReturned]=useState(''),[refund,setRefund]=useState('0'),[values,setValues]=useState<Record<string,string>>({});

 const [document,setDocument]=useState<Awaited<ReturnType<SalesSource['statement']>>|null>(null);

 const command=useCommand(source.execute),finance=useCommand(source.executeFinance),pending=busy||command.phase==='pending'||finance.phase==='pending';

 const fail=(e:unknown)=>setNotice(e instanceof ApiFailure?e.code==='VERSION_CONFLICT'?'Financial evidence changed. Reload the booking before approving.':e.code==='STATEMENT_EMPTY'?'These shipments already appear on a statement, or none are eligible.':e.code==='FINANCIAL_CONFLICT'?'The correction or refund exceeds the remaining amount. Reload the booking.':e.code==='RESOURCE_NOT_FOUND'||e.code==='ACTION_FORBIDDEN'?'Saved evidence is unavailable. Check your franchise access.':'Could not complete this request. Retry or narrow the period.':e instanceof Error?e.message:'Could not complete this request.');

 useEffect(()=>{const abort=new AbortController();setResult(null);setDetail(null);setDocument(null);if(!id)return()=>abort.abort();setBusy(true);void source.page(id,0,abort.signal).then(p=>{if(!abort.signal.aborted){setResult(p);setFrom(p.snapshot.filter.from_day);setTo(p.snapshot.filter.to_day);setRate(p.snapshot.filter.rate??'');setSelected(p.snapshot.filter.franchise_ids);}}).catch(e=>{if(!abort.signal.aborted)fail(e);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});return()=>abort.abort();},[source,id,revision]);

 async function create(retry=false){setNotice('');setDetail(null);try{const p=await(retry?command.retry():command.run(source.intent({from_day:from,to_day:to,sort:'confirmed_asc',rate:rate||null,franchise_ids:selected})));if(p){setParams({sales_snapshot:p.snapshot.id});setNotice('Sales report saved. Pages, totals and CSV use the same evidence.');}}catch(e){fail(e);}}

 async function download(){if(!result)return;setBusy(true);try{const csv=await source.export(result.snapshot.id),url=URL.createObjectURL(new Blob([csv.csv],{type:'text/csv;charset=utf-8'})),link=window.document.createElement('a');link.href=url;link.download=`sales-${result.snapshot.id}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('CSV ready. Check your downloads.');}catch(e){fail(e);}finally{setBusy(false);}}

 async function inspect(row:SalesRow){setDetail(row);setState(null);setDocument(null);setNotice('');if(row.franchise_id!==source.franchise)return;setBusy(true);try{const s=await source.current(row.id);setState(s);setValues(Object.fromEntries(moneyKeys.map(k=>[k,rupees(s[k])])));setRefund(rupees(String(BigInt(s.collections)-BigInt(s.refunds)-BigInt(s.gross)>0n?BigInt(s.collections)-BigInt(s.refunds)-BigInt(s.gross):0n)));}catch(e){fail(e);}finally{setBusy(false);}}

 async function change(retry=false){if(!detail||!state)return;setNotice('');try{if(retry){await finance.retry();setNotice('Financial evidence saved. Create a new report to see it; this saved report remains unchanged.');setState(null);return;}const body={booking_id:detail.id,expected_version:state.version,payment_version:state.payment_version,kind,reason:kind==='refund'?'customer_refund':kind==='cancellation'?'booking_cancelled':kind==='discount'?'customer_agreement':'incorrect_charge',approval_ref:approval,...(kind==='refund'?{refund:paise(refund),returned_to_ref:returned}:Object.fromEntries(moneyKeys.map(k=>[k,paise(values[k]??'0')])))};await finance.run(source.financeIntent('changes',body));setNotice('Financial evidence saved. Create a new report to see it; this saved report remains unchanged.');setState(null);}catch(e){fail(e);}}

 async function issue(retry=false){if(!detail||!result)return;setNotice('');try{const r=await(retry?finance.retry():finance.run(source.financeIntent('statements',{customer_id:detail.customer_id,from_day:result.snapshot.filter.from_day,to_day:result.snapshot.filter.to_day})));if(r){setDocument(await source.statement(r.id));setNotice('Account statement issued. No extra sale or debt was created.');}}catch(e){fail(e);}}

 const [financeTask,setFinanceTask]=useState<'changes'|'statements'>('changes');

 return <section aria-labelledby="workspace-title"><h1 id="workspace-title" className="t-headline-sm">Sales and GST</h1><p>Application summary for accountant review. This is not an official tax return or a filing service.</p>

 <form onSubmit={e=>{e.preventDefault();void create();}}><TextField label="From day" type="date" value={from} onChange={setFrom}/><TextField label="Through day" type="date" value={to} onChange={setTo}/><TextField label="Saved GST rate fraction (blank for all, e.g. 5/100)" value={rate} onChange={setRate}/>

 <fieldset disabled={pending||command.canRetry}><legend>Included franchises</legend>{franchises.map(f=><label key={f.id} style={{display:'block'}}><input type="checkbox" checked={selected.includes(f.id)} disabled={f.id===source.franchise} onChange={e=>setSelected(ids=>e.target.checked?[...ids,f.id]:ids.filter(id=>id!==f.id))}/>{f.name}</label>)}</fieldset><p>Asia/Kolkata dates. Up to 31 days and 5,000 bookings; saved reports expire after 24 hours.</p><button className="btn btn-filled" disabled={pending||command.canRetry||finance.canRetry}>Create sales snapshot</button></form>

 {command.canRetry&&<button disabled={pending} onClick={()=>void create(true)}>Retry same report request</button>}<p role="status" aria-live="polite">{pending?'Loading…':notice}</p>{!pending&&id&&!result&&<button onClick={()=>setRevision(n=>n+1)}>Reload saved report</button>}

 {result&&<><p>Saved period {result.snapshot.filter.from_day} to {result.snapshot.filter.to_day} · {result.snapshot.count} shipments · Rate {result.snapshot.filter.rate??'all'} · {result.snapshot.filter.franchise_ids.length} franchises</p><p>As of {new Date(result.snapshot.as_of).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST</p><div className="ops-facts">{salesMeasures.map(k=><div key={k}><span>{label(k)}</span><p className="t-headline-sm">{salesAmount(result.snapshot.totals[k])}</p></div>)}</div><p>Pre-tax charges + GST + rounding = gross. Collections and actual refunds are separate. Payments include those recorded by capture time for these shipments.</p><button className="btn btn-outlined" disabled={pending||!canExport} onClick={()=>void download()}>Download matching sales CSV</button>{!canExport&&<p>Your role can read this report but cannot export it.</p>}

 <h2 className="t-title-lg">GST groups</h2>{result.snapshot.groups.map(g=><div className="ops-row" key={[g.rate,g.treatment,g.jurisdiction].join(':')}><b>{g.rate} · {label(g.treatment)} · {g.jurisdiction} · {g.count} shipments</b><p>Taxable {salesAmount(g.amounts.taxable)} · CGST {salesAmount(g.amounts.cgst)} · SGST {salesAmount(g.amounts.sgst)} · IGST {salesAmount(g.amounts.igst)} · Gross {salesAmount(g.amounts.gross)}</p></div>)}

 {result.snapshot.count===0?<p>No sales for these filters. All amounts are zero; CSV contains headers.</p>:<ul className="ops-list">{result.rows.map(r=><li className="ops-row" key={r.id}><div><b>Booking {r.id}</b><p>{r.receipt_number??'Receipt not issued'} · Gross {salesAmount(r.amounts.gross)} · GST {salesAmount(r.amounts.gst)}</p><p>{r.corrections.length} corrections · {r.statement_ids.length} account statements</p><button disabled={pending||finance.canRetry} onClick={()=>void inspect(r)}>View saved evidence</button></div></li>)}</ul>}

 {result.next_offset!==null&&<button disabled={pending} onClick={()=>{setBusy(true);void source.page(result.snapshot.id,result.next_offset!).then(p=>setResult({...p,rows:[...result.rows,...p.rows]})).catch(fail).finally(()=>setBusy(false));}}>Load more sales</button>}

 </>}

 {detail&&<section aria-label="Saved booking evidence"><h2 className="t-title-lg">Booking evidence</h2><p>Tax policy {detail.policy_id} | Saved rate {detail.rate} | {label(detail.treatment)}</p><div className="ops-facts">{([...moneyKeys,'gross'] as const).map(k=><div key={k}><b>{label(k)}</b><p>Original {salesAmount(detail.original[k])}</p><p>Report {salesAmount(detail.amounts[k])}</p></div>)}</div>{detail.corrections.map(c=><p key={c.id}>{c.kind}: {c.id}{c.kind==='refund'?` | Actual refund ${salesAmount(c.refund)}`:''} · {c.reason} · Approval {c.approval_ref} · {c.occurred_at}</p>)}{detail.statement_ids.map(id=><button key={id} disabled={pending} onClick={()=>{setBusy(true);void source.statement(id).then(setDocument).catch(fail).finally(()=>setBusy(false));}}>Open account statement {id}</button>)}

 {detail.franchise_id!==source.franchise?<p>Switch to this shipment’s franchise to manage its financial records.</p>:canManage&&<><button disabled={pending||finance.canRetry} onClick={()=>void inspect(detail)}>Reload current financial evidence</button>{state&&<><h3>Current financial history</h3>{state.changes.length===0?<p>No financial corrections or refunds.</p>:state.changes.map(c=><p key={c.id}>{label(c.kind)} · {c.id} · Approval {c.approval_ref} · {c.occurred_at}{c.kind==='refund'?` · Actually refunded ${salesAmount(c.refund)}`:''}</p>)}<form onSubmit={e=>{e.preventDefault();setFinanceTask('changes');void change();}}><h3 className="t-title-md">Approve financial correction or record an actual refund</h3><p>Use reviewed correction amounts. Original tax evidence remains saved. Recording a refund does not send money.</p><SelectField label="Action" value={kind} onChange={setKind} options={['cancellation','discount','correction','refund'].map(v=>({value:v,label:label(v)}))}/><TextField label="Approval evidence reference" value={approval} onChange={setApproval}/>{kind==='refund'?<><TextField label="Actually refunded (₹)" value={refund} onChange={setRefund}/><TextField label="Returned-to evidence reference" value={returned} onChange={setReturned}/></>:moneyKeys.map(k=><TextField key={k} label={`${label(k)} reduction (₹)`} value={values[k]??'0'} onChange={v=>setValues(prev=>({...prev,[k]:v}))}/>)}<button className="btn btn-outlined" disabled={pending||finance.canRetry||!approval}>Confirm financial evidence</button></form></>}

 <p>Issue an account statement for this customer’s unissued shipments in the saved report period. It uses current saved charges and collections, without creating another sale.</p><button disabled={pending||finance.canRetry} onClick={()=>{setFinanceTask('statements');void issue();}}>Issue account statement</button></>}

 {finance.canRetry&&<button disabled={pending} onClick={()=>void(financeTask==='changes'?change(true):issue(true))}>Retry same financial request</button>}

 </section>}

 {document&&<section aria-label="Account statement"><h2>Account statement</h2><p>{document.id} · {document.from_day} to {document.to_day} · {document.rows.length} shipments</p><p>This statement groups existing charges. It is not a new tax invoice.</p><p>Gross {salesAmount(document.totals.gross)} · Collections {salesAmount(document.totals.collections)} · Refunds {salesAmount(document.totals.refunds)} · Outstanding {salesAmount(document.totals.outstanding)}</p>{document.rows.map(r=><p key={r.id}>Booking {r.id} · {salesAmount(r.amounts.gross)}</p>)}</section>}

 </section>;

}

