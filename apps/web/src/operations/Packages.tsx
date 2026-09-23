import React,{useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type { BulkParcelAction,BulkParcelItem,LotDto,LotMembershipResult,OperatorRole,ParcelTransitionDto,PaymentProjection } from '@shippingco/shared';
import type { ScopeController } from '../operator/scope';
import { scopedApi } from '../data-access/scoped-api';
import { parcels,parcelStatuses,type ParcelRead,type ParcelStatus,type ParcelCommand } from '../data-access/parcels';
import { lots } from '../data-access/lots';
import { payments } from '../data-access/payments';
import { deliveries } from '../data-access/deliveries';
import { createParcelBulkController } from '../data-access/parcel-bulk-controller';
import { BulkParcelPanel } from '../parcels/BulkParcelPanel';
import { useCommand,usePagedResource,useResource } from './hooks';
import { CommandNotice,Empty,Failure,Loading } from './AsyncState';
import { formatKolkata,formatMoney,rupeesToPaise } from './format';
import { TextField,SelectField } from '../components/m3/Input';
import { Msym } from '../components/m3/Icon';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const has=(roles:readonly OperatorRole[],...wanted:OperatorRole[])=>roles.some(role=>wanted.includes(role));
const statusOptions=[{value:'',label:'All server statuses'},...parcelStatuses.map(value=>({value,label:value.replaceAll('_',' ')}))];

export default function Packages({controller,roles}:{controller:ScopeController;roles:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]);
 const [docket,setDocket]=useState(''),[status,setStatus]=useState(''),[query,setQuery]=useState({docket:'',status:''});
 const key=JSON.stringify(query);const page=usePagedResource(key,(cursor,signal)=>source.list({docket:query.docket||undefined,status:query.status as ParcelStatus||undefined,limit:50,cursor},signal));
 const [selected,setSelected]=useState<string|null>(null);
 const select=(id:string)=>setSelected(id);
 return <div className="ops-page">
  <form className="card ops-card ops-toolbar" onSubmit={event=>{event.preventDefault();setQuery({docket:docket.trim(),status});setSelected(null);}} aria-label="Package filters">
   <TextField label="Exact docket" value={docket} onChange={setDocket} helper="Server exact docket lookup; blank lists the current page."/>
   <SelectField label="Parcel status" value={status} onChange={setStatus} options={statusOptions}/>
   <button className="btn btn-filled"><Msym name="search"/>Search server</button>
   <button type="button" className="btn btn-text" onClick={()=>{setDocket('');setStatus('');setQuery({docket:'',status:''});}}>Clear</button>
  </form>
  {page.phase==='loading'?<Loading label="Loading parcels…"/>:page.phase==='error'?<Failure retry={page.reload} label="Parcels could not be loaded."/>:page.phase==='empty'?<Empty icon="inventory_2" title="No parcels match" body="Change the server-supported docket or status filter, or create a booking."/>:<>
   <section className="card ops-card"><div className="u-between"><div><h1 className="t-headline-sm">Packages</h1><p className="ops-note">{page.items.length} loaded from authoritative pagination{page.page.has_more?' · more available':''}.</p></div><button className="btn btn-outlined" onClick={page.reload}><Msym name="refresh"/>Refresh</button></div>
    <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Docket</th><th>Status</th><th>Weight</th><th>Confirmed</th><th></th></tr></thead><tbody>{page.items.map(item=><tr key={item.id}><td className="ops-mono">{item.docket}</td><td><span className="ops-pill">{item.status.replaceAll('_',' ')}</span></td><td>{item.weight_grams.toLocaleString('en-IN')} g</td><td>{formatKolkata(item.confirmed_at)}</td><td><button className="btn btn-text" onClick={()=>select(item.id)}>Open</button></td></tr>)}</tbody></table></div>
    {page.page.has_more&&<button className="btn btn-outlined" disabled={page.phase==='more'} onClick={()=>page.loadMore()}>{page.phase==='more'?'Loading…':'Load next page'}</button>}
   </section>
   <PackageBulk controller={controller} source={source} rows={page.items} reload={page.reload}/>
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
 return <section className="ops-detail" aria-labelledby="bulk-title"><div className="card ops-card"><h2 id="bulk-title" className="t-title-lg">Bounded bulk command</h2><p className="ops-note">Confirmed successes leave the selection. Failed items stay actionable; stale items are authoritatively refreshed before deliberate retry.</p><div className="ops-form-grid"><SelectField label="Bulk action" value={action} onChange={value=>setAction(value as BulkParcelAction)} options={[{value:'check_in',label:'Check in booked parcels'},{value:'dispatch',label:'Dispatch checked-in parcels'}]}/><TextField label="Evidence reference (UUID)" value={evidence} onChange={setEvidence}/><TextField label={action==='check_in'?'Location reference (UUID)':'Finalized manifest ID (UUID)'} value={context} onChange={setContext}/></div></div>
  {valid?<BulkParcelPanel controller={bulk} action={action} candidates={candidates} refreshFailed={async(items,signal)=>{const refreshed=await Promise.all(items.map(async item=>{try{const row=await source.read(item.parcel_id,signal);const command=action==='check_in'?{expected_version:row.version,evidence_ref:evidence,location_ref:context}:{expected_version:row.version,evidence_ref:evidence,manifest_id:context};return {parcel_id:row.id,idempotency_key:item.idempotency_key,command} as BulkParcelItem;}catch{return null;}}));return refreshed.filter((item):item is BulkParcelItem=>item!==null);}}/>:<p className="card ops-card" role="status">Enter valid UUID evidence and {action==='check_in'?'location':'manifest'} references to enable selection.</p>}
 </section>;
}

function PackageDetail({controller,roles,parcelId,close,refreshed}:{controller:ScopeController;roles:readonly OperatorRole[];parcelId:string;close:()=>void;refreshed:()=>void}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]),lotSource=useMemo(()=>lots(api),[api]);
 const deliverySource=useMemo(()=>deliveries(api),[api]);
 const detail=useResource(parcelId,signal=>source.read(parcelId,signal));
 const timeline=useResource(parcelId+'-timeline',signal=>source.timeline(parcelId,signal));
 const membership=useResource(parcelId+'-membership',signal=>lotSource.currentMembership(parcelId,signal));
 const memberLot=useResource(parcelId+'-'+(membership.value?.lot_id??'none'),signal=>membership.value?lotSource.read(membership.value.lot_id,signal):Promise.resolve(null));
 const paymentAllowed=has(roles,'org_admin','franchise_admin','accountant');
 const paymentSource=useMemo(()=>detail.value?payments(api,detail.value.booking_id):null,[api,detail.value]);
 const payment=useResource<PaymentProjection|null>(parcelId+'-payment-'+String(paymentAllowed)+'-'+(detail.value?.booking_id??'pending'),signal=>paymentAllowed&&paymentSource?paymentSource.read(signal):Promise.resolve(null));
 const remove=useCommand<LotDto|LotMembershipResult>(value=>lotSource.execute(value)),life=useCommand(value=>source.execute(value));
 if(detail.phase==='loading')return <Loading label="Loading package detail…"/>;
 if(detail.phase==='error')return <Failure retry={detail.reload} label="Package detail is unavailable."/>;
 const parcel=detail.value!;
 const refresh=()=>{detail.reload();timeline.reload();membership.reload();memberLot.reload();payment.reload();refreshed();};
 async function removeMembership(){const member=membership.value,lot=memberLot.value;if(!member||!lot)return;try{await remove.run(lotSource.intent({kind:'remove',lotId:lot.id,parcelId:parcel.id,body:{membership_id:member.id,expected_version:lot.version}}));membership.reload();memberLot.reload();refreshed();}catch{/* notice owns safe result */}}
 return <section className="card ops-card ops-detail" aria-labelledby="package-detail-title"><div className="u-between"><div><h2 id="package-detail-title" className="t-headline-sm">{parcel.docket}</h2><span className="ops-pill">{parcel.status.replaceAll('_',' ')}</span></div><button className="btn btn-text" onClick={close}>Close detail</button></div>
  <div className="ops-facts"><Fact label="Server version" value={parcel.version}/><Fact label="Weight" value={`${parcel.weight_grams.toLocaleString('en-IN')} g`}/><Fact label="Custody" value={parcel.custody.replaceAll('_',' ')}/><Fact label="Booking" value={parcel.booking_id}/></div>
  <div className="ops-grid"><div className="ops-fact"><b>Sender</b>{parcel.sender.name}<span className="ops-note">{parcel.sender.phone_display}</span></div><div className="ops-fact"><b>Recipient</b>{parcel.recipient.name}<span className="ops-note">{parcel.recipient.phone_display}</span></div></div>
  <ParcelActionForm parcel={parcel} roles={roles} command={life} source={source} confirmed={refresh}/>
  {has(roles,'dispatcher')&&(parcel.status==='in_transit'||parcel.status==='failed_attempt')&&<DeliveryStartForm parcel={parcel} source={deliverySource} retry={parcel.status==='failed_attempt'} confirmed={refresh}/>}
  <section><h3>Timeline</h3>{timeline.phase==='loading'?<p role="status">Loading timeline…</p>:timeline.phase==='error'?<button className="btn btn-outlined" onClick={timeline.reload}>Retry timeline</button>:<ol className="ops-list">{timeline.value!.items.map(item=><li className="ops-row" key={item.event_id}><span className="ops-row-main"><b>{item.label}</b><span className="ops-note">{formatKolkata(item.occurred_at)} · sequence {item.sequence}</span></span></li>)}</ol>}</section>
  <section><h3>Lot membership</h3>{membership.phase==='loading'||memberLot.phase==='loading'?<p role="status">Loading membership…</p>:membership.phase==='error'||memberLot.phase==='error'?<button className="btn btn-outlined" onClick={()=>{membership.reload();memberLot.reload();}}>Retry membership</button>:!membership.value?<p role="status" className="ops-success">Server confirms this parcel is ungrouped.</p>:<div className="ops-row"><span className="ops-row-main"><b>{memberLot.value?.code??membership.value.lot_id}</b><span>{memberLot.value?.name}</span><span className="ops-note">Membership {membership.value.id}</span></span><button className="btn btn-outlined" disabled={remove.phase==='pending'} onClick={()=>{void removeMembership();}}>Remove from lot</button></div>}<CommandNotice phase={remove.phase} code={remove.error?.code} retry={remove.canRetry?()=>{void remove.retry().then(()=>{membership.reload();memberLot.reload();refreshed();}).catch(()=>{});}:undefined}/></section>
  <PaymentPanel roles={roles} source={paymentSource} resource={payment}/>
 </section>;
}

