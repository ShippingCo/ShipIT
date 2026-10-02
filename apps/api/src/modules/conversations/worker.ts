import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withNextConversationScope } from '../security/jobs.ts';
import type { TenantAccess } from '../security/scope.ts';
import { createCustomerAccessService } from '../customer-access/service.ts';
import { selection } from '../customer-access/repository.ts';
import { openInboxPayload } from '../whatsapp/webhook-payload.ts';
import { consentContactKey } from '../whatsapp/consent-worker.ts';
import { customerCharges } from '../payments/customer-projection.ts';
import { customerReceipt } from '../receipts/customer-projection.ts';
import { requestCustomerResend } from '../deliveries/customer-resend.ts';
import type { DeliveryProofConfiguration } from '../deliveries/types.ts';
import type { WhatsappDependencies } from '../whatsapp/types.ts';
import { routeMessage,tools,type Intent,type Tool } from './router.ts';
import { validateResult,renderResult } from './results.ts';
import { enqueueReply } from './replies.ts';
import * as repository from './repository.ts';

const clarification='Please ask for tracking, ETA, delay, charges, receipt or delivery-code resend. Send HUMAN to contact staff.';
const handoff='Please contact the franchise directly for a person. An automatic staff case has not been created. Send RESUME to return to self-service.';
export function createConversationWorker(database:DatabasePool,dependencies:WhatsappDependencies,key:Buffer,proof?:DeliveryProofConfiguration) {
 const config=dependencies.configuration.webhook!,access=createCustomerAccessService(database,config,key);
 async function process(scope:TenantAccess,id:string,fallback=false):Promise<string> {
  const source=await repository.source(scope,id);
  let phone:string,text:string;
  try {
   const payload=openInboxPayload(config,source) as {from?:unknown;text?:unknown};
   if(typeof payload.from!=='string'||!/^[1-9][0-9]{7,14}$/.test(payload.from)||typeof payload.text!=='string')throw new Error();
   phone='+'+payload.from;text=payload.text;
  }catch {await repository.record(scope,id,source.installation_id,null,null,'clarify','invalid',[]);return 'invalid';}
  const contact=consentContactKey(config,source.installation_id,phone),route=routeMessage(text);
  if(!source.owner_active||!['unchanged','contact_ambiguous','revoked','granted','disclosure_required','source_stale'].includes(source.consent_outcome)||
   source.occurred_at>source.now||source.now.getTime()-source.occurred_at.getTime()>=900000) {
   await repository.record(scope,id,source.installation_id,contact,null,route.intent,'stale',[]);return 'stale';
  }
  const c=await repository.conversation(scope,source.installation_id,contact,source.now),live=c.expires_at>source.now;
  let selected=live?c.selected_docket:null,pending=live?c.pending_intent:null,state=live?c.state:'active';
  let intent:Intent=route.intent,outcome:repository.Outcome='answered',reply:string|null=null;
  const provenance:repository.Provenance[]=[];
  if(route.intent==='stop'||route.intent==='start') {selected=null;pending=null;state='active';outcome='consent';}
  else if(await repository.consentRevoked(scope,source.installation_id,contact)) {selected=null;pending=null;state='active';outcome='consent';}
  else if(fallback) {intent='clarify';outcome='unavailable';reply='Shipment information is temporarily unavailable. Please retry once or contact the franchise directly.';}
  else if(route.intent==='human') {selected=null;pending=null;state='human_requested';outcome='human_requested';reply=handoff;}
  else if(route.intent==='resume') {selected=null;pending=null;state='active';reply=clarification;}
  else if(state==='human_requested') {outcome='paused';reply=handoff;}
  else {
   const resumed=route.selectionOnly&&pending;
   const tool:Tool|null=resumed?pending:tools.includes(intent as Tool)?intent as Tool:null;
   if(tool) {
    intent=tool;
    // An explicit docket always replaces old selection; it never falls back if denied.
    const docket=route.docket??selected;
    const chosen=await access.select(scope,id,docket),bindings=await selection(scope,source.installation_id,contact,docket);
    if(chosen.items.length===0) {selected=null;pending=null;outcome='not_found';reply='No verified shipment is available for that request. Please contact the franchise for verification.';}
    else if(chosen.selection_required||chosen.has_more) {
     selected=null;pending=tool;outcome='selection_required';
     for(const b of bindings.slice(0,10)) {const p=await repository.shipment(scope,b);if(!p)throw new HttpError('RESOURCE_NOT_FOUND');provenance.push({binding_id:b.id,binding_version:b.version,parcel_id:p.id,parcel_version:p.version});}
     reply=`Please send the exact docket for one of your verified shipments: ${chosen.items.map(v=>v.docket).join(', ')}.${chosen.has_more?' More verified shipments exist; use an exact docket.':''}`;
    } else {
     const item=chosen.items[0]!,b=bindings.find(v=>v.docket===item.docket)!;
     const p=await repository.shipment(scope,b);if(!p)throw new HttpError('RESOURCE_NOT_FOUND');
     selected=p.docket;pending=null;provenance.push({binding_id:b.id,binding_version:b.version,parcel_id:p.id,parcel_version:p.version});
     try {
      let result:unknown;
      if(['tracking','eta','delay'].includes(tool))result={tool,...await access.readSelected(scope,item.grant,item.docket)};
      else if(tool==='charges'||tool==='receipt') {
       if(b.relation!=='sender')throw new HttpError('ACTION_FORBIDDEN');
       result={tool,docket:p.docket,...await (tool==='charges'?customerCharges(scope,p.id):customerReceipt(scope,p.id))};
      } else {
       if(!proof)throw new HttpError('TEMPORARILY_UNAVAILABLE');
       result={tool,docket:p.docket,...await requestCustomerResend(scope,id,p.docket,proof,dependencies)};
      }
      reply=renderResult(validateResult(tool,result));
     }catch(error) {
      if(!(error instanceof HttpError))throw error;
      // SQL failures escape to the transaction savepoint; controlled domain denial has no side effect.
      if(['ACTION_FORBIDDEN','RESOURCE_NOT_FOUND','DELIVERY_RESEND_COOLDOWN','DELIVERY_RESEND_LIMIT','DELIVERY_CHALLENGE_EXPIRED','DELIVERY_CHALLENGE_LOCKED','PARCEL_STATE_CONFLICT'].includes(error.code)) {
       outcome=error.code==='ACTION_FORBIDDEN'?'forbidden':'unavailable';
       reply=tool==='receipt'?'An issued receipt is unavailable for this request. Please contact the franchise.':tool==='resend'?'Delivery-code assistance is unavailable or limited for this request. Please contact the franchise.':'This information is unavailable for this verified relationship. Please contact the franchise.';
      } else throw error;
     }
    }
   } else {outcome='unavailable';reply=clarification;}
  }
  await repository.advance(scope,c,selected,pending,state,source.now);
  await repository.record(scope,id,source.installation_id,contact,c,intent,outcome,provenance);
  if(reply)await enqueueReply(scope,dependencies,id,source.installation_id,contact,source.occurred_at,reply);
  return outcome;
 }
 return {async tick() {
  if(!dependencies.configuration.conversation_enabled||!dependencies.configuration.customer_access_enabled||!config)return null;
  return withNextConversationScope(database,(scope,id)=>process(scope,id),(scope,id)=>process(scope,id,true));
 }};
}
