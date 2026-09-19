import { useEffect, useRef, useState, useId, useCallback } from 'react';
import { attachmentLimits, attachmentMedia, type AttachmentDto, type AttachmentPurpose } from '@shippingco/shared';
import { Msym } from './Icon';
import { attachmentIntent, type AttachmentClient } from '../../data-access/attachments';
import type { createScopeRuntime } from '../../data-access/scope-runtime';
import { ApiFailure } from '../../data-access/errors';
import { downscaleImageBlob } from '../../utils/image';
type Entry={localId:string;file?:Blob;preview?:string;dto?:AttachmentDto;progress:number;phase:'selected'|'uploading'|'scanning'|'ready'|'failed'|'unsafe';error?:string;controller:AbortController;initiateKey:string;finalizeKey:string;cancelKey:string;uploaded:boolean};
export interface AttachmentUploaderProps { client:AttachmentClient; runtime:ReturnType<typeof createScopeRuntime>; purpose?:AttachmentPurpose; parcelId?:string; onChange?:(items:AttachmentDto[])=>void; prepareImage?:typeof downscaleImageBlob }
const kinds=[{kind:'image',label:'Photo',icon:'photo_camera',accept:'image/jpeg,image/png'},{kind:'video',label:'Video',icon:'videocam',accept:'video/mp4'},{kind:'audio',label:'Voice note',icon:'mic',accept:'audio/mpeg,audio/wav'}] as const;
/** #33 consumes this standalone production surface; it has no prototype-store dependency. */
export function AttachmentUploader({client,runtime,purpose='shipment_evidence',parcelId,onChange,prepareImage=downscaleImageBlob}:AttachmentUploaderProps){
 const [entries,setEntries]=useState<Entry[]>([]),[message,setMessage]=useState(''),[loading,setLoading]=useState(true);
 const current=useRef<Entry[]>([]),mounted=useRef(true),label=useId(),inputRefs=useRef<Record<string,HTMLInputElement|null>>({});
 const onChangeRef=useRef(onChange);
 useEffect(()=>{onChangeRef.current=onChange;},[onChange]);
 const paint=useCallback(()=>{if(mounted.current){setEntries([...current.current]);onChangeRef.current?.(current.current.flatMap(e=>e.dto?.state==='ready'?[e.dto]:[]));}},[]);
 const active=(entry:Entry)=>mounted.current&&current.current.includes(entry)&&!entry.controller.signal.aborted;
 const purge=useCallback(()=>{for(const e of current.current){e.controller.abort();if(e.preview)URL.revokeObjectURL(e.preview);}current.current=[];if(mounted.current){setEntries([]);onChangeRef.current?.([]);setMessage('');setLoading(false);}},[]);
 useEffect(()=>{
   mounted.current=true;purge();let live=true;const ticket=runtime.ticket();
   const unsubscribe=runtime.onInvalidate(()=>{live=false;purge();});
   setLoading(true);
   void client.list(parcelId).then(items=>{if(!live||!runtime.isCurrent(ticket))return;
     current.current=items.map(dto=>({localId:dto.id,dto,progress:100,phase:dto.state==='ready'?'ready':dto.state==='rejected'?'unsafe':'failed',error:dto.state==='quarantined'?'Validation pending. Retry when ready.':undefined,controller:new AbortController(),initiateKey:crypto.randomUUID(),finalizeKey:crypto.randomUUID(),cancelKey:crypto.randomUUID(),uploaded:dto.state==='quarantined'}));paint();setLoading(false);
   }).catch(()=>{if(live&&runtime.isCurrent(ticket)){setMessage('Attachments could not be loaded.');setLoading(false);}});
   return()=>{live=false;unsubscribe();mounted.current=false;purge();};
 },[client,runtime,parcelId,paint,purge]);
 async function run(entry:Entry){
   entry.error=undefined;entry.phase=entry.uploaded?'scanning':'uploading';paint();
   try{
     if(!entry.dto){if(!entry.file)throw new Error();const body=await attachmentIntent(entry.file,purpose,parcelId);if(!active(entry))return;entry.dto=await client.initiate(body,entry.initiateKey);}
     if(!active(entry))return;
     if(!entry.uploaded){if(!entry.file)throw new Error();entry.dto=await client.upload(entry.dto.id,entry.file,n=>{if(active(entry)){entry.progress=n;paint();}},entry.controller.signal);entry.uploaded=true;}
     if(!active(entry))return;entry.phase='scanning';paint();entry.dto=await client.finalize(entry.dto.id,entry.finalizeKey);
     if(!active(entry))return;if(entry.dto.state!=='ready'||entry.dto.scan_state!=='clean')throw new ApiFailure('ATTACHMENT_REJECTED');entry.phase='ready';entry.file=undefined;setMessage('Attachment saved securely.');paint();
   }catch(error){if(!active(entry))return;const unsafe=error instanceof ApiFailure&&['ATTACHMENT_REJECTED','ATTACHMENT_CONTENT_MISMATCH','ATTACHMENT_TYPE_UNSUPPORTED'].includes(error.code);
     entry.phase=unsafe?'unsafe':'failed';entry.error=unsafe?'This file did not pass safety validation. Remove it and choose another.':error instanceof ApiFailure&&error.code==='ATTACHMENT_SCAN_FAILED'?'File is still quarantined. Retry validation.':'Attachment could not be saved. Retry the same upload.';
     if(unsafe&&entry.preview){URL.revokeObjectURL(entry.preview);entry.preview=undefined;}paint();}
 }
 async function select(file:File|undefined){
   if(!file)return;
   if(!file.size||file.size>attachmentLimits.fileBytes){setMessage('Choose a nonempty file up to 8 MiB.');return;}
   if(!Object.hasOwn(attachmentMedia,file.type)){setMessage('Choose a JPEG or PNG photo, MP3 or WAV voice note, or MP4 video.');return;}
   if(current.current.length>=attachmentLimits.count){setMessage('A booking can have at most 10 attachments.');return;}
   const entry:Entry={localId:crypto.randomUUID(),file,progress:0,phase:'selected',controller:new AbortController(),initiateKey:crypto.randomUUID(),finalizeKey:crypto.randomUUID(),cancelKey:crypto.randomUUID(),uploaded:false};
   current.current.push(entry);paint();
   try{if(file.type.startsWith('image/'))entry.file=await prepareImage(file,1280,0.8,entry.controller.signal);if(!active(entry))return;entry.preview=URL.createObjectURL(entry.file!);await run(entry);}
   catch{if(active(entry)){entry.phase='failed';entry.error='Photo could not be prepared. Remove it and choose another.';paint();}}
 }
 async function remove(entry:Entry){
   entry.controller.abort();if(entry.preview)URL.revokeObjectURL(entry.preview);current.current=current.current.filter(e=>e!==entry);paint();
   if(entry.dto&&entry.dto.state!=='ready')try{await client.cancel(entry.dto.id,entry.cancelKey);if(mounted.current)setMessage('Upload canceled. Temporary bytes will be cleaned.');}catch{if(mounted.current)setMessage('Cancellation could not be confirmed. Temporary uploads expire automatically.');}
 }
 async function preview(entry:Entry){try{if(!entry.dto)return;const ticket=runtime.ticket(),blob=await client.bytes(entry.dto.id,crypto.randomUUID());if(!active(entry)||!runtime.isCurrent(ticket))return;
   if(entry.preview)URL.revokeObjectURL(entry.preview);entry.preview=URL.createObjectURL(blob);paint();}catch{if(active(entry)){entry.error='Preview is unavailable. Try again.';paint();}}}
 return <section className="attach" aria-label="Private attachments" style={{minWidth:0,maxWidth:'100%'}}>
   <div className="attach-buttons">{kinds.map(k=><span key={k.kind}>
     <button type="button" className="attach-btn" disabled={loading} onClick={()=>inputRefs.current[k.kind]?.click()} aria-describedby={label}><Msym name={k.icon}/>{k.label}</button>
     <input ref={node=>{inputRefs.current[k.kind]=node;}} type="file" hidden aria-label={`Choose ${k.label.toLowerCase()}`} accept={k.accept} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void select(file);}}/>
   </span>)}</div>
   <p id={label} role="status" aria-live="polite">{loading?'Loading attachments…':message||'Private files. Up to 8 MiB each.'}</p>
   <ul className="attach-list">{entries.map(e=><li key={e.localId} style={{flexWrap:'wrap',maxWidth:'100%'}}>
     {e.preview&&(e.dto?.kind??e.file?.type.split('/')[0])==='image'&&<img src={e.preview} alt="Selected attachment preview"/>}
     {e.preview&&(e.dto?.kind??e.file?.type.split('/')[0])==='video'&&<video src={e.preview} controls preload="metadata"/>}
     {e.preview&&(e.dto?.kind??e.file?.type.split('/')[0])==='audio'&&<audio src={e.preview} controls preload="metadata"/>}
     <div className="u-grow" style={{minWidth:0,overflowWrap:'anywhere'}}><div className="attach-name">{e.dto?.filename??'Selected attachment'}</div>
       <div role="status" aria-live="polite">{e.phase==='ready'?'Saved securely':e.phase==='scanning'?'Checking file safety…':e.phase==='uploading'?`Uploading ${e.progress}%`:e.phase==='selected'?'Preparing file…':e.error}</div>
       {e.phase==='uploading'&&<progress aria-label="Upload progress" value={e.progress} max={100}/>}
       {e.phase==='ready'&&e.error&&<p role="alert">{e.error}</p>}
     </div>
     {e.phase==='failed'&&(e.file||e.uploaded)&&<button type="button" className="attach-btn" onClick={()=>{void run(e);}}>Retry attachment</button>}
     {e.phase==='ready'?<>{!e.preview&&<button type="button" className="attach-btn" onClick={()=>{void preview(e);}}>Preview attachment</button>}{e.preview&&<button type="button" className="attach-btn" onClick={()=>{URL.revokeObjectURL(e.preview!);e.preview=undefined;paint();}}>Hide preview</button>}</>:<button type="button" className="attach-btn" aria-label="Cancel attachment upload" onClick={()=>{void remove(e);}}>Cancel</button>}
   </li>)}</ul>
 </section>;
}
