import type { DatabasePool } from '@shippingco/db';
import { withNextInboxScope } from '../security/jobs.ts';
import { scopedQuery } from '../security/scope.ts';

export function createInboxWorker(database:DatabasePool) {
  return {async tick() {
    return withNextInboxScope(database,async(scope,id)=>{
      const result=await scopedQuery<{result:string}>(scope,['whatsapp.inbox.work'],
        `SELECT shipit.whatsapp_inbox_process($1,$2,$3) AS result WHERE {{franchise:$1:$2}}`,
        [scope.context.organizationId,scope.context.permittedFranchiseIds[0],id]);
      return result.rows[0]!.result;
    });
  }};
}
