import {randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {withAgentStatementScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {object,selection,uuid,integer,idempotencyKey,timestamp} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {cashbookText} from '../cashbook/request-service.ts';
import type {AgentStatementAction} from './types.ts';
interface SubmissionRow {id:string;capture_id:string;agent_id:string;day:string;revision:number;previous_submission_id:string|null;actor_id:string;reason:string;recorded_at:Date;fingerprint:string}
interface DecisionRow {id:string;submission_id:string;kind:'approve'|'reject';expected_version:number;actor_id:string;reason:string;recorded_at:Date;fingerprint:string}
const submitted=(r:SubmissionRow)=>({id:r.id,capture_id:r.capture_id,agent_id:r.agent_id,day:r.day,revision:r.revision,previous_submission_id:r.previous_submission_id,actor_id:r.actor_id,reason:r.reason,recorded_at:r.recorded_at.toISOString()});
const decision=(r:DecisionRow)=>({id:r.id,submission_id:r.submission_id,kind:r.kind,expected_version:r.expected_version,actor_id:r.actor_id,reason:r.reason,recorded_at:r.recorded_at.toISOString()});
async function write<T>(work:()=>Promise<T>){try{return await work();}catch(error){if(error instanceof DatabaseError&&error.sqlState==='40001')throw new HttpError('VERSION_CONFLICT');throw error;}}
export async function readStatementDetail(scope:TenantAccess,id:string,action:AgentStatementAction|'reports.capture',ownOnly:boolean,agentOnly:boolean,agent:boolean){
 const c=assertTenantAccess(scope,[action]);
 const row=(await scopedQuery<SubmissionRow&{source_snapshot:Record<string,unknown>;counted_at:Date;counted_paise:string;capture_recorded_at:Date;superseded:boolean;decision:ReturnType<typeof decision>|null}>(scope,[action],`SELECT s.id,s.capture_id,s.agent_id,s.day::text,s.revision,s.previous_submission_id,s.actor_id,s.reason,s.recorded_at,s.fingerprint,
 cap.source_snapshot,cap.counted_at,cap.counted_paise::text,cap.recorded_at capture_recorded_at,
 EXISTS(SELECT 1 FROM shipit.agent_settlement_submissions n WHERE n.organization_id=s.organization_id AND n.franchise_id=s.franchise_id AND n.agent_id=s.agent_id AND n.day=s.day AND n.revision>s.revision) superseded,
 CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object('id',d.id,'submission_id',d.submission_id,'kind',d.kind,'expected_version',d.expected_version,'actor_id',d.actor_id,'reason',d.reason,'recorded_at',to_char(d.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) END decision
 FROM shipit.agent_settlement_submissions s JOIN shipit.agent_daily_cash_captures cap ON cap.organization_id=s.organization_id AND cap.franchise_id=s.franchise_id AND cap.id=s.capture_id
 LEFT JOIN shipit.agent_settlement_decisions d ON d.organization_id=s.organization_id AND d.franchise_id=s.franchise_id AND d.submission_id=s.id
 WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.id=$1 AND (NOT $2::boolean OR s.actor_id=$3 OR $5::boolean AND s.agent_id=$3) AND (NOT $4::boolean OR s.agent_id=$3)`,[id,ownOnly,c.actor.id,agentOnly,agent])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return {...submitted(row),counted_at:row.counted_at.toISOString(),counted_paise:row.counted_paise,capture_recorded_at:row.capture_recorded_at.toISOString(),source_snapshot:row.source_snapshot,decision:row.decision,status:row.superseded?'superseded':row.decision?.kind==='approve'?'approved':row.decision?'rejected':'pending'};
}
export function createAgentStatementService(database:DatabasePool,writesEnabled=false){return {
 async submit(token:string,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
  const q=selection(query),b=object(body,['capture_id','previous_submission_id','expected_version','reason']),input={capture_id:uuid(b.capture_id,'$'),previous_submission_id:b.previous_submission_id===null?null:uuid(b.previous_submission_id,'$'),expected_version:integer(b.expected_version,'expected_version',0,2147483646),reason:cashbookText(b.reason,500)},k=keyDigest(idempotencyKey(key,headers)),fingerprint=digest({operation:'submit_agent_statement',input});
  return withAgentStatementScope(database,token,q.organizationId,q.franchiseId,'agent_statement.submit',correlation,async({access,admin,agentOnly,agent})=>{
   const c=assertTenantAccess(access,['agent_statement.submit']),saved=(await scopedQuery<SubmissionRow>(access,['agent_statement.submit'],`SELECT id,capture_id,agent_id,day::text,revision,previous_submission_id,actor_id,reason,recorded_at,fingerprint FROM shipit.agent_settlement_submissions WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,k])).rows[0];
   if(saved){if(agentOnly&&saved.agent_id!==c.actor.id)throw new HttpError('RESOURCE_NOT_FOUND');if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return submitted(saved);}
   if(!writesEnabled)throw new HttpError('AGENT_MONEY_DISABLED');
   const cap=(await scopedQuery<{agent_id:string;day:string}>(access,['agent_statement.submit'],`SELECT agent_id,day::text FROM shipit.agent_daily_cash_captures WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND ($2::boolean OR actor_id=$3 OR $4::boolean AND agent_id=$3) AND (NOT $5::boolean OR agent_id=$3)`,[input.capture_id,admin,c.actor.id,agent,agentOnly])).rows[0];
   if(!cap)throw new HttpError('RESOURCE_NOT_FOUND');
   if(input.previous_submission_id!==null){const previous=(await scopedQuery(access,['agent_statement.submit'],`SELECT id FROM shipit.agent_settlement_submissions WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND agent_id=$2 AND day=$3::date AND ($4::boolean OR actor_id=$5 OR $6::boolean AND agent_id=$5)`,[input.previous_submission_id,cap.agent_id,cap.day,admin,c.actor.id,agent])).rows[0];if(!previous)throw new HttpError('RESOURCE_NOT_FOUND');}

   const row=await write(async()=>(await scopedQuery<SubmissionRow>(access,['agent_statement.submit'],`INSERT INTO shipit.agent_settlement_submissions(id,organization_id,franchise_id,capture_id,previous_submission_id,expected_version,actor_id,reason,correlation_id,key_digest,fingerprint)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}
 RETURNING id,capture_id,agent_id,day::text,revision,previous_submission_id,actor_id,reason,recorded_at,fingerprint`,[randomUUID(),c.permittedFranchiseIds[0],input.capture_id,input.previous_submission_id,input.expected_version,c.actor.id,input.reason,c.correlationId,k,fingerprint,c.organizationId])).rows[0]);
   if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return submitted(row);
  });
 },
 async decide(token:string,idInput:unknown,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
  const q=selection(query),id=uuid(idInput,'$'),b=object(body,['kind','expected_version','reason']);if(b.kind!=='approve'&&b.kind!=='reject')throw new FieldValidationError('kind','INVALID_FORMAT');
  const input={submission_id:id,kind:b.kind,expected_version:integer(b.expected_version,'expected_version',1,2147483647),reason:cashbookText(b.reason,500)},k=keyDigest(idempotencyKey(key,headers)),fingerprint=digest({operation:'decide_agent_statement',input});
  return withAgentStatementScope(database,token,q.organizationId,q.franchiseId,'agent_statement.decide',correlation,async({access})=>{
   const c=assertTenantAccess(access,['agent_statement.decide']),saved=(await scopedQuery<DecisionRow>(access,['agent_statement.decide'],`SELECT id,submission_id,kind,expected_version,actor_id,reason,recorded_at,fingerprint FROM shipit.agent_settlement_decisions WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,k])).rows[0];
   if(saved){if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return decision(saved);}
   if(!writesEnabled)throw new HttpError('AGENT_MONEY_DISABLED');const current=await readStatementDetail(access,id,'agent_statement.decide',false,false,false);
   if(current.actor_id===c.actor.id)throw new HttpError('ACTION_FORBIDDEN');if(current.revision!==input.expected_version||current.status==='superseded'||current.decision)throw new HttpError('VERSION_CONFLICT');
   const row=await write(async()=>(await scopedQuery<DecisionRow>(access,['agent_statement.decide'],`INSERT INTO shipit.agent_settlement_decisions(id,organization_id,franchise_id,submission_id,kind,expected_version,actor_id,reason,correlation_id,key_digest,fingerprint)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}
 RETURNING id,submission_id,kind,expected_version,actor_id,reason,recorded_at,fingerprint`,[randomUUID(),c.permittedFranchiseIds[0],id,input.kind,input.expected_version,c.actor.id,input.reason,c.correlationId,k,fingerprint,c.organizationId])).rows[0]);
   if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return decision(row);
  });
 },
 async read(token:string,idInput:unknown,query:unknown,correlation:string){const q=selection(query),id=uuid(idInput,'$');return withAgentStatementScope(database,token,q.organizationId,q.franchiseId,'agent_statement.read',correlation,({access,ownOnly,agentOnly,agent})=>readStatementDetail(access,id,'agent_statement.read',ownOnly,agentOnly,agent));},
 async list(token:string,query:unknown,correlation:string){
  const b=object(query,['organization_id','franchise_id','cursor']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id});let page:{after:string;cutoff:string;actor:string;organization:string;franchise:string}|null=null;
  if(b.cursor!==undefined){try{if(typeof b.cursor!=='string'||b.cursor.length>1024)throw new Error();const p=object(JSON.parse(Buffer.from(b.cursor,'base64url').toString('utf8')),['after','cutoff','actor','organization','franchise']);page={after:uuid(p.after,'cursor'),cutoff:new Date(timestamp(p.cutoff,'cursor')).toISOString(),actor:uuid(p.actor,'cursor'),organization:uuid(p.organization,'cursor'),franchise:uuid(p.franchise,'cursor')};}catch{throw new FieldValidationError('cursor','INVALID_FORMAT');}}
  const cursor=page;return withAgentStatementScope(database,token,q.organizationId,q.franchiseId,'agent_statement.read',correlation,async({access,ownOnly,agentOnly,agent})=>{
   const c=assertTenantAccess(access,['agent_statement.read']);if(cursor&&(cursor.actor!==c.actor.id||cursor.organization!==c.organizationId||cursor.franchise!==c.permittedFranchiseIds[0]))throw new FieldValidationError('cursor','INVALID_FORMAT');
   const databaseNow=(await scopedQuery<{at:Date}>(access,['agent_statement.read'],"SELECT date_trunc('milliseconds',statement_timestamp()) AS at FROM shipit.franchises f WHERE {{franchise:f.organization_id:f.id}}")).rows[0]!.at.toISOString();
   if(cursor&&Date.parse(cursor.cutoff)>Date.parse(databaseNow))throw new FieldValidationError('cursor','INVALID_FORMAT');
   const cutoff=cursor?.cutoff??databaseNow,rows=(await scopedQuery<SubmissionRow&{superseded:boolean;decision_kind:string|null}>(access,['agent_statement.read'],`SELECT s.id,s.capture_id,s.agent_id,s.day::text,s.revision,s.previous_submission_id,s.actor_id,s.reason,s.recorded_at,s.fingerprint,d.kind decision_kind,
 EXISTS(SELECT 1 FROM shipit.agent_settlement_submissions n WHERE n.organization_id=s.organization_id AND n.franchise_id=s.franchise_id AND n.agent_id=s.agent_id AND n.day=s.day AND n.revision>s.revision AND n.recorded_at<=$6::timestamptz) superseded
 FROM shipit.agent_settlement_submissions s LEFT JOIN shipit.agent_settlement_decisions d ON d.organization_id=s.organization_id AND d.franchise_id=s.franchise_id AND d.submission_id=s.id AND d.recorded_at<=$6::timestamptz
 WHERE {{franchise:s.organization_id:s.franchise_id}} AND ($1::uuid IS NULL OR s.id>$1) AND (NOT $2::boolean OR s.actor_id=$3 OR $5::boolean AND s.agent_id=$3) AND (NOT $4::boolean OR s.agent_id=$3) AND s.recorded_at<=$6::timestamptz ORDER BY s.id LIMIT 101`,[cursor?.after??null,ownOnly,c.actor.id,agentOnly,agent,cutoff])).rows;
   const visible=rows.slice(0,100);return {items:visible.map(r=>({...submitted(r),status:r.superseded?'superseded':r.decision_kind==='approve'?'approved':r.decision_kind?'rejected':'pending'})),as_of:cutoff,next_cursor:rows.length>100?Buffer.from(JSON.stringify({after:visible.at(-1)!.id,cutoff,actor:c.actor.id,organization:c.organizationId,franchise:c.permittedFranchiseIds[0]})).toString('base64url'):null};
  });
 }
};}
