import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {attachmentLimits,attachmentMedia,type AttachmentDto,type AttachmentIntent} from '@shippingco/shared';
import {attachmentIntent,type AttachmentClient} from '../data-access/attachments';
import {ApiFailure} from '../data-access/errors';
import type {createScopeRuntime} from '../data-access/scope-runtime';
import {downscaleImageBlob} from '../utils/image';
import {Msym} from '../components/m3/Icon';

type Runtime=ReturnType<typeof createScopeRuntime>;
type Phase='preparing'|'selected'|'uploading'|'checking'|'ready'|'failed'|'rejected';
interface Entry {
 id:string;name:string;file?:Blob;url?:string;phase:Phase;progress:number;error?:string;dto?:AttachmentDto;
 intent?:AttachmentIntent;controller:AbortController;initiateKey:string;finalizeKey:string;uploaded:boolean;
}
interface QueueState {entries:readonly Entry[];message:string;saved:boolean}

/** One booking draft only. No filenames, bytes or private URLs enter persistent storage. */
export function createBookingAttachmentQueue(runtime:Runtime,prepareImage=downscaleImageBlob) {
 const ticket=runtime.ticket(),listeners=new Set<()=>void>();let entries:Entry[]=[],state:QueueState={entries:[],message:'',saved:false};
 let client:AttachmentClient|null=null,live=true,draining=false;
 const current=()=>live&&runtime.isCurrent(ticket);
 const publish=(message=state.message)=>{if(!current())return;state={entries:[...entries],message,saved:client!==null};listeners.forEach(listener=>listener());};
 const active=(entry:Entry)=>current()&&entries.includes(entry)&&!entry.controller.signal.aborted;
 const revoke=(entry:Entry)=>{if(entry.url)URL.revokeObjectURL(entry.url);entry.url=undefined;};
 const clear=()=>{for(const entry of entries){entry.controller.abort();revoke(entry);entry.file=undefined;}entries=[];state={entries:[],message:'',saved:false};listeners.forEach(listener=>listener());};
 const invalidate=()=>{clear();live=false;client=null;};
 let unsubscribe=runtime.onInvalidate(invalidate);
 async function upload(entry:Entry){
  if(!client||!active(entry)||!['selected','failed'].includes(entry.phase))return;
  const bound=client;entry.error=undefined;entry.phase=entry.uploaded?'checking':'uploading';publish();
  try {
   if(!entry.dto){if(!entry.file)throw new Error('FILE_UNAVAILABLE');entry.intent??=await attachmentIntent(entry.file,'shipment_evidence');if(!active(entry))return;entry.dto=await bound.initiate(entry.intent,entry.initiateKey);}
   if(!active(entry))return;
   // An uncertain initiation/finalization can have committed. Resume its saved state.
   if(entry.dto.state==='ready'&&entry.dto.scan_state==='clean'){entry.phase='ready';entry.name=entry.dto.filename;entry.file=undefined;revoke(entry);publish();return;}
   if(['rejected','canceled','deleted','cleanup_pending'].includes(entry.dto.state))throw new ApiFailure('ATTACHMENT_REJECTED');
   if(entry.dto.state==='quarantined')entry.uploaded=true;
   if(!entry.uploaded){if(!entry.file)throw new Error('FILE_UNAVAILABLE');entry.dto=await bound.upload(entry.dto.id,entry.file,n=>{if(active(entry)){entry.progress=n;publish();}},entry.controller.signal);if(!active(entry))return;entry.uploaded=true;}
   entry.phase='checking';publish();entry.dto=await bound.finalize(entry.dto.id,entry.finalizeKey);if(!active(entry))return;
   if(entry.dto.state!=='ready'||entry.dto.scan_state!=='clean')throw new ApiFailure('ATTACHMENT_REJECTED');
   entry.phase='ready';entry.name=entry.dto.filename;entry.file=undefined;revoke(entry);publish('Attachments saved. Your booking remains unchanged.');
  }catch(error){if(!active(entry))return;const rejected=error instanceof ApiFailure&&['ATTACHMENT_REJECTED','ATTACHMENT_CONTENT_MISMATCH','ATTACHMENT_TYPE_UNSUPPORTED'].includes(error.code);entry.phase=rejected?'rejected':'failed';entry.error=rejected?'This file did not pass validation. Use Attachments on the saved booking to add a supported replacement.':'Booking saved. This attachment needs retry. Do not create another booking.';if(rejected){entry.file=undefined;revoke(entry);}publish();}
 }
 async function drain(){if(draining)return;draining=true;try{while(current()&&client){const entry=entries.find(e=>e.phase==='selected');if(!entry)break;await upload(entry);}}finally{draining=false;}}
 async function add(file:File){
  if(!current())return;
  if(client){publish('Use Attachments on the saved booking to add more files.');return;}
  if(!file.size||file.size>attachmentLimits.fileBytes){publish('Choose a nonempty file up to 8 MiB.');return;}
  if(!Object.hasOwn(attachmentMedia,file.type)){publish('Choose a PDF, JPEG or PNG invoice/photo, MP3 or WAV voice note, or MP4 video.');return;}
  if(entries.length>=attachmentLimits.count){publish('A booking can have at most 10 attachments.');return;}
  if(entries.reduce((sum,e)=>sum+(e.file?.size??e.dto?.size_bytes??0),0)+file.size>attachmentLimits.aggregateBytes){publish('Keep the total attachment size within 32 MiB.');return;}
  const entry:Entry={id:crypto.randomUUID(),name:file.name,file,phase:'preparing',progress:0,controller:new AbortController(),initiateKey:crypto.randomUUID(),finalizeKey:crypto.randomUUID(),uploaded:false};entries.push(entry);publish('');
  try{if(file.type.startsWith('image/'))entry.file=await prepareImage(file,1280,.8,entry.controller.signal);if(!active(entry))return;entry.url=URL.createObjectURL(entry.file!);entry.phase='selected';publish();if(client)void drain();}
  catch{if(active(entry)){entry.phase='failed';entry.error='This photo could not be prepared. Remove it and choose another.';publish();}}
 }
 return {
  snapshot:()=>state,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},
  activate(){if(!runtime.isCurrent(ticket))return;live=true;unsubscribe();unsubscribe=runtime.onInvalidate(invalidate);},
  dispose(){unsubscribe();invalidate();},
  bind(next:AttachmentClient|null){if(!current()||!next||client===next)return;if(client){invalidate();return;}client=next;publish();void drain();},
  add,remove(id:string){if(client||!current())return;const entry=entries.find(e=>e.id===id);if(!entry)return;entry.controller.abort();revoke(entry);entry.file=undefined;entries=entries.filter(e=>e!==entry);publish('File removed.');},
  retry(id:string){const entry=entries.find(e=>e.id===id);if(entry&&client)void upload(entry);},
  clear(){if(!client)clear();},
 };
}
export function useBookingAttachments({runtime,client}:{runtime:Runtime;client:AttachmentClient|null}) {
 const store=useMemo(()=>createBookingAttachmentQueue(runtime),[runtime]);
 const state=useSyncExternalStore(store.subscribe,store.snapshot);
 useEffect(()=>{store.activate();return()=>store.dispose();},[store]);
 useEffect(()=>{store.bind(client);},[store,client]);
 return {...state,count:state.entries.length,pending:state.entries.some(e=>e.phase!=='ready'&&e.phase!=='rejected'),uploading:state.entries.some(e=>['uploading','checking'].includes(e.phase)),add:store.add,remove:store.remove,retry:store.retry,clear:store.clear};
}
export type BookingAttachmentQueue=ReturnType<typeof useBookingAttachments>;
const labels:Record<Phase,string>={preparing:'Preparing file',selected:'Ready to upload after booking',uploading:'Uploading',checking:'Checking file safety',ready:'Saved securely',failed:'Needs attention',rejected:'File rejected'};
export function BookingAttachments({queue,disabled=false,compact=false}:{queue:BookingAttachmentQueue;disabled?:boolean;compact?:boolean}) {
 const input=useRef<HTMLInputElement>(null),help=useId();
 const [accept,setAccept]=useState('application/pdf,image/jpeg,image/png,audio/mpeg,audio/wav,video/mp4');
 return <section className="booking-draft-attachments" aria-label="Booking attachments">
  {!compact&&<h3>Attachments <span className="muted">(optional)</span></h3>}
  {!queue.saved&&<>{compact?<div className="attach-buttons">{[{label:"Photo",icon:"photo_camera",accept:"image/jpeg,image/png"},{label:"Video",icon:"videocam",accept:"video/mp4"},{label:"Voice note",icon:"mic",accept:"audio/mpeg,audio/wav"}].map(kind=><button type="button" className="attach-btn" key={kind.label} disabled={disabled} onClick={()=>{setAccept(kind.accept);if(input.current){input.current.accept=kind.accept;input.current.click();}}}><Msym name={kind.icon}/>{kind.label}</button>)}</div>:<button type="button" className="btn btn-outlined" disabled={disabled} aria-describedby={help} onClick={()=>input.current?.click()}><Msym name="attach_file"/>Add files</button>}
   <input ref={input} hidden multiple type="file" disabled={disabled} aria-label="Choose booking attachments" accept={accept} onChange={event=>{for(const file of Array.from(event.target.files??[]))void queue.add(file);event.target.value='';}}/>
   <p id={help} className={compact?'sr-only':'counter-help'}>PDF invoices, photos, voice notes or video. Up to 8 MiB each; 10 files. Files upload after the booking is saved.</p></>}
  {queue.message&&<p role="status">{queue.message}</p>}
  {queue.saved&&queue.pending&&<p role="status">Your booking is saved. Keep this page open while attachments finish. Retry failed attachments here.</p>}
  <ul className="booking-attachment-list">{queue.entries.map(entry=><li key={entry.id}>
   <div><strong style={{overflowWrap:'anywhere'}}>{entry.name}</strong><p className="counter-help" role="status">{labels[entry.phase]}{entry.phase==='uploading'?` ${entry.progress}%`:''}</p>
    {entry.phase==='uploading'&&<progress aria-label={`Upload progress for ${entry.name}`} max={100} value={entry.progress}/>}
    {entry.error&&<p role="alert">{entry.error}</p>}
   </div><div className="ops-actions">
    {!queue.saved&&<button type="button" className="btn btn-text" disabled={disabled} onClick={()=>queue.remove(entry.id)} aria-label={`Remove ${entry.name}`}>Remove</button>}
    {queue.saved&&entry.phase==='failed'&&<button type="button" className="btn btn-outlined" disabled={disabled} onClick={()=>queue.retry(entry.id)} aria-label={`Retry attachment ${entry.name}`}>Retry attachment</button>}
   </div>
  </li>)}</ul>
 </section>;
}
