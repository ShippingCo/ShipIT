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
import {DispatchSelection} from '../components/workspace/DispatchSelection';
import {Button,SegmentedControl} from '../components/m3/Button';
import {Card,EmptyState} from '../components/m3/Surface';
import {Dialog} from '../components/m3/Dialog';
import {TextField,SelectField} from '../components/m3/Input';
import {Msym} from '../components/m3/Icon';
import {PageHeader} from '../components/workspace/Workspace';
import {printDispatchList,type DispatchListView} from '../utils/dispatch-list';
import './trips.css';

/**
 * Trips.
 *
 * A trip is a vehicle leaving with a load. This screen loads it, prints the sheet that travels
 * with it, and records what happens on the road.
 *
 * It is also the only screen in ShipIT where one press sends dozens of WhatsApp messages to
 * customers, and that single fact shapes everything below. An operator who cannot tell what a
 * button does will press it to find out; on this screen, finding out means twenty strangers
 * get a message about their parcel. So the count of people who will be told is stated above
 * the button, the button itself names both halves of what it does, and when a recording fails
 * the screen says whether the messages went out — because being unsure of that is worse than
 * either answer.
 *
 * The vehicle number leads every card. The yard is organised around vehicles and the plate is
 * what an operator matches on; "manifest", "finalize", "route event" and "leg" are schema
 * words and appear nowhere a person can read them.
 */

const modeIcons={air:'flight',rail:'train',road:'local_shipping',sea:'directions_boat'};
const modeOptions=[{value:'air',label:'Flight'},{value:'rail',label:'Train'},{value:'road',label:'Road'},{value:'sea',label:'Ship'}];
const terminal=(p:ParcelRead)=>['delivered','rto','cancelled'].includes(p.status);
const cityName=(s:string)=>s.replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());
const date=(s:string)=>formatKolkata(s,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});
const plural=(n:number,word:string,many=word+'s')=>`${n} ${n===1?word:many}`;
const stamp=()=>new Date().toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});

/** The vehicle, as the yard says it. Never a record identifier dressed up as one. */
const vehicleOf=(r:RouteDto)=>r.carrier_code||'Vehicle not recorded';
const tripRef=(r:RouteDto)=>'TRIP-'+r.id.slice(0,8).toUpperCase();

/**
 * What happened on the road, in the four things a driver actually rings to say.
 *
 * Three of them are the same recorded fact — the trip is late — with different reasons, and
 * the reason never reaches a customer: a shop does not want "vehicle broke down" going out
 * under its own name. "Reached" is a different fact and tells nobody, because arrival is
 * already tracked per parcel.
 */
const happenings=[
  {value:'late',label:'Running late',kind:'delay' as const,reason:'Running late',asks:'hours',tells:true},
  {value:'broke',label:'Vehicle broke down',kind:'delay' as const,reason:'Vehicle broke down',asks:'hours',tells:true},
  {value:'blocked',label:'Road blocked',kind:'delay' as const,reason:'Road blocked',asks:'hours',tells:true},
  {value:'reached',label:'Reached',kind:'arrival' as const,reason:'',asks:'nothing',tells:false},
];
type Happening=typeof happenings[number];

interface RouteRecord{route:RouteDto;manifest:RouteManifestDto;rows:ParcelRead[];lotIds:string[];entryIds:string[];history:RouteHistoryItem[];latest:RouteEventResult|null;
 /** Which bag each loaded parcel came in, so the printed sheet can group page two by bag. */
 bagOf:Map<string,string>}
interface Data{records:RouteRecord[];lots:LotDto[];parcels:ParcelRead[];entries:CounterEntry[]}

export function routeStage(record:RouteRecord){
 if(record.route.state==='archived')return 'archived';
 if(record.latest?.kind==='arrival'||record.route.planning_progress==='arrived')return 'arrived';
 if(record.latest?.kind==='delay'||!record.latest&&(record.route.planning_delay_minutes??0)>0)return 'delayed';
 if(record.latest?.kind==='departure'||record.route.planning_progress==='departed')return 'departed';
 return 'scheduled';
}
const departed=(r:RouteRecord)=>r.latest!==null||r.route.planning_progress==='departed'||r.route.planning_progress==='arrived';

