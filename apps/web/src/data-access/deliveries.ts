import type { CommandIntent } from './command-intent';
import { array,choice,instant,integer,nullable,object,text,uuid,type Decoder,protocol } from './dto';
import type { ScopedApi } from './scoped-api';

export const challengeStatuses=['pending','active','expired','locked','consumed','superseded','closed'] as const;
export type ChallengeStatus=typeof challengeStatuses[number];
export type ExceptionalReason='recipient_channel_unavailable'|'provider_unavailable'|'challenge_locked_reviewed';
export interface DeliveryQueueItem {parcel_id:string;docket:string;attempt_id:string;attempt_number:number;expires_at:string;failed_verifications:number;resend_count:number}
export interface DeliveryState {
 parcel_id:string;docket:string;parcel_version:number;attempt_id:string;assignment_id:string;attempt_number:number;
 challenge_ref:string;challenge_version:number;status:ChallengeStatus;expires_at:string;resend_available_at:string;
 resends_remaining:number;verification_attempts_remaining:number;send_state:string;send_reason:string;proof_method:'otp_verified'|'exceptional'|null;
 exception:{request_id:string;state:'pending'|'approved'|'denied'|'invalidated';reason_code:ExceptionalReason;approval_ref:string|null}|null;
}
export interface ProofRejected {outcome:'proof_invalid';remaining_attempts:number;locked:boolean}
export type DeliveryResult=DeliveryState|ProofRejected;
export type DeliveryCommand=
 |{kind:'start'|'retry';parcelId:string;body:{expected_version:number;agent_id:string;handover_evidence_ref:string}}
 |{kind:'resend';parcelId:string;body:{expected_version:number;challenge_ref:string}}
 |{kind:'replace';parcelId:string;body:{expected_version:number;challenge_ref:string;reason_code:'expired'|'recorded_compromise'}}
 |{kind:'complete';parcelId:string;body:{expected_version:number;challenge_ref:string;challenge_version:number;proof:string}}
 |{kind:'exception_request';parcelId:string;body:{expected_version:number;reason_code:ExceptionalReason;evidence_id:string;recipient_present:true}}
 |{kind:'exception_approve';parcelId:string;body:{expected_version:number;request_id:string}}
 |{kind:'exception_complete';parcelId:string;body:{expected_version:number;approval_ref:string}};

const queueItem:Decoder<DeliveryQueueItem>=object({parcel_id:uuid,docket:text,attempt_id:uuid,attempt_number:integer(1),expires_at:instant,failed_verifications:integer(),resend_count:integer()});
const exception=object({request_id:uuid,state:choice('pending','approved','denied','invalidated'),reason_code:choice('recipient_channel_unavailable','provider_unavailable','challenge_locked_reviewed'),approval_ref:nullable(uuid)});
const state:Decoder<DeliveryState>=object({parcel_id:uuid,docket:text,parcel_version:integer(1),attempt_id:uuid,assignment_id:uuid,attempt_number:integer(1),challenge_ref:uuid,
 challenge_version:integer(1),status:choice(...challengeStatuses),expires_at:instant,resend_available_at:instant,resends_remaining:integer(),verification_attempts_remaining:integer(),
 send_state:text,send_reason:text,proof_method:nullable(choice('otp_verified','exceptional')),exception:nullable(exception)});
const rejected:Decoder<ProofRejected>=object({outcome:choice('proof_invalid'),remaining_attempts:integer(),locked:choice(true,false)});
const result:Decoder<DeliveryResult>=value=>value&&typeof value==='object'&&'outcome' in value?rejected(value):state(value);
const paths:Record<DeliveryCommand['kind'],string>={start:'start',retry:'retry',resend:'resend',replace:'replace',complete:'complete',exception_request:'exception-requests',exception_approve:'exception-approvals',exception_complete:'exception-complete'};
const operations:Record<DeliveryCommand['kind'],string>={start:'api.v1.deliveries.start',retry:'api.v1.deliveries.retry',resend:'api.v1.deliveries.resend',replace:'api.v1.deliveries.replace',complete:'api.v1.deliveries.complete',exception_request:'api.v1.deliveries.exception.request',exception_approve:'api.v1.deliveries.exception.approve',exception_complete:'api.v1.deliveries.complete'};

export function deliveries(api:ScopedApi){return {
 list(signal?:AbortSignal){return api.read(api.path('/api/v1/deliveries'),object({items:array(queueItem,100),scope_revision:text}),signal);},
 read(parcelId:string,signal?:AbortSignal){return api.read(api.path(`/api/v1/deliveries/${uuid(parcelId)}`),state,signal);},
 agents(signal?:AbortSignal){return api.read(api.path('/api/v1/deliveries/eligible-agents'),object({items:array(object({id:uuid,label:text}),100)}),signal);},
 intent(command:DeliveryCommand){const id=uuid(command.parcelId),expected=integer(1)(command.body.expected_version);return api.intent(operations[command.kind],api.path(`/api/v1/deliveries/${id}/${paths[command.kind]}`),command.body,'POST',expected);},
 execute(intent:CommandIntent){
  const operation=Object.entries(operations).find(([,candidate])=>candidate===intent.operation)?.[0] as DeliveryCommand['kind']|undefined;
  if(!operation)return protocol();
  return api.execute(intent,result,['$','expected_version','agent_id','handover_evidence_ref','challenge_ref','challenge_version','proof','reason_code','evidence_id','recipient_present','request_id','approval_ref']);
 },
};}
export type DeliverySource=ReturnType<typeof deliveries>;
