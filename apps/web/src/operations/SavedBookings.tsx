import React,{useMemo,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import type {OperatorRole,PaymentProjection,LotMembershipDto,LotDto,LotMembershipResult} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {bookingEntries,type CounterEntry} from '../data-access/booking-entries';
import {parcels,type ParcelRead} from '../data-access/parcels';
import {payments} from '../data-access/payments';
import {lots} from '../data-access/lots';
import {receipts} from '../data-access/receipts';
import type {ScopedApi} from '../data-access/scoped-api';
import {printReceipt} from '../utils/receipt';
import {useCommand,usePagedResource,useResource} from './hooks';
import {CommandNotice} from './AsyncState';
import {Loading,Failure} from './AsyncState';
import {Msym} from '../components/m3/Icon';
import {Button,Checkbox} from '../components/m3/Button';
import {Card,StatusPill,EmptyState} from '../components/m3/Surface';
import {SearchBar,FilterChips,DateFilter,dateWindow,type DatePreset,type CustomRange} from '../components/m3/Controls';
import {TextArea,SelectField} from '../components/m3/Input';
import {Dialog} from '../components/m3/Dialog';
import {Journey} from '../components/m3/Journey';
import type {ParcelStatus as JourneyStatus} from '../data/types';

const filters=[{value:'all',label:'All'},{value:'active',label:'Active'},{value:'delayed',label:'Delayed'},{value:'delivered',label:'Delivered'},{value:'topay',label:'To Pay'}];
const stageLabels:Record<string,string>={booked:'Booked',checked_in:'At hub',dispatched:'Dispatched',in_transit:'On the way',out_for_delivery:'Out for delivery'};
export interface SavedBookingRow{
 id:string;docket:string;name:string;phone:string;city:string;address:string;service:string;weight:number|null;amount:number|null;payment:'paid'|'topay'|'unknown';status:string;createdAt:number;lotId:string|null;lotCode:string;entry?:CounterEntry;parcel?:ParcelRead;
}
const cityName=(value:string)=>value.replaceAll('_',' ').toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase());
const integer=(value?:string)=>value!==undefined&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
export function counterBookingRow(entry:CounterEntry):SavedBookingRow{
 const f=entry.data.fields,freight=integer(f.override),packing=integer(f.packing),sum=BigInt(freight??0)+BigInt(packing??0);
 const amount=freight===null&&packing===null||sum>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(sum);
 const grams=integer(f.weight);
 return {id:'entry:'+entry.id,docket:f.docket||entry.id.slice(0,8),name:f.name||'—',phone:f.phone||'',city:cityName(f.destination||f.recipientCity||''),address:f.recipientAddress||f.address||'',service:f.service==='express'?'Express':f.service==='same_city'?'Same-city':f.service==='standard'?'Standard':f.service||'—',weight:grams===null?null:grams/1000,amount,payment:'unknown',status:'booked',createdAt:Date.parse(entry.confirmed_at),lotId:null,lotCode:'',entry};
}
export function filterSavedBookings(rows:SavedBookingRow[],filter:string){
 if(filter==='active')return rows.filter(r=>!['delivered','rto','cancelled'].includes(r.status));
 if(filter==='delayed')return rows.filter(r=>r.status==='failed_attempt');
 if(filter==='delivered')return rows.filter(r=>r.status==='delivered');
 if(filter==='topay')return rows.filter(r=>r.payment==='topay');
 return stageLabels[filter]?rows.filter(r=>r.status===filter):rows;
}
const money=(paise:number|null)=>paise===null?'—':'₹'+(paise/100).toLocaleString('en-IN',{maximumFractionDigits:2});
const time=(ts:number)=>new Date(ts).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});
const statusPill=(row:SavedBookingRow)=><StatusPill status={row.status as JourneyStatus} labelOverride={row.status==='held_at_office'?'At office':row.status==='cancelled'?'Cancelled':undefined}/>;
const payChip=(row:SavedBookingRow)=><span className={'pill '+(row.payment==='paid'?'st-delivered':row.payment==='topay'?'pill-warn':'')}>{row.payment==='paid'?'Paid':row.payment==='topay'?'To Pay':'Not recorded'}</span>;

