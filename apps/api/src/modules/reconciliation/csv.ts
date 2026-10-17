import type {ReconciliationMappingInput,StatementCandidate,StatementPreviewRow,StatementRowError} from '@shippingco/shared';
import {CsvError,decodeCsv} from '../imports/csv.ts';
import {businessDate,text} from './validation.ts';
/** Decimal strings are converted through BigInt; no floating point money or locale guessing. */
export function statementMoney(value:string,unit:'rupees'|'paise'):number {
 const pattern=unit==='paise'?/^(0|[1-9]\d*)$/:/^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
 const match=pattern.exec(value.trim());if(!match)throw new CsvError('INVALID_AMOUNT');
 const amount=unit==='paise'?BigInt(match[1]!):BigInt(match[1]!)*100n+BigInt((match[2]??'').padEnd(2,'0'));
 if(amount>BigInt(Number.MAX_SAFE_INTEGER))throw new CsvError('INVALID_AMOUNT');return Number(amount);
}
function date(value:string,format:ReconciliationMappingInput['date_format']) {
 const raw=value.trim();
 if(format==='yyyy-mm-dd')return businessDate(raw);
 const separator=format==='dd/mm/yyyy'?'/':'-',parts=raw.split(separator);
 if(parts.length!==3||!/^\d{2}$/.test(parts[0]!)||!/^\d{2}$/.test(parts[1]!)||!/^\d{4}$/.test(parts[2]!))throw new CsvError('INVALID_DATE');
 return businessDate(parts[2]+'-'+parts[1]+'-'+parts[0]);
}
export function statementPreview(content:unknown,mapping:ReconciliationMappingInput,from:string,to:string) {
 businessDate(from);businessDate(to);if(from>to)throw new CsvError('INVALID_PERIOD');
 const parsed=decodeCsv(content),a=mapping.amount;
 const columns=[mapping.date_column,mapping.reference_column,mapping.identity_column,mapping.currency_column,
  ...(a.mode==='credit_debit'?[a.credit_column,a.debit_column]:[a.amount_column,...(a.mode==='direction'?[a.direction_column]:[])])].filter((v):v is string=>v!==null);
 if(columns.some(name=>!parsed.headers.includes(name)))throw new CsvError('COLUMN_MAPPING',1);
 const rows:StatementPreviewRow[]=parsed.records.map((cells,index)=>{
  const reject=(error:StatementRowError):StatementPreviewRow=>({row:index+2,error,candidate:null});
  if(cells.length!==parsed.headers.length)return reject('COLUMN_COUNT');
  const read=(name:string)=>cells[parsed.headers.indexOf(name)]!.trim();
  let business_date:string;
  try {business_date=date(read(mapping.date_column),mapping.date_format);}catch{return reject('INVALID_DATE');}
  if(business_date<from||business_date>to)return reject('OUTSIDE_PERIOD');
  if(mapping.currency_column&&read(mapping.currency_column)!=='INR')return reject('CURRENCY_MISMATCH');
  let direction:StatementCandidate['direction'],amount_paise:number;
  try {
   if(a.mode==='credit_debit') {
    const credit=statementMoney(read(a.credit_column)||'0',a.unit),debit=statementMoney(read(a.debit_column)||'0',a.unit);
    if((credit>0)===(debit>0))return reject('INVALID_AMOUNT');direction=credit>0?'credit':'debit';amount_paise=credit||debit;
   } else if(a.mode==='signed') {
    const value=read(a.amount_column),negative=value.startsWith('-');
    amount_paise=statementMoney(negative?value.slice(1):value,a.unit);
    direction=negative?(a.positive_direction==='credit'?'debit':'credit'):a.positive_direction;
   } else {
    const value=read(a.direction_column);
    if(value!==a.credit_value&&value!==a.debit_value)return reject('INVALID_DIRECTION');
    direction=value===a.credit_value?'credit':'debit';amount_paise=statementMoney(read(a.amount_column),a.unit);
   }
  } catch {return reject('INVALID_AMOUNT');}
  if(amount_paise===0)return reject('INVALID_AMOUNT');
  let external_reference:string|null=null,external_id:string|null=null;
  try {if(mapping.reference_column&&read(mapping.reference_column))external_reference=text(read(mapping.reference_column));}catch{return reject('INVALID_REFERENCE');}
  try {if(mapping.identity_column&&read(mapping.identity_column))external_id=text(read(mapping.identity_column));}catch{return reject('INVALID_IDENTITY');}
  return {row:index+2,error:null,candidate:{business_date,direction,amount_paise,currency:'INR',external_reference,external_id}};
 });
 return {file_sha256:parsed.file_sha256,rows};
}
