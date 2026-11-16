import './receipts.css';
import {useEffect,useMemo,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import type {OperatorRole,ReceiptDto} from '@shippingco/shared';
import type {ScopeController} from '../operator/scope';
import {scopedApi} from '../data-access/scoped-api';
import {parcels} from '../data-access/parcels';
import {bookingEntries} from '../data-access/booking-entries';
import {receipts} from '../data-access/receipts';
import {payments} from '../data-access/payments';
import {usePagedResource,useResource} from '../operations/hooks';
import {counterBookingRow} from '../operations/SavedBookings';
import {Loading,Failure} from '../operations/AsyncState';
import {Button,SegmentedControl} from '../components/m3/Button';
import {Card,EmptyState} from '../components/m3/Surface';
import {SearchBar,dateWindow,type DatePreset,type CustomRange} from '../components/m3/Controls';
import {TextField} from '../components/m3/Input';
import {printReceiptFor,printReceiptViewFor,downloadReceiptFor,receiptView,loadShopMarks} from '../utils/receipt';
import {counterReceiptView} from '../utils/counter-receipt';
import {ReceiptDocument} from './ReceiptDocument';
import {PageHeader} from '../components/workspace/Workspace';

/**
 * Receipts exists for one errand: a customer wants their receipt again.
 *
 * Three things follow from that and shape everything on this screen.
 *
 * It opens on today. The person asking for a reprint almost always booked today, and a list
 * that opens on all time makes every operator begin by narrowing before they can begin.
 *
 * A receipt prints from its row. Opening a detail view first added a press and a page load to
 * the only thing anyone comes here to do.
 *
 * And every print from this screen says DUPLICATE on the document, with the time it was taken.
 * That is not a setting. Two identical receipts in circulation is how a payment dispute starts,
 * and this screen is by definition the second one: the original was printed at the counter when
 * the booking was saved.
 */

const money=(paise:number|null)=>paise===null?'—':'₹'+(paise/100).toLocaleString('en-IN',{maximumFractionDigits:2});
const booked=(value:number)=>new Date(value).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});
const stamp=()=>new Date().toLocaleString('en-IN',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true});

/** Today, this week, or two dates the operator picks. Nothing else: this is a reprint errand. */
const ranges=[{value:'today',label:'Today'},{value:'week',label:'This week'},{value:'custom',label:'Any date'}];

