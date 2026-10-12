import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {withAgentMoneyScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery} from '../security/scope.ts';
import {selection,uuid,integer,object,idempotencyKey,timestamp} from '../pricing/validation.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {agentMoneyActions} from './types.ts';
import * as repo from './repository.ts';
const actions=[...agentMoneyActions];
interface Term {basis:'per_delivery'|'agreed_period';id:string;agent_id:string;version:number;amount_paise:string;active:boolean;valid_from:Date;valid_until:Date}
const intent=(operation:string,input:unknown,key:unknown,headers:readonly string[])=>({key:keyDigest(idempotencyKey(key,headers)),fingerprint:digest({operation,input})});
/** A proof earning records entitlement only. Expenses, advances and payments are separate. */
export function createAgentFeeService(database:DatabasePool,writesEnabled=false){
 return {
  async configure(token:string,agentInput:unknown,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),agent=uuid(agentInput,'$'),b=object(body,['expected_version','basis','amount_paise','currency','valid_from','valid_until','active']);
   if(!['per_delivery','agreed_period'].includes(b.basis as string)||b.currency!=='INR')throw new FieldValidationError('$','INVALID_FORMAT');
   if(typeof b.active!=='boolean')throw new FieldValidationError('$','INVALID_TYPE');
   const input={agent_id:agent,expected_version:integer(b.expected_version,'expected_version',0,2147483645),basis:b.basis as 'per_delivery'|'agreed_period',amount_paise:integer(b.amount_paise,'amount_paise',1),currency:'INR',
    valid_from:new Date(timestamp(b.valid_from,'$')).toISOString(),valid_until:new Date(timestamp(b.valid_until,'$')).toISOString(),active:b.active};
   if(Date.parse(input.valid_from)>=Date.parse(input.valid_until))throw new FieldValidationError('$','OUT_OF_RANGE');
   const i=intent('configure_fee_terms',input,key,headers);
   return withAgentMoneyScope(database,token,q.organizationId,q.franchiseId,'agent_money.configure',correlation,async scope=>{
    const saved=await repo.replay(scope,'configure_fee_terms',i.key,i.fingerprint);if(saved)return saved;
    if(!writesEnabled)throw new HttpError('AGENT_MONEY_DISABLED');const c=assertTenantAccess(scope,actions);
    const source=(await scopedQuery(scope,[...actions],`SELECT u.id FROM shipit.auth_users u JOIN shipit.memberships m ON m.user_id=u.id AND m.organization_id={{organization}} AND m.role='delivery_agent' AND m.lifecycle='active'
     JOIN shipit.membership_franchise_scopes mf ON mf.membership_id=m.id AND mf.organization_id=m.organization_id
     WHERE {{franchise:mf.organization_id:mf.franchise_id}} AND u.id=$1 AND u.lifecycle='active' LIMIT 1`,[agent])).rows[0];
    if(!source)throw new HttpError('RESOURCE_NOT_FOUND');
    const before=(await scopedQuery<Term>(scope,[...actions],`SELECT * FROM shipit.agent_fee_term_revisions WHERE {{franchise:organization_id:franchise_id}} AND agent_id=$1 ORDER BY version DESC LIMIT 1`,[agent])).rows[0];
    if((before?.version??0)!==input.expected_version)throw new HttpError('VERSION_CONFLICT');
    const id=randomUUID(),command=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.agent_fee_term_revisions(id,organization_id,franchise_id,agent_id,version,basis,amount_paise,currency,valid_from,valid_until,active,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$11,$5,'INR',$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,[id,c.permittedFranchiseIds[0],agent,input.expected_version+1,input.amount_paise,input.valid_from,input.valid_until,input.active,command,c.organizationId,input.basis]);
    return repo.finish(scope,'configure_fee_terms',i.key,i.fingerprint,input,command,id);
   });
  },
  async earn(token:string,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),b=object(body,['proof_id','term_revision_id']),input={proof_id:uuid(b.proof_id,'$'),term_revision_id:uuid(b.term_revision_id,'$')},i=intent('earn_delivery_fee',input,key,headers);
   return withAgentMoneyScope(database,token,q.organizationId,q.franchiseId,'agent_money.configure',correlation,async scope=>{
    const saved=await repo.replay(scope,'earn_delivery_fee',i.key,i.fingerprint);if(saved)return saved;
    if(!writesEnabled)throw new HttpError('AGENT_MONEY_DISABLED');const c=assertTenantAccess(scope,actions);
    const proof=(await scopedQuery<{parcel_id:string;completed_by:string;completed_at:Date}>(scope,[...actions],`SELECT p.parcel_id,p.completed_by,p.completed_at FROM shipit.delivery_proofs p
     JOIN shipit.delivery_attempts a ON a.organization_id=p.organization_id AND a.franchise_id=p.franchise_id AND a.id=p.attempt_id AND a.agent_id=p.completed_by AND a.state='completed'
     WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1`,[input.proof_id])).rows[0];
    if(!proof)throw new HttpError('RESOURCE_NOT_FOUND');
    const term=(await scopedQuery<Term>(scope,[...actions],`SELECT * FROM shipit.agent_fee_term_revisions WHERE {{franchise:organization_id:franchise_id}} AND agent_id=$1 ORDER BY version DESC LIMIT 1`,[proof.completed_by])).rows[0];
    if(!term||term.basis!=='per_delivery'||term.id!==input.term_revision_id||!term.active)throw new HttpError('VERSION_CONFLICT');
    if(proof.completed_at<term.valid_from||proof.completed_at>=term.valid_until)throw new HttpError('CASHBOOK_CONFLICT');
    if((await scopedQuery(scope,[...actions],`SELECT id FROM shipit.agent_fee_earnings WHERE {{franchise:organization_id:franchise_id}} AND proof_id=$1`,[input.proof_id])).rows.length)throw new HttpError('CASHBOOK_CONFLICT');
    if((await scopedQuery(scope,[...actions],`SELECT id FROM shipit.agent_fee_earnings WHERE {{franchise:organization_id:franchise_id}} AND agent_id=$1 AND basis='agreed_period' AND covered_from<=$2::timestamptz AND $2::timestamptz<covered_until`,[proof.completed_by,proof.completed_at])).rows.length)throw new HttpError('CASHBOOK_CONFLICT');
    const id=randomUUID(),command=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.agent_fee_earnings(id,organization_id,franchise_id,agent_id,term_revision_id,proof_id,parcel_id,amount_paise,currency,command_id)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,'INR',$8 WHERE {{franchise:$9:$2}}`,[id,c.permittedFranchiseIds[0],proof.completed_by,term.id,input.proof_id,proof.parcel_id,term.amount_paise,command,c.organizationId]);
    return repo.finish(scope,'earn_delivery_fee',i.key,i.fingerprint,input,command,id);
   });
  },
  async earnAgreed(token:string,query:unknown,key:unknown,headers:readonly string[],body:unknown,correlation:string){
   const q=selection(query),b=object(body,['term_revision_id']),input={term_revision_id:uuid(b.term_revision_id,'$')},i=intent('earn_agreed_fee',input,key,headers);
   return withAgentMoneyScope(database,token,q.organizationId,q.franchiseId,'agent_money.configure',correlation,async scope=>{
    const saved=await repo.replay(scope,'earn_agreed_fee',i.key,i.fingerprint);if(saved)return saved;
    if(!writesEnabled)throw new HttpError('AGENT_MONEY_DISABLED');const c=assertTenantAccess(scope,actions);
    const term=(await scopedQuery<Term>(scope,[...actions],`SELECT t.* FROM shipit.agent_fee_term_revisions t
     WHERE {{franchise:t.organization_id:t.franchise_id}} AND t.id=$1`,[input.term_revision_id])).rows[0];
    if(!term)throw new HttpError('RESOURCE_NOT_FOUND');
    const current=(await scopedQuery<{id:string}>(scope,[...actions],`SELECT id FROM shipit.agent_fee_term_revisions WHERE {{franchise:organization_id:franchise_id}} AND agent_id=$1 ORDER BY version DESC LIMIT 1`,[term.agent_id])).rows[0];
    if(!term.active||term.basis!=='agreed_period'||current?.id!==term.id)throw new HttpError('VERSION_CONFLICT');
    if((await scopedQuery(scope,[...actions],`SELECT e.id FROM shipit.agent_fee_earnings e LEFT JOIN shipit.delivery_proofs p ON p.organization_id=e.organization_id AND p.franchise_id=e.franchise_id AND p.id=e.proof_id
     WHERE {{franchise:e.organization_id:e.franchise_id}} AND e.agent_id=$1 AND ((e.basis='agreed_period' AND e.covered_from<$3::timestamptz AND $2::timestamptz<e.covered_until) OR (e.basis='per_delivery' AND p.completed_at>=$2::timestamptz AND p.completed_at<$3::timestamptz))`,[term.agent_id,term.valid_from,term.valid_until])).rows.length)throw new HttpError('CASHBOOK_CONFLICT');
    const id=randomUUID(),command=randomUUID();
    await scopedQuery(scope,[...actions],`INSERT INTO shipit.agent_fee_earnings(id,organization_id,franchise_id,agent_id,term_revision_id,basis,covered_from,covered_until,amount_paise,currency,command_id)
     SELECT $1,{{organization}},$2,$3,$4,'agreed_period',$5,$6,$7,'INR',$8 WHERE {{franchise:$9:$2}}`,[id,c.permittedFranchiseIds[0],term.agent_id,term.id,term.valid_from,term.valid_until,term.amount_paise,command,c.organizationId]);
    return repo.finish(scope,'earn_agreed_fee',i.key,i.fingerprint,input,command,id);
   });
  }
 };
}