export function groupRoutes(records:RouteRecord[],now=new Date()){
 const tomorrow=Date.parse(dayStart(shiftDay(businessDay(now),1)));
 return [
  {label:'Today',rows:records.filter(r=>!['arrived','archived'].includes(routeStage(r))&&Date.parse(r.route.scheduled_departure_at)<tomorrow)},
  {label:'Later',rows:records.filter(r=>!['arrived','archived'].includes(routeStage(r))&&Date.parse(r.route.scheduled_departure_at)>=tomorrow)},
  {label:'Finished',rows:records.filter(r=>['arrived','archived'].includes(routeStage(r)))},
 ];
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
   const bagOf=new Map(items.flatMap(item=>{const lot=item.sources.find(s=>s.kind==='lot');return lot&&lot.kind==='lot'?[[item.parcel_id,lot.lot_id] as const]:[];}));
   return {route,manifest:manifest!,rows:shipments.filter(p=>rowIds.has(p.id)),lotIds,entryIds,history,latest:latest.latest,bagOf};
  }));
  return {records,lots:groups,parcels:shipments,entries:entries.items};
 });
 const [plan,setPlan]=useState(false),[attach,setAttach]=useState<RouteRecord|null>(null);
 const [happening,setHappening]=useState<RouteRecord|null>(null);
 const [leaving,setLeaving]=useState<RouteRecord|null>(null);
 const [sealing,setSealing]=useState<RouteRecord|null>(null);
 const [notice,setNotice]=useState('');
 const close=()=>{setPlan(false);setAttach(null);setHappening(null);setLeaving(null);setSealing(null);data.reload();};
 const value=data.value??{records:[],lots:[],parcels:[],entries:[]};

 return <div className="page live-routes trips">
  <PageHeader title="Trips" description="A trip is one vehicle leaving with a load."
    actions={write&&<Button icon="add" onClick={()=>setPlan(true)}>Plan a trip</Button>}/>
  {notice&&<p role="status">{notice}</p>}
  {data.phase==='loading'&&<Loading label="Loading trips…"/>}
  {data.phase==='error'&&<Failure label="Saved trips and booking selections could not be loaded. You can still plan a trip and load it later." retry={data.reload}/>}
  {groupRoutes(value.records).map(group=>group.rows.length?<section className="rt-group" key={group.label}>
    <div className="section-label">{group.label}<span className="count-note">{group.rows.length}</span></div>
    <div className="trip-grid">{group.rows.map(record=><TripCard key={record.route.id} record={record} write={write} data={value}
      load={()=>setAttach(record)} seal={()=>setSealing(record)} leave={()=>setLeaving(record)} happened={()=>setHappening(record)}
      printed={()=>setNotice('Dispatch list printed.')}/>)}</div>
  </section>:null)}
  {data.phase==='ready'&&!value.records.length&&<Card><EmptyState icon="local_shipping" title="No trips yet" sub="A trip is a vehicle going to one city. Say which vehicle and where it is going; load the bags afterwards." action={write?<Button icon="add" onClick={()=>setPlan(true)}>Plan your first trip</Button>:undefined}/></Card>}
  {(plan||attach)&&<TripSelectionDialog source={source} lotSource={lotSource} data={value} record={attach??undefined} selectionsUnavailable={data.phase==='error'} close={close} saved={r=>{setNotice(`${vehicleOf(r)} ${attach?'loaded':'planned'}.`);close();}}/>}
  {sealing&&<SealList source={source} record={sealing} data={value} close={close} sealed={()=>{setNotice('Dispatch list sealed and printed. Nothing further can be loaded on this trip.');close();}}/>}
  {leaving&&<LeftTheShop source={source} parcelSource={parcelSource} record={leaving} roles={roles} close={close} saved={()=>{setNotice(`${vehicleOf(leaving.route)} recorded as left.`);close();}}/>}
  {happening&&<WhatHappened source={source} parcelSource={parcelSource} record={happening} close={close} saved={line=>{setNotice(line);close();}}/>}
 </div>;
}