export function SavedBookings({controller,roles,operationalDetail,operationalBulk}:{controller:ScopeController;roles:readonly OperatorRole[];operationalDetail:(id:string,close:()=>void,refresh:()=>void,busy:(value:boolean)=>void)=>React.ReactNode;operationalBulk?:(rows:ParcelRead[],action:'check_in'|'dispatch',busy:(value:boolean)=>void,refresh:()=>void)=>React.ReactNode}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]),entrySource=useMemo(()=>bookingEntries(api),[api]),lotSource=useMemo(()=>lots(api),[api]);
 const [params,setParams]=useSearchParams();
 const canCreate=roles.some(r=>['org_admin','franchise_admin','operator'].includes(r)),canMoney=roles.some(r=>['org_admin','franchise_admin','accountant'].includes(r));
 const page=usePagedResource(api.franchise+'saved-bookings',(cursor,signal)=>source.list({limit:50,cursor},signal));
 const entries=useResource(api.franchise+'saved-entries',signal=>canCreate?entrySource.list(signal):Promise.resolve({items:[]}));
 const lotPage=useResource(api.franchise+'saved-lots',signal=>lotSource.list({limit:100},signal).catch(()=>({items:[] as LotDto[],page:{has_more:false,next_cursor:null}})));
 const metadataKey=page.items.map(p=>p.id+':'+p.version).join(',');
 const metadata=useResource(metadataKey,async signal=>{
  const ids=[...new Set(page.items.map(p=>p.booking_id))];
  const balances=canMoney?await Promise.all(ids.map(async id=>[id,await payments(api,id).read(signal).catch(()=>null)] as const)):[];
  const memberships=await Promise.all(page.items.map(async p=>[p.id,await lotSource.currentMembership(p.id,signal).catch(()=>null)] as const));
  return {balances:new Map<string,PaymentProjection|null>(balances),memberships:new Map<string,LotMembershipDto|null>(memberships)};
 });
 const allRows=useMemo(()=>{
  const lotMap=new Map((lotPage.value?.items??[]).map(l=>[l.id,l]));
  const shipmentRows:SavedBookingRow[]=page.items.map(p=>{
   const balance=metadata.value?.balances.get(p.booking_id),member=metadata.value?.memberships.get(p.id),lot=member?lotMap.get(member.lot_id):null;
   return {id:'parcel:'+p.id,docket:p.docket,name:p.sender.name,phone:p.sender.phone_display,city:cityName(p.details?.city||lot?.destination_key||''),address:p.recipient.address,service:'—',weight:p.weight_grams/1000,amount:balance?.gross_paise??null,payment:balance?balance.outstanding_paise===0?'paid':'topay':'unknown',status:p.status,createdAt:Date.parse(p.confirmed_at),lotId:member?.lot_id??null,lotCode:lot?.code??(member?'Assigned':''),parcel:p};
  });
  return [...(entries.value?.items??[]).map(counterBookingRow),...shipmentRows];
 },[page.items,entries.value,metadata.value,lotPage.value]);
 const [bulkAction,setBulkAction]=useState<'check_in'|'dispatch'|null>(null),[bulkBusy,setBulkBusy]=useState(false);
 const [q,setQ]=useState(''),[filter,setFilter]=useState(params.get('filter')||'all'),[range,setRange]=useState<DatePreset>(params.get('booked')==='today'?'today':'all'),[custom,setCustom]=useState<CustomRange>({from:'',to:''});
 const [sort,setSort]=useState<{key:'createdAt'|'docket'|'amount';dir:1|-1}>({key:'createdAt',dir:-1}),[picked,setPicked]=useState<Record<string,boolean>>({});
 const selected=params.get('open')||params.get('parcel');
 const [openId,setOpenId]=useState<string|null>(selected?(selected.startsWith('entry:')||selected.startsWith('parcel:')?selected:'parcel:'+selected):null);
 const searched=useMemo(()=>{const text=q.trim().toLowerCase(),[from,to]=dateWindow(range,custom);return allRows.filter(r=>r.createdAt>=from&&r.createdAt<=to&&(!text||(r.docket+' '+r.name+' '+r.phone+' '+r.city).toLowerCase().includes(text)));},[allRows,q,range,custom]);
 const chipOptions=stageLabels[filter]?[...filters,{value:filter,label:stageLabels[filter]}]:filters;
 const counts=Object.fromEntries(chipOptions.map(f=>[f.value,filterSavedBookings(searched,f.value).length]));
 const list=useMemo(()=>[...filterSavedBookings(searched,filter)].sort((a,b)=>{
  if(sort.key==='amount'){if(a.amount===null)return b.amount===null?0:1;if(b.amount===null)return -1;return (a.amount-b.amount)*sort.dir;}
  return (sort.key==='docket'?a.docket.localeCompare(b.docket):a.createdAt-b.createdAt)*sort.dir;
 }),[searched,filter,sort]);
 const toggleSort=(key:'docket'|'amount')=>setSort(s=>({key,dir:s.key===key?(s.dir===1?-1:1):key==='docket'?1:-1}));
 const sortIcon=(key:string)=>sort.key!==key?'unfold_more':sort.dir===1?'arrow_upward':'arrow_downward';
 const pickedIds=Object.keys(picked).filter(k=>picked[k]),allShown=list.length>0&&list.every(r=>picked[r.id]);
 const selectedParcels=allRows.filter(r=>picked[r.id]&&r.parcel).map(r=>r.parcel!);
 const canBulk=!!operationalBulk&&selectedParcels.length===pickedIds.length&&selectedParcels.length>0;
 const open=allRows.find(r=>r.id===openId),refresh=()=>{page.reload();entries.reload();metadata.reload();lotPage.reload();};
 const close=()=>{setOpenId(null);if(selected){const next=new URLSearchParams(params);next.delete('open');next.delete('parcel');setParams(next,{replace:true});}};
 return <div className="page saved-bookings-demo" aria-label="Saved bookings">
  <h1 className="workspace-visually-hidden">Packages</h1>
  <div className="toolbar"><SearchBar value={q} onChange={setQ} autoFocus placeholder="Search docket, name, phone or city" label="Search packages"/><DateFilter preset={range} onPreset={setRange} custom={custom} onCustom={setCustom}/></div>
  <FilterChips options={chipOptions} value={filter} onChange={setFilter} counts={counts}/>
  {pickedIds.length>0&&<div className="bulkbar"><span className="bulkbar-n">{pickedIds.length} selected</span><Button size="sm" variant="outlined" icon="warehouse" disabled={!canBulk||bulkBusy||selectedParcels.some(p=>p.status!=='booked')} onClick={()=>setBulkAction('check_in')}>Check in at hub</Button><Button size="sm" variant="outlined" icon="local_shipping" disabled={!canBulk||bulkBusy||selectedParcels.some(p=>p.status!=='checked_in')} onClick={()=>setBulkAction('dispatch')}>Dispatch</Button><Button size="sm" variant="outlined" icon="layers" disabled title="Open a booking to assign its lot">Move to lot</Button><button type="button" className="bulkbar-clear" disabled={bulkBusy} onClick={()=>setPicked({})}>Clear</button></div>}
  {page.phase==='error'&&<Failure retry={page.reload} label="Shipment bookings could not be loaded."/>}
  {entries.phase==='error'&&<Failure retry={entries.reload} label="Saved bookings could not be loaded."/>}
  <Card><div className="tbl-wrap"><table className="tbl" aria-label="Packages"><thead><tr>
   <th className="tbl-check"><Checkbox checked={allShown} onChange={v=>{if(bulkBusy)return;setPicked(v?Object.fromEntries(list.map(r=>[r.id,true])):{});}} ariaLabel="Select all shown bookings"/></th>
   <th><button type="button" className="th-sort" onClick={()=>toggleSort('docket')}>Docket <Msym name={sortIcon('docket')}/></button></th><th>Customer</th><th>To</th><th>Lot</th>
   <th className="ta-r"><button type="button" className="th-sort is-r" onClick={()=>toggleSort('amount')}>Amount <Msym name={sortIcon('amount')}/></button></th><th>Payment</th><th>Status</th>
  </tr></thead><tbody>{list.map(r=><tr key={r.id} tabIndex={0} className={picked[r.id]?'is-picked':undefined} onClick={()=>setOpenId(r.id)} onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();setOpenId(r.id);}}}>
   <td className="tbl-check" onClick={e=>e.stopPropagation()}><Checkbox checked={!!picked[r.id]} onChange={v=>{if(!bulkBusy)setPicked(p=>({...p,[r.id]:v}));}} ariaLabel={'Select '+r.docket}/></td>
   <td className="mono cell-main">{r.docket}</td><td><div className="cell-main">{r.name}</div><div className="cell-sub">{r.phone||'—'}</div></td><td>{r.city||'—'}</td><td className="muted t-body-sm">{r.lotCode||'—'}</td><td className="ta-r" title={r.entry?'Entered charges; tax not assessed':undefined}>{money(r.amount)}</td><td>{payChip(r)}</td><td><span style={{display:'inline-flex',gap:6}}>{statusPill(r)}{r.status==='failed_attempt'&&<StatusPill status={'delayed' as JourneyStatus} labelOverride="Delayed"/>}</span></td>
  </tr>)}</tbody></table>
  {(page.phase==='loading'||entries.phase==='loading')&&!list.length?<Loading label="Loading bookings…"/>:!list.length&&<EmptyState icon={q?'search_off':'inventory_2'} title={q?'Nothing matches that search':'No packages here'} sub={q?'Try a docket number, name or phone.':'Parcels appear here as soon as they are booked.'} action={q?<Button variant="outlined" style={{marginTop:12}} onClick={()=>setQ('')}>Clear search</Button>:undefined}/>}
  </div></Card>
  {page.page.has_more&&<Button variant="outlined" onClick={page.loadMore} disabled={page.phase==='more'}>Load more bookings</Button>}
  {bulkAction&&operationalBulk&&<Dialog open size="lg" title={bulkAction==='check_in'?'Check in selected parcels':'Dispatch selected parcels'} hideClose={bulkBusy} onClose={()=>{if(!bulkBusy)setBulkAction(null);}}>{operationalBulk(selectedParcels,bulkAction,setBulkBusy,refresh)}</Dialog>}
  {open&&<SavedBookingDialog key={open.id} row={open} api={api} lots={lotPage.value?.items??[]} close={close} refresh={refresh} operationalDetail={operationalDetail}/>}
 </div>;
}

