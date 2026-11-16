import {PageHeader,RecordTable,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
import React,{useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import type {OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {agentStatements,type StatementCapture,type StatementDetail,type StatementExport} from '../data-access/agent-statements';
import {custody} from '../data-access/custody';
import type {CommandIntent} from '../data-access/command-intent';
import {SelectField,TextField, DateField} from '../components/m3/Input';
import {useCommand,usePagedResource,useResource} from './hooks';
import {DataRefresh,CommandNotice,Empty,Failure,Loading} from './AsyncState';
import {Blocked} from './Blocked';
import {instantToKolkataInput,kolkataInputToInstant,rupeesToPaise,formatKolkata,formatMoney as formatMoneyPaise} from './format';
import AgentStatementEvidence from './AgentStatementEvidence';
import AgentMoney from './AgentMoney';
import AgentCashHandovers from './AgentCashHandovers';
/**
 * Agents have no name in the API, so the most this screen can honestly show is a short code
 * they can read out. See "11 Custody and Agents/PRD.md" Q4 — the same gap, the same handle.
 */
const agentName=(id:string,self:string)=>id===self?'your':'Agent '+id.slice(-6).toUpperCase()+'\u2019s';
const has=(roles:readonly OperatorRole[],...allowed:OperatorRole[])=>(allowed.some(role=>role!=='delivery_agent'&&role!=='org_admin')&&canAdminister(roles,'agent_statement.decide'))||roles.some(r=>allowed.includes(r));
export default function AgentSettlements({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
 if(!controller.runtime.ticket().authority||!has(roles,'franchise_admin','operator','delivery_agent','org_admin','accountant'))return <Empty title="Settlement access unavailable" body="Select a permitted franchise."/>;
 return <Workspace key={controller.runtime.ticket().generation} controller={controller} roles={roles}/>;
}
/**
 * Counting in an agent's cash at the end of their day.
 *
 * It is the same physical act as counting the drawer, done with the agent standing there, so
 * it uses the same large field and the same three lines: what they should have, what they
 * handed over, and the difference — computed, never typed. "Short by" and "Over by" are
 * different words in different colours, and a reason is required only when there is something
 * to explain.
 *
 * Two things are deliberately kept out of the arithmetic and said out loud. The agent's fee is
 * settled separately and is never netted off the cash they hand in — an agent who sees their
 * fee disappear into a shortfall stops trusting the count. And a payment the customer made
 * straight to the shop by UPI is not cash the agent is carrying, so it is excluded and shown
 * as excluded rather than quietly left out.
 *
 * A review has exactly two outcomes: approve it, or send it back to be counted again. There is
 * no "approve with changes", because editing another person's count destroys the only record
 * of what they actually handed over.
 */
type Result={kind:'export';snapshot:StatementExport}|{kind:'capture';capture:StatementCapture}|{kind:'submission'|'decision';id:string};
function Workspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>agentStatements(api),[api]),agents=useMemo(()=>custody(api),[api]),user=api.scope.authority!.userId;
 const canExport=has(roles,'franchise_admin','accountant'),admin=has(roles,'franchise_admin'),canWrite=has(roles,'franchise_admin','operator','delivery_agent'),selfOnly=has(roles,'delivery_agent')&&!has(roles,'franchise_admin','operator');
 const [selected,setSelected]=useState<string|null>(null),[revision,setRevision]=useState(0),[capture,setCapture]=useState<StatementCapture|null>(null),[previous,setPrevious]=useState<{id:string;version:number}|null>(null),[agent,setAgent]=useState(selfOnly?user:''),[day,setDay]=useState(()=>instantToKolkataInput(new Date().toISOString())!.slice(0,10)),[countTime,setCountTime]=useState(()=>instantToKolkataInput(new Date().toISOString())!),[cash,setCash]=useState(''),[reason,setReason]=useState(''),[reviewReason,setReviewReason]=useState(''),[notice,setNotice]=useState(''),[blocked,setBlocked]=useState(false);
 const [handoverView,setHandoverView]=useState(false);
 const [moneyView,setMoneyView]=useState(false),[moneyBusy,setMoneyBusy]=useState(false);
 const [savedExport,setSavedExport]=useState<StatementExport|null>(null),[downloadBusy,setDownloadBusy]=useState(false);
 const inbox=usePagedResource('statements-'+revision,async(cursor,signal)=>{const r=await source.list(cursor??undefined,signal);return {items:r.items,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const eligible=usePagedResource('agents',async(cursor,signal)=>{if(!canWrite||selfOnly)return {items:[],page:{has_more:false,next_cursor:null}};const r=await agents.agents(cursor??undefined,signal);return {items:r.agents,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const current=useResource((selected??'none')+'-'+revision,signal=>selected?source.detail(selected,signal):Promise.resolve(null));
 const detail=current.value?.id===selected?current.value:null;
 const command=useCommand<Result>(async(intent:CommandIntent)=>intent.operation==='agent-statement.export.capture'?{kind:'export',snapshot:await source.executeExport(intent)}:intent.operation==='agent-statement.capture'?{kind:'capture',capture:await source.executeCapture(intent)}:intent.operation==='agent-statement.submit'?{kind:'submission',id:(await source.executeSubmission(intent)).id}:{kind:'decision',id:(await source.executeDecision(intent)).submission_id});
 const locked=moneyBusy||downloadBusy||command.phase==='pending'||command.phase==='uncertain';
 function confirmed(result:Result){if(!controller.runtime.isCurrent(api.scope))return;if(result.kind==='export'){setSavedExport(result.snapshot);setNotice('Statement CSV captured. The saved revision, status and sources remain fixed for 24 hours.');}else if(result.kind==='capture'){setCapture(result.capture);setNotice('Cash count captured. Review the source evidence before submitting.');}else{setSelected(result.id);setCapture(null);setPrevious(null);setReviewReason('');setRevision(n=>n+1);setNotice(result.kind==='submission'?'Statement submitted for a different administrator to review.':'Statement review recorded. Cash handover and fee payment remain separate.');}}
 async function run(intent:CommandIntent){try{confirmed(await command.run(intent));}catch{/* Same uncertain intent is retained by useCommand. */}}
 async function retry(){try{const result=await command.retry();if(result)confirmed(result);}catch{/* Keep the exact original intent. */}}
 useEffect(()=>{const leave=(event:BeforeUnloadEvent)=>{if(locked){event.preventDefault();event.returnValue='';}},navigate=(event:MouseEvent)=>{if(locked&&event.target instanceof Element&&event.target.closest('a[href]')){event.preventDefault();event.stopPropagation();setBlocked(true);}},change=(event:Event)=>{if(locked&&event.target instanceof Element&&event.target.matches('select[aria-label="Franchise"]')){event.stopPropagation();(event.target as HTMLSelectElement).value=api.franchise;setBlocked(true);}};window.addEventListener('beforeunload',leave);document.addEventListener('click',navigate,true);document.addEventListener('change',change,true);return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true);document.removeEventListener('change',change,true);};},[locked,api.franchise]);
 async function download(){if(!savedExport||!canExport||locked)return;setDownloadBusy(true);setNotice('');try{const r=await source.downloadExport(savedExport.id);if(!controller.runtime.isCurrent(api.scope))return;const url=URL.createObjectURL(new Blob([r.csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='agent-statement-'+r.snapshot.id+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('Captured statement CSV ready. Check your downloads.');}catch{if(controller.runtime.isCurrent(api.scope))setNotice('CSV unavailable. Check current access and the captured expiry before retrying.');}finally{if(controller.runtime.isCurrent(api.scope))setDownloadBusy(false);}}
 const count=kolkataInputToInstant(countTime),paise=rupeesToPaise(cash),valid=count!==null&&paise!==null&&day===countTime.slice(0,10)&&Date.parse(count)<=Date.now()&&reason.trim().length>0&&reason.trim().length<=500&&agent!=='';
 function correction(r:StatementDetail){command.reset();setCapture(null);setPrevious({id:r.id,version:r.revision});setAgent(r.agent_id);setDay(r.day);setCountTime(instantToKolkataInput(r.counted_at)!);setCash('');setReason('');setNotice('Prepare a fresh count linked to revision '+r.revision+'. Earlier evidence remains immutable.');document.getElementById('settlement-count-form')?.scrollIntoView?.({block:'start'});}
 const noEligibleAgents=!selfOnly&&!previous&&eligible.phase!=='loading'&&eligible.items.length===0;
 const options=selfOnly?[{value:user,label:'You (signed-in delivery agent)'}]:[{value:'',label:'Select current agent'},...eligible.items.map(a=>({value:a.id,label:a.id===user?'You (signed-in agent)':'Agent '+a.id.slice(-8)}))];
 if(admin&&previous&&agent&&!options.some(o=>o.value===agent))options.push({value:agent,label:'Historical agent '+agent.slice(-8)});
 const moneyNav=(has(roles,'franchise_admin','org_admin','accountant')&&<section className="finance-section-actions"><button className="btn btn-outlined" disabled={locked} onClick={()=>setMoneyView(value=>!value)}>{moneyView?'Open daily statements':'Open COD and agent fees'}</button></section>);
 const handoverNav=has(roles,'delivery_agent')&&<section className="finance-section-actions"><button className="btn btn-outlined" disabled={locked} onClick={()=>setHandoverView(value=>!value)}>{handoverView?'Open daily statements':'Open cash handovers'}</button></section>;
 if(handoverView)return <>{handoverNav}<AgentCashHandovers controller={controller} onBusy={setMoneyBusy}/></>;
 if(moneyView)return <>{moneyNav}<AgentMoney controller={controller} roles={roles} onBusy={setMoneyBusy}/></>;
 return <><section className="finance-workspace-intro"><PageHeader title="Agent settlements" eyebrow="Money · Agent accounts"/><CommandNotice phase={command.phase} code={command.error?.code}
  money={paise!==null?formatMoneyPaise(paise)+' may or may not be recorded. Count it again before recording it — the agent is still here, so counting again is cheap and recording it twice is not.':undefined}
  retry={command.canRetry?()=>void retry():undefined}/>
 {/* R-19: nothing half-settles. */}
 {command.phase==='error'&&<p role="alert">The day is not approved and nothing was settled. The cash record is unchanged.</p>}
 {command.error?.code==='AGENT_MONEY_DISABLED'&&<Blocked title="Settling agent cash is not switched on for this shop"
   blockers={[{text:'Nothing was recorded. Deliveries and parcel custody are unaffected, and saved statements stay readable.',
     fix:<>Ask whoever administers this installation to switch on agent money.</>}]}/>}{command.error?.code==='VERSION_CONFLICT'&&<p role="alert">Source evidence or the latest revision changed. Refresh current statements and prepare a fresh count with a linked correction when needed.</p>}{blocked&&locked&&<p role="alert">Reconcile this exact request before leaving or changing franchise.</p>}{notice&&<p role="status">{notice}</p>}<DataRefresh disabled={locked} resource={{phase:'ready',reload:()=>{command.reset();setRevision(n=>n+1);}}}/></section><div className="finance-section-actions">{handoverNav}{moneyNav}</div>
 {canWrite&&<section className="card ops-card"><h2 className="t-title-lg">{previous?'Prepare linked correction':'Prepare daily count'}</h2>{!selfOnly&&eligible.phase==='loading'&&<Loading label="Loading eligible agent references…"/>}{!selfOnly&&eligible.phase==='error'&&<Failure retry={eligible.reload} label="Eligible agents unavailable."/>}{noEligibleAgents?<Blocked title="A daily count cannot be captured yet" blockers={[{text:'No delivery agent is currently eligible for a cash count in this branch, so there is nobody to settle with.',fix:admin?<>Invite or activate a delivery agent, then reload this page.</>:<>Ask a franchise administrator to add a delivery agent.</>}]}/>:<form id="settlement-count-form" className="ops-form finance-grouped-form" aria-label="Capture daily agent count" onSubmit={e=>{e.preventDefault();if(valid&&count!==null&&paise!==null)void run(source.capture({agent_id:agent,day,counted_at:count,counted_paise:paise,reason}));}}><SelectField label="Agent reference" aria-label="Agent reference" value={agent} onChange={setAgent} options={options} disabled={locked||capture!==null||previous!==null||selfOnly}/><DateField label="Kolkata statement day" value={day} onChange={setDay} disabled={locked||capture!==null||previous!==null} required/><TextField label="Cash count time in Kolkata" type="datetime-local" step="0.001" value={countTime} onChange={setCountTime} disabled={locked||capture!==null} required/>{/* R-8: the same large control as counting the drawer, because it is the same act. */}
 <TextField className="cash-count-field" label="Cash they handed over (₹)" inputMode="decimal" value={cash} onChange={setCash} disabled={locked||capture!==null} required/>
 {/* R-11: the fee is never taken out of this, and the screen says so before anyone wonders. */}
 <p className="ops-note">Their fee is settled separately. It is not taken out of this count.</p>
 <TextField label="Anything worth noting" value={reason} onChange={setReason} maxLength={500} disabled={locked||capture!==null} required
   helper="Kept with the count, with your name and the time, for whoever reads it next month."/>
 <button className="btn btn-filled" disabled={locked||capture!==null||!valid}>{paise!==null&&agent?'Count '+agentName(agent,user)+'\u2019s cash':'Count the cash'}</button></form>}{eligible.page.has_more&&<button className="btn btn-outlined" disabled={locked} onClick={eligible.loadMore}>Load more agents</button>}{(capture||previous)&&<button className="btn btn-text" disabled={locked} onClick={()=>{command.reset();setCapture(null);setPrevious(null);setAgent(selfOnly?user:'');setNotice('Start a new count. Saved capture history is retained.');}}>Start a new count</button>}{capture&&<><AgentStatementEvidence key={capture.id} evidence={capture.source_snapshot}/><button className="btn btn-filled" disabled={locked} onClick={()=>void run(source.submit({capture_id:capture.id,previous_submission_id:previous?.id??null,expected_version:previous?.version??0,reason:capture.reason}))}>Submit captured statement</button></>}</section>}
 <section className="card ops-card"><h2 className="t-title-lg">Saved statements</h2><p>Agents see their own evidence. Operators see statements they prepared. Each row preserves its recorded revision.</p>{inbox.phase==='loading'&&<Loading label="Loading saved statements…"/>}{inbox.phase==='error'&&<Failure retry={inbox.reload}/>} {inbox.phase==='empty'&&<Empty title="No saved statements" body="Submit a captured count to create a reviewable statement."/>}{inbox.items.length>0&&<RecordTable mobile="stack" label="Saved agent statements" rows={inbox.items} rowKey={r=>r.id} selectedKey={selected} columns={[
 {key:'day',label:'Statement day',cell:r=><button className="btn btn-text" disabled={locked} aria-label={r.day+' · Agent '+r.agent_id.slice(-8)+' · revision '+r.revision+' · '+r.status} onClick={()=>{setSelected(r.id);setReviewReason('');}}>{r.day}</button>},
 {key:'agent',label:'Agent',cell:r=><span className="finance-record-ref">{r.agent_id}</span>},
 {key:'revision',label:'Revision',align:'right',cell:r=>r.revision},{key:'status',label:'Status',cell:r=><StatusBadge tone={r.status==='approved'?'success':r.status==='pending'?'warning':'neutral'}>{r.status}</StatusBadge>},
 ]}/>}{inbox.page.has_more&&<button className="btn btn-outlined" disabled={locked||inbox.phase==='more'} onClick={inbox.loadMore}>Load more statements</button>}</section>
 {selected&&current.phase==='loading'&&<Loading label="Loading immutable statement evidence…"/>}{selected&&current.phase==='error'&&<Failure retry={current.reload} label="Statement unavailable or current access changed."/>}{detail&&<section className="card ops-card"><h2 className="t-title-lg">{detail.day} · revision {detail.revision} · {detail.status}</h2><p>Statement <code>{detail.id}</code> · agent <code>{detail.agent_id}</code> · submitted {formatKolkata(detail.recorded_at)} · {detail.reason}</p>{detail.previous_submission_id&&<button className="btn btn-text" disabled={locked} onClick={()=>setSelected(detail.previous_submission_id)}>Open prior revision</button>}{/* R-15, R-20: the reason is quoted with who wrote it and when, and a day that is already
    decided says so plainly rather than refusing a second press. */}
 {detail.decision&&<p className="agent-decision" role="status">
  {detail.decision.kind==='approve'?'Already approved':'Already sent back'} by {agentName(detail.decision.actor_id,user).replace(/\u2019s$/,'')} at {formatKolkata(detail.decision.recorded_at)}.
  <br/><q>{detail.decision.reason}</q>
  <br/><small>This stays on the record even if a later count replaces it.</small></p>}{canExport&&<button className="btn btn-outlined" disabled={locked} onClick={()=>void run(source.captureExport(detail.id))}>Capture statement CSV</button>}<AgentStatementEvidence key={detail.id} evidence={detail.source_snapshot}/>{admin&&detail.status==='pending'&&(detail.actor_id===user?<p>You submitted this revision. A different current franchise administrator must review it.</p>:<form className="ops-form finance-grouped-form" aria-label="Review agent settlement" onSubmit={e=>{e.preventDefault();if(reviewReason.trim())void run(source.decide(detail.id,{kind:'approve',expected_version:detail.revision,reason:reviewReason}));}}><TextField label="What you checked, or why it goes back" value={reviewReason} onChange={setReviewReason} maxLength={500} required disabled={locked}
   helper="The operator who counted it reads this."/>
 {/* R-17: two outcomes and no third. Editing somebody else's count destroys the record of
     what they actually handed over, so there is deliberately no "approve with changes". */}
 <button className="btn btn-filled" disabled={locked||!reviewReason.trim()}>Approve this day</button>
 <button type="button" className="btn btn-outlined" disabled={locked||!reviewReason.trim()} onClick={()=>void run(source.decide(detail.id,{kind:'reject',expected_version:detail.revision,reason:reviewReason}))}>Send back to be counted again</button>
 {/* R-18: the money does not move when a count goes back. It is still in the drawer. */}
 <p className="ops-note">Sending it back does not move any money. The cash stays recorded where it is; only the count has to be done again.</p>
 </form>)}{canWrite&&detail.status!=='superseded'&&(admin||detail.actor_id===user||has(roles,'delivery_agent')&&detail.agent_id===user)&&<button className="btn btn-outlined" disabled={locked} onClick={()=>correction(detail)}>Prepare linked correction</button>}</section>}
 {canExport&&savedExport&&<section className="card ops-card"><h2 className="t-title-lg">Captured statement CSV</h2><p>Statement <code>{savedExport.statement_id}</code> · revision {savedExport.revision} · {savedExport.status} at export · {savedExport.source_count} source rows plus four summaries. Monetary values are exact paise in INR.</p><p>Original count {formatKolkata(savedExport.counted_at)} · source cutoff {formatKolkata(savedExport.source_as_of)} · export cutoff {formatKolkata(savedExport.as_of)} · expires {formatKolkata(savedExport.expires_at)} (Kolkata).</p><p>Saved reference <code>{savedExport.id}</code></p><button className="btn btn-outlined" disabled={locked} onClick={()=>void download()}>Download captured statement CSV</button></section>}
 </>;
}
