import React,{useMemo,useRef,useState} from 'react';
import {canAdminister,type LotDto,type OperatorRole,type RouteDto} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {lots,type LotSource} from '../data-access/lots';
import {routes,type RouteSource} from '../data-access/routes';
import {parcels,type ParcelRead} from '../data-access/parcels';
import {bookingEntries} from '../data-access/booking-entries';
import {payments} from '../data-access/payments';
import {useCommand,useResource,type PagedValue} from './hooks';
import {lotPlan} from './lot-plan';
import {counterBookingRow,type SavedBookingRow} from './SavedBookings';
import {Loading,Failure,CommandNotice} from './AsyncState';
import {PageHeader} from '../components/workspace/Workspace';
import {Button,Checkbox} from '../components/m3/Button';
import {Card,EmptyState} from '../components/m3/Surface';
import {Dialog,ConfirmDialog} from '../components/m3/Dialog';
import {TextField,SelectField,TextArea} from '../components/m3/Input';
import {Msym} from '../components/m3/Icon';
import {formatKolkata} from './format';
import './bags.css';

/**
 * Bags.
 *
 * A bag is a physical sack of parcels going to one city. The word "lot" is a schema word and
 * does not appear on this screen — nobody at a counter says it — and neither do "membership",
 * "candidate" or "archived". The code below still says lot, because the API does.
 *
 * Three things shape the screen.
 *
 * Parcels waiting to be bagged are **destinations to press**, not a list to read. A day's
 * Nashik parcels go into the Nashik bag in one press and one confirm, which is the whole job
 * (G1). Reading a list and ticking twelve boxes was the old way to do the same thing.
 *
 * There are **two states**: Open and Sent. The operator has two. The schema has five, and
 * mapping them onto the screen is this file's work, not the operator's.
 *
 * And a Mumbai parcel going into the Nashik bag is the most expensive mistake available here,
 * so it is possible — sometimes it is genuinely right — but never silent: it takes a
 * confirmation that names both cities.
 */

const terminal=(s:string)=>['delivered','rto','cancelled'].includes(s);
const cityName=(s:string)=>s.replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());
const cityKey=(s:string)=>s.trim().toUpperCase().replaceAll(' ','_');
const date=(s:string)=>formatKolkata(s,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});

/** How long ago, in the words an operator would use rather than a timestamp they must subtract. */
function since(iso:string):string {
  const ms=Date.now()-Date.parse(iso);
  if(!Number.isFinite(ms)||ms<0)return '';
  const minutes=Math.floor(ms/60000);
  if(minutes<1)return 'just now';
  if(minutes<60)return minutes+(minutes===1?' minute ago':' minutes ago');
  const hours=Math.floor(minutes/60);
  if(hours<24)return hours+(hours===1?' hour ago':' hours ago');
  const days=Math.floor(hours/24);
  return days+(days===1?' day ago':' days ago');
}
const STALE_MS=24*60*60*1000;

export async function allLotPages<T>(load:(cursor:string|null)=>Promise<PagedValue<T>>){
 const items:T[]=[],seen=new Set<string>();let cursor:string|null=null;
 do{const page=await load(cursor);items.push(...page.items);cursor=page.page.next_cursor;if(page.page.has_more&&(!cursor||seen.has(cursor)))throw new Error('Invalid pagination');if(cursor)seen.add(cursor);}while(cursor);
 return items;
}

interface LotData {
  lots:LotDto[]; rows:SavedBookingRow[]; routes:RouteDto[];
  routeByLot:Map<string,RouteDto>;
  /** When anything was last put into each bag. Drives the "nothing added since" foot line. */
  lastAdded:Map<string,string>;
}

