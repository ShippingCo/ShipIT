import {FilterChips,SearchBar} from '../components/m3/Controls';
import {OperationDialog} from '../components/workspace/OperationDialog';
import {PageHeader,RecordTable,SectionHeader,StatusBadge} from '../components/workspace/Workspace';
import {canAdminister} from '@shippingco/shared';
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
import { CommandNotice,Empty,Failure,Loading } from './AsyncState';
import { formatKolkata,formatMoney } from './format';
import { TextField,SelectField } from '../components/m3/Input';
import { Msym } from '../components/m3/Icon';
import {DatePresets} from './DatePresets';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const has=(roles:readonly OperatorRole[],...wanted:OperatorRole[])=>(wanted.some(role=>role!=='delivery_agent'&&role!=='org_admin')&&canAdminister(roles,'parcels.read'))||roles.some(role=>wanted.includes(role));
const parcelTones={booked:'neutral',checked_in:'info',dispatched:'info',in_transit:'info',out_for_delivery:'info',failed_attempt:'warning',held_at_office:'warning',delivered:'success',rto:'warning'} as const;
const statusOptions=[{value:'',label:'All statuses'},...parcelStatuses.map(value=>({value,label:value.replaceAll('_',' ')}))];

export default function Packages({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]);
 const [params,setParams]=useSearchParams();
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
 return <div className="ops-page logistics-workspace reference-logistics">
  <PageHeader title="Packages" eyebrow="Bookings & tracking" description="Find a parcel and see what needs to happen next." actions={(canAdminister(roles,'bookings.create')||roles.includes('operator'))&&<Link className="btn btn-filled" to="/business/new-booking"><Msym name="add"/>New booking</Link>}/>
  <form className="logistics-search" noValidate onSubmit={event=>{event.preventDefault();if(from&&to&&from>to){setFilterError('Choose an end date on or after the start date.');if(filterPanel.current)filterPanel.current.open=true;document.getElementById('packages-booked-through')?.focus();return;}setFilterError('');setQuery({docket:docket.trim(),status,destination:destination.trim().toUpperCase(),from,to});setSelected(null);}} aria-label="Package filters">
   <div className="logistics-search-primary"><SearchBar label="Tracking number" placeholder="Full tracking number" value={docket} onChange={setDocket} shortcut="/"/><button className="btn btn-filled"><Msym name="search"/>Search</button></div>
   <details className="logistics-filter-disclosure" ref={filterPanel}><summary><Msym name="tune"/>Filters{appliedFilters.length>0&&<span className="logistics-filter-count">{appliedFilters.length} applied</span>}</summary><div className="logistics-package-filters">
    <SelectField label="Parcel status" value={status} onChange={setStatus} options={statusOptions}/>
    <TextField label="Destination city / routing key" value={destination} onChange={value=>setDestination(value.toUpperCase())} autoCapitalize="characters" spellCheck={false} maxLength={32} helper="Rate-card destination, for example MUMBAI."/>
    <TextField label="Booked from (Asia/Kolkata)" type="date" value={from} onChange={value=>{setFrom(value);setFilterError('');}}/><TextField id="packages-booked-through" label="Booked through (Asia/Kolkata)" type="date" value={to} onChange={value=>{setTo(value);setFilterError('');}} min={from||undefined} error={filterError||undefined}/>
    <div className="logistics-filter-actions"><DatePresets change={(start,end)=>{setFrom(start);setTo(end);}}/><button className="btn btn-outlined">Apply filters</button></div>
   </div></details>
   <div className="logistics-applied-filters" aria-live="polite"><span>{appliedFilters.length?appliedFilters.join(' · '):'All dates and statuses'}</span>{hasFilters&&<button type="button" className="btn btn-text" onClick={clearFilters}>Clear</button>}</div>
   {filterError&&<p className="ops-alert" role="alert">{filterError}</p>}
  </form>
  <FilterChips options={[{value:'',label:'All'},{value:'booked',label:'Booked'},{value:'checked_in',label:'At hub'},{value:'out_for_delivery',label:'Out for delivery'},{value:'failed_attempt',label:'Needs follow-up'},{value:'delivered',label:'Delivered'},{value:'rto',label:'Returned'},...(['dispatched','in_transit','held_at_office'].includes(query.status)?[{value:query.status,label:query.status.replaceAll('_',' ')}]:[])]} value={query.status} onChange={value=>{setStatus(value);setQuery(previous=>({...previous,status:value}));setSelected(null);}}/>
  {page.phase==='loading'?<Loading label="Loading parcels…"/>:page.phase==='error'?<Failure retry={page.reload} label="Parcels could not be loaded."/>:page.phase==='empty'?<Empty icon="inventory_2" title={hasFilters?"No parcels match":"No parcels yet"} body={hasFilters?"Try another tracking number, or clear the filters to browse parcels.":(canAdminister(roles,'bookings.create')||roles.includes('operator'))?"Create your first booking to start tracking parcels here.":"Parcels appear here after your team creates a booking."} action={hasFilters?<button type="button" className="btn btn-outlined" onClick={clearFilters}>Clear filters</button>:(canAdminister(roles,'bookings.create')||roles.includes('operator'))?<Link className="btn btn-filled" to="/business/new-booking">Create a booking</Link>:undefined}/>:<>
   <section className="card ops-card logistics-records reference-package-table"><SectionHeader title="Package list" description={`${page.items.length} ${page.items.length===1?'package':'packages'} loaded${page.page.has_more?' · more available':''}`} actions={<><SelectField label="Sort packages" value={sort} onChange={value=>{setSort(value as typeof sort);setSelected(null);}} options={[{value:'created_at_desc',label:'Newest first'},{value:'created_at_asc',label:'Oldest first'},{value:'docket_asc',label:'Tracking A–Z'},{value:'docket_desc',label:'Tracking Z–A'}]}/><button className="btn btn-outlined" onClick={page.reload}><Msym name="refresh"/>Refresh</button></>}/>
    <RecordTable mobile="stack" label="Packages" rows={page.items} rowKey={item=>item.id} selectedKey={selected} columns={[
     {key:'docket',label:'Tracking number',cell:item=><strong className="ops-mono">{item.docket}</strong>},
     {key:'customer',label:'Customer',cell:item=><div className="record-identity"><strong>{item.sender.name}</strong><span>{item.sender.phone_display}</span></div>},
     {key:'destination',label:'To',cell:item=>item.details?.city??'Not recorded'},
     {key:'status',label:'Status',cell:item=><StatusBadge tone={parcelTones[item.status]}>{item.status.replaceAll('_',' ')}</StatusBadge>},
     {key:'weight',label:'Weight',align:'right',cell:item=>item.weight_grams.toLocaleString('en-IN')+' g'},
     {key:'confirmed',label:'Confirmed',cell:item=>formatKolkata(item.confirmed_at)},
     {key:'actions',label:'Actions',className:'record-actions',cell:item=><button className="btn btn-text" onClick={()=>select(item.id)}>Open</button>},
    ]}/>
    {page.page.has_more&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={()=>page.loadMore()}>{page.phase==='more'?'Loading…':'Load next page'}</button>}
    <p className="ops-note">Open a parcel for its lot, timeline, booking balance and available actions.</p>
   </section>
   <details className="logistics-extra-work"><summary>Update several parcels</summary><PackageBulk controller={controller} source={source} rows={page.items} reload={page.reload}/></details>
  </>}
  {selected&&<PackageDetail key={selected} controller={controller} roles={roles} parcelId={selected} close={()=>setSelected(null)} refreshed={page.reload}/>}
 </div>;
}