/** Bags, parcels and weight on one vehicle, from the rows already loaded for the screen. */
function tripLoad(record:RouteRecord,data:Data){
 const bags=record.lotIds.flatMap(id=>{
   const lot=data.lots.find(l=>l.id===id);
   if(!lot)return [];
   const rows=record.rows.filter(p=>record.bagOf.get(p.id)===id);
   const weight=rows.reduce((sum,p)=>sum+p.weight_grams,0)/1000;
   return [{city:cityName(lot.destination_key),code:lot.code,parcels:rows.length,weight:weight.toFixed(1)}];
 });
 const weight=record.rows.reduce((sum,p)=>sum+p.weight_grams,0)/1000;
 return {bags,parcels:record.rows.length,weight};
}

function dispatchView(record:RouteRecord,data:Data,shop:string,marks:{duplicate?:string;provisional?:boolean}):DispatchListView {
 const load=tripLoad(record,data);
 const bagOf=record.bagOf;
 return {
  vehicle:vehicleOf(record.route),shop,from:record.route.origin,to:record.route.destination,
  leaves:date(record.route.scheduled_departure_at),reference:tripRef(record.route),
  bags:load.bags,
  parcels:record.rows.map(p=>({docket:p.docket,city:cityName(p.destination_key||p.details?.city||''),
    weight:(p.weight_grams/1000).toFixed(1),
    bag:data.lots.find(l=>l.id===bagOf?.get(p.id))?.code??'—'})),
  totals:{bags:load.bags.length,parcels:load.parcels,weight:load.weight.toFixed(1)},
  ...marks,
 };
}

/**
 * One vehicle.
 *
 * The plate leads. Four figures sit in one row under it — bags, parcels, weight, and when it
 * leaves or left — with no sentence between them, because the operator is comparing this card
 * against a vehicle in front of them and not reading a report.
 *
 * There is exactly one filled button, and it stays in the same place while the trip moves
 * through its day. Only its words change: load it, seal the list, record that it left, say
 * what happened. A button that moves is a button that gets pressed by accident.
 */