export default function LotsWorkspace({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>lots(api),[api]),routeSource=useMemo(()=>routes(api),[api]);
 const write=canAdminister(roles,'lots.create')||roles.some(r=>['franchise_admin','operator','dispatcher'].includes(r));
 const canEntries=roles.some(r=>['org_admin','franchise_admin','operator'].includes(r)),canMoney=roles.some(r=>['org_admin','franchise_admin','accountant'].includes(r));
 const data=useResource(api.franchise+'demo-lots',async (signal:AbortSignal):Promise<LotData>=>{
  const [groups,shipments,routeRows,entries]=await Promise.all([
   allLotPages(cursor=>source.list({state:'active',limit:100,cursor},signal)),
   allLotPages(cursor=>parcels(api).list({limit:100,cursor},signal)),
   allLotPages(cursor=>routeSource.list({limit:100,cursor},signal)),
   canEntries?bookingEntries(api).list(signal):Promise.resolve({items:[]}),
  ]);
  const memberPairs=await Promise.all(groups.map(async l=>[l,await allLotPages(cursor=>source.memberships(l.id,{state:'active',limit:100,cursor},signal))] as const));
  const membership=new Map(memberPairs.flatMap(([l,ms])=>ms.map(m=>[m.parcel_id,l] as const)));
  const lastAdded=new Map(memberPairs.flatMap(([l,ms])=>{
   const latest=ms.map(m=>m.started_at).sort().at(-1);
   return latest?[[l.id,latest] as const]:[];
  }));
  const planning=new Map(groups.flatMap(l=>(l.planning_entry_ids??[]).map(id=>[id,l] as const)));
  const balances=new Map(canMoney?await Promise.all([...new Set(shipments.map(p=>p.booking_id))].map(async id=>[id,await payments(api,id).read(signal)] as const)):[]);
  const routeByLot=new Map<string,RouteDto>();
  for(const route of routeRows.filter(r=>r.state!=='archived')){
   const items=await allLotPages(cursor=>routeSource.manifest(route.id,undefined,{limit:100,cursor},signal));
   for(const item of items)for(const s of item.sources)if(s.kind==='lot')routeByLot.set(s.lot_id,route);
  }
  return {lots:groups,routes:routeRows,routeByLot,lastAdded,rows:[
   ...entries.items.map(e=>{const row=counterBookingRow(e),l=planning.get(e.id);return {...row,lotId:l?.id??null,lotCode:l?.code??''};}),
   ...shipments.map((p:ParcelRead):SavedBookingRow=>{const l=membership.get(p.id),balance=balances.get(p.booking_id);return {id:'parcel:'+p.id,docket:p.docket,name:p.sender.name,phone:p.sender.phone_display,city:cityName(p.destination_key||p.details?.city||l?.destination_key||''),address:p.recipient.address,service:'—',weight:p.weight_grams/1000,amount:balance?.gross_paise??null,payment:balance?(balance.outstanding_paise===0?'paid':'topay'):'unknown',status:p.status,createdAt:Date.parse(p.confirmed_at),lotId:l?.id??null,lotCode:l?.code??'',parcel:p};}),
  ]};
 });

 const [create,setCreate]=useState<{destination:string}|null>(null);
 const [add,setAdd]=useState<{lot:LotDto;preselect:string[]}|null>(null);
 const [seal,setSeal]=useState<LotDto|null>(null);
 const [remove,setRemove]=useState<LotDto|null>(null);
 const [message,setMessage]=useState<LotDto|null>(null);
 const [notice,setNotice]=useState('');
 const archive=useCommand<LotDto|import('@shippingco/shared').LotMembershipResult>(value=>source.execute(value)),busy=archive.phase==='pending'||archive.phase==='uncertain';
 async function deleted(){setRemove(null);data.reload();setNotice('Bag deleted. The parcels inside it are waiting to be bagged again.');}
 const value=data.value??{lots:[],rows:[],routes:[],routeByLot:new Map<string,RouteDto>(),lastAdded:new Map<string,string>()};

 const held=(lot:LotDto)=>value.rows.filter(r=>r.lotId===lot.id);
 const open=value.lots.filter(l=>!value.routeByLot.get(l.id));
 const sent=value.lots.filter(l=>value.routeByLot.get(l.id));

 // Parcels checked in at this branch and not in any bag, counted by where they are going.
 // These are the chips: a destination is a press, not a search followed by twelve ticks.
 const waiting=value.rows.filter(r=>r.parcel&&!r.lotId&&r.parcel.status==='checked_in');
 const waitingBy=[...waiting.reduce((map,row)=>{
   const key=row.city||'Destination not recorded';
   map.set(key,[...(map.get(key)??[]),row]);
   return map;
 },new Map<string,SavedBookingRow[]>())].sort((a,b)=>b[1].length-a[1].length);

 /** A pressed destination lands in that city's open bag, with those parcels already ticked. */
 function pressDestination(city:string,rows:SavedBookingRow[]){
   const existing=open.find(l=>cityKey(l.destination_key)===cityKey(city));
   if(existing)setAdd({lot:existing,preselect:rows.map(r=>r.id)});
   else setCreate({destination:city});
 }

 return <div className="page live-lots bags">
  <PageHeader title="Bags" description="A bag is one sack of parcels going to one city."
    actions={write&&<Button icon="add" onClick={()=>setCreate({destination:''})}>Start a bag</Button>}/>
  {data.phase==='loading'&&<Loading label="Loading bags…"/>}
  {data.phase==='error'&&<Failure label="Bags and waiting parcels could not be loaded. You can still start a bag and add parcels later." retry={data.reload}/>}
  {notice&&<p role="status">{notice}</p>}

  {waitingBy.length>0&&<section aria-labelledby="bags-waiting" className="bags-waiting">
   <h2 id="bags-waiting" className="t-title-sec">Waiting to be bagged</h2>
   <p className="t-body-sm muted">{waiting.length} {waiting.length===1?'parcel is':'parcels are'} checked in with no bag. Press a city to put all of its parcels in that city&rsquo;s bag.</p>
   <ul className="bag-chips">
    {waitingBy.map(([city,rows])=><li key={city}>
     <button type="button" className="bag-chip" disabled={!write}
       aria-label={city+', '+rows.length+(rows.length===1?' parcel':' parcels')}
       onClick={()=>pressDestination(city,rows)}>
      <Msym name="pin_drop"/><span>{city}</span><b>{rows.length}</b>
     </button>
    </li>)}
   </ul>
  </section>}

  {open.length>0&&<section aria-labelledby="bags-open">
   <h2 id="bags-open" className="t-title-sec">Open</h2>
   <div className="grid3">{open.map(lot=>{
    const rows=held(lot),parcelRows=rows.filter(r=>r.parcel),planned=rows.filter(r=>!r.parcel);
    const knownWeight=parcelRows.every(r=>r.weight!==null);
    const weight=parcelRows.reduce((sum,r)=>sum+(r.weight??0),0);
    const age=Date.now()-Date.parse(lot.created_at);
    const stale=Number.isFinite(age)&&age>STALE_MS;
    const added=value.lastAdded.get(lot.id);
    return <Card key={lot.id} className="bag-card">
     <div className="bag-head">
      <span className="bag-icon"><Msym name="inventory_2" size={28}/></span>
      <div className="u-grow">
       <div className="bag-city">{cityName(lot.destination_key)}</div>
       <div className="bag-code mono">{lot.code}</div>
      </div>
      {/* A nudge, never a block: an old bag is usually a forgotten bag. */}
      {stale&&<span className="bag-stale">Open {since(lot.created_at).replace(' ago','')}</span>}
     </div>
     <div className="bag-figs">
      <div><span className="bag-fig">{parcelRows.length}</span><span className="bag-fig-l">{parcelRows.length===1?'parcel':'parcels'}</span></div>
      <div><span className="bag-fig">{knownWeight?weight.toFixed(1):'—'}</span><span className="bag-fig-l">kg</span></div>
      <div><span className="bag-fig">{since(lot.created_at).replace(' ago','')}</span><span className="bag-fig-l">open</span></div>
     </div>
     {planned.length>0&&<p className="t-body-sm muted">{planned.length} planned, not booked yet</p>}
     <p className="bag-foot">{added?'Last parcel added '+since(added)+'.':'Nothing has been put in this bag yet.'}</p>
     {lot.note&&<p className="t-body-sm muted">{lot.note}</p>}
     <div className="bag-actions">
      {write&&<Button size="sm" variant="outlined" icon="playlist_add" onClick={()=>setAdd({lot,preselect:[]})}>Add parcels</Button>}
      <Button size="sm" variant="outlined" icon="forward_to_inbox" disabled={!rows.filter(r=>!terminal(r.status)).length} onClick={()=>setMessage(lot)}>Message{rows.filter(r=>!terminal(r.status)).length?` ${rows.filter(r=>!terminal(r.status)).length}`:''}</Button>
      {/* The only filled button on a bag. Everything else here is a step towards it. */}
      {write&&<Button size="sm" icon="local_shipping" disabled={!parcelRows.length} onClick={()=>setSeal(lot)}>Seal and send this bag</Button>}
     </div>
     {write&&canAdminister(roles,'lots.create')&&<button type="button" className="bag-delete" onClick={()=>{archive.reset();setRemove(lot);}}>Delete this bag</button>}
    </Card>;
   })}</div>
  </section>}

  {sent.length>0&&<section aria-labelledby="bags-sent">
   <h2 id="bags-sent" className="t-title-sec">Sent</h2>
   <div className="grid3">{sent.map(lot=>{
    const rows=held(lot).filter(r=>r.parcel);
    const route=value.routeByLot.get(lot.id)!;
    const knownWeight=rows.every(r=>r.weight!==null),weight=rows.reduce((sum,r)=>sum+(r.weight??0),0);
    return <Card key={lot.id} className="bag-card is-sent">
     <div className="bag-head">
      <span className="bag-icon"><Msym name="local_shipping" size={28}/></span>
      <div className="u-grow">
       <div className="bag-city">{cityName(lot.destination_key)}</div>
       <div className="bag-code mono">{lot.code}</div>
      </div>
     </div>
     <p className="bag-trip"><Msym name="pin_drop"/><span>On <b className="mono">{route.carrier_code||route.mode.toUpperCase()}</b> to {route.destination} · {date(route.scheduled_departure_at)}</span></p>
     <div className="bag-figs">
      <div><span className="bag-fig">{rows.length}</span><span className="bag-fig-l">{rows.length===1?'parcel':'parcels'}</span></div>
      <div><span className="bag-fig">{knownWeight?weight.toFixed(1):'—'}</span><span className="bag-fig-l">kg</span></div>
     </div>
     <div className="bag-actions">
      <Button size="sm" variant="outlined" icon="forward_to_inbox" disabled={!held(lot).filter(r=>!terminal(r.status)).length} onClick={()=>setMessage(lot)}>Message{held(lot).filter(r=>!terminal(r.status)).length?` ${held(lot).filter(r=>!terminal(r.status)).length}`:''}</Button>
     </div>
    </Card>;
   })}</div>
  </section>}

  {data.phase==='ready'&&!value.lots.length&&<Card variant="outlined"><EmptyState icon="inventory_2" title="No bags yet" sub="A bag holds the parcels going to one city. Start one, put today's parcels in, then send it on a trip." action={write?<Button icon="add" style={{marginTop:12}} onClick={()=>setCreate({destination:''})}>Start your first bag</Button>:undefined}/></Card>}

  {(create||add)&&<BagEditor source={source} routeSource={routeSource} data={value}
    lot={add?.lot} preselect={add?.preselect??[]} startDestination={create?.destination??''}
    selectionsUnavailable={data.phase==='error'}
    close={()=>{setCreate(null);setAdd(null);data.reload();}}
    saved={(lot,n)=>{setCreate(null);setAdd(null);data.reload();setNotice(`${cityName(lot.destination_key)} bag saved with ${n} parcel${n===1?'':'s'}.`);}}/>}

  {seal&&<SealBag routeSource={routeSource} data={value} lot={seal}
    close={()=>setSeal(null)}
    sent={route=>{setSeal(null);data.reload();setNotice(`Bag sealed and put on ${route}.`);}}/>}

  {/* R-12: a bag with parcels in it cannot be deleted. A parcel is never stranded in a
      closed container, so the refusal names the count and offers the way out. */}
  <ConfirmDialog open={!!remove&&held(remove).length===0} onClose={()=>{if(!busy)setRemove(null);}} danger
    title={remove?`Delete the ${cityName(remove.destination_key)} bag?`:''}
    body="This bag is empty. Deleting it removes it from the screen; its history stays saved."
    confirmLabel="Delete this bag"
    onConfirm={()=>{if(remove&&!busy)void archive.run(source.intent({kind:'archive',lotId:remove.id,body:{expected_version:remove.version}})).then(deleted).catch(()=>{});}}/>
  <Dialog open={!!remove&&held(remove).length>0} onClose={()=>setRemove(null)}
    title={remove?`The ${cityName(remove.destination_key)} bag still has parcels in it`:''}
    actions={<><Button variant="text" onClick={()=>setRemove(null)}>Close</Button>
      {remove&&<Button onClick={()=>{const lot=remove;setRemove(null);setAdd({lot,preselect:[]});}}>Open the bag</Button>}</>}>
   <p>{remove?held(remove).length:0} {remove&&held(remove).length===1?'parcel is':'parcels are'} in this bag. Take them out first — a parcel must never be left inside a bag that is gone.</p>
  </Dialog>

  {message&&<BagMessage source={source} lot={message} count={value.rows.filter(r=>r.lotId===message.id&&!terminal(r.status)).length} close={()=>setMessage(null)}/>}
  <CommandNotice phase={archive.phase} code={archive.error?.code} retry={archive.canRetry?()=>{void archive.retry().then(deleted).catch(()=>{});}:undefined}/>
 </div>;
}

