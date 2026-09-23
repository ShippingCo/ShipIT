import { randomUUID } from 'node:crypto';
import type { DatabasePool } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { withDeliveryScope } from '../memberships/service.ts';
import { idempotencyKey,parcelId } from '../bookings/validation.ts';
import { keyDigest } from '../pricing/idempotency.ts';
import { digest } from '../pricing/idempotency.ts';
import { generateDeliveryCode,deliveryProofIntent,deliveryVerifier,sealDeliveryCode,openDeliveryCode,verifyDeliveryCode } from './crypto.ts';
import * as validate from './validation.ts';
import * as repository from './repository.ts';
import { reserveChallengeSend,sendReservationPending } from './messaging.ts';
import type { DeliveryAction,DeliveryAttemptRow,DeliveryOperation,DeliveryProofConfiguration,ProofMethod } from './types.ts';
import type { WhatsappDependencies } from '../whatsapp/types.ts';
import type { TenantAccess } from '../security/scope.ts';
import type { Role } from '../memberships/types.ts';
import { verifier as storedVerifier } from './secret-repository.ts';

type DeliveryScopes={command:TenantAccess;events:TenantAccess;roles:readonly Role[];revision:string};

const fp=(operation:string,parcel:string,body:unknown)=>digest({operation_id:`api.v1.${operation}`,resource_ids:{parcel_id:parcel},content_type:'application/json',query:{},body});
const identity=(a:{organization_id:string;franchise_id:string;parcel_id:string;id:string;assignment_id:string;recipient_ref:string;recipient_contact_version:string},challenge:string,version:number)=>
 [a.organization_id,a.franchise_id,a.parcel_id,a.id,a.assignment_id,a.recipient_ref,a.recipient_contact_version,String(version),challenge];
const parcelResult=(row:{id:string;booking_id:string;docket:string;version:number;status:string;custody:string;attempts_started:number;failed_attempt_count:number},event:string,time:Date)=>
 ({id:row.id,booking_id:row.booking_id,docket:row.docket,version:row.version,status:row.status,custody:row.custody,
  attempts_started:row.attempts_started,failed_attempt_count:row.failed_attempt_count,event_id:event,transitioned_at:time.toISOString()});

