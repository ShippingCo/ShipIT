import { attachmentLimits, attachmentMedia, type AttachmentDto, type AttachmentIntent, type AttachmentDownloadGrant } from '@shippingco/shared';
import { browserConfig } from '../config';
import { createApiClient } from './api-client';
import { ApiFailure, responseFailure } from './errors';
import type { createScopeRuntime } from './scope-runtime';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function attachmentMetadata(value:unknown):AttachmentDto {
  if(!value||typeof value!=='object')throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol'});
  const r=value as AttachmentDto;
  if(!uuid.test(r.id)||!uuid.test(r.booking_id)||(r.parcel_id!==null&&!uuid.test(r.parcel_id))||!Object.hasOwn(attachmentMedia,r.media_type)||attachmentMedia[r.media_type]!==r.kind||!['shipment_evidence','parcel_proof'].includes(r.purpose)||!['pending_upload','quarantined','ready','canceled','rejected','cleanup_pending','deleted'].includes(r.state)||!['pending','clean','infected','error'].includes(r.scan_state)||!['operational_evidence','delivery_proof'].includes(r.retention_class)||!Number.isInteger(r.size_bytes)||r.size_bytes<1||r.size_bytes>attachmentLimits.fileBytes||!Number.isInteger(r.version)||r.version<1||typeof r.filename!=='string'||!/^(photo\.(jpg|png)|voice-note\.(mp3|wav)|video\.mp4)$/.test(r.filename)||!Number.isFinite(Date.parse(r.created_at))||!Number.isFinite(Date.parse(r.upload_expires_at))||(r.linked_at!==null&&!Number.isFinite(Date.parse(r.linked_at)))||(r.state==='ready'&&(r.scan_state!=='clean'||!r.linked_at)))throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol'});
  // Explicit projection discards arbitrary URL/key/filename/private response fields.
  return {id:r.id,booking_id:r.booking_id,parcel_id:r.parcel_id,purpose:r.purpose,kind:r.kind,filename:r.filename,size_bytes:r.size_bytes,media_type:r.media_type,state:r.state,scan_state:r.scan_state,retention_class:r.retention_class,version:r.version,created_at:r.created_at,upload_expires_at:r.upload_expires_at,linked_at:r.linked_at};
}
export async function attachmentIntent(file:Blob,purpose:AttachmentIntent['purpose'],parcelId?:string):Promise<AttachmentIntent> {
  if(!file.size||file.size>attachmentLimits.fileBytes)throw new ApiFailure('ATTACHMENT_LIMIT_EXCEEDED');
  if(!Object.hasOwn(attachmentMedia,file.type))throw new ApiFailure('ATTACHMENT_TYPE_UNSUPPORTED');
  const bytes=await file.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);
  return {purpose,...(parcelId?{parcel_id:parcelId}:{}),media_type:file.type as AttachmentIntent['media_type'],kind:attachmentMedia[file.type as keyof typeof attachmentMedia],size_bytes:file.size,sha256:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')};
}
export function createAttachmentClient(runtime:ReturnType<typeof createScopeRuntime>,bookingId:string,api=createApiClient(),xhrFactory:()=>XMLHttpRequest=()=>new XMLHttpRequest()) {
  if(!uuid.test(bookingId))throw new ApiFailure('MALFORMED_REQUEST');
  function context(){const ticket=runtime.ticket(),a=ticket.authority;
    if(!a?.organizationId||!a.franchiseId||!uuid.test(a.organizationId)||!uuid.test(a.franchiseId))throw new ApiFailure('SCOPE_CHANGED');
    return {ticket,query:new URLSearchParams({organization_id:a.organizationId,franchise_id:a.franchiseId}).toString()};}
  const base=`/api/v1/bookings/${bookingId}/attachments`;
  const id=(value:string)=>{if(!uuid.test(value))throw new ApiFailure('MALFORMED_REQUEST');return value;};
  async function command(path:string,body:unknown,key:string){const c=context();const result=await api.request<unknown>(base+path+'?'+c.query,{body,key,signal:c.ticket.signal});
    if(!runtime.isCurrent(c.ticket))throw new ApiFailure('SCOPE_CHANGED');const dto=attachmentMetadata(result);if(dto.booking_id!==bookingId)throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol'});return dto;}
  return {
    initiate:(body:AttachmentIntent,key:string)=>command('/uploads',body,key),
    finalize:(uploadId:string,key:string)=>command(`/uploads/${id(uploadId)}/finalize`,{},key),
    cancel:(uploadId:string,key:string)=>command(`/uploads/${id(uploadId)}/cancel`,{},key),
    async list(parcelId?:string){const c=context();const result=await api.request<{items:unknown[]}>(base+'?'+c.query+(parcelId?'&parcel_id='+id(parcelId):''),{signal:c.ticket.signal});
      if(!runtime.isCurrent(c.ticket))throw new ApiFailure('SCOPE_CHANGED');if(!Array.isArray(result.items)||result.items.length>10)throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol'});
      return result.items.map(value=>{const dto=attachmentMetadata(value);if(dto.booking_id!==bookingId)throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol'});return dto;});},
    async upload(uploadId:string,file:Blob,onProgress:(percentage:number)=>void,signal:AbortSignal){
      const c=context(),path=base+`/uploads/${id(uploadId)}/content?`+c.query;
      const boot=await api.request<{csrf_token:string}>('/auth/bootstrap',{signal});
      if(!runtime.isCurrent(c.ticket)||signal.aborted)throw new ApiFailure('SCOPE_CHANGED');
      if(typeof boot.csrf_token!=='string'||!/^[A-Za-z0-9._-]{1,512}$/.test(boot.csrf_token))throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol'});
      return new Promise<AttachmentDto>((resolve,reject)=>{
        const xhr=xhrFactory();let done=false;
        const finish=(error?:ApiFailure,value?:AttachmentDto)=>{if(done)return;done=true;signal.removeEventListener('abort',abort);c.ticket.signal.removeEventListener('abort',abort);if(error)reject(error);else resolve(value!);};
        const abort=()=>{xhr.abort();finish(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'aborted',dispatched:true}));};
        xhr.open('PUT',browserConfig.apiBaseUrl+path);xhr.withCredentials=true;xhr.timeout=30000;
        xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.setRequestHeader('X-CSRF-Token',boot.csrf_token);xhr.setRequestHeader('Accept','application/json');
        xhr.upload.onprogress=event=>{if(runtime.isCurrent(c.ticket)&&!signal.aborted)onProgress(Math.min(100,Math.floor(event.loaded/file.size*100)));};
        xhr.onerror=()=>finish(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));xhr.ontimeout=xhr.onerror;xhr.onabort=()=>finish(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'aborted',dispatched:true}));
        xhr.onload=()=>{try{if(!runtime.isCurrent(c.ticket)||signal.aborted)throw new ApiFailure('SCOPE_CHANGED');const body:unknown=JSON.parse(xhr.responseText);
          if(xhr.status<200||xhr.status>=300)throw responseFailure(xhr.status,body,null,[],true);const dto=attachmentMetadata(body);if(dto.id!==uploadId||dto.booking_id!==bookingId)throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol'});finish(undefined,dto);
        }catch(error){finish(error instanceof ApiFailure?error:new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol',dispatched:true}));}};
        signal.addEventListener('abort',abort,{once:true});c.ticket.signal.addEventListener('abort',abort,{once:true});
        if(signal.aborted||c.ticket.signal.aborted){abort();return;}xhr.send(file);
      });
    },
    async bytes(attachmentId:string,key:string){const c=context();const grant=await api.request<AttachmentDownloadGrant>(base+`/${id(attachmentId)}/download-grants?`+c.query,{body:{},key,signal:c.ticket.signal});
      if(!runtime.isCurrent(c.ticket))throw new ApiFailure('SCOPE_CHANGED');
      const url=new URL(grant.url,'https://attachment.invalid');
      if(url.origin!=='https://attachment.invalid'||url.pathname!==base+`/${attachmentId}/content`||url.searchParams.get('organization_id')!==c.ticket.authority?.organizationId||url.searchParams.get('franchise_id')!==c.ticket.authority?.franchiseId||!url.searchParams.get('grant')||url.hash)throw new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'protocol'});
      const response=await fetch(browserConfig.apiBaseUrl+url.pathname+url.search,{credentials:'include',cache:'no-store',redirect:'error',signal:c.ticket.signal,referrerPolicy:'no-referrer'});
      if(!response.ok)throw responseFailure(response.status,null,null,[],false);
      const type=response.headers.get('content-type')?.split(';')[0]??'',reader=response.body?.getReader();
      if(!reader||!Object.hasOwn(attachmentMedia,type)){await reader?.cancel();throw new ApiFailure('ATTACHMENT_CONTENT_MISMATCH');}
      const chunks:Uint8Array<ArrayBuffer>[]= [];let size=0;
      try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
        if(size>attachmentLimits.fileBytes)throw new ApiFailure('ATTACHMENT_LIMIT_EXCEEDED');chunks.push(new Uint8Array(part.value));}}
      catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}
      const blob=new Blob(chunks,{type});
      if(!runtime.isCurrent(c.ticket))throw new ApiFailure('SCOPE_CHANGED');if(blob.size>attachmentLimits.fileBytes||!Object.hasOwn(attachmentMedia,blob.type))throw new ApiFailure('ATTACHMENT_CONTENT_MISMATCH');return blob;
    },
  };
}
export type AttachmentClient=ReturnType<typeof createAttachmentClient>;
