import React,{useMemo,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import type {OperatorRole,PaymentProjection,LotMembershipDto,LotDto} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {bookingEntries,type CounterEntry} from '../data-access/booking-entries';
import {draftCode} from '../booking/form';
import {parcels,type ParcelRead} from '../data-access/parcels';
import {payments} from '../data-access/payments';
import {lots} from '../data-access/lots';
import {loadShopLogo} from '../utils/receipt';
import {usePagedResource,useResource} from './hooks';
import {DataRefresh} from './AsyncState';
import {Loading,Failure} from './AsyncState';
import {Msym} from '../components/m3/Icon';
import {Button} from '../components/m3/Button';
import {Card,EmptyState} from '../components/m3/Surface';
import {SearchBar,FilterChips,DateFilter,dateWindow,type DatePreset,type CustomRange} from '../components/m3/Controls';
import {Dialog} from '../components/m3/Dialog';
import {PageHeader} from '../components/workspace/Workspace';
import './packages.css';
import {PackagesTable} from './PackagesTable';
import {ParcelSheet,TripPicker} from './ParcelSheet';
import {CancelBookings,type CancelTarget} from './CancelBookings';
import {canAdminister} from '@shippingco/shared';

const filters=[{value:'all',label:'All'},{value:'drafts',label:'Drafts'},{value:'active',label:'Active'},{value:'delayed',label:'Delayed'},{value:'delivered',label:'Delivered'},{value:'topay',label:'To Pay'},{value:'cancelled',label:'Cancelled'}];
// The journey strip above the list: every stage a parcel passes through, in order, with
// how many are standing at each one. Pressing a stage filters the list to it.
const journey=[
 {value:'booked',label:'Booked',icon:'receipt_long'},
 {value:'checked_in',label:'At hub',icon:'warehouse'},
 {value:'dispatched',label:'Dispatched',icon:'local_shipping'},
 {value:'in_transit',label:'In transit',icon:'alt_route'},
 {value:'out_for_delivery',label:'Out for delivery',icon:'moped'},
 {value:'delivered',label:'Delivered',icon:'home'},
] as const;
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
 return {id:'entry:'+entry.id,docket:f.docket||draftCode(entry.id),name:f.name||'—',phone:f.phone||'',city:cityName(f.destination||f.recipientCity||''),address:f.recipientAddress||f.address||'',service:f.service==='express'?'Express':f.service==='same_city'?'Same-city':f.service==='standard'?'Standard':f.service||'—',weight:grams===null?null:grams/1000,amount,payment:'unknown',status:'draft',createdAt:Date.parse(entry.confirmed_at),lotId:null,lotCode:'',entry};
}
export function filterSavedBookings(rows:SavedBookingRow[],filter:string){
 if(filter==='drafts')return rows.filter(r=>r.status==='draft');
 // A draft is not work in motion: it has no parcel, so it cannot be active, delayed or paid.
 if(filter==='active')return rows.filter(r=>!['delivered','rto','cancelled','draft'].includes(r.status));
 if(filter==='delayed')return rows.filter(r=>r.status==='failed_attempt');
 if(filter==='delivered')return rows.filter(r=>r.status==='delivered');
 if(filter==='topay')return rows.filter(r=>r.payment==='topay'&&r.status!=='cancelled');
 if(filter==='cancelled')return rows.filter(r=>r.status==='cancelled');
 return stageLabels[filter]?rows.filter(r=>r.status===filter):rows;
}
const money=(paise:number|null)=>paise===null?'—':'₹'+(paise/100).toLocaleString('en-IN',{maximumFractionDigits:2});

