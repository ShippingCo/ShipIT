import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { bookingSetup } from './booking-support.ts';
import { org,A } from './audit-support.ts';
import { buildServer } from '../src/server.ts';
import { parseEnvironment } from '../src/env.ts';
import { createAttachmentService } from '../src/modules/attachments/service.ts';
import { createAttachmentCleanup } from '../src/modules/attachments/cleanup.ts';
import { hash } from '../src/modules/attachments/validation.ts';
import type { AttachmentObjectStore, StoredIdentity } from '../src/modules/attachments/types.ts';
// A real tiny PNG; synthetic bytes, never imported by production.
export const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRz8AAAAASUVORK5CYII=','base64');
export const intent=(bytes=photo,media='image/png',kind='image')=>({purpose:'shipment_evidence',kind,media_type:media,size_bytes:bytes.length,sha256:hash(bytes)});
export function memoryStore() {
  const objects=new Map<string,StoredIdentity&{bytes:Buffer}>();
  let fault:'none'|'put'|'put-after'|'get'|'delete'|'delete-after'|'head'='none';
  const store:AttachmentObjectStore={
    async head(key){if(fault==='head')throw new Error('SYN_STORAGE_CREDENTIAL');const r=objects.get(key);return r?{uploadId:r.uploadId,size:r.size,digest:r.digest}:null;},
    async put(key,body,identity){if(fault==='put')throw new Error('SYN_STORAGE_CREDENTIAL');const chunks:Buffer[]=[];for await(const chunk of body)chunks.push(Buffer.from(chunk));
      const bytes=Buffer.concat(chunks);if(objects.has(key)||bytes.length!==identity.size||hash(bytes)!==identity.digest)throw new Error('SYN_PROVIDER_CHECKSUM');
      objects.set(key,{...identity,bytes});if(fault==='put-after')throw new Error('SYN_LOST_ACK');},
    async get(key){if(fault==='get')throw new Error('SYN_STORAGE_CREDENTIAL');const r=objects.get(key);if(!r)throw new Error('SYN_MISSING');return {...r,body:Readable.from(r.bytes)};},
    async delete(key){if(fault==='delete')throw new Error('SYN_STORAGE_CREDENTIAL');objects.delete(key);if(fault==='delete-after')throw new Error('SYN_LOST_ACK');},
  };
  return {store,objects,setFault:(v:typeof fault)=>{fault=v;}};
}
export async function attachmentSetup(t:TestContext){
  const s=await bookingSetup(t);await s.db.prepareAttachments();const booked=await s.book();assert.equal(booked.statusCode,201,booked.body);
  const bookingId=booked.json().id as string,parcelId=booked.json().parcels[0].id as string;
  const memory=memoryStore();let time=new Date('2099-01-01T01:00:00Z'),scan:'clean'|'infected'|'error'='clean';const clock=()=>new Date(time);
  const deps={store:memory.store,scanner:{scan:async()=>scan},signingKey:'SYN_ATTACHMENT_SIGNING_KEY_012345678901234567890',clock};
  const config=parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'});
  const app=buildServer({config,database:s.pool,auth:{keys:s.keys,delivery:{},webhook:undefined},attachments:deps,logSink:{write:x=>s.logs.push(x)}});t.after(()=>app.close());
  const q={organization_id:org,franchise_id:A};
  const request=(method:'GET'|'POST'|'PUT',suffix:string,body:unknown={},actor=s.operator.token,booking=bookingId,query:Record<string,string>=q,key=randomUUID())=>app.inject({method,
    url:`/api/v1/bookings/${booking}/attachments${suffix}?`+new URLSearchParams(query),headers:{...s.headers,'idempotency-key':key,'content-type':method==='PUT'?'application/octet-stream':'application/json'},cookies:s.cookies(actor),
    ...(method==='GET'?{}:{payload:Buffer.isBuffer(body)?body:JSON.stringify(body)})});
  const initiate=(body:unknown=intent(),key=randomUUID())=>request('POST','/uploads',body,s.operator.token,bookingId,q,key);
  const upload=(id:string,bytes=photo)=>request('PUT',`/uploads/${id}/content`,bytes);
  const finalize=(id:string,key=randomUUID())=>request('POST',`/uploads/${id}/finalize`,{},s.operator.token,bookingId,q,key);
  const ready=async()=>{const i=await initiate();assert.equal(i.statusCode,201,i.body);const id=i.json().id as string;const u=await upload(id);assert.equal(u.statusCode,200,u.body);const f=await finalize(id);assert.equal(f.statusCode,200,f.body);return f.json();};
  return {...s,...memory,app,bookingId,parcelId,q,deps,request,initiate,upload,finalize,ready,service:createAttachmentService(s.pool,deps),cleanup:createAttachmentCleanup(s.pool,deps.store,clock),clock,
    advance:(ms:number)=>{time=new Date(time.getTime()+ms);},setScan:(value:typeof scan)=>{scan=value;},
    rows:async()=>(await s.db.adminQuery('SELECT * FROM shipit.attachments ORDER BY id')).rows,
    effects:async()=>(await s.db.adminQuery(`SELECT (SELECT count(*)::int FROM shipit.attachments) attachments,(SELECT count(*)::int FROM shipit.attachment_commands) commands,(SELECT count(*)::int FROM shipit.attachment_audit_events) audits`)).rows[0]};
}