export default function Receipts({controller,roles=[]}:{controller:ScopeController;roles?:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]),entrySource=useMemo(()=>bookingEntries(api),[api]);
 const nav=useNavigate();
 const [q,setQ]=useState('');
 // R-1: the list opens on today.
 const [range,setRange]=useState<DatePreset>('today'),[custom,setCustom]=useState<CustomRange>({from:'',to:''});
 const [printing,setPrinting]=useState(''),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 const [open,setOpen]=useState<{id:string;dto:ReceiptDto}|null>(null);
 const [shop,setShop]=useState<{logo?:string;terms?:string}>({});
 const canEntries=roles.some(r=>['org_admin','franchise_admin','operator'].includes(r)),canMoney=roles.some(r=>['org_admin','franchise_admin','accountant'].includes(r));
 const page=usePagedResource(api.franchise+'receipt-parcels',(cursor,signal)=>source.list({limit:50,cursor},signal));
 const entries=useResource(api.franchise+'receipt-entries',signal=>canEntries?entrySource.list(signal):Promise.resolve({items:[]}));
 const ids=[...new Set(page.items.map(p=>p.booking_id))];
 const issued=useResource(api.franchise+':receipts:'+ids.join(','),async signal=>Promise.all(ids.map(async id=>{
  const dto=await receipts(api).booking(id,signal).catch(()=>null);
  const balance=canMoney?await payments(api,id).read(signal).catch(()=>null):null;
  return {id,dto,balance};
 })));
 // The shop's own logo and conditions of carriage, so the document on screen is the one that prints.
 useEffect(()=>{let live=true;void loadShopMarks(api).then(marks=>{if(live)setShop(marks);});return()=>{live=false;};},[api]);
 // A scope change closes the open document rather than leaving one branch's receipt under another's name.
 useEffect(()=>controller.runtime.onInvalidate(()=>{setOpen(null);setMessage('');setFailed(false);}),[controller]);
 const rows=useMemo(()=>{
  const saved=(entries.value?.items??[]).map(entry=>({...counterBookingRow(entry),dto:null as ReceiptDto|null,bookingId:''}));
  const records=new Map(issued.value?.map(r=>[r.id,r]));
  for(const id of [...new Set(page.items.map(p=>p.booking_id))]){
   const p=page.items.find(p=>p.booking_id===id)!,record=records.get(id),dto=record?.dto;
   saved.push({id:'booking:'+id,docket:[...new Set(page.items.filter(p=>p.booking_id===id).map(p=>p.docket))].join(', '),name:dto?.booking.customer_name??p.sender.name,phone:p.sender.phone_display,city:p.details?.city||'',address:p.recipient.address,service:dto?.booking.service||'',weight:null,amount:dto?.kind==='booking_charge'?dto.charges.tax.final_payable_paise:null,payment:record?.balance?(record.balance.outstanding_paise===0?'paid':'topay'):'unknown',status:p.status,createdAt:Date.parse(p.confirmed_at),lotId:null,lotCode:'',dto:dto??null,bookingId:id});
  }
  const text=q.trim().toLowerCase(),[from,to]=dateWindow(range,custom);
  return saved.filter(r=>r.createdAt>=from&&r.createdAt<=to&&(!text||(r.docket+' '+r.name+' '+r.phone+' '+r.city).toLowerCase().includes(text)));
 },[entries.value,page.items,issued.value,q,range,custom]);
 const total=rows.some(r=>r.amount===null)?null:rows.reduce((sum,r)=>sum+BigInt(r.amount!),0n);
 const filtered=!!q.trim()||range!=='today';

 /** R-3: prints from the row, without navigating. R-9: and says what it is. */
 async function reprint(row:typeof rows[number]){
  if(printing)return;setPrinting(row.id);setMessage('');setFailed(false);
  try{
   if(row.entry)await printReceiptViewFor(api,{...counterReceiptView(row.entry,controller.snapshot().context?.franchises.find(f=>f.id===api.franchise)?.organization.display_name||'Booking acknowledgement'),duplicate:stamp()});
   else {
    const dto=row.dto??await receipts(api).booking(row.bookingId);
    if(controller.runtime.isCurrent(api.scope))await printReceiptFor(api,dto,{duplicate:stamp()});
   }
   setMessage('Printed. Every copy from this screen is marked DUPLICATE with the time it was taken.');
  }
  catch{setFailed(true);setMessage('Did not print. Try again or download. The receipt itself is unaffected — it is saved, numbered and unchanged.');}
  finally{setPrinting('');}
 }

 async function openRow(row:typeof rows[number]){
  if(row.entry||!row.bookingId)return;setMessage('');setFailed(false);
  try{
   const dto=row.dto??await receipts(api).booking(row.bookingId);
   if(controller.runtime.isCurrent(api.scope))setOpen({id:row.id,dto});
  }catch{setFailed(true);setMessage('That receipt could not be opened. The booking and its receipt are unaffected.');}
 }

 if(open){
  const view=receiptView(open.dto,{duplicate:stamp()});
  return <div className="page" aria-label="Receipt">
   <PageHeader title={'Receipt '+open.dto.number} description="This is the document that prints. Nothing is added or removed on paper."/>
   <div className="receipt-open-actions">
    <Button icon="print" onClick={()=>{void printReceiptFor(api,open.dto,{duplicate:stamp()}).then(()=>{setFailed(false);setMessage('Printed as a duplicate copy.');},()=>{setFailed(true);setMessage('Did not print. Try again or download. The receipt itself is unaffected.');});}}>Print receipt {open.dto.number}</Button>
    <Button variant="outlined" icon="download" onClick={()=>{void downloadReceiptFor(api,open.dto,{duplicate:stamp()}).catch(()=>{setFailed(true);setMessage('The copy could not be saved. The receipt itself is unaffected.');});}}>Download a copy</Button>
    <Button variant="text" icon="arrow_back" onClick={()=>{setOpen(null);setMessage('');setFailed(false);}}>Back to receipts</Button>
   </div>
   {message&&<p role={failed?'alert':'status'}>{message}</p>}
   <Card><ReceiptDocument view={{...shop,...view}}/></Card>
  </div>;
 }

 return <div className="page" aria-label="Receipts">
  <PageHeader title="Receipts" description="Print a customer's receipt again. Every copy from here is marked as a duplicate."/>
  <div className="toolbar receipts-toolbar">
   <SearchBar value={q} onChange={setQ} placeholder="Search docket, name or phone" label="Search receipts"/>
   <SegmentedControl radio label="Which receipts" options={ranges} value={range==='custom'?'custom':range} onChange={value=>setRange(value as DatePreset)}/>
  </div>
  {range==='custom'&&<div className="receipts-dates">
   <TextField id="receipts-from" type="date" label="From" value={custom.from??''} max={custom.to||undefined} onChange={value=>setCustom({...custom,from:value})}/>
   <TextField id="receipts-to" type="date" label="To" value={custom.to??''} min={custom.from||undefined} onChange={value=>setCustom({...custom,to:value})}/>
  </div>}
  <p className="chips-total-line" role="status">{rows.length} receipt{rows.length===1?'':'s'} · {total===null||total>BigInt(Number.MAX_SAFE_INTEGER)?'—':money(Number(total))}</p>
  {page.phase==='error'&&<Failure label="Receipts could not be loaded." retry={page.reload}/>}{entries.phase==='error'&&<Failure label="Saved booking receipts could not be loaded." retry={entries.reload}/>}
  {message&&<p role={failed?'alert':'status'}>{message}</p>}
  <Card><div className="tbl-wrap"><table className="tbl receipts-table" aria-label="Receipts"><thead><tr><th>Docket</th><th>Customer</th><th className="ta-r">Total</th><th>Payment</th><th className="ta-r">Booked</th><th><span className="workspace-visually-hidden">Actions</span></th></tr></thead><tbody>{rows.map(row=><tr key={row.id}>
   <td className="mono cell-main">{row.bookingId
     ?<button type="button" className="receipt-open" onClick={()=>void openRow(row)}>{row.docket}</button>
     :row.docket}</td>
   <td>{row.name} <span className="muted t-body-sm">→ {row.city||'—'}</span></td><td className="ta-r">{money(row.amount)}</td><td><span className={'pill '+(row.payment==='paid'?'st-delivered':row.payment==='topay'?'pill-err':'receipt-payment-unknown')}>{row.payment==='paid'?'Paid':row.payment==='topay'?'To Pay':'Not recorded'}</span></td><td className="ta-r muted t-body-sm">{booked(row.createdAt)}</td><td><Button size="sm" variant="text" icon="print" disabled={!!printing} aria-label={'Print receipt '+row.docket} onClick={()=>void reprint(row)}>Print</Button></td>
  </tr>)}</tbody></table>
  {(page.phase==='loading'||entries.phase==='loading')&&!rows.length?<Loading label="Loading receipts…"/>:!rows.length&&<EmptyState icon={filtered?'search_off':'receipt_long'} title={filtered?'No receipts match':'No receipts today yet'} sub={filtered?'Try a different search, or widen the dates.':'A receipt is issued with every booking. The first one today will appear here.'} action={filtered?<Button variant="outlined" style={{marginTop:12}} onClick={()=>{setQ('');setRange('custom');setCustom({from:'',to:''});}}>Show every receipt</Button>:<Button icon="add" style={{marginTop:12}} onClick={()=>nav('/business/new-booking')}>New booking</Button>}/>}
  </div></Card>{page.page.has_more&&<Button variant="outlined" disabled={page.phase==='more'} onClick={page.loadMore}>More receipts</Button>}
 </div>;
}
