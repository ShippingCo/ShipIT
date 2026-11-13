import {FilterChips,SearchBar} from '../components/m3/Controls';
import {CancelBooking} from './CancelBooking';
import {OperationDialog} from '../components/workspace/OperationDialog';
import {PageHeader,RecordTable,SectionHeader,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister,MAX_BULK_PARCELS} from '@shippingco/shared';
import {useDetailReturn} from './detail-return';
import {businessDay,dayStart,shiftDay} from './business-dates';
import {useSearchParams,Link} from 'react-router-dom';
import React,{useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type { BulkParcelAction,BulkParcelItem,LotDto,LotMembershipResult,OperatorRole,ParcelTransitionDto,PaymentProjection } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { parcels,parcelStatuses,type ParcelRead,type ParcelStatus,type ParcelCommand,type ParcelListFilter } from '../data-access/parcels';
import { lots } from '../data-access/lots';
import { payments } from '../data-access/payments';
import { deliveries } from '../data-access/deliveries';
import { createParcelBulkController } from '../data-access/parcel-bulk-controller';
import { BulkParcelPanel } from '../parcels/BulkParcelPanel';
import { useCommand,usePagedResource,useResource } from './hooks';
import { CommandNotice,DataRefresh,Empty,Failure,Loading } from './AsyncState';
import { formatKolkata,formatMoney } from './format';
import { TextField, DateField,SelectField } from '../components/m3/Input';
import { Msym } from '../components/m3/Icon';
import {DatePresets} from './DatePresets';
import {SavedBookings} from './SavedBookings';
import {HubPlacePicker} from './HubPlacePicker';
import {mintEventRef,type HubPlace} from './hub-places';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const has=(roles:readonly OperatorRole[],...wanted:OperatorRole[])=>(wanted.some(role=>role!=='delivery_agent'&&role!=='org_admin')&&canAdminister(roles,'parcels.read'))||roles.some(role=>wanted.includes(role));
const parcelTones={booked:'neutral',checked_in:'info',dispatched:'info',in_transit:'info',out_for_delivery:'info',failed_attempt:'warning',held_at_office:'warning',delivered:'success',rto:'warning',cancelled:'neutral'} as const;
const statusOptions=[{value:'',label:'All statuses'},...parcelStatuses.map(value=>({value,label:value.replaceAll('_',' ')}))];

export function OperationalPackages({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]);
 const [params,setParams]=useSearchParams();
 const [cancelling,setCancelling]=useState<ParcelRead|null>(null);
 const canCancel=roles.includes('operator')||canAdminister(roles,'bookings.cancel');
 const customer=params.get('customer_id')??'';
 const [destination,setDestination]=useState(''),[from,setFrom]=useState(params.get('booked')==='today'?businessDay():''),[to,setTo]=useState(params.get('booked')==='today'?businessDay():'');
 const requestedStatus=params.get('status')??params.get('filter')??'';
 const initialStatus=parcelStatuses.includes(requestedStatus as ParcelStatus)?requestedStatus:'';
 const [docket,setDocket]=useState(''),[status,setStatus]=useState(initialStatus),[query,setQuery]=useState({docket:'',status:initialStatus,destination:'',from,to});
 const [filterError,setFilterError]=useState(''),[sort,setSort]=useState<NonNullable<ParcelListFilter['sort']>>('created_at_desc');
 const filterPanel=useRef<HTMLDetailsElement>(null);
 const key=JSON.stringify({...query,customer,sort});const page=usePagedResource(key,(cursor,signal)=>source.list({customer_id:customer||undefined,destination_key:query.destination||undefined,from:query.from?dayStart(query.from):undefined,to:query.to?dayStart(shiftDay(query.to,1)):undefined,docket:query.docket||undefined,status:query.status as ParcelStatus||undefined,sort,limit:50,cursor},signal));
 const selected=params.get('parcel'),remember=useDetailReturn(selected);
 const setSelected=(id:string|null)=>{const next=new URLSearchParams(params);if(id)next.set('parcel',id);else next.delete('parcel');setParams(next);};
 const select=(id:string)=>{remember();setSelected(id);};
 const clearFilters=()=>{setDocket('');setStatus('');setDestination('');setFrom('');setTo('');setFilterError('');setQuery({docket:'',status:'',destination:'',from:'',to:''});const next=new URLSearchParams(params);next.delete('customer_id');next.delete('booked');next.delete('status');next.delete('filter');setParams(next);};
 const hasFilters=Object.values(query).some(Boolean)||Boolean(customer);
 const appliedFilters=[query.docket&&`Tracking ${query.docket}`,customer&&'Selected customer',query.status&&query.status.replaceAll('_',' '),query.destination,query.from&&`From ${query.from}`,query.to&&`Through ${query.to}`].filter(Boolean);
 const canBook=canAdminister(roles,'bookings.create')||roles.includes('operator');
 return <div className="ops-page logistics-workspace reference-logistics">
  <PageHeader title="Packages" eyebrow="Parcel tracking" actions={canBook&&<Link className="btn btn-filled" to="/business/new-booking"><Msym name="add"/>New booking</Link>}/>
  <form className="logistics-search" noValidate onSubmit={event=>{event.preventDefault();if(from&&to&&from>to){setFilterError('Choose an end date on or after the start date.');if(filterPanel.current)filterPanel.current.open=true;document.getElementById('packages-booked-through')?.focus();return;}setFilterError('');setQuery({docket:docket.trim(),status,destination:destination.trim().toUpperCase(),from,to});setSelected(null);}} aria-label="Package filters">
   <div className="logistics-search-primary"><SearchBar label="Tracking number" placeholder="Full tracking number" value={docket} onChange={setDocket} shortcut="/"/><button className="btn btn-filled"><Msym name="search"/>Search</button></div>
   <details className="logistics-filter-disclosure" ref={filterPanel}><summary><Msym name="tune"/>Filters{appliedFilters.length>0&&<span className="logistics-filter-count">{appliedFilters.length} applied</span>}</summary><div className="logistics-package-filters">
    <SelectField label="Parcel status" value={status} onChange={setStatus} options={statusOptions}/>
    <TextField label="Destination city / routing key" value={destination} onChange={value=>setDestination(value.toUpperCase())} autoCapitalize="characters" spellCheck={false} maxLength={32} helper="Rate-card destination, for example MUMBAI."/>
    <DateField label="Booked from (Asia/Kolkata)" value={from} onChange={value=>{setFrom(value);setFilterError('');}}/><DateField id="packages-booked-through" label="Booked through (Asia/Kolkata)" value={to} onChange={value=>{setTo(value);setFilterError('');}} min={from||undefined} error={filterError||undefined}/>
    <div className="logistics-filter-actions"><DatePresets change={(start,end)=>{setFrom(start);setTo(end);}}/><button className="btn btn-outlined">Apply filters</button></div>
   </div></details>
   <div className="logistics-applied-filters" aria-live="polite"><span>{appliedFilters.length?appliedFilters.join(' · '):'All dates and statuses'}</span>{hasFilters&&<button type="button" className="btn btn-text" onClick={clearFilters}>Clear</button>}</div>
   {filterError&&<p className="ops-alert" role="alert">{filterError}</p>}
  </form>
  <FilterChips options={[{value:'',label:'All'},{value:'booked',label:'Booked'},{value:'checked_in',label:'At hub'},{value:'out_for_delivery',label:'Out for delivery'},{value:'failed_attempt',label:'Needs follow-up'},{value:'delivered',label:'Delivered'},{value:'rto',label:'Returned'},{value:'cancelled',label:'Cancelled'},...(['dispatched','in_transit','held_at_office'].includes(query.status)?[{value:query.status,label:query.status.replaceAll('_',' ')}]:[])]} value={query.status} onChange={value=>{setStatus(value);setQuery(previous=>({...previous,status:value}));setSelected(null);}}/>
  {page.phase==='loading'&&!page.items.length?<Loading label="Loading parcels…"/>:page.phase==='error'?<Failure retry={page.reload} label="Parcels could not be loaded."/>:page.phase==='empty'?<Empty icon="inventory_2" title={hasFilters?"No parcels match":"No parcels yet"} body={hasFilters?"Try another docket number or clear the filters to see all parcels in this branch.":(canAdminister(roles,'bookings.create')||roles.includes('operator'))?"Create your first booking to start tracking parcels here.":"Parcels appear here after your team creates a booking."} action={hasFilters?<button type="button" className="btn btn-outlined" onClick={clearFilters}>Clear filters</button>:(canAdminister(roles,'bookings.create')||roles.includes('operator'))?<Link className="btn btn-filled" to="/business/new-booking">Create a booking</Link>:undefined}/>:<>
   <section className="card ops-card logistics-records reference-package-table"><SectionHeader title="Booked parcels" description={`${page.items.length} ${page.items.length===1?'package':'packages'} loaded${page.page.has_more?' · more available':''}`} actions={<><SelectField label="Sort packages" value={sort} onChange={value=>{setSort(value as typeof sort);setSelected(null);}} options={[{value:'created_at_desc',label:'Newest first'},{value:'created_at_asc',label:'Oldest first'},{value:'docket_asc',label:'Tracking A–Z'},{value:'docket_desc',label:'Tracking Z–A'}]}/><DataRefresh resource={page}/></>}/>
    <RecordTable mobile="stack" label="Packages" rows={page.items} rowKey={item=>item.id} selectedKey={selected} columns={[
     {key:'docket',label:'Tracking number',cell:item=><strong className="ops-mono">{item.docket}</strong>},
     {key:'customer',label:'Customer',cell:item=><div className="record-identity"><strong>{item.sender.name}</strong><span>{item.sender.phone_display}</span></div>},
     {key:'destination',label:'To',cell:item=>item.details?.city??'Not recorded'},
     {key:'status',label:'Status',cell:item=><StatusBadge tone={parcelTones[item.status]}>{item.status.replaceAll('_',' ')}</StatusBadge>},
     {key:'weight',label:'Weight',align:'right',cell:item=>item.weight_grams.toLocaleString('en-IN')+' g'},
     {key:'confirmed',label:'Confirmed',cell:item=>formatKolkata(item.confirmed_at)},
     {key:'actions',label:'Actions',className:'record-actions',cell:item=><><button className="btn btn-text" onClick={()=>select(item.id)}>Open</button>{canCancel&&item.status==='booked'&&<button type="button" className="btn btn-text" onClick={()=>setCancelling(item)}>Cancel booking</button>}</>},
    ]}/>
    {page.page.has_more&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={()=>page.loadMore()}>{page.phase==='more'?'Loading…':'Load next page'}</button>}
    <p className="ops-note">Open a parcel for its lot, timeline, booking balance and available actions.</p>
   </section>
   <details className="logistics-extra-work"><summary>Update several parcels</summary><PackageBulk controller={controller} source={source} rows={page.items} reload={page.reload}/></details>
  </>}
  {cancelling&&<CancelBooking api={api} bookingId={cancelling.booking_id} docket={cancelling.docket} close={()=>setCancelling(null)} refresh={page.reload} canReviewCharges={roles.includes('operator')||roles.includes('accountant')||canAdminister(roles,'bookings.cancel')}/>}
  {selected&&<PackageDetail key={selected} controller={controller} roles={roles} parcelId={selected} close={()=>setSelected(null)} refreshed={page.reload}/>}
 </div>;
}

