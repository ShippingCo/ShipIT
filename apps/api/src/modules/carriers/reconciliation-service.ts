import { createHash } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withCarrierScope } from '../memberships/service.ts';
import { transitForCarrier } from '../parcels/service.ts';
import { digest } from '../pricing/idempotency.ts';
import { integer } from '../pricing/validation.ts';
import { ewayCursorCodec } from '../eway/cursor.ts';
import { reviewReason } from './reconciliation-policy.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';
import * as rr from './reconciliation-repository.ts';

export function resolution(value:unknown) {
  const b=v.object(value,['decision','reason_code','expected_version','expected_parcel_version']);
  if(!['apply','reject'].includes(String(b.decision))||
    !(b.decision==='apply'?['verified_movement']:['incorrect_report','superseded','insufficient_evidence']).includes(String(b.reason_code)))throw new HttpError('VALIDATION_FAILED');
  return {decision:b.decision as 'apply'|'reject',reason_code:String(b.reason_code),
    expected_version:integer(b.expected_version,'expected_version',1,2),expected_parcel_version:integer(b.expected_parcel_version,'expected_version',1,2147483646)};
}
export function createCarrierReconciliationService(database:DatabasePool,key:Buffer,clock=()=>new Date()) {
  const codec=ewayCursorCodec(createHash('sha256').update('carrier-review:v1').update(key).digest(),clock);
  async function list(session:string,idInput:unknown,query:unknown,correlation:string) {
    const id=v.uuid(idInput,'$'),q=v.selection(query,true);
    return withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.read',correlation,async({access:s,agentOnly,revision})=>{
      if(agentOnly)throw new HttpError('ACTION_FORBIDDEN');await r.installation(s,id);
      const binding=digest({id,q:{organization:q.organizationId,franchise:q.franchiseId,limit:q.limit},actor:s.context.actor.id,revision});
      const rows=await rr.queue(s,id,q.cursor?codec.decode(q.cursor,binding):null,q.limit),items=[];
      for(const row of rows.slice(0,q.limit)){
        const parcel=await rr.parcelFacts(s,row.parcel_id),current=await r.currentReference(s,id,row.parcel_id);
        const reason=reviewReason(row,parcel,clock(),current?.id===row.reference_id);
        items.push({id:row.id,parcel_id:row.parcel_id,reference_id:row.reference_id,status_code:row.status_code,status:row.status,
          external_docket:row.external_docket,source_id:row.source_id,decision_reason:row.decision_reason,decided_at:row.decided_at,
          occurred_at:row.occurred_at,time_reason:row.time_reason,received_at:row.received_at,source_mode:row.source_mode,source_ref:row.source_ref,
          duplicate_of:row.duplicate_of,version:row.decision?2:1,parcel_version:parcel.version,decision:row.decision,
          reason:reason==='ready'?(await rr.conflicting(s,row)?'source_conflict':await rr.newer(s,row)?'stale':reason):reason});
      }
      const check=await rr.checkpoint(s,id),fresh=await rr.freshness(s,id);
      return {items,page:{has_more:rows.length>q.limit,next_cursor:rows.length>q.limit?codec.encode(binding,items.at(-1)!.id):null},
        freshness:{...fresh,as_of:clock().toISOString(),state:check?.state??'not_connected',checked_at:check?.checked_at??null,
          checkpoint_version:check?.version??0,last_known:true}};
    });
  }
  async function resolve(session:string,idInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    const id=v.uuid(idInput,'$'),q=v.selection(query),input=resolution(body),key=v.keyDigest(v.idempotencyKey(keyInput)),fingerprint=digest({id,input});
    return withCarrierScope(database,session,q.organizationId,q.franchiseId,'carriers.write',correlation,async({access:s,transit,events})=>{
      const row=await rr.load(s,id);await r.installation(s,row.installation_id);await r.parcel(s,row.parcel_id);
      const prior=await rr.replay(s,key,fingerprint);
      if(prior){
        if(prior.decision==='apply'&&(!transit||!events))throw new HttpError('ACTION_FORBIDDEN');
        return {id:prior.id,record_id:prior.record_id,decision:prior.decision,event_id:prior.event_id};
      }
      const parcel=await rr.parcelFacts(s,row.parcel_id);
      if(input.expected_version!==1||await rr.resolved(s,id)||parcel.version!==input.expected_parcel_version)throw new HttpError('VERSION_CONFLICT');
      let event:string|null=null;
      if(input.decision==='apply'){
        const current=await r.currentReference(s,row.installation_id,row.parcel_id);
        if(reviewReason(row,parcel,clock(),current?.id===row.reference_id)!=='ready'||await rr.newer(s,row)||await rr.conflicting(s,row))throw new HttpError('PARCEL_STATE_CONFLICT');
        if(!transit||!events)throw new HttpError('ACTION_FORBIDDEN');
        event=await transitForCarrier(transit,events,row.parcel_id,parcel.version,row.id,clock().toISOString());
      }
      return rr.decide(s,row,key,fingerprint,input,event,clock());
    });
  }
  return {list,resolve};
}
