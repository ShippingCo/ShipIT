import { HttpError } from '../../plugins/errors.ts';
import type { Tool } from './router.ts';

export type ToolResult=
 |{tool:'tracking'|'eta'|'delay';docket:string;status:string;version:number;eta:{state:'available'|'unavailable';at:string|null;kind?:'route_arrival'};timeline:{event:string;at:string}[]}
 |{tool:'charges';docket:string;booked_paise:string;collected_paise:string;remaining_paise:string;ledger_version:number}
 |{tool:'receipt';docket:string;number:string;issued_at:string;booked_paise:string}
 |{tool:'resend';docket:string;state:'queued'|'failed';reason_code:string};
const statuses=['booked','checked_in','dispatched','in_transit','out_for_delivery','failed_attempt','held_at_office','delivered','rto'];
const instant=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v));
const money=(v:unknown)=>typeof v==='string'&&/^-?\d{1,18}$/.test(v);
/** A dependency cannot accidentally broaden the customer response with a new field. */
export function validateResult(tool:Tool,value:unknown):ToolResult {
 const fail=():never=>{throw new HttpError('TEMPORARILY_UNAVAILABLE');};
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const b=value as Record<string,unknown>;
 if(b.tool!==tool||typeof b.docket!=='string'||!/^[A-Z0-9][A-Z0-9-]{0,39}$/.test(b.docket))return fail();
 const keys=tool==='charges'?['tool','docket','booked_paise','collected_paise','remaining_paise','ledger_version']:
 tool==='receipt'?['tool','docket','number','issued_at','booked_paise']:tool==='resend'?['tool','docket','state','reason_code']:['tool','docket','status','version','eta','timeline'];
 if(Object.keys(b).length!==keys.length||Object.keys(b).some(k=>!keys.includes(k)))return fail();
 if(tool==='charges') {if(!money(b.booked_paise)||!money(b.collected_paise)||!money(b.remaining_paise)||!Number.isSafeInteger(b.ledger_version)||Number(b.ledger_version)<0)return fail();}
 else if(tool==='receipt') {if(typeof b.number!=='string'||!/^RCT-\d{19}$/.test(b.number)||!instant(b.issued_at)||!money(b.booked_paise))return fail();}
 else if(tool==='resend') {if(!['queued','failed'].includes(String(b.state))||typeof b.reason_code!=='string'||!/^[a-z_]{1,64}$/.test(b.reason_code))return fail();}
 else {
  if(!statuses.includes(String(b.status))||!Number.isSafeInteger(b.version)||Number(b.version)<1||!b.eta||typeof b.eta!=='object')return fail();
  const e=b.eta as Record<string,unknown>;
  if(e.state==='available') {if(!instant(e.at)||e.kind!=='route_arrival'||Object.keys(e).length!==3)return fail();}
  else if(e.state!=='unavailable'||e.at!==null||Object.keys(e).length!==2)return fail();
  if(!Array.isArray(b.timeline)||b.timeline.length>20||b.timeline.some(v=>!v||typeof v!=='object'||Object.keys(v).length!==2||
   !['parcel.booked','parcel.checked_in','parcel.dispatched','parcel.in_transit','delivery.attempt_started','delivery.retry_started','delivery.attempt_failed','parcel.held_at_office','delivery.completed','delivery.collected','delivery.reversed','parcel.rto_approved'].includes(v.event)||!instant(v.at)))return fail();
 }
 return value as ToolResult;
}
const rupees=(v:string)=>{const n=BigInt(v),sign=n<0n?'-':'',a=n<0n?-n:n;return `${sign}INR ${a/100n}.${String(a%100n).padStart(2,'0')}`;};
export function renderResult(r:ToolResult):string {
 if(r.tool==='charges')return `${r.docket}: Booked total ${rupees(r.booked_paise)}. Collected ${rupees(r.collected_paise)}. Remaining ${rupees(r.remaining_paise)}. These are saved booking and payment records.`;
 if(r.tool==='receipt')return `${r.docket}: Issued booking receipt ${r.number}, ${r.issued_at}. Booked total ${rupees(r.booked_paise)}. This is a receipt summary; contact the franchise for the full document.`;
 if(r.tool==='resend')return r.state==='queued'?`${r.docket}: Delivery-code resend queued to the verified delivery recipient. Sending is not yet confirmed.`:`${r.docket}: Delivery-code send unavailable. Contact the franchise.`;
 const eta=r.eta.state==='available'?`Recorded route-arrival estimate: ${r.eta.at}. This is not a delivery promise.`:'A current arrival estimate is unavailable.';
 return `${r.docket}: Recorded status ${r.status.replaceAll('_',' ')} (version ${r.version}). ${eta}${r.tool==='delay'?' No delay duration or reason is inferred.':''}`;
}