function TripCard({record,write,data,load,seal,leave,happened,printed}:{
  record:RouteRecord;write:boolean;data:Data;load:()=>void;seal:()=>void;leave:()=>void;happened:()=>void;printed:()=>void;
}){
 const [history,setHistory]=useState(false),[prints,setPrints]=useState(0);
 const r=record.route,stage=routeStage(record);
 const customerCount=new Set(record.rows.filter(p=>!terminal(p)).map(p=>p.sender.source_customer_id)).size;
 const labels:Record<string,string>={scheduled:'LOADING',delayed:'RUNNING LATE',departed:'ON THE ROAD',arrived:'ARRIVED',archived:'CLOSED'};
 const classes:Record<string,string>={scheduled:'st-booked',delayed:'st-delayed',departed:'st-dispatched',arrived:'st-delivered',archived:'st-booked'};
 const ended=stage==='arrived'||stage==='archived';
 const figures=tripLoad(record,data);
 const sealed=r.state!=='planning';
 const shop=data.records.length?'':''; // the shop's own name is on the printed sheet's header only

 function print(){
  printDispatchList(dispatchView(record,data,shop,{...(prints>0?{duplicate:stamp()}:{}),...(sealed?{}:{provisional:true})}));
  setPrints(n=>n+1);printed();
 }

 // R-3/R-4: one primary action, in one position, whose words follow the trip's day. With
 // nothing loaded it is unavailable and the reason sits beside it rather than inside a tooltip.
 //
 // A trip carrying only planned bookings skips sealing altogether: there is no sack and no
 // docket, so there is no sheet to seal and nothing a driver could sign for.
 const plannedOnly=figures.parcels===0&&record.entryIds.length>0;
 const primary=ended?null
  :!sealed&&!plannedOnly?{label:'Finish loading and print the list',icon:'print',act:seal,
      blocked:figures.parcels===0?'Load at least one bag before sealing the list.':''}
  :!departed(record)?{label:'Record that it has left',icon:'logout',act:leave,blocked:''}
  :{label:'Record something that happened',icon:'campaign',act:happened,blocked:''};

 return <Card className="trip-card">
  <div className="trip-head">
   <span className="trip-icon"><Msym name={modeIcons[r.mode]} size={28}/></span>
   <div className="u-grow">
    <div className="trip-vehicle">{vehicleOf(r)}</div>
    <div className="trip-where">{r.origin} → {r.destination}</div>
   </div>
   <span className={`pill ${classes[stage]}`}>{labels[stage]}</span>
  </div>

  <div className="trip-figs">
   <div><span className="trip-fig">{figures.bags.length}</span><span className="trip-fig-l">bags</span></div>
   <div><span className="trip-fig">{figures.parcels}</span><span className="trip-fig-l">parcels</span></div>
   <div><span className="trip-fig">{figures.weight.toFixed(1)}</span><span className="trip-fig-l">kg</span></div>
   <div><span className="trip-fig">{date(r.scheduled_departure_at)}</span><span className="trip-fig-l">{departed(record)?'left':'leaves'}</span></div>
  </div>

  {record.entryIds.length>0&&<p className="t-body-sm muted">{plural(record.entryIds.length,'booking planned into this trip','bookings planned into this trip')}, not booked yet.</p>}

  <div className="trip-actions">
   {primary&&write&&<>
    <Button size="sm" icon={primary.icon} disabled={!!primary.blocked} onClick={primary.act}>{primary.label}</Button>
    {primary.blocked&&<span className="trip-blocked" role="status">{primary.blocked}</span>}
   </>}
   {write&&!sealed&&!ended&&<Button size="sm" variant="outlined" icon="playlist_add" onClick={load}>Load bags</Button>}
   <Button size="sm" variant="text" icon="print" onClick={print}>{prints>0?'Print the list again':'Print the list'}</Button>
  </div>
  {!sealed&&prints>0&&<p className="t-body-sm muted">That copy is marked NOT SEALED: more can still be loaded, so the paper says so.</p>}
  {customerCount>0&&<p className="trip-reach"><Msym name="group"/><span>{plural(customerCount,'customer')} on this vehicle would be told about a delay.</span></p>}

  {record.history.length>0&&<>
   <button type="button" className="rt-toggle" aria-expanded={history} onClick={()=>setHistory(v=>!v)}>
    <Msym name={history?'expand_less':'expand_more'}/>{history?'Hide':'Show'} what has happened ({record.history.length})</button>
   {history&&<ul className="tline rt-tline">{record.history.map(ev=><li key={ev.id}>
    <span className={`node ${ev.type==='route.delayed'?'delay-node':'done'}`}><Msym name={ev.type==='route.delayed'?'priority_high':'check'}/></span>
    <div className="t-head">{historyTitle(ev.type,r)}<span className="t-time">{date(ev.at)}</span></div>
    {ev.note&&<div className="t-note">{ev.note}</div>}
    {ev.total_delay_minutes>0&&<div className="t-note">Running {ev.total_delay_minutes} minutes late in total</div>}
    {ev.planning&&<div className="t-note">Planned only; no parcel has moved.</div>}
   </li>)}</ul>}
  </>}
 </Card>;
}

const historyTitle=(type:string,r:RouteDto)=>({'route.created':'Trip planned','route.updated':'Trip details changed','route.departed':`Left ${r.origin}`,'route.delayed':'Running late','route.arrived':`Reached ${r.destination}`,'route.manifest_finalized':'Dispatch list sealed','route.lot_attached':'Bag loaded','route.lot_detached':'Bag taken off','route.parcel_attached':'Parcel loaded','route.parcel_detached':'Parcel taken off','route.archived':'Trip closed'}[type]??'Trip changed');

/**
 * Sealing the dispatch list.
 *
 * Sealing is the moment the paper becomes the truth: after it, nothing further goes on the
 * vehicle and a correction has to be a recorded event rather than a quiet edit, so that the
 * sheet in the driver's hand and the system never disagree without a trace.
 */
