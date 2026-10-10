import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import type {CashHandoverInput,CashHandoverRequestDto,CashHandoverCommandInput,CashHandoverCommandDto,CashHandoverDetail,CashHandoverState,CashHandoverTargets,CashHandoverList,CashHandoverListItem} from '@shippingco/shared';
import {withCashbookScope} from '../memberships/service.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {object,selection,uuid,integer,idempotencyKey,timestamp} from '../pricing/validation.ts';
import {keyDigest,digest} from '../pricing/idempotency.ts';
import {instant} from '../pricing/types.ts';
import {HttpError,FieldValidationError} from '../../plugins/errors.ts';
import {cashbookText} from './request-service.ts';
import {maximumPaise} from './rules.ts';
const actions=['cashbook.request','cashbook.acknowledge','cashbook.select'] as const;
interface RequestRow extends Omit<CashHandoverRequestDto,'version'|'expected_source_version'|'amount_paise'|'recorded_at'|'occurred_at'> {expected_source_version:string;amount_paise:string;recorded_at:Date;occurred_at:Date;fingerprint:string;source_custodian_id:string;target_custodian_id:string}
interface CommandRow extends Omit<CashHandoverCommandDto,'amount_paise'|'accepted_paise'|'remaining_paise'|'ended_paise'|'recorded_at'> {amount_paise:string;accepted_paise:string;remaining_paise:string;ended_paise:string;recorded_at:Date;fingerprint:string}
interface PositionRow {version:number;accepted_paise:string;remaining_paise:string;ended_paise:string;state:CashHandoverState;source_version:string}
const requestDto=(r:RequestRow):CashHandoverRequestDto=>({id:r.id,source_location_id:r.source_location_id,source_revision_id:r.source_revision_id,target_location_id:r.target_location_id,target_revision_id:r.target_revision_id,expected_source_version:Number(r.expected_source_version),amount_paise:Number(r.amount_paise),currency:'INR',reason:r.reason,occurred_at:instant(r.occurred_at),actor_id:r.actor_id,recorded_at:instant(r.recorded_at),version:1});
const commandDto=(r:CommandRow):CashHandoverCommandDto=>({id:r.id,handover_id:r.handover_id,version:r.version,kind:r.kind,amount_paise:Number(r.amount_paise),currency:'INR',reason:r.reason,actor_id:r.actor_id,recorded_at:instant(r.recorded_at),accepted_paise:Number(r.accepted_paise),remaining_paise:Number(r.remaining_paise),ended_paise:Number(r.ended_paise),state:r.state,legs:r.legs});
export function handoverInput(value:unknown):CashHandoverInput {
 const b=object(value,['source_location_id','source_revision_id','target_location_id','target_revision_id','expected_source_version','amount_paise','currency','reason','occurred_at']);if(b.currency!=='INR')throw new FieldValidationError('$','INVALID_FORMAT');
 const source=uuid(b.source_location_id,'$'),target=uuid(b.target_location_id,'$');if(source===target)throw new FieldValidationError('$','INVALID_FORMAT');
 return {source_location_id:source,source_revision_id:uuid(b.source_revision_id,'$'),target_location_id:target,target_revision_id:uuid(b.target_revision_id,'$'),expected_source_version:integer(b.expected_source_version,'expected_version'),amount_paise:integer(b.amount_paise,'amount_paise',1),currency:'INR',reason:cashbookText(b.reason,500),occurred_at:timestamp(b.occurred_at,'occurred_at')};
}
export function handoverCommandInput(value:unknown):CashHandoverCommandInput {
 const b=object(value,['kind','expected_version','expected_source_version','amount_paise','currency','reason']);if(!['accept','reject','cancel'].includes(b.kind as string)||b.currency!=='INR')throw new FieldValidationError('$','INVALID_FORMAT');
 const amount=integer(b.amount_paise,'amount_paise',b.kind==='accept'?1:0);if(b.kind!=='accept'&&amount!==0)throw new FieldValidationError('$','INVALID_FORMAT');
 return {kind:b.kind as CashHandoverCommandInput['kind'],expected_version:integer(b.expected_version,'expected_version',1,2147483645),expected_source_version:integer(b.expected_source_version,'expected_version'),amount_paise:amount,currency:'INR',reason:cashbookText(b.reason,500)};
}
async function lock(scope:TenantAccess,writing=true) {
 const row=(await scopedQuery<{lifecycle:string}>(scope,[...actions],`SELECT lifecycle FROM shipit.franchises WHERE {{franchise:organization_id:id}} FOR UPDATE`)).rows[0];if(!row)throw new HttpError('RESOURCE_NOT_FOUND');if(writing&&row.lifecycle!=='active')throw new HttpError('FRANCHISE_DISABLED');
}
async function requestRow(scope:TenantAccess,id:string,ownOnly:boolean) {
 const c=assertTenantAccess(scope,[...actions]);const r=(await scopedQuery<RequestRow>(scope,[...actions],`SELECT h.*,s.custodian_id source_custodian_id,t.custodian_id target_custodian_id FROM shipit.cash_handovers h
 JOIN shipit.cash_locations s ON s.organization_id=h.organization_id AND s.franchise_id=h.franchise_id AND s.id=h.source_location_id JOIN shipit.cash_locations t ON t.organization_id=h.organization_id AND t.franchise_id=h.franchise_id AND t.id=h.target_location_id
 WHERE {{franchise:h.organization_id:h.franchise_id}} AND h.id=$1 AND (NOT $2::boolean OR h.actor_id=$3 OR s.custodian_id=$3 OR t.custodian_id=$3)`,[id,ownOnly,c.actor.id])).rows[0];if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return r;
}
async function sources(scope:TenantAccess,input:CashHandoverInput,ownOnly:boolean) {
 const c=assertTenantAccess(scope,[...actions]);const rows=(await scopedQuery<{id:string;revision_id:string;active:boolean;account_active:boolean;account_current:boolean;custodian_id:string;eligible:boolean}>(scope,[...actions],`SELECT l.id,r.id revision_id,r.active,a.active account_active,r.account_revision_id=a.id account_current,l.custodian_id,
 EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND m.user_id=l.custodian_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin')) eligible
 FROM shipit.cash_locations l JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions r WHERE r.organization_id=l.organization_id AND r.franchise_id=l.franchise_id AND r.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
 JOIN LATERAL(SELECT * FROM shipit.receiving_account_revisions a WHERE a.organization_id=l.organization_id AND a.franchise_id=l.franchise_id AND a.account_id=l.account_id ORDER BY version DESC LIMIT 1) a ON true
 WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.id IN($1,$2) AND l.kind='cash'`,[input.source_location_id,input.target_location_id])).rows;
 const source=rows.find(r=>r.id===input.source_location_id),target=rows.find(r=>r.id===input.target_location_id);if(!source||!target||ownOnly&&source.custodian_id!==c.actor.id||!source.eligible||!target.eligible)throw new HttpError('RESOURCE_NOT_FOUND');
 if(!source.active||!target.active||!source.account_active||!target.account_active||!source.account_current||!target.account_current||source.revision_id!==input.source_revision_id||target.revision_id!==input.target_revision_id)throw new HttpError('VERSION_CONFLICT');
}
async function sourceVersion(scope:TenantAccess) {return (await scopedQuery<{version:string}>(scope,[...actions],`SELECT version::text FROM shipit.cashbook_source_versions WHERE {{franchise:organization_id:franchise_id}}`)).rows[0]?.version??'0';}
async function capacity(scope:TenantAccess,location:string,exclude:string|null=null) {
 const r=(await scopedQuery<{recorded:string;reserved:string;unknown_refund:string}>(scope,[...actions],`SELECT
 COALESCE((SELECT sum(CASE WHEN f.direction='in' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END) FROM shipit.cashbook_source_facts f WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND f.location_id=l.id),0)::text recorded,
 COALESCE((SELECT sum(h.remaining_paise::numeric) FROM shipit.cash_handover_positions h WHERE h.organization_id=l.organization_id AND h.franchise_id=l.franchise_id AND h.source_location_id=l.id AND h.id IS DISTINCT FROM $2::uuid),0)::text reserved,
 COALESCE((SELECT sum(CASE WHEN f.source_kind='refund' THEN f.amount_paise::numeric ELSE -f.amount_paise::numeric END) FROM shipit.cashbook_source_facts f WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND f.location_id IS NULL AND f.source_kind IN('refund','refund_correction') AND (f.account_id IS NULL OR f.account_id=l.account_id)),0)::text unknown_refund
 FROM shipit.cash_locations l WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.id=$1`,[location,exclude])).rows[0];if(!r)throw new HttpError('RESOURCE_NOT_FOUND');return {recorded:BigInt(r.recorded),reserved:BigInt(r.reserved),unknown:BigInt(r.unknown_refund)};
}
async function commandRow(scope:TenantAccess,id:string) {
 return (await scopedQuery<CommandRow>(scope,[...actions],`SELECT c.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('location_id',l.location_id,'direction',l.direction,'amount_paise',l.amount_paise::text) ORDER BY l.location_id) FROM shipit.cash_handover_legs l WHERE l.organization_id=c.organization_id AND l.franchise_id=c.franchise_id AND l.command_id=c.id),'[]'::jsonb) legs
 FROM shipit.cash_handover_commands c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.id=$1`,[id])).rows[0]!;
}
export function createCashHandoverService(database:DatabasePool,writesEnabled=false) {
 return {
  async request(token:string,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),input=handoverInput(body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation:'cashbook.handover.request',input});
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.request',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,['cashbook.request']);await lock(scope);
    const saved=(await scopedQuery<{id:string;fingerprint:string}>(scope,['cashbook.request'],`SELECT id,fingerprint FROM shipit.cash_handovers WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
    if(saved){const previous=await requestRow(scope,saved.id,s.ownOnly);if(s.ownOnly&&previous.source_custodian_id!==c.actor.id)throw new HttpError('RESOURCE_NOT_FOUND');if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return requestDto(previous);}if(!writesEnabled)throw new HttpError('CASHBOOK_DISABLED');
    await sources(scope,input,s.ownOnly);if(BigInt(await sourceVersion(scope))!==BigInt(input.expected_source_version))throw new HttpError('VERSION_CONFLICT');
    const valid=(await scopedQuery<{valid:boolean}>(scope,['cashbook.request'],`SELECT $1::timestamptz<=clock_timestamp() valid WHERE {{franchise:$2:$3}}`,[input.occurred_at,c.organizationId,c.permittedFranchiseIds[0]])).rows[0]?.valid;if(!valid)throw new FieldValidationError('occurred_at','OUT_OF_RANGE');
    const position=await capacity(scope,input.source_location_id);if(BigInt(input.amount_paise)>position.recorded-position.reserved||position.unknown>0n||position.recorded>maximumPaise)throw new HttpError('CASHBOOK_CONFLICT');
    const id=randomUUID();await scopedQuery(scope,['cashbook.request'],`INSERT INTO shipit.cash_handovers(id,organization_id,franchise_id,source_location_id,source_revision_id,target_location_id,target_revision_id,expected_source_version,amount_paise,currency,reason,occurred_at,actor_id,correlation_id,key_digest,fingerprint)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,'INR',$9,$10,$11,$12,$13,$14 WHERE {{franchise:$15:$2}}`,[id,c.permittedFranchiseIds[0],input.source_location_id,input.source_revision_id,input.target_location_id,input.target_revision_id,input.expected_source_version,input.amount_paise,input.reason,input.occurred_at,c.actor.id,c.correlationId,key,fingerprint,c.organizationId]);
    return requestDto(await requestRow(scope,id,s.ownOnly));
   });
  },
  async respond(token:string,idInput:unknown,query:unknown,keyInput:unknown,headers:readonly string[],body:unknown,correlation:string) {
   const q=selection(query),id=uuid(idInput,'$'),input=handoverCommandInput(body),key=keyDigest(idempotencyKey(keyInput,headers)),fingerprint=digest({operation:'cashbook.handover.respond',id,input}),action=input.kind==='cancel'?'cashbook.request':'cashbook.acknowledge';
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,action,correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,[action]);await lock(scope);const request=await requestRow(scope,id,s.ownOnly);
    if(input.kind==='cancel'?s.ownOnly&&request.source_custodian_id!==c.actor.id:request.target_custodian_id!==c.actor.id)throw new HttpError('ACTION_FORBIDDEN');
    const saved=(await scopedQuery<{id:string;fingerprint:string}>(scope,[action],`SELECT id,fingerprint FROM shipit.cash_handover_commands WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,key])).rows[0];
    if(saved){if(saved.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return commandDto(await commandRow(scope,saved.id));}if(!writesEnabled)throw new HttpError('CASHBOOK_DISABLED');
    const current=(await scopedQuery<PositionRow>(scope,[action],`SELECT version,accepted_paise::text,remaining_paise::text,ended_paise::text,state FROM shipit.cash_handover_positions WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[id])).rows[0]!;
    if(current.version!==input.expected_version||current.remaining_paise==='0'||BigInt(await sourceVersion(scope))!==BigInt(input.expected_source_version))throw new HttpError('VERSION_CONFLICT');
    if(input.kind==='accept'){
     await sources(scope,requestDto(request),false);const source=await capacity(scope,request.source_location_id,id),target=await capacity(scope,request.target_location_id),amount=BigInt(input.amount_paise);
     if(amount>BigInt(current.remaining_paise)||amount>source.recorded-source.reserved||source.unknown>0n||target.recorded+amount>maximumPaise)throw new HttpError('CASHBOOK_CONFLICT');
    }
    const command=randomUUID();await scopedQuery(scope,[action],`INSERT INTO shipit.cash_handover_commands(id,organization_id,franchise_id,handover_id,version,expected_source_version,kind,amount_paise,currency,reason,actor_id,correlation_id,key_digest,fingerprint)
     SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,'INR',$8,$9,$10,$11,$12 WHERE {{franchise:$13:$2}}`,[command,c.permittedFranchiseIds[0],id,input.expected_version+1,input.expected_source_version,input.kind,input.amount_paise,input.reason,c.actor.id,c.correlationId,key,fingerprint,c.organizationId]);
    if(input.kind==='accept')for(const [location,direction] of [[request.source_location_id,'out'],[request.target_location_id,'in']] as const)await scopedQuery(scope,[action],`INSERT INTO shipit.cash_handover_legs(organization_id,franchise_id,command_id,location_id,direction,amount_paise)
     SELECT {{organization}},$1,$2,$3,$4,$5 WHERE {{franchise:$6:$1}}`,[c.permittedFranchiseIds[0],command,location,direction,input.amount_paise,c.organizationId]);
    return commandDto(await commandRow(scope,command));
   });
  },
  async list(token:string,query:unknown,correlation:string):Promise<CashHandoverList> {
   const b=object(query,['organization_id','franchise_id','cursor','state']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),cursor=b.cursor==null?null:uuid(b.cursor,'$'),state=b.state??null;
   if(state!==null&&!['requested','partially_accepted','accepted','rejected','cancelled'].includes(state as string))throw new FieldValidationError('$','INVALID_FORMAT');
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.select',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,['cashbook.select']);await lock(scope,false);
    const rows=(await scopedQuery<Omit<CashHandoverListItem,'amount_paise'|'accepted_paise'|'remaining_paise'|'ended_paise'|'occurred_at'|'recorded_at'>&{amount_paise:string;accepted_paise:string;remaining_paise:string;ended_paise:string;occurred_at:Date;recorded_at:Date}>(scope,['cashbook.select'],`SELECT h.id,h.source_location_id,h.target_location_id,h.actor_id,h.amount_paise::text,h.occurred_at,h.recorded_at,p.version,p.state,p.accepted_paise::text,p.remaining_paise::text,p.ended_paise::text
     FROM shipit.cash_handovers h JOIN shipit.cash_handover_positions p ON p.organization_id=h.organization_id AND p.franchise_id=h.franchise_id AND p.id=h.id
     JOIN shipit.cash_locations source ON source.organization_id=h.organization_id AND source.franchise_id=h.franchise_id AND source.id=h.source_location_id JOIN shipit.cash_locations target ON target.organization_id=h.organization_id AND target.franchise_id=h.franchise_id AND target.id=h.target_location_id
     WHERE {{franchise:h.organization_id:h.franchise_id}} AND (NOT $1::boolean OR h.actor_id=$2 OR source.custodian_id=$2 OR target.custodian_id=$2) AND ($3::uuid IS NULL OR h.id>$3::uuid) AND ($4::text IS NULL OR p.state=$4) ORDER BY h.id LIMIT 101`,[s.ownOnly,c.actor.id,cursor,state])).rows;
    return {items:rows.slice(0,100).map(r=>({...r,amount_paise:Number(r.amount_paise),accepted_paise:Number(r.accepted_paise),remaining_paise:Number(r.remaining_paise),ended_paise:Number(r.ended_paise),occurred_at:instant(r.occurred_at),recorded_at:instant(r.recorded_at)})),next_cursor:rows.length>100?rows[99]!.id:null,current_source_version:Number(await sourceVersion(scope))};
   });
  },
  async targets(token:string,sourceInput:unknown,query:unknown,correlation:string):Promise<CashHandoverTargets> {
   const b=object(query,['organization_id','franchise_id','cursor']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(sourceInput,'$'),cursor=b.cursor==null?null:uuid(b.cursor,'$');
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.select',correlation,async s=>{
    const scope=s.access,c=assertTenantAccess(scope,['cashbook.select']);await lock(scope,false);
    const source=(await scopedQuery<{id:string;revision_id:string;active:boolean;account_active:boolean;account_current:boolean;eligible:boolean}>(scope,['cashbook.select'],`SELECT l.id,r.id revision_id,r.active,a.active account_active,r.account_revision_id=a.id account_current,
     EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND m.user_id=l.custodian_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin')) eligible
     FROM shipit.cash_locations l JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions r WHERE r.organization_id=l.organization_id AND r.franchise_id=l.franchise_id AND r.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
     JOIN LATERAL(SELECT * FROM shipit.receiving_account_revisions a WHERE a.organization_id=l.organization_id AND a.franchise_id=l.franchise_id AND a.account_id=l.account_id ORDER BY version DESC LIMIT 1) a ON true
     WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.id=$1 AND l.kind='cash' AND (NOT $2::boolean OR l.custodian_id=$3)`,[id,s.ownOnly,c.actor.id])).rows[0];
    if(!source||!source.eligible)throw new HttpError('RESOURCE_NOT_FOUND');if(!source.active||!source.account_active||!source.account_current)throw new HttpError('VERSION_CONFLICT');
    const rows=(await scopedQuery<CashHandoverTargets['items'][number]>(scope,['cashbook.select'],`SELECT l.id,r.id revision_id,r.name,l.custodian_id FROM shipit.cash_locations l
     JOIN LATERAL(SELECT * FROM shipit.cash_location_revisions r WHERE r.organization_id=l.organization_id AND r.franchise_id=l.franchise_id AND r.location_id=l.id ORDER BY version DESC LIMIT 1) r ON true
     JOIN LATERAL(SELECT * FROM shipit.receiving_account_revisions a WHERE a.organization_id=l.organization_id AND a.franchise_id=l.franchise_id AND a.account_id=l.account_id ORDER BY version DESC LIMIT 1) a ON true
     WHERE {{franchise:l.organization_id:l.franchise_id}} AND l.kind='cash' AND l.id<>$1 AND ($2::uuid IS NULL OR l.id>$2::uuid) AND r.active AND a.active AND r.account_revision_id=a.id
     AND EXISTS(SELECT 1 FROM shipit.memberships m JOIN shipit.membership_franchise_scopes f ON f.organization_id=m.organization_id AND f.membership_id=m.id JOIN shipit.auth_users u ON u.id=m.user_id AND u.lifecycle='active' WHERE f.organization_id=l.organization_id AND f.franchise_id=l.franchise_id AND m.user_id=l.custodian_id AND m.lifecycle='active' AND m.role IN('operator','franchise_admin')) ORDER BY l.id LIMIT 101`,[id,cursor])).rows;
    return {source_location_id:id,source_revision_id:source.revision_id,current_source_version:Number(await sourceVersion(scope)),items:rows.slice(0,100),next_cursor:rows.length>100?rows[99]!.id:null};
   });
  },
  async read(token:string,idInput:unknown,query:unknown,correlation:string):Promise<CashHandoverDetail> {
   const b=object(query,['organization_id','franchise_id','before_version']),q=selection({organization_id:b.organization_id,franchise_id:b.franchise_id}),id=uuid(idInput,'$');let before=2147483647;
   if(b.before_version!==undefined){if(typeof b.before_version!=='string'||!/^[1-9][0-9]{0,9}$/.test(b.before_version))throw new FieldValidationError('$','INVALID_FORMAT');before=integer(Number(b.before_version),'expected_version',2,2147483647);}
   return withCashbookScope(database,token,q.organizationId,q.franchiseId,'cashbook.select',correlation,async s=>{
    const scope=s.access;await lock(scope,false);const request=await requestRow(scope,id,s.ownOnly),position=(await scopedQuery<PositionRow>(scope,['cashbook.select'],`SELECT p.version,p.accepted_paise::text,p.remaining_paise::text,p.ended_paise::text,p.state,COALESCE((SELECT version::text FROM shipit.cashbook_source_versions v WHERE v.organization_id=p.organization_id AND v.franchise_id=p.franchise_id),'0') source_version
     FROM shipit.cash_handover_positions p WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.id=$1`,[id])).rows[0]!;
    const rows=(await scopedQuery<CommandRow>(scope,['cashbook.select'],`SELECT c.*,COALESCE((SELECT jsonb_agg(jsonb_build_object('location_id',l.location_id,'direction',l.direction,'amount_paise',l.amount_paise::text) ORDER BY l.location_id) FROM shipit.cash_handover_legs l WHERE l.organization_id=c.organization_id AND l.franchise_id=c.franchise_id AND l.command_id=c.id),'[]'::jsonb) legs
     FROM shipit.cash_handover_commands c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.handover_id=$1 AND c.version<$2 ORDER BY c.version DESC LIMIT 101`,[id,before])).rows;
    const commands=rows.slice(0,100).map(commandDto);
    return {source_custodian_id:request.source_custodian_id,target_custodian_id:request.target_custodian_id,request:requestDto(request),version:position.version,accepted_paise:Number(position.accepted_paise),remaining_paise:Number(position.remaining_paise),ended_paise:Number(position.ended_paise),state:position.state,current_source_version:Number(position.source_version),commands,next_cursor:rows.length>100?rows[99]!.version:null};
   });
  }
 };
}
