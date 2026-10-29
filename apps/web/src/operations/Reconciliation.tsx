import {PageHeader,WorkflowTabs} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import {useEffect,useMemo,useRef,useState} from 'react';
import type {OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {reconciliation} from '../data-access/reconciliation';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {useCommand,usePagedResource,useResource} from './hooks';
import {Loading,Failure,CommandNotice} from './AsyncState';
import {TextField,SelectField} from '../components/m3/Input';
import {failureMessage} from '../booking/failures';
import {paged,type Result} from './reconciliation/shared';
import {ReconciliationImports} from './reconciliation/Imports';
import {ReconciliationMatching} from './reconciliation/Matching';
import {ReconciliationReview} from './reconciliation/Review';
function ReconciliationWorkspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}) {
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>reconciliation(api),[api]);
 const [revision,setRevision]=useState(0),[account,setAccount]=useState(''),[tab,setTab]=useState('review'),[reason,setReason]=useState(''),[notice,setNotice]=useState(''),[blocked,setBlocked]=useState(false);
 const config=useResource(String(revision),signal=>source.config(signal)),accounts=usePagedResource(String(revision),(cursor,signal)=>source.accounts(cursor??undefined,signal).then(paged));
 const command=useCommand(source.execute),locked=command.phase==='pending'||command.canRetry,dispatching=useRef(false),successRef=useRef<((r:Result)=>void)|undefined>(undefined);
 const admin=canAdminister(roles,'reconciliation.configure'),writer=admin||roles.includes('accountant'),enabled=writer&&config.value?.enabled===true&&config.value.writes_available;
 useEffect(()=>{
  if(!locked)return;const leave=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
  const navigate=(event:MouseEvent)=>{if(event.target instanceof Element&&event.target.closest('a[href]')){event.preventDefault();event.stopPropagation();setBlocked(true);}};
  const change=(event:Event)=>{if(event.target instanceof HTMLSelectElement&&event.target.matches('select[aria-label="Franchise"]')){event.stopPropagation();event.target.value=api.franchise;setBlocked(true);}};
  const release=retainAccountNavigation(api.scope,()=>setBlocked(true));window.addEventListener('beforeunload',leave);document.addEventListener('click',navigate,true);document.addEventListener('change',change,true);
  return()=>{release();window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true);document.removeEventListener('change',change,true);};
 },[locked,api]);
 function confirmed(result:Result){if(api.scope.signal.aborted)return;successRef.current?.(result);successRef.current=undefined;setRevision(v=>v+1);setNotice('Action confirmed. Current evidence refreshed.');}
 async function mutate(path:string,body:unknown,success?:(r:Result)=>void){if(locked||dispatching.current)return;dispatching.current=true;successRef.current=success;setNotice('');try{confirmed(await command.run(source.command(path,body)));}catch(error){if(!api.scope.signal.aborted)setNotice(failureMessage(error));}finally{dispatching.current=false;}}
 const workspace={source,account,revision,locked,enabled,admin,mutate};
 return <div className="ops-page reconciliation-workspace"><section className="finance-workspace-intro"><PageHeader title="Payment reconciliation" description="Optional comparison of recorded money with manually uploaded statements. Bookings, collections, receipts, refunds and reports work with this feature disabled." eyebrow="Finance workspace"/>
  {config.phase==='loading'?<Loading/>:config.phase==='error'?<Failure retry={config.reload}/>:config.value&&<><p role="status">{config.value.enabled?'Enabled for this franchise':'Disabled for this franchise'} · {config.value.writes_available?'Server accepts new reconciliation evidence':'New evidence is disabled by the server'}</p>
   {admin&&<form onSubmit={e=>{e.preventDefault();void mutate('config',{expected_version:config.value!.version,enabled:!config.value!.enabled,reason});}} className="ops-form finance-grouped-form"><fieldset disabled={locked||!config.value.writes_available}><TextField label="Reason for enabling or disabling reconciliation" value={reason} onChange={setReason} required/><button className="btn btn-outlined" disabled={reason.trim().length<3}>{config.value.enabled?'Disable reconciliation':'Enable reconciliation'}</button></fieldset></form>}</>}
  {accounts.phase==='loading'?<Loading/>:accounts.phase==='error'?<Failure retry={accounts.reload}/>:<><SelectField label="Receiving account" value={account} disabled={locked} onChange={setAccount} options={[{value:'',label:'Select a non-cash account'},...accounts.items.map(a=>({value:a.id,label:a.name+(a.active?'':' · inactive, history available')}))]}/>{!accounts.items.length&&<p>No non-cash receiving accounts. An administrator can configure one in Money receipts.</p>}{accounts.page.has_more&&<button className="btn btn-text" disabled={locked} onClick={accounts.loadMore}>More receiving accounts</button>}</>}
  <WorkflowTabs label="Reconciliation sections" value={tab} onChange={setTab} items={[{value:'review',label:'Daily review',disabled:locked},{value:'imports',label:'Statements and mappings',disabled:locked},{value:'matching',label:'Match evidence',disabled:locked}]}/>
  {blocked&&locked&&<p role="alert">Resolve the retained action before leaving or changing franchise.</p>}
  <p role="status">{notice}</p><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{if(dispatching.current)return;dispatching.current=true;void command.retry().then(r=>{if(r)confirmed(r);}).catch(e=>setNotice(failureMessage(e))).finally(()=>{dispatching.current=false;});}:undefined}/>
  {command.phase==='error'&&(!command.canRetry||['RECONCILIATION_DISABLED','RECONCILIATION_CONFLICT'].includes(command.error?.code??''))&&<button className="btn btn-text" onClick={()=>{command.reset();setRevision(v=>v+1);setNotice('Reloaded current evidence. Review the draft before submitting a new action.');}}>Reload after rejected action</button>}
 </section>{account&&(tab==='imports'?<ReconciliationImports key={account} {...workspace}/>:tab==='matching'?<ReconciliationMatching key={account} {...workspace}/>:<ReconciliationReview key={account} {...workspace} canExport={writer}/>)}</div>;
}

export default function Reconciliation(props:{controller:ScopeController;roles:readonly OperatorRole[]}){return (canAdminister(props.roles,'reconciliation.configure')||props.roles.includes('accountant'))?<ReconciliationWorkspace {...props}/>:<section className="card ops-card"><h1>Reconciliation access unavailable</h1><p>A financial read grant is required for statement evidence.</p></section>;}