function DeliveryStartForm({parcel,source,retry,confirmed}:{parcel:ParcelRead;source:ReturnType<typeof deliveries>;retry:boolean;confirmed:()=>void}){
 const agents=useResource(parcel.id+'-agents',signal=>source.agents(signal)),command=useCommand(value=>source.execute(value));
 const [agent,setAgent]=useState(''),[evidence,setEvidence]=useState('');
 useEffect(()=>{if(!agent&&agents.value?.items[0])setAgent(agents.value.items[0].id);},[agent,agents.value]);
 async function submit(event:React.FormEvent){event.preventDefault();try{await command.run(source.intent({kind:retry?'retry':'start',parcelId:parcel.id,body:{expected_version:parcel.version,agent_id:agent,handover_evidence_ref:evidence}}));setEvidence('');confirmed();}catch{/* safe notice */}}
 return <section><h3>{retry?'Start final delivery attempt':'Start delivery'}</h3>{agents.phase==='loading'?<p role="status">Loading eligible delivery agents…</p>:agents.phase==='error'?<button className="btn btn-outlined" onClick={agents.reload}>Retry eligible agents</button>:agents.value!.items.length===0?<p role="status">No active delivery agent is eligible in this franchise.</p>:<form className="ops-form" onSubmit={event=>{void submit(event);}}><div className="ops-form-grid"><SelectField label="Assigned delivery agent" value={agent} onChange={setAgent} options={agents.value!.items.map(item=>({value:item.id,label:item.label}))}/><TextField label="Handover evidence reference (UUID)" value={evidence} onChange={setEvidence} required/></div><button className="btn btn-filled" disabled={!uuid.test(agent)||!uuid.test(evidence)||command.phase==='pending'}>{retry?'Start second attempt':'Assign and send challenge'}</button></form>}<CommandNotice phase={command.phase} code={command.error?.code}/></section>;
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
 if(!kind)return <section><h3>Lifecycle action</h3><p className="ops-note">No safe production transition is available for this state and role. Delivery completion remains unavailable until the trusted proof workflow is connected.</p></section>;
 const referenceLabel=kind==='check_in'?'Location reference':kind==='dispatch'?'Finalized manifest ID':kind==='transit'?'Route ID':kind==='failed_attempt'?'Active attempt ID':'Approval reference';
 async function submit(event:React.FormEvent){event.preventDefault();let next:ParcelCommand;
  if(kind==='check_in')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,location_ref:reference}};
  else if(kind==='dispatch')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,manifest_id:reference}};
  else if(kind==='transit')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,route_id:reference}};
  else if(kind==='failed_attempt')next={kind,parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,attempt_id:reference,reason_code:reason}};
  else next={kind:'rto',parcelId:parcel.id,body:{expected_version:parcel.version,evidence_ref:evidence,approval_ref:reference,return_plan_ref:extra}};
  try{await command.run(source.intent(next));confirmed();setEvidence('');setReference('');setExtra('');}catch{/* safe notice */}}
 return <section><h3>Guarded lifecycle action</h3><form className="ops-form" onSubmit={event=>{void submit(event);}}><div className="ops-form-grid"><TextField label="Evidence reference (UUID)" value={evidence} onChange={setEvidence} required/><TextField label={`${referenceLabel} (UUID)`} value={reference} onChange={setReference} required/>{kind==='rto'&&<TextField label="Return plan reference (UUID)" value={extra} onChange={setExtra} required/>}{kind==='failed_attempt'&&<SelectField label="Failure reason" value={reason} onChange={value=>setReason(value as typeof reason)} options={['customer_unavailable','customer_requests_pickup','address_issue','recipient_refusal','payment_not_collected','operational_issue'].map(value=>({value,label:value.replaceAll('_',' ')}))}/>}</div><button className="btn btn-filled" disabled={command.phase==='pending'||!uuid.test(evidence)||!uuid.test(reference)||(kind==='rto'&&!uuid.test(extra))}>{kind.replaceAll('_',' ')}</button></form><CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(confirmed).catch(()=>{});}:undefined}/></section>;
}