/**
 * Starting a bag, and putting parcels into it.
 *
 * Starting one asks a single question — which city — and names the bag itself. An operator who
 * has to invent a name for a sack will invent "aaa".
 *
 * The parcel list is the bag's own city by default. Parcels going somewhere else are behind a
 * disclosure, and ticking one asks a question that names both cities, because that is the
 * mistake this screen exists to prevent.
 */
function BagEditor({source,routeSource,data,lot,preselect,startDestination,selectionsUnavailable,close,saved}:{
  source:LotSource;routeSource:RouteSource;data:LotData;lot?:LotDto;preselect:string[];startDestination:string;
  selectionsUnavailable?:boolean;close:()=>void;saved:(lot:LotDto,count:number)=>void;
}){
 const loose=data.rows.filter(r=>!terminal(r.status)&&(lot?r.lotId!==lot.id:!r.lotId));
 const destinations=[...new Set(loose.map(r=>r.city).filter(Boolean))];
 const [city,setCity]=useState(lot?cityName(lot.destination_key):(startDestination||destinations[0]||''));
 const [note,setNote]=useState(lot?.note??'');
 const [picked,setPicked]=useState<Set<string>>(()=>new Set(
   preselect.length?preselect:lot?[]:loose.filter(r=>r.city===(startDestination||destinations[0])).map(r=>r.id)));
 const [elsewhere,setElsewhere]=useState<SavedBookingRow|null>(null);
 const plan=useRef<ReturnType<typeof lotPlan>|null>(null);
 const command=useCommand<LotDto>(()=>plan.current!.execute()),busy=command.phase==='pending'||command.phase==='uncertain',started=plan.current!==null;
 const selected=loose.filter(r=>picked.has(r.id));
 const bagCity=lot?cityName(lot.destination_key):city;
 const knownWeight=selected.every(r=>r.weight!==null),weight=selected.reduce((s,r)=>s+(r.weight??0),0);

 const set=(id:string,on:boolean)=>setPicked(s=>{const n=new Set(s);if(on)n.add(id);else n.delete(id);return n;});
 function toggle(row:SavedBookingRow,on:boolean){
  if(started)return;
  // R-8. Allowed, and never silent.
  if(on&&row.city&&bagCity&&cityKey(row.city)!==cityKey(bagCity)){setElsewhere(row);return;}
  set(row.id,on);
 }
 function choose(next:string){
  setCity(next);
  setPicked(new Set(loose.filter(r=>r.city===next).map(r=>r.id)));
 }
 async function submit(){
  const name=`${cityName(cityKey(bagCity))} · ${formatKolkata(new Date().toISOString(),{day:'numeric',month:'short'})}`;
  if(!plan.current)plan.current=lotPlan({lots:source,routes:routeSource,lot,
    attachedRouteId:lot?data.routeByLot.get(lot.id)?.id:undefined,
    planningSources:data.lots.filter(l=>l.id!==lot?.id&&(l.planning_entry_ids??[]).some(id=>selected.some(r=>r.entry?.id===id))),
    name:lot?lot.name:name,destination:cityKey(bagCity),note,
    entries:selected.flatMap(r=>r.entry?[r.entry.id]:[]),parcels:selected.flatMap(r=>r.parcel?[r.parcel.id]:[]),routeId:''});
  try{const result=await command.run(source.intent({kind:'create',body:{name:lot?lot.name:name,destination_key:cityKey(bagCity)}}));saved(result,selected.length);}
  catch{/* confirmed progress stays in the plan for an exact retry */}
 }
 const sameCity=loose.filter(r=>!bagCity||cityKey(r.city||'')===cityKey(bagCity));
 const otherCity=loose.filter(r=>bagCity&&cityKey(r.city||'')!==cityKey(bagCity));
 const list=(items:SavedBookingRow[])=><ul className="bagpick-list">{items.map(r=><li key={r.id}>
   <Checkbox checked={picked.has(r.id)} onChange={v=>toggle(r,v)} ariaLabel={`Put ${r.docket} in this bag`} label=""/>
   <span className="mono bagpick-dk">{r.docket}</span>
   <span className="u-grow u-truncate">{r.name}</span>
   <span className="bagpick-to">{r.city||'Destination not recorded'}</span>
   <span className="bagpick-w">{r.weight===null?'—':r.weight+' kg'}</span>
  </li>)}</ul>;

 return <Dialog open size="lg" hideClose={busy} onClose={()=>{if(!busy)close();}}
   title={lot?`Add parcels to the ${cityName(lot.destination_key)} bag`:'Start a bag'}
   actions={<><Button variant="text" disabled={busy} onClick={close}>{started&&command.phase==='error'?'Finish later':'Cancel'}</Button>
     <Button disabled={busy||(lot?!selected.length:!bagCity.trim()||!/^[A-Z][A-Z0-9_]{0,31}$/.test(cityKey(bagCity)))} onClick={()=>{void submit();}}>
       {started?'Retry the rest':lot?`Put ${selected.length} in the bag`:selected.length?`Start it with ${selected.length} parcel${selected.length===1?'':'s'}`:'Start the bag'}</Button></>}>
  <>
   <fieldset disabled={busy||started} className="bag-editor-fields">
    {!lot&&<>
     <span className="field-legend">Where is this bag going?</span>
     {destinations.length>0&&<ul className="bag-chips" style={{marginTop:8}}>
      {destinations.map(d=><li key={d}><button type="button" className={`bag-chip${cityKey(city)===cityKey(d)?' on':''}`} aria-pressed={cityKey(city)===cityKey(d)} onClick={()=>choose(d)}>
       <span>{d}</span><b>{loose.filter(r=>r.city===d).length}</b></button></li>)}
     </ul>}
     <div className="form-grid" style={{marginTop:4}}>
      <TextField label="City" value={city} onChange={choose} maxLength={32} required helper="Choose one above, or type a city. The bag is named for you."/>
      <TextField label="Note for your staff" className="span2" value={note} onChange={setNote} maxLength={1000}/>
     </div>
    </>}
    {!loose.length&&<p role="status" className="t-body-sm muted">{selectionsUnavailable?'Waiting parcels could not be loaded. Start this bag now and put parcels in later.':'No parcels are waiting. You can start this bag now and put parcels in later.'}</p>}
    <div className="bagpick">
     <div className="bagpick-head">
      <span className="field-legend">Parcels for {bagCity||'this bag'}</span>
      <button type="button" className="bagpick-all" onClick={()=>setPicked(new Set(sameCity.map(r=>r.id)))}>Tick all {sameCity.length}</button>
     </div>
     {list(sameCity)}
     {otherCity.length>0&&<details className="bagpick-more">
      <summary>Parcels going somewhere else ({otherCity.length})</summary>
      {list(otherCity)}
     </details>}
    </div>
   </fieldset>
   <div className="bagsum"><span><b>{selected.length}</b> parcels</span><span><b>{knownWeight?weight.toFixed(1):'—'}</b> kg</span></div>
   {command.phase==='error'&&plan.current?.hasChanges&&<p role="status">{plan.current.currentLot?`The ${cityName(plan.current.currentLot.destination_key)} bag is saved.`:'Some parcels were moved.'} The rest have not. Finish later, or retry the rest.</p>}
   <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(result=>{if(result)saved(result,selected.length);}).catch(()=>{});}:undefined}/>
   <ConfirmDialog open={!!elsewhere} onClose={()=>setElsewhere(null)}
     title={elsewhere?`${elsewhere.docket} is going to ${elsewhere.city}, not ${bagCity}`:''}
     body={elsewhere?`Putting a ${elsewhere.city} parcel in the ${bagCity} bag is allowed, and sometimes it is right. It will travel to ${bagCity} first. Only do this if that is what you mean.`:''}
     confirmLabel={elsewhere?`Put it in the ${bagCity} bag anyway`:''}
     onConfirm={()=>{if(elsewhere)set(elsewhere.id,true);setElsewhere(null);}}/>
  </>
 </Dialog>;
}