export function SavedBookings({controller,roles,operationalBulk}:{controller:ScopeController;roles:readonly OperatorRole[];
 /** Kept for callers; the parcel sheet now carries every step itself. */
 operationalDetail?:(id:string,close:()=>void,refresh:()=>void,busy:(value:boolean)=>void)=>React.ReactNode;operationalBulk?:(rows:ParcelRead[],action:'check_in'|'dispatch',busy:(value:boolean)=>void,refresh:()=>void,done:()=>void)=>React.ReactNode}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]),entrySource=useMemo(()=>bookingEntries(api),[api]),lotSource=useMemo(()=>lots(api),[api]);
 const [params,setParams]=useSearchParams();
 const canCancel=roles.includes('operator')||canAdminister(roles,'bookings.cancel');
 const [cancelling,setCancelling]=useState<CancelTarget[]|null>(null);
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
   return {id:'parcel:'+p.id,docket:p.docket,name:p.sender.name,phone:p.sender.phone_display,city:cityName(p.details?.city||p.destination_key||lot?.destination_key||''),address:p.recipient.address,service:'—',weight:p.weight_grams/1000,amount:balance?.gross_paise??null,payment:balance?balance.outstanding_paise===0?'paid':'topay':'unknown',status:p.status,createdAt:Date.parse(p.confirmed_at),lotId:member?.lot_id??null,lotCode:lot?.code??(member?'Assigned':''),parcel:p};
  });
  const planningLots=new Map((lotPage.value?.items??[]).filter(l=>l.state==='active').flatMap(l=>(l.planning_entry_ids??[]).map(id=>[id,l] as const)));
  return [...(entries.value?.items??[]).map(entry=>{const row=counterBookingRow(entry),lot=planningLots.get(entry.id);return {...row,lotId:lot?.id??null,lotCode:lot?.code??''};}),...shipmentRows];
 },[page.items,entries.value,metadata.value,lotPage.value]);
 // The parcels a check-in or send-out acts on are fixed when the sheet opens. They used to be
 // read live from the list, so the list's own refresh after a successful check-in changed
 // them under the sheet: the parcels were now "at hub", none were "waiting to be checked
 // in", and the sheet threw away its own success and said there was nothing to do.
 const [bulk,setBulk]=useState<{action:'check_in'|'dispatch';rows:ParcelRead[]}|null>(null),[bulkBusy,setBulkBusy]=useState(false);
 const [q,setQ]=useState(''),[filter,setFilter]=useState(params.get('filter')||'all'),[range,setRange]=useState<DatePreset>(params.get('booked')==='today'?'today':'all'),[custom,setCustom]=useState<CustomRange>({from:'',to:''});
 const [sort,setSort]=useState<{key:'createdAt'|'docket'|'amount';dir:1|-1}>({key:'createdAt',dir:-1}),[picked,setPicked]=useState<Record<string,boolean>>({});
 const selected=params.get('open')||params.get('parcel');
 const [openId,setOpenId]=useState<string|null>(selected?(selected.startsWith('entry:')||selected.startsWith('parcel:')?selected:'parcel:'+selected):null);
 const searched=useMemo(()=>{const text=q.trim().toLowerCase(),[from,to]=dateWindow(range,custom);return allRows.filter(r=>r.createdAt>=from&&r.createdAt<=to&&(!text||(r.docket+' '+r.name+' '+r.phone+' '+r.city).toLowerCase().includes(text)));},[allRows,q,range,custom]);
 const chipOptions=filters;
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
 const finishBulk=()=>{setBulk(null);setPicked({});refresh();};
 const openBulk=(action:'check_in'|'dispatch',rows:ParcelRead[])=>{if(!bulkBusy&&rows.length&&(action==='dispatch'||operationalBulk))setBulk({action,rows});};
 const stageCounts=Object.fromEntries(journey.map(stage=>[stage.value,searched.filter(r=>r.status===stage.value).length]));
 return <div className="page saved-bookings-demo pkg-page" aria-label="Saved bookings">
  <PageHeader title="Packages"
   actions={<DataRefresh resource={{phase:[page,entries,metadata,lotPage].some(r=>r.phase==='loading')?'loading':'ready',reload:refresh}}/>}/>
  {/* Where every parcel is, in the order a parcel moves. The busiest stages carry the
      accent; an empty stage stays drawn so the strip can be read by position. */}
  <nav className="pkg-journey" aria-label="Parcel journey">
   <ol>{journey.map(stage=>{const n=stageCounts[stage.value]??0,on=filter===stage.value;
    return <li key={stage.value} className={'pkg-stage'+(on?' is-on':'')+(n?' has-n':'')}>
     <button type="button" aria-pressed={on} onClick={()=>setFilter(on?'all':stage.value)}
      aria-label={`${stage.label}: ${n} ${n===1?'parcel':'parcels'}`}>
      <span className="pkg-stage-dot" aria-hidden="true"><Msym name={stage.icon}/></span>
      <span className="pkg-stage-n">{n}</span>
      <span className="pkg-stage-label">{stage.label}</span>
     </button>
    </li>;})}</ol>
  </nav>
  <div className="toolbar pkg-toolbar"><SearchBar value={q} onChange={setQ} autoFocus placeholder="Search docket, name, phone or city" label="Search packages"/><DateFilter preset={range} onPreset={setRange} custom={custom} onCustom={setCustom}/></div>
  <FilterChips className="pkg-tabs" options={chipOptions} value={filter} onChange={setFilter} counts={counts}/>
  {page.phase==='error'&&<Failure retry={page.reload} label="Shipment bookings could not be loaded."/>}
  {entries.phase==='error'&&<Failure retry={entries.reload} label="Saved bookings could not be loaded."/>}
  <Card className="pkg-card">
  <PackagesTable rows={list} picked={picked} busy={bulkBusy} allShown={allShown} actions={!!operationalBulk}
   onPick={(id,value)=>setPicked(p=>({...p,[id]:value}))} onPickAll={value=>setPicked(value?Object.fromEntries(list.map(r=>[r.id,true])):{})}
   sortIcon={sortIcon} onSort={toggleSort} onOpen={setOpenId}
   onCancel={canCancel?row=>setCancelling(cancelTargets([row])):undefined}
   onAction={(row,action)=>{if(action.kind==='finish'){window.location.hash='#/business/new-booking?draft='+row.entry!.id;return;}if(row.parcel)openBulk(action.kind,[row.parcel]);}}/>
  {(page.phase==='loading'||entries.phase==='loading')&&!list.length?<Loading label="Loading bookings…"/>:!list.length&&<EmptyState icon={q?'search_off':'inventory_2'} title={q?'Nothing matches that search':'No packages here'} sub={q?'Try a docket number, name or phone.':'Parcels appear here as soon as they are booked.'} action={q?<Button variant="outlined" style={{marginTop:12}} onClick={()=>setQ('')}>Clear search</Button>:undefined}/>}
  </Card>
  {page.page.has_more&&<Button variant="outlined" onClick={page.loadMore} disabled={page.phase==='more'}>Load more bookings</Button>}
  {/* The chosen-parcels bar floats over the bottom of the list, where the thumb already
      is, instead of pushing the table down the moment a box is ticked. */}
  {pickedIds.length>0&&<div className="pkg-bulk-dock"><BulkBar chosen={pickedIds.length} drafts={pickedIds.length-selectedParcels.length}
   hidden={pickedIds.filter(id=>!list.some(row=>row.id===id)).length}
   notBooked={selectedParcels.filter(p=>p.status!=='booked').length}
   notAtHub={selectedParcels.filter(p=>p.status!=='checked_in').length}
   enabled={canBulk&&!bulkBusy} busy={bulkBusy}
   act={action=>openBulk(action,selectedParcels)} clear={()=>setPicked({})}
   cancel={canCancel?{
    // Always on the bar so it can be found. Any number of bookings can go at once, as long
    // as none of the chosen parcels has left on a trip yet.
    why:selectedParcels.length!==pickedIds.length||selectedParcels.some(p=>!cancellable(p.status))
     ?(pickedIds.length===1?'only a parcel that has not left on a trip can be cancelled.':'only parcels that have not left on a trip can be cancelled.'):null,
    run:()=>setCancelling(cancelTargets(allRows.filter(r=>picked[r.id]&&r.parcel)))}:undefined}/></div>}
  {bulk&&operationalBulk&&bulk.action==='check_in'&&<Dialog open size="lg" title="Check in at the hub" hideClose={bulkBusy} onClose={()=>{if(!bulkBusy)setBulk(null);}}>{operationalBulk(bulk.rows,bulk.action,setBulkBusy,refresh,finishBulk)}</Dialog>}
  {/* Sending parcels out means putting them on a trip; the trip itself dispatches them
      when it leaves. The old sheet asked for a dispatch-list id here instead. */}
  {bulk&&bulk.action==='dispatch'&&<Dialog open size="lg" title={bulk.rows.length===1?'Put it on a trip':`Put ${bulk.rows.length} parcels on a trip`} hideClose={bulkBusy} onClose={()=>{if(!bulkBusy)setBulk(null);}}>
   <TripPicker api={api} parcelIds={bulk.rows.map(row=>row.id)} busy={setBulkBusy} done={()=>{setPicked({});refresh();}} compact/>
  </Dialog>}
  {open&&<ParcelSheet key={open.id} row={open} api={api} roles={roles} lots={lotPage.value?.items??[]} close={close} refresh={refresh}
   onCancel={canCancel?()=>{setCancelling(cancelTargets([open]));close();}:undefined}/>}
  {cancelling&&<CancelBookings api={api} targets={cancelling} close={()=>setCancelling(null)} onCancelled={()=>{setPicked({});refresh();}}/>}
 </div>;
}


