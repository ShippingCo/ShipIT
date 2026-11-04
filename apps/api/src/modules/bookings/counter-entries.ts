import {randomUUID} from 'node:crypto';
import type {DatabasePool} from '@shippingco/db';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {withBookingTenantScope} from '../memberships/service.ts';
import {scopedQuery,assertTenantAccess,type TenantAccess} from '../security/scope.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {idempotencyKey,selection} from './validation.ts';

const fields=['name','phone','address','recipientName','recipientPhone','recipientAddress','serviceOptionId','recipientCountry','recipientPin','recipientCity','recipientRegion','contentsType','contentsDescription','liquidQuantity','declaredValue','destination','weight','service','docket','override','packing','reason','registration','recipientState','gstin','handoverState','recipientRef','evidenceRef','specialCase','paymentMode','method'] as const;
export function counterEntryInput(input:unknown) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new FieldValidationError('$','INVALID_TYPE');
  const b=input as Record<string,unknown>;
  if(Object.keys(b).some(k=>!['fields','additional_parcels'].includes(k)))throw new FieldValidationError('$','UNKNOWN_FIELD');
  function values(input:unknown):Record<string,string>{
    if(input===undefined)return {};
    if(!input||typeof input!=='object'||Array.isArray(input))throw new FieldValidationError('$','INVALID_TYPE');
    const result:Record<string,string>={};
    for(const [k,v] of Object.entries(input)){
      if(!fields.includes(k as typeof fields[number]))throw new FieldValidationError('$','UNKNOWN_FIELD');
      if(typeof v!=='string')throw new FieldValidationError('$','INVALID_TYPE');
      if(v.length>4096)throw new FieldValidationError('$','OUT_OF_RANGE');
      result[k]=v;
    }
    return result;
  }
  if(b.additional_parcels!==undefined&&(!Array.isArray(b.additional_parcels)||b.additional_parcels.length>49))throw new FieldValidationError('$','OUT_OF_RANGE');
  return {fields:values(b.fields),additional_parcels:((b.additional_parcels??[]) as unknown[]).map(values)};
}
interface Row {id:string;organization_id:string;franchise_id:string;state:'confirmed';data:ReturnType<typeof counterEntryInput>;confirmed_at:Date;fingerprint:string}
function dto(r:Row){return {id:r.id,organization_id:r.organization_id,franchise_id:r.franchise_id,state:r.state,data:r.data,confirmed_at:r.confirmed_at.toISOString()};}
export async function insertCounterEntry(scope:TenantAccess,key:string,data:ReturnType<typeof counterEntryInput>){
  const c=assertTenantAccess(scope,['bookings.create']),hash=keyDigest(idempotencyKey(key)),fp=digest(data);
  const inserted=await scopedQuery<Row>(scope,['bookings.create'],`INSERT INTO shipit.counter_bookings
    (id,organization_id,franchise_id,actor_id,key_digest,fingerprint,data,correlation_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7 WHERE {{franchise:$8:$2}}
    ON CONFLICT(organization_id,franchise_id,actor_id,key_digest) DO NOTHING RETURNING *`,
    [randomUUID(),c.permittedFranchiseIds[0],c.actor.id,hash,fp,data,c.correlationId,c.organizationId]);
  const row=inserted.rows[0]??(await scopedQuery<Row>(scope,['bookings.create'],`SELECT * FROM shipit.counter_bookings
    WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[c.actor.id,hash])).rows[0];
  if(!row)throw new HttpError('IDEMPOTENCY_IN_PROGRESS');
  if(row.fingerprint!==fp)throw new HttpError('IDEMPOTENCY_CONFLICT');
  if(inserted.rows.length)await scopedQuery(scope,['bookings.create'],`INSERT INTO shipit.counter_booking_events
    (booking_id,organization_id,franchise_id,actor_id,action,correlation_id)
    SELECT $1,{{organization}},$2,$3,'confirmed',$4 WHERE {{franchise:$5:$2}}`,
    [row.id,c.permittedFranchiseIds[0],c.actor.id,c.correlationId,c.organizationId]);
  return dto(row);
}
export function counterEntries(database:DatabasePool){return {
  saveEntry(session:string,query:unknown,key:string,input:unknown,correlation:string){
    const s=selection(query),data=counterEntryInput(input);
    return withBookingTenantScope(database,session,s.organizationId,s.franchiseId,correlation,scopes=>insertCounterEntry(scopes.bookings,key,data));
  },
  listEntries(session:string,query:unknown,correlation:string){
    const s=selection(query);
    return withBookingTenantScope(database,session,s.organizationId,s.franchiseId,correlation,async scopes=>({items:(await scopedQuery<Row>(scopes.bookings,['bookings.create'],
      `SELECT * FROM shipit.counter_bookings WHERE {{franchise:organization_id:franchise_id}} ORDER BY confirmed_at DESC,id DESC LIMIT 100`)).rows.map(dto)}));
  },
};}
