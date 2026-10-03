import { scopedQuery,type TenantAccess } from '../security/scope.ts';
import { MODEL,REASONING_EFFORT,PROMPT_VERSION,RESERVATION_MICRO_USD,type InterpretationResult } from './interpreter.ts';

export async function inference(scope:TenantAccess,inbox:string) {
 return (await scopedQuery<{state:InterpretationResult['category']|'reserved'|'budget';expires_at:Date}>(scope,['whatsapp.inbox.work'],
  `SELECT a.state,a.expires_at FROM shipit.conversation_inferences a WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.inbox_id=$1`,[inbox])).rows[0];
}
export async function reserve(scope:TenantAccess,inbox:string,now:Date) {
 const x=scope.context;
 await scopedQuery(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.conversation_inference_budgets(organization_id,day_start,minute_start,day_calls,minute_calls,reserved_micro_usd)
  SELECT {{organization}},date_trunc('day',$1::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',$1,0,0,0 WHERE {{organization:$2}}
  ON CONFLICT(organization_id) DO NOTHING`,[now,x.organizationId]);
 // Lock only the short budget reservation. No external call runs in this transaction.
 await scopedQuery(scope,['whatsapp.inbox.work'],`SELECT b.organization_id FROM shipit.conversation_inference_budgets b WHERE {{organization:b.organization_id}} FOR UPDATE`);
 const budget=(await scopedQuery(scope,['whatsapp.inbox.work'],`UPDATE shipit.conversation_inference_budgets b SET
  day_calls=CASE WHEN day_start<$1 THEN 1 ELSE day_calls+1 END,day_start=$1,
  minute_calls=CASE WHEN minute_start<=$2::timestamptz-interval '1 minute' THEN 1 ELSE minute_calls+1 END,
  minute_start=CASE WHEN minute_start<=$2::timestamptz-interval '1 minute' THEN $2 ELSE minute_start END,
  reserved_micro_usd=CASE WHEN day_start<$1 THEN $3 ELSE reserved_micro_usd+$3 END
  WHERE {{organization:b.organization_id}} AND (day_start<$1 OR (day_calls<100 AND reserved_micro_usd+$3<=1000000))
   AND (minute_start<=$2::timestamptz-interval '1 minute' OR minute_calls<10) RETURNING b.organization_id`,
 [new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())),now,RESERVATION_MICRO_USD])).rows.length>0;
 await scopedQuery(scope,['whatsapp.inbox.work'],`INSERT INTO shipit.conversation_inferences(inbox_id,organization_id,franchise_id,model,prompt_version,reasoning_effort,state,started_at,expires_at,reserved_micro_usd,correlation_id)
  SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}`,
 [inbox,x.permittedFranchiseIds[0],MODEL,PROMPT_VERSION,REASONING_EFFORT,budget?'reserved':'budget',now,new Date(now.getTime()+15000),budget?RESERVATION_MICRO_USD:0,x.correlationId,x.organizationId]);
 return budget;
}
export async function finish(scope:TenantAccess,inbox:string,result:InterpretationResult) {
 await scopedQuery(scope,['whatsapp.inbox.work'],`UPDATE shipit.conversation_inferences a SET state=$2,latency_ms=$3,input_tokens=$4,output_tokens=$5,estimated_micro_usd=$6
  WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.inbox_id=$1 AND a.state='reserved'`,
 [inbox,result.category,result.latencyMs,result.inputTokens,result.outputTokens,result.estimatedMicroUsd]);
}
export async function pendingConsent(scope:TenantAccess,installation:string) {
 return (await scopedQuery<{pending:boolean}>(scope,['whatsapp.inbox.work'],`SELECT EXISTS(SELECT 1 FROM shipit.whatsapp_inbox j
  WHERE {{franchise:j.organization_id:j.franchise_id}} AND j.installation_id=$1 AND j.kind='inbound'
   AND NOT EXISTS(SELECT 1 FROM shipit.whatsapp_consent_receipts r WHERE r.inbox_id=j.id)) AS pending`,[installation])).rows[0]!.pending;
}