function SealList({source,record,data,close,sealed}:{source:RouteSource;record:RouteRecord;data:Data;close:()=>void;sealed:()=>void}){
 const figures=tripLoad(record,data);
 const command=useCommand<RouteDto>(intent=>source.execute(intent) as Promise<RouteDto>);
 const busy=command.phase==='pending'||command.phase==='uncertain';
 const already=command.error?.code==='VERSION_CONFLICT'||command.error?.code==='CONFLICT';
 async function run(){
  if(busy)return;
  try{
   await command.run(source.intent({kind:'finalize',routeId:record.route.id,body:{expected_version:record.route.version}}));
   printDispatchList(dispatchView(record,data,'',{}));
   sealed();
  }catch{/* the notice owns it, and the intent is kept for an exact retry */}
 }
 return <Dialog open hideClose={busy} onClose={()=>{if(!busy)close();}}
   title={`Seal the dispatch list for ${vehicleOf(record.route)}?`}
   actions={<><Button variant="text" disabled={busy} onClick={close}>Cancel</Button>
     <Button disabled={busy} onClick={()=>{void run();}}>Seal and print</Button></>}>
  <p className="trip-seal-figures"><b>{figures.bags.length}</b> bags · <b>{figures.parcels}</b> parcels · <b>{figures.weight.toFixed(1)}</b> kg</p>
  <p>Check the vehicle against those three numbers. Once the list is sealed nothing further can be loaded on this trip, and the sheet prints with two signature lines.</p>
  {already&&<p role="status">This list was already sealed. The sheet can still be printed, and every copy after the first is marked DUPLICATE.</p>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(sealed).catch(()=>{});}:undefined}/>
 </Dialog>;
}

/** The vehicle has left. This is the event that dispatches the parcels on it. */
function LeftTheShop({source,parcelSource,record,roles,close,saved}:{
  source:RouteSource;parcelSource:ParcelSource;record:RouteRecord;roles:readonly OperatorRole[];close:()=>void;saved:()=>void;
}){
 const id=useId(),r=record.route,planningOnly=record.manifest.parcel_count===0;
 const [note,setNote]=useState(`Left ${r.origin}.`);
 const [effective,setEffective]=useState(()=>instantToKolkataInput(new Date().toISOString())??'');
 const [eta,setEta]=useState('');
 const workflow=useRef<ReturnType<typeof routeJourneyPlan>|null>(null);
 const command=useCommand<RouteDto|RouteEventResult>(()=>workflow.current!.execute());
 const busy=command.phase==='pending'||command.phase==='uncertain',started=workflow.current!==null;
 const effectiveAt=kolkataInputToInstant(effective),baseEta=eta?kolkataInputToInstant(eta):null;
 const canTransit=roles.some(role=>['org_admin','franchise_admin','dispatcher'].includes(role));
 const blocker=!planningOnly&&!canTransit?'Only a dispatcher can record that a loaded vehicle has left.'
  :!planningOnly&&r.state==='planning'?'Seal the dispatch list first — the sheet has to exist before the vehicle goes.'
  :!planningOnly&&(record.rows.length!==record.manifest.parcel_count||record.rows.some(p=>p.status!=='checked_in'))?'Check in every parcel at the hub before recording that the vehicle left.'
  :null;
 async function submit(event:React.FormEvent){
  event.preventDefault();
  if(blocker||!effectiveAt||eta&&!baseEta)return;
  workflow.current??=routeJourneyPlan({source,parcels:parcelSource,route:r,manifest:record.manifest,rows:record.rows,kind:'departure',note,effectiveAt,baseEta,delayMinutes:0});
  try{await command.run(source.intent({kind:'update',routeId:r.id,body:{...routeMetadata(r),expected_version:r.version}}));saved();}catch{/* retained workflow */}
 }
 return <Dialog open title={`${vehicleOf(r)} has left?`} hideClose={busy} onClose={()=>{if(!busy)close();}}
   actions={<><Button variant="text" disabled={busy} onClick={close}>{started&&command.phase==='error'?'Finish later':'Cancel'}</Button>
     <Button type="submit" form={id} disabled={busy||!!blocker||!effectiveAt}>{started?'Retry the rest':'Record that it has left'}</Button></>}>
  <form id={id} onSubmit={event=>{void submit(event);}}><fieldset className="dispatch-route-form" disabled={busy||started}>
   <p className="t-body-sm muted" style={{marginBottom:14}}>{planningOnly
     ? 'This trip holds planned bookings only. Recording it as left changes nothing about any parcel.'
     : 'Every checked-in parcel on the sealed list moves to on the way. Customers are not messaged by this.'}</p>
   <TextField label="Note for your team" value={note} onChange={setNote} maxLength={1000}/>
   {!planningOnly&&<details style={{marginTop:14}}><summary>When it left, and when it should arrive</summary>
    <TextField label="Time it left (IST)" type="datetime-local" step="0.001" value={effective} onChange={setEffective} required/>
    <TextField label="Expected arrival (optional, IST)" type="datetime-local" value={eta} onChange={setEta}/>
   </details>}
  </fieldset></form>
  {blocker&&<p role="status">{blocker} {blocker.startsWith('Check in')&&<Link to="/business/bookings">Open Packages</Link>}</p>}
  {command.phase==='error'&&workflow.current?.hasChanges&&<p role="status">Some steps were saved and the rest have not completed. No customer was messaged either way. Finish later, or retry the rest.</p>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(saved).catch(()=>{});}:undefined}/>
 </Dialog>;
}

