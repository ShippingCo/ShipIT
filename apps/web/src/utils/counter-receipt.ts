import type {CounterEntry} from '../data-access/booking-entries';
import type {ReceiptView} from './receipt-view';
const amount=(value?:string)=>value!==undefined&&/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;
const money=(value:number|null)=>value===null?'—':'₹'+(value/100).toLocaleString('en-IN',{maximumFractionDigits:2});
export function counterReceiptView(entry:CounterEntry,issuer:string):ReceiptView{
 const f=entry.data.fields,packing=amount(f.packing),freight=amount(f.override),weight=amount(f.weight),sum=BigInt(packing??0)+BigInt(freight??0),total=packing===null&&freight===null||sum>BigInt(Number.MAX_SAFE_INTEGER)?null:Number(sum);
 const service=f.service==='express'?'Express':f.service==='standard'?'Standard':f.service==='same_city'?'Same-city':f.service||'—';
 return {heading:'Booking acknowledgement',number:f.docket||entry.id.slice(0,8),issuer,customer:f.name||'Not recorded',rows:[
  ['Booking date',new Date(entry.confirmed_at).toLocaleString('en-IN',{day:'numeric',month:'short',hour:'numeric',minute:'2-digit',hour12:true})],
  ['Service / Weight',service+' · '+(weight===null?'—':(weight/1000).toLocaleString('en-IN')+' kg')],
  ['Packing charges',money(packing)],['Freight charges',money(freight)],['Taxable value','—'],['CGST','—'],['SGST','—'],['IGST','—']],
  totalLabel:'Entered total',total:money(total),note:'Confirmed booking. Tax and payment are not recorded. This acknowledgement is not a tax invoice or payment receipt.'};
}
