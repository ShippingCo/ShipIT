import {PageHeader,RecordTable,SectionHeader,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import CustodyTransfers from './CustodyTransfers';
import AgentAccess from './AgentAccess';
import CustodyActions from './CustodyActions';
import React,{useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import type {OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {custody} from '../data-access/custody';
import {scopedApi} from '../data-access/scoped-api';
import type {CommandIntent} from '../data-access/command-intent';
import {useCommand,usePagedResource,useResource} from './hooks';
import {CommandNotice,Empty,Failure,Loading} from './AsyncState';
import {formatKolkata} from './format';
const allowed=(roles:readonly OperatorRole[])=>(canAdminister(roles,'custody.prepare')||roles.some(r=>['org_admin','franchise_admin','operator','dispatcher','delivery_agent','read_only'].includes(r)));
export default function Custody({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
 if(!controller.runtime.ticket().authority||!allowed(roles))return <Empty title="Parcel custody unavailable" body="Select a permitted franchise."/>;
 return <Workspace key={controller.runtime.ticket().generation} controller={controller} roles={roles}/>;
}
function Workspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>custody(api),[api]);
 const [selected,setSelected]=useState<string|null>(null),[revision,setRevision]=useState(0),[snapshotId,setSnapshotId]=useState<string|null>(null),[downloadBusy,setDownloadBusy]=useState(false),[notice,setNotice]=useState(''),[blocked,setBlocked]=useState(false);
 const work=usePagedResource('work-'+revision,async(cursor,signal)=>{const r=await source.worklist(cursor??undefined,signal);return {items:r.items,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const manifests=usePagedResource('manifests-'+revision,async(cursor,signal)=>{const r=await source.manifests(cursor??undefined,signal);return {items:r.items,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const agents=usePagedResource('agents-'+revision,async(cursor,signal)=>{if(!(canAdminister(roles,'custody.prepare')||roles.some(r=>['franchise_admin','dispatcher'].includes(r))))return {items:[],page:{has_more:false,next_cursor:null}};const r=await source.agents(cursor??undefined,signal);return {items:r.agents,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const detail=useResource((selected??'none')+'-'+revision,signal=>selected?source.manifest(selected,signal):Promise.resolve(null)),report=useResource((selected??'none')+'-'+revision,signal=>selected?source.report(selected,signal):Promise.resolve(null));
 const manifest=detail.value?.id===selected?detail.value:null,evidence=report.value?.manifest_id===selected?report.value:null;
 const command=useCommand(async(intent:CommandIntent)=>{if(intent.operation==='custody.capture')return {snapshot:(await source.executeCapture(intent)).id,resource:null};const result=await source.execute(intent);return {snapshot:null,resource:result.resource_id};});
 const locked=downloadBusy||command.phase==='pending'||command.phase==='uncertain';
 const confirmed=(result:{snapshot:string|null;resource:string|null})=>{if(!controller.runtime.isCurrent(api.scope))return;setSnapshotId(result.snapshot);if(result.resource)setNotice('Saved reference: '+result.resource);setRevision(r=>r+1);};
 async function run(intent:CommandIntent){try{confirmed(await command.run(intent));}catch{/* Exact uncertain intent remains in useCommand. */}}
 async function retry(){try{const r=await command.retry();if(r)confirmed(r);}catch{/* Keep original intent. */}}
 useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(locked){event.preventDefault();event.returnValue='';}},navigate=(event:MouseEvent)=>{if(locked&&event.target instanceof Element&&event.target.closest('a[href]')){event.preventDefault();event.stopPropagation();setBlocked(true);}},change=(event:Event)=>{if(locked&&event.target instanceof Element&&event.target.matches('select[aria-label="Franchise"]')){event.stopPropagation();(event.target as HTMLSelectElement).value=api.franchise;setBlocked(true);}};window.addEventListener('beforeunload',leave);document.addEventListener('click',navigate,true);document.addEventListener('change',change,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true);document.removeEventListener('change',change,true);};},[locked,api.franchise]);
 async function download(){if(!snapshotId)return;setDownloadBusy(true);setNotice('');try{const result=await source.export(snapshotId);if(!controller.runtime.isCurrent(api.scope))return;const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='custody-'+result.snapshot.id+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Captured CSV ready. Check your downloads.');}catch{if(controller.runtime.isCurrent(api.scope))setNotice('Captured export unavailable. Retry or refresh current access.');}finally{if(controller.runtime.isCurrent(api.scope))setDownloadBusy(false);}}
 return <div className="ops-page logistics-workspace"><PageHeader title="Parcel custody" eyebrow="Physical handovers" description="Confirm actual parcel handovers and office returns. Delivery proof remains in the delivery workflow; failed attempts do not confirm an office return." actions={<button className="btn btn-text" disabled={locked} onClick={()=>{command.reset();setSnapshotId(null);setRevision(r=>r+1);}}>Refresh current evidence</button>}/>
 <div className="logistics-notices"><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>void retry():undefined}/>{blocked&&locked&&<p role="alert">Reconcile this exact request before leaving or changing franchise.</p>}{notice&&<p role="status">{notice}</p>}</div>
 <section className="card ops-card logistics-records"><SectionHeader title="Current worklist"/>{work.phase==='loading'?<Loading/>:work.phase==='error'?<Failure retry={work.reload}/>:work.items.length===0?<Empty title="No current parcels" body="No parcels are currently assigned to you or physically held by you within this scope."/>:<RecordTable label="Custody worklist" rows={work.items} rowKey={p=>p.parcel_id} columns={[
  {key:'parcel',label:'Parcel',cell:p=><div className="record-identity"><strong>{p.docket}</strong><span className="ops-note ops-mono logistics-reference">Parcel: {p.parcel_id}</span></div>},
  {key:'status',label:'Operational status',cell:p=><StatusBadge tone={p.status==='delivered'?'success':p.status==='failed_attempt'?'warning':'info'}>{p.status.replaceAll('_',' ')}</StatusBadge>},
  {key:'custody',label:'Physical custody',cell:p=>p.physical_custody},
  {key:'receipt',label:'Receipt',cell:p=><span className="ops-mono logistics-reference">{p.receipt_id??'No recorded handover'}</span>},
  {key:'proof',label:'Delivery proof',cell:p=><span className="ops-mono logistics-reference">{p.proof_id??'No recorded proof'}</span>},
 ]}/>}{work.page.has_more&&<button className="btn btn-outlined" disabled={locked||work.phase==='more'} onClick={work.loadMore}>Load more parcels</button>}</section>
 {canAdminister(roles,'custody.prepare')&&<AgentAccess controller={controller} changed={()=>setRevision(r=>r+1)}/>}
 {agents.page.has_more&&<button className="btn btn-outlined" disabled={locked||agents.phase==='more'} onClick={agents.loadMore}>Load more receiving agents</button>}
 {agents.phase==='error'?<Failure retry={agents.reload} label="Receiving agents unavailable."/>:<CustodyActions key={revision} roles={roles} parcels={work.items} agents={agents.items} locked={locked||work.phase==='loading'||agents.phase==='loading'} submit={c=>void run(source.intent(c))}/>}
 <CustodyTransfers source={source} user={api.scope.authority!.userId} roles={roles} revision={revision} locked={locked} submit={c=>void run(source.intent(c))}/>
 <section className="card ops-card logistics-records"><SectionHeader title="Handover manifests"/>{manifests.phase==='loading'?<Loading/>:manifests.phase==='error'?<Failure retry={manifests.reload}/>:manifests.items.length===0?<Empty title="No manifests" body="Prepared and acknowledged handovers will appear here."/>:<RecordTable label="Handover manifests" rows={manifests.items} rowKey={m=>m.id} selectedKey={selected} columns={[
  {key:'manifest',label:'Manifest',cell:m=><strong className="ops-mono logistics-reference">Manifest {m.id}</strong>},
  {key:'state',label:'State',cell:m=><StatusBadge tone={m.state==='acknowledged'?'success':m.state==='prepared'?'info':'neutral'}>{m.state}</StatusBadge>},
  {key:'parcels',label:'Parcels',align:'right',cell:m=>m.item_count},
  {key:'agent',label:'Receiving agent',cell:m=><span className="ops-mono logistics-reference">{m.agent_id}</span>},
  {key:'recorded',label:'Recorded',cell:m=>formatKolkata(m.recorded_at)},
  {key:'actions',label:'Actions',className:'record-actions',cell:m=><button className="btn btn-outlined" disabled={locked} onClick={()=>{setSelected(m.id);setSnapshotId(null);command.reset();}}>View handover</button>},
 ]}/>}{manifests.page.has_more&&<button className="btn btn-outlined" disabled={locked||manifests.phase==='more'} onClick={manifests.loadMore}>Load more manifests</button>}</section>
 {selected&&<section className="card ops-card logistics-selected"><h2 className="t-title-lg">Manifest {selected}</h2>{detail.phase==='loading'?<Loading/>:detail.phase==='error'?<Failure retry={detail.reload}/>:manifest&&<><p>{manifest.state} · Receiving agent {manifest.agent_id}</p><RecordTable label="Selected handover items" rows={manifest.items} rowKey={i=>i.id} columns={[
 {key:'parcel',label:'Parcel',cell:i=><span className="ops-mono logistics-reference">Parcel {i.parcel_id}</span>},
 {key:'receipt',label:'Receipt',cell:i=><span className="ops-mono logistics-reference">Receipt {i.receipt_id??'Awaiting acknowledgement'}</span>},
]}/>{manifest.state==='prepared'&&canAdminister(roles,'custody.prepare')&&<button className="btn btn-outlined" disabled={locked} onClick={()=>void run(source.intent({kind:'cancel',id:manifest.id,body:{expected_version:1}}))}>Cancel this prepared handover</button>}{manifest.state==='prepared'&&roles.includes('delivery_agent')&&manifest.agent_id===api.scope.authority?.userId&&<button className="btn btn-filled" disabled={locked} onClick={()=>void run(source.intent({kind:'acknowledge',id:manifest.id,body:{expected_version:1}}))}>Confirm I received every listed parcel</button>}</>}
 {report.phase==='loading'?<Loading label="Loading source counts…"/>:report.phase==='error'?<Failure retry={report.reload}/>:evidence&&<><p>Evidence as of {formatKolkata(evidence.as_of)}</p><dl className="ops-facts logistics-report-totals">{Object.entries(evidence.totals).map(([name,count])=><div className="ops-fact" key={name}><dt>{name}</dt><dd>{count}</dd></div>)}</dl><p>Failed counts overlap physical outcomes. Genuine delivery proof is required for delivered counts.</p><RecordTable label="Custody outcomes" rows={evidence.items} rowKey={i=>i.item_id} columns={[
 {key:'parcel',label:'Parcel',cell:i=><strong className="ops-mono logistics-reference">{i.parcel_id}</strong>},
 {key:'outcome',label:'Outcome',cell:i=><StatusBadge>{i.outcome}</StatusBadge>},
 {key:'origin',label:'Origin receipt',cell:i=><span className="ops-mono logistics-reference">{i.origin_receipt_id??'Pending'}</span>},
 {key:'current',label:'Current receipt',cell:i=><span className="ops-mono logistics-reference">{i.current_receipt_id??'Pending'}</span>},
 {key:'proof',label:'Proof',cell:i=><span className="ops-mono logistics-reference">{i.proof_id??'None'}</span>},
 {key:'failures',label:'Failed attempt evidence',cell:i=><span className="ops-mono logistics-reference">{i.failure_ids.length?i.failure_ids.join(', '):'—'}</span>},
]}/>{canAdminister(roles,'custody.prepare')&&<><button className="btn btn-outlined" disabled={locked} onClick={()=>void run(source.capture(evidence.manifest_id))}>Capture private custody report</button>{snapshotId&&<button className="btn btn-outlined" disabled={locked} onClick={()=>void download()}>Download captured CSV</button>}</>}</>}
 </section>}</div>;
}
