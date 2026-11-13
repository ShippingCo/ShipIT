import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Link,useNavigate} from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {canAdminister,type OperatorRole} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi,type ScopedApi} from '../data-access/scoped-api';
import {messaging,type HistoryRow,type MessagingSource} from '../data-access/messaging';
import {support,type SupportSource} from '../data-access/support';
import {useCommand,usePagedResource,useResource} from './hooks';
import {DataRefresh,Loading,Failure,CommandNotice} from './AsyncState';
import {NotificationDetail} from './Messaging';
import {SupportCaseDetail} from './Support';
import {kindLabel,statusLabel} from './messaging-labels';
import {formatKolkata} from './format';
import {FilterChips} from '../components/m3/Controls';
import {Card,EmptyState} from '../components/m3/Surface';
import {Msym} from '../components/m3/Icon';
import {Button} from '../components/m3/Button';
import {PageHeader} from '../components/workspace/Workspace';
import './automation-workspace.css';
const categories=[{value:'all',label:'All'},{value:'booking',label:'Bookings',icon:'note_add'},{value:'status',label:'Status',icon:'local_shipping'},{value:'delay',label:'Delays',icon:'warning'},{value:'otp',label:'OTP',icon:'lock'}];
export function notificationCategory(kind:string){return kind==='booking_confirmation'?'booking':kind==='delivery_otp'?'otp':['route_delay','route_delayed','route_delay_reminder'].includes(kind)?'delay':'status';}
export function messageTone(state:string){return ['delivered','read'].includes(state)?'st-delivered':['failed','uncertain','blocked'].includes(state)?'pill-err':['queued','retry_wait','dispatching','pending','running'].includes(state)?'pill-warn':'st-booked';}
export function supportReason(reason:string){return ({human_requested:'Asked to speak to a person',unrecognized:'The request needs staff review',unsupported:'The request needs staff review',low_confidence:'The request needs staff review'} as Record<string,string>)[reason]??reason.replaceAll('_',' ');}
type CaseSummary=Awaited<ReturnType<SupportSource['list']>>['items'][number];
type Selection={kind:'message'|'chat'|'handled';id:string};
export default function AutomationWorkspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>messaging(api),[api]),cases=useMemo(()=>support(api),[api]);
 if(!roles.some(r=>['org_admin','franchise_admin','operator','dispatcher'].includes(r)))return <p role="alert">Messaging history is unavailable for this role.</p>;
 return <AutomationFeed api={api} source={source} cases={cases} roles={roles}/>;
}
function AutomationFeed({api,source,cases,roles}:{api:ScopedApi;source:MessagingSource;cases:SupportSource;roles:readonly OperatorRole[]}){
 const nav=useNavigate(),canSupport=roles.some(r=>['org_admin','franchise_admin','operator'].includes(r)),canWrite=canAdminister(roles,'support.write')||roles.some(r=>['franchise_admin','operator'].includes(r));
 const history=usePagedResource(api.franchise+'feed',(cursor,signal)=>source.list('messages',{cursor},signal));
 const queue=usePagedResource(api.franchise+'support',async(cursor,signal)=>canSupport?cases.list(cursor,signal):{items:[],page:{has_more:false,next_cursor:null}});
 const [kind,setKind]=useState('all'),[selection,setSelection]=useState<Selection|null>(null),[locked,setLocked]=useState(false),[notice,setNotice]=useState('');
 const trigger=useRef<HTMLButtonElement|null>(null),refresh=useRef<HTMLButtonElement|null>(null);
 const automated=history.items.filter(r=>r.source_kind!=='support'),items=automated.filter(r=>kind==='all'||notificationCategory(r.notification_kind)===kind),waiting=queue.items.filter(c=>c.state!=='resolved');
 const counts=Object.fromEntries(categories.map(c=>[c.value,c.value==='all'?automated.length:automated.filter(r=>notificationCategory(r.notification_kind)===c.value).length]));
 function open(event:React.MouseEvent<HTMLButtonElement>,next:Selection){trigger.current=event.currentTarget;setSelection(next);setNotice('');}
 function handled(){setSelection(null);queue.reload();setNotice('Marked as handled.');}
 return <div className="page live-automation">
  <PageHeader title="Messages"/>
  <div className="page-actions"><DataRefresh buttonRef={refresh} disabled={locked}
   resource={{phase:history.phase==='loading'||queue.phase==='loading'?'loading':'ready',reload:()=>{queue.reload();history.reload();setNotice('');}}}/></div>{notice&&<p role="status">{notice}</p>}
 {canSupport&&<><h2 className="section-label"><span className="sec-ic"><Msym name="support_agent"/></span>Needs a person<span className="count-note">{queue.phase==='loading'?'Loading…':queue.phase==='error'?'Unavailable':`${waiting.length} waiting${queue.page.has_more?' in loaded cases':''}`}</span></h2>
 {queue.phase==='loading'&&!queue.items.length?<Loading label="Loading support cases…"/>:queue.phase==='error'?<Failure label="Support cases could not be loaded." retry={queue.reload}/>:<Card>{waiting.length?waiting.map(c=><CaseRow key={c.id} value={c} canWrite={canWrite} open={(event,kind)=>open(event,{kind,id:c.id})}/>):<EmptyState icon="support_agent" title="No cases waiting" sub={queue.page.has_more?'No waiting cases in the records loaded so far. Load more cases to check earlier records.':'Customer requests that need a person appear here.'}/>}</Card>}
 {queue.page.has_more&&queue.phase!=='error'&&<Button variant="text" disabled={queue.phase==='more'} onClick={queue.loadMore}>{queue.phase==='more'?'Loading…':'Load more cases'}</Button>}</>}
 <h2 className="section-label"><span className="sec-ic"><Msym name="forward_to_inbox"/></span>Sent automatically</h2>
 <FilterChips options={categories} value={kind} onChange={setKind} counts={counts}/>
 {history.phase==='loading'&&!history.items.length?<Loading label="Loading messaging history…"/>:history.phase==='error'?<Failure label="Messaging history could not be loaded." retry={history.reload}/>:<>
 {history.page.has_more&&<p className="ops-note feed-page-note">Category counts cover the {automated.length} loaded automated messages. Load older history to see more.</p>}
 <Card className="automation-messages">{items.length?items.map(row=><MessageRow key={row.id} row={row} open={event=>open(event,{kind:'message',id:row.id})}/>):<EmptyState icon="forward_to_inbox" title={kind==='all'?'Nothing sent yet':'No messages in this category'} sub={kind==='all'?'Automated updates appear here when a booking, dispatch or delivery creates a message.':'Choose another category or load older history to find more messages.'} action={kind==='all'?<Button icon="bolt" onClick={()=>nav('/business/routes')}>Trigger your first alert</Button>:<Button variant="text" onClick={()=>setKind('all')}>Show all messages</Button>}/>}</Card>
 {history.page.has_more&&<Button variant="text" disabled={history.phase==='more'} onClick={history.loadMore}>{history.phase==='more'?'Loading…':'Load older history'}</Button>}</>}
 <p className="feed-private-note">Message bodies and verification codes stay private. “Accepted by provider” does not confirm delivery.</p>
 <Link className="feed-advanced" to="/business/automation?view=advanced">Message evidence and advanced history</Link>
 <Dialog.Root open={selection!==null} onOpenChange={value=>{if(!value&&!locked)setSelection(null);}}><Dialog.Portal><Dialog.Overlay className="scrim"/><Dialog.Content className="dialog history-dialog service-detail-dialog" onCloseAutoFocus={event=>{event.preventDefault();(trigger.current?.isConnected?trigger.current:refresh.current)?.focus();}}>
 <Dialog.Close className="btn btn-outlined service-detail-close" disabled={locked}>Close</Dialog.Close><Dialog.Title>{selection?.kind==='message'?'Notification evidence':selection?.kind==='handled'?'Mark as handled':'Customer support'}</Dialog.Title><Dialog.Description>{selection?.kind==='message'?'Current server status and safe references. Message bodies and verification codes are never shown.':'Review this case in the private staff workspace. Internal notes are never sent to the customer.'}</Dialog.Description>
 {selection?.kind==='message'?<NotificationDetail key={selection.id} source={source} view="messages" id={selection.id} roles={roles} changed={history.reload} setLocked={setLocked}/>:selection?.kind==='handled'?<HandleCase key={selection.id} id={selection.id} source={cases} done={handled} setLocked={setLocked}/>:selection&&<SupportCaseDetail key={selection.id} id={selection.id} source={cases} canWrite={canWrite} changed={queue.reload} setLocked={setLocked}/>}
 </Dialog.Content></Dialog.Portal></Dialog.Root></div>;
}
function CaseRow({value:c,canWrite,open}:{value:CaseSummary;canWrite:boolean;open:(event:React.MouseEvent<HTMLButtonElement>,kind:'chat'|'handled')=>void}){
 return <div className="esc-row"><Msym name="support_agent" className="row-ic"/><div className="u-grow"><div className="li-head">Customer support <span className="muted">· Case {c.id.slice(0,8)}</span></div><p className="feed-case-reason">{supportReason(c.reason)}</p><div className="li-sub"><time dateTime={c.created_at}>{formatKolkata(c.created_at)}</time><span className="win-badge">{c.state==='claimed'?'Claimed':'Awaiting staff'}</span></div></div><div className="feed-case-actions"><Button variant="outlined" size="sm" onClick={event=>open(event,'chat')}>Open chat</Button>{canWrite&&<Button size="sm" icon="check" onClick={event=>open(event,'handled')}>Handled</Button>}</div></div>;
}
function MessageRow({row,open}:{row:HistoryRow;open:(event:React.MouseEvent<HTMLButtonElement>)=>void}){
 const state=row.message?.state??row.decision?.outcome??row.fanout?.state??'uncertain';
 return <div className="automation-message-row"><Msym name="smart_toy" size={20} className="row-ic"/><div className="u-grow"><div className="feed-message-head"><strong>{kindLabel[row.notification_kind]}</strong><time className="muted" dateTime={row.effective_time}>{formatKolkata(row.effective_time)}</time><span className={`pill ${messageTone(state)}`}>{statusLabel[state]}</span></div><div className="wa-preview feed-safe-preview"><p>{row.message?`${row.message.attempt_count} recorded attempt${row.message.attempt_count===1?'':'s'}.`:'Automation decision recorded.'} {row.recovery.kind!=='none'?'Recovery review available.':''}</p></div></div><Button size="sm" variant="text" onClick={open} aria-label={`Inspect ${kindLabel[row.notification_kind]} ${row.id}`}>Inspect</Button></div>;
}
function HandleCase({id,source,done,setLocked}:{id:string;source:SupportSource;done:()=>void;setLocked:(value:boolean)=>void}){
 const detail=useResource(id,signal=>source.detail(id,signal)),command=useCommand(source.execute),[starting,setStarting]=useState(false),[error,setError]=useState('');
 const busy=starting||command.phase==='pending'||command.phase==='uncertain';
 useEffect(()=>{setLocked(busy);return()=>setLocked(false);},[busy,setLocked]);
 async function finish(value:Awaited<ReturnType<SupportSource['execute']>>|null){if(!value)return;if(value.state==='resolved'){done();return;}if(value.state==='claimed'){const result=await command.run(source.command(id,{action:'resolve',expected_version:value.version,reason:'answered'}));if(result.state==='resolved')done();}}
 async function submit(){if(busy)return;setStarting(true);setError('');try{const current=await source.detail(id);if(current.state==='resolved'){done();return;}if(current.state==='claimed'&&current.assigned_staff_id!==current.current_actor_id){setError('This case is assigned to another staff member. Open chat to review its ownership.');return;}const result=await command.run(source.command(id,current.state==='open'?{action:'claim',expected_version:current.version}:{action:'resolve',expected_version:current.version,reason:'answered'}));await finish(result);}catch{setError('Handling could not be confirmed. Keep this case open and use the recovery action below.');}finally{setStarting(false);}}
 return <>{detail.phase==='loading'?<Loading/>:detail.phase==='error'?<Failure label="The case could not be loaded." retry={detail.reload}/>:detail.value&&<><p>{supportReason(detail.value.reason)}</p><p>Confirm that the request has been answered. An unassigned case will be claimed by you, then resolved. A pending or uncertain customer reply must be settled first.</p><Button icon="check" onClick={()=>{void submit();}} disabled={busy}>Confirm handled</Button></>}{error&&<p role="alert">{error}</p>}<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(finish).catch(()=>{});}:undefined}/></>;
}
