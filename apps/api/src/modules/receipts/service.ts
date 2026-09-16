import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { withReceiptScope } from '../memberships/service.ts';
import { obligation, receiptEntry } from '../payments/repository.ts';
import * as r from './repository.ts';
import { receiptDto } from './types.ts';
import { selection, uuid } from './validation.ts';
export function createReceiptService(database:DatabasePool) {
  async function read(session:string,bookingInput:unknown,paymentInput:unknown,query:unknown,correlation:string) {
    const booking=uuid(bookingInput,'booking_id'),payment=paymentInput===null?null:uuid(paymentInput,'payment_id'),q=selection(query);
    return withReceiptScope(database,session,q.organizationId,q.franchiseId,correlation,async s=>{
      const existing=await r.find(s.read,booking,payment);
      if(existing)return receiptDto(existing);
      // The existing Payments opening lock serializes all receipts against this Booking.
      const o=await obligation(s.payment,booking,true);
      const entry=payment?await receiptEntry(s.payment,o,payment):null;
      const base=await r.find(s.read,booking,null)??await r.insert(s.materialize,randomUUID(),booking,o.id,'booking_charge',null,null,null);
      if(!entry)return receiptDto(base);
      let correction:string|null=null;
      if(entry.kind==='reversal'){
        const original=await receiptEntry(s.payment,o,entry.reversal_of!);
        const originalReceipt=await r.find(s.read,booking,original.id)??await r.insert(s.materialize,randomUUID(),booking,o.id,'collection_acknowledgement',original.id,base.id,null);
        correction=originalReceipt.id;
      }
      return receiptDto(await r.insert(s.materialize,randomUUID(),booking,o.id,entry.kind==='collection'?'collection_acknowledgement':'collection_reversal',entry.id,base.id,correction));
    });
  }
  async function readId(session:string,idInput:unknown,query:unknown,correlation:string) {
    const id=uuid(idInput,'receipt_id'),q=selection(query);
    return withReceiptScope(database,session,q.organizationId,q.franchiseId,correlation,async s=>receiptDto(await r.byId(s.read,id)));
  }
  return {read,readId};
}
