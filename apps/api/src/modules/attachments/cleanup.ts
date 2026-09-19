import type { DatabasePool } from '@shippingco/db';
import { withNextAttachmentCleanupScope } from '../security/jobs.ts';
import type { AttachmentObjectStore } from './types.ts';
import * as r from './repository.ts';
/** One bounded tick; #68 schedules every five minutes. Counts contain no private keys. */
export function createAttachmentCleanup(database:DatabasePool,store:AttachmentObjectStore,clock:()=>Date=()=>new Date()) {
  return {async tick(limit=100,abort?:AbortSignal){
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Error('CLEANUP_LIMIT_INVALID');
    const result={deleted:0,retry:0};
    for(let i=0;i<limit&&!abort?.aborted;i++){
      const outcome=await withNextAttachmentCleanupScope(database,clock(),async scope=>{
        let row=await r.cleanupCandidate(scope,clock());if(!row)return 'empty';
        row=await r.update(scope,row,{state:'cleanup_pending',cleanup_attempts:row.cleanup_attempts+1,upload_attempt:null,upload_lease_until:null});
        try{
          const timeout=AbortSignal.timeout(2000),signal=abort?AbortSignal.any([abort,timeout]):timeout;
          await store.delete(row.object_key,signal);
          if(await store.head(row.object_key,signal))throw new Error('DELETE_UNCONFIRMED');
        }catch{
          await r.update(scope,row,{cleanup_due_at:new Date(clock().getTime()+300000)});return 'retry';
        }
        await r.update(scope,row,{state:'deleted',deleted_at:clock(),cleanup_due_at:null,actual_size:null,digest:null,detected_type:null});
        return 'deleted';
      });
      if(outcome===null||outcome==='empty')break;
      result[outcome]++;
    }
    return result;
  }};
}
