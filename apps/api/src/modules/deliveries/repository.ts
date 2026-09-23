import { scopedQuery,assertTenantAccess,type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { ChallengeStatus,DeliveryAttemptRow,DeliveryOperation,DeliveryStateDto,ExceptionalReason,ProofMethod } from './types.ts';

const deliveryCommands:readonly DeliveryOperation[]=['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve'];
export interface StartParcel {
 id:string;booking_id:string;docket:string;version:number;status:string;custody:string;attempts_started:number;failed_attempt_count:number;
 active_attempt_id:string|null;assigned_agent_id:string|null;organization_lifecycle:string;franchise_lifecycle:string;
 recipient_snapshot:{phone_normalized?:unknown};booking_state:string;
}
export interface DeliveryRecipient {id:string;contact_version:string;phone_normalized:string}
export async function now(scope:TenantAccess,override?:Date) {
 return override??(await scopedQuery<{instant:Date}>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve','deliveries.read'],`SELECT date_trunc('milliseconds',clock_timestamp()) AS instant
  FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}`)).rows[0]!.instant;
}
export async function replay(scope:TenantAccess,parcel:string,operation:string,key:string,fingerprint:string) {
 const c=assertTenantAccess(scope,deliveryCommands);
 const row=(await scopedQuery<{parcel_id:string;fingerprint:string;state:string;result:DeliveryStateDto}>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve'],`SELECT d.parcel_id,d.fingerprint,d.state,d.result
  FROM shipit.delivery_commands d WHERE {{franchise:d.organization_id:d.franchise_id}} AND d.principal_id=$1 AND d.operation_id=$2 AND d.key_digest=$3 FOR UPDATE`,
 [c.actor.id,`api.v1.${operation}`,key])).rows[0];
 if(!row)return null;if(row.parcel_id!==parcel||row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
 if(row.state!=='committed')throw new HttpError('IDEMPOTENCY_IN_PROGRESS');return structuredClone(row.result);
}
export async function startParcel(scope:TenantAccess,id:string) {
 const row=(await scopedQuery<StartParcel>(scope,['deliveries.start','deliveries.retry'],`SELECT p.id,p.booking_id,p.docket,p.version,p.status,p.custody,p.attempts_started,p.failed_attempt_count,p.active_attempt_id,p.assigned_agent_id,p.recipient_snapshot,
  o.lifecycle AS organization_lifecycle,f.lifecycle AS franchise_lifecycle,b.state AS booking_state
  FROM shipit.parcels p JOIN shipit.bookings b ON b.organization_id=p.organization_id AND b.franchise_id=p.franchise_id AND b.id=p.booking_id
  JOIN shipit.organizations o ON o.id=p.organization_id JOIN shipit.franchises f ON f.organization_id=p.organization_id AND f.id=p.franchise_id
  WHERE {{franchise:p.organization_id:p.franchise_id}} AND {{franchise:b.organization_id:b.franchise_id}}
   AND p.id=$1 FOR UPDATE OF p`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
 if(row.organization_lifecycle!=='active')throw new HttpError('ORGANIZATION_DISABLED');
 if(row.franchise_lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
 if(row.booking_state!=='active')throw new HttpError('PARCEL_STATE_CONFLICT');return row;
}
export async function ensureRecipient(scope:TenantAccess,parcel:StartParcel,id:string,contactVersion:string,time:Date) {
 const c=assertTenantAccess(scope,['deliveries.start','deliveries.retry']),phone=parcel.recipient_snapshot.phone_normalized;
 if(typeof phone!=='string'||!/^\+[1-9][0-9]{7,14}$/.test(phone))throw new HttpError('PARCEL_STATE_CONFLICT');
 await scopedQuery(scope,['deliveries.start','deliveries.retry'],`INSERT INTO shipit.delivery_recipients(id,organization_id,franchise_id,parcel_id,contact_version,phone_normalized,created_at)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6 WHERE {{franchise:$7:$2}} ON CONFLICT(organization_id,franchise_id,parcel_id) DO NOTHING`,
 [id,c.permittedFranchiseIds[0],parcel.id,contactVersion,phone,time,c.organizationId]);
 const recipient=(await scopedQuery<DeliveryRecipient>(scope,['deliveries.start','deliveries.retry'],`SELECT r.id,r.contact_version,r.phone_normalized FROM shipit.delivery_recipients r
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.parcel_id=$1`,[parcel.id])).rows[0];
 if(!recipient)throw new HttpError('PARCEL_STATE_CONFLICT');return recipient;
}
export async function eligibleAgent(scope:TenantAccess,user:string) {
 return (await scopedQuery<{id:string}>(scope,['deliveries.start','deliveries.retry','deliveries.agents'],`SELECT u.id FROM shipit.auth_users u JOIN shipit.memberships m ON m.user_id=u.id
  JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
  WHERE {{franchise:m.organization_id:s.franchise_id}} AND m.role='delivery_agent' AND m.lifecycle='active' AND u.lifecycle='active' AND u.id=$1 LIMIT 1`,[user])).rows[0]!==undefined;
}
export async function agents(scope:TenantAccess) {
 return (await scopedQuery<{id:string}>(scope,['deliveries.agents'],`SELECT DISTINCT u.id FROM shipit.auth_users u JOIN shipit.memberships m ON m.user_id=u.id
  JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
  WHERE {{franchise:m.organization_id:s.franchise_id}} AND m.role='delivery_agent' AND m.lifecycle='active' AND u.lifecycle='active' ORDER BY u.id LIMIT 100`)).rows;
}
export async function reserve(scope:TenantAccess,id:string,parcel:string,attempt:string|null,operation:string,key:string,fingerprint:string,expected:number,input:object,time:Date) {
 const c=assertTenantAccess(scope,deliveryCommands);
 await scopedQuery(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve'],`INSERT INTO shipit.delivery_commands(id,principal_id,organization_id,franchise_id,parcel_id,attempt_id,operation_id,key_digest,fingerprint,expected_version,input,correlation_id,created_at)
  SELECT $1,$2,{{organization}},$3,$4,$5,$6,$7,$8,$9,$10,$11,$12 WHERE {{franchise:$13:$3}}`,
 [id,c.actor.id,c.permittedFranchiseIds[0],parcel,attempt,`api.v1.${operation}`,key,fingerprint,expected,input,c.correlationId,time,c.organizationId]);
}
export async function completeCommand(scope:TenantAccess,id:string,result:object,status=200,time?:Date) {
 assertTenantAccess(scope,deliveryCommands);const instant=time??await now(scope);
 await scopedQuery(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve'],`UPDATE shipit.delivery_commands d SET state='committed',http_status=$2,result=$3,committed_at=$4,
  retain_until=$4::timestamptz+interval '24 hours' WHERE {{franchise:d.organization_id:d.franchise_id}} AND d.id=$1 AND d.state='reserved'`,[id,status,result,instant]);
}
export async function audit(scope:TenantAccess,id:string,command:string,parcel:string,attempt:string|null,action:string,outcome:'success'|'denied',reason:string,time:Date) {
 const c=assertTenantAccess(scope,deliveryCommands);
 await scopedQuery(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve'],`INSERT INTO shipit.delivery_audit_events(id,organization_id,franchise_id,parcel_id,attempt_id,actor_id,action,reason_code,outcome,correlation_id,occurred_at,command_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}}`,
 [id,c.permittedFranchiseIds[0],parcel,attempt,c.actor.id,action,reason,outcome,c.correlationId,time,command,c.organizationId]);
}
export async function insertAttempt(scope:TenantAccess,input:{id:string;command:string;parcel:StartParcel;recipient:DeliveryRecipient;assignment:string;agent:string;challenge:string;verifier:string;sealed:string;keyVersion:string;time:Date}) {
 const c=assertTenantAccess(scope,['deliveries.start','deliveries.retry']);
 await scopedQuery(scope,['deliveries.start','deliveries.retry'],`INSERT INTO shipit.delivery_attempts(id,organization_id,franchise_id,booking_id,parcel_id,assignment_id,agent_id,recipient_ref,recipient_contact_version,attempt_number,state,started_at,start_command_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11 WHERE {{franchise:$12:$2}}`,
 [input.id,c.permittedFranchiseIds[0],input.parcel.booking_id,input.parcel.id,input.assignment,input.agent,input.recipient.id,input.recipient.contact_version,
  input.parcel.attempts_started+1,input.time,input.command,c.organizationId]);
 await scopedQuery(scope,['deliveries.start','deliveries.retry'],`INSERT INTO shipit.delivery_challenges(id,organization_id,franchise_id,parcel_id,attempt_id,challenge_version,verifier,encrypted_secret,key_version,issued_at,expires_at,created_command_id)
  SELECT $1,{{organization}},$2,$3,$4,1,$5,$6,$7,$8,$8::timestamptz+interval '10 minutes',$9 WHERE {{franchise:$10:$2}}`,
 [input.challenge,c.permittedFranchiseIds[0],input.parcel.id,input.id,input.verifier,input.sealed,input.keyVersion,input.time,input.command,c.organizationId]);
}
export async function reserveParcelCommand(scope:TenantAccess,id:string,parcel:StartParcel|DeliveryAttemptRow,operation:'start'|'retry'|'complete',input:Record<string,unknown>,fingerprint:string,key:string) {
 const c=assertTenantAccess(scope,['deliveries.start','deliveries.retry','deliveries.complete']);
 const booking=parcel.booking_id,resource='parcel_id' in parcel?parcel.parcel_id:parcel.id;
 await scopedQuery(scope,['deliveries.start','deliveries.retry','deliveries.complete'],`INSERT INTO shipit.parcel_commands
  (id,principal_id,organization_id,franchise_id,booking_id,parcel_id,operation_id,key_digest,fingerprint,expected_version,from_status,to_status,input,correlation_id)
  SELECT $1,$2,{{organization}},$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 WHERE {{franchise:$14:$3}}`,
 [id,c.actor.id,c.permittedFranchiseIds[0],booking,resource,`api.v1.deliveries.${operation}`,key,fingerprint,input.expected_version,
  operation==='start'?'in_transit':operation==='retry'?'failed_attempt':'out_for_delivery',operation==='complete'?'delivered':'out_for_delivery',input,c.correlationId,c.organizationId]);
}
export async function startParcelTransition(scope:TenantAccess,parcel:StartParcel,command:string,attempt:string,agent:string,time:Date) {
 return (await scopedQuery<StartParcel>(scope,['deliveries.start','deliveries.retry'],`UPDATE shipit.parcels p SET status='out_for_delivery',custody='delivery_agent',attempts_started=attempts_started+1,
  active_attempt_id=$2,assigned_agent_id=$3,version=version+1,last_command_id=$4,updated_at=$5 WHERE {{franchise:p.organization_id:p.franchise_id}}
  AND p.id=$1 AND p.version=$6 AND p.status=$7 RETURNING p.*`,[parcel.id,attempt,agent,command,time,parcel.version,parcel.status])).rows[0];
}
export async function appendParcelEvidence(scope:TenantAccess,events:TenantAccess,input:{command:string;event:string;parcel:StartParcel|DeliveryAttemptRow;operation:'start'|'retry'|'complete';
  expected:number;evidence:string;attempt:string;assignment?:string;challenge?:string;proof?:string;time:Date}) {
 const c=assertTenantAccess(scope,['deliveries.start','deliveries.retry','deliveries.complete']),ec=assertTenantAccess(events,['deliveries.events']);
 const resource='parcel_id' in input.parcel?input.parcel.parcel_id:input.parcel.id;
 const afterVersion=input.expected+1,to=input.operation==='complete'?'delivered':'out_for_delivery',from=input.operation==='start'?'in_transit':input.operation==='retry'?'failed_attempt':'out_for_delivery';
 await scopedQuery(scope,['deliveries.start','deliveries.retry','deliveries.complete'],`INSERT INTO shipit.parcel_transitions
  (id,organization_id,franchise_id,booking_id,parcel_id,command_id,sequence,operation_id,from_status,to_status,actor_id,evidence_ref,correlation_id,occurred_at)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13 WHERE {{franchise:$14:$2}}`,
 [input.event,c.permittedFranchiseIds[0],input.parcel.booking_id,resource,input.command,afterVersion,`deliveries.${input.operation}`,from,to,c.actor.id,input.evidence,c.correlationId,input.time,c.organizationId]);
 const eventType=input.operation==='start'?'delivery.attempt_started':input.operation==='retry'?'delivery.retry_started':'delivery.completed';
 const payload=input.operation==='complete'?{attempt_id:input.attempt,proof_ref:input.proof}:{attempt_id:input.attempt,assignment_id:input.assignment,challenge_ref:input.challenge};
 const envelope={event_id:input.event,event_type:eventType,schema_version:1,organization_id:ec.organizationId,franchise_id:ec.permittedFranchiseIds[0],
  aggregate_type:'parcel',aggregate_id:resource,aggregate_version:afterVersion,occurred_at:input.time.toISOString(),actor:{type:'user',id:c.actor.id},
  correlation_id:c.correlationId,causation_id:input.command,command_id:input.command,payload};
 await scopedQuery(events,['deliveries.events'],`INSERT INTO shipit.domain_events(event_id,organization_id,franchise_id,booking_id,parcel_id,command_id,parcel_command_id,event_type,aggregate_id,envelope,occurred_at,aggregate_sequence)
  SELECT $1,{{organization}},$2,$3,$4,$5,$5,$6,$4,$7,$8,$9 WHERE {{franchise:$10:$2}}`,
 [input.event,ec.permittedFranchiseIds[0],input.parcel.booking_id,resource,input.command,eventType,envelope,input.time,afterVersion,ec.organizationId]);
}
export async function completeParcelCommand(scope:TenantAccess,id:string,result:object,time:Date) {
 await scopedQuery(scope,['deliveries.start','deliveries.retry','deliveries.complete'],`UPDATE shipit.parcel_commands p SET state='committed',http_status=200,result=$2,committed_at=$3,
  retain_until=$3::timestamptz+interval '24 hours' WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1 AND p.state='reserved'`,[id,result,time]);
}
export async function lockAttempt(scope:TenantAccess,parcel:string,agentOnly:boolean) {
 const c=assertTenantAccess(scope,[...deliveryCommands,'deliveries.read']);
 const row=(await scopedQuery<DeliveryAttemptRow>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve','deliveries.read'],`SELECT a.*,ch.id AS challenge_id,ch.challenge_version,
  CASE WHEN ch.consumed_at IS NOT NULL THEN 'consumed' WHEN ch.superseded_at IS NOT NULL THEN 'superseded' WHEN ch.closed_at IS NOT NULL THEN 'closed'
   WHEN a.locked_at IS NOT NULL THEN 'locked' WHEN ch.expires_at<=clock_timestamp() THEN 'expired'
   WHEN s.id IS NULL OR s.send_state='queued' AND o.state IN ('queued','retry_wait','dispatching') THEN 'pending' ELSE 'active' END AS challenge_status,
  ch.issued_at,ch.expires_at,ch.superseded_at,ch.consumed_at,ch.encrypted_secret,ch.key_version,p.version AS parcel_version,p.status AS parcel_status,
  p.custody AS parcel_custody,p.assigned_agent_id,p.active_attempt_id,p.docket
  FROM shipit.delivery_attempts a JOIN shipit.parcels p ON p.organization_id=a.organization_id AND p.franchise_id=a.franchise_id AND p.id=a.parcel_id
  JOIN shipit.delivery_challenges ch ON ch.organization_id=a.organization_id AND ch.franchise_id=a.franchise_id AND ch.attempt_id=a.id AND ch.superseded_at IS NULL
  LEFT JOIN LATERAL (SELECT x.* FROM shipit.delivery_challenge_sends x WHERE x.organization_id=a.organization_id AND x.franchise_id=a.franchise_id AND x.attempt_id=a.id ORDER BY x.reserved_at DESC,x.id DESC LIMIT 1) s ON true
  LEFT JOIN shipit.whatsapp_outbound o ON o.organization_id=s.organization_id AND o.franchise_id=s.franchise_id AND o.id=s.outbound_intent_id
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}} AND {{franchise:ch.organization_id:ch.franchise_id}}
   AND a.parcel_id=$1 AND (NOT $2::boolean OR a.agent_id=$3) ORDER BY a.attempt_number DESC LIMIT 1 FOR UPDATE OF a,p,ch`,[parcel,agentOnly,c.actor.id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function currentState(scope:TenantAccess,parcel:string,agentOnly:boolean):Promise<DeliveryStateDto> {
 const a=await lockAttempt(scope,parcel,agentOnly),send=(await scopedQuery<{reserved_at:Date;send_state:string;reason_code:string;outbound_state:string|null;outbound_reason:string|null}>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve','deliveries.read'],`SELECT s.reserved_at,s.send_state,s.reason_code,o.state AS outbound_state,o.reason_code AS outbound_reason
  FROM shipit.delivery_challenge_sends s LEFT JOIN shipit.whatsapp_outbound o ON o.organization_id=s.organization_id AND o.franchise_id=s.franchise_id AND o.id=s.outbound_intent_id
  WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.attempt_id=$1 ORDER BY s.reserved_at DESC,s.id DESC LIMIT 1`,[a.id])).rows[0];
 const proof=(await scopedQuery<{proof_method:ProofMethod}>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve','deliveries.read'],`SELECT p.proof_method FROM shipit.delivery_proofs p WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.attempt_id=$1`,[a.id])).rows[0];
 const exception=(await scopedQuery<{id:string;state:'pending'|'approved'|'denied'|'invalidated';reason_code:ExceptionalReason;approval_id:string|null}>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve','deliveries.read'],`SELECT r.id,r.state,r.reason_code,a.id AS approval_id FROM shipit.delivery_exception_requests r LEFT JOIN shipit.delivery_exception_approvals a
  ON a.organization_id=r.organization_id AND a.franchise_id=r.franchise_id AND a.request_id=r.id WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.attempt_id=$1`,[a.id])).rows[0];
 const status:ChallengeStatus=a.challenge_status;
 return {parcel_id:a.parcel_id,docket:a.docket,parcel_version:a.parcel_version,attempt_id:a.id,assignment_id:a.assignment_id,attempt_number:a.attempt_number,
  challenge_ref:a.challenge_id,challenge_version:a.challenge_version,status,expires_at:a.expires_at.toISOString(),
  resend_available_at:new Date((send?.reserved_at??a.issued_at).getTime()+60000).toISOString(),resends_remaining:Math.max(0,3-a.resend_count),
  verification_attempts_remaining:Math.max(0,5-a.failed_verifications),send_state:send?.outbound_state??send?.send_state??'failed',
  send_reason:send?.outbound_reason??send?.reason_code??'send_unavailable',proof_method:proof?.proof_method??null,
  exception:exception?{request_id:exception.id,state:exception.state,reason_code:exception.reason_code,approval_ref:exception.approval_id}:null};
}
export async function latestSend(scope:TenantAccess,attempt:string) {
 return (await scopedQuery<{reserved_at:Date;resend_ordinal:number;send_state:string;outbound_state:string|null}>(scope,['deliveries.start','deliveries.retry','deliveries.resend','deliveries.replace','deliveries.complete','deliveries.exception.request','deliveries.exception.approve'],`SELECT s.reserved_at,s.resend_ordinal,s.send_state,o.state AS outbound_state FROM shipit.delivery_challenge_sends s
  LEFT JOIN shipit.whatsapp_outbound o ON o.organization_id=s.organization_id AND o.franchise_id=s.franchise_id AND o.id=s.outbound_intent_id
  WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.attempt_id=$1 ORDER BY s.reserved_at DESC,s.id DESC LIMIT 1`,[attempt])).rows[0];
}
export async function advanceResend(scope:TenantAccess,attempt:string) {
 return (await scopedQuery<{resend_count:number;version:number}>(scope,['deliveries.resend','deliveries.replace'],`UPDATE shipit.delivery_attempts a SET resend_count=resend_count+1,version=version+1
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.id=$1 AND a.state='active' AND a.resend_count<3 RETURNING resend_count,version`,[attempt])).rows[0];
}
export async function replaceChallenge(scope:TenantAccess,a:DeliveryAttemptRow,id:string,verifier:string,sealed:string,keyVersion:string,command:string,time:Date) {
 await scopedQuery(scope,['deliveries.replace'],`UPDATE shipit.delivery_challenges c SET superseded_at=$3,superseded_by=$2,verifier=NULL,encrypted_secret=NULL
  WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 AND c.superseded_at IS NULL AND c.consumed_at IS NULL AND c.closed_at IS NULL`,[a.challenge_id,id,time]);
 await scopedQuery(scope,['deliveries.replace'],`INSERT INTO shipit.delivery_challenges(id,organization_id,franchise_id,parcel_id,attempt_id,challenge_version,verifier,encrypted_secret,key_version,issued_at,expires_at,created_command_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$9::timestamptz+interval '10 minutes',$10 WHERE {{franchise:$11:$2}}`,
 [id,scope.context.permittedFranchiseIds[0],a.parcel_id,a.id,a.challenge_version+1,verifier,sealed,keyVersion,time,command,scope.context.organizationId]);
}
export async function wrongProof(scope:TenantAccess,a:DeliveryAttemptRow,time:Date) {
 const updated=(await scopedQuery<{failed_verifications:number}>(scope,['deliveries.complete'],`UPDATE shipit.delivery_attempts a SET failed_verifications=failed_verifications+1,
  locked_at=CASE WHEN failed_verifications+1=5 THEN $2::timestamptz ELSE NULL END,version=version+1 WHERE {{franchise:a.organization_id:a.franchise_id}}
  AND a.id=$1 AND a.state='active' AND a.failed_verifications<5 RETURNING failed_verifications`,[a.id,time])).rows[0];
 if(!updated)throw new HttpError('DELIVERY_CHALLENGE_LOCKED');
 if(updated.failed_verifications===5)await scopedQuery(scope,['deliveries.complete'],`UPDATE shipit.delivery_challenges c SET verifier=NULL,encrypted_secret=NULL
  WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1`,[a.challenge_id]);return updated.failed_verifications;
}
export async function insertProof(scope:TenantAccess,a:DeliveryAttemptRow,command:string,proof:string,method:ProofMethod,time:Date,exception?:{
 approval:string;reason:ExceptionalReason;evidence:string;requester:string;approver:string}) {
 const c=assertTenantAccess(scope,['deliveries.complete']);
 await scopedQuery(scope,['deliveries.complete'],`INSERT INTO shipit.delivery_proofs(id,organization_id,franchise_id,booking_id,parcel_id,attempt_id,proof_method,challenge_id,approval_id,reason_code,evidence_id,requester_id,approver_id,completed_by,completed_at,parcel_version,command_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16 WHERE {{franchise:$17:$2}}`,
 [proof,c.permittedFranchiseIds[0],a.booking_id,a.parcel_id,a.id,method,method==='otp_verified'?a.challenge_id:null,exception?.approval??null,
  exception?.reason??null,exception?.evidence??null,exception?.requester??null,exception?.approver??null,c.actor.id,time,a.parcel_version+1,command,c.organizationId]);
 await scopedQuery(scope,['deliveries.complete'],`UPDATE shipit.delivery_challenges c SET consumed_at=$2,verifier=NULL,encrypted_secret=NULL
  WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 AND c.consumed_at IS NULL AND c.superseded_at IS NULL AND c.closed_at IS NULL`,[a.challenge_id,time]);
 await scopedQuery(scope,['deliveries.complete'],`UPDATE shipit.delivery_attempts a SET state='completed',closed_at=$2,close_delivery_command_id=$3,version=version+1
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.id=$1 AND a.state='active'`,[a.id,time,command]);
 await scopedQuery(scope,['deliveries.complete'],`UPDATE shipit.delivery_exception_requests r SET state='invalidated',decided_at=$2,decision_command_id=COALESCE(decision_command_id,$3)
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.attempt_id=$1 AND r.state IN ('pending','approved')`,[a.id,time,command]);
}
export async function deliverParcel(scope:TenantAccess,a:DeliveryAttemptRow,command:string,time:Date) {
 return (await scopedQuery<DeliveryAttemptRow>(scope,['deliveries.complete'],`UPDATE shipit.parcels p SET status='delivered',custody='recipient',active_attempt_id=NULL,
  assigned_agent_id=NULL,version=version+1,last_command_id=$2,updated_at=$3 WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1
  AND p.version=$4 AND p.status='out_for_delivery' AND p.active_attempt_id=$5 AND p.assigned_agent_id=$6 RETURNING p.*`,
 [a.parcel_id,command,time,a.parcel_version,a.id,a.agent_id])).rows[0];
}
export async function requestException(scope:TenantAccess,a:DeliveryAttemptRow,id:string,command:string,reason:ExceptionalReason,evidence:string,time:Date) {
 const c=assertTenantAccess(scope,['deliveries.exception.request']);
 const valid=(await scopedQuery(scope,['deliveries.exception.request'],`SELECT x.id FROM shipit.attachments x WHERE {{franchise:x.organization_id:x.franchise_id}}
  AND x.id=$1 AND x.booking_id=$2 AND x.parcel_id=$3 AND x.purpose='parcel_proof' AND x.state='ready'`,[evidence,a.booking_id,a.parcel_id])).rows[0];
 if(!valid)throw new HttpError('RESOURCE_NOT_FOUND');
 await scopedQuery(scope,['deliveries.exception.request'],`INSERT INTO shipit.delivery_exception_requests(id,organization_id,franchise_id,parcel_id,attempt_id,requester_id,reason_code,evidence_id,requested_at,request_command_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,[id,c.permittedFranchiseIds[0],a.parcel_id,a.id,c.actor.id,reason,evidence,time,command,c.organizationId]);
}
export async function approveException(scope:TenantAccess,a:DeliveryAttemptRow,request:string,approval:string,command:string,time:Date) {
 const c=assertTenantAccess(scope,['deliveries.exception.approve']);
 const row=(await scopedQuery<{requester_id:string;reason_code:ExceptionalReason;evidence_id:string}>(scope,['deliveries.exception.approve'],`SELECT r.requester_id,r.reason_code,r.evidence_id
  FROM shipit.delivery_exception_requests r JOIN shipit.attachments x ON x.organization_id=r.organization_id AND x.franchise_id=r.franchise_id AND x.id=r.evidence_id
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND {{franchise:x.organization_id:x.franchise_id}} AND r.id=$1 AND r.attempt_id=$2 AND r.state='pending'
   AND x.state='ready' AND x.parcel_id=$3 FOR UPDATE OF r`,[request,a.id,a.parcel_id])).rows[0];
 if(!row)throw new HttpError('DELIVERY_EXCEPTION_INVALID');if(row.requester_id===c.actor.id)throw new HttpError('ACTION_FORBIDDEN');
 await scopedQuery(scope,['deliveries.exception.approve'],`UPDATE shipit.delivery_exception_requests r SET state='approved',decided_at=$2,decision_command_id=$3
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.id=$1`,[request,time,command]);
 await scopedQuery(scope,['deliveries.exception.approve'],`INSERT INTO shipit.delivery_exception_approvals(id,organization_id,franchise_id,parcel_id,attempt_id,request_id,requester_id,approver_id,evidence_id,reason_code,approved_at,command_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}}`,
 [approval,c.permittedFranchiseIds[0],a.parcel_id,a.id,request,row.requester_id,c.actor.id,row.evidence_id,row.reason_code,time,command,c.organizationId]);return row;
}
export async function exceptionalApproval(scope:TenantAccess,a:DeliveryAttemptRow,approval:string) {
 const c=assertTenantAccess(scope,['deliveries.complete']);
 const row=(await scopedQuery<{id:string;requester_id:string;approver_id:string;evidence_id:string;reason_code:ExceptionalReason}>(scope,['deliveries.complete'],`SELECT x.id,x.requester_id,x.approver_id,x.evidence_id,x.reason_code
  FROM shipit.delivery_exception_approvals x JOIN shipit.delivery_exception_requests r ON r.organization_id=x.organization_id AND r.franchise_id=x.franchise_id AND r.id=x.request_id
  JOIN shipit.attachments e ON e.organization_id=x.organization_id AND e.franchise_id=x.franchise_id AND e.id=x.evidence_id
  WHERE {{franchise:x.organization_id:x.franchise_id}} AND {{franchise:r.organization_id:r.franchise_id}} AND {{franchise:e.organization_id:e.franchise_id}}
   AND x.id=$1 AND x.attempt_id=$2 AND r.state='approved' AND e.state='ready' AND x.requester_id=$3`,[approval,a.id,c.actor.id])).rows[0];
 if(!row)throw new HttpError('DELIVERY_EXCEPTION_INVALID');return row;
}
export async function closeForFailure(scope:TenantAccess,parcel:string,attempt:string,command:string,time:Date) {
 const c=assertTenantAccess(scope,['parcels.fail_delivery']);
 const a=(await scopedQuery<{id:string;agent_id:string}>(scope,['parcels.fail_delivery'],`SELECT a.id,a.agent_id FROM shipit.delivery_attempts a
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.id=$1 AND a.parcel_id=$2 AND a.state='active' AND a.agent_id=$3 FOR UPDATE`,[attempt,parcel,c.actor.id])).rows[0];
 if(!a)throw new HttpError('PARCEL_STATE_CONFLICT');
 await scopedQuery(scope,['parcels.fail_delivery'],`UPDATE shipit.delivery_challenges x SET closed_at=$2,verifier=NULL,encrypted_secret=NULL
  WHERE {{franchise:x.organization_id:x.franchise_id}} AND x.attempt_id=$1 AND x.superseded_at IS NULL AND x.consumed_at IS NULL AND x.closed_at IS NULL`,[attempt,time]);
 await scopedQuery(scope,['parcels.fail_delivery'],`UPDATE shipit.delivery_attempts a SET state='failed',closed_at=$2,close_parcel_command_id=$3,version=version+1
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.id=$1`,[attempt,time,command]);
 await scopedQuery(scope,['parcels.fail_delivery'],`UPDATE shipit.delivery_exception_requests r SET state='invalidated',decided_at=$2
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.attempt_id=$1 AND r.state IN ('pending','approved')`,[attempt,time]);
}
export async function queue(scope:TenantAccess,agentOnly:boolean) {
 const c=assertTenantAccess(scope,['deliveries.list']);
 return (await scopedQuery<{parcel_id:string;docket:string;attempt_id:string;attempt_number:number;expires_at:Date;failed_verifications:number;resend_count:number}>(scope,['deliveries.list'],`SELECT a.parcel_id,p.docket,a.id AS attempt_id,a.attempt_number,ch.expires_at,a.failed_verifications,a.resend_count
  FROM shipit.delivery_attempts a JOIN shipit.parcels p ON p.organization_id=a.organization_id AND p.franchise_id=a.franchise_id AND p.id=a.parcel_id
  JOIN shipit.delivery_challenges ch ON ch.organization_id=a.organization_id AND ch.franchise_id=a.franchise_id AND ch.attempt_id=a.id AND ch.superseded_at IS NULL
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND {{franchise:p.organization_id:p.franchise_id}} AND a.state='active'
   AND (NOT $1::boolean OR a.agent_id=$2) ORDER BY a.started_at,a.id LIMIT 100`,[agentOnly,c.actor.id])).rows.map(r=>({...r,expires_at:r.expires_at.toISOString()}));
}
export async function destroyExpiredSecret(scope:TenantAccess,challenge:string,time:Date) {
 const outbound=await scopedQuery(scope,['deliveries.cleanup'],`UPDATE shipit.whatsapp_outbound m SET sealed_payload=NULL,version=m.version+1
  FROM shipit.delivery_challenge_sends s JOIN shipit.delivery_challenges c ON c.organization_id=s.organization_id AND c.franchise_id=s.franchise_id AND c.id=s.challenge_id
  JOIN shipit.delivery_attempts a ON a.organization_id=c.organization_id AND a.franchise_id=c.franchise_id AND a.id=c.attempt_id
  WHERE {{franchise:m.organization_id:m.franchise_id}} AND {{franchise:s.organization_id:s.franchise_id}} AND {{franchise:c.organization_id:c.franchise_id}}
   AND {{franchise:a.organization_id:a.franchise_id}} AND s.challenge_id=$1 AND s.outbound_intent_id=m.id AND m.sealed_payload IS NOT NULL
   AND (c.expires_at<=$2 OR c.superseded_at IS NOT NULL OR c.consumed_at IS NOT NULL OR c.closed_at IS NOT NULL OR a.state<>'active')`,[challenge,time]);
 const result=await scopedQuery(scope,['deliveries.cleanup'],`UPDATE shipit.delivery_challenges c SET verifier=NULL,encrypted_secret=NULL
  WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1 AND c.encrypted_secret IS NOT NULL AND
   (c.expires_at<=$2 OR c.superseded_at IS NOT NULL OR c.consumed_at IS NOT NULL OR c.closed_at IS NOT NULL OR EXISTS
    (SELECT 1 FROM shipit.delivery_attempts a WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.id=c.attempt_id AND a.state<>'active'))`,[challenge,time]);
 return result.rowCount===1||(outbound.rowCount??0)>0;
}