export function createDeliveryService(database:DatabasePool,configuration:DeliveryProofConfiguration,whatsapp?:WhatsappDependencies,clock?:()=>Date) {
 const scoped=<T>(session:string,query:unknown,action:DeliveryAction,correlation:string,work:(scopes:DeliveryScopes)=>Promise<T>)=>{
  const selected=validate.selector(query);return withDeliveryScope(database,session,selected.organizationId,selected.franchiseId,action,correlation,work);
 };
 async function start(session:string,parcelInput:unknown,query:unknown,keyInput:unknown,raw:readonly string[],value:unknown,retry:boolean,correlation:string) {
  const parcel=parcelId(parcelInput),body=validate.start(value),operation:DeliveryOperation=retry?'deliveries.retry':'deliveries.start';
  const key=keyDigest(idempotencyKey(keyInput,raw)),fingerprint=fp(operation,parcel,body);
  return scoped(session,query,operation,correlation,async scopes=>{
   const replay=await repository.replay(scopes.command,parcel,operation,key,fingerprint);if(replay)return replay;
   const before=await repository.startParcel(scopes.command,parcel);
   if(before.version!==body.expected_version||before.status!==(retry?'failed_attempt':'in_transit')||before.active_attempt_id||before.attempts_started>=(retry?2:1))throw new HttpError(before.version!==body.expected_version?'VERSION_CONFLICT':'PARCEL_STATE_CONFLICT');
   if(!await repository.eligibleAgent(scopes.command,body.agent_id))throw new HttpError('RESOURCE_NOT_FOUND');
   const command=randomUUID(),attempt=randomUUID(),assignment=randomUUID(),challenge=randomUUID(),event=randomUUID(),code=generateDeliveryCode();
   const time=await repository.now(scopes.command,clock?.()),recipient=await repository.ensureRecipient(scopes.command,before,randomUUID(),randomUUID(),time);
   const parts=[scopes.command.context.organizationId!,scopes.command.context.permittedFranchiseIds[0]!,parcel,attempt,assignment,recipient.id,recipient.contact_version,'1',challenge];
   const commandInput={expected_version:body.expected_version,evidence_ref:body.handover_evidence_ref,attempt_id:attempt,assignment_id:assignment,challenge_ref:challenge,agent_id:body.agent_id};
   await repository.reserve(scopes.command,command,parcel,attempt,operation,key,fingerprint,body.expected_version,body,time);
   await repository.insertAttempt(scopes.command,{id:attempt,command,parcel:before,recipient,assignment,agent:body.agent_id,challenge,
    verifier:deliveryVerifier(configuration.keys,parts,code),sealed:sealDeliveryCode(configuration.keys,parts,code),keyVersion:configuration.keys.version,time});
   await repository.reserveParcelCommand(scopes.command,command,before,retry?'retry':'start',commandInput,fingerprint,key);
   const after=await repository.startParcelTransition(scopes.command,before,command,attempt,body.agent_id,time);if(!after)throw new HttpError('VERSION_CONFLICT');
   await repository.appendParcelEvidence(scopes.command,scopes.events,{command,event,parcel:before,operation:retry?'retry':'start',expected:before.version,
    evidence:body.handover_evidence_ref,attempt,assignment,challenge,time});
   await reserveChallengeSend(scopes.command,whatsapp,configuration,{attempt,challenge,parcel,recipient:recipient.id,contactVersion:recipient.contact_version,code,
    expires:new Date(time.getTime()+600000),command,kind:'initial',ordinal:0,time});
   await repository.completeParcelCommand(scopes.command,command,parcelResult({...before,...after},event,time),time);
   await repository.audit(scopes.command,randomUUID(),command,parcel,attempt,operation,'success','challenge_reserved',time);
   const result=await repository.currentState(scopes.command,parcel,false);await repository.completeCommand(scopes.command,command,result,200,time);return result;
  });
 }
 async function read(session:string,parcelInput:unknown,query:unknown,correlation:string) {
  const parcel=parcelId(parcelInput);return scoped(session,query,'deliveries.read',correlation,scopes=>repository.currentState(scopes.command,parcel,scopes.roles.includes('delivery_agent')));
 }
 async function list(session:string,query:unknown,correlation:string) {
  return scoped(session,query,'deliveries.list',correlation,async scopes=>({items:await repository.queue(scopes.command,scopes.roles.includes('delivery_agent')),scope_revision:scopes.revision}));
 }
 async function agents(session:string,query:unknown,correlation:string) {
  return scoped(session,query,'deliveries.agents',correlation,async scopes=>({items:(await repository.agents(scopes.command)).map(a=>({id:a.id,label:`Agent ${a.id.slice(0,8)}`}))}));
 }
 async function resend(session:string,parcelInput:unknown,query:unknown,keyInput:unknown,raw:readonly string[],value:unknown,replace:boolean,correlation:string) {
  const parcel=parcelId(parcelInput),body=replace?validate.replace(value):validate.resend(value),operation:DeliveryOperation=replace?'deliveries.replace':'deliveries.resend';
  const key=keyDigest(idempotencyKey(keyInput,raw)),fingerprint=fp(operation,parcel,body);
  return scoped(session,query,operation,correlation,async scopes=>{
   const a=await repository.lockAttempt(scopes.command,parcel,true),replay=await repository.replay(scopes.command,parcel,operation,key,fingerprint);if(replay)return replay;
   if(a.parcel_version!==body.expected_version)throw new HttpError('VERSION_CONFLICT');
   if(a.id!==a.active_attempt_id||a.state!=='active'||a.parcel_status!=='out_for_delivery'||a.challenge_id!==body.challenge_ref)throw new HttpError('PARCEL_STATE_CONFLICT');
   if(a.locked_at||a.failed_verifications>=5)throw new HttpError('DELIVERY_CHALLENGE_LOCKED');
   const time=await repository.now(scopes.command,clock?.()),latest=await repository.latestSend(scopes.command,a.id);
   if(latest&&time.getTime()<latest.reserved_at.getTime()+60000)throw new HttpError('DELIVERY_RESEND_COOLDOWN');
   if(latest&&sendReservationPending(latest.outbound_state??latest.send_state))throw new HttpError('TEMPORARILY_UNAVAILABLE');
   if(a.resend_count>=3)throw new HttpError('DELIVERY_RESEND_LIMIT');
   if(replace&&(body as ReturnType<typeof validate.replace>).reason_code==='expired'&&time<a.expires_at)throw new HttpError('PARCEL_STATE_CONFLICT');
   if(!replace&&time>=a.expires_at)throw new HttpError('DELIVERY_CHALLENGE_EXPIRED');
   const command=randomUUID();await repository.reserve(scopes.command,command,parcel,a.id,operation,key,fingerprint,body.expected_version,body,time);
   const advanced=await repository.advanceResend(scopes.command,a.id);if(!advanced)throw new HttpError('DELIVERY_RESEND_LIMIT');
   let challenge=a.challenge_id,version=a.challenge_version,code:string;
   if(replace) {
    challenge=randomUUID();version++;code=generateDeliveryCode();const parts=identity(a,challenge,version);
    await repository.replaceChallenge(scopes.command,a,challenge,deliveryVerifier(configuration.keys,parts,code),sealDeliveryCode(configuration.keys,parts,code),configuration.keys.version,command,time);
   } else {
    if(!a.encrypted_secret)throw new HttpError('DELIVERY_CHALLENGE_LOCKED');
    code=openDeliveryCode(configuration.keys,identity(a,a.challenge_id,a.challenge_version),a.encrypted_secret,a.key_version);
   }
   await reserveChallengeSend(scopes.command,whatsapp,configuration,{attempt:a.id,challenge,parcel,recipient:a.recipient_ref,contactVersion:a.recipient_contact_version,
    code,expires:replace?new Date(time.getTime()+600000):a.expires_at,command,kind:replace?'replacement':'resend',ordinal:advanced.resend_count,time});
   await repository.audit(scopes.command,randomUUID(),command,parcel,a.id,operation,'success',replace?'challenge_replaced':'challenge_resent',time);
   const result=await repository.currentState(scopes.command,parcel,true);await repository.completeCommand(scopes.command,command,result,200,time);return result;
  });
 }
 async function finish(scopes:DeliveryScopes,a:DeliveryAttemptRow,command:string,key:string,fingerprint:string,
  time:Date,method:ProofMethod,exception?:Awaited<ReturnType<typeof repository.exceptionalApproval>>) {
  const proof=randomUUID(),event=randomUUID(),input={expected_version:a.parcel_version,evidence_ref:proof,attempt_id:a.id,proof_ref:proof};
  await repository.reserveParcelCommand(scopes.command,command,a,'complete',input,fingerprint,key);
  await repository.insertProof(scopes.command,a,command,proof,method,time,exception?{approval:exception.id,reason:exception.reason_code,evidence:exception.evidence_id,
   requester:exception.requester_id,approver:exception.approver_id}:undefined);
  const after=await repository.deliverParcel(scopes.command,a,command,time);if(!after)throw new HttpError('VERSION_CONFLICT');
  await repository.appendParcelEvidence(scopes.command,scopes.events,{command,event,parcel:a,operation:'complete',expected:a.parcel_version,evidence:proof,attempt:a.id,proof,time});
  const pResult=parcelResult({id:a.parcel_id,booking_id:a.booking_id,docket:a.docket,version:a.parcel_version+1,status:'delivered',custody:'recipient',
   attempts_started:a.attempt_number,failed_attempt_count:a.attempt_number-1},event,time);await repository.completeParcelCommand(scopes.command,command,pResult,time);
  await repository.audit(scopes.command,randomUUID(),command,a.parcel_id,a.id,'deliveries.complete','success',method,time);
  const result=await repository.currentState(scopes.command,a.parcel_id,true);await repository.completeCommand(scopes.command,command,result,200,time);return result;
 }
 async function complete(session:string,parcelInput:unknown,query:unknown,keyInput:unknown,raw:readonly string[],value:unknown,exceptional:boolean,correlation:string) {
  const parcel=parcelId(parcelInput),body=exceptional?validate.exceptionalCompletion(value):validate.proof(value),operation='deliveries.complete' as const;
  const canonical=exceptional?{method:'exceptional',...body}:{method:'otp_verified',expected_version:body.expected_version,challenge_ref:(body as ReturnType<typeof validate.proof>).challenge_ref,
   challenge_version:(body as ReturnType<typeof validate.proof>).challenge_version,proof_commitment:deliveryProofIntent(configuration.keys,[parcel,(body as ReturnType<typeof validate.proof>).challenge_ref,String((body as ReturnType<typeof validate.proof>).challenge_version)],(body as ReturnType<typeof validate.proof>).proof)};
  const key=keyDigest(idempotencyKey(keyInput,raw)),fingerprint=fp(operation,parcel,canonical);
  return scoped(session,query,operation,correlation,async scopes=>{
   const a=await repository.lockAttempt(scopes.command,parcel,true),replay=await repository.replay(scopes.command,parcel,operation,key,fingerprint);if(replay)return replay;
   if(a.parcel_version!==body.expected_version)throw new HttpError('VERSION_CONFLICT');
   if(a.state!=='active'||a.id!==a.active_attempt_id||a.parcel_status!=='out_for_delivery'||a.assigned_agent_id!==a.agent_id)throw new HttpError('PARCEL_STATE_CONFLICT');
   const time=await repository.now(scopes.command,clock?.()),command=randomUUID();
   if(exceptional) {
    const approval=await repository.exceptionalApproval(scopes.command,a,(body as ReturnType<typeof validate.exceptionalCompletion>).approval_ref);
    await repository.reserve(scopes.command,command,parcel,a.id,operation,key,fingerprint,body.expected_version,{method:'exceptional',approval_ref:approval.id},time);
    return finish(scopes,a,command,key,fingerprint,time,'exceptional',approval);
   }
   const otp=body as ReturnType<typeof validate.proof>;
   if(a.challenge_id!==otp.challenge_ref||a.challenge_version!==otp.challenge_version)throw new HttpError('DELIVERY_PROOF_INVALID');
   if(a.locked_at||a.failed_verifications>=5)throw new HttpError('DELIVERY_CHALLENGE_LOCKED');
   if(a.consumed_at||a.superseded_at||a.challenge_status==='closed')throw new HttpError('DELIVERY_PROOF_INVALID');
   if(time>=a.expires_at)throw new HttpError('DELIVERY_CHALLENGE_EXPIRED');
   const stored=await storedVerifier(scopes.command,a.challenge_id);
   if(!verifyDeliveryCode(configuration.keys,identity(a,a.challenge_id,a.challenge_version),otp.proof,stored)) {
    await repository.reserve(scopes.command,command,parcel,a.id,operation,key,fingerprint,body.expected_version,{method:'otp_verified',challenge_ref:a.challenge_id,challenge_version:a.challenge_version},time);
    const failures=await repository.wrongProof(scopes.command,a,time),result={outcome:'proof_invalid',remaining_attempts:Math.max(0,5-failures),locked:failures===5};
    await repository.audit(scopes.command,randomUUID(),command,parcel,a.id,operation,'denied',failures===5?'challenge_locked':'proof_invalid',time);
    await repository.completeCommand(scopes.command,command,result,200,time);return result;
   }
   await repository.reserve(scopes.command,command,parcel,a.id,operation,key,fingerprint,body.expected_version,{method:'otp_verified',challenge_ref:a.challenge_id,challenge_version:a.challenge_version},time);
   return finish(scopes,a,command,key,fingerprint,time,'otp_verified');
  });
 }
 async function requestException(session:string,parcelInput:unknown,query:unknown,keyInput:unknown,raw:readonly string[],value:unknown,correlation:string) {
  const parcel=parcelId(parcelInput),body=validate.exceptionRequest(value),operation='deliveries.exception.request' as const,key=keyDigest(idempotencyKey(keyInput,raw)),fingerprint=fp(operation,parcel,body);
  return scoped(session,query,operation,correlation,async scopes=>{
   const a=await repository.lockAttempt(scopes.command,parcel,true),replay=await repository.replay(scopes.command,parcel,operation,key,fingerprint);if(replay)return replay;
   if(a.parcel_version!==body.expected_version)throw new HttpError('VERSION_CONFLICT');if(a.state!=='active'||a.id!==a.active_attempt_id)throw new HttpError('PARCEL_STATE_CONFLICT');
   if(body.reason_code==='challenge_locked_reviewed'&&!a.locked_at)throw new HttpError('DELIVERY_EXCEPTION_INVALID');
   if(body.reason_code==='provider_unavailable') {const state=await repository.currentState(scopes.command,parcel,true);if(!['failed','uncertain'].includes(state.send_state))throw new HttpError('DELIVERY_EXCEPTION_INVALID');}
   const time=await repository.now(scopes.command,clock?.()),command=randomUUID(),request=randomUUID();
   await repository.reserve(scopes.command,command,parcel,a.id,operation,key,fingerprint,body.expected_version,body,time);
   await repository.requestException(scopes.command,a,request,command,body.reason_code,body.evidence_id,time);
   await repository.audit(scopes.command,randomUUID(),command,parcel,a.id,operation,'success','exception_requested',time);
   const result=await repository.currentState(scopes.command,parcel,true);await repository.completeCommand(scopes.command,command,result,200,time);return result;
  });
 }
 async function approveException(session:string,parcelInput:unknown,query:unknown,keyInput:unknown,raw:readonly string[],value:unknown,correlation:string) {
  const parcel=parcelId(parcelInput),body=validate.exceptionApproval(value),operation='deliveries.exception.approve' as const,key=keyDigest(idempotencyKey(keyInput,raw)),fingerprint=fp(operation,parcel,body);
  return scoped(session,query,operation,correlation,async scopes=>{
   const a=await repository.lockAttempt(scopes.command,parcel,false),replay=await repository.replay(scopes.command,parcel,operation,key,fingerprint);if(replay)return replay;
   if(a.parcel_version!==body.expected_version)throw new HttpError('VERSION_CONFLICT');if(a.state!=='active'||a.id!==a.active_attempt_id)throw new HttpError('PARCEL_STATE_CONFLICT');
   const time=await repository.now(scopes.command,clock?.()),command=randomUUID(),approval=randomUUID();
   await repository.reserve(scopes.command,command,parcel,a.id,operation,key,fingerprint,body.expected_version,body,time);
   await repository.approveException(scopes.command,a,body.request_id,approval,command,time);
   await repository.audit(scopes.command,randomUUID(),command,parcel,a.id,operation,'success','exception_approved',time);
   const result=await repository.currentState(scopes.command,parcel,false);await repository.completeCommand(scopes.command,command,result,200,time);return result;
  });
 }
 return {start,read,list,agents,resend,complete,requestException,approveException};
}
