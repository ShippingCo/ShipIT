import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import type {CashbookRequestInput,CashbookRequestDto,CashbookDecisionInput,CashbookDecisionDto,CashMovementKind,ExpenseCategory} from '@shippingco/shared';
import {withCashbookScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {object,selection,uuid,integer,idempotencyKey,timestamp} from '../pricing/validation.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {instant} from '../pricing/types.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
const actions=['cashbook.request','cashbook.approve','cashbook.select'] as const;
interface RequestRow extends Omit<CashbookRequestDto,'amount_paise'|'expected_source_version'|'occurred_at'|'recorded_at'> {amount_paise:string;expected_source_version:string;occurred_at:Date;recorded_at:Date;fingerprint:string}
interface DecisionRow extends Omit<CashbookDecisionDto,'version'|'recorded_at'> {recorded_at:Date;fingerprint:string}
interface Source {id:string;revision_id:string;kind:'cash'|'noncash';custodian_id:string|null;active:boolean;account_active:boolean;account_current:boolean}
const requestDto=(r:RequestRow):CashbookRequestDto=>({id:r.id,kind:r.kind,source_location_id:r.source_location_id,source_revision_id:r.source_revision_id,target_location_id:r.target_location_id,target_revision_id:r.target_revision_id,expected_source_version:Number(r.expected_source_version),amount_paise:Number(r.amount_paise),currency:r.currency,category:r.category,payee:r.payee,responsible_employee_id:r.responsible_employee_id,reason:r.reason,occurred_at:instant(r.occurred_at),actor_id:r.actor_id,recorded_at:instant(r.recorded_at)});
const decisionDto=(r:DecisionRow):CashbookDecisionDto=>({id:r.id,request_id:r.request_id,decision:r.decision,reason:r.reason,actor_id:r.actor_id,recorded_at:instant(r.recorded_at),version:2});
function text(value:unknown,max:number):string {
 if(typeof value!=='string'||value.length>max*4||!value.trim()||[...value.trim()].length>max||[...value].some(char=>{const code=char.codePointAt(0)!;return code<32||(code>=127&&code<=159)||(code>=0xd800&&code<=0xdfff);}))throw new FieldValidationError('$','INVALID_FORMAT');return value.trim();
}
export function cashbookRequestInput(value:unknown):CashbookRequestInput {
 const b=object(value,['kind','source_location_id','source_revision_id','target_location_id','target_revision_id','expected_source_version','amount_paise','currency','category','payee','responsible_employee_id','reason','occurred_at']);
 if(!['expense','opening_float','owner_funds','deposit','withdrawal'].includes(b.kind as string)||b.currency!=='INR')throw new FieldValidationError('$','INVALID_FORMAT');
 const kind=b.kind as CashMovementKind,paired=kind==='deposit'||kind==='withdrawal',expense=kind==='expense';
 if(paired?(b.target_location_id===null||b.target_revision_id===null):(b.target_location_id!==null||b.target_revision_id!==null))throw new FieldValidationError('$','INVALID_FORMAT');
 if(expense?!['rent','utilities','supplies','transport','maintenance','other'].includes(b.category as string):(b.category!==null||b.payee!==null))throw new FieldValidationError('$','INVALID_FORMAT');
 const source=uuid(b.source_location_id,'$'),target=paired?uuid(b.target_location_id,'$'):null;if(source===target)throw new FieldValidationError('$','INVALID_FORMAT');
 return {kind,source_location_id:source,source_revision_id:uuid(b.source_revision_id,'$'),target_location_id:target,target_revision_id:paired?uuid(b.target_revision_id,'$'):null,
 expected_source_version:integer(b.expected_source_version,'expected_version'),amount_paise:integer(b.amount_paise,'amount_paise',1),currency:'INR',category:expense?b.category as ExpenseCategory:null,payee:expense?text(b.payee,120):null,
 responsible_employee_id:uuid(b.responsible_employee_id,'$'),reason:text(b.reason,500),occurred_at:timestamp(b.occurred_at,'occurred_at')};
}
export function cashbookDecisionInput(value:unknown):CashbookDecisionInput {
 const b=object(value,['decision','reason','expected_version']);if(b.decision!=='approved'&&b.decision!=='rejected')throw new FieldValidationError('$','INVALID_FORMAT');
 integer(b.expected_version,'expected_version',1,1);return {decision:b.decision,reason:text(b.reason,500),expected_version:1};
}
async function lock(scope:TenantAccess) {
 const f=(await scopedQuery<{lifecycle:string}>(scope,[...actions],`SELECT lifecycle FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];
 if(!f)throw new HttpError('RESOURCE_NOT_FOUND');if(f.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
async function requestRow(scope:TenantAccess,id:string,ownOnly=false) {
 const c=assertTenantAccess(scope,[...actions]);
 const r=(await scopedQuery<RequestRow>(scope,[...actions],`SELECT * FROM shipit.cashbook_requests WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND (NOT $2::boolean OR actor_id=$3)`,[id,ownOnly,c.actor.id])).rows[0];if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return r;
}
async function validateSources(scope:TenantAccess,input:CashbookRequestInput,ownOnly=false) {
 const c=assertTenantAccess(scope,[...actions]);
 const version=(await scopedQuery<{version:string}>(scope,[...actions],`SELECT version::text FROM shipit.cashbook_source_versions WHERE {{franchise:organization_id:franchise_id}}`)).rows[0];
 if(BigInt(version?.version??'0')!==BigInt(input.expected_source_version))throw new HttpError('VERSION_CONFLICT');
 const sources=(await scopedQuery<Source>(scope,[...actions],`SELECT l.id,r.id revision_id,l.kind,l.custodian_id,r.active,a.active account_active,a.id=r.account_revision_id account_current FROM shipit.cash_locations l
 JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions x WHERE x.organization_id=l.organization_id AND x.franchise_id=l.franchise_id AND x.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
 JOIN LATERAL(SELECT * FROM shipit.receiving_account_revisions x WHERE x.organization_id=l.organization_id AND x.franchise_id=l.franchise_id AND x.account_id=l.account_id ORDER BY version DESC LIMIT 1) a ON true
 WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.id IN ($1,$2) AND (NOT $3::boolean OR l.kind='noncash' OR l.custodian_id=$4)`,[input.source_location_id,input.target_location_id,ownOnly,c.actor.id])).rows;
 const source=sources.find(r=>r.id===input.source_location_id),target=input.target_location_id?sources.find(r=>r.id===input.target_location_id):null;
 if(!source||(input.target_location_id&&!target))throw new HttpError('RESOURCE_NOT_FOUND');
 if(!source.active||!source.account_active||!source.account_current||source.revision_id!==input.source_revision_id||target&&(!target.active||!target.account_active||!target.account_current||target.revision_id!==input.target_revision_id))throw new HttpError('VERSION_CONFLICT');
 if(input.kind==='opening_float'&&source.kind!=='cash'||input.kind==='deposit'&&(source.kind!=='cash'||target?.kind!=='noncash')||input.kind==='withdrawal'&&(source.kind!=='noncash'||target?.kind!=='cash'))throw new FieldValidationError('$','INVALID_FORMAT');
 const members=(await scopedQuery<{user_id:string}>(scope,[...actions],`SELECT DISTINCT m.user_id FROM shipit.memberships m JOIN shipit.membership_franchise_scopes s ON s.organization_id=m.organization_id AND s.membership_id=m.id
 JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE {{franchise:s.organization_id:s.franchise_id}} AND m.lifecycle='active' AND m.role IN ('operator','franchise_admin') AND m.user_id IN ($1,$2,$3)`,[source.custodian_id,target?.custodian_id??null,input.responsible_employee_id])).rows;
 for(const id of [source.custodian_id,target?.custodian_id??null,input.responsible_employee_id])if(id&&!members.some(m=>m.user_id===id))throw new HttpError('RESOURCE_NOT_FOUND');
}
export function createCashbookRequestService(database:DatabasePool,writesEnabled=false) {
 return {
  async submit(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),input=cashbookRequestInput(body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation:'cashbook.request.submit',input});
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.request',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,['cashbook.request']);await lock(scope);
    const saved=(await scopedQuery<RequestRow>(scope,['cashbook.request'],`SELECT * FROM shipit.cashbook_requests WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
    if(saved){if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return requestDto(saved);}if(!writesEnabled)throw new HttpError('CASHBOOK_DISABLED');
    await validateSources(scope,input,s.ownOnly);
    const time=(await scopedQuery<{valid:boolean}>(scope,['cashbook.request'],`SELECT $1::timestamptz<=clock_timestamp() valid WHERE {{franchise:$2:$3}}`,[input.occurred_at,c.organizationId,c.permittedFranchiseIds[0]])).rows[0];if(!time?.valid)throw new FieldValidationError('occurred_at','OUT_OF_RANGE');
    const id=randomUUID();await scopedQuery(scope,['cashbook.request'],`INSERT INTO shipit.cashbook_requests(id,organization_id,franchise_id,kind,source_location_id,source_revision_id,target_location_id,target_revision_id,expected_source_version,amount_paise,currency,category,payee,responsible_employee_id,reason,occurred_at,actor_id,correlation_id,key_digest,fingerprint)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,'INR',$10,$11,$12,$13,$14,$15,$16,$17,$18 WHERE {{franchise:$19:$2}}`,[id,c.permittedFranchiseIds[0],input.kind,input.source_location_id,input.source_revision_id,input.target_location_id,input.target_revision_id,input.expected_source_version,input.amount_paise,input.category,input.payee,input.responsible_employee_id,input.reason,input.occurred_at,c.actor.id,c.correlationId,key,fingerprint,c.organizationId]);
    return requestDto(await requestRow(scope,id));
   });
  },
  async decide(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$'),input=cashbookDecisionInput(body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation:'cashbook.request.decide',id,input});
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.approve',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,['cashbook.approve']);await lock(scope);const request=await requestRow(scope,id);
    const saved=(await scopedQuery<DecisionRow>(scope,['cashbook.approve'],`SELECT * FROM shipit.cashbook_request_decisions WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
    if(saved){if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return decisionDto(saved);}if(!writesEnabled)throw new HttpError('CASHBOOK_DISABLED');
    if(request.actor_id===c.actor.id)throw new HttpError('CASHBOOK_APPROVAL_REQUIRED');
    if((await scopedQuery(scope,['cashbook.approve'],`SELECT id FROM shipit.cashbook_request_decisions WHERE {{franchise:organization_id:franchise_id}} AND request_id=$1`,[id])).rows[0])throw new HttpError('VERSION_CONFLICT');
    if(input.decision==='approved')await validateSources(scope,requestDto(request));
    const decisionId=randomUUID();await scopedQuery(scope,['cashbook.approve'],`INSERT INTO shipit.cashbook_request_decisions(id,organization_id,franchise_id,request_id,decision,reason,actor_id,correlation_id,key_digest,fingerprint)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9 WHERE {{franchise:$10:$2}}`,[decisionId,c.permittedFranchiseIds[0],id,input.decision,input.reason,c.actor.id,c.correlationId,key,fingerprint,c.organizationId]);
    return decisionDto((await scopedQuery<DecisionRow>(scope,['cashbook.approve'],`SELECT * FROM shipit.cashbook_request_decisions WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[decisionId])).rows[0]!);
   });
  },
  async read(token:string,idInput:unknown,query:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$');return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.select',correlation,async s=>{
    const request=await requestRow(s.access,id,s.ownOnly),decision=(await scopedQuery<DecisionRow>(s.access,['cashbook.select'],`SELECT * FROM shipit.cashbook_request_decisions WHERE {{franchise:organization_id:franchise_id}} AND request_id=$1`,[id])).rows[0];
    return {request:requestDto(request),decision:decision?decisionDto(decision):null,version:decision?2 as const:1 as const};
   });
  }
 };
}