function PackageBulk({controller,source,rows,reload}:{controller:ScopeController;source:ReturnType<typeof parcels>;rows:ParcelRead[];reload:()=>void}){
 const [action,setAction]=useState<BulkParcelAction>('check_in'),[evidence,setEvidence]=useState(''),[context,setContext]=useState('');
 const bulk=useMemo(()=>createParcelBulkController(controller),[controller]);useEffect(()=>()=>bulk.dispose(),[bulk]);
 const state=useSyncExternalStore(bulk.subscribe,bulk.snapshot),last=useRef(0);
 useEffect(()=>{if(state.phase==='confirmed'&&state.result&&state.result.summary.succeeded!==last.current){last.current=state.result.summary.succeeded;reload();}},[state.phase,state.result,reload]);
 const keys=useRef(new Map<string,string>()),valid=uuid.test(evidence)&&uuid.test(context);
 const candidates=useMemo(()=>rows.filter(row=>row.status===(action==='check_in'?'booked':'checked_in')).map(row=>{
  const command=action==='check_in'?{expected_version:row.version,evidence_ref:evidence,location_ref:context}:{expected_version:row.version,evidence_ref:evidence,manifest_id:context};
  const signature=JSON.stringify([action,row.id,command]);let key=keys.current.get(signature);if(!key){key=crypto.randomUUID();keys.current.set(signature,key);}
  return {label:`${row.docket} · version ${row.version}`,item:{parcel_id:row.id,idempotency_key:key,command} as BulkParcelItem};
 }),[rows,action,evidence,context]);
 useEffect(()=>{bulk.select([]);},[bulk,action,evidence,context]);
 return <section className="ops-detail logistics-bulk" aria-labelledby="bulk-title"><div className="card ops-card"><h2 id="bulk-title" className="t-title-lg">Update selected parcels</h2><p className="ops-note">Choose an update and review the selected parcels. Failed updates stay selected.</p><div className="ops-form-grid"><SelectField label="Bulk action" value={action} onChange={value=>setAction(value as BulkParcelAction)} options={[{value:'check_in',label:'Check in booked parcels'},{value:'dispatch',label:'Dispatch checked-in parcels'}]}/><TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label="Evidence reference (UUID)" value={evidence} onChange={setEvidence}/><TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label={action==='check_in'?'Location reference (UUID)':'Finalized manifest ID (UUID)'} value={context} onChange={setContext}/></div></div>
  {valid?<BulkParcelPanel controller={bulk} action={action} candidates={candidates} refreshFailed={async(items,signal)=>{const refreshed=await Promise.all(items.map(async item=>{try{const row=await source.read(item.parcel_id,signal);const command=action==='check_in'?{expected_version:row.version,evidence_ref:evidence,location_ref:context}:{expected_version:row.version,evidence_ref:evidence,manifest_id:context};return {parcel_id:row.id,idempotency_key:item.idempotency_key,command} as BulkParcelItem;}catch{return null;}}));return refreshed.filter((item):item is BulkParcelItem=>item!==null);}}/>:<p className="card ops-card" role="status">Enter valid UUID evidence and {action==='check_in'?'location':'manifest'} references to enable selection.</p>}
 </section>;
}

