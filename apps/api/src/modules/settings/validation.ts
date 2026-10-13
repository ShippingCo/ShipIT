import {parseSettingsTimezone,settingKeys,type SettingKey,type SettingsPatch,type SettingsUpdateInput,type SettingsValues} from '@shippingco/shared';
import {FieldValidationError} from '../../plugins/errors.ts';
import {object,integer,uuid} from '../pricing/validation.ts';
export function fail():never {throw new FieldValidationError('$','INVALID_FORMAT');}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||[...value].some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))fail();return value.trim();}
function timezone(value:unknown){const zone=parseSettingsTimezone(value);if(zone===null)fail();return zone;}
function list(value:unknown,max:number){if(!Array.isArray(value)||value.length>max)fail();return value;}
function weekdays(value:unknown){const days=list(value,7).map(v=>integer(v,'$',0,6));if(!days.length||new Set(days).size!==days.length)fail();return days.sort((a,b)=>a-b);}
function date(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||value.startsWith('0000'))fail();const d=new Date(value+'T00:00:00Z');if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==value)fail();return value;}
function franchiseIds(value:unknown){const ids=list(value,50).map(v=>uuid(v,'$'));if(!ids.length||new Set(ids).size!==ids.length)fail();return ids.sort();}
export function value<K extends SettingKey>(key:K,input:unknown):SettingsValues[K] {
 let result:unknown;
 switch(key){
  case 'identity':{const b=object(input,['display_name']);result={display_name:text(b.display_name,120)};break;}
  case 'language':{const b=object(input,['locale']);if(b.locale!=='en'&&b.locale!=='hi')fail();result={locale:b.locale};break;}
  case 'operating_hours':{const b=object(input,['timezone','days']),days=list(b.days,7).map(v=>{const d=object(v,['weekday','opens_minute','closes_minute']),open=integer(d.opens_minute,'$',0,1439),close=integer(d.closes_minute,'$',1,1440);if(close<=open)fail();return {weekday:integer(d.weekday,'$',0,6),opens_minute:open,closes_minute:close};});if(new Set(days.map(d=>d.weekday)).size!==days.length)fail();result={timezone:timezone(b.timezone),days:days.sort((a,b)=>a.weekday-b.weekday)};break;}
  case 'booking_defaults':{const b=object(input,['service']);if(!['standard','express','same_city'].includes(b.service as string))fail();result={service:b.service};break;}
  case 'collection_calendar':{const b=object(input,['timezone','weekdays','holidays']);if(b.timezone!=='Asia/Kolkata')fail();const holidays=list(b.holidays,366).map(date);if(new Set(holidays).size!==holidays.length)fail();result={timezone:'Asia/Kolkata',weekdays:weekdays(b.weekdays),holidays:holidays.sort()};break;}
  case 'receiving_account':{const b=object(input,['account_id','revision_id','method']);if(!['cash','upi','card','bank_transfer','other'].includes(b.method as string))fail();result={account_id:uuid(b.account_id,'$'),revision_id:uuid(b.revision_id,'$'),method:b.method};break;}
  case 'approval_policy':{const b=object(input,['revision_id']);result={revision_id:uuid(b.revision_id,'$')};break;}
  case 'agent_fee_policy':{const b=object(input,['agent_id','revision_id']);result={agent_id:uuid(b.agent_id,'$'),revision_id:uuid(b.revision_id,'$')};break;}
  case 'close_cutoff':{const b=object(input,['timezone','minute']);result={timezone:timezone(b.timezone),minute:integer(b.minute,'$',0,1439)};break;}
  case 'credit_policy':case 'overdue_policy':case 'billing_terms':{const b=object(input,['state','owner']);if(b.state!=='unconfigured'||b.owner!=='account_terms_v1')fail();result={state:'unconfigured',owner:'account_terms_v1'};break;}
  case 'report_scope':{const b=object(input,['franchise_ids']);result={franchise_ids:franchiseIds(b.franchise_ids)};break;}
  case 'reporting_schedule':{const b=object(input,['report','franchise_ids','timezone','weekday','minute']);if(!['sales','contribution'].includes(b.report as string))fail();result={report:b.report,franchise_ids:franchiseIds(b.franchise_ids),timezone:timezone(b.timezone),weekday:integer(b.weekday,'$',0,6),minute:integer(b.minute,'$',0,1439)};break;}
 }
 return result as SettingsValues[K];
}
export function update(input:unknown):SettingsUpdateInput {
 const b=object(input,['expected_version','changes','reason']),changes=object(b.changes,settingKeys),keys=Object.keys(changes) as SettingKey[];
 if(!keys.length)fail();const patch:SettingsPatch={};
 for(const key of [...keys].sort())Object.assign(patch,{[key]:changes[key]===null?null:value(key,changes[key])});
 const reason=text(b.reason,256);if(reason.length<3)fail();
 return {expected_version:integer(b.expected_version,'expected_version',0,2147483645),changes:patch,reason};
}
export function selection(input:unknown,owner:'organization'|'franchise',history=false){
 const b=object(input,['organization_id',...(owner==='franchise'?['franchise_id']:[]),...(history?['before']:[])]);
 const before=b.before===undefined?null:Number(b.before);if(before!==null&&(!Number.isInteger(before)||before<1||before>2147483646))fail();
 return {organizationId:uuid(b.organization_id,'organization_id'),franchiseId:owner==='franchise'?uuid(b.franchise_id,'franchise_id'):null,before};
}
