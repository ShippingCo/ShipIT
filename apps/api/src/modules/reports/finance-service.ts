import { createHash,randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { withFinancialScope,withReportScope } from '../memberships/service.ts';
import { object,selection,uuid,integer,idempotencyKey } from '../pricing/validation.ts';
import { FieldValidationError,HttpError } from '../../plugins/errors.ts';
import { reportFilter } from './rules.ts';
import { captureSales } from './sales-repository.ts';
import { salesTotals } from './sales-rules.ts';
import * as finance from './finance-repository.ts';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function reference(v:unknown):string {if(typeof v!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(v))throw new FieldValidationError('$','INVALID_FORMAT');return v;}
export function changeInput(value:unknown) {
 const b=object(value,['booking_id','expected_version','payment_version','kind','reason','approval_ref','pre_tax','taxable','cgst','sgst','igst','rounding','refund','returned_to_ref']);
 if(!['discount','cancellation','correction','refund'].includes(String(b.kind))||!['customer_agreement','service_recovery','booking_cancelled','incorrect_charge','customer_refund'].includes(String(b.reason)))throw new FieldValidationError('$','INVALID_FORMAT');
 return {booking_id:uuid(b.booking_id,'booking_id'),expected_version:integer(b.expected_version,'expected_version'),payment_version:integer(b.payment_version,'expected_version'),kind:String(b.kind),reason:String(b.reason),approval_ref:reference(b.approval_ref),
 pre_tax:integer(b.pre_tax??0,'$'),taxable:integer(b.taxable??0,'$'),cgst:integer(b.cgst??0,'$'),sgst:integer(b.sgst??0,'$'),igst:integer(b.igst??0,'$'),rounding:integer(b.rounding??0,'$',-99,99),refund:integer(b.refund??0,'$'),returned_to_ref:b.kind==='refund'?reference(b.returned_to_ref):null};
}
export function createFinanceService(database:DatabasePool) {
 return {
  async change(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),input=changeInput(body),key=hash('change:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify(input));
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.adjust',correlation,async scope=>{
    await finance.lock(scope);const existing=await finance.replay(scope,key,false);
    if(existing){if(existing.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return {id:existing.id};}
    const current=await finance.current(scope,input.booking_id,true);
    if(current.version!==input.expected_version||current.payment_version!==input.payment_version)throw new HttpError('VERSION_CONFLICT');
    if(current.version>=100)throw new HttpError('FINANCIAL_CONFLICT');
    const gross=BigInt(current.gross),net=BigInt(current.collections)-BigInt(current.refunds);
    if(input.kind==='refund'){
     if(input.refund<=0||BigInt(input.refund)>net-gross||input.pre_tax+input.taxable+input.cgst+input.sgst+input.igst+Math.abs(input.rounding)!==0)throw new HttpError('FINANCIAL_CONFLICT');
    }else{
     const reduction=BigInt(input.pre_tax)+BigInt(input.cgst)+BigInt(input.sgst)+BigInt(input.igst)+BigInt(input.rounding);
     if(input.refund!==0||reduction<=0n||reduction>gross||input.taxable>input.pre_tax||(input.kind==='cancellation'&&reduction!==gross))throw new HttpError('FINANCIAL_CONFLICT');
     for(const field of ['pre_tax','taxable','cgst','sgst','igst'] as const)if(BigInt(input[field])>BigInt(current[field]))throw new HttpError('FINANCIAL_CONFLICT');
     if(input.kind==='cancellation'&&(['pre_tax','taxable','cgst','sgst','igst','rounding'] as const).some(k=>BigInt(input[k])!==BigInt(current[k])))throw new HttpError('FINANCIAL_CONFLICT');
     if(BigInt(input.pre_tax-input.taxable)>BigInt(current.pre_tax)-BigInt(current.taxable)||Math.abs(Number(current.rounding)-input.rounding)>99)throw new HttpError('FINANCIAL_CONFLICT');
    }
    const id=randomUUID();await finance.append(scope,id,key,fingerprint,input);return {id};
   });
  },
  async read(session:string,query:unknown,booking:unknown,correlation:string) {
   const q=selection(query),id=uuid(booking,'booking_id');return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{const result=await finance.current(scope,id);await finance.access(scope,id,'financial.read');return result;});
  },
  async statement(session:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),b=object(body,['customer_id','from_day','to_day']),customer=uuid(b.customer_id,'customer_id'),filter=reportFilter({from_day:b.from_day,to_day:b.to_day}),key=hash('statement:'+idempotencyKey(keyInput,headers)),fingerprint=hash(JSON.stringify({customer,filter}));
   return withFinancialScope(database,session,q.organizationId,q.franchiseId,'finance.statement',correlation,async scope=>{
    await finance.lock(scope);const existing=await finance.replay(scope,key,true);
    if(existing){if(existing.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return finance.statement(scope,existing.id);}
    await finance.customer(scope,customer);
    const captured=await captureSales(scope,{...filter,rate:null,franchise_ids:[q.franchiseId]},customer);
    const rows=captured.rows.filter(r=>r.statement_ids.length===0);
    if(!rows.length)throw new HttpError('STATEMENT_EMPTY');
    const id=randomUUID(),snapshot={id,kind:'account_statement' as const,customer_id:customer,from_day:filter.from_day,to_day:filter.to_day,as_of:captured.as_of,rows,totals:salesTotals(rows)};
    await finance.issue(scope,key,fingerprint,snapshot);return snapshot;
   });
  },
  async readStatement(session:string,query:unknown,idInput:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$');return withReportScope(database,session,q.organizationId,q.franchiseId,false,correlation,async scope=>{const result=await finance.statement(scope,id);await finance.access(scope,id,'statement.read');return result;});
  },
 };
}
