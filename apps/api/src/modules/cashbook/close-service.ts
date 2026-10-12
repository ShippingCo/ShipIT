import {randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import type {CashCloseOperation,CashCloseHistoryDto,CashCloseCommandDto,CashCloseSessionDto,CashCloseDetail,CashCloseFrame,CashCloseDependencyDto,CashCloseCountDto} from '@shippingco/shared';
import {withCashCloseScope} from '../memberships/service.ts';
import {scopedQuery,assertTenantAccess,type TenantAccess} from '../security/scope.ts';
import {object,selection,uuid,idempotencyKey} from '../pricing/validation.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {closeInput} from './close-rules.ts';
const actions=['cashbook.close.read','cashbook.close.open','cashbook.close.count','cashbook.close.submit','cashbook.close.decide','cashbook.close.reopen','reports.capture'] as const;
/** Full ownership and own-drawer restriction are applied before any nested evidence lookup. */
export async function closeSession(scope:TenantAccess,id:string,ownOnly=false):Promise<CashCloseSessionDto>{
 const c=assertTenantAccess(scope,[...actions]);
 const row=(await scopedQuery<CashCloseSessionDto>(scope,[...actions],`SELECT s.id,s.location_id,s.location_revision_id,l.name location_name,l.account_id,s.custodian_id,s.sequence,s.day::text,s.predecessor_id,s.initial_opening,s.actor_id,shipit.cash_close_instant(s.recorded_at) recorded_at,s.version,s.state,
 cap.result->'count' count,sub.result->'submission' submission,s.accepted_submission_id,ac.result->'count' accepted_count,d.result->'decision' decision
 FROM shipit.cash_close_sessions s JOIN shipit.cash_location_revisions l ON l.organization_id=s.organization_id AND l.franchise_id=s.franchise_id AND l.id=s.location_revision_id
 LEFT JOIN shipit.cash_close_commands cap ON cap.organization_id=s.organization_id AND cap.franchise_id=s.franchise_id AND cap.session_id=s.id AND cap.id=s.count_id
 LEFT JOIN shipit.cash_close_commands sub ON sub.organization_id=s.organization_id AND sub.franchise_id=s.franchise_id AND sub.session_id=s.id AND sub.id=s.submission_id
 LEFT JOIN shipit.cash_close_commands a ON a.organization_id=s.organization_id AND a.franchise_id=s.franchise_id AND a.session_id=s.id AND a.id=s.accepted_submission_id
 LEFT JOIN shipit.cash_close_commands ac ON ac.organization_id=s.organization_id AND ac.franchise_id=s.franchise_id AND ac.session_id=s.id AND ac.id=a.count_id
 LEFT JOIN LATERAL(SELECT result FROM shipit.cash_close_commands x WHERE x.organization_id=s.organization_id AND x.franchise_id=s.franchise_id AND x.session_id=s.id AND x.submission_id=s.submission_id AND x.operation='decide' ORDER BY version DESC LIMIT 1) d ON true
 WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.id=$1 AND (NOT $2::boolean OR s.custodian_id=$3)`,[id,ownOnly,c.actor.id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function closeCapture(scope:TenantAccess,session:string,id:string){
 const row=(await scopedQuery<{count:CashCloseCountDto;source_frame:CashCloseFrame}>(scope,[...actions],`SELECT result->'count' count,source_frame FROM shipit.cash_close_commands WHERE {{franchise:organization_id:franchise_id}} AND session_id=$1 AND id=$2 AND operation='count'`,[session,id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
function controls(frame:CashCloseFrame){return {schema_version:frame.schema_version,location_id:frame.location_id,opening_at:frame.opening_at,counted_at:frame.counted_at,as_of:frame.as_of,inflow_paise:frame.inflow_paise,outflow_paise:frame.outflow_paise,known_position_paise:frame.known_position_paise,unknown_sources:frame.unknown_sources,coverage:frame.coverage,source_count:frame.source_count};}
function cursor(value:unknown){if(value===undefined)return null;try{if(typeof value!=='string'||value.length>1024)throw new Error();return object(JSON.parse(Buffer.from(value,'base64url').toString('utf8')),['actor','organization','franchise','resource','after']);}catch{throw new FieldValidationError('cursor','INVALID_FORMAT');}}
function pageContext(scope:TenantAccess,value:ReturnType<typeof cursor>,resource:string){const c=assertTenantAccess(scope,[...actions]);if(value&&(value.actor!==c.actor.id||value.organization!==c.organizationId||value.franchise!==c.permittedFranchiseIds[0]||value.resource!==resource))throw new FieldValidationError('cursor','INVALID_FORMAT');return (after:string|number)=>Buffer.from(JSON.stringify({actor:c.actor.id,organization:c.organizationId,franchise:c.permittedFranchiseIds[0],resource,after})).toString('base64url');}
export function createCashCloseService(database:DatabasePool,writesEnabled=false){return {
 async command(token:string,operation:CashCloseOperation,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string){
  const q=selection(query),id=operation==='open'?null:uuid(idInput,'$'),input=closeInput(operation,body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation:'cash_close.v1.'+operation,id,input});
  return withCashCloseScope(database,token,q.organizationId,q.franchiseId,`cashbook.close.${operation}`,correlation,async({access,ownOnly})=>{
   const c=assertTenantAccess(access,[...actions]);
   if(id)await closeSession(access,id,ownOnly);
   const saved=(await scopedQuery<{result:CashCloseCommandDto;fingerprint:string}>(access,[...actions],`SELECT result,fingerprint FROM shipit.cash_close_commands WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
   if(saved){if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');await closeSession(access,saved.result.session_id,ownOnly);return saved.result;}
   if(!writesEnabled)throw new HttpError('CASH_CLOSE_DISABLED');
   if(operation==='open'&&'location_id' in input){
    const location=(await scopedQuery(access,[...actions],`SELECT id FROM shipit.cash_locations WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND kind='cash' AND (NOT $2::boolean OR custodian_id=$3)`,[input.location_id,ownOnly,c.actor.id])).rows[0];if(!location)throw new HttpError('RESOURCE_NOT_FOUND');
    if(input.predecessor_id)await closeSession(access,input.predecessor_id,ownOnly);
   }
   if(id&&'count_id' in input)await closeCapture(access,id,input.count_id);
   if(id&&'submission_id' in input){const sub=(await scopedQuery(access,[...actions],`SELECT id FROM shipit.cash_close_commands WHERE {{franchise:organization_id:franchise_id}} AND session_id=$1 AND id=$2 AND operation='submit'`,[id,input.submission_id])).rows[0];if(!sub)throw new HttpError('RESOURCE_NOT_FOUND');}
   try{
    const row=(await scopedQuery<{result:CashCloseCommandDto}>(access,[...actions],`INSERT INTO shipit.cash_close_commands(id,organization_id,franchise_id,session_id,actor_id,operation,expected_version,input,correlation_id,key_digest,fingerprint)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}} RETURNING result`,[randomUUID(),c.permittedFranchiseIds[0],id??randomUUID(),c.actor.id,operation,input.expected_version,input,c.correlationId,key,fingerprint,c.organizationId])).rows[0];
    if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return row.result;
   }catch(error){
    if(error instanceof DatabaseError){if(error.sqlState==='40001'||error.sqlState==='23505')throw new HttpError('VERSION_CONFLICT');if(error.sqlState==='P0145')throw new HttpError('CASH_CLOSE_SOURCE_CHANGED');if(error.sqlState==='P0146')throw new HttpError('CASH_CLOSE_OPENING_CHANGED');if(error.sqlState==='P0147')throw new HttpError('CASH_CLOSE_REVIEW_REQUIRED');if(error.sqlState==='54000')throw new HttpError('CASH_CLOSE_LIMIT_EXCEEDED');if(error.sqlState==='42501')throw new HttpError('RESOURCE_NOT_FOUND');if(error.sqlState==='23514')throw new FieldValidationError('$','INVALID_FORMAT');}throw error;
   }
  });
 },
 async read(token:string,idInput:unknown,query:unknown,correlation:string):Promise<CashCloseDetail>{
  const q=selection(query),id=uuid(idInput,'$');return withCashCloseScope(database,token,q.organizationId,q.franchiseId,'cashbook.close.read',correlation,async({access,ownOnly,admin})=>{
   const s=await closeSession(access,id,ownOnly),c=assertTenantAccess(access,['cashbook.close.read']);
   const eligible=(await scopedQuery<{n:number}>(access,['cashbook.close.read'],`SELECT count(DISTINCT m.user_id)::int n FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE {{franchise:m.organization_id:ms.franchise_id}} AND m.lifecycle='active' AND m.role='franchise_admin'`,[])).rows[0]!.n;
   const observerActive=!s.initial_opening||!!s.accepted_submission_id||s.actor_id===c.actor.id?true:(await scopedQuery(access,['cashbook.close.read'],`SELECT m.id FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE {{franchise:m.organization_id:ms.franchise_id}} AND m.user_id=$1 AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') LIMIT 1`,[s.actor_id])).rows.length>0;
   const localRecorder=admin||s.custodian_id===c.actor.id&&(await scopedQuery(access,['cashbook.close.read'],`SELECT m.id FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id WHERE {{franchise:m.organization_id:ms.franchise_id}} AND m.user_id=$1 AND m.lifecycle='active' AND m.role='operator' LIMIT 1`,[c.actor.id])).rows.length>0;
   const canCapture=localRecorder&&['open','rejected'].includes(s.state)&&(!s.initial_opening||!!s.accepted_submission_id||s.actor_id===c.actor.id||admin&&!observerActive);
   const selfReview=s.submission?.actor_id===c.actor.id||s.count?.actor_id===c.actor.id||!s.accepted_submission_id&&s.initial_opening?.actor_id===c.actor.id;
   const current=s.count??s.accepted_count;
   const observation=current?(await scopedQuery<{frame:CashCloseFrame;source_changed:boolean;opening_changed:boolean}>(access,['cashbook.close.read'],`SELECT fresh.frame,shipit.cash_close_source_identity(fresh.frame) IS DISTINCT FROM shipit.cash_close_source_identity(cap.source_frame) source_changed,
    cap.opening_submission_id IS DISTINCT FROM p.accepted_submission_id opening_changed
    FROM shipit.cash_close_commands cap JOIN shipit.cash_close_sessions s ON s.organization_id=cap.organization_id AND s.franchise_id=cap.franchise_id AND s.id=cap.session_id
    LEFT JOIN shipit.cash_close_sessions p ON p.organization_id=s.organization_id AND p.franchise_id=s.franchise_id AND p.id=s.predecessor_id
    CROSS JOIN LATERAL(SELECT shipit.cash_close_source_frame(s.organization_id,s.franchise_id,s.location_id,(cap.result->'count'->'opening'->>'opening_at')::timestamptz,(cap.result->'count'->>'counted_at')::timestamptz) frame) fresh
    WHERE {{franchise:cap.organization_id:cap.franchise_id}} AND cap.session_id=$1 AND cap.id=$2`,[id,current.id])).rows[0]:null;
   const deps=(await scopedQuery<CashCloseDependencyDto>(access,['cashbook.close.read'],`SELECT id,session_id,old_submission_id,new_submission_id,carry_changed,shipit.cash_close_instant(recorded_at) recorded_at FROM shipit.cash_close_dependencies WHERE {{franchise:organization_id:franchise_id}} AND location_id=$1 AND sequence<$2 ORDER BY sequence DESC,recorded_at DESC,id LIMIT 101`,[s.location_id,s.sequence])).rows;
   const disputes=(await scopedQuery<CashCloseDetail['prior_disputes'][number]>(access,['cashbook.close.read'],`SELECT s.id session_id,a.id submission_id,cap.result->'count'->>'counted_at' counted_at,cap.result->'count'->>'variance_paise' variance_paise FROM shipit.cash_close_sessions s JOIN shipit.cash_close_commands a ON a.organization_id=s.organization_id AND a.franchise_id=s.franchise_id AND a.session_id=s.id AND a.id=s.accepted_submission_id JOIN shipit.cash_close_commands cap ON cap.organization_id=s.organization_id AND cap.franchise_id=s.franchise_id AND cap.session_id=s.id AND cap.id=a.count_id WHERE {{franchise:s.organization_id:s.franchise_id}} AND s.location_id=$1 AND s.sequence<$2 AND (cap.result->'count'->>'variance_paise')::numeric<>0 ORDER BY s.sequence DESC LIMIT 101`,[s.location_id,s.sequence])).rows;
   return {session:s,can_capture:canCapture,source_changed:observation?.source_changed??false,opening_changed:observation?.opening_changed??false,current_controls:observation?controls(observation.frame):null,review:{admin,eligible_admins:admin?eligible:0,mode:!admin||!s.submission?null:!selfReview?'independent':eligible===1?'sole_admin_self':'different_admin_required'},dependencies:deps.slice(0,100),dependencies_more:deps.length>100,prior_disputes:disputes.slice(0,100),prior_disputes_more:disputes.length>100};
  });
 },
 async eligibility(token:string,idInput:unknown,query:unknown,correlation:string){
  const q=selection(query),id=uuid(idInput,'$');return withCashCloseScope(database,token,q.organizationId,q.franchiseId,'cashbook.close.read',correlation,async({access,ownOnly})=>{
   const c=assertTenantAccess(access,['cashbook.close.read']),row=(await scopedQuery<{location_id:string;latest_session_id:string|null;state:CashCloseSessionDto['state']|null;accepted_submission_id:string|null;opening:CashCloseCountDto|null}>(access,['cashbook.close.read'],`SELECT l.id location_id,s.id latest_session_id,s.state,s.accepted_submission_id,cap.result->'count' opening FROM shipit.cash_locations l
    LEFT JOIN LATERAL(SELECT * FROM shipit.cash_close_sessions x WHERE x.organization_id=l.organization_id AND x.franchise_id=l.franchise_id AND x.location_id=l.id ORDER BY sequence DESC LIMIT 1) s ON true
    LEFT JOIN shipit.cash_close_commands sub ON sub.organization_id=s.organization_id AND sub.franchise_id=s.franchise_id AND sub.id=s.accepted_submission_id
    LEFT JOIN shipit.cash_close_commands cap ON cap.organization_id=s.organization_id AND cap.franchise_id=s.franchise_id AND cap.id=sub.count_id
    WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.id=$1 AND l.kind='cash' AND (NOT $2::boolean OR l.custodian_id=$3)`,[id,ownOnly,c.actor.id])).rows[0];if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
  });
 },
 async list(token:string,query:unknown,correlation:string){
  const b=object(query,['organization_id','franchise_id','cursor','location_id']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),page=cursor(b.cursor),location=b.location_id===undefined?null:uuid(b.location_id,'$');
  return withCashCloseScope(database,token,q.organizationId,q.franchiseId,'cashbook.close.read',correlation,async({access,ownOnly})=>{
   const c=assertTenantAccess(access,['cashbook.close.read']),next=pageContext(access,page,'sessions:'+location),after=page?uuid(page.after,'cursor'):null;
   const rows=(await scopedQuery<{id:string;location_id:string;location_name:string;day:string;sequence:number;version:number;state:CashCloseSessionDto['state'];accepted_submission_id:string|null}>(access,['cashbook.close.read'],`SELECT s.id,s.location_id,r.name location_name,s.day::text,s.sequence,s.version,s.state,s.accepted_submission_id FROM shipit.cash_close_sessions s JOIN shipit.cash_location_revisions r ON r.organization_id=s.organization_id AND r.franchise_id=s.franchise_id AND r.id=s.location_revision_id WHERE {{franchise:s.organization_id:s.franchise_id}} AND (NOT $1::boolean OR s.custodian_id=$2) AND ($3::uuid IS NULL OR s.id>$3) AND ($4::uuid IS NULL OR s.location_id=$4) ORDER BY s.id LIMIT 101`,[ownOnly,c.actor.id,after,location])).rows;
   return {items:rows.slice(0,100),next_cursor:rows.length>100?next(rows[99]!.id):null};
  });
 },
 async evidence(token:string,idInput:unknown,query:unknown,correlation:string,history=false){
  const b=object(query,['organization_id','franchise_id','capture_id','cursor']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$'),capture=history?null:uuid(b.capture_id,'$'),page=cursor(b.cursor);
  return withCashCloseScope(database,token,q.organizationId,q.franchiseId,'cashbook.close.read',correlation,async({access,ownOnly})=>{
   await closeSession(access,id,ownOnly);const next=pageContext(access,page,(history?'history:':'sources:')+id+':'+capture),after=page?.after??0;
   if(typeof after!=='number'||!Number.isInteger(after)||after<0||after>2147483646)throw new FieldValidationError('cursor','INVALID_FORMAT');
   if(history){const rows=(await scopedQuery<{result:CashCloseHistoryDto}>(access,['cashbook.close.read'],`SELECT result||jsonb_build_object('actor_id',actor_id,'reason',input->>'reason') result FROM shipit.cash_close_commands WHERE {{franchise:organization_id:franchise_id}} AND session_id=$1 AND version>$2 ORDER BY version LIMIT 101`,[id,after])).rows.map(r=>r.result);return {items:rows.slice(0,100),next_cursor:rows.length>100?next(rows[99]!.version):null};}
   const saved=await closeCapture(access,id,capture!),items=[...saved.source_frame.rows.map(row=>({kind:'source' as const,source:row})),...saved.source_frame.pending_handovers.map(row=>({kind:'pending_handover' as const,handover:row}))];
   if(after>items.length||after%100!==0)throw new FieldValidationError('cursor','INVALID_FORMAT');
   return {capture_id:capture,controls:controls(saved.source_frame),items:items.slice(after,after+100),next_cursor:after+100<items.length?next(after+100):null};
  });
 }
};}
