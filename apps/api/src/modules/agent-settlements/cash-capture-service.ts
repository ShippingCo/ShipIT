import {randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import {HttpError} from '../../plugins/errors.ts';
import {withAgentStatementScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {object,selection,uuid,integer,timestamp,idempotencyKey} from '../pricing/validation.ts';
import {reportFilter} from '../reports/rules.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {cashbookText} from '../cashbook/request-service.ts';
import {dailyCashFrame} from './daily-cash.ts';
interface CaptureRow {id:string;agent_id:string;day:string;counted_at:Date;counted_paise:string;actor_id:string;reason:string;recorded_at:Date;source_snapshot:Record<string,unknown>;fingerprint:string}
const dto=(r:CaptureRow)=>({id:r.id,agent_id:r.agent_id,day:r.day,counted_at:r.counted_at.toISOString(),counted_paise:r.counted_paise,actor_id:r.actor_id,reason:r.reason,recorded_at:r.recorded_at.toISOString(),source_snapshot:r.source_snapshot});
async function validateTarget(scope:TenantAccess,id:string,admin:boolean,agentOnly:boolean){
 const c=assertTenantAccess(scope,['agent_statement.capture']);if(agentOnly&&id!==c.actor.id)throw new HttpError('RESOURCE_NOT_FOUND');
 const target=(await scopedQuery(scope,['agent_statement.capture'],`SELECT m.id FROM shipit.memberships m JOIN shipit.membership_franchise_scopes ms ON ms.organization_id=m.organization_id AND ms.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id WHERE {{franchise:m.organization_id:ms.franchise_id}} AND m.user_id=$1 AND m.role='delivery_agent' AND ($2::boolean OR m.lifecycle='active' AND u.lifecycle='active') LIMIT 1`,[id,admin])).rows[0];
 if(!target)throw new HttpError('RESOURCE_NOT_FOUND');
}
export function createAgentCashCaptureService(database:DatabasePool,writesEnabled=false){return {
 async capture(token:string,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
  const q=selection(query),b=object(body,['agent_id','day','counted_at','counted_paise','reason']),day=reportFilter({from_day:b.day,to_day:b.day}).from_day;
  const input={agent_id:uuid(b.agent_id,'$'),day,counted_at:timestamp(b.counted_at,'occurred_at'),counted_paise:integer(b.counted_paise,'amount_paise'),reason:cashbookText(b.reason,500)},k=keyDigest(idempotencyKey(key,headers)),fingerprint=digest({operation:'capture_agent_cash',input});
  return withAgentStatementScope(database,token,q.organizationId,q.franchiseId,'agent_statement.capture',correlation,async({access,admin,agentOnly})=>{
   const c=assertTenantAccess(access,['agent_statement.capture']);
   const saved=(await scopedQuery<CaptureRow>(access,['agent_statement.capture'],`SELECT id,agent_id,day::text,counted_at,counted_paise::text,actor_id,reason,recorded_at,source_snapshot,fingerprint FROM shipit.agent_daily_cash_captures WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,k])).rows[0];
   if(saved){if(agentOnly&&saved.agent_id!==c.actor.id)throw new HttpError('RESOURCE_NOT_FOUND');if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return dto(saved);}
   if(!writesEnabled)throw new HttpError('AGENT_MONEY_DISABLED');await validateTarget(access,input.agent_id,admin,agentOnly);
   await dailyCashFrame(access,input.agent_id,day,input.counted_at,BigInt(input.counted_paise));
   let row:CaptureRow|undefined;try {row=(await scopedQuery<CaptureRow>(access,['agent_statement.capture'],`INSERT INTO shipit.agent_daily_cash_captures(id,organization_id,franchise_id,agent_id,day,counted_at,counted_paise,actor_id,reason,correlation_id,key_digest,fingerprint)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11 WHERE {{franchise:$12:$2}}
 RETURNING id,agent_id,day::text,counted_at,counted_paise::text,actor_id,reason,recorded_at,source_snapshot,fingerprint`,[randomUUID(),c.permittedFranchiseIds[0],input.agent_id,day,input.counted_at,input.counted_paise,c.actor.id,input.reason,c.correlationId,k,fingerprint,c.organizationId])).rows[0];
   }catch(error){if(error instanceof DatabaseError&&error.sqlState==='54000')throw new HttpError('REPORT_LIMIT_EXCEEDED');throw error;}
   if(!row)throw new HttpError('TEMPORARILY_UNAVAILABLE');return dto(row);
  });
 },
 async read(token:string,idInput:unknown,query:unknown,correlation:string){
  const q=selection(query),id=uuid(idInput,'$');return withAgentStatementScope(database,token,q.organizationId,q.franchiseId,'agent_statement.read',correlation,async({access,ownOnly,agentOnly,agent})=>{
   const c=assertTenantAccess(access,['agent_statement.read']);const row=(await scopedQuery<CaptureRow>(access,['agent_statement.read'],`SELECT id,agent_id,day::text,counted_at,counted_paise::text,actor_id,reason,recorded_at,source_snapshot,fingerprint
 FROM shipit.agent_daily_cash_captures WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND (NOT $2::boolean OR actor_id=$3 OR $5::boolean AND agent_id=$3) AND (NOT $4::boolean OR agent_id=$3)`,[id,ownOnly,c.actor.id,agentOnly,agent])).rows[0];
   if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return dto(row);
  });
 }
};}
