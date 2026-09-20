import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withEwayScope } from '../memberships/service.ts';
import { digest } from '../pricing/idempotency.ts';
import { capture,recordDto,type Capture,type EwayRow } from './types.ts';
import { evaluate,calculateEstimate } from './rules.ts';
import { ewayCursorCodec } from './cursor.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';
export function createEwayService(database:DatabasePool,key:Buffer,clock=()=>new Date()) {
  const cursors=ewayCursorCodec(key,clock);
  async function mutate(operation:'create'|'correct'|'estimate',session:string,bookingInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    const booking=v.uuid(bookingInput,'booking_id'),q=v.selection(query),keyHash=v.keyDigest(v.idempotencyKey(keyInput));
    const input=operation==='create'?v.create(body):operation==='correct'?v.correction(body):v.recalculate(body);
    const fingerprint=v.fingerprint(operation,booking,input);
    return withEwayScope(database,session,q.organizationId,q.franchiseId,'eway.write',correlation,async s=>{
      await r.parent(s.access,booking,true);const previous=await r.replay(s.access,operation,keyHash,fingerprint);if(previous)return previous;
      const current=await r.find(s.access,booking),now=clock();
      if(operation==='create'&&current)throw new HttpError('VERSION_CONFLICT');
      if(operation!=='create'&&(!current||!('expected_version' in input)||input.expected_version!==current.version))throw new HttpError('VERSION_CONFLICT');
      let next:Capture=current?capture(current):input as Capture;
      let estimate=current?.estimate??null,reason:EwayRow['reason_code']='initial_capture',reasonRef:string|null=null;
      if(operation==='correct'){
        const correction=input as ReturnType<typeof v.correction>;
        next={...next,...Object.fromEntries(Object.entries(correction).filter(([k])=>['declaration','external','vehicle_number','distance_km'].includes(k)))};
        reason=correction.reason_code;reasonRef=correction.reason_ref;
      }
      if(operation==='estimate'){
        const calculation=input as ReturnType<typeof v.recalculate>;
        estimate=calculateEstimate(await r.policy(s.access,now),next.distance_km,calculation.starts_at,now);reason='estimate_recalculation';reasonRef=calculation.reason_ref;
      }
      const command=randomUUID(),result={booking_id:booking,record_id:current?.id??randomUUID(),version:(current?.version??0)+1};
      await r.save(s.access,booking,result.record_id,result.version,next,estimate,command,reason,reasonRef,now);
      await r.receipt(s.access,command,result,operation,keyHash,fingerprint,now);return result;
    });
  }
  async function read(session:string,bookingInput:unknown,query:unknown,correlation:string) {
    const booking=v.uuid(bookingInput,'booking_id'),q=v.selection(query);
    return withEwayScope(database,session,q.organizationId,q.franchiseId,'eway.read',correlation,async s=>{
      await r.parent(s.access,booking,false);const row=await r.find(s.access,booking),now=clock();
      return {booking_id:booking,record:row?recordDto(row,s.accountantOnly):null,state:evaluate(row,await r.policy(s.access,now),now)};
    });
  }
  async function list(kind:'history'|'reminders',session:string,bookingInput:unknown,query:unknown,correlation:string) {
    const booking=kind==='history'?v.uuid(bookingInput,'booking_id'):null,q=v.selection(query,true);
    return withEwayScope(database,session,q.organizationId,q.franchiseId,'eway.read',correlation,async s=>{
      if(booking)await r.parent(s.access,booking,false);
      const now=clock(),policy=await r.policy(s.access,now);
      const stable=digest({binding:kind,booking,organization:q.organizationId,franchise:q.franchiseId,actor:s.access.context.actor.id,
        revision:s.revision,accountant:s.accountantOnly,limit:q.limit,policy:policy?.id??null});
      const after=q.cursor?cursors.decode(q.cursor,stable):null;
      if(kind==='history'){
        if(after!==null&&(!/^[1-9][0-9]{0,9}$/.test(after)||Number(after)>2147483647))throw new HttpError('CURSOR_INVALID');
        const rows=await r.history(s.access,booking!,Number(after??0),q.limit),more=rows.length>q.limit,items=rows.slice(0,q.limit);
        return {items:items.map(row=>recordDto(row,s.accountantOnly)),page:{has_more:more,next_cursor:more?cursors.encode(stable,String(items.at(-1)!.version)):null}};
      }
      if(after!==null&&!/^[0-9a-f-]{36}$/.test(after))throw new HttpError('CURSOR_INVALID');
      const rows=await r.reminders(s.access,after,q.limit),more=rows.length>q.limit,items=rows.slice(0,q.limit);
      return {items:items.map(row=>({booking_id:row.parent_booking_id,record_id:row.id??null,version:row.version??null,
        external_reference:row.external_reference??null,state:evaluate(row.id?row:null,policy,now)})),
        page:{has_more:more,next_cursor:more?cursors.encode(stable,items.at(-1)!.parent_booking_id):null}};
    });
  }
  return {mutate,read,list};
}
