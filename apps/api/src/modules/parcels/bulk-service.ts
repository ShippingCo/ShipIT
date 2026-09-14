import type { DatabasePool } from '@shippingco/db';
import { bulkParcelFailureCodes, type BulkParcelFailureCode, type BulkParcelResult } from '@shippingco/shared';
import { HttpError } from '../../plugins/errors.ts';
import { withParcelCommandScope } from '../memberships/service.ts';
import { idempotencyKey, selection } from '../bookings/validation.ts';
import { digest, keyDigest } from '../pricing/idempotency.ts';
import { createParcelService } from './service.ts';
import { bulkCommand } from './bulk-validation.ts';
import { bindBulkIntent } from './bulk-repository.ts';

export function createParcelBulkService(database: DatabasePool, parcels = createParcelService(database)) {
  return { async execute(session: string, queryInput: unknown, keyInput: unknown, rawHeaders: readonly string[], bodyInput: unknown, correlation: string): Promise<BulkParcelResult> {
    const selected = selection(queryInput), body = bulkCommand(bodyInput), key = keyDigest(idempotencyKey(keyInput,rawHeaders));
    const operation = `parcels.${body.action}` as const;
    const fingerprint = digest({ operation_id:'api.v1.parcels.bulk',normalization_version:1,
      content_type:'application/json',scope:selected,body });
    // Short, separately committed identity transaction. Never hold it during item work.
    await withParcelCommandScope(database,session,selected.organizationId,selected.franchiseId,operation,correlation,
      scopes => bindBulkIntent(scopes.command,key,fingerprint,body.items.length));
    const items: BulkParcelResult['items'] = [];
    for (const item of body.items) {
      try {
        const result = await parcels.execute(session,item.parcel_id,
          { organization_id:selected.organizationId,franchise_id:selected.franchiseId },item.idempotency_key,['idempotency-key',item.idempotency_key],item.command,operation,correlation);
        items.push({ parcel_id:item.parcel_id,outcome:'succeeded',result });
      } catch (error) {
        // An interrupted commit cannot truthfully be labelled an item failure. Stop and
        // recover the same immutable batch; earlier commits retain their owning receipts.
        if (!(error instanceof HttpError) || !bulkParcelFailureCodes.includes(error.code as BulkParcelFailureCode)) throw error;
        items.push({ parcel_id:item.parcel_id,outcome:'failed',error:{ code:error.code as BulkParcelFailureCode } });
      }
    }
    const succeeded = items.filter(item => item.outcome === 'succeeded').length;
    return { action:body.action,items,summary:{ succeeded,failed:items.length-succeeded } };
  } };
}
