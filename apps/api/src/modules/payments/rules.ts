import { HttpError } from '../../plugins/errors.ts';
import { digest } from '../pricing/idempotency.ts';
import type { PaymentOperation, PaymentProjection, PaymentCollectionInput, PaymentReversalInput } from './types.ts';
const max=BigInt(Number.MAX_SAFE_INTEGER);
export function balance(gross:bigint,collected:bigint):Pick<PaymentProjection,'gross_paise'|'collected_paise'|'outstanding_paise'|'state'> {
  if(gross<0n||gross>max||collected<0n||collected>gross)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  return {gross_paise:Number(gross),collected_paise:Number(collected),outstanding_paise:Number(gross-collected),
    state:collected===gross?'settled':collected===0n?'uncollected':'partially_collected'};
}
export function collect(gross:bigint,collected:bigint,amount:number) {
  balance(gross,collected);
  if(!Number.isSafeInteger(amount)||amount<=0)throw new HttpError('VALIDATION_FAILED');
  if(BigInt(amount)>gross-collected)throw new HttpError('PAYMENT_OVER_COLLECTION');
  return balance(gross,collected+BigInt(amount));
}
export function reverse(gross:bigint,collected:bigint,original:bigint,reversed:bigint,amount:number) {
  balance(gross,collected);
  if(!Number.isSafeInteger(amount)||amount<=0)throw new HttpError('VALIDATION_FAILED');
  if(reversed<0n||reversed>original||BigInt(amount)>original-reversed||BigInt(amount)>collected)throw new HttpError('PAYMENT_REVERSAL_EXCEEDED');
  return balance(gross,collected-BigInt(amount));
}
export function fingerprint(operation:PaymentOperation,booking:string,obligation:string,target:string|null,body:PaymentCollectionInput|PaymentReversalInput) {
  return digest({operation_id:`api.v1.${operation}`,content_type:'application/json',query:{},
    resource_ids:{booking_id:booking,obligation_id:obligation,reversal_of:target},body});
}