function PackageDetail({controller,roles,parcelId,close,refreshed}:{controller:ScopeController;roles:readonly OperatorRole[];parcelId:string;close:()=>void;refreshed:()=>void}){
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
 const busy=deliveryBusy||[remove.phase,life.phase].some(phase=>phase==='pending'||phase==='uncertain');const frame=(content:React.ReactNode)=><OperationDialog title="Package details" close={close} busy={busy}>{content}</OperationDialog>;
 if(detail.phase==='loading')return frame(<Loading label="Loading package detail…"/>);
 if(detail.phase==='error')return frame(<Failure retry={detail.reload} label="Package detail is unavailable."/>);
 const parcel=detail.value!;
 const refresh=()=>{detail.reload();timeline.reload();membership.reload();memberLot.reload();payment.reload();refreshed();};
 async function removeMembership(){const member=membership.value,lot=memberLot.value;if(!member||!lot)return;try{await remove.run(lotSource.intent({kind:'remove',lotId:lot.id,parcelId:parcel.id,body:{membership_id:member.id,expected_version:lot.version}}));membership.reload();memberLot.reload();refreshed();}catch{/* notice owns safe result */}}
 return frame(<section className="card ops-card ops-detail logistics-selected" aria-labelledby="package-detail-title"><div className="u-between"><div><h2 tabIndex={-1} id="package-detail-title" className="t-headline-sm">{parcel.docket}</h2><StatusBadge tone={parcelTones[parcel.status]}>{parcel.status.replaceAll('_',' ')}</StatusBadge></div><button className="btn btn-text" disabled={busy} onClick={close}>Close detail</button></div>
  <div className="ops-facts"><Fact label="Weight" value={`${parcel.weight_grams.toLocaleString('en-IN')} g`}/><Fact label="Custody" value={parcel.custody.replaceAll('_',' ')}/></div>
  <div className="ops-grid"><div className="ops-fact"><b>Sender</b>{parcel.sender.name}<span className="ops-note">{parcel.sender.phone_display}</span></div><div className="ops-fact"><b>Recipient</b>{parcel.recipient.name}<span className="ops-note">{parcel.recipient.phone_display}</span></div></div>
  <details className="logistics-secondary"><summary>Record references</summary><div className="ops-facts"><Fact label="Server version" value={parcel.version}/><Fact label="Booking" value={parcel.booking_id}/></div></details>
  <ParcelActionForm parcel={parcel} roles={roles} command={life} source={source} confirmed={refresh}/>
  {has(roles,'dispatcher')&&(parcel.status==='in_transit'||parcel.status==='failed_attempt')&&<DeliveryStartForm parcel={parcel} source={deliverySource} retry={parcel.status==='failed_attempt'} confirmed={refresh} busy={setDeliveryBusy}/>}
  <section><h3>Timeline</h3>{timeline.phase==='loading'?<p role="status">Loading timeline…</p>:timeline.phase==='error'?<button className="btn btn-outlined" onClick={timeline.reload}>Retry timeline</button>:<ol className="ops-list">{timeline.value!.items.map(item=><li className="ops-row" key={item.event_id}><span className="ops-row-main"><b>{item.label}</b><span className="ops-note">{formatKolkata(item.occurred_at)} · sequence {item.sequence}</span></span></li>)}</ol>}</section>
  <section><h3>Lot membership</h3>{membership.phase==='loading'||memberLot.phase==='loading'?<p role="status">Loading membership…</p>:membership.phase==='error'||memberLot.phase==='error'?<button className="btn btn-outlined" onClick={()=>{membership.reload();memberLot.reload();}}>Retry membership</button>:!membership.value?<p role="status" className="ops-success">This parcel is not in a group.</p>:<div className="ops-row"><span className="ops-row-main"><b>{memberLot.value?.code??membership.value.lot_id}</b><span>{memberLot.value?.name}</span><span className="ops-note">Membership {membership.value.id}</span></span><button className="btn btn-outlined" disabled={remove.phase==='pending'} onClick={()=>{void removeMembership();}}>Remove from lot</button></div>}<CommandNotice phase={remove.phase} code={remove.error?.code} retry={remove.canRetry?()=>{void remove.retry().then(()=>{membership.reload();memberLot.reload();refreshed();}).catch(()=>{});}:undefined}/></section>
  {has(roles,'operator','franchise_admin')&&<section><h3>Booking cancellation</h3><p>Request cancellation of the whole booking's remaining charges in Financial approvals. Individual packages cannot be cancelled here. Physical movement and returns remain separate guarded operations; cancellation does not stop a parcel or refund money automatically.</p><Link className="btn btn-outlined" to={'/business/financials?booking_id='+parcel.booking_id}>Review whole-booking cancellation</Link></section>}
  <PaymentPanel roles={roles} resource={payment}/>
 </section>);
}

function DeliveryStartForm({parcel,source,retry,confirmed,busy}:{parcel:ParcelRead;source:ReturnType<typeof deliveries>;retry:boolean;confirmed:()=>void;busy:(value:boolean)=>void}){
 const agents=useResource(parcel.id+'-agents',signal=>source.agents(signal)),command=useCommand(value=>source.execute(value));
 const [agent,setAgent]=useState(''),[evidence,setEvidence]=useState('');
 useEffect(()=>{busy(command.phase==='pending'||command.phase==='uncertain');return()=>busy(false);},[busy,command.phase]);
 useEffect(()=>{if(!agent&&agents.value?.items[0])setAgent(agents.value.items[0].id);},[agent,agents.value]);
 async function submit(event:React.FormEvent){event.preventDefault();try{await command.run(source.intent({kind:retry?'retry':'start',parcelId:parcel.id,body:{expected_version:parcel.version,agent_id:agent,handover_evidence_ref:evidence}}));setEvidence('');confirmed();}catch{/* safe notice */}}
 return <section><h3>{retry?'Start final delivery attempt':'Start delivery'}</h3>{agents.phase==='loading'?<p role="status">Loading eligible delivery agents…</p>:agents.phase==='error'?<button className="btn btn-outlined" onClick={agents.reload}>Retry eligible agents</button>:agents.value!.items.length===0?<p role="status">No active delivery agent is eligible in this franchise.</p>:<form className="ops-form" onSubmit={event=>{void submit(event);}}><div className="ops-form-grid"><SelectField label="Assigned delivery agent" value={agent} onChange={setAgent} options={agents.value!.items.map(item=>({value:item.id,label:item.label}))}/><TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label="Handover evidence reference (UUID)" value={evidence} onChange={setEvidence} required/></div><button className="btn btn-filled" disabled={!uuid.test(agent)||!uuid.test(evidence)||command.phase==='pending'||command.phase==='uncertain'}>{retry?'Start second attempt':'Assign and send challenge'}</button></form>}<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(confirmed).catch(()=>{});}:undefined}/></section>;
}

