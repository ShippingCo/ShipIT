import {randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {withBookingCancellationScope} from '../memberships/service.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {integer,object,selection,uuid} from '../pricing/validation.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';

type Preview = {
  booking_id: string; parcel_count: number; outstanding_paise: string;
  financial_version: number; payment_version: number;
  blocked_reason: null | 'already_cancelled' | 'parcel_processed' | 'operational_commitment' | 'money_recorded' | 'account_billed';
};
type Saved = Pick<Preview,'booking_id'|'parcel_count'|'outstanding_paise'> & {id:string; cancelled_at:Date};

function parseInput(raw:unknown) {
  const body=object(raw,['reason','expected_financial_version','expected_payment_version']);
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(reason.length<3||reason.length>200||Array.from(reason).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)) {
    throw new FieldValidationError('$','INVALID_FORMAT');
  }
  return {reason,expected_financial_version:integer(body.expected_financial_version,'expected_version'),
    expected_payment_version:integer(body.expected_payment_version,'expected_version')};
}

async function preview(scope:TenantAccess,bookingId:string):Promise<Preview> {
  const result=await scopedQuery<Preview>(scope,['bookings.cancel'],`SELECT p.booking_id,p.parcel_count,p.outstanding_paise::text,p.financial_version,p.payment_version,p.blocked_reason
    FROM shipit.bookings b CROSS JOIN LATERAL shipit.booking_cancellation_preview(b.organization_id,b.franchise_id,b.id) p
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1`,[bookingId]);
  if(!result.rows[0])throw new HttpError('RESOURCE_NOT_FOUND');
  return result.rows[0];
}

function result(row:Saved) {
  return {id:row.id,booking_id:row.booking_id,parcel_count:row.parcel_count,outstanding_paise:row.outstanding_paise,cancelled_at:row.cancelled_at.toISOString()};
}

export function bookingCancellations(database:DatabasePool) {
  return {
    cancellationPreview(session:string,query:unknown,id:unknown,correlation:string) {
      const {organizationId,franchiseId}=selection(query),bookingId=uuid(id,'$');
      return withBookingCancellationScope(database,session,organizationId,franchiseId,correlation,false,scope=>preview(scope,bookingId));
    },
    cancelBooking(session:string,query:unknown,id:unknown,key:string,body:unknown,correlation:string) {
      const {organizationId,franchiseId}=selection(query),bookingId=uuid(id,'$'),input=parseInput(body);
      const keyHash=keyDigest(key),fingerprint=digest({operation:'bookings.cancel',bookingId,input});
      return withBookingCancellationScope(database,session,organizationId,franchiseId,correlation,true,async cancel=>{
        const {actor}=assertTenantAccess(cancel,['bookings.cancel']);
        const replay=await scopedQuery<Saved&{fingerprint:string}>(cancel,['bookings.cancel'],`SELECT id,booking_id,parcel_count,outstanding_paise::text,cancelled_at,fingerprint
          FROM shipit.booking_cancellations WHERE {{franchise:organization_id:franchise_id}} AND actor_id=$1 AND key_digest=$2`,[actor.id,keyHash]);
        if(replay.rows[0]) {
          if(replay.rows[0].fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
          return result(replay.rows[0]);
        }
        const current=await preview(cancel,bookingId);
        if(current.blocked_reason)throw new HttpError('BOOKING_CANCELLATION_BLOCKED');
        if(input.expected_financial_version!==current.financial_version||input.expected_payment_version!==current.payment_version)throw new HttpError('VERSION_CONFLICT');
        try {
          const saved=await scopedQuery<Saved>(cancel,['bookings.cancel'],`INSERT INTO shipit.booking_cancellations
            (id,organization_id,franchise_id,booking_id,actor_id,correlation_id,reason,key_digest,fingerprint,financial_version,payment_version,outstanding_paise,parcel_count,cancelled_at)
            SELECT $2,b.organization_id,b.franchise_id,b.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,GREATEST(b.confirmed_at,date_trunc('milliseconds',clock_timestamp())) FROM shipit.bookings b
            WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1
            RETURNING id,booking_id,parcel_count,outstanding_paise::text,cancelled_at`,
            [bookingId,randomUUID(),actor.id,correlation,input.reason,keyHash,fingerprint,current.financial_version,current.payment_version,current.outstanding_paise,current.parcel_count]);
          return result(saved.rows[0]!);
        } catch(error) {
          if(error instanceof DatabaseError&&error.constraint==='booking_cancellation_blocked')throw new HttpError('BOOKING_CANCELLATION_BLOCKED');
          if(error instanceof DatabaseError&&error.constraint==='booking_cancellation_stale')throw new HttpError('VERSION_CONFLICT');
          throw error;
        }
      });
    }
  };
}
