import React,{useEffect,useMemo,useState} from 'react';
import type {ScopeController} from '../operator/scope';
import type {CommandIntent} from '../data-access/command-intent';
import {scopedApi} from '../data-access/scoped-api';
import {cashbook} from '../data-access/cashbook';
import {useCommand,usePagedResource} from './hooks';
import {CommandNotice,Failure,Loading} from './AsyncState';
import CashHandovers from './CashHandovers';
export default function AgentCashHandovers({controller,onBusy}:{controller:ScopeController;onBusy:(busy:boolean)=>void}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>cashbook(api),[api]);
 const [revision,setRevision]=useState(0),[selected,setSelected]=useState<string|null>(null);
 const locations=usePagedResource('own-handover-sources-'+revision,async(cursor,signal)=>{const r=await source.handoverSources(cursor??undefined,signal);return {items:r.items,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const command=useCommand(intent=>source.executeHandover(intent)),locked=command.phase==='pending'||command.phase==='uncertain';
 useEffect(()=>{onBusy(locked);return()=>onBusy(false);},[locked,onBusy]);
 function confirmed(r:Awaited<ReturnType<typeof source.executeHandover>>){if(!controller.runtime.isCurrent(api.scope))return;setSelected('handover_id' in r?r.handover_id:r.id);setRevision(n=>n+1);}
 async function run(intent:CommandIntent){try{confirmed(await command.run(intent));}catch{/* Preserve original uncertain handover. */}}
 async function retry(){try{const r=await command.retry();if(r)confirmed(r);}catch{/* Preserve original identity. */}}
 return <><section className="card ops-card"><h1 id="workspace-title" tabIndex={-1} className="t-headline-sm">Your cash handovers</h1><p>Only your current sending locations and permitted handover evidence are available here. The named receiver acknowledges actual cash separately.</p><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>void retry():undefined}/><button className="btn btn-text" disabled={locked} onClick={()=>{command.reset();setRevision(n=>n+1);}}>Refresh handover evidence</button>{locations.phase==='loading'&&<Loading label="Loading your sending cash locations..."/>}{locations.phase==='error'&&<Failure retry={locations.reload}/>} {locations.page.has_more&&<button className="btn btn-outlined" disabled={locked||locations.phase==='more'} onClick={locations.loadMore}>Load more sending locations</button>}</section><CashHandovers source={source} locations={locations.items} userId={api.scope.authority!.userId} admin={false} canRequest={true} locked={locked} revision={revision} selected={selected} select={setSelected} run={intent=>void run(intent)}/></>;
}