function PaymentPanel({roles,source,resource}:{roles:readonly OperatorRole[];source:ReturnType<typeof payments>|null;resource:ReturnType<typeof useResource<PaymentProjection|null>>}){
 const [amount,setAmount]=useState(''),[method,setMethod]=useState('cash');const collect=useCommand(value=>source!.execute(value));
 if(!has(roles,'org_admin','franchise_admin','accountant'))return <section><h3>To-Pay ledger</h3><p className="ops-note">Financial projection is not available to this role.</p></section>;
 if(resource.phase==='loading')return <p role="status">Loading payment ledger…</p>;if(resource.phase==='error')return <button className="btn btn-outlined" onClick={resource.reload}>Retry payment ledger</button>;
 const payment=resource.value;if(!payment)return null;const paise=rupeesToPaise(amount);
 async function submit(event:React.FormEvent){event.preventDefault();if(!source||!paise)return;try{await collect.run(source.collect({amount_paise:paise,currency:'INR',context:'to_pay',method:method as 'cash'|'upi',collection_reference:crypto.randomUUID()}));resource.reload();setAmount('');}catch{/* safe notice */}}
 return <section><h3>To-Pay ledger</h3><div className="ops-facts"><Fact label="Gross" value={formatMoney(payment.gross_paise)}/><Fact label="Collected" value={formatMoney(payment.collected_paise)}/><Fact label="Outstanding" value={formatMoney(payment.outstanding_paise)}/><Fact label="Ledger state" value={payment.state.replaceAll('_',' ')}/></div>{has(roles,'franchise_admin')&&payment.outstanding_paise>0&&<form className="ops-form" onSubmit={event=>{void submit(event);}}><p><b>Record actual money received.</b> This app does not move funds or infer collection from delivery.</p><div className="ops-form-grid"><TextField label="Amount received (₹)" value={amount} onChange={setAmount} inputMode="decimal" helper={`Outstanding ${formatMoney(payment.outstanding_paise)}`}/><SelectField label="Method" value={method} onChange={setMethod} options={[{value:'cash',label:'Cash'},{value:'upi',label:'UPI (manually recorded)'}]}/></div><button className="btn btn-filled" disabled={!paise||paise>payment.outstanding_paise||collect.phase==='pending'}>Confirm money received</button></form>}<CommandNotice phase={collect.phase} code={collect.error?.code} retry={collect.canRetry?()=>{void collect.retry().then(()=>resource.reload()).catch(()=>{});}:undefined}/></section>;
}
