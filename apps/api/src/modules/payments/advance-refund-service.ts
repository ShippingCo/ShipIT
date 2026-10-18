import {randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import type {AdvanceRefundCommand,AdvanceRefundOperation} from '@shippingco/shared';
import {withMoneyReceiptScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery} from '../security/scope.ts';
import {object,integer,uuid,selection,idempotencyKey,timestamp} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
const actions=['money_receipts.refund.request','money_receipts.refund.review','money_receipts.refund.return','money_receipts.read'] as const;
function text(value:unknown,max:number){if(typeof value!=='string'||value.trim().length<3||value.trim().length>max||[...value].some(c=>{const n=c.codePointAt(0)!;return n<32||n>=127&&n<=159||n>=0xd800&&n<=0xdfff;}))throw new FieldValidationError('$','INVALID_FORMAT');return value.trim();}
function reference(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(value))throw new FieldValidationError('$','INVALID_FORMAT');return value;}
function inputFor(operation:AdvanceRefundOperation,body:unknown):Record<string,unknown>{
 if(operation==='request'){const b=object(body,['expected_receipt_version','amount_paise','reason']);return {expected_receipt_version:integer(b.expected_receipt_version,'expected_version',1,2147483646),amount_paise:integer(b.amount_paise,'amount_paise',1),reason:text(b.reason,500)};}
 if(operation!=='return'){const b=object(body,['expected_version','reason']);return {expected_version:integer(b.expected_version,'expected_version',1,2),reason:text(b.reason,500)};}
 const b=object(body,['expected_version','source_location_id','source_revision_id','method','occurred_at','transfer_ref','returned_to_ref','reason']);
 if(typeof b.method!=='string'||!['cash','upi','card','bank_transfer','other'].includes(b.method))throw new FieldValidationError('method','INVALID_FORMAT');
 return {expected_version:integer(b.expected_version,'expected_version',2,2),source_location_id:uuid(b.source_location_id,'$'),source_revision_id:uuid(b.source_revision_id,'$'),method:b.method,occurred_at:timestamp(b.occurred_at,'occurred_at'),transfer_ref:reference(b.transfer_ref),returned_to_ref:reference(b.returned_to_ref),reason:text(b.reason,500)};
}
const columns=`id,request_id,receipt_id,version,operation,actor_id,to_char(recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded_at,amount_paise::float8,input`;
export function createAdvanceRefundService(database:DatabasePool,writesEnabled:boolean){return {
 async refundCommand(token:string,receiptInput:unknown,requestInput:unknown,operation:AdvanceRefundOperation,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string):Promise<AdvanceRefundCommand>{
  const q=selection(query),receipt=uuid(receiptInput,'receipt_id'),request=operation==='request'?null:uuid(requestInput,'$'),input=inputFor(operation,body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation,receipt,request,input});
  const action=operation==='request'?'money_receipts.refund.request':operation==='return'?'money_receipts.refund.return':'money_receipts.refund.review';
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,action,correlation,async s=>{
   const c=assertTenantAccess(s.command,[...actions]);
   const franchise=(await scopedQuery<{lifecycle:string}>(s.command,[...actions],`SELECT lifecycle FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
   if(!franchise)throw new HttpError('RESOURCE_NOT_FOUND');if(franchise.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
   if(!(await scopedQuery(s.command,[...actions],`SELECT id FROM shipit.money_receipts WHERE {{franchise:organization_id:franchise_id}} AND id=$1 FOR UPDATE`,[receipt])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
   const saved=(await scopedQuery<AdvanceRefundCommand&{fingerprint:string}>(s.command,[...actions],`SELECT ${columns},fingerprint FROM shipit.advance_refund_commands WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
   if(saved){if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');const {fingerprint:_fingerprint,...result}=saved;void _fingerprint;return result;}
   if(!writesEnabled)throw new HttpError('MONEY_RECEIPTS_DISABLED');
   const root=request?(await scopedQuery<{amount_paise:string}>(s.command,[...actions],`SELECT amount_paise FROM shipit.advance_refund_commands WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND receipt_id=$2 AND operation='request'`,[request,receipt])).rows[0]:null;
   if(request&&!root)throw new HttpError('RESOURCE_NOT_FOUND');
   const id=randomUUID();
   try{
    const row=(await scopedQuery<AdvanceRefundCommand>(s.command,[...actions],`INSERT INTO shipit.advance_refund_commands(id,organization_id,franchise_id,receipt_id,request_id,version,operation,actor_id,correlation_id,key_digest,fingerprint,input,amount_paise,receipt_version)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0 WHERE {{franchise:$13:$2}} RETURNING ${columns}`,[id,c.permittedFranchiseIds[0],receipt,request??id,operation==='request'?1:Number(input.expected_version)+1,operation,c.actor.id,c.correlationId,key,fingerprint,input,root?.amount_paise??input.amount_paise,c.organizationId])).rows[0];
    if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return row;
   }catch(error){if(error instanceof DatabaseError){if(error.sqlState==='40001'||error.sqlState==='23505')throw new HttpError('VERSION_CONFLICT');if(error.sqlState==='42501')throw new HttpError('ACTION_FORBIDDEN');if(error.sqlState==='23514')throw new FieldValidationError('$','INVALID_FORMAT');}throw error;}
  });
 },
 async refunds(token:string,receiptInput:unknown,query:unknown,correlation:string){
  const b=object(query,['organization_id','franchise_id','cursor']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),receipt=uuid(receiptInput,'receipt_id'),cursor=b.cursor===undefined?null:uuid(b.cursor,'cursor');
  return withMoneyReceiptScope(database,token,q.organizationId,q.franchiseId,'money_receipts.read',correlation,async s=>{
   if(!(await scopedQuery(s.command,[...actions],`SELECT id FROM shipit.money_receipts WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[receipt])).rows.length)throw new HttpError('RESOURCE_NOT_FOUND');
   const rows=(await scopedQuery<AdvanceRefundCommand>(s.command,[...actions],`SELECT ${columns} FROM shipit.advance_refund_commands WHERE {{franchise:organization_id:franchise_id}} AND receipt_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT 101`,[receipt,cursor])).rows;
   return {items:rows.slice(0,100),next_cursor:rows.length>100?rows[99]!.id:null};
  });
 }
};}
