import {PageHeader,WorkflowTabs} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import type {OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {reconciliation} from '../data-access/reconciliation';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {useCommand,usePagedResource,useResource} from './hooks';
import {Empty,Loading,Failure,CommandNotice} from './AsyncState';
import {Blocked} from './Blocked';
import {Msym} from '../components/m3/Icon';
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
 return <div className="ops-page reconciliation-workspace"><section className="finance-workspace-intro"><PageHeader title="Match bank payments" eyebrow="Money · Bank matching"/>
  {config.phase==='loading'?<Loading/>:config.phase==='error'?<Failure retry={config.reload}/>:config.value&&<><ReconciliationState enabled={config.value.enabled} writable={config.value.writes_available} admin={admin}/>
   {admin&&<details className="finance-secondary-action" open={!config.value.enabled||undefined}><summary>Bank matching settings</summary>
   {/* Offering an Enable button that the server will never accept is worse than saying so. */}
   {config.value.writes_available
     ? <form onSubmit={e=>{e.preventDefault();void mutate('config',{expected_version:config.value!.version,enabled:!config.value!.enabled,reason});}} className="ops-form finance-grouped-form"><fieldset disabled={locked}><TextField label="Reason for enabling or disabling reconciliation" value={reason} onChange={setReason} required/><button className="btn btn-outlined" disabled={reason.trim().length<3}>{config.value.enabled?'Disable reconciliation':'Enable reconciliation'}</button></fieldset></form>
     : <Blocked title={'Bank matching cannot be turned '+(config.value.enabled?'off':'on')+' from here'} blockers={[{text:'This server is not accepting new bank-matching evidence, so the setting cannot be changed right now. Saved statements and matches stay available to read.',fix:<>Ask whoever administers this installation to allow reconciliation writes.</>}]}/>}
  </details>}</>}
  {accounts.phase==='loading'?<Loading/>:accounts.phase==='error'?<Failure retry={accounts.reload}/>:<><SelectField label="Receiving account" value={account} disabled={locked} onChange={setAccount} options={[{value:'',label:'Select a non-cash account'},...accounts.items.map(a=>({value:a.id,label:a.name+(a.active?'':' · inactive, history available')}))]}/>{!accounts.items.length&&<Empty icon="account_balance" title="No bank accounts available" body={admin?'Add a non-cash receiving account to start matching payments.':'Ask your branch administrator to add a non-cash receiving account.'} action={admin?<Link className="btn btn-outlined" to="/business/money-receipts">Open receiving accounts</Link>:undefined}/>}{accounts.page.has_more&&<button className="btn btn-text" disabled={locked} onClick={accounts.loadMore}>More receiving accounts</button>}</>}
  {account&&<WorkflowTabs label="Reconciliation sections" value={tab} onChange={setTab} items={[{value:'review',label:'Daily review',disabled:locked},{value:'imports',label:'Statements and mappings',disabled:locked},{value:'matching',label:'Match evidence',disabled:locked}]}/>}
  {blocked&&locked&&<p role="alert">Resolve the retained action before leaving or changing franchise.</p>}
  {notice&&<p role="status">{notice}</p>}<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{if(dispatching.current)return;dispatching.current=true;void command.retry().then(r=>{if(r)confirmed(r);}).catch(e=>setNotice(failureMessage(e))).finally(()=>{dispatching.current=false;});}:undefined}/>
  {command.phase==='error'&&(!command.canRetry||['RECONCILIATION_DISABLED','RECONCILIATION_CONFLICT'].includes(command.error?.code??''))&&<button className="btn btn-text" onClick={()=>{command.reset();setRevision(v=>v+1);setNotice('Reloaded current evidence. Review the draft before submitting a new action.');}}>Reload after rejected action</button>}
 </section>{account&&(tab==='imports'?<ReconciliationImports key={account} {...workspace}/>:tab==='matching'?<ReconciliationMatching key={account} {...workspace}/>:<ReconciliationReview key={account} {...workspace} canExport={writer}/>)}</div>;
}

/**
 * What bank matching can and cannot do here, in words an operator can act on.
 *
 * This line used to read "Disabled for this franchise · New evidence is disabled by the
 * server", which is two pieces of server vocabulary and no instruction. The four states are
 * genuinely different — on and usable, on but read-only, off but switchable, off and not
 * switchable — and each one implies a different next move, so each one now says it.
 */
function ReconciliationState({enabled,writable,admin}:{enabled:boolean;writable:boolean;admin:boolean}) {
 const usable=enabled&&writable;
 const body=usable?'Bank matching is on. Add a statement and match it against recorded payments.'
  :enabled?'Bank matching is on, but this installation is not taking new statements right now. Saved statements and matches stay available to read.'
  :writable?(admin?'Bank matching is off for this branch. Turn it on in the settings below to start matching.':'Bank matching is off for this branch. Ask your branch administrator to turn it on.')
  :'Bank matching is off, and it cannot be turned on from here. Saved statements and matches stay available to read.';
 return <p role="status" className={'workspace-command-state'+(usable?' workspace-command-confirmed':'')}>
  <Msym name={usable?'check_circle':'info'}/>{body}
 </p>;
}

export default function Reconciliation(props:{controller:ScopeController;roles:readonly OperatorRole[]}){return (canAdminister(props.roles,'reconciliation.configure')||props.roles.includes('accountant'))?<ReconciliationWorkspace {...props}/>:<section className="card ops-card"><h1>Reconciliation access unavailable</h1><p>A financial read grant is required for statement evidence.</p></section>;}
