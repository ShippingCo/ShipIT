import { FieldValidationError } from '../../plugins/errors.ts';
import { object, integer, uuid } from '../pricing/validation.ts';
import type { PaymentCollectionInput, PaymentReversalInput } from './types.ts';
export { selection, idempotencyKey, uuid } from '../pricing/validation.ts';
function amount(b:Record<string,unknown>) {
  if(b.currency!=='INR')throw new FieldValidationError('currency','INVALID_FORMAT');
  return {amount_paise:integer(b.amount_paise,'amount_paise',1),currency:'INR' as const};
}
export function collection(value:unknown):PaymentCollectionInput {
  const b=object(value,['amount_paise','currency','context','method','collection_reference']);
  const money=amount(b);
  if(b.context!=='paid_counter'&&b.context!=='to_pay')throw new FieldValidationError('context','INVALID_FORMAT');
  if(b.method!=='cash'&&b.method!=='upi')throw new FieldValidationError('method','INVALID_FORMAT');
  return {...money,context:b.context,method:b.method,collection_reference:uuid(b.collection_reference,'collection_reference')};
}
export function reversal(value:unknown):PaymentReversalInput {
  const b=object(value,['amount_paise','currency','reason_code']),money=amount(b);
  if(!['duplicate_recording','incorrect_amount','collection_not_received'].includes(b.reason_code as string))throw new FieldValidationError('reason_code','INVALID_FORMAT');
  return {...money,reason_code:b.reason_code as PaymentReversalInput['reason_code']};
}