function PackageBulk({controller,source,rows,reload,initialAction='check_in',onBusyChange}:{controller:ScopeController;source:ReturnType<typeof parcels>;rows:ParcelRead[];reload:()=>void;initialAction?:BulkParcelAction;onBusyChange?:(busy:boolean)=>void}){
 const [action]=useState<BulkParcelAction>(initialAction);
 // Checking a parcel in needs a hub and a reference for the event. The hub is chosen
 // by name (see hub-places.ts); the reference is minted here, because it identifies
 // THIS check-in and there is nothing for the operator to look it up in. It is kept
 // stable across re-renders so a retry carries the same reference as its first try.
 const [place,setPlace]=useState<HubPlace|null>(null);
 const [manifest,setManifest]=useState('');
 const [evidence,setEvidence]=useState(()=>mintEventRef());
 const context=action==='check_in'?(place?.id??''):manifest;
 const bulk=useMemo(()=>createParcelBulkController(controller),[controller]);useEffect(()=>()=>bulk.dispose(),[bulk]);
 const state=useSyncExternalStore(bulk.subscribe,bulk.snapshot),last=useRef(0);
 useEffect(()=>{onBusyChange?.(state.phase==='pending'||state.phase==='uncertain');},[state.phase,onBusyChange]);
 useEffect(()=>{if(state.phase==='confirmed'&&state.result&&state.result.summary.succeeded!==last.current){last.current=state.result.summary.succeeded;reload();}},[state.phase,state.result,reload]);
 const keys=useRef(new Map<string,string>()),valid=uuid.test(evidence)&&uuid.test(context);
 const busyNow=state.phase==='pending'||state.phase==='uncertain';
 const candidates=useMemo(()=>rows.filter(row=>row.status===(action==='check_in'?'booked':'checked_in')).map(row=>{
  const command=action==='check_in'?{expected_version:row.version,evidence_ref:evidence,location_ref:context}:{expected_version:row.version,evidence_ref:evidence,manifest_id:context};
  const signature=JSON.stringify([action,row.id,command]);let key=keys.current.get(signature);if(!key){key=crypto.randomUUID();keys.current.set(signature,key);}
  return {label:`${row.docket} · version ${row.version}`,item:{parcel_id:row.id,idempotency_key:key,command} as BulkParcelItem};
 }),[rows,action,evidence,context]);
 // The operator already ticked these parcels in the list; asking them to tick the
 // same rows again in the panel was the flow's worst dead end. Everything eligible
 // starts selected, and the checkboxes are there to take one back out.
 useEffect(()=>{bulk.select(candidates.slice(0,MAX_BULK_PARCELS).map(candidate=>candidate.item));},[bulk,candidates]);
 // A new reference for a new kind of update: a dispatch must not be recorded under
 // the reference a check-in already used.
 useEffect(()=>{setEvidence(mintEventRef());},[action]);
 const checkIn=action==='check_in';
 const inDialog=Boolean(onBusyChange);
 return <section className="ops-detail logistics-bulk"
   {...(inDialog?{'aria-label':checkIn?'Check in at the hub':'Send out for delivery'}:{'aria-labelledby':'bulk-title'})}>
  <div className="card ops-card hub-confirm">
   {/* The dialog that opens this panel already carries the heading, so the panel
       does not add a second one — hiding it visually would still leave a screen
       reader hearing the same heading twice. Inside the disclosure on the
       operations view there is no dialog, so the panel supplies it. */}
   {!inDialog&&<h2 id="bulk-title" className="t-title-lg">{checkIn?'Check in at the hub':'Send out for delivery'}</h2>}
   {/* What is being acted on, before anything else. An operator who pressed the
       button on the wrong rows finds out here rather than afterwards. */}
   {candidates.length>0
     ? <p className="hub-confirm-count">{candidates.length} {candidates.length===1?'parcel':'parcels'} · {
         // Enough dockets to recognise the batch, then a count. A van-load would
         // otherwise put forty numbers above the thing the operator came to press.
         candidates.slice(0,3).map(candidate=>candidate.label.split(' · ')[0]).join(', ')
       }{candidates.length>3?` and ${candidates.length-3} more`:''}</p>
     : <p role="status" className="hub-confirm-count">None of the chosen parcels {checkIn?'is waiting to be checked in':'has been checked in yet'}.</p>}
   {checkIn
     ? <HubPlacePicker value={place} onChange={setPlace} disabled={busyNow}/>
     : /* A manifest is a real record created on the Routes screen, so unlike a hub it
          cannot be invented here. The field says where to get it instead of naming its
          format. */
       <div className="hub-picker">
         <p className="hub-picker-label">Which dispatch list are these parcels on?</p>
         <TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36}
           label="Dispatch list number" value={manifest} onChange={setManifest} disabled={busyNow}
           error={manifest&&!uuid.test(manifest)?'That is not a dispatch list number.':undefined}/>
         <p className="hub-confirm-ref">Copy it from the dispatch list on <Link to="/business/routes">Routes</Link>.</p>
       </div>}
   {/* Exactly one line of consequence. There is no definition of a hub, no
       definition of checking in, and — deliberately — no record number: the
       operator never needs it, and showing it only invited "what is that?". */}
   {valid&&<p className="hub-confirm-ref">{checkIn
     ? <>Records that {candidates.length===1?'this parcel':'these parcels'} reached <b>{place?.name}</b>.</>
     : <>Records that {candidates.length===1?'this parcel':'these parcels'} left on this dispatch list.</>}</p>}
  </div>
  {valid?<BulkParcelPanel controller={bulk} action={action} candidates={candidates} refreshFailed={async(items,signal)=>{const refreshed=await Promise.all(items.map(async item=>{try{const row=await source.read(item.parcel_id,signal);const command=action==='check_in'?{expected_version:row.version,evidence_ref:evidence,location_ref:context}:{expected_version:row.version,evidence_ref:evidence,manifest_id:context};return {parcel_id:row.id,idempotency_key:item.idempotency_key,command} as BulkParcelItem;}catch{return null;}}));return refreshed.filter((item):item is BulkParcelItem=>item!==null);}}/>:<p className="card ops-card" role="status">{action==='check_in'?'Choose the hub these parcels are at.':'Enter the dispatch list number these parcels are on.'}</p>}
 </section>;
}

