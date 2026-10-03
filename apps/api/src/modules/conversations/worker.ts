import { pickupTurn } from '../pickups/customer.ts';
import { draft as pickupDraft } from '../pickups/repository.ts';
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
import { quoteTurn } from '../customer-quotes/service.ts';
import { saveDraft } from '../customer-quotes/repository.ts';
import * as support from '../support/repository.ts';
import { availability } from '../support/rules.ts';
import { languageChoice,selectLocale,languageAcknowledgment,localizeReply } from './language.ts';
import { prepareInput,interpretedRoute,TIMEOUT_MS,MIN_CONFIDENCE,validateInterpretation,validatedCompletion,type PreparedInput,type InterpretationResult } from './interpreter.ts';
import * as inferenceRepository from './inference-repository.ts';

type PreparedTurn={inbox:string;input:PreparedInput};
type Completion={inbox:string;result:InterpretationResult};
const failedInference=(category:InterpretationResult['category']):InterpretationResult=>({category,value:null,latencyMs:TIMEOUT_MS,inputTokens:null,outputTokens:null,estimatedMicroUsd:null});

const handoff='Please contact the franchise directly for a person. An automatic staff case has not been created. Send RESUME to return to self-service.';
export function createConversationWorker(database:DatabasePool,dependencies:WhatsappDependencies,key:Buffer,proof?:DeliveryProofConfiguration) {
 const clarification='Please ask for tracking, ETA, delay, charges, receipt or delivery-code resend. '+
  (dependencies.configuration.pickup_enabled?'Send PICKUP with your quote reference to request collection. ':'')+
  (dependencies.configuration.customer_quotes_enabled?'Send QUOTE for a shipping estimate, or HUMAN to contact staff.':'Send HUMAN to contact staff.');
 const config=dependencies.configuration.webhook!,access=createCustomerAccessService(database,config,key);
 async function process(scope:TenantAccess,id:string,fallback=false,completion?:Completion):Promise<string|PreparedTurn|null> {
  const source=await repository.source(scope,id);
  let phone:string,text:string;
  try {
   const payload=openInboxPayload(config,source) as {from?:unknown;text?:unknown};
   if(typeof payload.from!=='string'||!/^[1-9][0-9]{7,14}$/.test(payload.from)||typeof payload.text!=='string')throw new Error();
   phone='+'+payload.from;text=payload.text;
  }catch {await repository.record(scope,id,source.installation_id,null,null,'clarify','invalid',[]);return 'invalid';}
  const contact=consentContactKey(config,source.installation_id,phone);
  let route=routeMessage(text);
  const inference=await inferenceRepository.inference(scope,id);
  if(completion&&inference?.state==='reserved') {
   if(source.now>=inference.expires_at)completion={inbox:id,result:failedInference('timeout')};
   await inferenceRepository.finish(scope,id,completion.result);
  }
  if(!source.owner_active||!['unchanged','contact_ambiguous','revoked','granted','disclosure_required','source_stale'].includes(source.consent_outcome)||
   source.occurred_at>source.now||source.now.getTime()-source.occurred_at.getTime()>=900000) {
   await repository.record(scope,id,source.installation_id,contact,null,route.intent,'stale',[]);return 'stale';
  }
  const c=await repository.conversation(scope,source.installation_id,contact,source.now),live=c.expires_at>source.now;
  const choice=languageChoice(text);
  c.locale=selectLocale(text,c.locale,c.locale_explicit);
  if(choice)c.locale_explicit=true;
  let selected=live?c.selected_docket:null,pending=live?c.pending_intent:null,state=live?c.state:'active';
  let intent:Intent,outcome:repository.Outcome='answered',reply:string|null=null;
  let quoteId:string|null=null;
  const provenance:repository.Provenance[]=[];
  const activeCase=await support.active(scope,c.id);
  const revoked=await repository.consentRevoked(scope,source.installation_id,contact);
  if(!completion&&inference?.state==='reserved'&&(revoked||activeCase||state==='human_requested'))
   await inferenceRepository.finish(scope,id,failedInference('unavailable'));
  // Consent must finish before external disclosure or any interpreted operation.
  if(await inferenceRepository.pendingConsent(scope,source.installation_id))return null;
  const registered=dependencies.configuration.bindings.some(b=>b.organization_id===scope.context.organizationId&&b.franchise_id===scope.context.permittedFranchiseIds[0]&&b.waba_id===source.waba_id&&b.phone_number_id===source.phone_number_id);
  if(!fallback&&registered&&!revoked&&!activeCase&&state==='active'&&!choice&&route.intent==='clarify'&&!route.selectionOnly&&
   !(live&&(c.quote_draft!==null||c.pickup_draft!==null))) {
   const input=prepareInput(text);
   if(completion&&inference?.state==='reserved'&&completion.result.category==='interpreted'&&completion.result.value&&input) {
    // Fakes and future adapters must cross the same strict trust boundary as Groq.
    try {
     const value=validateInterpretation(JSON.stringify(completion.result.value),input.text);
     if(value.confidence>=MIN_CONFIDENCE)route=interpretedRoute(value,input);
    }catch{/* Untrusted adapter output retains clarification/handoff. */}
   } else if(inference?.state==='reserved'&&!completion) {
    if(source.now<inference.expires_at)return null;
    await inferenceRepository.finish(scope,id,failedInference('timeout'));
   } else if(!inference&&input&&dependencies.interpreter&&await inferenceRepository.reserve(scope,id,source.now)) {
    return {inbox:id,input};
   }
  }
  intent=route.intent;
  const handoffCase=async(reason:string)=>{
   const bindings=selected?await selection(scope,source.installation_id,contact,selected):[];
   const result=await support.open(scope,{conversation:c.id,installation:source.installation_id,contact,inbox:id,parcel:bindings[0]?.parcel_id??null,reason});
   selected=null;pending=null;state='human_requested';outcome='human_requested';
   reply=result.created?`Your request is saved as case ${result.value.id}. Automated answers are paused until staff resolve it. ${availability(dependencies.configuration.support_hours?.find(h=>h.franchise_id===scope.context.permittedFranchiseIds[0]),source.now)}`:null;
  };
  if(route.intent==='stop'||route.intent==='start') {selected=null;pending=null;state='active';outcome='consent';}
  else if(revoked) {selected=null;pending=null;state='active';outcome='consent';}
  else if(activeCase) {await support.touch(scope,activeCase.id,id);selected=null;pending=null;state='human_requested';outcome='paused';}
  else if(choice) {reply=languageAcknowledgment;}
  else if(fallback) {intent='clarify';outcome='unavailable';reply='Shipment information is temporarily unavailable. Please retry once or contact the franchise directly.';}
  else if(dependencies.configuration.support_enabled&&(route.intent==='human'||state==='human_requested')) {await handoffCase('human_requested');}
  else if(route.intent==='human') {selected=null;pending=null;state='human_requested';outcome='human_requested';reply=handoff;}
  else if(route.intent==='resume') {selected=null;pending=null;state='active';reply=clarification;}
  else if(state==='human_requested') {outcome='paused';reply=handoff;}
  else if(dependencies.configuration.pickup_enabled&&(route.intent==='pickup'||(live&&c.pickup_draft!==null&&route.intent!=='quote'))) {
   intent='pickup';selected=null;pending=null;
   const result=await pickupTurn(scope,{inbox:id,installation:source.installation_id,contact,conversation:c.id,now:source.now},route.intent==='pickup'&&!/^(?:pickup|pickups|cancel pickup|submit pickup)\b/i.test(text.trim())?'PICKUP':text,live?c.pickup_draft:null);
   reply=result.reply;outcome=result.outcome;
  }
  else if(dependencies.configuration.customer_quotes_enabled&&(route.intent==='quote'||(live&&c.quote_draft!==null&&route.intent==='clarify'))) {
   intent='quote';selected=null;pending=null;
   const result=await quoteTurn(scope,{inbox:id,installation:source.installation_id,contact,conversation:c.id,now:source.now},route.intent==='quote'&&!/^(?:quote|confirm quote)\b/i.test(text.trim())?'QUOTE':text,live?c.quote_draft:null,c.locale);
   reply=result.reply;outcome=result.outcome;quoteId=result.quoteId;
  }
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
      if(tool==='delay')result={...(result as object),delay:await access.readDelay(scope,item.grant,item.docket)};
      reply=renderResult(validateResult(tool,result),c.locale);
     }catch(error) {
      if(!(error instanceof HttpError))throw error;
      // SQL failures escape to the transaction savepoint; controlled domain denial has no side effect.
      if(['ACTION_FORBIDDEN','RESOURCE_NOT_FOUND','DELIVERY_RESEND_COOLDOWN','DELIVERY_RESEND_LIMIT','DELIVERY_CHALLENGE_EXPIRED','DELIVERY_CHALLENGE_LOCKED','PARCEL_STATE_CONFLICT'].includes(error.code)) {
       outcome=error.code==='ACTION_FORBIDDEN'?'forbidden':'unavailable';
       reply=tool==='receipt'?'An issued receipt is unavailable for this request. Please contact the franchise.':tool==='resend'?'Delivery-code assistance is unavailable or limited for this request. Please contact the franchise.':'This information is unavailable for this verified relationship. Please contact the franchise.';
      } else throw error;
     }
    }
   } else if(dependencies.configuration.support_enabled) {await handoffCase('unknown_intent');}
   else {outcome='unavailable';reply=clarification;}
  }
  if(dependencies.configuration.pickup_enabled&&intent!=='pickup'&&!fallback&&!choice)await pickupDraft(scope,c.id,null);
  if(dependencies.configuration.customer_quotes_enabled&&intent!=='quote'&&!fallback&&!choice)await saveDraft(scope,c.id,null);
  await repository.advance(scope,c,selected,pending,state,source.now);
  await repository.record(scope,id,source.installation_id,contact,c,intent,outcome,provenance,quoteId);
  if(reply)await enqueueReply(scope,dependencies,id,source.installation_id,contact,source.occurred_at,localizeReply(reply,c.locale));
  return outcome;
 }
 return {async tick() {
  if(!dependencies.configuration.conversation_enabled||!dependencies.configuration.customer_access_enabled||!config)return null;
  const next=await withNextConversationScope(database,(scope,id)=>process(scope,id),(scope,id)=>process(scope,id,true));
  if(!next||typeof next==='string')return next;
  let timer:ReturnType<typeof setTimeout>|undefined,result:InterpretationResult;
  try {
   result=await Promise.race([dependencies.interpreter!.interpret(next.input.text),new Promise<InterpretationResult>(resolve=>{
    timer=setTimeout(()=>resolve(failedInference('timeout')),TIMEOUT_MS);
   })]);
   result=validatedCompletion(result,next.input.text);
  }catch{result=failedInference('unavailable');}
  finally{clearTimeout(timer);}
  const completion={inbox:next.inbox,result};
  // The signed scheduler derives ownership again. A timed-out reservation may already
  // have been consumed by another worker; never attach its result to the next message.
  const done=await withNextConversationScope(database,(scope,id)=>id===next.inbox?process(scope,id,false,completion):Promise.resolve(null),
   (scope,id)=>id===next.inbox?process(scope,id,true,completion):Promise.resolve(null));
  return typeof done==='string'?done:null;
 }};
}
