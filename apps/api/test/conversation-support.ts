import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { bookingSetup } from './booking-support.ts';
import { org,A } from './audit-support.ts';
import { createWhatsappService } from '../src/modules/whatsapp/service.ts';
import { createInboxWorker } from '../src/modules/whatsapp/inbox-worker.ts';
import { createConsentWorker } from '../src/modules/whatsapp/consent-worker.ts';
import { createOutboundWorker } from '../src/modules/whatsapp/outbound-worker.ts';
import { createCustomerAccessService } from '../src/modules/customer-access/service.ts';
import { createConversationWorker } from '../src/modules/conversations/worker.ts';
import { openOutbound } from '../src/modules/whatsapp/outbound-rules.ts';
import { buildServer } from '../src/server.ts';
import { parseEnvironment } from '../src/env.ts';
import { callback,inbound,signed,webhookConfig } from './webhook-fixture.ts';
import { deliveryProofConfiguration } from './delivery-support.ts';
import type { WhatsappDependencies,SendOutcome } from '../src/modules/whatsapp/types.ts';
export async function conversationSetup(t:Parameters<typeof bookingSetup>[0],count=1) {
 const s=await bookingSetup(t);await s.db.prepareConversations();
 const admin=await s.grant('franchise_admin',[A]),q={organization_id:org,franchise_id:A};
 const binding={key:'conversation_v1',organization_id:org,franchise_id:A,waba_id:'100001',phone_number_id:'100002',credential_ref:'whatsapp:conversation/v1'};
 const sends:{phone:string;text:string}[]=[],codes:string[][]=[];
 let sendOutcome:SendOutcome={kind:'accepted',provider_message_id:'wamid.synthetic47'};
 const whatsapp:WhatsappDependencies={configuration:{graph_version:'v24.0',bindings:[binding],webhook:webhookConfig,customer_access_enabled:true,conversation_enabled:true,outbound_enabled:true},
  provider:{validate:async()=>{},template:async()=>({provider_id:'100004',name:'shipit_delivery_code',language:'en',status:'APPROVED',category:'AUTHENTICATION',shape_hash:'a'.repeat(64),variables:[{type:'text'}],supported:true}),send:async(_b,_t,_r,v)=>{codes.push(Array.isArray(v)?v.map(String):[]);return {kind:'accepted',provider_message_id:'wamid.'+randomUUID()};},
   sendText:async(_b,phone,text)=>{sends.push({phone,text});return sendOutcome.kind==='accepted'?{...sendOutcome,provider_message_id:'wamid.'+randomUUID()}:sendOutcome;}}};
 await createWhatsappService(s.pool,whatsapp).execute(admin.token,null,'connect',q,randomUUID(),{binding_key:binding.key,expected_version:0},randomUUID());
 const logs:string[]=[],app=buildServer({database:s.pool,config:parseEnvironment({NODE_ENV:'development',HOST:'127.0.0.1',PORT:'3000',LOG_LEVEL:'info',ALLOWED_ORIGINS:'http://localhost:5173',
  TRUSTED_PROXY_HOPS:'0',DATABASE_SECRET_REF:'local:database',DATABASE_TLS_MODE:'disable'}),auth:{keys:s.keys,delivery:{},webhook:undefined},whatsapp,logSink:{write:v=>logs.push(v)}});
 t.after(()=>app.close());
 const booked=await s.book({...s.body,parcels:Array.from({length:count},(_,i)=>({...s.body.parcels[0],weight_grams:i===count-1?999-Math.floor(999/count)*(count-1):Math.floor(999/count)}))});
 assert.equal(booked.statusCode,201,booked.body);
 const parcels=booked.json().parcels as {id:string;docket:string}[],parcel=parcels[0]!;
 const phone=(await s.db.adminQuery<{phone_normalized:string}>('SELECT phone_normalized FROM shipit.customers WHERE id=$1',[s.source.id])).rows[0]!.phone_normalized;
 const access=createCustomerAccessService(s.pool,webhookConfig,s.keys.browser),worker=createConversationWorker(s.pool,whatsapp,s.keys.browser,deliveryProofConfiguration),outbound=createOutboundWorker(s.pool,whatsapp);
 async function message(text:string,from=phone,id='wamid.'+randomUUID(),ageSeconds=0,channel={waba:'100001',phone:'100002'}) {
  const body=JSON.stringify(callback([{...inbound(id,text),from:from.replace('+',''),timestamp:String(Math.floor(Date.now()/1000)-ageSeconds)}],{...channel,kind:'messages'}));
  const response=await app.inject({method:'POST',url:'/webhooks/whatsapp',headers:signed(body),payload:body});assert.equal(response.statusCode,200,response.body);
  while(await createInboxWorker(s.pool).tick()!==null){/* bounded fixture */}
  while(await createConsentWorker(s.pool,webhookConfig).tick()!==null){/* bounded fixture */}
  return (await s.db.adminQuery<{id:string}>('SELECT id FROM shipit.whatsapp_inbox WHERE message_id=$1',[id])).rows[0]!.id;
 }
 const bind=(inbox:string,p=parcel,relation:'sender'|'recipient'='sender',version=0,rebind=false)=>access.bind(admin.token,p.id,q,randomUUID(),
  {inbox_id:inbox,relation,expected_version:version,evidence_ref:randomUUID(),...(rebind?{recipient_rebind:true}:{})},randomUUID());
 const seed=await message('hello');for(const p of parcels)await bind(seed,p);
 await worker.tick();await outbound.tick();sends.length=0;
 const turn=async(inbox:string)=>(await s.db.adminQuery('SELECT intent,outcome,provenance FROM shipit.customer_conversation_turns WHERE inbox_id=$1',[inbox])).rows[0]!;
 const reply=async(inbox:string)=>{const m=(await s.db.adminQuery<{id:string;key_version:string;sealed_payload:string}>('SELECT id,key_version,sealed_payload FROM shipit.whatsapp_outbound WHERE conversation_inbox_id=$1',[inbox])).rows[0]!;
  return openOutbound(webhookConfig,m.id,m.key_version,m.sealed_payload).text!;};
 return {...s,root:s.admin,app,admin,q,whatsapp,access,worker,outbound,message,bind,phone,parcel,parcels,sends,codes,logs,turn,reply,setOutcome:(v:SendOutcome)=>{sendOutcome=v;}};
}
