import {ReportWorkspace} from './ReportWorkspace';
import './report-page.css';
import {ReportMeasures} from './ReportMeasures';
import {Msym} from '../components/m3/Icon';
import {PageHeader,SectionHeader,RecordTable} from '../components/workspace/Workspace';
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
import { DateField,SelectField } from '../components/m3/Input';
import { ApiFailure } from '../data-access/errors';
import { sales } from '../data-access/sales';
import { SalesView,salesAmount } from './Sales';
import { ageing } from '../data-access/ageing';
import { AgeingView } from './Ageing';

const amount=(m:ReportMoney)=>m.state==='unknown'?'Unknown':salesAmount(m.paise);
export function OperationalReports({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
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
  const reportTypes=[
   ...(canFinance?[{id:'sales' as const,title:'Sales register and GST',description:'Booking charges, tax and financial corrections.'},{id:'ageing' as const,title:'Outstanding payments',description:'Booking balances and To-Pay ageing.'},{id:'bookings' as const,title:'Booking snapshots',description:'Saved booking details, totals and exports.'}]:[]),
   ...(canPerformance?[{id:'performance' as const,title:'Delivery performance',description:'Recorded delivery results and exceptions.'}]:[]),
   ...(canEffectiveness?[{id:'effectiveness' as const,title:'Messages and assistant',description:'Provider progress and customer assistance.'}]:[]),
   ...(canFinance?[{id:'costs' as const,title:'Shipment costs',description:'Recorded costs and contribution.'},{id:'owner' as const,title:'Owner summaries',description:'Saved summaries and review alerts.'},{id:'accountant' as const,title:'Accountant register',description:'Review financial records and exports.'}]:[])
  ];
  const selectedReport=reportTypes.find(report=>report.id===view);
  return <div className="service-reports reference-service"><PageHeader title="Reports" description="Choose a report to view figures for your branch."/>
  <div className="report-choice"><span className="report-choice-icon" aria-hidden="true"><Msym name="analytics"/></span><SelectField label="Report type" value={view} disabled={costBusy} options={reportTypes.map(report=>({value:report.id,label:report.title}))} onChange={value=>{const next=reportTypes.find(report=>report.id===value);if(next)setView(next.id);}}/>{selectedReport&&<p>{selectedReport.description}</p>}</div>
  {canFinance&&<section className="service-report-scope" aria-label="Authorized report scopes"><details className="service-report-scope-details"><summary>Report scope details</summary><p>Current branch: {franchises.find(branch=>branch.id===costSource.api.franchise)?.name??costSource.api.franchise}. Choose other branches in the report when available.</p></details>{scopes.phase==='loading'&&<p role="status">Loading authorized scope options…</p>}{scopes.phase==='error'&&<><p role="alert">Authorized report scopes could not be loaded.</p><button className="btn btn-outlined" onClick={scopes.reload}>Reload report scope options</button></>}{scopes.page.has_more&&<button className="btn btn-outlined" disabled={scopes.phase==='more'} onClick={scopes.loadMore}>Load more authorized franchises</button>}{preference.phase==='error'&&<p role="status">Report scope preference could not be resolved. No saved preference was applied.</p>}</section>}<div className="reference-report-body">{view==='effectiveness'?(canEffectiveness?<EffectivenessView source={effectivenessSource}/>:<p role="alert">Messaging reports unavailable for this role.</p>):view==='performance'?(canPerformance?<PerformanceView source={performanceSource} canExport={canAdminister(roles,'financial.export')}/>:<p role="alert">Performance unavailable for this role.</p>):!canFinance?<p role="alert">Financial reports unavailable for this role.</p>:view==='accountant'?<AccountantRegister key={generation} source={accountantSource} canExport={canExport} franchises={franchises}/>:view==='owner'?<OwnerSummaries key={generation} controller={controller} canExport={canExport} franchises={franchises}/>:view==='costs'?<ShipmentCosts key={generation} source={costSource} canManage={canAdminister(roles,'financial.export')} canExport={canExport} franchises={franchises} preference={reportPreference} busy={setCostBusy} isCurrent={()=>controller.runtime.isCurrent(costSource.api.scope)}/>:view==='ageing'?<AgeingView source={ageingSource} canExport={canExport}/>:view==='sales'?<SalesView source={salesSource} canExport={canExport} canManage={canAdminister(roles,'financial.export')} franchises={franchises} preference={reportPreference}/>:<ReportView source={source} canExport={canExport}/>}</div></div>;
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
  return <section className="service-report-view" aria-label="Booking snapshots"><SectionHeader title="Booking snapshots" description="Save a date range to review bookings and download matching totals."/>

    <form className="service-report-controls" onSubmit={e=>{e.preventDefault();void create();}}>
      <DatePresets disabled={busy||command.canRetry} change={(from,to)=>{setFrom(from);setTo(to);}}/><DateField label="From day" disabled={pending||command.canRetry} value={from} onChange={setFrom}/><DateField label="Through day" disabled={pending||command.canRetry} value={to} onChange={setTo}/>
      <SelectField disabled={pending||command.canRetry} label="Order" value={sort} onChange={v=>setSort(v as typeof sort)} options={[{value:'confirmed_desc',label:'Newest first'},{value:'confirmed_asc',label:'Oldest first'}]}/>
      <p>Up to 31 days and 5,000 bookings. Saved reports expire after 24 hours.</p>
      <button className="btn btn-filled" disabled={pending||command.canRetry}>Create snapshot</button>
    </form>
    <details className="form-secondary-options"><summary>What this report includes</summary><p>Original booking amounts and net funds applied to these bills, including legacy collections and linked receipt allocations. Customer advances stay in Money receipts. Use Sales and GST for financial corrections, actual refunds and adjusted balances.</p>
    <p>Booking snapshot · Asia/Kolkata. Collections include payments received up to capture for these bookings, including later days.</p></details>
    {command.canRetry&&<button className="btn btn-outlined" disabled={pending} onClick={()=>void create(true)}>Retry same snapshot request</button>}
    {pending&&<p role="status">Loading report…</p>}
    <p role="status" aria-live="polite">{notice}</p>
    {!pending&&notice&&id&&!result&&<button className="btn btn-outlined" onClick={()=>setRevision(r=>r+1)}>Retry saved report</button>}
    {result&&<><p>Saved period: {result.snapshot.filter.from_day} through {result.snapshot.filter.to_day}</p><p>Captured {new Date(result.snapshot.as_of).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST · {result.snapshot.count} bookings</p>
      <ReportMeasures label="Booking totals" items={[
        {label:'Billed amount',value:amount(result.snapshot.totals.billed_gross)},
        {label:'Revenue before tax',value:amount(result.snapshot.totals.tax_exclusive_revenue)},
        {label:'Collections',value:amount(result.snapshot.totals.collections)},
        {label:'Outstanding',value:amount(result.snapshot.totals.outstanding)},
      ]}/>
      <p>For refunds and corrections, open Sales and GST. For due dates, open Outstanding payments.</p>
      <button className="btn btn-outlined" disabled={pending||!canExport} onClick={()=>void download()}>Download matching CSV</button>
      {!canExport&&<p>Your role can read reports but cannot export them.</p>}
      {result.snapshot.count===0?<p role="status">No bookings in this period. CSV contains headers.</p>:<RecordTable mobile="stack" label="Booking snapshot evidence" rows={result.rows} rowKey={r=>r.id} columns={[
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

export default function Reports(props:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const [params]=useSearchParams();
 const advanced=params.get('view')==='advanced'||[...params.keys()].some(key=>key.endsWith('_snapshot')||key==='snapshot'||key==='owner_report')||props.roles.includes('accountant')&&!props.roles.some(r=>['org_admin','franchise_admin'].includes(r));
 return advanced?<OperationalReports {...props}/>:<ReportWorkspace {...props}/>;
}
