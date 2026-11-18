import {createHash,randomUUID} from 'node:crypto';
import {DatabaseError,type DatabasePool} from '@shippingco/db';
import {FieldValidationError,HttpError} from '../../plugins/errors.ts';
import {withBookingCancellationScope} from '../memberships/service.ts';
import {digest,keyDigest} from '../pricing/idempotency.ts';
import {integer,object,selection,uuid} from '../pricing/validation.ts';
import {assertTenantAccess,scopedQuery,type TenantAccess} from '../security/scope.ts';
import {createLotService} from '../lots/service.ts';

type RefundMethod = 'cash'|'upi'|'card'|'bank_transfer'|'other';
type Refund = {method:RefundMethod; amount_paise:string};
export type CancellationBlockedReason = 'already_cancelled'|'parcel_processed'|'operational_commitment'|'in_lot'|'account_billed'
  |'refund_source_missing'|'refund_cash_unavailable';
type Preview = {
  booking_id: string; parcel_count: number; outstanding_paise: string; reversed_paise: string; refund_paise: string;
  refunds: Refund[]; financial_version: number; payment_version: number; blocked_reason: null | CancellationBlockedReason;
};
type Membership = {lot_id:string; lot_version:number; membership_id:string; parcel_id:string};
type Saved = {id:string; booking_id:string; parcel_count:number; outstanding_paise:string; reversed_paise:string; refunded_paise:string;
  refunds:Refund[]; cancelled_at:Date};

function parseInput(raw:unknown) {
  const body=object(raw,['reason','expected_financial_version','expected_payment_version']);
  const reason=typeof body.reason==='string'?body.reason.trim():'';
  if(reason.length<3||reason.length>200||Array.from(reason).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127)) {
    throw new FieldValidationError('$','INVALID_FORMAT');
  }
  return {reason,expected_financial_version:integer(body.expected_financial_version,'expected_version'),
    expected_payment_version:integer(body.expected_payment_version,'expected_version')};
}

/** The cancelling actor matters: cash refunds leave that person's own cash location. */
async function preview(scope:TenantAccess,bookingId:string):Promise<Preview> {
  const {actor}=assertTenantAccess(scope,['bookings.cancel']);
  const result=await scopedQuery<Preview>(scope,['bookings.cancel'],`SELECT p.booking_id,p.parcel_count,p.outstanding_paise::text,
    p.reversed_paise::text,p.refund_paise::text,p.refunds,p.financial_version,p.payment_version,p.blocked_reason
    FROM shipit.bookings b CROSS JOIN LATERAL shipit.booking_cancellation_preview(b.organization_id,b.franchise_id,b.id,$2) p
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1`,[bookingId,actor.id]);
  if(!result.rows[0])throw new HttpError('RESOURCE_NOT_FOUND');
  return result.rows[0];
}

async function memberships(scope:TenantAccess,bookingId:string):Promise<Membership[]> {
  const result=await scopedQuery<Membership>(scope,['bookings.cancel'],`SELECT m.lot_id,m.lot_version,m.membership_id,m.parcel_id
    FROM shipit.bookings b CROSS JOIN LATERAL shipit.booking_cancellation_lot_memberships(b.organization_id,b.franchise_id,b.id) m
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1`,[bookingId]);
  return result.rows;
}
/** The bag a parcel is in is not a reason to refuse: the cancel request takes it out first. */
function shown(p:Preview) {
  return p.blocked_reason==='in_lot'?{...p,blocked_reason:null,in_bag:true}:{...p,in_bag:false};
}
/** One stable key per bag removal, derived from the cancel key, so a retried cancel replays it. */
const lotKey=(key:string,membership:string)=>createHash('sha256').update('booking-cancel-lot:'+key+':'+membership).digest('hex').slice(0,64);

const savedColumns=`c.id,c.booking_id,c.parcel_count,c.outstanding_paise::text,c.reversed_paise::text,c.refunded_paise::text,c.refunds,c.cancelled_at`;

function result(row:Saved) {
  return {id:row.id,booking_id:row.booking_id,parcel_count:row.parcel_count,outstanding_paise:row.outstanding_paise,
    reversed_paise:row.reversed_paise,refunded_paise:row.refunded_paise,refunds:row.refunds,cancelled_at:row.cancelled_at.toISOString()};
}

