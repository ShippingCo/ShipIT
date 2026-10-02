import { HttpError } from '../../plugins/errors.ts';
import { object,integer,uuid } from '../pricing/validation.ts';
export interface SupportHours {franchise_id:string;timezone:string;weekdays:number[];start_minute:number;end_minute:number;staffed:boolean}
export function hoursInput(value:unknown):SupportHours {
 const b=object(value,['franchise_id','timezone','weekdays','start_minute','end_minute','staffed']);
 if(typeof b.timezone!=='string'||b.timezone.length>80||typeof b.staffed!=='boolean'||!Array.isArray(b.weekdays)||!b.weekdays.length||b.weekdays.length>7||new Set(b.weekdays).size!==b.weekdays.length)throw new HttpError('VALIDATION_FAILED');
 try{new Intl.DateTimeFormat('en',{timeZone:b.timezone}).format();}catch{throw new HttpError('VALIDATION_FAILED');}
 const start=integer(b.start_minute,'$',0,1439),end=integer(b.end_minute,'$',1,1440);
 if(end<=start)throw new HttpError('VALIDATION_FAILED');
 return {franchise_id:uuid(b.franchise_id),timezone:b.timezone,weekdays:b.weekdays.map(v=>integer(v,'$',0,6)),start_minute:start,end_minute:end,staffed:b.staffed};
}
export function availability(hours:SupportHours|undefined,now:Date) {
 if(!hours)return 'Staff hours are not configured. A response time cannot be promised.';
 if(!hours.staffed)return 'Staff are currently unavailable. Your request is saved; a response time cannot be promised.';
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:hours.timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const part=(name:string)=>parts.find(p=>p.type===name)!.value;
 const minute=Number(part('hour'))*60+Number(part('minute')),days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const open=hours.weekdays.includes(days.indexOf(part('weekday')))&&minute>=hours.start_minute&&minute<hours.end_minute;
 const time=(v:number)=>`${String(Math.floor(v/60)).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`;
 return `${open?'This is within':'This is outside'} configured staff hours (${hours.weekdays.map(v=>days[v]).join(', ')} ${time(hours.start_minute)}–${time(hours.end_minute)} ${hours.timezone}). Staff will review the queue; no response deadline is guaranteed.`;
}
export type CaseAction='claim'|'assign'|'respond'|'note'|'resolve'|'reopen';
export const reasons=['customer_request','needs_followup','answered','operational_review','incorrect_resolution'] as const;
export function commandInput(value:unknown) {
 const b=object(value,['action','expected_version','assigned_staff_id','reason','text']);
 if(!['claim','assign','respond','note','resolve','reopen'].includes(String(b.action)))throw new HttpError('VALIDATION_FAILED');
 const action=b.action as CaseAction,version=integer(b.expected_version,'expected_version',1,2147483646);
 if((action==='assign')!==(b.assigned_staff_id!==undefined)||!['respond','note'].includes(action)&&b.text!==undefined)throw new HttpError('VALIDATION_FAILED');
 if(['resolve','reopen'].includes(action)&&!reasons.includes(b.reason as typeof reasons[number])||b.reason!==undefined&&!reasons.includes(b.reason as typeof reasons[number]))throw new HttpError('VALIDATION_FAILED');
 let text:string|null=null;
 if(['respond','note'].includes(action)) {
  if(typeof b.text!=='string'||!b.text.trim()||b.text.length>2000||Array.from(b.text).some(c=>c.charCodeAt(0)<32&&!['\n','\r','\t'].includes(c)))throw new HttpError('VALIDATION_FAILED');
  // Staff must use the dedicated delivery-code service, never paste codes or credentials.
  if(/\b\d{4,8}\b|(?:bearer\s|https?:\/\/\S*[?&](?:token|key|secret)=)/i.test(b.text))throw new HttpError('VALIDATION_FAILED');
  text=b.text.trim();
 }
 return {action,version,assigned:action==='assign'?uuid(b.assigned_staff_id):null,reason:String(b.reason??'operational_review'),text};
}
