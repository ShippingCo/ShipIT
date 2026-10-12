import type {CashCloseInput,CashCloseOperation,CashCloseDenomination} from '@shippingco/shared';
import {FieldValidationError} from '../../plugins/errors.ts';
import {object,integer,uuid,timestamp} from '../pricing/validation.ts';
import {reportFilter} from '../reports/rules.ts';
import {cashbookText} from './request-service.ts';
export function closeDenominations(value:unknown,total:number):CashCloseDenomination[]{
 if(!Array.isArray(value)||value.length>100)throw new FieldValidationError('$','OUT_OF_RANGE');
 const rows=value.map(value=>{const r=object(value,['denomination_paise','quantity']);return {denomination_paise:integer(r.denomination_paise,'amount_paise',1),quantity:integer(r.quantity,'amount_paise')};});
 if(new Set(rows.map(r=>r.denomination_paise)).size!==rows.length||rows.length&&rows.reduce((sum,r)=>sum+BigInt(r.denomination_paise)*BigInt(r.quantity),0n)!==BigInt(total))throw new FieldValidationError('amount_paise','INVALID_FORMAT');
 return rows.sort((a,b)=>a.denomination_paise-b.denomination_paise);
}
export function closeTimestamp(value:unknown):string {
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(value))throw new FieldValidationError('occurred_at','INVALID_FORMAT');
 const fraction=(value.match(/\.(\d+)/)?.[1]??'').padEnd(6,'0'),normalized=timestamp(value.replace(/\.(\d{3})\d+/,' .$1').replace(' .','.'),'occurred_at');
 return normalized.replace(/\.\d{3}Z$/,'.'+fraction+'Z');
}
export function closeInput(operation:CashCloseOperation,value:unknown):CashCloseInput {
 const fields={open:['location_id','location_revision_id','day','predecessor_id','initial_opening'],count:['counted_at','counted_paise','denominations'],submit:['count_id'],decide:['submission_id','kind','sole_admin_acknowledged'],reopen:[]};
 const b=object(value,['expected_version','reason',...fields[operation]]),base={expected_version:integer(b.expected_version,'expected_version',operation==='open'?0:1,operation==='open'?0:2147483646),reason:cashbookText(b.reason,500)};
 if(operation==='open'){
  const day=reportFilter({from_day:b.day,to_day:b.day}).from_day,predecessor=b.predecessor_id===null?null:uuid(b.predecessor_id,'$');let initial=null;
  if(b.initial_opening!==null){const o=object(b.initial_opening,['counted_at','counted_paise','denominations']),amount=integer(o.counted_paise,'amount_paise');initial={counted_at:closeTimestamp(o.counted_at),counted_paise:amount,denominations:closeDenominations(o.denominations,amount)};}
  if((predecessor===null)!==(initial!==null))throw new FieldValidationError('$','INVALID_FORMAT');
  return {...base,expected_version:0,location_id:uuid(b.location_id,'$'),location_revision_id:uuid(b.location_revision_id,'$'),day,predecessor_id:predecessor,initial_opening:initial};
 }
 if(operation==='count'){const amount=integer(b.counted_paise,'amount_paise');return {...base,counted_at:closeTimestamp(b.counted_at),counted_paise:amount,denominations:closeDenominations(b.denominations,amount)};}
 if(operation==='submit')return {...base,count_id:uuid(b.count_id,'$')};
 if(operation==='decide'){if(!['approve','reject'].includes(b.kind as string)||typeof b.sole_admin_acknowledged!=='boolean')throw new FieldValidationError('$','INVALID_FORMAT');return {...base,submission_id:uuid(b.submission_id,'$'),kind:b.kind as 'approve'|'reject',sole_admin_acknowledged:b.sole_admin_acknowledged};}
 return base;
}
