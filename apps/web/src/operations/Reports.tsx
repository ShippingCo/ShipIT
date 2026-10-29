import {PageHeader,SectionHeader,RecordTable,ActiveViewStrip} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import {DatePresets} from './DatePresets';
import {accountant} from '../data-access/accountant';
import {AccountantRegister} from './AccountantRegister';
import OwnerSummaries from './OwnerSummaries';
import {shipmentCostCommand} from '../data-access/shipment-cost-command';
import {shipmentCosts} from '../data-access/shipment-cost';
import {ShipmentCosts} from './ShipmentCosts';
import {effectiveness} from '../data-access/effectiveness';
import {EffectivenessView} from './Effectiveness';
import {performance} from '../data-access/performance';
import {PerformanceView} from './Performance';
import React,{useMemo,useState,useEffect} from 'react';
import { useSearchParams } from 'react-router-dom';
import type { OperatorRole,ReportPage,ReportMoney } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { reports,type ReportSource } from '../data-access/reports';
import { useCommand,useResource,usePagedResource } from './hooks';
import {settings} from '../data-access/settings';
import { TextField,SelectField } from '../components/m3/Input';
import { ApiFailure } from '../data-access/errors';
import { sales } from '../data-access/sales';
import { SalesView } from './Sales';
import { ageing } from '../data-access/ageing';
import { AgeingView } from './Ageing';