/**
 * The bar that appears when parcels are ticked.
 *
 * Three things it has to get right, and did not:
 *
 *  - It said "2 selected". An operator about to move other people's parcels reads
 *    a count of parcels, not a count of selections.
 *  - A disabled action gave no reason, or hid one in a `title` attribute nobody
 *    hovers. An action the operator can see but cannot press, with no explanation,
 *    reads as a broken button.
 *  - Ticking a parcel and then changing the filter hid it while keeping it chosen,
 *    so the count disagreed with the table and nothing said why.
 */
export function BulkBar({chosen,drafts,hidden,notBooked,notAtHub,enabled,busy,act,clear,cancel}:{
 chosen:number;drafts:number;hidden:number;notBooked:number;notAtHub:number;
 enabled:boolean;busy:boolean;act:(action:'check_in'|'dispatch')=>void;clear:()=>void;
 /** Present when the operator may cancel bookings; `why` says why it cannot be pressed for these parcels. */
 cancel?:{why:string|null;run:()=>void};
}){
 const parcels=chosen===1?'parcel':'parcels';
 const blocked=(n:number,state:string)=>{
  if(n===0)return null;
  if(drafts===chosen)return `${drafts===1?'That is a draft':'Those are drafts'}, not booked parcels yet.`;
  // When everything chosen is blocked, saying "3 of the 3" makes the operator do
  // arithmetic to reach "all of them".
  if(n>=chosen)return chosen===1?`It is ${state}.`:`None of them is ${state.replace(/^not /,'')}.`;
  return `${n} of the ${chosen} ${n===1?'is':'are'} ${state}.`;
 };
 const checkInWhy=blocked(notBooked+drafts,'not waiting to be checked in');
 const dispatchWhy=blocked(notAtHub+drafts,'not at a hub yet');
 return <div className="bulkbar" role="group" aria-label="Chosen parcels">
  <div className="bulkbar-head">
   <span className="bulkbar-n">{chosen} {parcels} chosen</span>
   {hidden>0&&<span className="bulkbar-hidden">{hidden} not shown by this filter</span>}
  </div>
  <div className="bulkbar-actions">
   <Button size="sm" variant="filled" icon="warehouse" disabled={!enabled||!!checkInWhy} onClick={()=>act('check_in')}>Check in at hub</Button>
   <Button size="sm" variant="outlined" icon="local_shipping" disabled={!enabled||!!dispatchWhy} onClick={()=>act('dispatch')}>Add to a trip</Button>
   {cancel&&<button type="button" className="bulkbar-cancel" disabled={busy||!!cancel.why} onClick={cancel.run}>Cancel booking</button>}
   <button type="button" className="bulkbar-clear" disabled={busy} onClick={clear}>Clear</button>
  </div>
  {(checkInWhy||dispatchWhy||cancel?.why)&&<p className="bulkbar-why">{[checkInWhy&&dispatchWhy&&checkInWhy===dispatchWhy?checkInWhy
   :[checkInWhy&&`Cannot check in — ${checkInWhy.charAt(0).toLowerCase()+checkInWhy.slice(1)}`,
     dispatchWhy&&`Cannot add to a trip — ${dispatchWhy.charAt(0).toLowerCase()+dispatchWhy.slice(1)}`].filter(Boolean).join(' '),
   cancel?.why&&`Cannot cancel — ${cancel.why}`].filter(Boolean).join(' ')}</p>}
 </div>;
}

