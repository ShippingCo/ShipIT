import {randomUUID} from 'node:crypto';
import type {BookingServiceInput,BookingServiceDto,PricingQuoteDto,PricingQuoteInput,PricingVersionDto} from '@shippingco/shared';
import {scopedQuery,assertTenantAccess,type TenantAccess} from '../security/scope.ts';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {object,integer,quote} from './validation.ts';
import {digest,keyDigest} from './idempotency.ts';
import {calculate,checked} from './calculation.ts';
interface Row {id:string;name:string;service:BookingServiceInput['service'];destination_key:string;pricing:BookingServiceInput['pricing'];accepts_liquids:boolean;created_at:Date;fingerprint:string}
const dto=(r:Row):BookingServiceDto=>({id:r.id,name:r.name,service:r.service,destination_key:r.destination_key,pricing:r.pricing,accepts_liquids:r.accepts_liquids,created_at:r.created_at.toISOString()});
export function serviceInput(value:unknown):BookingServiceInput {
 const b=object(value,['name','service','destination_key','pricing','accepts_liquids']);
 if(typeof b.name!=='string'||b.name!==b.name.trim()||!b.name||[...b.name].length>80||[...b.name].some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127))throw new FieldValidationError('$','INVALID_FORMAT');
 if(typeof b.accepts_liquids!=='boolean')throw new FieldValidationError('$','INVALID_TYPE');
 const p=object(b.pricing,['kind','first_kg_paise','additional_kg_paise','packing_paise']);
 if(p.kind!=='flat'&&p.kind!=='per_kg')throw new FieldValidationError('$','INVALID_FORMAT');
 const first=integer(p.first_kg_paise,'freight_paise'),extra=integer(p.additional_kg_paise,'freight_paise'),packing=integer(p.packing_paise,'packing_paise');
 if(p.kind==='flat'&&extra!==0)throw new FieldValidationError('$','INVALID_FORMAT');
 checked(BigInt(first)+BigInt(packing));
 const base=quote({service:b.service,destination_key:b.destination_key,weight_grams:1});
 return {name:b.name,accepts_liquids:b.accepts_liquids,service:base.service,destination_key:base.destination_key,pricing:{kind:p.kind,first_kg_paise:first,additional_kg_paise:extra,packing_paise:packing}};
}
export async function listServices(scope:TenantAccess,cursor:string|null=null){const rows=(await scopedQuery<Row>(scope,['pricing.read','pricing.publish'],`SELECT id,name,service,destination_key,pricing,accepts_liquids,created_at,fingerprint FROM shipit.booking_services WHERE {{franchise:organization_id:franchise_id}} AND ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 201`,[cursor])).rows;return {items:rows.slice(0,200).map(dto),page:{has_more:rows.length>200,next_cursor:rows.length>200?rows[199]!.id:null}};}
export async function createService(scope:TenantAccess,key:string,input:unknown):Promise<BookingServiceDto>{
 const c=assertTenantAccess(scope,['pricing.publish']),body=serviceInput(input),hash=keyDigest(key),fingerprint=digest(body);
 const prior=(await scopedQuery<Row>(scope,['pricing.publish'],`SELECT id,name,service,destination_key,pricing,accepts_liquids,created_at,fingerprint FROM shipit.booking_services WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,hash])).rows[0];
 if(prior){if(prior.fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');return dto(prior)}
 const same=(await scopedQuery(scope,['pricing.publish'],`SELECT id FROM shipit.booking_services WHERE {{franchise:organization_id:franchise_id}} AND lower(name)=lower($1) AND destination_key=$2`,[body.name,body.destination_key])).rows[0];
 if(same)throw new HttpError('RATE_CONFLICT');
 const row=(await scopedQuery<Row>(scope,['pricing.publish'],`INSERT INTO shipit.booking_services(id,organization_id,franchise_id,name,service,destination_key,pricing,actor_id,key_digest,fingerprint,correlation_id,accepts_liquids) SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$12 WHERE {{franchise:$11:$2}} ON CONFLICT DO NOTHING RETURNING id,name,service,destination_key,pricing,accepts_liquids,created_at,fingerprint`,[randomUUID(),c.permittedFranchiseIds[0],body.name,body.service,body.destination_key,body.pricing,c.actor.id,hash,fingerprint,c.correlationId,c.organizationId,body.accepts_liquids])).rows[0]!;
 return row?dto(row):createService(scope,key,body);
}
export async function calculateServiceQuote(scope:TenantAccess,version:PricingVersionDto,input:PricingQuoteInput,now:Date,id:string,actor:string,privileged:boolean):Promise<PricingQuoteDto|null>{
 if(!input.service_option_id)return null;
 // An account's negotiated rate is a separate explicit selection, never silently overridden.
 if(input.customer_account_id)throw new HttpError('ACTION_FORBIDDEN');
 const row=(await scopedQuery<Row>(scope,['pricing.read','pricing.publish','pricing.quote','pricing.override','pricing.override.approve','pricing.validate'],`SELECT id,name,service,destination_key,pricing,accepts_liquids,created_at,fingerprint FROM shipit.booking_services WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[input.service_option_id])).rows[0];
 if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
 if(row.service!==input.service||row.destination_key!==input.destination_key||row.created_at>now)throw new HttpError('NO_RATE');
 const p=row.pricing,extra=p.kind==='per_kg'?(BigInt(input.weight_grams)+999n)/1000n-1n:0n;
 const freight=checked(BigInt(p.first_kg_paise)+extra*BigInt(p.additional_kg_paise));
 const result=calculate({...version,rules:[{id:row.id,destination_key:row.destination_key,service:row.service,min_weight_grams:1,max_weight_grams:null,freight_paise:freight,packing_paise:p.packing_paise}]},input,now,id,actor,privileged);
 result.rule_id=null;result.service_option={id:row.id,name:row.name};
 const {fingerprint:_,...evidence}=result;void _;return {...evidence,fingerprint:digest(evidence)};
}

export async function assertServiceContents(scope:TenantAccess,optionId:string,hasLiquids:boolean){const r=(await scopedQuery<Row>(scope,['pricing.read','pricing.publish','pricing.quote','pricing.override','pricing.override.approve','pricing.validate'],`SELECT accepts_liquids FROM shipit.booking_services WHERE {{franchise:organization_id:franchise_id}} AND id=$1`,[optionId])).rows[0];if(!r)throw new HttpError('RESOURCE_NOT_FOUND');if(hasLiquids&&!r.accepts_liquids)throw new HttpError('NO_RATE');}