function PackageDetail({controller,roles,parcelId,close,refreshed,embedded=false,onBusyChange}:{controller:ScopeController;roles:readonly OperatorRole[];parcelId:string;close:()=>void;refreshed:()=>void;embedded?:boolean;onBusyChange?:(busy:boolean)=>void}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]),lotSource=useMemo(()=>lots(api),[api]);
 const deliverySource=useMemo(()=>deliveries(api),[api]),[deliveryBusy,setDeliveryBusy]=useState(false);
 const detail=useResource(parcelId,signal=>source.read(parcelId,signal));
 useEffect(()=>{if(detail.phase==='ready')document.getElementById('package-detail-title')?.focus();},[detail.phase]);
 const timeline=useResource(parcelId+'-timeline',signal=>source.timeline(parcelId,signal));
 const membership=useResource(parcelId+'-membership',signal=>lotSource.currentMembership(parcelId,signal));
 const memberLot=useResource(parcelId+'-'+(membership.value?.lot_id??'none'),signal=>membership.value?lotSource.read(membership.value.lot_id,signal):Promise.resolve(null));
 const paymentAllowed=has(roles,'org_admin','franchise_admin','accountant');
 const paymentSource=useMemo(()=>detail.value?payments(api,detail.value.booking_id):null,[api,detail.value]);
 const payment=useResource<PaymentProjection|null>(parcelId+'-payment-'+String(paymentAllowed)+'-'+(detail.value?.booking_id??'pending'),signal=>paymentAllowed&&paymentSource?paymentSource.read(signal):Promise.resolve(null));
 const remove=useCommand<LotDto|LotMembershipResult>(value=>lotSource.execute(value)),life=useCommand(value=>source.execute(value));
 const busy=deliveryBusy||[remove.phase,life.phase].some(phase=>phase==='pending'||phase==='uncertain');
 useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
 const frame=(content:React.ReactNode)=>embedded?<>{content}</>:<OperationDialog title="Package details" close={close} busy={busy}>{content}</OperationDialog>;
 if(detail.phase==='loading')return frame(<Loading label="Loading package detail…"/>);
 if(detail.phase==='error')return frame(<Failure retry={detail.reload} label="Package detail is unavailable."/>);
 const parcel=detail.value!;
 const refresh=()=>{detail.reload();timeline.reload();membership.reload();memberLot.reload();payment.reload();refreshed();};
 async function removeMembership(){const member=membership.value,lot=memberLot.value;if(!member||!lot)return;try{await remove.run(lotSource.intent({kind:'remove',lotId:lot.id,parcelId:parcel.id,body:{membership_id:member.id,expected_version:lot.version}}));membership.reload();memberLot.reload();refreshed();}catch{/* notice owns safe result */}}
 return frame(<section className="ops-detail logistics-selected tracking-detail" aria-labelledby="package-detail-title"><div className="u-between tracking-detail-head"><div><p className="tracking-caption">Tracking number</p><h2 tabIndex={-1} id="package-detail-title" className="t-headline-sm">{parcel.docket}</h2><StatusBadge tone={parcelTones[parcel.status]}>{parcel.status.replaceAll('_',' ')}</StatusBadge></div><button className="btn btn-text" disabled={busy} onClick={close}>Close detail</button></div>
  <div className="ops-facts"><Fact label="Weight" value={`${parcel.weight_grams.toLocaleString('en-IN')} g`}/><Fact label="Custody" value={parcel.custody.replaceAll('_',' ')}/></div>
  <section className="tracking-contacts" aria-label="Shipment contacts">
   <div><p className="tracking-caption"><Msym name="person"/>Sender</p><strong>{parcel.sender.name}</strong><span>{parcel.sender.phone_display}</span></div>
   <div><p className="tracking-caption"><Msym name="pin_drop"/>Recipient</p>{parcel.recipient.name&&<strong>{parcel.recipient.name}</strong>}<span>{parcel.recipient.phone_display??'No receiver phone provided'}</span>
    {parcel.recipient.address&&<span>{parcel.recipient.address}</span>}{parcel.details?.city&&<span>{parcel.details.city}, {parcel.details.region} {parcel.details.postal_code}</span>}
   </div>
  </section>
  <section className="tracking-history"><h3>Timeline</h3>
   {timeline.phase==='loading'?<p role="status">Loading timeline…</p>:timeline.phase==='error'?<button className="btn btn-outlined" onClick={timeline.reload}>Retry timeline</button>:!timeline.value!.items.length?<p className="ops-note">No movement events have been recorded for this parcel.</p>:<>
    <p className="ops-note">Most recent first</p><ol className="tracking-event-list">{[...timeline.value!.items].sort((a,b)=>b.sequence-a.sequence).map(item=><li key={item.event_id}>
      <strong>{item.label}</strong><time dateTime={item.occurred_at}>{formatKolkata(item.occurred_at)}</time><small>Event {item.sequence}</small>
    </li>)}</ol>
   </>}
  </section>
  <details className="logistics-secondary"><summary>Record references</summary><div className="ops-facts"><Fact label="Server version" value={parcel.version}/><Fact label="Booking" value={parcel.booking_id}/></div></details>
  {parcel.status!=='cancelled'&&<ParcelActionForm parcel={parcel} roles={roles} command={life} source={source} confirmed={refresh}/>}
  {has(roles,'dispatcher')&&(parcel.status==='in_transit'||parcel.status==='failed_attempt')&&<DeliveryStartForm parcel={parcel} source={deliverySource} retry={parcel.status==='failed_attempt'} confirmed={refresh} busy={setDeliveryBusy}/>}

  <section><h3>Lot membership</h3>{membership.phase==='loading'||memberLot.phase==='loading'?<p role="status">Loading membership…</p>:membership.phase==='error'||memberLot.phase==='error'?<button className="btn btn-outlined" onClick={()=>{membership.reload();memberLot.reload();}}>Retry membership</button>:!membership.value?<p role="status" className="ops-success">This parcel is not in a group.</p>:<div className="ops-row"><span className="ops-row-main"><b>{memberLot.value?.code??membership.value.lot_id}</b><span>{memberLot.value?.name}</span><span className="ops-note">Membership {membership.value.id}</span></span><button className="btn btn-outlined" disabled={remove.phase==='pending'} onClick={()=>{void removeMembership();}}>Remove from lot</button></div>}<CommandNotice phase={remove.phase} code={remove.error?.code} retry={remove.canRetry?()=>{void remove.retry().then(()=>{membership.reload();memberLot.reload();refreshed();}).catch(()=>{});}:undefined}/></section>
  {has(roles,'operator','franchise_admin')&&<section><h3>Booking charges</h3><p>Use Financial approvals to request a reversal of the booking’s remaining charges. This changes the bill separately from the parcel status.</p><Link className="btn btn-outlined" to={'/business/financials?booking_id='+parcel.booking_id}>Review booking charges</Link></section>}
  <PaymentPanel roles={roles} resource={payment}/>
 </section>);
}

