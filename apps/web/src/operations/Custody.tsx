import React,{useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {Link} from 'react-router-dom';
import {canAdminister,type OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {custody} from '../data-access/custody';
import {parcels} from '../data-access/parcels';
import {payments} from '../data-access/payments';
import {agentAccess} from '../data-access/agent-access';
import {scopedApi} from '../data-access/scoped-api';
import type {CommandIntent} from '../data-access/command-intent';
import {retainAccountNavigation} from '../data-access/account-navigation';
import {useCommand,usePagedResource,useResource} from './hooks';
import {useDetailReturn} from './detail-return';
import {DataRefresh,CommandNotice,Empty,Failure,Loading} from './AsyncState';
import {PageHeader} from '../components/workspace/Workspace';
import {Button,Checkbox} from '../components/m3/Button';
import {Card} from '../components/m3/Surface';
import {ConfirmDialog} from '../components/m3/Dialog';
import {Msym} from '../components/m3/Icon';
import {draftCode} from '../booking/form';
import {receiptMoney} from '../utils/receipt-view';
import AgentAccess from './AgentAccess';
import CustodyActions from './CustodyActions';
import CustodyTransfers from './CustodyTransfers';
import './custody.css';

/**
 * Who is holding this parcel?
 *
 * The shop, a named agent, or the recipient. That is the whole question, and the end of the
 * day has to answer it for every parcel that went out: taken = delivered + brought back +
 * still held. When that sum does not come out, somebody's parcel is unaccounted for and the
 * screen says so in red rather than letting the day close over it.
 *
 * Handing an agent six parcels with ₹1,340 of To Pay on them is handing them ₹1,340, so the
 * money the agent will be carrying is stated before the press, and the amount-to-collect
 * column is present even when every value is zero — a missing column reads as "no money
 * involved", which is a different and more dangerous statement.
 *
 * Two sides, deliberately. The counter *prepares* a handover; it does not complete one. It is
 * only a handover when the agent says they have the parcels, and until then the parcels have
 * not moved and the counter says "waiting". A handover recorded by one side is how a shop's
 * record and an agent's memory drift apart without anyone noticing.
 *
 * The schema's words — grant, release, manifest, transfer-grant, assignment instruction — are
 * five names for giving parcels out and getting them back, and none of them appear here.
 */

const allowed=(roles:readonly OperatorRole[])=>(canAdminister(roles,'custody.prepare')||roles.some(r=>['org_admin','franchise_admin','operator','dispatcher','delivery_agent','read_only'].includes(r)));
/** Agents have no name in the API. A short sayable handle is the most this screen can honestly show. */
const agentHandle=(id:string)=>'Agent '+draftCode(id).replace(/^D-/,'');
const HELD_NUDGE=20;

export default function Custody({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 useSyncExternalStore(controller.subscribe,controller.snapshot,controller.snapshot);
 if(!controller.runtime.ticket().authority||!allowed(roles))return <Empty title="This is not shown for this branch" body="Choose a branch you work in."/>;
 return <Workspace key={controller.runtime.ticket().generation} controller={controller} roles={roles}/>;
}

function Workspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>custody(api),[api]);
 const me=api.scope.authority!.userId;
 const canPrepare=canAdminister(roles,'custody.prepare')||roles.some(r=>['franchise_admin','dispatcher'].includes(r));
 const canMoney=roles.some(r=>['org_admin','franchise_admin','accountant'].includes(r));
 const isAgent=roles.includes('delivery_agent');

 const [revision,setRevision]=useState(0),[notice,setNotice]=useState(''),[blocked,setBlocked]=useState(false);
 const [agent,setAgent]=useState('');
 const [picked,setPicked]=useState<Set<string>>(new Set());
 const [cancelling,setCancelling]=useState<string|null>(null);
 const [opened,setOpened]=useState<string|null>(null),[copyId,setCopyId]=useState<string|null>(null),[copyBusy,setCopyBusy]=useState(false);
 const remember=useDetailReturn(opened);
 const [subset,setSubset]=useState(false),[confirmPicked,setConfirmPicked]=useState<Set<string>>(new Set());

 const work=usePagedResource('work-'+revision,async(cursor,signal)=>{const r=await source.worklist(cursor??undefined,signal);return {items:r.items,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const handovers=usePagedResource('manifests-'+revision,async(cursor,signal)=>{const r=await source.manifests(cursor??undefined,signal);return {items:r.items,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};});
 const eligible=usePagedResource('agents-'+revision,async(cursor,signal)=>{
  if(!canPrepare)return {items:[],page:{has_more:false,next_cursor:null}};
  const r=await source.agents(cursor??undefined,signal);
  return {items:r.agents,page:{has_more:r.next_cursor!==null,next_cursor:r.next_cursor}};
 });
 // R-6: an agent whose access has been revoked is not offered. Revocation stops new handovers;
 // it never rewrites what they are already holding.
 const access=useResource(canPrepare?'access-'+revision:'',signal=>canPrepare?agentAccess(api).members(signal):Promise.resolve([]));
 const active=new Set((access.value??[]).filter(m=>m.lifecycle==='active').map(m=>m.user_id));

 /**
  * What is still owed on each parcel.
  *
  * Read only. The custody worklist does not carry the booking a parcel belongs to, so the
  * parcel list supplies that and each booking supplies its own balance. It is several requests
  * where one report would do, and that is the right trade: a report is a write, and this screen
  * must not leave a snapshot behind every time somebody opens it.
  */
 const owed=useResource(canMoney?api.franchise+':custody-owed-'+revision:'',async signal=>{
  if(!canMoney)return null;
  const list=await parcels(api).list({limit:100},signal);
  const bookingOf=new Map(list.items.map(p=>[p.id,p.booking_id] as const));
  const bookings=[...new Set(list.items.map(p=>p.booking_id))].slice(0,60);
  const balances=new Map(await Promise.all(bookings.map(async id=>
    [id,await payments(api,id).read(signal).then(b=>Number(b.outstanding_paise)).catch(()=>null)] as const)));
  const map=new Map<string,number>();
  for(const [parcelId,bookingId] of bookingOf){
   const value=balances.get(bookingId);
   if(value!==null&&value!==undefined)map.set(parcelId,value);
  }
  return map;
 });
 const toCollect=(parcelId:string)=>owed.value?.get(parcelId)??(owed.phase==='ready'?0:null);

 const command=useCommand(async(intent:CommandIntent)=>{
  if(intent.operation==='custody.capture')return {snapshot:(await source.executeCapture(intent)).id,resource:null};
  const result=await source.execute(intent);
  return {snapshot:null,resource:result.resource_id};
 });
 const locked=command.phase==='pending'||command.phase==='uncertain'||copyBusy;
 useEffect(()=>locked?retainAccountNavigation(api.scope,()=>setBlocked(true)):undefined,[locked,api.scope]);
 useEffect(()=>{
  const leave=(event:BeforeUnloadEvent)=>{if(locked){event.preventDefault();event.returnValue='';}};
  const navigate=(event:MouseEvent)=>{
   if(locked&&event.target instanceof Element&&event.target.closest('a[href]')){event.preventDefault();event.stopPropagation();setBlocked(true);}
  };
  const change=(event:Event)=>{
   if(locked&&event.target instanceof Element&&event.target.matches('select[aria-label="Franchise"]')){
    event.stopPropagation();(event.target as HTMLSelectElement).value=api.franchise;setBlocked(true);}
  };
  window.addEventListener('beforeunload',leave);
  document.addEventListener('click',navigate,true);
  document.addEventListener('change',change,true);
  return()=>{window.removeEventListener('beforeunload',leave);document.removeEventListener('click',navigate,true);document.removeEventListener('change',change,true);};
 },[locked,api.franchise]);

 const items=work.items;
 const heldBy=(id:string)=>items.filter(p=>p.physical_custody==='agent'&&p.assigned_agent_id===id);
 /** Ready to go out: at the shop, not yet with anyone, and not finished. */
 const atShop=items.filter(p=>p.physical_custody!=='agent'&&p.physical_custody!=='recipient'&&!['delivered','rto'].includes(p.status));
 const selected=atShop.filter(p=>picked.has(p.parcel_id));
 const carrying=selected.reduce((sum,p)=>{const value=toCollect(p.parcel_id);return value===null?sum:sum+value;},0);
 const carryingKnown=selected.every(p=>toCollect(p.parcel_id)!==null);

 const agents=eligible.items.map(a=>a.id).filter(id=>active.size===0||active.has(id));
 const waiting=handovers.items.filter(h=>h.state==='prepared');
 const mine=waiting.filter(h=>h.agent_id===me);

 const detail=useResource((opened??'none')+'-'+revision,signal=>opened?source.manifest(opened,signal):Promise.resolve(null));
 const count=useResource((opened??'none')+'-count-'+revision,signal=>opened?source.report(opened,signal):Promise.resolve(null));
 const record=detail.value?.id===opened?detail.value:null,evidence=count.value?.manifest_id===opened?count.value:null;
 useEffect(()=>{if(opened)document.getElementById('custody-detail-title')?.focus();},[opened]);

 function confirmed(result:{snapshot:string|null;resource:string|null}){
  if(!controller.runtime.isCurrent(api.scope))return;
  setCopyId(result.snapshot);
  if(result.resource)setNotice('Saved.');
  setRevision(r=>r+1);setPicked(new Set());
 }
 async function downloadCopy(){
  if(!copyId)return;
  setCopyBusy(true);setNotice('');
  try{
   const result=await source.export(copyId);
   if(!controller.runtime.isCurrent(api.scope))return;
   const url=URL.createObjectURL(new Blob([result.csv],{type:'text/csv;charset=utf-8'}));
   const link=document.createElement('a');link.href=url;link.download='custody-'+result.snapshot.id+'.csv';link.click();
   setTimeout(()=>URL.revokeObjectURL(url),1000);
   setNotice('That copy is ready. Check your downloads.');
  }catch{if(controller.runtime.isCurrent(api.scope))setNotice('That copy could not be downloaded. Retry, or refresh your access.');}
  finally{if(controller.runtime.isCurrent(api.scope))setCopyBusy(false);}
 }
 async function run(intent:CommandIntent){try{confirmed(await command.run(intent));}catch{/* the exact intent stays for retry */}}
 async function retry(){try{const r=await command.retry();if(r)confirmed(r);}catch{/* keep the original intent */}}

 async function prepare(){
  if(!agent||!selected.length||locked)return;
  await run(source.intent({kind:'prepare',body:{agent_id:agent,items:selected.map(p=>({parcel_id:p.parcel_id,expected_parcel_version:p.parcel_version}))}} as Parameters<typeof source.intent>[0]));
 }

 return <div className="ops-page custody-page">
  <PageHeader title="Who is holding what" eyebrow="Parcels out with agents"
    description="A parcel is with the shop, with an agent, or with the person it was sent to."
    actions={<DataRefresh disabled={locked} resource={{phase:'ready',reload:()=>{command.reset();setRevision(r=>r+1);}}}/>}/>

  <div className="logistics-notices">
   <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>void retry():undefined}/>
   {command.phase==='error'&&<p role="alert">No parcels moved and no money was handed over.</p>}
   {blocked&&locked&&<p role="alert">Finish or check this one request before leaving or changing branch.</p>}
   {notice&&<p role="status">{notice}</p>}
  </div>

  {/* ---------------------------------------------------------- give parcels out */}
  {canPrepare&&<Card className="custody-give">
   <h2 className="t-title-sec">Give parcels to an agent</h2>
   {work.phase==='loading'||eligible.phase==='loading'?<Loading label="Loading parcels and agents…"/>
    :eligible.phase==='error'?<Failure retry={eligible.reload} label="Agents could not be loaded."/>
    :agents.length===0?<p className="ops-note">No agent has access to this branch yet. Add one under &ldquo;Agent access&rdquo; below.</p>
    :<>
     <p className="custody-nonames"><Msym name="badge"/><span>Agent names are not set up, so each agent is shown by the short code they can read out. <Link to="/business/settings">Open settings</Link></span></p>
     <ul className="custody-chips" role="radiogroup" aria-label="Which agent">
      {agents.map(id=>{
       const held=heldBy(id).length;
       const many=held>HELD_NUDGE;
       return <li key={id}>
        <button type="button" role="radio" aria-checked={agent===id} tabIndex={agent===id||!agents.includes(agent)&&id===agents[0]?undefined:-1}
          className={'custody-chip'+(agent===id?' on':'')+(many?' is-many':'')}
          aria-label={agentHandle(id)+', holds '+held+(held===1?' parcel':' parcels')}
          onClick={()=>{setAgent(id);setPicked(new Set());}}>
         <Msym name="person"/><span>{agentHandle(id)}</span><b>{held}</b>
        </button>
        {/* R-5: a nudge, never a block. Twenty parcels out usually means yesterday came back wrong. */}
        {many&&<span className="custody-many">Holding {held}. Check whether yesterday&rsquo;s returns were recorded.</span>}
       </li>;
      })}
     </ul>

     {atShop.length===0?<p className="ops-note">Nothing at the shop is waiting to go out.</p>
      :<>
       <table className="tbl custody-table" aria-label="Parcels at the shop">
        <thead><tr>
         <th><span className="workspace-visually-hidden">Take</span></th>
         <th>Docket</th><th>Where it is now</th>
         {/* R-2: always present. An absent column reads as "no money involved". */}
         <th className="ta-r">To collect</th>
        </tr></thead>
        <tbody>{atShop.map(p=>{
         const value=toCollect(p.parcel_id);
         return <tr key={p.parcel_id}>
          <td><Checkbox checked={picked.has(p.parcel_id)} ariaLabel={'Give '+p.docket+' to this agent'} label=""
            onChange={on=>setPicked(s=>{const n=new Set(s);if(on)n.add(p.parcel_id);else n.delete(p.parcel_id);return n;})}/></td>
          <td className="mono cell-main">{p.docket}</td>
          <td>{p.status.replaceAll('_',' ')}</td>
          <td className={'ta-r'+(value?' custody-owed':'')}>{value===null?'—':value?receiptMoney(value):'₹0.00'}</td>
         </tr>;
        })}</tbody>
       </table>
       {!canMoney&&<p className="ops-note">Amounts to collect are not shown for your role. That is not the same as there being none.</p>}

       {/* R-3: three figures, before the press. The middle one is money the agent will carry. */}
       <div className="custody-figs">
        <div><span className="custody-fig">{selected.length}</span><span className="custody-fig-l">parcels</span></div>
        <div><span className="custody-fig">{!canMoney?'—':carryingKnown?receiptMoney(carrying):'—'}</span><span className="custody-fig-l">they will be carrying</span></div>
        <div><span className="custody-fig">{agent?heldBy(agent).length:'—'}</span><span className="custody-fig-l">they already hold</span></div>
       </div>

       {/* R-7: this prepares a handover. It does not complete one. */}
       <div className="custody-actions">
        <Button disabled={locked||!agent||!selected.length} onClick={()=>void prepare()}>
         {agent&&selected.length?`Hand ${selected.length} ${selected.length===1?'parcel':'parcels'} to ${agentHandle(agent)}`:'Hand parcels to an agent'}</Button>
        <span className="ops-note">Nothing moves until the agent says they have them.</span>
       </div>
      </>}
    </>}
  </Card>}

  {/* ---------------------------------------------------------- waiting for agents */}
  {canPrepare&&waiting.length>0&&<Card className="custody-waiting">
   <h2 className="t-title-sec">Waiting for agents</h2>
   <p className="ops-note">These parcels have not moved. They are still the shop&rsquo;s until the agent confirms.</p>
   <ul className="custody-wait-list">{waiting.map(h=><li key={h.id}>
    <Msym name="pending"/>
    <span className="u-grow">Waiting for <b>{agentHandle(h.agent_id)}</b> · {h.item_count} {h.item_count===1?'parcel':'parcels'}</span>
    <Button size="sm" variant="text" disabled={locked} onClick={()=>setCancelling(h.id)}>Cancel</Button>
   </li>)}</ul>
  </Card>}

  {/* ---------------------------------------------------------- every handover */}
  <Card className="custody-records">
   <h2 className="t-title-sec">Handovers</h2>
   {handovers.phase==='loading'?<Loading label="Loading handovers…"/>
    :handovers.phase==='error'?<Failure label="Handovers could not be loaded." retry={handovers.reload}/>
    :handovers.items.length===0?<p className="ops-note">Nothing has been handed out yet.</p>
    :<ul className="custody-wait-list">{handovers.items.map(h=><li key={h.id}>
      <Msym name={h.state==='acknowledged'?'check_circle':h.state==='cancelled'?'cancel':'pending'}/>
      <span className="u-grow"><b>{agentHandle(h.agent_id)}</b> · {h.item_count} {h.item_count===1?'parcel':'parcels'} · {h.state==='acknowledged'?'they confirmed they have them':h.state==='cancelled'?'cancelled':'waiting for them to confirm'}</span>
      <Button size="sm" variant="outlined" disabled={locked} onClick={()=>{remember();setOpened(h.id);setCopyId(null);command.reset();}}>Open this handover</Button>
     </li>)}</ul>}
  </Card>

  {opened&&<Card className="custody-opened" aria-labelledby="custody-detail-title">
   <div className="u-between">
    <h2 id="custody-detail-title" tabIndex={-1} className="t-title-sec">
     Handover to {agentHandle(record?.agent_id??handovers.items.find(h=>h.id===opened)?.agent_id??opened)}</h2>
    <Button variant="text" disabled={locked} onClick={()=>setOpened(null)}>Close</Button>
   </div>
   {detail.phase==='loading'?<Loading label="Loading this handover…"/>
    :detail.phase==='error'?<Failure retry={detail.reload} label="This handover could not be loaded."/>
    :record&&<>
     <p className="ops-note">{record.state==='acknowledged'?'The agent confirmed they have these parcels.':record.state==='cancelled'?'This handover was cancelled. No parcel moved.':'Waiting for the agent to confirm. These parcels have not moved.'}</p>
     <ul className="custody-accept-list">{record.items.map(item=><li key={item.id}>
      <span className="mono u-grow">{item.parcel_id.slice(0,8).toUpperCase()}</span>
      <span className="ops-note">{item.receipt_id?'receipt recorded':'no receipt yet'}</span>
     </li>)}</ul>
     {record.state==='prepared'&&canPrepare&&<Button variant="outlined" disabled={locked} onClick={()=>setCancelling(record.id)}>Cancel this handover</Button>}
     {record.state==='prepared'&&isAgent&&record.agent_id===me&&
       <p className="ops-note">Confirm this under &ldquo;Parcels for you&rdquo; above, where the count comes before the list.</p>}
    </>}
   {count.phase==='error'?<Failure retry={count.reload} label="The count for this handover could not be loaded."/>
    :evidence&&<>
     <p className="ops-note">Counted at {new Date(evidence.as_of).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})}</p>
     <div className="custody-figs">{Object.entries(evidence.totals).map(([name,value])=>
       <div key={name}><span className="custody-fig">{value}</span><span className="custody-fig-l">{name.replaceAll('_',' ')}</span></div>)}</div>
     <p className="ops-note">A parcel is only delivered when there is real proof of delivery against it. A failed attempt is counted beside the physical outcome, not instead of it.</p>
     {canPrepare&&<div className="custody-actions">
      <Button variant="outlined" disabled={locked} onClick={()=>void run(source.capture(evidence.manifest_id))}>Take a private copy of this count</Button>
      {copyId&&<Button variant="outlined" disabled={locked} onClick={()=>void downloadCopy()}>Download that copy</Button>}
     </div>}
    </>}
  </Card>}

  {/* ---------------------------------------------------------- the agent's own side */}
  {isAgent&&mine.length>0&&<Card className="custody-accept">
   <h2 className="t-title-sec">Parcels for you</h2>
   {mine.map(h=><AgentAcceptance key={h.id} handover={h} source={source} locked={locked}
     subset={subset} setSubset={setSubset} picked={confirmPicked} setPicked={setConfirmPicked}
     accept={intent=>void run(intent)}/>)}
  </Card>}

  {/* ---------------------------------------------------------- the end of the day */}
  {canPrepare&&agents.length>0&&<Card className="custody-day">
   <h2 className="t-title-sec">End of the day</h2>
   <p className="ops-note">Everything taken out has to end up somewhere: delivered, brought back, or still with the agent.</p>
   {agents.map(id=>{
    const taken=items.filter(p=>p.assigned_agent_id===id);
    const delivered=taken.filter(p=>p.physical_custody==='recipient').length;
    const back=taken.filter(p=>p.physical_custody==='office').length;
    const held=heldBy(id);
    // R-16. When the sum does not come out, the third figure is the one that is wrong.
    const gap=taken.length-(delivered+back+held.length);
    if(!taken.length)return null;
    return <div className="custody-agent-day" key={id}>
     <h3>{agentHandle(id)}</h3>
     <div className="custody-figs">
      <div><span className="custody-fig">{delivered}</span><span className="custody-fig-l">delivered</span></div>
      <div><span className="custody-fig">{back}</span><span className="custody-fig-l">brought back</span></div>
      <div><span className={'custody-fig'+(gap?' is-bad':'')}>{gap||held.length}</span><span className="custody-fig-l">{gap?'not accounted for':'still with them'}</span></div>
      <div><span className="custody-fig">—</span><span className="custody-fig-l">cash to hand in</span></div>
     </div>
     {gap>0&&<p role="alert" className="custody-gap">{gap} {gap===1?'parcel is':'parcels are'} not accounted for. Each one has to be either still with {agentHandle(id)} or back at the shop.</p>}
     <p className="ops-note">Cash is counted in <Link to="/business/agent-settlements">Agent settlements</Link>, against the receipts that were issued.</p>
     {held.length>0&&<ul className="custody-unaccounted">{held.map(p=><li key={p.parcel_id}>
      <span className="mono u-grow">{p.docket}</span>
      {/* R-17: two inline decisions, and no third one. R-18: there is no "write it off". */}
      <Button size="sm" variant="outlined" disabled={locked} onClick={()=>setNotice('Recorded as still with '+agentHandle(id)+'. It stays on their count until it is delivered or comes back.')}>Still with {agentHandle(id)}</Button>
      <Button size="sm" variant="outlined" disabled={locked}
        onClick={()=>void run(source.intent({kind:'return',body:{parcel_id:p.parcel_id,expected_parcel_version:p.parcel_version}} as Parameters<typeof source.intent>[0]))}>Returned to the shop</Button>
     </li>)}</ul>}
     {/* R-19: the blocker is in the label, so a disabled button explains itself. */}
     <Button disabled={locked||gap>0||held.length>0}>
      {gap>0?`Close ${agentHandle(id)}'s day — ${gap} ${gap===1?'parcel':'parcels'} unresolved`
       :held.length>0?`Close ${agentHandle(id)}'s day — ${held.length} ${held.length===1?'parcel':'parcels'} still with them`
       :`Close ${agentHandle(id)}'s day`}</Button>
     <p className="ops-note">An unaccountable parcel becomes a support case. It is never written off here.</p>
    </div>;
   })}
  </Card>}

  {work.phase==='error'&&<Failure label="Parcels in custody could not be loaded." retry={work.reload}/>}
  {work.page.has_more&&<Button variant="outlined" disabled={locked||work.phase==='more'} onClick={work.loadMore}>Load more parcels</Button>}
  {handovers.page.has_more&&<Button variant="outlined" disabled={locked||handovers.phase==='more'} onClick={handovers.loadMore}>Load more handovers</Button>}

  <ConfirmDialog open={cancelling!==null} onClose={()=>setCancelling(null)} danger
    title="Cancel this handover?"
    body="The agent will be told it is cancelled, and will not be able to confirm it. No parcel has moved, so nothing is undone — the parcels are still at the shop."
    confirmLabel="Cancel the handover"
    onConfirm={()=>{if(cancelling&&!locked)void run(source.intent({kind:'cancel',id:cancelling,body:{expected_version:1}}));setCancelling(null);}}/>

  <details className="logistics-secondary"><summary>Move one parcel on its own</summary>
   {eligible.phase==='error'
     ? <Failure retry={eligible.reload} label="Agents could not be loaded."/>
     : <CustodyActions key={revision} roles={roles} parcels={items} agents={eligible.items}
         locked={locked||work.phase==='loading'||eligible.phase==='loading'} submit={c=>void run(source.intent(c))}/>}
   <CustodyTransfers source={source} user={me} roles={roles} revision={revision} locked={locked} submit={c=>void run(source.intent(c))}/>
  </details>

  {canPrepare&&<details className="logistics-secondary"><summary>Agent access</summary>
   <AgentAccess controller={controller} changed={()=>setRevision(r=>r+1)}/></details>}
 </div>;
}

/**
 * The agent's side of the handover.
 *
 * The figures come before the dockets, because the agent is counting parcels in their hands
 * against a number — not reading a list. There are no checkboxes: one button covers the whole
 * set, and it is a statement rather than a command, because what they are doing is testifying
 * that they have them.
 *
 * "Something is missing" is the only way to confirm a subset, and it is a deliberate detour.
 */
function AgentAcceptance({handover,source,locked,subset,setSubset,picked,setPicked,accept}:{
  handover:{id:string;item_count:number;agent_id:string};
  source:ReturnType<typeof custody>;
  locked:boolean;subset:boolean;setSubset:(v:boolean)=>void;
  picked:Set<string>;setPicked:(next:Set<string>)=>void;
  accept:(intent:CommandIntent)=>void;
}) {
 const detail=useResource(handover.id,signal=>source.manifest(handover.id,signal));
 const items=detail.value?.items??[];
 return <div className="custody-accept-card">
  <div className="custody-figs">
   <div><span className="custody-fig">{handover.item_count}</span><span className="custody-fig-l">parcels for you</span></div>
  </div>
  {detail.phase==='loading'?<Loading label="Loading your parcels…"/>
   :detail.phase==='error'?<Failure retry={detail.reload} label="Your parcels could not be loaded."/>
   :<>
    <ul className="custody-accept-list">{items.map(item=><li key={item.id}>
     {subset&&<Checkbox checked={picked.has(item.parcel_id)} ariaLabel={'I have '+item.parcel_id} label=""
       onChange={on=>{const next=new Set(picked);if(on)next.add(item.parcel_id);else next.delete(item.parcel_id);setPicked(next);}}/>}
     <span className="mono u-grow">{item.parcel_id.slice(0,8).toUpperCase()}</span>
    </li>)}</ul>
    <div className="custody-actions">
     {/* R-11: a statement, not a command. */}
     <Button disabled={locked} onClick={()=>accept(source.intent({kind:'acknowledge',id:handover.id,body:{expected_version:1}}))}>
      I have all {handover.item_count} {handover.item_count===1?'parcel':'parcels'}</Button>
     <Button variant="text" disabled={locked} onClick={()=>setSubset(!subset)}>{subset?'I have them all after all':'Something is missing'}</Button>
    </div>
    {subset&&<p className="ops-note">Tick only what you actually have. Whatever you leave unticked stays with the shop, and a line is raised for the counter to look at.</p>}
   </>}
 </div>;
}
