import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import type {CashbookApplyInput,CashbookEffectDto,CashbookPositionSnapshot} from '@shippingco/shared';
import {withCashbookScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {object,selection,uuid,integer,idempotencyKey} from '../pricing/validation.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {instant} from '../pricing/types.ts';
import {HttpError} from '../../plugins/errors.ts';
import {movementLegs,maximumPaise} from './rules.ts';
import {lock,requestRow,requestDto,validateSources} from './request-service.ts';
interface EffectRow {id:string;request_id:string;decision_id:string;actor_id:string;recorded_at:Date;fingerprint:string}
export function cashbookApplyInput(value:unknown):CashbookApplyInput {
 const b=object(value,['expected_version','decision_id']);integer(b.expected_version,'expected_version',2,2);return {expected_version:2,decision_id:uuid(b.decision_id,'$')};
}
async function effectDto(scope:TenantAccess,r:EffectRow):Promise<CashbookEffectDto> {
 const legs=(await scopedQuery<{location_id:string;direction:'in'|'out';amount_paise:string}>(scope,['cashbook.apply'],`SELECT location_id,direction,amount_paise::text FROM shipit.cashbook_effect_legs WHERE {{franchise:organization_id:franchise_id}} AND effect_id=$1 ORDER BY location_id`,[r.id])).rows;
 return {id:r.id,request_id:r.request_id,decision_id:r.decision_id,actor_id:r.actor_id,recorded_at:instant(r.recorded_at),version:3,legs};
}
/** Each row and control total is read at the same statement MVCC cutoff. Private payees/references are absent. */
export async function captureCashbookPosition(scope:TenantAccess):Promise<CashbookPositionSnapshot> {
 const result=(await scopedQuery<{as_of:Date;source_version:string;unknown_sources:number;locations:{location_id:string;inflows:string;outflows:string;recorded:string;unknown_sources:number;unresolved_refunds:number}[]}>(scope,['cashbook.read','cashbook.apply'],`SELECT result.* FROM LATERAL (WITH locations AS (
 SELECT l.* FROM shipit.cash_locations l WHERE {{franchise:l.organization_id:l.franchise_id}}
 ),facts AS (SELECT f.* FROM shipit.cashbook_source_facts f WHERE {{franchise:f.organization_id:f.franchise_id}}),positions AS (
 SELECT l.id location_id,COALESCE(sum(f.amount_paise::numeric) FILTER(WHERE f.direction='in'),0)::text inflows,COALESCE(sum(f.amount_paise::numeric) FILTER(WHERE f.direction='out'),0)::text outflows,
 COALESCE(sum(CASE WHEN f.direction='in' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END),0)::text recorded,
 (SELECT count(*)::int FROM facts u WHERE u.location_id IS NULL AND (u.account_id IS NULL OR u.account_id=l.account_id)) unknown_sources,
 (SELECT count(*)::int FROM facts u WHERE u.location_id IS NULL AND u.source_kind IN ('refund','refund_correction') AND (u.account_id IS NULL OR u.account_id=l.account_id)) unresolved_refunds
 FROM locations l LEFT JOIN facts f ON f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND f.location_id=l.id GROUP BY l.id,l.account_id)
 SELECT statement_timestamp() as_of,COALESCE((SELECT version::text FROM shipit.cashbook_source_versions v WHERE {{franchise:v.organization_id:v.franchise_id}}),'0') source_version,
 (SELECT count(*)::int FROM facts WHERE location_id IS NULL) unknown_sources,COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.location_id) FROM positions p),'[]'::jsonb) locations) result`)).rows[0]!;
 return {as_of:instant(result.as_of),source_version:Number(result.source_version),unknown_sources:result.unknown_sources,locations:result.locations.map(p=>{
  const recorded=BigInt(p.recorded);if(recorded>maximumPaise||recorded< -maximumPaise)throw new HttpError('CASHBOOK_CONFLICT');
  return {location_id:p.location_id,known_inflows_paise:p.inflows,known_outflows_paise:p.outflows,known_recorded_paise:p.recorded,available_paise:recorded>0n&&p.unresolved_refunds===0?p.recorded:'0',unknown_sources:p.unknown_sources,state:recorded<0n?'exception':p.unknown_sources?'incomplete':'recorded'};
 })};
}
export function createCashbookEffectService(database:DatabasePool,writesEnabled=false) {
 return {
  async position(token:string,query:unknown,correlation:string) {
   const q=selection(query);return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.read',correlation,s=>captureCashbookPosition(s.access));
  },
  async apply(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$'),input=cashbookApplyInput(body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation:'cashbook.request.apply',id,input});
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.apply',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,['cashbook.apply']);await lock(scope);const request=await requestRow(scope,id);
    const saved=(await scopedQuery<EffectRow>(scope,['cashbook.apply'],`SELECT * FROM shipit.cashbook_effects WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
    if(saved){if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return effectDto(scope,saved);}if(!writesEnabled)throw new HttpError('CASHBOOK_DISABLED');
    const decision=(await scopedQuery<{id:string;decision:string;actor_id:string}>(scope,['cashbook.apply'],`SELECT id,decision,actor_id FROM shipit.cashbook_request_decisions WHERE {{franchise:organization_id:franchise_id}} AND request_id=$1`,[id])).rows[0];
    if(!decision||decision.id!==input.decision_id||decision.decision!=='approved'||decision.actor_id===request.actor_id)throw new HttpError('CASHBOOK_APPROVAL_REQUIRED');
    if((await scopedQuery(scope,['cashbook.apply'],`SELECT id FROM shipit.cashbook_effects WHERE {{franchise:organization_id:franchise_id}} AND request_id=$1`,[id])).rows[0])throw new HttpError('VERSION_CONFLICT');
    const proposal=requestDto(request);await validateSources(scope,proposal);
    const positions=await captureCashbookPosition(scope),source=positions.locations.find(p=>p.location_id===request.source_location_id),target=positions.locations.find(p=>p.location_id===request.target_location_id);
    if(!source)throw new HttpError('RESOURCE_NOT_FOUND');
    const amount=BigInt(request.amount_paise),legs=movementLegs(request.kind,amount,request.source_location_id,request.target_location_id,BigInt(source.available_paise));
    if(['opening_float','owner_funds'].includes(request.kind)&&BigInt(source.known_recorded_paise)+amount>maximumPaise||target&&BigInt(target.known_recorded_paise)+amount>maximumPaise)throw new HttpError('CASHBOOK_CONFLICT');
    const effect=randomUUID();await scopedQuery(scope,['cashbook.apply'],`INSERT INTO shipit.cashbook_effects(id,organization_id,franchise_id,request_id,decision_id,actor_id,correlation_id,key_digest,fingerprint)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}`,[effect,c.permittedFranchiseIds[0],id,decision.id,c.actor.id,c.correlationId,key,fingerprint,c.organizationId]);
    for(const leg of legs)await scopedQuery(scope,['cashbook.apply'],`INSERT INTO shipit.cashbook_effect_legs(organization_id,franchise_id,effect_id,location_id,direction,amount_paise)
     SELECT {{organization}},$1,$2,$3,$4,$5 WHERE {{franchise:$6:$1}}`,[c.permittedFranchiseIds[0],effect,leg.location_id,leg.direction,leg.amount_paise.toString(),c.organizationId]);
    return effectDto(scope,(await scopedQuery<EffectRow>(scope,['cashbook.apply'],`SELECT * FROM shipit.cashbook_effects WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[effect])).rows[0]!);
   });
  }
 };
}