function DeliveryStartForm({parcel,source,retry,confirmed,busy}:{parcel:ParcelRead;source:ReturnType<typeof deliveries>;retry:boolean;confirmed:()=>void;busy:(value:boolean)=>void}){
 const agents=useResource(parcel.id+'-agents',signal=>source.agents(signal)),command=useCommand(value=>source.execute(value));
 const [agent,setAgent]=useState(''),[evidence,setEvidence]=useState('');
 useEffect(()=>{busy(command.phase==='pending'||command.phase==='uncertain');return()=>busy(false);},[busy,command.phase]);
 const locked=command.phase==='pending'||command.phase==='uncertain';
 async function submit(event:React.FormEvent){event.preventDefault();if(locked||!agents.value?.items.some(item=>item.id===agent)||!uuid.test(evidence))return;try{await command.run(source.intent({kind:retry?'retry':'start',parcelId:parcel.id,body:{expected_version:parcel.version,agent_id:agent,handover_evidence_ref:evidence}}));setEvidence('');confirmed();}catch{/* safe notice */}}
 return <section><h3>{retry?'Start final delivery attempt':'Start delivery'}</h3>{agents.phase==='loading'?<p role="status">Loading eligible delivery agents…</p>:agents.phase==='error'?<button className="btn btn-outlined" onClick={agents.reload}>Retry eligible agents</button>:agents.value!.items.length===0?<p role="status">No active delivery agent is eligible in this franchise.</p>:<form className="ops-form" onSubmit={event=>{void submit(event);}}><div className="ops-form-grid"><SelectField label="Assigned delivery agent" value={agent} disabled={locked} onChange={setAgent} options={[{value:'',label:'Choose the receiving agent'},...agents.value!.items.map(item=>({value:item.id,label:item.label}))]}/><TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label="Handover evidence reference (UUID)" helper="Use the handover record for the agent receiving this parcel." disabled={locked} value={evidence} onChange={setEvidence} required/></div><button className="btn btn-filled" disabled={!uuid.test(agent)||!uuid.test(evidence)||command.phase==='pending'||command.phase==='uncertain'}>{retry?'Start second attempt':'Assign and send challenge'}</button></form>}<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(confirmed).catch(()=>{});}:undefined}/></section>;
}

