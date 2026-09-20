import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { withTransaction } from '@shippingco/db';
import { whatsappSetup } from './whatsapp-support.ts';
import { webhookConfig,callback,inbound } from './webhook-fixture.ts';
import { org,A } from './audit-support.ts';
import { persistBusinessWebhook } from '../src/modules/security/jobs.ts';
import { issueTenantAccess } from '../src/modules/security/scope.ts';
import { normalizeBusinessWebhook } from '../src/modules/whatsapp/webhook-payload.ts';
import { createInboxWorker } from '../src/modules/whatsapp/inbox-worker.ts';
import { createConsentWorker } from '../src/modules/whatsapp/consent-worker.ts';
import { createOutboundWorker } from '../src/modules/whatsapp/outbound-worker.ts';
import { createOutboundService } from '../src/modules/whatsapp/outbound-service.ts';
import { enqueueMessage } from '../src/modules/whatsapp/outbound-enqueue.ts';
import type { OutboundInput } from '../src/modules/whatsapp/outbound-rules.ts';
import type { SendOutcome } from '../src/modules/whatsapp/types.ts';

export async function outboundSetup(t:TestContext) {
 const s=await whatsappSetup(t);await s.db.prepareWhatsappOutbound();const installed=await s.connect(),installation=installed.json().id as string;
 let now=new Date(Date.now()+1000),calls=0;
 const customer=randomUUID();
 await s.db.adminQuery(`INSERT INTO shipit.customers(id,organization_id,franchise_id,name,phone_normalized,phone_display,contact_changed_at)
 VALUES($1,$2,$3,'Fictional outbound customer','+15550000001','+15550000001',clock_timestamp()-interval '1 day')`,[customer,org,A]);
 let send:()=>Promise<SendOutcome>=async()=>({kind:'accepted',provider_message_id:'wamid.outbound_'+randomUUID()});
 const dependencies={...s.dependencies,configuration:{...s.dependencies.configuration,webhook:webhookConfig},clock:()=>now,
  provider:{...s.dependencies.provider,send:async()=>{calls++;return send();},sendText:async()=>{calls++;return send();}}};
 const worker=createOutboundWorker(s.pool,dependencies),consent=createConsentWorker(s.pool,webhookConfig),inbox=createInboxWorker(s.pool);
 async function receive(text:string,reply?:string) {
  const message={...inbound('wamid.'+randomUUID(),text),timestamp:String(Math.floor(now.getTime()/1000)),...(reply?{context:{id:reply}}:{})};
  await persistBusinessWebhook(s.pool,normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([message],{kind:'messages'}))),webhookConfig),webhookConfig.waba_ids,randomUUID());
  await inbox.tick();await consent.tick();
  return (await s.db.adminQuery('SELECT id FROM shipit.whatsapp_inbox WHERE message_id=$1',[message.id])).rows[0]!.id as string;
 }
 const source=await receive('Please help with shipment updates');
 const input:OutboundInput={source_kind:'inbox',source_id:source,customer_id:customer,purpose:'requested_assistance',format:'text',text:'Fictional requested response'};
 const enqueue=(value:unknown=input,pool=s.pool)=>withTransaction(pool,tx=>enqueueMessage(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:org,
  permittedFranchiseIds:[A],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),dependencies,value));
 const service=createOutboundService(s.pool,s.keys.browser,()=>now),query={organization_id:org,franchise_id:A};
 const detail=(id:string)=>service.detail(s.local.token,id,query,randomUUID());
 async function status(message:string,state:string) {
  const item={id:message,status:state,timestamp:String(Math.floor(now.getTime()/1000)),recipient_id:'15550000001'};
  await persistBusinessWebhook(s.pool,normalizeBusinessWebhook(Buffer.from(JSON.stringify(callback([item]))),webhookConfig),webhookConfig.waba_ids,randomUUID());await inbox.tick();
 }
 return {...s,customer,installation,source,input,enqueue,dependencies,worker,service,query,detail,status,receive,
  calls:()=>calls,setSend:(value:typeof send)=>{send=value;},advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