const amount=(m:ReportMoney)=>m.state==='unknown'?'Unknown':`₹${(BigInt(m.paise)/100n).toLocaleString('en-IN')}.${(BigInt(m.paise)%100n).toString().padStart(2,'0')}`;
export default function Reports({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
  const accountantSource=useMemo(()=>accountant(scopedApi(controller)),[controller]);
  const source=useMemo(()=>reports(scopedApi(controller)),[controller]);
  const salesSource=useMemo(()=>sales(scopedApi(controller)),[controller]);
  const ageingSource=useMemo(()=>ageing(scopedApi(controller)),[controller]);
  const performanceSource=useMemo(()=>performance(scopedApi(controller)),[controller]);
  const generation=controller.runtime.ticket().generation;
  const costSource=useMemo(()=>shipmentCosts(scopedApi(controller)),[controller]);
  const [costBusy,setCostBusy]=useState(false);
  const effectivenessSource=useMemo(()=>effectiveness(scopedApi(controller)),[controller]);
  const canEffectiveness=(canAdminister(roles,'financial.export')||roles.some(r=>['org_admin','franchise_admin'].includes(r)));
  const canFinance=(canAdminister(roles,'financial.export')||roles.some(r=>['org_admin','franchise_admin','accountant'].includes(r)));
  const canPerformance=(canAdminister(roles,'financial.export')||roles.some(r=>['org_admin','franchise_admin','operator','dispatcher','read_only','delivery_agent'].includes(r)));
  const [reportParams]=useSearchParams();
  const [view,setView]=useState<'sales'|'bookings'|'ageing'|'performance'|'effectiveness'|'costs'|'owner'|'accountant'>(reportParams.has('accountant_snapshot')?'accountant':reportParams.has('owner_report')?'owner':shipmentCostCommand(costSource).snapshot().phase!=='idle'||reportParams.has('contribution_snapshot')?'costs':reportParams.has('effectiveness_snapshot')?'effectiveness':reportParams.has('performance_snapshot')||!canFinance?'performance':reportParams.has('ageing_snapshot')?'ageing':reportParams.has('snapshot')?'bookings':'sales');
  const settingsSource=useMemo(()=>settings(scopedApi(controller)),[controller]);
  const preference=useResource('report-preference-'+generation,signal=>canFinance?settingsSource.read('franchise',signal):Promise.resolve(null));
  const scopes=usePagedResource('authorized-report-scopes-'+generation,async(cursor,signal)=>{if(!canFinance)return {items:[],page:{has_more:false,next_cursor:null}};const p=await settingsSource.scopes(cursor??undefined,signal);return {items:p.items,page:{has_more:p.next_cursor!==null,next_cursor:p.next_cursor}};});
  if(!canFinance&&!canPerformance)return <p role="alert">Reports are unavailable for this role.</p>;
  const canExport=(canAdminister(roles,'financial.export')||roles.some(r=>['franchise_admin','accountant'].includes(r)));
  const franchises=scopes.items;
  const reportPreference=preference.value?.values.report_scope??null;
  return <div className="service-reports"><PageHeader title="Reports and insights" eyebrow="Saved business evidence" description="Capture a permitted period, inspect its saved sources and export matching evidence."/>{canFinance&&<section className="service-report-scope" aria-label="Authorized report scopes"><p>Active report franchise {costSource.api.franchise}. Scope selection never grants access; saved report filters remain unchanged.</p>{scopes.phase==='loading'&&<p role="status">Loading authorized scope options…</p>}{scopes.phase==='error'&&<><p role="alert">Authorized report scopes could not be loaded.</p><button className="btn btn-outlined" onClick={scopes.reload}>Reload report scope options</button></>}{scopes.page.has_more&&<button className="btn btn-outlined" disabled={scopes.phase==='more'} onClick={scopes.loadMore}>Load more authorized franchises</button>}{preference.phase==='error'&&<p role="status">Report scope preference could not be resolved. No saved preference was applied.</p>}</section>}<ActiveViewStrip className="service-view-switch service-report-navigation" label="Report type" value={view}>{canEffectiveness&&<button className="btn btn-outlined" disabled={costBusy} aria-pressed={view==='effectiveness'} onClick={()=>setView('effectiveness')}>Messaging and assistant</button>}{canPerformance&&<button className="btn btn-outlined" disabled={costBusy} aria-pressed={view==='performance'} onClick={()=>setView('performance')}>Delivery performance</button>}{canFinance&&<><button className="btn btn-outlined" disabled={costBusy} aria-pressed={view==='accountant'} onClick={()=>setView('accountant')}>Accountant register</button><button className="btn btn-outlined" disabled={costBusy} aria-pressed={view==='owner'} onClick={()=>setView('owner')}>Owner summaries and alerts</button><button className="btn btn-outlined" disabled={costBusy} aria-pressed={view==='costs'} onClick={()=>setView('costs')}>Shipment costs and contribution</button><button className="btn btn-outlined" disabled={costBusy} aria-pressed={view==='ageing'} onClick={()=>setView('ageing')}>To-Pay ageing</button><button className="btn btn-outlined" disabled={costBusy} aria-pressed={view==='sales'} onClick={()=>setView('sales')}>Sales and GST</button><button className="btn btn-outlined" disabled={costBusy} aria-pressed={view==='bookings'} onClick={()=>setView('bookings')}>Booking snapshots</button></>}</ActiveViewStrip>{view==='effectiveness'?(canEffectiveness?<EffectivenessView source={effectivenessSource}/>:<p role="alert">Messaging reports unavailable for this role.</p>):view==='performance'?(canPerformance?<PerformanceView source={performanceSource} canExport={canAdminister(roles,'financial.export')}/>:<p role="alert">Performance unavailable for this role.</p>):!canFinance?<p role="alert">Financial reports unavailable for this role.</p>:view==='accountant'?<AccountantRegister key={generation} source={accountantSource} canExport={canExport} franchises={franchises}/>:view==='owner'?<OwnerSummaries key={generation} controller={controller} canExport={canExport} franchises={franchises}/>:view==='costs'?<ShipmentCosts key={generation} source={costSource} canManage={canAdminister(roles,'financial.export')} canExport={canExport} franchises={franchises} preference={reportPreference} busy={setCostBusy} isCurrent={()=>controller.runtime.isCurrent(costSource.api.scope)}/>:view==='ageing'?<AgeingView source={ageingSource} canExport={canExport}/>:view==='sales'?<SalesView source={salesSource} canExport={canExport} canManage={canAdminister(roles,'financial.export')} franchises={franchises} preference={reportPreference}/>:<ReportView source={source} canExport={canExport}/>}</div>;
}
export function ReportView({source,canExport}:{source:ReportSource;canExport:boolean}) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [from,setFrom]=useState(today),[to,setTo]=useState(today),[sort,setSort]=useState<'confirmed_asc'|'confirmed_desc'>('confirmed_desc');
  const [params,setParams]=useSearchParams(),id=params.get('snapshot');
  const [result,setResult]=useState<ReportPage|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[revision,setRevision]=useState(0);
  const command=useCommand(source.execute);
  const failure=(e:unknown)=>setNotice(e instanceof ApiFailure?
    e.code==='REPORT_QUOTA_EXCEEDED'?'Twenty saved reports are still active. Reuse one or wait for expiry.':
    e.code==='REPORT_EXPIRED'?'This request has expired. Create a new snapshot.':
    ['ACTION_FORBIDDEN','RESOURCE_NOT_FOUND'].includes(e.code)?'Report unavailable or expired. Check access or create a new snapshot.':
    'Report could not be loaded. Retry, or choose a shorter date range.':'Report could not be loaded. Please retry.');
  useEffect(()=>{
    const abort=new AbortController();setResult(null);if(!id)return()=>abort.abort();setBusy(true);
    void source.page(id,0,abort.signal).then(p=>{if(!abort.signal.aborted){setResult(p);setFrom(p.snapshot.filter.from_day);setTo(p.snapshot.filter.to_day);setSort(p.snapshot.filter.sort);}})
      .catch(e=>{if(!abort.signal.aborted)failure(e);}).finally(()=>{if(!abort.signal.aborted)setBusy(false);});
    return()=>abort.abort();
  },[id,source,revision]);
  async function create(retry=false) {
    if(busy||command.phase==='pending')return;
    setNotice('');setResult(null);
    try{const p=await (retry?command.retry():command.run(source.intent({from_day:from,to_day:to,sort})));if(p){setParams({snapshot:p.snapshot.id});setNotice('Report saved. Totals and CSV use this snapshot.');}}
    catch(e){failure(e);}
  }
  async function more(){if(!result||result.next_offset===null)return;setBusy(true);try{const p=await source.page(result.snapshot.id,result.next_offset);setResult({...p,rows:[...result.rows,...p.rows]});}catch(e){failure(e);}finally{setBusy(false);}}
  async function download(){if(!result)return;setBusy(true);setNotice('');try{
    const exported=await source.export(result.snapshot.id),url=URL.createObjectURL(new Blob([exported.csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`report-${exported.snapshot.id}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('CSV ready. Check your downloads.');
  }catch(e){failure(e);}finally{setBusy(false);}}
  const pending=busy||command.phase==='pending';
  return <section className="service-report-view" aria-label="Booking snapshots"><SectionHeader title="Reports"/>
    <p>Original booking amounts and net funds applied to these bills, including legacy collections and linked receipt allocations. Customer advances stay in Money receipts. Use Sales and GST for financial corrections, actual refunds and adjusted balances.</p>
    <p>Booking snapshot · Asia/Kolkata. Collections include payments received up to capture for these bookings, including later days.</p>
    <form className="service-report-controls" onSubmit={e=>{e.preventDefault();void create();}}>
      <DatePresets disabled={busy||command.canRetry} change={(from,to)=>{setFrom(from);setTo(to);}}/><TextField label="From day" type="date" value={from} onChange={setFrom}/><TextField label="Through day" type="date" value={to} onChange={setTo}/>
      <SelectField label="Order" value={sort} onChange={v=>setSort(v as typeof sort)} options={[{value:'confirmed_desc',label:'Newest first'},{value:'confirmed_asc',label:'Oldest first'}]}/>
      <p>Up to 31 days and 5,000 bookings. Saved reports expire after 24 hours.</p>
      <button className="btn btn-filled" disabled={pending||command.canRetry}>Create snapshot</button>
    </form>
    {command.canRetry&&<button className="btn btn-outlined" disabled={pending} onClick={()=>void create(true)}>Retry same snapshot request</button>}
    {pending&&<p role="status">Loading report…</p>}
    <p role="status" aria-live="polite">{notice}</p>
    {!pending&&notice&&id&&!result&&<button className="btn btn-outlined" onClick={()=>setRevision(r=>r+1)}>Retry saved report</button>}
    {result&&<><p>Saved period: {result.snapshot.filter.from_day} through {result.snapshot.filter.to_day}</p><p>Captured {new Date(result.snapshot.as_of).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST · {result.snapshot.count} bookings</p>
      <div className="ops-facts">{(['billed_gross','tax_exclusive_revenue','collections','outstanding'] as const).map(key=><div key={key}><span>{key.replaceAll('_',' ')}</span><p className="t-headline-sm">{amount(result.snapshot.totals[key])}</p></div>)}</div>
      <p>Costs and due dates are unknown. Other finance sources are not yet available. This is not a GST filing report.</p>
      <button className="btn btn-outlined" disabled={pending||!canExport} onClick={()=>void download()}>Download matching CSV</button>
      {!canExport&&<p>Your role can read reports but cannot export them.</p>}
      {result.snapshot.count===0?<p role="status">No bookings in this period. CSV contains headers.</p>:<RecordTable label="Booking snapshot evidence" rows={result.rows} rowKey={r=>r.id} columns={[
 {key:'booking',label:'Booking',cell:r=><strong className="service-reference">Booking {r.id}</strong>},
 {key:'confirmed',label:'Confirmed',cell:r=>new Date(r.confirmed_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})+' IST'},
 {key:'billed',label:'Booked',align:'right',cell:r=>amount({state:'known',paise:r.billed_gross})},
 {key:'collected',label:'Collected',align:'right',cell:r=>amount({state:'known',paise:r.collections})},
 {key:'outstanding',label:'Outstanding',align:'right',cell:r=>amount({state:'known',paise:r.outstanding})},
 ]}/>}
      {result.next_offset!==null&&<button className="btn btn-outlined" disabled={pending} onClick={()=>void more()}>Load more bookings</button>}
    </>}
  </section>;
}
