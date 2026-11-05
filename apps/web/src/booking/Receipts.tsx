import './receipts.css';
import {useMemo,useState} from 'react';
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
import {Button} from '../components/m3/Button';
import {Card,EmptyState} from '../components/m3/Surface';
import {SearchBar,DateFilter,dateWindow,type DatePreset,type CustomRange} from '../components/m3/Controls';
import {printReceiptFor,printReceiptViewFor} from '../utils/receipt';
import {counterReceiptView} from '../utils/counter-receipt';
const money=(paise:number|null)=>paise===null?'—':'₹'+(paise/100).toLocaleString('en-IN',{maximumFractionDigits:2});
const booked=(value:number)=>new Date(value).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true});
export default function Receipts({controller,roles=[]}:{controller:ScopeController;roles?:readonly OperatorRole[]}){
 const api=useMemo(()=>scopedApi(controller),[controller]),source=useMemo(()=>parcels(api),[api]),entrySource=useMemo(()=>bookingEntries(api),[api]);
 const nav=useNavigate(),[q,setQ]=useState(''),[range,setRange]=useState<DatePreset>('all'),[custom,setCustom]=useState<CustomRange>({from:'',to:''}),[printing,setPrinting]=useState(''),[message,setMessage]=useState('');
 const canEntries=roles.some(r=>['org_admin','franchise_admin','operator'].includes(r)),canMoney=roles.some(r=>['org_admin','franchise_admin','accountant'].includes(r));
 const page=usePagedResource(api.franchise+'receipt-parcels',(cursor,signal)=>source.list({limit:50,cursor},signal));
 const entries=useResource(api.franchise+'receipt-entries',signal=>canEntries?entrySource.list(signal):Promise.resolve({items:[]}));
 const ids=[...new Set(page.items.map(p=>p.booking_id))];
 const issued=useResource(api.franchise+':receipts:'+ids.join(','),async signal=>Promise.all(ids.map(async id=>{
  const dto=await receipts(api).booking(id,signal).catch(()=>null);
  const balance=canMoney?await payments(api,id).read(signal).catch(()=>null):null;
  return {id,dto,balance};
 })));
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
 async function reprint(row:typeof rows[number]){
  if(printing)return;setPrinting(row.id);setMessage('');
  try{if(row.entry)await printReceiptViewFor(api,counterReceiptView(row.entry,controller.snapshot().context?.franchises.find(f=>f.id===api.franchise)?.organization.display_name||'Booking acknowledgement'));else {const dto=row.dto??await receipts(api).booking(row.bookingId);if(controller.runtime.isCurrent(api.scope))await printReceiptFor(api,dto);}}
  catch{setMessage('The receipt could not be opened. Try Reprint again.');}finally{setPrinting('');}
 }
 return <div className="page" aria-label="Receipts"><h1 className="workspace-visually-hidden">Receipts</h1>
  <div className="toolbar"><SearchBar value={q} onChange={setQ} placeholder="Search docket, name or phone" label="Search receipts"/><DateFilter preset={range} onPreset={setRange} custom={custom} onCustom={setCustom}/></div>
  <p className="chips-total-line">{rows.length} receipt{rows.length===1?'':'s'} · {total===null||total>BigInt(Number.MAX_SAFE_INTEGER)?'—':money(Number(total))}</p>
  {page.phase==='error'&&<Failure label="Receipts could not be loaded." retry={page.reload}/>}{entries.phase==='error'&&<Failure label="Saved booking receipts could not be loaded." retry={entries.reload}/>}
  {message&&<p role="alert">{message}</p>}
  <Card><div className="tbl-wrap"><table className="tbl receipts-table" aria-label="Receipts"><thead><tr><th>Docket</th><th>Customer</th><th className="ta-r">Total</th><th>Payment</th><th className="ta-r">Booked</th><th><span className="workspace-visually-hidden">Actions</span></th></tr></thead><tbody>{rows.map(row=><tr key={row.id}>
   <td className="mono cell-main">{row.docket}</td><td>{row.name} <span className="muted t-body-sm">→ {row.city||'—'}</span></td><td className="ta-r">{money(row.amount)}</td><td><span className={'pill '+(row.payment==='paid'?'st-delivered':row.payment==='topay'?'pill-err':'receipt-payment-unknown')}>{row.payment==='paid'?'Paid':row.payment==='topay'?'To Pay':'Not recorded'}</span></td><td className="ta-r muted t-body-sm">{booked(row.createdAt)}</td><td><Button size="sm" variant="text" icon="print" disabled={!!printing} aria-label={'Reprint '+row.docket} onClick={()=>void reprint(row)}>Reprint</Button></td>
  </tr>)}</tbody></table>
  {(page.phase==='loading'||entries.phase==='loading')&&!rows.length?<Loading label="Loading receipts…"/>:!rows.length&&<EmptyState icon={q||range!=='all'?'search_off':'receipt_long'} title={q||range!=='all'?'No receipts match':'No receipts yet'} sub={q||range!=='all'?'Try a different search or date range.':'Receipts appear automatically with each booking.'} action={q||range!=='all'?<Button variant="outlined" style={{marginTop:12}} onClick={()=>{setQ('');setRange('all');}}>Clear filters</Button>:<Button icon="add" style={{marginTop:12}} onClick={()=>nav('/business/new-booking')}>Create first booking</Button>}/>}
  </div></Card>{page.page.has_more&&<Button variant="outlined" disabled={page.phase==='more'} onClick={page.loadMore}>More receipts</Button>}
 </div>;
}
