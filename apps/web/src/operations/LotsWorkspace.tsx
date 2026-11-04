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
import {LotCardView} from '../components/workspace/DispatchCards';
import {Button,Checkbox,IconButton} from '../components/m3/Button';
import {Card,EmptyState,StatusPill} from '../components/m3/Surface';
import {Dialog} from '../components/m3/Dialog';
import {TextField,SelectField,TextArea} from '../components/m3/Input';
import {Msym} from '../components/m3/Icon';
import {formatKolkata} from './format';
import type {ParcelStatus} from '../data/types';

const terminal=(s:string)=>['delivered','rto','cancelled'].includes(s);
const cityName=(s:string)=>s.replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());
const cityKey=(s:string)=>s.trim().toUpperCase().replaceAll(' ','_');
const money=(paise:number)=>'₹'+(paise/100).toLocaleString('en-IN',{maximumFractionDigits:2});
const date=(s:string)=>formatKolkata(s,{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});
export async function allLotPages<T>(load:(cursor:string|null)=>Promise<PagedValue<T>>){
 const items:T[]=[],seen=new Set<string>();let cursor:string|null=null;
 do{const page=await load(cursor);items.push(...page.items);cursor=page.page.next_cursor;if(page.page.has_more&&(!cursor||seen.has(cursor)))throw new Error('Invalid pagination');if(cursor)seen.add(cursor);}while(cursor);
 return items;
}
interface LotData {lots:LotDto[];rows:SavedBookingRow[];routes:RouteDto[];routeByLot:Map<string,RouteDto>}
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
  const planning=new Map(groups.flatMap(l=>(l.planning_entry_ids??[]).map(id=>[id,l] as const)));
  const balances=new Map(canMoney?await Promise.all([...new Set(shipments.map(p=>p.booking_id))].map(async id=>[id,await payments(api,id).read(signal)] as const)):[]);
  const routeByLot=new Map<string,RouteDto>();
  for(const route of routeRows.filter(r=>r.state!=='archived')){
   const items=await allLotPages(cursor=>routeSource.manifest(route.id,undefined,{limit:100,cursor},signal));
   for(const item of items)for(const s of item.sources)if(s.kind==='lot')routeByLot.set(s.lot_id,route);
  }
  return {lots:groups,routes:routeRows,routeByLot,rows:[
   ...entries.items.map(e=>{const row=counterBookingRow(e),l=planning.get(e.id);return {...row,lotId:l?.id??null,lotCode:l?.code??''};}),
   ...shipments.map((p:ParcelRead):SavedBookingRow=>{const l=membership.get(p.id),balance=balances.get(p.booking_id);return {id:'parcel:'+p.id,docket:p.docket,name:p.sender.name,phone:p.sender.phone_display,city:cityName(p.destination_key||p.details?.city||l?.destination_key||''),address:p.recipient.address,service:'—',weight:p.weight_grams/1000,amount:balance?.gross_paise??null,payment:balance?(balance.outstanding_paise===0?'paid':'topay'):'unknown',status:p.status,createdAt:Date.parse(p.confirmed_at),lotId:l?.id??null,lotCode:l?.code??'',parcel:p};}),
  ]};
 });
 const [create,setCreate]=useState(false),[add,setAdd]=useState<LotDto|null>(null),[remove,setRemove]=useState<LotDto|null>(null),[message,setMessage]=useState<LotDto|null>(null);
 const [notice,setNotice]=useState('');
 const archive=useCommand<import('@shippingco/shared').LotDto|import('@shippingco/shared').LotMembershipResult>(value=>source.execute(value)),busy=archive.phase==='pending'||archive.phase==='uncertain';
 async function deleted(){setRemove(null);data.reload();setNotice('Lot deleted. Its parcels are now ungrouped.');}
 if(data.phase==='loading')return <div className="page"><Loading label="Loading lots…"/></div>;
 if(data.phase==='error')return <div className="page"><Failure label="Lots could not be loaded." retry={data.reload}/></div>;
 const value=data.value!;
 return <div className="page live-lots">
  <div className="page-actions">{write&&<Button icon="add" onClick={()=>setCreate(true)}>Create Lot</Button>}</div>
  {notice&&<p role="status">{notice}</p>}
  <div className="grid3">{value.lots.map(l=>{
   const members=value.rows.filter(r=>r.lotId===l.id),dests=[...new Set(members.map(r=>r.city).filter(Boolean))],route=value.routeByLot.get(l.id)||value.routes.find(r=>r.id===l.planning_route_id&&r.state!=='archived'),live=members.filter(r=>!terminal(r.status)).length,delivered=members.filter(r=>r.status==='delivered').length;
   return <LotCardView key={l.id} name={l.name} code={l.code} adornment={canAdminister(roles,'lots.create')?<IconButton icon="delete" label={`Delete lot ${l.name}`} size="sm" onClick={()=>{archive.reset();setRemove(l);}}/>:undefined} warning={!route} route={route?<span><b className="mono">{route.carrier_code||route.mode.toUpperCase()}</b> → {route.destination} · {date(route.scheduled_departure_at)}</span>:<span>{members.length?'Not on a route yet':'Empty lot'}</span>} actions={<>
    {write&&<Button size="sm" icon="playlist_add" onClick={()=>setAdd(l)}>Add parcels</Button>}
    <Button size="sm" variant="outlined" icon="forward_to_inbox" disabled={!live} onClick={()=>setMessage(l)}>Message{live?` ${live}`:''}</Button>
   </>}>
    <div className="lot-figs"><div><span className="lot-fig">{members.length}</span><span className="lot-fig-l">parcels</span></div><div><span className="lot-fig">{dests.length||'—'}</span><span className="lot-fig-l">cities</span></div><div><span className="lot-fig">{live}</span><span className="lot-fig-l">moving</span></div></div>
    {members.length>0&&<div className="lot-progress" title={`${delivered} of ${members.length} delivered`}><span style={{width:`${Math.round(delivered/members.length*100)}%`}}/></div>}
    {dests.length>0&&<div className="lot-dests"><Msym name="pin_drop"/><span>{dests.slice(0,3).join(' · ')}{dests.length>3?` +${dests.length-3}`:''}</span></div>}
    {l.note&&<p className="t-body-sm muted">{l.note}</p>}
   </LotCardView>;
  })}</div>
  {!value.lots.length&&<Card variant="outlined"><EmptyState icon="layers" title="No lots yet" sub="Lots group many customers' parcels travelling together — e.g., everything on tonight's Mumbai flight. Create one to unlock batch updates." action={write?<Button icon="add" style={{marginTop:12}} onClick={()=>setCreate(true)}>Create your first lot</Button>:undefined}/></Card>}
  {(create||add)&&<LotEditor source={source} routeSource={routeSource} data={value} lot={add??undefined} close={()=>{setCreate(false);setAdd(null);}} saved={(lot,n)=>{setCreate(false);setAdd(null);data.reload();setNotice(`${lot.code} saved with ${n} selected parcel${n===1?'':'s'}.`);}}/>}
  <Dialog open={!!remove} onClose={()=>{if(!busy)setRemove(null);}} hideClose={busy} title={`Delete ${remove?.code}?`} actions={<><Button variant="text" disabled={busy} onClick={()=>setRemove(null)}>Cancel</Button><Button disabled={busy} onClick={()=>{if(remove)void archive.run(source.intent({kind:'archive',lotId:remove.id,body:{expected_version:remove.version}})).then(deleted).catch(()=>{});}}>Delete lot</Button></>}>
   <p>Parcels inside stay safe — they just become ungrouped. The lot’s history stays saved.</p><CommandNotice phase={archive.phase} code={archive.error?.code} retry={archive.canRetry?()=>{void archive.retry().then(deleted).catch(()=>{});}:undefined}/>
  </Dialog>
  {message&&<LotMessage source={source} lot={message} count={value.rows.filter(r=>r.lotId===message.id&&!terminal(r.status)).length} close={()=>setMessage(null)}/>}
 </div>;
}
function LotEditor({source,routeSource,data,lot,close,saved}:{source:LotSource;routeSource:RouteSource;data:LotData;lot?:LotDto;close:()=>void;saved:(lot:LotDto,count:number)=>void}){
 const loose=data.rows.filter(r=>!terminal(r.status)&&(lot?r.lotId!==lot.id:!r.lotId)),destinations=[...new Set(loose.map(r=>r.city).filter(Boolean))];
 const [city,setCity]=useState(destinations[0]??''),[name,setName]=useState(()=>destinations[0]?`${destinations[0]} · ${formatKolkata(new Date().toISOString(),{day:'numeric',month:'short'})}`:''),[touched,setTouched]=useState(false),[note,setNote]=useState(lot?.note??''),[routeId,setRouteId]=useState(lot?(data.routeByLot.get(lot.id)?.id??lot.planning_route_id??''):'');
 const [picked,setPicked]=useState<Set<string>>(()=>new Set(lot?[]:loose.filter(r=>r.city===destinations[0]).map(r=>r.id)));
 const plan=useRef<ReturnType<typeof lotPlan>|null>(null);
 const command=useCommand<LotDto>(()=>plan.current!.execute()),busy=command.phase==='pending'||command.phase==='uncertain',started=plan.current!==null;
 const selected=loose.filter(r=>picked.has(r.id));
 const knownWeight=selected.every(r=>r.weight!==null),knownAmount=selected.every(r=>r.amount!==null),weight=selected.reduce((s,r)=>s+(r.weight??0),0),amount=selected.reduce((s,r)=>s+(r.amount??0),0);
 const toggle=(id:string,on:boolean)=>{if(started)return;setPicked(s=>{const n=new Set(s);if(on)n.add(id);else n.delete(id);return n;});};
 function choose(next:string){setCity(next);setPicked(new Set(loose.filter(r=>r.city===next).map(r=>r.id)));if(!touched)setName(`${next} · ${formatKolkata(new Date().toISOString(),{day:'numeric',month:'short'})}`);}
 async function submit(){
  if(!plan.current)plan.current=lotPlan({lots:source,routes:routeSource,lot,attachedRouteId:lot?data.routeByLot.get(lot.id)?.id:undefined,planningSources:data.lots.filter(l=>l.id!==lot?.id&&(l.planning_entry_ids??[]).some(id=>selected.some(r=>r.entry?.id===id))),name:name.trim()||`${city} lot`,destination:cityKey(city),note,entries:selected.flatMap(r=>r.entry?[r.entry.id]:[]),parcels:selected.flatMap(r=>r.parcel?[r.parcel.id]:[]),routeId});
  try{const result=await command.run(source.intent({kind:'create',body:{name:name.trim()||`${city} lot`,destination_key:cityKey(city)}}));saved(result,selected.length);}catch{/* confirmed progress stays in the plan for an exact retry */}
 }
 const rows=(items:SavedBookingRow[],elsewhere=false)=><ul className="lotpick-list">{items.map(r=><li key={r.id}><Checkbox checked={picked.has(r.id)} onChange={v=>toggle(r.id,v)} ariaLabel={`Include ${r.docket}`} label=""/><span className="mono lotpick-dk">{r.docket}</span><span className="u-grow u-truncate">{r.name}</span>{elsewhere?<span className="lotpick-to">→ {r.city||'Destination not recorded'}</span>:<><span className="lotpick-w">{r.weight===null?'—':r.weight} kg</span><StatusPill status={r.status as ParcelStatus}/></>}</li>)}</ul>;
 return <Dialog open size="lg" title={lot?`Add parcels to ${lot.code}`:'New lot'} hideClose={busy} onClose={()=>{if(!busy)close();}} actions={<><Button variant="text" disabled={busy} onClick={close}>{started&&command.phase==='error'?'Finish later':'Cancel'}</Button><Button disabled={busy||!selected.length||!lot&&!city} onClick={()=>{void submit();}}>{started?'Retry remaining steps':lot?'Save':`Create with ${selected.length} parcel${selected.length===1?'':'s'}`}</Button></>}>
  {!loose.length?<EmptyState icon="inbox" title="No loose parcels" sub="Every moving parcel is already in a lot. Book a parcel first, or add one to an existing lot."/>:<>
   <fieldset disabled={busy||started} className="lot-editor-fields">
    {!lot&&<><span className="field-legend">Where is this lot going?</span><div className="chips-row" style={{marginTop:8}}>{destinations.map(d=><button key={d} type="button" className={`fchip${city===d?' on':''}`} aria-pressed={city===d} onClick={()=>choose(d)}>{d}<span className="fchip-n">{loose.filter(r=>r.city===d).length}</span></button>)}</div>
    <div className="form-grid" style={{marginTop:4}}><TextField label="Lot name" value={name} onChange={v=>{setName(v);setTouched(true);}} maxLength={120}/><SelectField label="Put on a route" value={routeId} onChange={setRouteId} options={[{value:'',label:'Decide later'},...data.routes.filter(r=>r.state==='planning').sort((a,b)=>Number(cityKey(b.destination)===cityKey(city))-Number(cityKey(a.destination)===cityKey(city))).map(r=>({value:r.id,label:`${r.carrier_code||r.mode.toUpperCase()} · ${r.origin} → ${r.destination} · ${date(r.scheduled_departure_at)}`}))]}/><TextField label="Note for your staff" className="span2" value={note} onChange={setNote} maxLength={1000}/></div></>}
    <div className="lotpick"><div className="lotpick-head"><span className="field-legend">Parcels in this lot</span><button type="button" className="lotpick-all" onClick={()=>setPicked(new Set((lot?loose:loose.filter(r=>r.city===city)).map(r=>r.id)))}>Select all{lot?'':` ${city}`}</button></div>
     {rows(lot?loose:loose.filter(r=>r.city===city))}
     {!lot&&loose.some(r=>r.city!==city)&&<details className="lotpick-more"><summary>Add parcels going elsewhere ({loose.filter(r=>r.city!==city).length})</summary>{rows(loose.filter(r=>r.city!==city),true)}</details>}
    </div>
   </fieldset>
   <div className="lotsum"><span><b>{selected.length}</b> parcels</span><span><b>{knownWeight?weight.toFixed(1):'—'}</b> kg</span><span><b>{knownAmount?money(amount):'—'}</b> value</span></div>
   {command.phase==='error'&&plan.current?.currentLot&&<p role="status">Lot {plan.current.currentLot.code} is saved. Remaining selections or route assignment have not completed. You can finish later without creating another lot.</p>}
   <CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().then(result=>{if(result)saved(result,selected.length);}).catch(()=>{});}:undefined}/>
  </>}
 </Dialog>;
}
function LotMessage({source,lot,count,close}:{source:LotSource;lot:LotDto;count:number;close:()=>void}){
 const [text,setText]=useState('');
 const command=useCommand(intent=>source.sendMessage(intent)),busy=command.phase==='pending'||command.phase==='uncertain';
 const result=command.result;
 return <Dialog open onClose={()=>{if(!busy)close();}} hideClose={busy} title={`Message lot ${lot.code}`} actions={<><Button variant="text" disabled={busy} onClick={close}>{result?'Done':'Cancel'}</Button>{!result&&<Button disabled={busy||!text.trim()} onClick={()=>{void command.run(source.messageIntent(lot.id,text)).catch(()=>{});}}>Send to lot</Button>}</>}><p className="t-body-sm muted" style={{marginBottom:12}}>{count} customer(s) in this lot. Delivery depends on WhatsApp setup and each customer’s consent.</p><TextArea label="Message" value={text} onChange={setText} rows={3} placeholder="Your parcel reaches Mumbai hub tonight at 11 PM…"/>
 {result?<p role="status">{result.queued} queued · {result.suppressed} suppressed by messaging policy · {result.failed} failed · {result.unavailable} planning entries without verified customer records. Queued does not mean delivered.</p>:<CommandNotice phase={command.phase} code={command.error?.code} retry={command.canRetry?()=>{void command.retry().catch(()=>{});}:undefined}/>}
 {command.phase==='error'&&command.error?.code==='TEMPORARILY_UNAVAILABLE'&&<p>Check the server’s WhatsApp configuration and validated installation before trying again.</p>}
 </Dialog>;
}