/**
 * Sealing a bag and putting it on a trip.
 *
 * The confirmation names what is in the sack — how many parcels and how heavy — because that
 * is what the operator is holding and what they will be asked about if it goes missing. It
 * also says plainly that nothing further goes in, since the next thing that happens to this
 * bag is that somebody ties it shut.
 */
function SealBag({routeSource,data,lot,close,sent}:{
  routeSource:RouteSource;data:LotData;lot:LotDto;close:()=>void;sent:(route:string)=>void;
}){
 const rows=data.rows.filter(r=>r.lotId===lot.id&&r.parcel);
 const knownWeight=rows.every(r=>r.weight!==null),weight=rows.reduce((s,r)=>s+(r.weight??0),0);
 const trips=data.routes.filter(r=>r.state==='planning')
   .sort((a,b)=>Number(cityKey(b.destination)===cityKey(lot.destination_key))-Number(cityKey(a.destination)===cityKey(lot.destination_key)));
 const [routeId,setRouteId]=useState(trips[0]?.id??'');
 const trip=trips.find(r=>r.id===routeId);
 const command=useCommand<unknown>(intent=>routeSource.execute(intent));
 const busy=command.phase==='pending'||command.phase==='uncertain';
 const [reading,setReading]=useState(false);
 const tripName=()=>trip?(trip.carrier_code||trip.mode.toUpperCase()):'the trip';
 async function sealAndSend(){
   if(busy||reading||!routeId)return;
   setReading(true);
   try{
     const route=await routeSource.read(routeId);
     await command.run(routeSource.intent({kind:'attach_lot',routeId:route.id,body:{expected_version:route.version,lot_id:lot.id}}));
     sent(tripName());
   }catch{/* the notice owns the failure, and the intent is kept for an exact retry */}
   finally{setReading(false);}
 }
 return <Dialog open hideClose={busy} onClose={()=>{if(!busy)close();}}
   title={`Seal the ${cityName(lot.destination_key)} bag?`}
   actions={<><Button variant="text" disabled={busy} onClick={close}>Cancel</Button>
     <Button disabled={busy||reading||!routeId} onClick={()=>{void sealAndSend();}}>Seal and send</Button></>}>
  <p className="bag-seal-figures"><b>{rows.length}</b> {rows.length===1?'parcel':'parcels'} · <b>{knownWeight?weight.toFixed(1):'—'}</b> kg</p>
  <p>Once it is on a trip, nothing further goes in this bag. Check the sack against the count above before you seal it.</p>
  {trips.length===0
    ? <p role="alert">There is no trip to put it on yet. Create one in Trips, then come back.</p>
    : <SelectField label="Which trip" value={routeId} onChange={setRouteId} disabled={busy}
        options={trips.map(r=>({value:r.id,label:`${r.carrier_code||r.mode.toUpperCase()} · ${r.origin} → ${r.destination} · ${date(r.scheduled_departure_at)}`}))}/>}
  <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(()=>sent(tripName())).catch(()=>{});}:undefined}/>
 </Dialog>;
}