function SavedBookingDialog({row,api,lots:lotList,close,refresh,operationalDetail}:{row:SavedBookingRow;api:ScopedApi;lots:LotDto[];close:()=>void;refresh:()=>void;operationalDetail:(id:string,close:()=>void,refresh:()=>void,busy:(value:boolean)=>void)=>React.ReactNode}){
 const source=useMemo(()=>parcels(api),[api]);
 const timeline=useResource(row.id+'saved-timeline',signal=>row.parcel?source.timeline(row.parcel.id,signal):Promise.resolve({items:[]}));
 const lotSource=useMemo(()=>lots(api),[api]);
 const membership=useResource(row.id+'detail-lot',signal=>row.parcel?lotSource.currentMembership(row.parcel.id,signal):Promise.resolve(null));
 const lotCommand=useCommand<LotDto|LotMembershipResult>(value=>lotSource.execute(value));
 const [operationBusy,setOperationBusy]=useState(false);
 const moving=operationBusy||lotCommand.phase==='pending'||lotCommand.phase==='uncertain';
 async function assignLot(id:string){
  if(!row.parcel||moving)return;
  try{
   const member=membership.value;
   if(member){const previous=lotList.find(l=>l.id===member.lot_id)??await lotSource.read(member.lot_id);
    if(id){const target=lotList.find(l=>l.id===id);if(!target||id===member.lot_id)return;await lotCommand.run(lotSource.intent({kind:'move',lotId:previous.id,parcelId:row.parcel.id,body:{expected_version:previous.version,membership_id:member.id,target_lot_id:target.id,expected_target_version:target.version}}));}
    else await lotCommand.run(lotSource.intent({kind:'remove',lotId:previous.id,parcelId:row.parcel.id,body:{expected_version:previous.version,membership_id:member.id}}));
   }else{const target=lotList.find(l=>l.id===id);if(!target)return;await lotCommand.run(lotSource.intent({kind:'add',lotId:target.id,body:{expected_version:target.version,parcel_id:row.parcel.id}}));}
   membership.reload();refresh();
  }catch{/* CommandNotice retains the immutable request. */}
 }
 const [msgText,setMsgText]=useState(''),[showActions,setShowActions]=useState(false),[printMessage,setPrintMessage]=useState(''),[printing,setPrinting]=useState(false);
 const items=row.entry?[{event_id:row.entry.id,sequence:1,occurred_at:row.entry.confirmed_at,code:'parcel.booked',status:'booked',label:'Booking created at counter'}]:timeline.value?.items??[];
 const flowStatus=(['booked','checked_in','dispatched','in_transit','out_for_delivery','delivered','failed_attempt','rto'].includes(row.status)?row.status:'booked') as JourneyStatus;
 const service=row.service+(row.weight===null?'':` · ${row.weight.toLocaleString('en-IN')} kg`);
 async function print(){if(printing)return;setPrinting(true);setPrintMessage('');try{
  if(row.parcel)printReceipt(await receipts(api).booking(row.parcel.booking_id));
  else printCounterRecord(row);
 }catch{setPrintMessage('The receipt could not be opened. Retry printing without creating another booking.');}finally{setPrinting(false);}}
 return <Dialog open onClose={()=>{if(!moving)close();}} hideClose={moving} size="lg" title={<span className="u-row mono" style={{fontSize:19}}>{row.docket} {statusPill(row)}</span>}>
  <div className="jrn-wrap"><Journey status={flowStatus} timeline={items.map(t=>({ts:Date.parse(t.occurred_at),status:t.status as JourneyStatus,title:t.label}))} format={ts=>new Date(ts).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}/></div>
  <div className="grid2" style={{gap:20}}><div>
   <div className="ph-box u-center u-col" style={{height:130,borderRadius:'var(--shape-md)',gap:4}}><Msym name="image" style={{fontSize:30}}/><span className="t-body-sm">No parcel photo</span></div>
   <div className="t-body-sm" style={{display:'grid',gap:8,marginTop:14}}>{[['Customer',[row.name,row.phone].filter(Boolean).join(' · ')],['Address',row.address||'—'],['Service',service],['Amount',money(row.amount)],['Payment',row.payment==='paid'?'Paid':row.payment==='topay'?'To Pay':'Not recorded'],['Lot',row.lotCode||'—']].map(([k,v])=><div key={k} className="u-between" style={{borderBottom:'1px solid var(--md-outline-variant)',paddingBottom:6}}><span className="muted">{k}</span><span style={{textAlign:'right'}}>{v}</span></div>)}</div>
   {!['delivered','rto','cancelled'].includes(row.status)&&<SelectField label="Move to lot" value={row.lotId||''} disabled={!row.parcel||moving||membership.phase==='loading'} onChange={id=>void assignLot(id)} options={[{value:'',label:'Not in a lot'},...lotList.filter(l=>l.state==='active'||l.id===row.lotId).map(l=>({value:l.id,label:`${l.code} · ${l.name}`}))]} trailing="layers" style={{marginTop:12}}/>}
   {['booked','checked_in','dispatched','in_transit','failed_attempt'].includes(row.status)&&<div className="u-row u-wrap" style={{marginTop:12}}><Button size="sm" icon={row.status==='booked'?'warehouse':row.status==='checked_in'?'local_shipping':'mark_email_read'} disabled={!row.parcel||moving} title={!row.parcel?'Shipment details are needed before intake or dispatch':undefined} onClick={()=>setShowActions(true)}>{row.status==='booked'?'Check In at Hub':row.status==='checked_in'?'Dispatch':row.status==='failed_attempt'?'Try Delivery Again':'Out for Delivery'}</Button></div>}
   <CommandNotice phase={lotCommand.phase} code={lotCommand.error?.code} retry={lotCommand.canRetry?()=>{void lotCommand.retry().then(()=>{membership.reload();refresh();}).catch(()=>{});}:undefined}/>
   {row.entry&&<p className="counter-help" style={{marginTop:10}}>Entered charges are shown. Tax and payment are not recorded; shipment actions need a shipment record.</p>}
  </div><div>
   <div className="section-label" style={{margin:'0 0 10px'}}>Timeline<span className="rule"/></div>
   {timeline.phase==='error'?<Button variant="text" onClick={timeline.reload}>Retry timeline</Button>:<ul className="tline">{[...items].reverse().map((t,i)=><li key={t.event_id}><span className={'node '+(t.status==='booked'&&i===items.length-1?'':'done')}><Msym name={t.status==='booked'&&i===items.length-1?'':'check'}/></span><div className="t-head">{t.code==='parcel.booked'?'Booking created at counter':t.label} <span className="t-time">{time(Date.parse(t.occurred_at))}</span></div></li>)}</ul>}
   <hr className="divider"/><div className="u-row" style={{marginBottom:8}}><Msym name="forward_to_inbox" className="muted"/><span className="t-title-md">Send custom WhatsApp update</span></div>
   <TextArea label="Message to customer" value={msgText} onChange={setMsgText} rows={2} placeholder="Your parcel reaches Mumbai hub tonight…"/>
   <div className="dlg-actions" style={{justifyContent:'flex-start',marginTop:8}}><Button size="sm" variant="tonal" icon="send" disabled title="Custom WhatsApp sending is not connected for this workspace">Send now</Button><Button size="sm" variant="text" icon="print" disabled={printing} onClick={()=>void print()}>Print receipt</Button></div>
   {printMessage&&<p role="alert">{printMessage}</p>}
  </div></div>
  {showActions&&row.parcel&&<div className="saved-booking-operation">{operationalDetail(row.parcel.id,()=>{if(!moving)setShowActions(false);},refresh,setOperationBusy)}</div>}
 </Dialog>;
}
function printCounterRecord(row:SavedBookingRow){
 const win=window.open('','_blank','width=760,height=900');if(!win)throw new Error('PRINT_WINDOW_BLOCKED');
 const doc=win.document;doc.title='Booking '+row.docket;
 const title=doc.createElement('h1');title.textContent='Booking acknowledgement';doc.body.append(title);
 const table=doc.createElement('table');
 for(const [label,value] of [['Docket',row.docket],['Customer',row.name],['Phone',row.phone||'Not recorded'],['Destination',row.city||'Not recorded'],['Address',row.address||'Not recorded'],['Entered charges',money(row.amount)],['Payment','Not recorded']]){const tr=doc.createElement('tr'),th=doc.createElement('th'),td=doc.createElement('td');th.textContent=label;td.textContent=value;tr.append(th,td);table.append(tr);}
 doc.body.append(table);const note=doc.createElement('p');note.textContent='Confirmed counter record. This acknowledgement is not a tax invoice or payment receipt.';doc.body.append(note);win.print();
}