function Fact({label,value}:{label:string;value:React.ReactNode}){return <div className="ops-fact"><span className="ops-note">{label}</span><b>{value}</b></div>;}

function ParcelActionForm({parcel,roles,command,source,confirmed}:{parcel:ParcelRead;roles:readonly OperatorRole[];command:ReturnType<typeof useCommand<ParcelTransitionDto>>;source:ReturnType<typeof parcels>;confirmed:()=>void}){
 // Same reasoning as the bulk sheet: the event reference is minted, the hub is named.
 const [evidence,setEvidence]=useState(()=>mintEventRef()),[reference,setReference]=useState(''),[extra,setExtra]=useState(''),[reason,setReason]=useState<'customer_unavailable'|'customer_requests_pickup'|'address_issue'|'recipient_refusal'|'payment_not_collected'|'operational_issue'>('customer_unavailable');
 const [place,setPlace]=useState<HubPlace|null>(null);
 let kind:ParcelCommand['kind']|null=null;
 if(parcel.status==='booked'&&has(roles,'operator'))kind='check_in';
 else if(parcel.status==='checked_in'&&has(roles,'franchise_admin','operator','dispatcher'))kind='dispatch';
 else if(parcel.status==='dispatched'&&has(roles,'dispatcher'))kind='transit';
 else if(parcel.status==='out_for_delivery'&&has(roles,'delivery_agent'))kind='failed_attempt';
 else if(parcel.status==='failed_attempt'&&has(roles,'franchise_admin'))kind='rto';
 if(!kind)return <section><h3>Next parcel action</h3><p className="ops-note">No update is available for this parcel status and your role. Use Delivery work to complete an assigned delivery with recipient proof.</p></section>;
 // Check-in is the one of these an untrained clerk performs many times a day, so it
 // gets the named-hub control. The rest are dispatcher and administrator actions that
 // genuinely quote a reference from another record, and still ask for it.
 const checkIn=kind==='check_in';
 const locationRef=checkIn?(place?.id??''):reference;
 const referenceLabel=kind==='dispatch'?'Dispatch list number':kind==='transit'?'Route number':kind==='failed_attempt'?'Delivery attempt number':'Approval reference';
 async function submit(event:React.FormEvent){event.preventDefault();let next:ParcelCommand;
  if(kind==='check_in')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,location_ref:locationRef}};
  else if(kind==='dispatch')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,manifest_id:reference}};
  else if(kind==='transit')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,route_id:reference}};
  else if(kind==='failed_attempt')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,attempt_id:reference,reason_code:reason}};
  else next={kind:'rto',parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,approval_ref:reference,return_plan_ref:extra}};
  try{await command.run(source.intent(next));confirmed();setEvidence(mintEventRef());setReference('');setExtra('');}catch{/* safe notice */}}
 const actionLabel=checkIn?'Check in at hub':kind==='dispatch'?'Send out for delivery':kind==='transit'?'Record as on the way':kind==='failed_attempt'?'Record a failed attempt':'Return to origin';
 return <section className="hub-confirm"><h3>{checkIn?'Check in at the hub':'Next parcel action'}</h3><form className="ops-form" onSubmit={event=>{void submit(event);}}>
  {checkIn
    ?<HubPlacePicker value={place} onChange={setPlace} disabled={command.phase==='pending'}/>
    :<div className="ops-form-grid"><TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label={referenceLabel} value={reference} onChange={setReference} error={reference&&!uuid.test(reference)?`That is not a ${referenceLabel.toLowerCase()}.`:undefined} required/>{kind==='rto'&&<TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label="Return plan reference" value={extra} onChange={setExtra} required/>}{kind==='failed_attempt'&&<SelectField label="Why did it fail?" value={reason} onChange={value=>setReason(value as typeof reason)} options={['customer_unavailable','customer_requests_pickup','address_issue','recipient_refusal','payment_not_collected','operational_issue'].map(value=>({value,label:value.replaceAll('_',' ')}))}/>}</div>}
  {/* The button names what it will do and where, so the label is the confirmation.
      The record number that used to sit under it is gone: it identifies the event,
      the software mints it, and the operator has nothing to check it against. */}
  <button className="btn btn-filled btn-lg" disabled={command.phase==='pending'||!uuid.test(evidence)||!uuid.test(locationRef)||(kind==='rto'&&!uuid.test(extra))}>
   {command.phase==='pending'?'Saving…':checkIn&&place?`Check in at ${place.name}`:actionLabel}</button>
  {checkIn&&place&&<p className="hub-confirm-ref">Records that this parcel reached <b>{place.name}</b>.</p>}
 </form><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(confirmed).catch(()=>{});}:undefined}/></section>;
}

