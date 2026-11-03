import React,{useEffect,useMemo,useRef,useState} from 'react';
import type {ReportPage} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {reports} from '../data-access/reports';
import {scopedApi} from '../data-access/scoped-api';
import {ApiFailure} from '../data-access/errors';
import {useCommand} from './hooks';
import {RecordTable,SectionHeader} from '../components/workspace/Workspace';
import {DateField} from '../components/m3/Input';
import './business-trend.css';

type Day={day:string;bookings:number;billed:bigint};
const inr=(n:bigint)=>`${n<0n?'−':''}₹${((n<0n?-n:n)/100n).toLocaleString('en-IN')}.${String((n<0n?-n:n)%100n).padStart(2,'0')}`;
function dayOf(value:Date){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);return ['year','month','day'].map(key=>parts.find(p=>p.type===key)!.value).join('-');}
export function weeklyDays(to:string){return Array.from({length:7},(_,index)=>{const date=new Date(to+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-6+index);return date.toISOString().slice(0,10);});}
export function trendDays(from:string,to:string){
 const start=Date.parse(from+'T12:00:00Z'),end=Date.parse(to+'T12:00:00Z'),count=(end-start)/86400000+1;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||!Number.isInteger(count)||count<1||count>31||new Date(start).toISOString().slice(0,10)!==from||new Date(end).toISOString().slice(0,10)!==to)throw new Error('Choose a valid range of up to 31 days.');
 return Array.from({length:count},(_,i)=>new Date(start+i*86400000).toISOString().slice(0,10));
}
/** Only complete, matching saved report pages can be rendered as a business trend. */
export function weeklySeries(snapshot:ReportPage['snapshot'],rows:ReportPage['rows']):Day[]{
 const dates=trendDays(snapshot.filter.from_day,snapshot.filter.to_day);if(rows.length!==snapshot.count||new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Incomplete weekly evidence');
 const days=dates.map(day=>({day,bookings:0,billed:0n}));
 for(const row of rows){const day=days.find(d=>d.day===dayOf(new Date(row.confirmed_at)));if(!day)throw new Error('Source outside selected week');day.bookings++;day.billed+=BigInt(row.billed_gross);}
 if(snapshot.totals.billed_gross.state!=='known'||days.reduce((sum,d)=>sum+d.billed,0n)!==BigInt(snapshot.totals.billed_gross.paise))throw new Error('Weekly totals do not match saved evidence');return days;
}
export default function WeeklyBusiness({controller,autoLoad=false}:{controller:ScopeController;autoLoad?:boolean}){
 const source=useMemo(()=>reports(scopedApi(controller)),[controller]),command=useCommand(source.execute);
 const [result,setResult]=useState<{days:Day[];snapshot:ReportPage['snapshot']}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[terminal,setTerminal]=useState(false),[measure,setMeasure]=useState<'bookings'|'billed'>('bookings');
 const retained=useRef<ReportPage|null>(null),active=useRef(true),request=useRef<AbortController|null>(null),region=useRef<HTMLDivElement>(null),[width,setWidth]=useState(600);
 const today=dayOf(new Date()),[range,setRange]=useState({from:weeklyDays(today)[0]!,to:today}),[preset,setPreset]=useState('7'),[rangeError,setRangeError]=useState(''),[hover,setHover]=useState<number|null>(null);
 const pendingRange=useRef(range),loading=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
 useEffect(()=>{if(!region.current||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(entries=>setWidth(Math.max(220,entries[0]!.contentRect.width)));observer.observe(region.current);return()=>observer.disconnect();},[]);
 async function load(retry=false,nextRange=range){if(loading.current||!retry&&(command.phase==='pending'||command.phase==='uncertain'))return;
  try{trendDays(nextRange.from,nextRange.to);if(nextRange.to>today)throw new Error('Choose today or an earlier date.');}catch(e){setRangeError((e as Error).message);return;}
  if(!retry)pendingRange.current=nextRange;loading.current=true;setBusy(true);setRangeError('');setError('');setTerminal(false);setResult(null);setHover(null);request.current?.abort();const abort=new AbortController();request.current=abort;
  try{const selected=pendingRange.current;const first=retry&&retained.current?retained.current:await(retry&&command.canRetry?command.retry():command.run(source.intent({from_day:selected.from,to_day:selected.to,sort:'confirmed_asc'})));if(!first||!active.current)return;retained.current=first;
   if(first.snapshot.filter.from_day!==selected.from||first.snapshot.filter.to_day!==selected.to)throw new Error('Mismatched report dates');
   const rows=[...first.rows];let offset=first.next_offset;const seen=new Set<number>();
   while(offset!==null){if(seen.has(offset)||rows.length>=5000)throw new Error('Incomplete weekly evidence');seen.add(offset);const next=await source.page(first.snapshot.id,offset,abort.signal);if(!active.current||abort.signal.aborted)return;if(next.snapshot.id!==first.snapshot.id||next.snapshot.count!==first.snapshot.count||next.snapshot.as_of!==first.snapshot.as_of)throw new Error('Mismatched report page');rows.push(...next.rows);offset=next.next_offset;}
   const days=weeklySeries(first.snapshot,rows);if(active.current&&!abort.signal.aborted){setResult({days,snapshot:first.snapshot});retained.current=null;}
  }catch(failure){if(active.current&&!abort.signal.aborted){const unrecoverable=failure instanceof ApiFailure?['REPORT_EXPIRED','RESOURCE_NOT_FOUND'].includes(failure.code)||!!retained.current&&failure.kind==='protocol':!!retained.current;setTerminal(unrecoverable);setError(unrecoverable?'This saved report is expired, unavailable or inconsistent. Start a fresh weekly report to capture current evidence.':'The complete trend could not be loaded. Retry to recover the same saved report.');}}finally{loading.current=false;if(active.current&&!abort.signal.aborted)setBusy(false);}
 }
 const start=useRef(()=>void load());start.current=()=>void load();
 useEffect(()=>{let cancelled=false;if(autoLoad)queueMicrotask(()=>{if(!cancelled)start.current();});return()=>{cancelled=true;};},[autoLoad]);
 function fresh(){if(busy||command.phase==='pending'||command.phase==='uncertain')return;retained.current=null;command.reset();void load();}
 const values=result?.days.map(d=>measure==='bookings'?BigInt(d.bookings):d.billed)??[],negative=values.some(v=>v<0n),rawMaximum=values.reduce((m,v)=>(v<0n?-v:v)>m?(v<0n?-v:v):m,1n),maximum=measure==='bookings'?(rawMaximum+1n)/2n*2n:rawMaximum,left=54,right=18,top=24,bottom=38,height=260,plot=height-top-bottom,baseline=top+(negative?plot/2:plot),span=negative?plot/2:plot,slot=(width-left-right)/Math.max(values.length,1);
 const locked=busy||!!error||command.canRetry;
 const labelDate=(day:string)=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',timeZone:'Asia/Kolkata'}).format(new Date(day+'T12:00:00Z'));
 const chartValue=(value:bigint)=>measure==='bookings'?value.toLocaleString('en-IN'):inr(value);
 const totalBookings=result?.days.reduce((n,d)=>n+d.bookings,0)??0,totalBilled=result?.days.reduce((n,d)=>n+d.billed,0n)??0n;
 function choosePreset(value:string){setPreset(value);if(value==='custom')return;const end=dayOf(new Date()),date=new Date(end+'T12:00:00Z');date.setUTCDate(date.getUTCDate()-Number(value)+1);const next={from:date.toISOString().slice(0,10),to:end};setRange(next);void load(false,next);}
 return <section className="studio-week business-trend" ref={region} aria-label="Weekly business">
 <SectionHeader title="Business performance" description="Compare daily bookings and billed amounts over a date range." actions={<button type="button" className="btn btn-outlined" disabled={busy} onClick={()=>void load(!!error)}>{busy?'Loading report…':error?'Retry report':result?'Refresh report':'Load report'}</button>}/>
 <div className="trend-toolbar"><div className="trend-periods" role="group" aria-label="Chart date range">{[['7','Last 7 days'],['30','Last 30 days'],['custom','Custom dates']].map(([value,label])=><button key={value} type="button" disabled={locked} aria-pressed={preset===value} onClick={()=>choosePreset(value!)}>{label}</button>)}</div><span className="ops-note">{labelDate(result?.snapshot.filter.from_day??range.from)} – {labelDate(result?.snapshot.filter.to_day??range.to)} · IST</span></div>
 {preset==='custom'&&<form className="trend-custom-dates" onSubmit={event=>{event.preventDefault();void load();}}><DateField label="Chart start date" value={range.from} disabled={locked} onChange={from=>setRange({...range,from})}/><DateField label="Chart end date" value={range.to} disabled={locked} onChange={to=>setRange({...range,to})}/><button className="btn btn-filled" disabled={locked}>Apply dates</button><p className="ops-note">Choose up to 31 days, ending today or earlier.</p></form>}
 {rangeError&&<p role="alert">{rangeError}</p>}{error&&<p role="alert" className="ops-alert">{error}</p>}{terminal&&command.phase!=='pending'&&command.phase!=='uncertain'&&<button type="button" className="btn btn-outlined" disabled={busy} onClick={fresh}>Start a fresh weekly report</button>}
 {busy&&<div className="trend-loading" role="status"><span className="trend-loading-line"/><span className="trend-loading-line"/><span className="trend-loading-line"/>Loading your booking trend…</div>}
 {!result&&!busy&&!error&&<p className="ops-note">Choose a period, or load the current date range.</p>}
 {result&&<><div className="trend-metrics" role="group" aria-label="Chart measure"><button type="button" aria-label="Bookings" aria-pressed={measure==='bookings'} onClick={()=>{setMeasure('bookings');setHover(null);}}><span>Bookings</span><strong>{totalBookings.toLocaleString('en-IN')}</strong><small>Confirmed in this period</small></button><button type="button" aria-label="Billed amount" aria-pressed={measure==='billed'} onClick={()=>{setMeasure('billed');setHover(null);}}><span>Billed amount</span><strong>{inr(totalBilled)}</strong><small>Booking value, including tax</small></button><div><span>Average booking</span><strong>{totalBookings?inr((totalBilled+BigInt(Math.floor(totalBookings/2)))/BigInt(totalBookings)):'—'}</strong><small>{totalBookings?'Billed amount ÷ bookings':'Available after your first booking'}</small></div></div>

 <div className="trend-chart-wrap"><div className="trend-chart-caption" aria-live="polite"><span><i/>{measure==='bookings'?'Bookings':'Billed amount'}</span><strong>{hover!==null?labelDate(result.days[hover]!.day)+': '+chartValue(values[hover]!):'Daily trend'}</strong></div>
 <svg className="studio-chart" role="img" aria-label={`${measure==='bookings'?'Bookings':'Billed amount in rupees'} by day. Exact values are in Daily figures below.`} viewBox={`0 0 ${width} ${height}`}>
 {[0,.5,1].map(fraction=>{const y=baseline-span*fraction,v=maximum*BigInt(fraction*100)/100n;return <g key={fraction}><line x1={left} x2={width-right} y1={y} y2={y} stroke="var(--workspace-border)" strokeDasharray={fraction?'3 5':undefined}/><text x={left-8} y={y+4} textAnchor="end">{measure==='bookings'?v.toLocaleString('en-IN'):Number(v/100n).toLocaleString('en-IN',{notation:'compact',maximumFractionDigits:1})}</text></g>;})}
 {result.days.map((day,index)=>{const value=values[index]!,barHeight=Number((value<0n?-value:value)*100000n/maximum)/100000*span,x=left+slot*index+slot*.22,y=value<0n?baseline:baseline-barHeight,label=chartValue(value),tickEvery=Math.ceil(result.days.length/(width>430?7:4));return <g key={day.day} onMouseEnter={()=>setHover(index)} onMouseLeave={()=>setHover(null)}><rect x={left+slot*index} y={top} width={slot} height={plot} fill="transparent"/><rect x={x} y={y} width={slot*.56} height={barHeight} rx={Math.min(5,slot*.12)} fill="var(--md-primary)" opacity={hover===index?1:.78}><title>{day.day}: {label}</title></rect>{index%tickEvery===0&&<text x={x+slot*.28} y={height-12} textAnchor="middle">{labelDate(day.day)}</text>}</g>;})}
 </svg>{totalBookings===0&&<p className="trend-empty">No bookings in these dates. Create your first booking or choose another period.</p>}</div>
 <div className="trend-footer"><details><summary>Daily figures</summary><RecordTable mobile="stack" label="Weekly daily figures" rows={result.days} rowKey={d=>d.day} columns={[{key:'day',label:'Day',cell:d=>labelDate(d.day)},{key:'bookings',label:'Bookings',align:'right',cell:d=>d.bookings},{key:'billed',label:'Billed',align:'right',cell:d=>inr(d.billed)}]}/></details><span className="ops-note">Updated {new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',timeStyle:'short'}).format(new Date(result.snapshot.as_of))} IST</span></div><p className="ops-note">Billed amounts follow booking dates. Payments received are shown separately below.</p></>}
 </section>;
}
