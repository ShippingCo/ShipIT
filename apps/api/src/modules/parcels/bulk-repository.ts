import { randomUUID } from 'node:crypto';
import { assertTenantAccess, scopedQuery, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';

/** Immutable orchestration identity only. Item receipts own results and business effects. */
export async function bindBulkIntent(scope: TenantAccess, key: string, fingerprint: string, count: number) {
  const c = assertTenantAccess(scope, ['parcels.check_in','parcels.dispatch']);
  await scopedQuery(scope, ['parcels.check_in','parcels.dispatch'], `INSERT INTO shipit.parcel_bulk_requests
    (id,organization_id,franchise_id,principal_id,key_digest,fingerprint,action,item_count,correlation_id)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8 WHERE {{franchise:$9:$2}}
    ON CONFLICT (organization_id,franchise_id,principal_id,key_digest) DO NOTHING`,
  [randomUUID(),c.permittedFranchiseIds[0],c.actor.id,key,fingerprint,c.action,count,c.correlationId,c.organizationId]);
  const row = (await scopedQuery<{fingerprint:string}>(scope, ['parcels.check_in','parcels.dispatch'],
    `SELECT fingerprint FROM shipit.parcel_bulk_requests WHERE {{franchise:organization_id:franchise_id}}
      AND principal_id=$1 AND key_digest=$2`, [c.actor.id,key])).rows[0];
  if (!row || row.fingerprint !== fingerprint) throw new HttpError('IDEMPOTENCY_CONFLICT');
}