function PaymentPanel({roles,resource}:{roles:readonly OperatorRole[];resource:ReturnType<typeof useResource<PaymentProjection|null>>}){
 const link=has(roles,'operator','franchise_admin','org_admin','accountant')?<Link className="btn btn-outlined" to="/business/money-receipts">Open money receipts</Link>:null;
 if(!has(roles,'org_admin','franchise_admin','accountant'))return <section><h3>To-Pay ledger</h3><p className="ops-note">Financial projection is not available to this role. Receipt recording uses its scoped customer bill selector.</p>{link}</section>;
 if(resource.phase==='loading')return <section><p role="status">Loading payment ledger…</p>{link}</section>;if(resource.phase==='error')return <section><button className="btn btn-outlined" onClick={resource.reload}>Retry payment ledger</button>{link}</section>;
 const payment=resource.value;if(!payment)return null;
 return <section><h3>To-Pay ledger</h3><div className="ops-facts"><Fact label="Gross" value={formatMoney(payment.gross_paise)}/><Fact label="Applied funds" value={formatMoney(payment.collected_paise)}/><Fact label="Outstanding" value={formatMoney(payment.outstanding_paise)}/><Fact label="Ledger state" value={payment.state.replaceAll('_',' ')}/></div><p>Record new money and apply existing advances through named receipt evidence. Legacy single-booking records retain their original amounts and unknown source details.</p>{link}</section>;
}

export default function Packages({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const [params]=useSearchParams();
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]);
 if(params.get('view')==='operations')return <OperationalPackages controller={controller} roles={roles}/>;
 return <SavedBookings operationalBulk={(rows,action,busy,refresh)=><PackageBulk controller={controller} source={source} rows={rows} reload={refresh} initialAction={action} onBusyChange={busy}/>} controller={controller} roles={roles} operationalDetail={(id,close,refresh,busy)=><PackageDetail onBusyChange={busy} controller={controller} roles={roles} parcelId={id} close={close} refreshed={refresh} embedded/>}/>;
}
