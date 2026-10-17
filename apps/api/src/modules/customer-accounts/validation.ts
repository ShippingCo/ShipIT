import type {CustomerAccountInput,AccountRateInput} from '@shippingco/shared';
import {FieldValidationError,type ValidationField} from '../../plugins/errors.ts';
import {object,integer,uuid,draft} from '../pricing/validation.ts';
import {phone} from '../customers/validation.ts';
import {assertRules} from '../pricing/calculation.ts';
export function text(value:unknown,field:ValidationField,max:number,min=1):string {
 if(typeof value!=='string')throw new FieldValidationError(field,'INVALID_TYPE');
 if(value.length>max*4||[...value].some(c=>{const n=c.codePointAt(0)!;return n<32||(n>=127&&n<=159)||(n>=0xd800&&n<=0xdfff);}))throw new FieldValidationError(field,'INVALID_FORMAT');
 const result=value.trim();if([...result].length<min||[...result].length>max)throw new FieldValidationError(field,'OUT_OF_RANGE');return result;
}
export function accountInput(value:unknown):CustomerAccountInput {
 const b=object(value,['expected_version','debtor_customer_id','name','shipping_customer_ids','billing_contact','closing_day','due_days','credit_limit_paise','state','reason']);
 const contact=object(b.billing_contact,['name','phone','authorization_ref']);
 if(!Array.isArray(b.shipping_customer_ids)||b.shipping_customer_ids.length<1||b.shipping_customer_ids.length>100)throw new FieldValidationError('shipping_customer_ids','OUT_OF_RANGE');
 const customers=b.shipping_customer_ids.map(id=>uuid(id,'customer_id')).sort();
 if(new Set(customers).size!==customers.length)throw new FieldValidationError('shipping_customer_ids','INVALID_FORMAT');
 if(b.state!=='active'&&b.state!=='held')throw new FieldValidationError('state','INVALID_FORMAT');
 return {expected_version:integer(b.expected_version,'expected_version',0,2147483645),debtor_customer_id:uuid(b.debtor_customer_id,'debtor_customer_id'),
 name:text(b.name,'name',120),shipping_customer_ids:customers,
 billing_contact:{name:text(contact.name,'billing_contact',120),phone:phone(contact.phone).normalized,authorization_ref:text(contact.authorization_ref,'billing_contact',128)},
 closing_day:integer(b.closing_day,'closing_day',1,31),due_days:integer(b.due_days,'due_days',0,366),credit_limit_paise:integer(b.credit_limit_paise,'credit_limit_paise'),state:b.state,reason:text(b.reason,'reason',256,3)};
}
export function rateInput(value:unknown):AccountRateInput {
 const b=object(value,['expected_version','effective_from','effective_to','approval_ref','rules']);
 const parsed=draft({effective_from:b.effective_from,effective_to:b.effective_to,approval_ref:b.approval_ref,source_ref:b.approval_ref,rules:b.rules,quote_validity_seconds:1,override_tolerance_paise:0});
 assertRules({rules:parsed.rules.map((r,i)=>({...r,id:String(i)}))});
 return {expected_version:integer(b.expected_version,'expected_version',0,2147483645),effective_from:parsed.effective_from,effective_to:parsed.effective_to,approval_ref:parsed.approval_ref,rules:parsed.rules};
}
/** Inclusive closing day, clamped in short months; all dates use the approved business zone. */
export function accountDueDate(now:Date,closingDay:number,dueDays:number) {
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const get=(key:string)=>Number(parts.find(p=>p.type===key)!.value);
 let year=get('year'),month=get('month')-1;
 let closing=Math.min(closingDay,new Date(Date.UTC(year,month+1,0)).getUTCDate());
 if(get('day')>closing){month++;if(month===12){month=0;year++;}closing=Math.min(closingDay,new Date(Date.UTC(year,month+1,0)).getUTCDate());}
 return new Date(Date.UTC(year,month,closing+dueDays)).toISOString().slice(0,10);
}