export function bookingCancellations(database:DatabasePool,cursorKey:Buffer) {
  const lots=createLotService(database,cursorKey);
  return {
    cancellationPreview(session:string,query:unknown,id:unknown,correlation:string) {
      const {organizationId,franchiseId}=selection(query),bookingId=uuid(id,'$');
      return withBookingCancellationScope(database,session,organizationId,franchiseId,correlation,false,async scope=>shown(await preview(scope,bookingId)));
    },
    async cancelBooking(session:string,query:unknown,id:unknown,key:string,body:unknown,correlation:string) {
      const {organizationId,franchiseId}=selection(query),bookingId=uuid(id,'$'),input=parseInput(body);
      const keyHash=keyDigest(key),fingerprint=digest({operation:'bookings.cancel',bookingId,input});
      // Parcels in a bag come out of it first, each through the ordinary lot command, but only
      // when the bag is the one thing in the way; otherwise nothing is touched and the cancel
      // below refuses as it would have anyway.
      for(let round=0;round<50;round+=1){
        const step=await withBookingCancellationScope(database,session,organizationId,franchiseId,correlation,false,async scope=>{
          const current=await preview(scope,bookingId);
          return current.blocked_reason==='in_lot'?(await memberships(scope,bookingId))[0]??null:null;
        });
        if(!step)break;
        const lotKeyValue=lotKey(key,step.membership_id);
        try {
          await lots.execute(session,step.lot_id,step.parcel_id,query,lotKeyValue,['idempotency-key',lotKeyValue],
            {expected_version:step.lot_version,membership_id:step.membership_id},'lots.membership.remove',correlation);
        } catch(error) {
          if(error instanceof HttpError&&error.code==='VERSION_CONFLICT')continue;
          throw error instanceof HttpError&&['ACTION_FORBIDDEN','LOT_STATE_CONFLICT','LOT_MEMBERSHIP_CONFLICT'].includes(error.code)
            ?new HttpError('BOOKING_CANCELLATION_BLOCKED'):error;
        }
      }
      return withBookingCancellationScope(database,session,organizationId,franchiseId,correlation,true,async cancel=>{
        const {actor}=assertTenantAccess(cancel,['bookings.cancel']);
        const replay=await scopedQuery<Saved&{fingerprint:string}>(cancel,['bookings.cancel'],`SELECT ${savedColumns},c.fingerprint
          FROM shipit.booking_cancellations c WHERE {{franchise:c.organization_id:c.franchise_id}} AND c.actor_id=$1 AND c.key_digest=$2`,[actor.id,keyHash]);
        if(replay.rows[0]) {
          if(replay.rows[0].fingerprint!==fingerprint)throw new HttpError('IDEMPOTENCY_CONFLICT');
          return result(replay.rows[0]);
        }
        const current=await preview(cancel,bookingId);
        if(current.blocked_reason)throw new HttpError('BOOKING_CANCELLATION_BLOCKED');
        if(input.expected_financial_version!==current.financial_version||input.expected_payment_version!==current.payment_version)throw new HttpError('VERSION_CONFLICT');
        try {
          const saved=await scopedQuery<Saved>(cancel,['bookings.cancel'],`INSERT INTO shipit.booking_cancellations
            (id,organization_id,franchise_id,booking_id,actor_id,correlation_id,reason,key_digest,fingerprint,financial_version,payment_version,outstanding_paise,
             parcel_count,reversed_paise,refunded_paise,refunds,cancelled_at)
            SELECT $2,b.organization_id,b.franchise_id,b.id,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,GREATEST(b.confirmed_at,date_trunc('milliseconds',clock_timestamp())) FROM shipit.bookings b
            WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1
            RETURNING id,booking_id,parcel_count,outstanding_paise::text,reversed_paise::text,refunded_paise::text,refunds,cancelled_at`,
            [bookingId,randomUUID(),actor.id,correlation,input.reason,keyHash,fingerprint,current.financial_version,current.payment_version,
              current.outstanding_paise,current.parcel_count,current.reversed_paise,current.refund_paise,JSON.stringify(current.refunds)]);
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
