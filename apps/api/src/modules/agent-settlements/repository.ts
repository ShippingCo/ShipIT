import {HttpError} from '../../plugins/errors.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {agentMoneyActions,type AgentMoneyCommandDto,type BeneficiaryRow,type CodRow} from './types.ts';
const actions=[...agentMoneyActions];
export async function replay(scope:TenantAccess,operation:string,key:string,fingerprint:string){
 const c=assertTenantAccess(scope,actions),row=(await scopedQuery<{fingerprint:string;result:AgentMoneyCommandDto}>(scope,[...actions],`SELECT fingerprint,result FROM shipit.agent_money_commands
 WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND operation=$2 AND key_digest=$3`,[c.actor.id,operation,key])).rows[0];
 if(!row)return null;if(row.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return structuredClone(row.result);
}
export async function finish(scope:TenantAccess,operation:string,key:string,fingerprint:string,input:unknown,command:string,resource:string):Promise<AgentMoneyCommandDto>{
 const c=assertTenantAccess(scope,actions),time=(await scopedQuery<{time:string}>(scope,[...actions],`SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') time WHERE {{franchise:$1:$2}}`,[c.organizationId,c.permittedFranchiseIds[0]])).rows[0];
 if(!time)throw new HttpError('TEMPORARILY_UNAVAILABLE');const result={command_id:command,resource_id:resource,recorded_at:time.time};
 await scopedQuery(scope,[...actions],`INSERT INTO shipit.agent_money_commands(id,organization_id,franchise_id,actor_id,operation,correlation_id,key_digest,fingerprint,input,result)
 SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,[command,c.permittedFranchiseIds[0],c.actor.id,operation,c.correlationId,key,fingerprint,input,result,c.organizationId]);return result;
}
export async function beneficiary(scope:TenantAccess,id:string):Promise<BeneficiaryRow>{
 const row=(await scopedQuery<BeneficiaryRow>(scope,[...actions],`SELECT * FROM shipit.cod_beneficiary_revisions WHERE {{franchise:organization_id:franchise_id}} AND beneficiary_id=$1 ORDER BY version DESC LIMIT 1`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
export async function cod(scope:TenantAccess,id:string):Promise<CodRow>{
 const row=(await scopedQuery<CodRow>(scope,[...actions],`SELECT r.*,o.booking_id,o.parcel_id,
 COALESCE((SELECT sum(a.reserved_paise)::text FROM shipit.cod_receipt_positions a WHERE a.organization_id=o.organization_id AND a.franchise_id=o.franchise_id AND a.obligation_id=o.id),'0') collected_paise
 FROM shipit.cod_obligations o JOIN LATERAL(SELECT * FROM shipit.cod_obligation_revisions r WHERE r.organization_id=o.organization_id AND r.franchise_id=o.franchise_id AND r.obligation_id=o.id ORDER BY version DESC LIMIT 1) r ON true
 WHERE {{franchise:o.organization_id:o.franchise_id}} AND o.id=$1 FOR UPDATE OF o`,[id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');return row;
}
