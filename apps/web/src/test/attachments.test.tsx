import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { attachmentMetadata, createAttachmentClient, type AttachmentClient } from '../data-access/attachments';
import { createScopeRuntime } from '../data-access/scope-runtime';
import { AttachmentUploader } from '../components/m3/AttachmentUploader';
import { ApiFailure } from '../data-access/errors';
import type { AttachmentDto } from '@shippingco/shared';
const org='10000000-0000-4000-8000-000000000001',branch='10000000-0000-4000-8000-000000000002',booking='10000000-0000-4000-8000-000000000003',id='10000000-0000-4000-8000-000000000004';
const dto:AttachmentDto={id,booking_id:booking,parcel_id:null,purpose:'shipment_evidence',kind:'audio',filename:'voice-note.wav',size_bytes:4,media_type:'audio/wav',state:'ready',scan_state:'clean',retention_class:'operational_evidence',version:4,created_at:'2099-01-01T00:00:00.000Z',upload_expires_at:'2099-01-01T00:15:00.000Z',linked_at:'2099-01-01T00:00:01.000Z'};
const runtime=()=>{const r=createScopeRuntime();r.bind({userId:id,organizationId:org,franchiseId:branch,permissions:'operator'});return r;};
function setup(){const r=runtime(),client={list:vi.fn().mockResolvedValue([]),initiate:vi.fn().mockResolvedValue({...dto,state:'pending_upload',scan_state:'pending'}),upload:vi.fn().mockResolvedValue({...dto,state:'quarantined',scan_state:'pending'}),finalize:vi.fn().mockResolvedValue(dto),cancel:vi.fn().mockResolvedValue({...dto,state:'canceled'}),bytes:vi.fn().mockResolvedValue(new Blob(['test'],{type:'audio/wav'}))} satisfies AttachmentClient;
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn().mockReturnValue('blob:synthetic-preview'),revokeObjectURL:vi.fn()}));
 const file=new File(['test'],'SYN_ADDRESS_PHONE_SECRET.wav',{type:'audio/wav'});Object.defineProperty(file,'arrayBuffer',{value:async()=>new Uint8Array([1,2,3,4]).buffer});
 // jsdom does not implement subtle; the native digest boundary is tested in the adapter suite.
 vi.stubGlobal('crypto',{randomUUID:()=>id,subtle:{digest:async()=>new Uint8Array(32).buffer}});
 return {r,client,file};}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('private attachment UI',()=>{
 it('selects, shows progress and pending scan, then retains only approved metadata',async()=>{
  const {r,client,file}=setup();let complete!:(v:AttachmentDto)=>void;
  client.upload.mockImplementation(async(_id,_file,progress)=>{progress(42);return new Promise(resolve=>{complete=resolve;});});
  const changed=vi.fn();render(<AttachmentUploader client={client} runtime={r} onChange={changed}/>);await screen.findByText('Private files. Up to 8 MiB each.');
  fireEvent.change(screen.getByLabelText('Choose voice note'),{target:{files:[file]}});await screen.findByText('Uploading 42%');expect(screen.getByRole('progressbar')).toHaveAttribute('value','42');
  await act(async()=>complete({...dto,state:'quarantined'}));await screen.findByText('Saved securely');expect(changed).toHaveBeenLastCalledWith([dto]);expect(screen.queryByText(file.name)).toBeNull();expect(client.initiate.mock.calls[0]![0]).not.toHaveProperty('name');
  expect(JSON.stringify(changed.mock.calls)).not.toMatch(/data:|blob:|SYN_ADDRESS/);
 });
 it('cancels in-flight bytes, revokes preview, and sends durable cancel',async()=>{
  const {r,client,file}=setup();let aborted=false;client.upload.mockImplementation(async(_id,_file,_progress,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'aborted'}));})));
  render(<AttachmentUploader client={client} runtime={r}/>);await screen.findByText('Private files. Up to 8 MiB each.');fireEvent.change(screen.getByLabelText('Choose voice note'),{target:{files:[file]}});await waitFor(()=>expect(client.upload).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button',{name:'Cancel attachment upload'}));await screen.findByText('Upload canceled. Temporary bytes will be cleaned.');expect(aborted).toBe(true);expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-preview');expect(client.cancel).toHaveBeenCalled();
 });
 it('retries the same intent after network failure and announces unsafe responses without rendering bytes',async()=>{
  const {r,client,file}=setup();client.upload.mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network'}));client.finalize.mockRejectedValueOnce(new ApiFailure('ATTACHMENT_REJECTED'));
  render(<AttachmentUploader client={client} runtime={r}/>);await screen.findByText('Private files. Up to 8 MiB each.');fireEvent.change(screen.getByLabelText('Choose voice note'),{target:{files:[file]}});fireEvent.click(await screen.findByRole('button',{name:'Retry attachment'}));
  await screen.findByText('This file did not pass safety validation. Remove it and choose another.');expect(client.initiate).toHaveBeenCalledTimes(1);expect(URL.revokeObjectURL).toHaveBeenCalled();expect(document.querySelector('audio')).toBeNull();
 });
 it.each(['scope switch','logout','unmount'])('purges and aborts previews on %s',async reason=>{
  const {r,client,file}=setup();const view=render(<AttachmentUploader client={client} runtime={r}/>);await screen.findByText('Private files. Up to 8 MiB each.');fireEvent.change(screen.getByLabelText('Choose voice note'),{target:{files:[file]}});await screen.findByText('Saved securely');
  act(()=>{if(reason==='unmount')view.unmount();else r.invalidate();});expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-preview');expect(document.querySelector('audio')).toBeNull();expect(screen.queryByText('voice-note.wav')).toBeNull();
 });
 it('validates selection and provides native keyboard buttons and associated async text',async()=>{
  const {r,client}=setup();render(<AttachmentUploader client={client} runtime={r}/>);await screen.findByText('Private files. Up to 8 MiB each.');const button=screen.getByRole('button',{name:'Photo'});button.focus();expect(button).toHaveFocus();expect(button).toHaveAttribute('aria-describedby');
  fireEvent.change(screen.getByLabelText('Choose voice note'),{target:{files:[new File(['MZ'],'parcel.jpg',{type:'application/x-msdownload'})]}});await screen.findByText(/Choose a JPEG or PNG/);expect(client.initiate).not.toHaveBeenCalled();
  const file=new File(['x'],'large.mp4',{type:'video/mp4'});Object.defineProperty(file,'size',{value:8388609});fireEvent.change(screen.getByLabelText('Choose video'),{target:{files:[file]}});await screen.findByText('Choose a nonempty file up to 8 MiB.');
 });
 it('loads durable metadata and fetches bytes only on explicit preview',async()=>{
  const {r,client}=setup();client.list.mockResolvedValue([dto]);render(<AttachmentUploader client={client} runtime={r}/>);await screen.findByText('Saved securely');expect(client.bytes).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Preview attachment'}));await waitFor(()=>expect(document.querySelector('audio')).not.toBeNull());fireEvent.click(screen.getByRole('button',{name:'Hide preview'}));expect(URL.revokeObjectURL).toHaveBeenCalled();
 });
});
it('public metadata discards unsafe extra fields and rejects a forged ready result',()=>{
 expect(attachmentMetadata({...dto,url:'https://foreign.example/private',object_key:'evidence/private',bytes:'data:audio/unsafe'})).toEqual(dto);
 expect(()=>attachmentMetadata({...dto,scan_state:'error'})).toThrow();expect(()=>attachmentMetadata({...dto,filename:'SYN_SECRET'})).toThrow();
});
it('XHR uses current CSRF/session, progress, abort and safe response projection',async()=>{
 const r=runtime(),listeners:{xhr?:XMLHttpRequest}={};let sent:unknown;
 const xhr={upload:{},open:vi.fn(),setRequestHeader:vi.fn(),send:vi.fn((value:unknown)=>{sent=value;}),abort:vi.fn(),status:200,responseText:JSON.stringify(dto)} as unknown as XMLHttpRequest;listeners.xhr=xhr;
 const api={request:vi.fn().mockResolvedValue({csrf_token:'synthetic.csrf'})},client=createAttachmentClient(r,booking,api,()=>xhr),controller=new AbortController(),progress=vi.fn(),file=new Blob(['test'],{type:'audio/wav'});
 const promise=client.upload(id,file,progress,controller.signal);await waitFor(()=>expect(xhr.send).toHaveBeenCalled());expect(sent).toBe(file);expect(xhr.withCredentials).toBe(true);expect(xhr.setRequestHeader).toHaveBeenCalledWith('X-CSRF-Token','synthetic.csrf');
 xhr.upload.onprogress?.call(xhr,{loaded:2} as ProgressEvent);expect(progress).toHaveBeenCalledWith(50);xhr.onload?.({} as ProgressEvent);expect(await promise).toEqual(dto);
 const pending=client.upload(id,file,progress,controller.signal);await waitFor(()=>expect(xhr.send).toHaveBeenCalledTimes(2));r.invalidate();await expect(pending).rejects.toMatchObject({kind:'aborted'});expect(xhr.abort).toHaveBeenCalled();
});
it('photo decoding errors and aborts revoke the temporary object URL',async()=>{
 const {downscaleImageBlob}=await import('../utils/image');const instances:FakeImage[]=[];
 class FakeImage {onload:(()=>void)|null=null;onerror:(()=>void)|null=null;src='';constructor(){instances.push(this);}}
 vi.stubGlobal('Image',FakeImage);vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn().mockReturnValue('blob:decode'),revokeObjectURL:vi.fn()}));
 const bad=downscaleImageBlob(new Blob(['bad']));instances[0]!.onerror?.();await expect(bad).rejects.toThrow('IMAGE_UNAVAILABLE');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:decode');
 const controller=new AbortController(),aborted=downscaleImageBlob(new Blob(['pending']),1280,0.8,controller.signal);controller.abort();await expect(aborted).rejects.toThrow();expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it('download adapter bounds bytes and rejects a foreign signed URL before sending credentials',async()=>{
 const r=runtime(),url=`/api/v1/bookings/${booking}/attachments/${id}/content?organization_id=${org}&franchise_id=${branch}&grant=synthetic`,api={request:vi.fn().mockResolvedValue({url:'https://foreign.invalid'+url})},fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const client=createAttachmentClient(r,booking,api);await expect(client.bytes(id,id)).rejects.toMatchObject({kind:'protocol'});expect(fetcher).not.toHaveBeenCalled();
 api.request.mockResolvedValue({url});fetcher.mockResolvedValue(new Response(new Uint8Array(8388609),{headers:{'content-type':'audio/wav'}}));await expect(client.bytes(id,id)).rejects.toMatchObject({code:'ATTACHMENT_LIMIT_EXCEEDED'});
});
it('replacing the attachment client clears prior booking previews before the next list resolves',async()=>{
 const {r,client,file}=setup(),changed=vi.fn(),view=render(<AttachmentUploader client={client} runtime={r} onChange={changed}/>);
 await screen.findByText('Private files. Up to 8 MiB each.');fireEvent.change(screen.getByLabelText('Choose voice note'),{target:{files:[file]}});await screen.findByText('Saved securely');
 const replacement={...client,list:vi.fn().mockImplementation(()=>new Promise<AttachmentDto[]>(()=>{}))};view.rerender(<AttachmentUploader client={replacement} runtime={r} onChange={changed}/>);
 expect(document.querySelector('audio')).toBeNull();expect(screen.queryByText('voice-note.wav')).toBeNull();expect(changed).toHaveBeenLastCalledWith([]);expect(URL.revokeObjectURL).toHaveBeenCalled();
});

it('a booking attachment client cannot rebind to a newly selected franchise',async()=>{
 const r=runtime(),api={request:vi.fn()},client=createAttachmentClient(r,booking,api);
 r.invalidate();r.bind({userId:id,organizationId:org,franchiseId:'10000000-0000-4000-8000-000000000099',permissions:'operator'});
 await expect(client.list()).rejects.toMatchObject({code:'SCOPE_CHANGED'});expect(api.request).not.toHaveBeenCalled();
});