/** A booking can be cancelled until its parcels leave on a trip. */
export const cancellable=(status:string)=>status==='booked'||status==='checked_in';
/** One entry per booking: ticking two parcels of the same booking cancels it once. */
function cancelTargets(rows:SavedBookingRow[]):CancelTarget[]{
 const seen=new Map<string,CancelTarget>();
 for(const row of rows)if(row.parcel&&!seen.has(row.parcel.booking_id))seen.set(row.parcel.booking_id,{bookingId:row.parcel.booking_id,docket:row.docket,customer:row.name||null});
 return [...seen.values()];
}

export async function printCounterRecord(row:SavedBookingRow,api:ReturnType<typeof scopedApi>){
 const win=window.open('','_blank','width=760,height=900');if(!win)throw new Error('PRINT_WINDOW_BLOCKED');
 const doc=win.document;doc.title='Booking '+row.docket;const logo=await loadShopLogo(api);if(api.scope.signal.aborted){win.close();throw Error('Receipt access changed.');}if(logo){const img=doc.createElement('img');img.src=logo;img.alt='Shop logo';img.width=56;img.height=56;doc.body.append(img);}
 const title=doc.createElement('h1');title.textContent='Booking draft — not a booking';doc.body.append(title);
 const table=doc.createElement('table');
 for(const [label,value] of [['Draft number',row.docket],['Customer',row.name],['Phone',row.phone||'Not recorded'],['Destination',row.city||'Not recorded'],['Address',row.address||'Not recorded'],['Entered charges',money(row.amount)],['Payment','Not recorded']]){const tr=doc.createElement('tr'),th=doc.createElement('th'),td=doc.createElement('td');th.textContent=label;td.textContent=value;tr.append(th,td);table.append(tr);}
 doc.body.append(table);const note=doc.createElement('p');note.textContent='This is an unfinished counter draft. No docket has been issued, the parcel cannot be dispatched, and this is not a tax invoice or payment receipt.';doc.body.append(note);win.print();
}