function Fact({label,value}:{label:string;value:React.ReactNode}){return <div className="ops-fact"><span className="ops-note">{label}</span><b>{value}</b></div>;}

function ParcelActionForm({parcel,roles,command,source,confirmed}:{parcel:ParcelRead;roles:readonly OperatorRole[];command:ReturnType<typeof useCommand<ParcelTransitionDto>>;source:ReturnType<typeof parcels>;confirmed:()=>void}){
 const [evidence,setEvidence]=useState(''),[reference,setReference]=useState(''),[extra,setExtra]=useState(''),[reason,setReason]=useState<'customer_unavailable'|'customer_requests_pickup'|'address_issue'|'recipient_refusal'|'payment_not_collected'|'operational_issue'>('customer_unavailable');
 let kind:ParcelCommand['kind']|null=null;
 if(parcel.status==='booked'&&has(roles,'operator'))kind='check_in';
 else if(parcel.status==='checked_in'&&has(roles,'franchise_admin','operator','dispatcher'))kind='dispatch';
 else if(parcel.status==='dispatched'&&has(roles,'dispatcher'))kind='transit';
 else if(parcel.status==='out_for_delivery'&&has(roles,'delivery_agent'))kind='failed_attempt';
 else if(parcel.status==='failed_attempt'&&has(roles,'franchise_admin'))kind='rto';
 if(!kind)return <section><h3>Next parcel action</h3><p className="ops-note">No update is available for this parcel status and your role. Use Delivery work to complete an assigned delivery with recipient proof.</p></section>;
 const referenceLabel=kind==='check_in'?'Location reference':kind==='dispatch'?'Finalized manifest ID':kind==='transit'?'Route ID':kind==='failed_attempt'?'Active attempt ID':'Approval reference';
 async function submit(event:React.FormEvent){event.preventDefault();let next:ParcelCommand;
  if(kind==='check_in')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,location_ref:reference}};
  else if(kind==='dispatch')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,manifest_id:reference}};
  else if(kind==='transit')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,route_id:reference}};
  else if(kind==='failed_attempt')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,attempt_id:reference,reason_code:reason}};
  else next={kind:'rto',parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,approval_ref:reference,return_plan_ref:extra}};
  try{await command.run(source.intent(next));confirmed();setEvidence('');setReference('');setExtra('');}catch{/* safe notice */}}
 return <section><h3>Next parcel action</h3><form className="ops-form" onSubmit={event=>{void submit(event);}}><div className="ops-form-grid"><TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label="Evidence reference (UUID)" value={evidence} onChange={setEvidence} required/><TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label={`${referenceLabel} (UUID)`} value={reference} onChange={setReference} required/>{kind==='rto'&&<TextField autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={36} label="Return plan reference (UUID)" value={extra} onChange={setExtra} required/>}{kind==='failed_attempt'&&<SelectField label="Failure reason" value={reason} onChange={value=>setReason(value as typeof reason)} options={['customer_unavailable','customer_requests_pickup','address_issue','recipient_refusal','payment_not_collected','operational_issue'].map(value=>({value,label:value.replaceAll('_',' ')}))}/>}</div><button className="btn btn-filled" disabled={command.phase==='pending'||!uuid.test(evidence)||!uuid.test(reference)||(kind==='rto'&&!uuid.test(extra))}>{kind.replaceAll('_',' ')}</button></form><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(confirmed).catch(()=>{});}:undefined}/></section>;
}