function BagMessage({source,lot,count,close}:{source:LotSource;lot:LotDto;count:number;close:()=>void}){
 const [text,setText]=useState('');
 const command=useCommand(intent=>source.sendMessage(intent)),busy=command.phase==='pending'||command.phase==='uncertain';
 const result=command.result;
 return <Dialog open onClose={()=>{if(!busy)close();}} hideClose={busy} title={`Message the ${cityName(lot.destination_key)} bag`}
   actions={<><Button variant="text" disabled={busy} onClick={close}>{result?'Done':'Cancel'}</Button>
     {!result&&<Button disabled={busy||!text.trim()} onClick={()=>{void command.run(source.messageIntent(lot.id,text)).catch(()=>{});}}>Send to everyone in this bag</Button>}</>}>
  <p className="t-body-sm muted" style={{marginBottom:12}}>{count} customer{count===1?'':'s'} in this bag. Whether it arrives depends on WhatsApp setup and each customer&rsquo;s consent.</p>
  <TextArea label="Message" value={text} onChange={setText} rows={3} placeholder="Your parcel reaches Mumbai hub tonight at 11 PM…"/>
  {result?<p role="status">{result.queued} queued · {result.suppressed} suppressed by messaging policy · {result.failed} failed · {result.unavailable} planning entries without verified customer records. Queued does not mean delivered.</p>
    :<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().catch(()=>{});}:undefined}/>}
  {command.phase==='error'&&command.error?.code==='TEMPORARILY_UNAVAILABLE'&&<p>Check the server&rsquo;s WhatsApp configuration and validated installation before trying again.</p>}
 </Dialog>;
}
