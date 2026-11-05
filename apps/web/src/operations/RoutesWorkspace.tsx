import React,{useId,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {canAdminister,type LotDto,type OperatorRole,type RouteDto,type RouteManifestDto,type RouteEventResult} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {routes,type RouteSource,type RouteHistoryItem} from '../data-access/routes';
import {lots,type LotSource} from '../data-access/lots';
import {parcels,type ParcelRead,type ParcelSource} from '../data-access/parcels';
import {bookingEntries,type CounterEntry} from '../data-access/booking-entries';
import {useCommand,useResource} from './hooks';
import {allLotPages} from './LotsWorkspace';
import {routeAttachmentPlan,routeJourneyPlan,routeMetadata} from './route-workflow';
import {businessDay,dayStart,shiftDay} from './business-dates';
import {formatKolkata,instantToKolkataInput,kolkataInputToInstant} from './format';
import {Loading,Failure,CommandNotice} from './AsyncState';
import {RouteCardView} from '../components/workspace/DispatchCards';
import {DispatchSelection} from '../components/workspace/DispatchSelection';
import {Button} from '../components/m3/Button';
import {Card,EmptyState} from '../components/m3/Surface';
import {Dialog} from '../components/m3/Dialog';
import {TextField,SelectField} from '../components/m3/Input';
import {Msym} from '../components/m3/Icon';
const modeIcons={air:'flight',rail:'train',road:'local_shipping',sea:'directions_boat'};
const modeOptions=[{value:'air',label:'Flight'},{value:'rail',label:'Train'},{value:'road',label:'Road'},{value:'sea',label:'Ship'}];
const delayReasons=['Heavy fog or low visibility','Rain or adverse weather','Flight delayed at the departure airport','Traffic congestion en route','Vehicle or equipment issue','High volume at the sorting hub'];
const terminal=(p:ParcelRead)=>['delivered','rto','cancelled'].includes(p.status);
const shortRoute=(r:RouteDto)=>r.carrier_code||`Route ${r.id.slice(0,8)}`;
const date=(s:string)=>formatKolkata(s,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});
const plural=(n:number,word:string,many=word+'s')=>`${n} ${n===1?word:many}`;
interface RouteRecord{route:RouteDto;manifest:RouteManifestDto;rows:ParcelRead[];lotIds:string[];entryIds:string[];history:RouteHistoryItem[];latest:RouteEventResult|null}
interface Data{records:RouteRecord[];lots:LotDto[];parcels:ParcelRead[];entries:CounterEntry[]}
export function routeStage(record:RouteRecord){
 if(record.route.state==='archived')return 'archived';
 if(record.latest?.kind==='arrival'||record.route.planning_progress==='arrived')return 'arrived';
 if(record.latest?.kind==='delay'||(record.route.planning_delay_minutes??0)>0)return 'delayed';
 if(record.latest?.kind==='departure'||record.route.planning_progress==='departed')return 'departed';
 return 'scheduled';
}
const departed=(r:RouteRecord)=>r.latest!==null||r.route.planning_progress==='departed'||r.route.planning_progress==='arrived';
export function groupRoutes(records:RouteRecord[],now=new Date()){
 const tomorrow=Date.parse(dayStart(shiftDay(businessDay(now),1)));
 return [{label:'Today',rows:records.filter(r=>!['arrived','archived'].includes(routeStage(r))&&Date.parse(r.route.scheduled_departure_at)<tomorrow)},{label:'Upcoming',rows:records.filter(r=>!['arrived','archived'].includes(routeStage(r))&&Date.parse(r.route.scheduled_departure_at)>=tomorrow)},{label:'Completed',rows:records.filter(r=>['arrived','archived'].includes(routeStage(r)))}];
}
export default function RoutesWorkspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>routes(api),[api]),lotSource=useMemo(()=>lots(api),[api]),parcelSource=useMemo(()=>parcels(api),[api]);
 const write=canAdminister(roles,'routes.create')||roles.some(r=>['franchise_admin','operator','dispatcher'].includes(r)),canEntries=roles.some(r=>['org_admin','franchise_admin','operator'].includes(r));
 const data=useResource(api.franchise+'dispatch-routes',async(signal:AbortSignal):Promise<Data>=>{
  const [journeys,groups,shipments,entries]=await Promise.all([allLotPages(cursor=>source.list({limit:100,cursor},signal)),allLotPages(cursor=>lotSource.list({state:'active',limit:100,cursor},signal)),allLotPages(cursor=>parcelSource.list({limit:100,cursor},signal)),canEntries?bookingEntries(api).list(signal):Promise.resolve({items:[]})]);
  const records=await Promise.all(journeys.map(async route=>{
   let manifest:RouteManifestDto|null=null;
   const [items,history,latest]=await Promise.all([allLotPages(async cursor=>{const page=await source.manifest(route.id,undefined,{limit:100,cursor},signal);manifest??=page.manifest;return page;}),allLotPages(cursor=>source.history(route.id,{limit:100,cursor},signal)),source.latest(route.id,signal)]);
   const rowIds=new Set(items.map(p=>p.parcel_id)),lotIds=[...new Set([...items.flatMap(p=>p.sources.flatMap(s=>s.kind==='lot'?[s.lot_id]:[])),...groups.filter(l=>l.planning_route_id===route.id).map(l=>l.id)])];
   const entryIds=[...new Set([...(route.planning_entry_ids??[]),...groups.filter(l=>lotIds.includes(l.id)).flatMap(l=>l.planning_entry_ids??[])])];
   return {route,manifest:manifest!,rows:shipments.filter(p=>rowIds.has(p.id)),lotIds,entryIds,history,latest:latest.latest};
  }));return {records,lots:groups,parcels:shipments,entries:entries.items};
 });
 const [plan,setPlan]=useState(false),[attach,setAttach]=useState<RouteRecord|null>(null),[event,setEvent]=useState<{record:RouteRecord;kind:'departure'|'delay'|'arrival'}|null>(null),[broadcast,setBroadcast]=useState<RouteRecord|null>(null),[notice,setNotice]=useState('');
 const close=()=>{setPlan(false);setAttach(null);setEvent(null);setBroadcast(null);data.reload();};
 if(data.phase==='loading')return <div className="page"><Loading label="Loading dispatch routes…"/></div>;
 if(data.phase==='error')return <div className="page"><Failure label="Dispatch routes could not be loaded." retry={data.reload}/></div>;
 const value=data.value!;
 return <div className="page live-routes"><div className="page-actions">{write&&<Button icon="add" onClick={()=>setPlan(true)}>Plan Route</Button>}</div>{notice&&<p role="status">{notice}</p>}
  {groupRoutes(value.records).map(group=>group.rows.length?<section className="rt-group" key={group.label}><div className="section-label">{group.label}<span className="count-note">{group.rows.length}</span></div><div style={{display:'grid',gap:14}}>{group.rows.map(record=><DispatchRouteCard key={record.route.id} record={record} write={write} attach={()=>setAttach(record)} event={kind=>setEvent({record,kind})} broadcast={()=>setBroadcast(record)}/>)}</div></section>:null)}
  {!value.records.length&&<Card><EmptyState icon="alt_route" title="No routes yet" sub='Plan a route such as “Ahmedabad → Mumbai, Flight AI-888” and attach lots.'/></Card>}
  {(plan||attach)&&<RouteSelectionDialog source={source} lotSource={lotSource} data={value} record={attach??undefined} close={close} saved={r=>{setNotice(`${shortRoute(r)} ${attach?'updated':'scheduled'}.`);close();}}/>}
  {event&&<RouteJourneyDialog source={source} parcelSource={parcelSource} record={event.record} kind={event.kind} roles={roles} close={close} saved={()=>{setNotice(`${event.kind==='delay'?'Delay':event.kind==='arrival'?'Arrival':'Departure'} recorded. Customer updates are subject to messaging policy.`);close();}}/>}
  {broadcast&&<RouteBroadcast source={source} record={broadcast} close={close}/>}
 </div>;
}
function DispatchRouteCard({record,write,attach,event,broadcast}:{record:RouteRecord;write:boolean;attach:()=>void;event:(kind:'departure'|'delay'|'arrival')=>void;broadcast:()=>void}){
 const [history,setHistory]=useState(false),r=record.route,stage=routeStage(record),customerCount=new Set(record.rows.filter(p=>!terminal(p)).map(p=>p.sender.source_customer_id)).size;
 const labels:Record<string,string>={scheduled:'SCHEDULED',delayed:'DELAYED',departed:'DEPARTED',arrived:'ARRIVED',archived:'ARCHIVED'};
 const classes:Record<string,string>={scheduled:'st-booked',delayed:'st-delayed',departed:'st-dispatched',arrived:'st-delivered',archived:'st-booked'};
 const ended=stage==='arrived'||stage==='archived';
 return <RouteCardView icon={modeIcons[r.mode]} title={`${r.origin} → ${r.destination}`} meta={<><span className="mono">{shortRoute(r)}</span> · leaves {date(r.scheduled_departure_at)}</>} status={<span className={`pill ${classes[stage]}`}>{labels[stage]}</span>}>
  <div className="rt-reach"><Msym name="group"/><span><b>{customerCount}</b> customer{customerCount===1?'':'s'} linked to this route</span><span className="rt-reach-sep"/><span><b>{record.manifest.parcel_count}</b> parcel{record.manifest.parcel_count===1?'':'s'} loaded</span>{record.entryIds.length>0&&<><span className="rt-reach-sep"/><span>{plural(record.entryIds.length,'planning entry','planning entries')}</span></>}</div>
  <div className="rt-actions">{write&&!ended&&<><Button size="sm" icon={departed(record)?'flag':'upcoming'} onClick={()=>event(departed(record)?'arrival':'departure')}>{departed(record)?'Mark arrived':'Mark departed'}</Button><Button size="sm" variant="outlined" icon="warning" className="btn-danger-outline" onClick={()=>event('delay')}>Report delay</Button></>}<div className="rt-more">{write&&<Button size="sm" variant="text" icon="playlist_add" disabled={r.state!=='planning'||departed(record)} onClick={attach}>Attach</Button>}<Button size="sm" variant="text" icon="campaign" disabled={!write||stage==='archived'||!customerCount&&!record.entryIds.length} onClick={broadcast}>Broadcast</Button></div></div>
  {record.history.length>0&&<><button type="button" className="rt-toggle" aria-expanded={history} onClick={()=>setHistory(v=>!v)}><Msym name={history?'expand_less':'expand_more'}/>{history?'Hide':'Show'} history ({record.history.length})</button>{history&&<ul className="tline rt-tline">{record.history.map(ev=><li key={ev.id}><span className={`node ${ev.type==='route.delayed'?'delay-node':'done'}`}><Msym name={ev.type==='route.delayed'?'priority_high':'check'}/></span><div className="t-head">{historyTitle(ev.type,r)}<span className="t-time">{date(ev.at)}</span></div>{ev.note&&<div className="t-note">{ev.note}</div>}{ev.total_delay_minutes>0&&<div className="t-note">Total expected delay: {ev.total_delay_minutes} minutes</div>}{ev.planning&&<div className="t-note">Planning progress; parcel custody is unchanged.</div>}</li>)}</ul>}</>}
 </RouteCardView>;
}
const historyTitle=(type:string,r:RouteDto)=>({'route.created':'Route scheduled','route.updated':'Route details updated','route.departed':`Departed ${r.origin}`,'route.delayed':'Delay reported','route.arrived':`Arrived at ${r.destination}`,'route.manifest_finalized':'Dispatch list finalized','route.lot_attached':'Lot attached','route.lot_detached':'Lot removed','route.parcel_attached':'Parcel attached','route.parcel_detached':'Parcel removed','route.archived':'Route archived'}[type]??'Route updated');
function RouteSelectionDialog({source,lotSource,data,record,close,saved}:{source:RouteSource;lotSource:LotSource;data:Data;record?:RouteRecord;close:()=>void;saved:(route:RouteDto)=>void}){
 const id=useId(),[origin,setOrigin]=useState(record?.route.origin??data.records[0]?.route.origin??''),[destination,setDestination]=useState(record?.route.destination??''),[mode,setMode]=useState<RouteDto['mode']>(record?.route.mode??'air'),[carrier,setCarrier]=useState(record?.route.carrier_code??''),[departure,setDeparture]=useState(record?instantToKolkataInput(record.route.scheduled_departure_at)??'':businessDay()+'T21:00');
 const [selectedLots,setSelectedLots]=useState<Set<string>>(new Set()),[selectedParcels,setSelectedParcels]=useState<Set<string>>(new Set()),[selectedEntries,setSelectedEntries]=useState<Set<string>>(new Set()),[search,setSearch]=useState('');
 const workflow=useRef<ReturnType<typeof routeAttachmentPlan>|null>(null),command=useCommand<RouteDto>(()=>workflow.current!.execute()),busy=command.phase==='pending'||command.phase==='uncertain',started=workflow.current!==null;
 const candidates=data.lots.filter(l=>!record?.lotIds.includes(l.id)),physical=data.parcels.filter(p=>['booked','checked_in'].includes(p.status)&&!record?.rows.some(r=>r.id===p.id)),entries=data.entries.filter(e=>!record?.entryIds.includes(e.id));
 const query=search.trim().toLowerCase(),matchingParcels=physical.filter(p=>(p.docket+p.sender.name+(p.destination_key??p.details?.city??'')).toLowerCase().includes(query)),matchingEntries=entries.filter(e=>Object.values(e.data.fields).join(' ').toLowerCase().includes(query));
 const count=selectedLots.size+selectedParcels.size+selectedEntries.size;
 const toggle=(set:React.Dispatch<React.SetStateAction<Set<string>>>,key:string,on:boolean)=>set(previous=>{const next=new Set(previous);if(on)next.add(key);else next.delete(key);return next;});
 async function submit(event:React.FormEvent){
  event.preventDefault();const instant=kolkataInputToInstant(departure);if(!record&&(!origin.trim()||!destination.trim()||!instant))return;
  workflow.current??=routeAttachmentPlan({source,lots:lotSource,route:record?.route,create:{origin:origin.trim(),destination:destination.trim(),mode,carrier_code:carrier.trim().toUpperCase()||null,scheduled_departure_at:instant??new Date().toISOString()},lotIds:[...selectedLots],parcelIds:[...selectedParcels],entryIds:[...selectedEntries]});
  try{const r=await command.run(source.intent({kind:'create',body:{origin:origin.trim(),destination:destination.trim(),mode,carrier_code:carrier.trim().toUpperCase()||null,scheduled_departure_at:instant??new Date().toISOString()}}));saved(r);}catch{/* confirmed steps and exact uncertain requests remain in workflow */}
 }
 return <Dialog open size="lg" title={record?`Attach to ${shortRoute(record.route)}`:'Plan dispatch route'} hideClose={busy} onClose={()=>{if(!busy)close();}} actions={<><Button variant="text" disabled={busy} onClick={close}>{started&&command.phase==='error'?'Finish later':'Cancel'}</Button><Button type="submit" form={id} disabled={busy||Boolean(record)&&!count}>{started?'Retry remaining steps':record?'Attach':'Schedule route'}</Button></>}>
  <form id={id} onSubmit={event=>{void submit(event);}}><fieldset className="dispatch-route-form" disabled={busy||started}>
   {!record&&<div className="grid2"><TextField label="From" value={origin} onChange={setOrigin} maxLength={120} required autoComplete="off"/><TextField label="Destination city" value={destination} onChange={setDestination} maxLength={120} required autoComplete="off"/><SelectField label="Mode" value={mode} onChange={v=>setMode(v as RouteDto['mode'])} options={modeOptions}/><TextField label="Carrier code" value={carrier} onChange={v=>setCarrier(v.toUpperCase())} maxLength={64} helper="AI-888 / GJ-04-TR-1234" autoCapitalize="characters" spellCheck={false}/><TextField className="route-departure" label="Departure" type="datetime-local" value={departure} onChange={setDeparture} required helper="India Standard Time (IST)."/></div>}
   <div className="t-label-md muted" style={{margin:'16px 0 8px'}}>{record?'LOTS':'ATTACH LOTS'}</div>
   {!candidates.length&&<p className="t-body-sm muted">{record?'All available lots are already attached.':'No lots yet. You can attach them later.'}</p>}
   {candidates.map(l=><DispatchSelection key={l.id} label={`Attach lot ${l.code}`} checked={selectedLots.has(l.id)} onChange={v=>toggle(setSelectedLots,l.id,v)} disabled={busy||started}><b className="mono t-body-sm">{l.code}</b><span>{l.name}</span></DispatchSelection>)}
   {record&&<><div className="u-between" style={{margin:'16px 0 8px',gap:12,flexWrap:'wrap'}}><span className="t-label-md muted">INDIVIDUAL PARCELS ({matchingParcels.length+matchingEntries.length} of {physical.length+entries.length})</span><TextField label="Search parcels" value={search} onChange={setSearch} trailing="search" style={{width:'min(100%, 220px)'}}/></div><div className="attach-scroll">
    {!matchingParcels.length&&!matchingEntries.length&&<p className="t-body-sm muted">No parcels match that search.</p>}
    {matchingParcels.map(p=><DispatchSelection key={p.id} label={`Attach parcel ${p.docket}`} checked={selectedParcels.has(p.id)} onChange={v=>toggle(setSelectedParcels,p.id,v)} disabled={busy||started}><b className="mono t-body-sm">{p.docket}</b><span>{p.sender.name}</span><span className="muted t-body-sm"> → {p.details?.city||p.destination_key||'Destination not recorded'}</span></DispatchSelection>)}
    {matchingEntries.map(e=><DispatchSelection key={e.id} label={`Attach planning entry ${e.data.fields.docket||e.id.slice(0,8)}`} checked={selectedEntries.has(e.id)} onChange={v=>toggle(setSelectedEntries,e.id,v)} disabled={busy||started}><b className="mono t-body-sm">{e.data.fields.docket||e.id.slice(0,8)}</b><span>{e.data.fields.name||'Customer not recorded'}</span><span className="muted t-body-sm"> → {e.data.fields.destination||'Destination not recorded'} · Planning entry</span></DispatchSelection>)}
   </div></>}
  </fieldset></form>
  {command.phase==='error'&&workflow.current?.hasChanges&&<p role="status">{workflow.current.currentRoute?`${shortRoute(workflow.current.currentRoute)} is saved.`:'Some changes were saved.'} Remaining attachments have not completed. Finish later or retry the remaining steps.</p>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(r=>{if(r)saved(r);}).catch(()=>{});}:undefined}/>
 </Dialog>;
}
function RouteJourneyDialog({source,parcelSource,record,kind,roles,close,saved}:{source:RouteSource;parcelSource:ParcelSource;record:RouteRecord;kind:'departure'|'delay'|'arrival';roles:readonly OperatorRole[];close:()=>void;saved:()=>void}){
 const id=useId(),r=record.route,planningOnly=record.manifest.parcel_count===0;
 const [note,setNote]=useState(kind==='departure'?`Departed ${r.origin}.`:kind==='arrival'?`Arrived at ${r.destination}.`:''),[reason,setReason]=useState(delayReasons[0]!),[extra,setExtra]=useState(''),[hours,setHours]=useState(String(Math.max(record.latest?.eta.total_delay_minutes??r.planning_delay_minutes??0,240)/60)),[effective,setEffective]=useState(()=>instantToKolkataInput(new Date().toISOString())??''),[eta,setEta]=useState('');
 const workflow=useRef<ReturnType<typeof routeJourneyPlan>|null>(null),command=useCommand<RouteDto|RouteEventResult>(()=>workflow.current!.execute()),busy=command.phase==='pending'||command.phase==='uncertain',started=workflow.current!==null;
 const delay=Number(hours)*60,effectiveAt=kolkataInputToInstant(effective),baseEta=eta?kolkataInputToInstant(eta):null;
 const canTransit=roles.some(role=>['org_admin','franchise_admin','dispatcher'].includes(role));
 const blocker=kind==='departure'&&!planningOnly&&!canTransit?'An authorized dispatcher must record departure for dispatchable parcels.':kind==='departure'&&!planningOnly&&r.state==='planning'&&(record.rows.length!==record.manifest.parcel_count||record.rows.some(p=>p.status!=='checked_in'))?'Check in every parcel at the hub before recording departure.':kind==='delay'&&!planningOnly&&r.state==='finalized'&&!record.latest?'Record departure before reporting a delay for this finalized dispatch list.':null;
 async function submit(event:React.FormEvent){event.preventDefault();if(blocker||!effectiveAt||kind==='delay'&&(!hours.trim()||!Number.isSafeInteger(delay)||delay<0||delay>43200)||eta&&!baseEta)return;
  workflow.current??=routeJourneyPlan({source,parcels:parcelSource,route:r,manifest:record.manifest,rows:record.rows,kind,note:kind==='delay'?`${reason}${extra.trim()?`. ${extra.trim()}`:''}`:note,effectiveAt,baseEta,delayMinutes:delay});
  try{await command.run(source.intent({kind:'update',routeId:r.id,body:{...routeMetadata(r),expected_version:r.version}}));saved();}catch{/* retained workflow */}
 }
 const title=kind==='departure'?'Departure':kind==='arrival'?'Arrival':'Report delay';
 return <Dialog open size={kind==='delay'?'lg':undefined} title={`${title} — ${shortRoute(r)}`} hideClose={busy} onClose={()=>{if(!busy)close();}} actions={<><Button variant="text" disabled={busy} onClick={close}>{started&&command.phase==='error'?'Finish later':'Cancel'}</Button><Button type="submit" form={id} disabled={busy||!!blocker||!effectiveAt||kind==='delay'&&(!hours.trim()||!Number.isSafeInteger(delay)||delay<0||delay>43200)}>{started?'Retry remaining steps':kind==='departure'?'Mark departed':kind==='arrival'?'Mark arrived':'Record delay'}</Button></>}>
  <form id={id} onSubmit={event=>{void submit(event);}}><fieldset className="dispatch-route-form" disabled={busy||started}>
   {planningOnly?<p className="t-body-sm muted" style={{marginBottom:14}}>This records journey progress for planning entries. Parcel custody stays unchanged.</p>:<p className="t-body-sm muted" style={{marginBottom:14}}>{kind==='departure'?'Confirm that the route has departed. Checked-in parcels on this dispatch list will be dispatched.':kind==='arrival'?`Confirm that the route has arrived at ${r.destination}. This does not mark parcels as delivered.`:r.state==='planning'?'Record the expected delay while this route is being planned. Customer alerts begin after physical departure.':'Record the total expected delay for this route. Eligible customer updates are processed by the messaging service.'}</p>}
   {kind==='delay'?<><SelectField label="Reason" value={reason} onChange={setReason} options={delayReasons.map(v=>({value:v,label:v}))}/><TextField label="Extra details (optional)" value={extra} onChange={setExtra} maxLength={700} helper="For example, revised arrival at 11 PM." style={{margin:'12px 0'}}/><TextField label="Total expected delay (hours)" type="number" value={hours} onChange={setHours} min="0" max="720" step="0.25" required style={{maxWidth:260}} helper="Enter the total delay, including any delay already recorded."/></>:<TextField label="Note for your team" value={note} onChange={setNote} maxLength={1000}/>}
   {!planningOnly&&!(kind==='delay'&&r.state==='planning')&&<details style={{marginTop:14}}><summary>Event time{kind==='departure'&&!planningOnly?' and expected arrival':''}</summary><TextField label="Event time (IST)" type="datetime-local" step="0.001" value={effective} onChange={setEffective} required/>{kind==='departure'&&!planningOnly&&<TextField label="Expected route arrival (optional, IST)" type="datetime-local" value={eta} onChange={setEta}/>}</details>}
  </fieldset></form>
  {blocker&&<p role="status">{blocker} {blocker.startsWith('Check in')&&<Link to="/business/bookings">Open Packages</Link>}</p>}
  {command.phase==='error'&&workflow.current?.hasChanges&&<p role="status">Some dispatch steps were saved. The remaining steps have not completed. Finish later or retry the remaining steps.</p>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(saved).catch(()=>{});}:undefined}/>
 </Dialog>;
}
function RouteBroadcast({source,record,close}:{source:RouteSource;record:RouteRecord;close:()=>void}){
 const [text,setText]=useState(''),command=useCommand(intent=>source.sendMessage(intent)),busy=command.phase==='pending'||command.phase==='uncertain',count=new Set(record.rows.filter(p=>!terminal(p)).map(p=>p.sender.source_customer_id)).size;
 return <Dialog open title={`Broadcast to ${shortRoute(record.route)} customers`} hideClose={busy} onClose={()=>{if(!busy)close();}} actions={<><Button variant="text" disabled={busy} onClick={close}>{command.result?'Done':'Cancel'}</Button>{!command.result&&<Button disabled={busy||!text.trim()} onClick={()=>{void command.run(source.messageIntent(record.route.id,text)).catch(()=>{});}}>Send</Button>}</>}>
  <p className="t-body-sm muted" style={{marginBottom:12}}>{plural(count,'customer')} linked to this route. Sending depends on WhatsApp setup and each customer’s consent.</p>{record.entryIds.length>0&&<p className="t-body-sm muted" style={{marginBottom:12}}>{plural(record.entryIds.length,'planning entry','planning entries')} cannot receive messages without a verified customer record.</p>}
  <TextField label="Message" value={text} onChange={setText} maxLength={4096}/>
  {command.result?<p role="status">{command.result.queued} queued · {command.result.suppressed} suppressed by messaging policy · {command.result.failed} failed · {command.result.unavailable} unavailable. Queued does not mean delivered.</p>:<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().catch(()=>{});}:undefined}/>}
  {command.phase==='error'&&command.error?.code==='TEMPORARILY_UNAVAILABLE'&&<p>Check the server’s WhatsApp configuration and validated installation before trying again.</p>}
 </Dialog>;
}
