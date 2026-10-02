import { HttpError } from '../../plugins/errors.ts';
import type { DeliveryAttemptRow } from './types.ts';
import { sendReservationPending } from './messaging.ts';

/** Shared staff/customer resend rules. Replacement alone may renew an expired challenge. */
export function assertResendPolicy(a:DeliveryAttemptRow,time:Date,latest:{reserved_at:Date;send_state:string;outbound_state:string|null}|undefined,replace=false) {
 if(a.id!==a.active_attempt_id||a.state!=='active'||a.parcel_status!=='out_for_delivery'||a.assigned_agent_id!==a.agent_id||a.superseded_at||a.consumed_at)
  throw new HttpError('PARCEL_STATE_CONFLICT');
 if(a.locked_at||a.failed_verifications>=5)throw new HttpError('DELIVERY_CHALLENGE_LOCKED');
 if(latest&&time.getTime()<latest.reserved_at.getTime()+60000)throw new HttpError('DELIVERY_RESEND_COOLDOWN');
 if(latest&&sendReservationPending(latest.outbound_state??latest.send_state))throw new HttpError('TEMPORARILY_UNAVAILABLE');
 if(a.resend_count>=3)throw new HttpError('DELIVERY_RESEND_LIMIT');
 if(!replace&&time>=a.expires_at)throw new HttpError('DELIVERY_CHALLENGE_EXPIRED');
}