function PaymentPanel({roles,resource}:{roles:readonly OperatorRole[];resource:ReturnType<typeof useResource<PaymentProjection|null>>}){
 const link=has(roles,'operator','franchise_admin','org_admin','accountant')?<Link className="btn btn-outlined" to="/business/money-receipts">Open money receipts</Link>:null;
 if(!has(roles,'org_admin','franchise_admin','accountant'))return <section><h3>To-Pay ledger</h3><p className="ops-note">Financial projection is not available to this role. Receipt recording uses its scoped customer bill selector.</p>{link}</section>;
 if(resource.phase==='loading')return <section><p role="status">Loading payment ledger…</p>{link}</section>;if(resource.phase==='error')return <section><button className="btn btn-outlined" onClick={resource.reload}>Retry payment ledger</button>{link}</section>;
 const payment=resource.value;if(!payment)return null;
 return <section><h3>To-Pay ledger</h3><div className="ops-facts"><Fact label="Gross" value={formatMoney(payment.gross_paise)}/><Fact label="Applied funds" value={formatMoney(payment.collected_paise)}/><Fact label="Outstanding" value={formatMoney(payment.outstanding_paise)}/><Fact label="Ledger state" value={payment.state.replaceAll('_',' ')}/></div><p>Record new money and apply existing advances through named receipt evidence. Legacy single-booking records retain their original amounts and unknown source details.</p>{link}</section>;
}