/**
 * What happened on the road.
 *
 * The four chips are the four calls a shop actually gets. Choosing one narrows the screen to
 * the one follow-up that choice needs, rather than showing every field for every case: a
 * driver is on the phone and the operator is typing with one hand.
 *
 * Above the button, in plain words, is who is about to be told and what they will be told —
 * and that the reason stays inside the shop. The button then names both halves of what it
 * does, so nobody has to press it to find out.
 */
function WhatHappened({source,parcelSource,record,close,saved}:{
  source:RouteSource;parcelSource:ParcelSource;record:RouteRecord;close:()=>void;saved:(line:string)=>void;
}){
 const id=useId(),r=record.route;
 const [choice,setChoice]=useState('');
 const [hours,setHours]=useState(String(Math.max(record.latest?.eta.total_delay_minutes??r.planning_delay_minutes??0,240)/60));
 const [extra,setExtra]=useState('');
 const [effective,setEffective]=useState(()=>instantToKolkataInput(new Date().toISOString())??'');
 const [again,setAgain]=useState(false);
 const workflow=useRef<ReturnType<typeof routeJourneyPlan>|null>(null);
 const command=useCommand<RouteDto|RouteEventResult>(()=>workflow.current!.execute());
 const busy=command.phase==='pending'||command.phase==='uncertain',started=workflow.current!==null;
 const picked:Happening|undefined=happenings.find(h=>h.value===choice);
 const planningOnly=record.manifest.parcel_count===0;
 const customers=new Set(record.rows.filter(p=>!terminal(p)).map(p=>p.sender.source_customer_id)).size;
 const tells=!!picked?.tells&&customers>0&&!planningOnly;
 const delay=Number(hours)*60,effectiveAt=kolkataInputToInstant(effective);
 const lastDelay=record.history.filter(ev=>ev.type==='route.delayed').map(ev=>Date.parse(ev.at)).sort().at(-1);
 const recentDelay=picked?.kind==='delay'&&lastDelay!==undefined&&Date.now()-lastDelay<60*60*1000;
 const invalid=!picked||!effectiveAt||picked.asks==='hours'&&(!hours.trim()||!Number.isSafeInteger(delay)||delay<0||delay>43200);

 async function run(){
  if(!picked||invalid)return;
  workflow.current??=routeJourneyPlan({source,parcels:parcelSource,route:r,manifest:record.manifest,rows:record.rows,
    kind:picked.kind,note:picked.kind==='delay'?`${picked.reason}${extra.trim()?`. ${extra.trim()}`:''}`:`Reached ${r.destination}.`,
    effectiveAt:effectiveAt!,baseEta:null,delayMinutes:picked.asks==='hours'?delay:0});
  try{
   await command.run(source.intent({kind:'update',routeId:r.id,body:{...routeMetadata(r),expected_version:r.version}}));
   saved(tells?`Recorded. ${plural(customers,'customer')} told.`:'Recorded. Nobody was messaged.');
  }catch{/* the notice states whether messages went out */}
 }
 function submit(event:React.FormEvent){
  event.preventDefault();
  if(recentDelay&&!again){setAgain(true);return;}
  void run();
 }

 return <Dialog open size="lg" title={`What happened to ${vehicleOf(r)}?`} hideClose={busy} onClose={()=>{if(!busy)close();}}
   actions={<><Button variant="text" disabled={busy} onClick={close}>{started&&command.phase==='error'?'Finish later':'Cancel'}</Button>
     <Button type="submit" form={id} disabled={busy||invalid}>
       {started?'Retry the rest':tells?`Record this and tell ${plural(customers,'customer')}`:'Record this'}</Button></>}>
  <form id={id} onSubmit={submit}><fieldset className="dispatch-route-form" disabled={busy||started}>
   <SegmentedControl radio className="happening-chips" label="What happened"
     options={happenings.map(h=>({value:h.value,label:h.label}))} value={choice} onChange={setChoice}/>

   {/* R-14: the follow-up depends on the answer. "Reached" asks nothing at all. */}
   {picked?.asks==='hours'&&<div className="happening-follow">
    <TextField label="How many hours late, in total" type="number" value={hours} onChange={setHours} min="0" max="720" step="0.25" required style={{maxWidth:280}}
      helper="The total, including any delay already recorded."/>
    <TextField label="Anything else, for your own team (optional)" value={extra} onChange={setExtra} maxLength={700}
      helper="This stays inside the shop. It is never sent to a customer."/>
   </div>}
   {picked?.kind==='arrival'&&<p className="happening-follow">Nothing else is needed. Arrival is already tracked parcel by parcel, so this tells no one.</p>}

   {picked&&<details style={{marginTop:14}}><summary>When it happened</summary>
    <TextField label="Time (IST)" type="datetime-local" step="0.001" value={effective} onChange={setEffective} required/>
   </details>}
  </fieldset></form>

  {/* R-15: who is about to be told, what they will be told, and what stays inside. */}
  {picked&&<div className={'happening-reach'+(tells?' is-telling':'')} role="status">
   <Msym name={tells?'send':'notifications_off'}/>
   <div>
    {tells
      ? <><b>{plural(customers,'customer')} will be told</b> that their parcel is delayed and when it is now expected. They are not told why, and they are not told what you typed above.</>
      : picked.kind==='arrival' ? <><b>No customer will be told.</b> Arrival is tracked per parcel, so this records the trip only.</>
      : planningOnly ? <><b>No customer will be told.</b> This trip holds planned bookings only — there is no parcel to message about.</>
      : <><b>No customer will be told.</b> Nobody on this vehicle has a parcel still moving.</>}
    <br/><small>Whether a message arrives depends on this shop&rsquo;s WhatsApp setup and each customer&rsquo;s consent.</small>
   </div>
  </div>}

  {/* Re-messaging the same people within the hour is a deliberate act, not a slip. */}
  {again&&<p role="alert" className="happening-again">A delay was recorded {Math.round((Date.now()-(lastDelay??0))/60000)} minutes ago. Press again to record this one and message {plural(customers,'customer')} a second time.</p>}

  {/* R-18. The one thing an operator must never be unsure about on this screen. */}
  {command.phase==='uncertain'&&<p role="alert" className="happening-unsure">
   <b>We do not know whether this was recorded, and we do not know whether customers were told.</b> Check if it saved before recording it again — recording it twice would message everyone twice.</p>}
  {command.phase==='error'&&<p role="alert">{workflow.current?.hasChanges
    ? 'Some steps were saved. Customers may already have been told. Check what has happened on the trip before recording this again.'
    : 'Nothing was recorded and no customer was told.'}</p>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(()=>saved(tells?`Recorded. ${plural(customers,'customer')} told.`:'Recorded. Nobody was messaged.')).catch(()=>{});}:undefined}/>
 </Dialog>;
}

