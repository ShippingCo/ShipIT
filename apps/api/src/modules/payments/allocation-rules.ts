import {HttpError} from '../../plugins/errors.ts';
const max=BigInt(Number.MAX_SAFE_INTEGER);
const sourceAmount=(amount:bigint)=>{if(amount<0n||amount>max)throw new HttpError('TEMPORARILY_UNAVAILABLE');};
const commandAmount=(amount:number)=>{if(!Number.isSafeInteger(amount)||amount<=0)throw new HttpError('VALIDATION_FAILED');return BigInt(amount);};
/** Actual receipt inflow is distinct from its application to customer obligations. */
export function receiptBalance(received:bigint,allocated:bigint){
  sourceAmount(received);sourceAmount(allocated);
  if(allocated>received)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  return {currency:'INR' as const,received_paise:Number(received),allocated_paise:Number(allocated),unallocated_paise:Number(received-allocated)};
}
/** Call only after receipt and obligation locks; these observations grant no authority. */
export function allocate(received:bigint,allocated:bigint,outstanding:bigint,amount:number){
  receiptBalance(received,allocated);sourceAmount(outstanding);const value=commandAmount(amount);
  if(value>received-allocated||value>outstanding)throw new HttpError('ALLOCATION_CONFLICT');
  return receiptBalance(received,allocated+value);
}
/** Release a linked application, never create an inflow or record money leaving. */
export function releaseAllocation(received:bigint,allocated:bigint,original:bigint,released:bigint,amount:number){
  receiptBalance(received,allocated);sourceAmount(original);sourceAmount(released);
  if(original>received||released>original)throw new HttpError('TEMPORARILY_UNAVAILABLE');
  const value=commandAmount(amount);
  if(value>original-released||value>allocated)throw new HttpError('ALLOCATION_CONFLICT');
  return receiptBalance(received,allocated-value);
}
