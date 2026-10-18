import type {OwnerSummaryPeriod,OwnerSummaryTiming,OwnerSummaryScheduleInput} from '@shippingco/shared';
import {parseSettingsTimezone} from '@shippingco/shared';
import {FieldValidationError} from '../../plugins/errors.ts';
import {object,uuid} from '../pricing/validation.ts';

/** Calendar intent only. PostgreSQL resolves actual boundaries using its installed tzdata. */
export function ownerSummaryTiming(value:unknown):OwnerSummaryTiming {
 const b=object(value,['frequency','timezone','minute','weekday']);
 const zone=parseSettingsTimezone(b.timezone);
 if(!zone||!['daily','weekly','monthly'].includes(String(b.frequency))||
  !Number.isInteger(b.minute)||Number(b.minute)<0||Number(b.minute)>1439||
  !Number.isInteger(b.weekday)||Number(b.weekday)<1||Number(b.weekday)>7)
  throw new FieldValidationError('$','INVALID_FORMAT');
 return {frequency:b.frequency as OwnerSummaryTiming['frequency'],timezone:zone,minute:Number(b.minute),weekday:Number(b.weekday)};
}

export function ownerSummaryIdentity(schedule:string,period:OwnerSummaryPeriod,recipient:string,version:number):string {
 if(!Number.isSafeInteger(version)||version<1)throw new FieldValidationError('$','OUT_OF_RANGE');
 // Delimited JSON preserves timezone, exact UTC boundaries and explicit correction identity.
 return JSON.stringify([schedule,period.frequency,period.timezone,period.from,period.to,recipient,version]);
}
export function ownerScheduleInput(value:unknown,franchise:string):OwnerSummaryScheduleInput {
 const b=object(value,['expected_version','name','timing','franchise_ids','recipient_ids','enabled','whatsapp','corrections','alerts']);
 const ids=(v:unknown,limit:number)=>{
  if(!Array.isArray(v)||!v.length||v.length>limit)throw new FieldValidationError('$','OUT_OF_RANGE');
  const result=v.map(x=>uuid(x,'$'));if(new Set(result).size!==result.length)throw new FieldValidationError('$','INVALID_FORMAT');return result.sort();
 };
 const franchise_ids=ids(b.franchise_ids,50),recipient_ids=ids(b.recipient_ids,20);
 const a=object(b.alerts,['enabled','notify','minimum_paise','minimum_overdue_days','repeat_hours']);
 if(!franchise_ids.includes(franchise)||typeof b.name!=='string'||!b.name.trim()||b.name.length>80||[...b.name].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)||
  !Number.isSafeInteger(b.expected_version)||Number(b.expected_version)<0||Number(b.expected_version)>2147483646||
  [b.enabled,b.whatsapp,b.corrections,a.enabled,a.notify].some(v=>typeof v!=='boolean')||
  typeof a.minimum_paise!=='string'||!/^\d{1,16}$/.test(a.minimum_paise)||BigInt(a.minimum_paise)<1n||BigInt(a.minimum_paise)>9007199254740991n||
  !Number.isInteger(a.minimum_overdue_days)||Number(a.minimum_overdue_days)<1||Number(a.minimum_overdue_days)>3650||
  a.repeat_hours!==null&&(!Number.isInteger(a.repeat_hours)||Number(a.repeat_hours)<24||Number(a.repeat_hours)>8760))throw new FieldValidationError('$','INVALID_FORMAT');
 return {expected_version:Number(b.expected_version),name:b.name.trim(),timing:ownerSummaryTiming(b.timing),franchise_ids,recipient_ids,enabled:b.enabled as boolean,whatsapp:b.whatsapp as boolean,corrections:b.corrections as boolean,
  alerts:{enabled:a.enabled as boolean,notify:a.notify as boolean,minimum_paise:BigInt(a.minimum_paise).toString(),minimum_overdue_days:Number(a.minimum_overdue_days),repeat_hours:a.repeat_hours as number|null}};
}
