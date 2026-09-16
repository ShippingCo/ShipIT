import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withPaymentScope } from '../memberships/service.ts';
import { appendPayment } from '../audit/repository.ts';
import { keyDigest } from '../pricing/idempotency.ts';
import * as validate from './validation.ts';
import * as repository from './repository.ts';
import { collect, reverse, fingerprint } from './rules.ts';
import type { PaymentOperation, PaymentResult } from './types.ts';
export function createPaymentService(database:DatabasePool) {
  async function execute(session:string,bookingInput:unknown,targetInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,operation:PaymentOperation,correlation:string):Promise<PaymentResult> {
    const booking=validate.uuid(bookingInput,'booking_id'),q=validate.selection(query),key=keyDigest(validate.idempotencyKey(keyInput,headers));
    const targetId=operation==='payments.reverse'?validate.uuid(targetInput,'payment_id'):null;
    const input=operation==='payments.collect'?validate.collection(body):validate.reversal(body);
    return withPaymentScope(database,session,q.organizationId,q.franchiseId,operation,correlation,async s=>{
      const time=await repository.active(s.command);
      // The immutable opening row is also the serialization boundary for all money effects.
      const o=await repository.obligation(s.command,booking,true);
      const target=targetId?await repository.entry(s.command,o,targetId):null;
      if(target&&target.kind!=='collection')throw new HttpError('RESOURCE_NOT_FOUND');
      const intent=fingerprint(operation,booking,o.id,targetId,input),previous=await repository.replay(s.command,key);
      if(previous){
        if(previous.fingerprint!==intent)throw new HttpError('IDEMPOTENCY_CONFLICT');
        if(!previous.result)throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
        return structuredClone(previous.result);
      }
      const existing='collection_reference' in input?await repository.reference(s.command,input.collection_reference):null;
      if(existing&&existing.fingerprint!==intent)throw new HttpError('PAYMENT_REFERENCE_CONFLICT');
      const command=randomUUID();
      if(existing){
        // Bind the new key too: a reference replay cannot leave a reusable command identity.
        await repository.reserve(s.command,command,o,key,intent,input,targetId,time);
        await repository.finish(s.command,command,existing.result);
        return structuredClone(existing.result);
      }
      const before=await repository.projection(s.command,o);
      if(before.version===2147483647)throw new HttpError('VERSION_CONFLICT');
      if(target)reverse(BigInt(o.total_paise),BigInt(before.collected_paise),BigInt(target.amount_paise),await repository.reversed(s.command,o,target.id),input.amount_paise);
      else collect(BigInt(o.total_paise),BigInt(before.collected_paise),input.amount_paise);
      await repository.reserve(s.command,command,o,key,intent,input,targetId,time);
      const entry=await repository.append(s.command,command,randomUUID(),o,before.version+1,input,target,time);
      const payment=await repository.projection(s.command,o),result={payment,entry:repository.entryDto(entry)};
      await appendPayment(s.audit!,booking,command,entry.id);
      if(before.outstanding_paise>0&&payment.outstanding_paise===0)await repository.settled(s.events!,result,command,randomUUID(),time);
      await repository.finish(s.command,command,result);
      return result;
    });
  }
  async function read(session:string,bookingInput:unknown,query:unknown,correlation:string) {
    const booking=validate.uuid(bookingInput,'booking_id'),q=validate.selection(query);
    return withPaymentScope(database,session,q.organizationId,q.franchiseId,'payments.read',correlation,async s=>
      repository.projection(s.command,await repository.obligation(s.command,booking)));
  }
  async function readEntry(session:string,bookingInput:unknown,entryInput:unknown,query:unknown,correlation:string) {
    const booking=validate.uuid(bookingInput,'booking_id'),id=validate.uuid(entryInput,'payment_id'),q=validate.selection(query);
    return withPaymentScope(database,session,q.organizationId,q.franchiseId,'payments.read',correlation,async s=>{
      const o=await repository.obligation(s.command,booking);
      return {payment:await repository.projection(s.command,o),entry:repository.entryDto(await repository.entry(s.command,o,id))};
    });
  }
  return {execute,read,readEntry};
}
