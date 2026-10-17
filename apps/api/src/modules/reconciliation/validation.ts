import type {ReconciliationAmountMapping,ReconciliationMappingInput} from '@shippingco/shared';
import {FieldValidationError} from '../../plugins/errors.ts';
import {integer,object} from '../pricing/validation.ts';
export function text(value:unknown,max=128,min=1):string {
 if(typeof value!=='string'||value.length>max*4)throw new FieldValidationError('$','INVALID_TYPE');
 const result=value.trim();
 if([...result].length<min||[...result].length>max||[...result].some(c=>{const n=c.codePointAt(0)!;return n<32||(n>=127&&n<=159)||(n>=0xd800&&n<=0xdfff);}))throw new FieldValidationError('$','INVALID_FORMAT');
 return result;
}
function column(value:unknown):string {
 const result=text(value,64);if(!/^[A-Za-z][A-Za-z0-9_ -]{0,63}$/.test(result))throw new FieldValidationError('$','INVALID_FORMAT');return result;
}
export function businessDate(value:unknown):string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value.startsWith('0000'))throw new FieldValidationError('$','INVALID_FORMAT');
 const parsed=new Date(value+'T00:00:00.000Z');
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new FieldValidationError('$','INVALID_FORMAT');return value;
}
export function mappingInput(value:unknown):ReconciliationMappingInput {
 const b=object(value,['expected_version','name','identity_namespace','date_column','date_format','amount','reference_column','identity_column','currency_column']);
 if(!['yyyy-mm-dd','dd/mm/yyyy','dd-mm-yyyy'].includes(String(b.date_format)))throw new FieldValidationError('$','INVALID_FORMAT');
 const raw=object(b.amount,['mode','unit','amount_column','positive_direction','credit_column','debit_column','direction_column','credit_value','debit_value']);
 if(raw.unit!=='rupees'&&raw.unit!=='paise')throw new FieldValidationError('$','INVALID_FORMAT');
 let amount:ReconciliationAmountMapping;
 if(raw.mode==='signed') {
  object(raw,['mode','unit','amount_column','positive_direction']);
  if(raw.positive_direction!=='credit'&&raw.positive_direction!=='debit')throw new FieldValidationError('$','INVALID_FORMAT');
  amount={mode:'signed',unit:raw.unit,amount_column:column(raw.amount_column),positive_direction:raw.positive_direction};
 } else if(raw.mode==='credit_debit') {
  object(raw,['mode','unit','credit_column','debit_column']);
  amount={mode:'credit_debit',unit:raw.unit,credit_column:column(raw.credit_column),debit_column:column(raw.debit_column)};
  if(amount.credit_column===amount.debit_column)throw new FieldValidationError('$','INVALID_FORMAT');
 } else if(raw.mode==='direction') {
  object(raw,['mode','unit','amount_column','direction_column','credit_value','debit_value']);
  amount={mode:'direction',unit:raw.unit,amount_column:column(raw.amount_column),direction_column:column(raw.direction_column),credit_value:text(raw.credit_value,32),debit_value:text(raw.debit_value,32)};
  if(amount.credit_value===amount.debit_value||amount.amount_column===amount.direction_column)throw new FieldValidationError('$','INVALID_FORMAT');
 } else throw new FieldValidationError('$','INVALID_FORMAT');
 const namespace=text(b.identity_namespace,48);
 if(!/^[A-Z][A-Z0-9_-]{0,47}$/.test(namespace))throw new FieldValidationError('$','INVALID_FORMAT');
 return {expected_version:integer(b.expected_version,'expected_version',0,2147483645),name:text(b.name,80),identity_namespace:namespace,
 date_column:column(b.date_column),date_format:b.date_format as ReconciliationMappingInput['date_format'],amount,
 reference_column:b.reference_column===null?null:column(b.reference_column),identity_column:b.identity_column===null?null:column(b.identity_column),currency_column:b.currency_column===null?null:column(b.currency_column)};
}

export function allocations(value:unknown,min=0):import('@shippingco/shared').ReconciliationAllocation[] {
 if(!Array.isArray(value)||value.length<min||value.length>100)throw new FieldValidationError('$','OUT_OF_RANGE');
 const rows=value.map(item=>{const b=object(item,['source_id','source_version','amount_paise']);return {source_id:text(b.source_id),source_version:text(b.source_version),amount_paise:integer(b.amount_paise,'$',1)};});
 if(new Set(rows.map(r=>r.source_id)).size!==rows.length)throw new FieldValidationError('$','INVALID_FORMAT');return rows;
}
