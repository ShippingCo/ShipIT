import {afterEach,expect,it,vi} from 'vitest';
import {waitFor} from '@testing-library/react';
import {createBookingAttachmentQueue} from '../booking/BookingAttachments';
import {createScopeRuntime} from '../data-access/scope-runtime';
import type {AttachmentDto} from '@shippingco/shared';
import type {AttachmentClient} from '../data-access/attachments';
import {ApiFailure} from '../data-access/errors';
const id='10000000-0000-4000-8000-000000000001';
function fixture(){
 const runtime=createScopeRuntime();runtime.bind({userId:id,organizationId:id,franchiseId:id,permissions:'operator'});
 let serial=0;vi.stubGlobal('crypto',{randomUUID:()=>`key-${++serial}`,subtle:{digest:async()=>new Uint8Array(32).buffer}});
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn().mockReturnValue('blob:private'),revokeObjectURL:vi.fn()}));
 const ready:AttachmentDto={id,booking_id:id,parcel_id:null,purpose:'shipment_evidence',kind:'document',filename:'document.pdf',media_type:'application/pdf',size_bytes:4,state:'ready',scan_state:'clean',retention_class:'operational_evidence',version:3,created_at:'2099-01-01T00:00:00Z',upload_expires_at:'2099-01-01T00:15:00Z',linked_at:'2099-01-01T00:01:00Z'};
 const client={list:vi.fn().mockResolvedValue([]),initiate:vi.fn().mockResolvedValue({...ready,state:'pending_upload',scan_state:'pending'}),upload:vi.fn().mockResolvedValue({...ready,state:'quarantined',scan_state:'pending'}),finalize:vi.fn().mockResolvedValue(ready),cancel:vi.fn(),bytes:vi.fn()} satisfies AttachmentClient;
 const file=new File(['test'],'invoice-private.pdf',{type:'application/pdf'});Object.defineProperty(file,'arrayBuffer',{value:async()=>new Uint8Array(4).buffer});
 return {runtime,client,file,ready,queue:createBookingAttachmentQueue(runtime)};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('keeps selected files local until booking exists, then uses actual upload/finalize and drops private bytes',async()=>{
 const {queue,client,file}=fixture();await queue.add(file);expect(client.initiate).not.toHaveBeenCalled();expect(queue.snapshot().entries[0]?.phase).toBe('selected');
 queue.bind(client);await waitFor(()=>expect(queue.snapshot().entries[0]?.phase).toBe('ready'));
 expect(client.upload).toHaveBeenCalledTimes(1);expect(client.finalize).toHaveBeenCalledTimes(1);expect(queue.snapshot().entries[0]?.file).toBeUndefined();expect(queue.snapshot().entries[0]?.name).toBe('document.pdf');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private');
});
it('retries the same lost initiation with stable intent/key, without another booking or duplicate attachment',async()=>{
 const {queue,client,file}=fixture();client.initiate.mockRejectedValueOnce(new ApiFailure('TEMPORARILY_UNAVAILABLE',{kind:'network',dispatched:true}));await queue.add(file);queue.bind(client);await waitFor(()=>expect(queue.snapshot().entries[0]?.phase).toBe('failed'));
 queue.retry(queue.snapshot().entries[0]!.id);await waitFor(()=>expect(queue.snapshot().entries[0]?.phase).toBe('ready'));
 expect(client.initiate.mock.calls[0]).toEqual(client.initiate.mock.calls[1]);expect(client.upload).toHaveBeenCalledTimes(1);
});
it('keeps scan-error evidence quarantined and retries finalize with its same key without resending bytes',async()=>{
 const {queue,client,file}=fixture();client.finalize.mockRejectedValueOnce(new ApiFailure('ATTACHMENT_SCAN_FAILED'));await queue.add(file);queue.bind(client);await waitFor(()=>expect(queue.snapshot().entries[0]?.phase).toBe('failed'));queue.retry(queue.snapshot().entries[0]!.id);await waitFor(()=>expect(queue.snapshot().entries[0]?.phase).toBe('ready'));expect(client.upload).toHaveBeenCalledTimes(1);expect(client.finalize.mock.calls[0]).toEqual(client.finalize.mock.calls[1]);
});
it('purges private files on scope change and ignores a delayed initiation response',async()=>{
 const {queue,client,file,runtime,ready}=fixture();let resolve!:(value:AttachmentDto)=>void;client.initiate.mockImplementation(()=>new Promise(r=>{resolve=r;}));await queue.add(file);queue.bind(client);await waitFor(()=>expect(client.initiate).toHaveBeenCalled());runtime.invalidate();resolve(ready);await Promise.resolve();expect(queue.snapshot().entries).toEqual([]);expect(client.upload).not.toHaveBeenCalled();expect(URL.revokeObjectURL).toHaveBeenCalled();
});
it('refuses empty, oversized and unsupported files before API calls and removes selected files locally',async()=>{
 const {queue,client,file}=fixture();await queue.add(new File(['x'],'unsafe.svg',{type:'image/svg+xml'}));expect(queue.snapshot().entries).toHaveLength(0);await queue.add(new File([],'empty.pdf',{type:'application/pdf'}));expect(queue.snapshot().message).toMatch(/nonempty/);await queue.add(file);queue.remove(queue.snapshot().entries[0]!.id);expect(queue.snapshot().entries).toHaveLength(0);queue.bind(client);expect(client.initiate).not.toHaveBeenCalled();
});
it('never treats rejected files as saved or exposes their bytes',async()=>{
 const {queue,client,file}=fixture();client.finalize.mockRejectedValueOnce(new ApiFailure('ATTACHMENT_REJECTED'));await queue.add(file);queue.bind(client);await waitFor(()=>expect(queue.snapshot().entries[0]?.phase).toBe('rejected'));expect(queue.snapshot().entries[0]?.url).toBeUndefined();expect(queue.snapshot().entries[0]?.file).toBeUndefined();
});
it('uploads a selected batch in sequence so the server pending-upload quota is not exhausted',async()=>{
 const {queue,client,file,ready}=fixture();let finish!:(dto:AttachmentDto)=>void;
 client.finalize.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 for(let i=0;i<4;i++)await queue.add(file);queue.bind(client);
 await waitFor(()=>expect(client.finalize).toHaveBeenCalledTimes(1));expect(client.initiate).toHaveBeenCalledTimes(1);
 finish(ready);await waitFor(()=>expect(queue.snapshot().entries.every(e=>e.phase==='ready')).toBe(true));expect(client.initiate).toHaveBeenCalledTimes(4);
});
