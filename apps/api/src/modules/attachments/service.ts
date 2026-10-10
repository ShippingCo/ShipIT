import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { DatabasePool } from '@shippingco/db';
import type { AttachmentDto, AttachmentIntent, ExpenseAttachmentDto, ExpenseAttachmentIntent } from '@shippingco/shared';
import type { TenantAccess } from '../security/scope.ts';
import { withAttachmentScope } from '../memberships/service.ts';
import { HttpError } from '../../plugins/errors.ts';
import { attachmentDto, type AttachmentRow, type AttachmentDependencies, type AttachmentScope, type StoredIdentity } from './types.ts';
import * as v from './validation.ts';
import * as r from './repository.ts';
import { boundedStream, detectedType, readBounded } from './content.ts';
import { grantExpiry, grantToken, verifyGrant, type GrantReceipt } from './grants.ts';
const minutes=(now:Date,n:number)=>new Date(now.getTime()+n*60000);
export interface AttachmentLifecycleAdapter<T extends AttachmentDto|ExpenseAttachmentDto,I extends AttachmentIntent|ExpenseAttachmentIntent> {
 scope<V>(session:string,query:unknown,action:'attachments.read'|'attachments.write'|'attachments.download',correlation:string,work:(s:AttachmentScope)=>Promise<V>):Promise<V>;
 parent:typeof r.parent;find:typeof r.find;list:typeof r.list;quota:typeof r.quota;
 insert:(scope:TenantAccess,parent:string,input:I,now:Date)=>Promise<AttachmentRow>;
 listPurpose?:string;dto:(row:AttachmentRow)=>T;intent:(body:unknown)=>I;domain:(parent:string)=>string;path:(parent:string)=>string;
 newWrite?:(s:AttachmentScope,parent:string,operation:'initiate'|'upload'|'finalize'|'cancel')=>Promise<void>;
}
export function createAttachmentService(database:DatabasePool,deps:AttachmentDependencies) {
 return createAttachmentLifecycle(deps,{
  scope:<V>(session:string,query:unknown,action:'attachments.read'|'attachments.write'|'attachments.download',correlation:string,work:(s:AttachmentScope)=>Promise<V>)=>{const q=v.selection(query,['parcel_id','grant']);return withAttachmentScope(database,session,q.organizationId,q.franchiseId,action,correlation,work);},
  parent:r.parent,find:r.find,list:r.list,quota:r.quota,insert:r.insert,dto:attachmentDto,intent:v.intent,domain:parent=>parent,path:parent=>`/api/v1/bookings/${parent}/attachments`,
 });
}
export function createAttachmentLifecycle<T extends AttachmentDto|ExpenseAttachmentDto,I extends AttachmentIntent|ExpenseAttachmentIntent>(deps:AttachmentDependencies,adapter:AttachmentLifecycleAdapter<T,I>) {
  const now=deps.clock??(()=>new Date());
  const expired=(row:AttachmentRow)=>{if(now()>=row.upload_expires_at)throw new HttpError('ATTACHMENT_UPLOAD_EXPIRED');};
  const ready=(row:AttachmentRow)=>{if(row.state!=='ready'||row.scan_state!=='clean')throw new HttpError('ATTACHMENT_NOT_READY');};
  const identity=(row:AttachmentRow,stored:StoredIdentity|null)=>{
    if(!stored||stored.uploadId!==row.id||stored.size!==row.declared_size||stored.digest!==row.expected_digest)throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');
  };
  const scope=adapter.scope;
  async function authorized(s:AttachmentScope,booking:string,id:string,write:boolean) {
    const row=await adapter.find(s,booking,id);
    await adapter.parent(s,booking,row.parcel_id,row.purpose,write);return row;
  }
  async function initiate(session:string,bookingInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    v.selection(query);const booking=v.uuid(bookingInput),input=adapter.intent(body),key=v.key(keyInput),fingerprint=v.fingerprint('initiate',adapter.domain(booking),null,input);
    return scope(session,query,'attachments.write',correlation,async s=>{
      await adapter.parent(s,booking,('parcel_id' in input?input.parcel_id:null)??null,input.purpose,true);
      const replay=await r.replay<T>(s.access,'initiate',key,fingerprint);
      if(replay){await authorized(s,booking,replay.id,true);return replay;}
      await adapter.newWrite?.(s,booking,'initiate');
      await adapter.quota(s.access,booking,input.size_bytes);
      const row=await adapter.insert(s.access,booking,input,now()),result=adapter.dto(row);
      await r.receipt(s.access,row,'initiate',key,fingerprint,result,now());return result;
    });
  }
  async function upload(session:string,bookingInput:unknown,idInput:unknown,source:Readable,query:unknown,correlation:string,signal?:AbortSignal) {
    v.selection(query);const booking=v.uuid(bookingInput),id=v.uuid(idInput),attempt=randomUUID();
    const row=await scope(session,query,'attachments.write',correlation,async s=>{
      const current=await authorized(s,booking,id,true);await adapter.newWrite?.(s,booking,'upload');expired(current);
      if(!['pending_upload','quarantined'].includes(current.state))throw new HttpError('ATTACHMENT_NOT_READY');
      if(current.upload_lease_until&&current.upload_lease_until>now())throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
      return r.update(s.access,current,{upload_attempt:attempt,upload_lease_until:new Date(now().getTime()+30000)});
    });
    const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,20000);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    let bounded:ReturnType<typeof boundedStream>|undefined;
    try {
      const existing=await deps.store.head(row.object_key,controller.signal);
      if(existing){identity(row,existing);const bytes=await readBounded(source,row.declared_size,controller.signal);if(v.hash(bytes)!==row.expected_digest)throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');}
      else {
        bounded=boundedStream(source,row.declared_size,controller);
        await deps.store.put(row.object_key,bounded.stream,{uploadId:row.id,size:row.declared_size,digest:row.expected_digest},controller.signal);
        if(bounded.digest()!==row.expected_digest)throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');
        identity(row,await deps.store.head(row.object_key,controller.signal));
      }
      return await scope(session,query,'attachments.write',correlation,async s=>{
        const current=await authorized(s,booking,id,true);await adapter.newWrite?.(s,booking,'upload');expired(current);
        if(current.upload_attempt!==attempt||!['pending_upload','quarantined'].includes(current.state))throw new HttpError('ATTACHMENT_NOT_READY');
        return adapter.dto(await r.update(s.access,current,{state:'quarantined',uploaded_at:now(),upload_lease_until:null,upload_attempt:null}));
      });
    }catch(error){
      // The original identity/reservation remains durable even if this best-effort lease release fails.
      try {await scope(session,query,'attachments.write',correlation,async s=>{const current=await authorized(s,booking,id,true);
        if(current.upload_attempt===attempt&&['pending_upload','quarantined'].includes(current.state))await r.update(s.access,current,{upload_lease_until:null,upload_attempt:null});});}catch{/* durable lease expires */}
      if(controller.signal.reason instanceof HttpError)throw controller.signal.reason;
      if(error instanceof HttpError)throw error;throw new HttpError('ATTACHMENT_UPLOAD_FAILED');
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);bounded?.dispose();}
  }
  async function finalize(session:string,bookingInput:unknown,idInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    v.selection(query);v.object(body,[]);const booking=v.uuid(bookingInput),id=v.uuid(idInput),key=v.key(keyInput),fingerprint=v.fingerprint('finalize',adapter.domain(booking),id,{});
    const first=await scope(session,query,'attachments.write',correlation,async s=>{
      const row=await authorized(s,booking,id,true),replay=await r.replay<T>(s.access,'finalize',key,fingerprint);
      if(replay)return {result:replay};
      await adapter.newWrite?.(s,booking,'finalize');
      if(row.state==='ready'){const result=adapter.dto(row);await r.receipt(s.access,row,'finalize',key,fingerprint,result,now());return {result};}
      expired(row);if(row.state!=='quarantined')throw new HttpError('ATTACHMENT_NOT_READY');return {row};
    });
    if(first.result)return first.result;
    const row=first.row!,signal=AbortSignal.timeout(20000);
    let mime:string,digest:string,scan:'clean'|'infected'|'error';
    try {
      const stored=await deps.store.get(row.object_key,signal);
      try {identity(row,stored);}catch(error){stored.body.destroy();throw error;}
      const bytes=await readBounded(stored.body,row.declared_size,signal);digest=v.hash(bytes);mime=await detectedType(bytes);
      if(digest!==row.expected_digest||mime!==row.declared_type)throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');
      try{scan=await deps.scanner.scan(bytes,signal);}catch{scan='error';}
    }catch(error){
      if(error instanceof HttpError&&['ATTACHMENT_CONTENT_MISMATCH','ATTACHMENT_TYPE_UNSUPPORTED'].includes(error.code)){
        await scope(session,query,'attachments.write',correlation,async s=>{const current=await authorized(s,booking,id,true);
          if(current.state==='quarantined'&&current.version===row.version)await r.update(s.access,current,{state:'rejected',cleanup_due_at:minutes(now(),15)});});
      }
      if(error instanceof HttpError)throw error;throw new HttpError('TEMPORARILY_UNAVAILABLE');
    }
    const result=await scope(session,query,'attachments.write',correlation,async s=>{
      const current=await authorized(s,booking,id,true),replay=await r.replay<T>(s.access,'finalize',key,fingerprint);
      if(replay)return {dto:replay};
      await adapter.newWrite?.(s,booking,'finalize');
      if(current.state==='ready'){const dto=adapter.dto(current);await r.receipt(s.access,current,'finalize',key,fingerprint,dto,now());return {dto};}
      expired(current);if(current.state!=='quarantined')throw new HttpError('ATTACHMENT_NOT_READY');
      // Parallel clean validations of identical immutable bytes converge; cancellation never does.
      if(scan!=='clean'){
        await r.update(s.access,current,{scan_state:scan,state:scan==='infected'?'rejected':'quarantined',...(scan==='infected'?{cleanup_due_at:minutes(now(),15)}:{})});
        return {error:scan==='infected'?'ATTACHMENT_REJECTED' as const:'ATTACHMENT_SCAN_FAILED' as const};
      }
      const updated=await r.update(s.access,current,{state:'ready',scan_state:'clean',actual_size:row.declared_size,detected_type:mime,digest,validated_at:now(),linked_at:now(),cleanup_due_at:null});
      const dto=adapter.dto(updated);await r.receipt(s.access,updated,'finalize',key,fingerprint,dto,now());return {dto};
    });
    if(result.error)throw new HttpError(result.error);return result.dto!;
  }
  async function cancel(session:string,bookingInput:unknown,idInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    v.selection(query);v.object(body,[]);const booking=v.uuid(bookingInput),id=v.uuid(idInput),key=v.key(keyInput),fingerprint=v.fingerprint('cancel',adapter.domain(booking),id,{});
    return scope(session,query,'attachments.write',correlation,async s=>{
      let row=await authorized(s,booking,id,true);const replay=await r.replay<T>(s.access,'cancel',key,fingerprint);if(replay)return replay;
      await adapter.newWrite?.(s,booking,'cancel');
      if(row.state==='ready')throw new HttpError('ATTACHMENT_NOT_READY');
      if(['pending_upload','quarantined'].includes(row.state))row=await r.update(s.access,row,{state:'canceled',cleanup_due_at:minutes(now(),15)});
      const dto=adapter.dto(row);await r.receipt(s.access,row,'cancel',key,fingerprint,dto,now());return dto;
    });
  }
  async function list(session:string,bookingInput:unknown,query:unknown,correlation:string) {
    const booking=v.uuid(bookingInput),q=v.selection(query,['parcel_id']);
    return scope(session,query,'attachments.read',correlation,async s=>{await adapter.parent(s,booking,q.parcelId,q.parcelId?'parcel_proof':adapter.listPurpose??'shipment_evidence',false);
      return {items:(await adapter.list(s,booking,q.parcelId)).map(adapter.dto)};});
  }
  async function grant(session:string,bookingInput:unknown,idInput:unknown,keyInput:unknown,body:unknown,query:unknown,correlation:string) {
    v.selection(query);v.object(body,[]);const booking=v.uuid(bookingInput),id=v.uuid(idInput),key=v.key(keyInput),fingerprint=v.fingerprint('grant',adapter.domain(booking),id,{}),q=v.selection(query);
    const result=await scope(session,query,'attachments.download',correlation,async s=>{
      const row=await authorized(s,booking,id,false);ready(row);
      const previous=await r.replay<GrantReceipt>(s.access,'grant',key,fingerprint);if(previous)return {receipt:previous,row};
      const receipt={id,version:row.version,expires_at:new Date(now().getTime()+60000).toISOString()};
      await r.receipt(s.access,row,'grant',key,fingerprint,receipt,now());return {receipt,row};
    });
    identity(result.row,await deps.store.head(result.row.object_key));
    return {url:`${adapter.path(booking)}/${id}/content?`+new URLSearchParams({organization_id:q.organizationId,franchise_id:q.franchiseId,grant:grantToken(deps.signingKey,result.receipt,q.organizationId,q.franchiseId,adapter.domain(booking),session)}),expires_at:result.receipt.expires_at};
  }
  async function download(session:string,bookingInput:unknown,idInput:unknown,query:unknown,correlation:string) {
    const booking=v.uuid(bookingInput),id=v.uuid(idInput),q=v.selection(query,['grant']),token=v.object(query,['organization_id','franchise_id','grant']).grant;
    const authorize=()=>scope(session,query,'attachments.download',correlation,async s=>{
      const row=await authorized(s,booking,id,false);ready(row);
      verifyGrant(deps.signingKey,token,{id,version:row.version,expires_at:grantExpiry(token)},q.organizationId,q.franchiseId,adapter.domain(booking),session,now());return row;
    });
    const row=await authorize(),signal=AbortSignal.timeout(15000),stored=await deps.store.get(row.object_key,signal);
    try{identity(row,stored);}catch(error){stored.body.destroy();throw error;}
    const bytes=await readBounded(stored.body,row.declared_size,signal);
    if(v.hash(bytes)!==row.digest)throw new HttpError('ATTACHMENT_CONTENT_MISMATCH');
    await authorize(); // Recheck after provider delay and before releasing any byte.
    return {bytes,metadata:adapter.dto(row)};
  }
  return {initiate,upload,finalize,cancel,list,grant,download};
}
