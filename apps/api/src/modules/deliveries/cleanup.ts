import type { DatabasePool } from '@shippingco/db';
import { withNextDeliveryCleanupScope } from '../security/jobs.ts';
import { destroyExpiredSecret } from './repository.ts';

export function createDeliveryChallengeCleanup(database:DatabasePool,clock:()=>Date=()=>new Date()){
 return {async tick(limit=100,abort?:AbortSignal){if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('CLEANUP_LIMIT_INVALID');let destroyed=0;
  for(let index=0;index<limit&&!abort?.aborted;index++){const result=await withNextDeliveryCleanupScope(database,clock(),(scope,id)=>destroyExpiredSecret(scope,id,clock()));if(result===null)break;if(result)destroyed++;}
  return {destroyed};
 }};
}