function TripSelectionDialog({source,lotSource,data,record,selectionsUnavailable,close,saved}:{source:RouteSource;lotSource:LotSource;data:Data;record?:RouteRecord;selectionsUnavailable?:boolean;close:()=>void;saved:(route:RouteDto)=>void}){
 const id=useId(),[origin,setOrigin]=useState(record?.route.origin??data.records[0]?.route.origin??''),[destination,setDestination]=useState(record?.route.destination??''),[mode,setMode]=useState<RouteDto['mode']>(record?.route.mode??'road'),[carrier,setCarrier]=useState(record?.route.carrier_code??''),[departure,setDeparture]=useState(record?instantToKolkataInput(record.route.scheduled_departure_at)??'':businessDay()+'T21:00');
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
 return <Dialog open size="lg" title={record?`Load ${vehicleOf(record.route)}`:'Plan a trip'} hideClose={busy} onClose={()=>{if(!busy)close();}}
   actions={<><Button variant="text" disabled={busy} onClick={close}>{started&&command.phase==='error'?'Finish later':'Cancel'}</Button>
     <Button type="submit" form={id} disabled={busy||Boolean(record)&&!count}>{started?'Retry the rest':record?'Load it':'Plan the trip'}</Button></>}>
  <form id={id} onSubmit={event=>{void submit(event);}}><fieldset className="dispatch-route-form" disabled={busy||started}>
   {/* R-5: two things. A plate is accepted exactly as typed — formats vary, and a rejected
       plate stops a vehicle. */}
   {!record&&<div className="grid2">
    <TextField label="Vehicle number" value={carrier} onChange={v=>setCarrier(v.toUpperCase())} maxLength={64} required
      helper="As it is written on the vehicle — GJ-04-TR-1234, or a flight like AI-888." autoCapitalize="characters" spellCheck={false}/>
    <TextField label="Destination city" value={destination} onChange={setDestination} maxLength={120} required autoComplete="off"/>
    <TextField label="From" value={origin} onChange={setOrigin} maxLength={120} required autoComplete="off"/>
    <SelectField label="How it travels" value={mode} onChange={v=>setMode(v as RouteDto['mode'])} options={modeOptions}/>
    <TextField className="route-departure" label="When it leaves" type="datetime-local" value={departure} onChange={setDeparture} required helper="India Standard Time (IST)."/>
   </div>}
   <div className="t-label-md muted" style={{margin:'16px 0 8px'}}>BAGS{record?'':' TO LOAD'}</div>
   {!candidates.length&&<p className="t-body-sm muted">{selectionsUnavailable?'Bags and bookings could not be loaded. You can plan the trip now and load it later.':record&&data.lots.length?'Every bag is already on a trip.':'No bags yet. You can load them later.'}</p>}
   {candidates.map(l=><DispatchSelection key={l.id} label={`Load the ${cityName(l.destination_key)} bag`} checked={selectedLots.has(l.id)} onChange={v=>toggle(setSelectedLots,l.id,v)} disabled={busy||started}>
    <b className="t-body-sm">{cityName(l.destination_key)}</b><span className="mono t-body-sm">{l.code}</span><span className="muted t-body-sm">{plural(l.active_member_count,'parcel')}</span></DispatchSelection>)}
   {record&&<><div className="u-between" style={{margin:'16px 0 8px',gap:12,flexWrap:'wrap'}}>
    <span className="t-label-md muted">LOOSE PARCELS ({matchingParcels.length+matchingEntries.length} of {physical.length+entries.length})</span>
    <TextField label="Search parcels" value={search} onChange={setSearch} trailing="search" style={{width:'min(100%, 220px)'}}/></div>
    <div className="attach-scroll">
    {!matchingParcels.length&&!matchingEntries.length&&<p className="t-body-sm muted">No parcels match that search.</p>}
    {matchingParcels.map(p=><DispatchSelection key={p.id} label={`Load parcel ${p.docket}`} checked={selectedParcels.has(p.id)} onChange={v=>toggle(setSelectedParcels,p.id,v)} disabled={busy||started}><b className="mono t-body-sm">{p.docket}</b><span>{p.sender.name}</span><span className="muted t-body-sm"> → {p.details?.city||p.destination_key||'Destination not recorded'}</span></DispatchSelection>)}
    {matchingEntries.map(e=><DispatchSelection key={e.id} label={`Plan ${e.data.fields.docket||e.id.slice(0,8)} into this trip`} checked={selectedEntries.has(e.id)} onChange={v=>toggle(setSelectedEntries,e.id,v)} disabled={busy||started}><b className="mono t-body-sm">{e.data.fields.docket||e.id.slice(0,8)}</b><span>{e.data.fields.name||'Customer not recorded'}</span><span className="muted t-body-sm"> → {e.data.fields.destination||'Destination not recorded'} · not booked yet</span></DispatchSelection>)}
   </div></>}
  </fieldset></form>
  {command.phase==='error'&&workflow.current?.hasChanges&&<p role="status">{workflow.current.currentRoute?`${vehicleOf(workflow.current.currentRoute)} is saved.`:'Some changes were saved.'} The rest have not loaded. Finish later, or retry the rest.</p>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(r=>{if(r)saved(r);}).catch(()=>{});}:undefined}/>
 </Dialog>;
}
