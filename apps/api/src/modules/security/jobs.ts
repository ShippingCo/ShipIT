import { withTransaction, type DatabasePool, type TransactionExecutor } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { issueTenantAccess, type TenantAccess } from './scope.ts';

// No durable job implementation exists yet. A future adapter must load/lock these
// facts from its persisted installation/event records, never from the queue body.
export interface TrustedJobRecord {
  readonly eventId: string;
  readonly installationId: string;
  readonly active: boolean;
  readonly organizationId: string;
  readonly franchiseId: string;
  readonly serviceId: string;
  readonly correlationId: string;
  readonly permittedActions: readonly ('franchise.profile.read' | 'franchise.profile.list')[];
}
export interface TrustedJobResolver {
  resolve(tx: TransactionExecutor, eventId: string, installationId: string): Promise<TrustedJobRecord | null>;
}
export async function withTrustedJobScope<T>(database: DatabasePool, resolver: TrustedJobResolver,
  identity: { eventId: string; installationId: string }, action: 'franchise.profile.read' | 'franchise.profile.list',
  work: (scope: TenantAccess) => Promise<T>): Promise<T> {
  let denied = false;
  try {
    return await withTransaction(database, async tx => {
      const record = await resolver.resolve(tx, identity.eventId, identity.installationId);
      if (!record || !record.active || record.eventId !== identity.eventId || record.installationId !== identity.installationId ||
        !record.permittedActions.includes(action)) { denied = true; throw new HttpError('ACTION_FORBIDDEN'); }
      const scope = issueTenantAccess(tx, { action, actor: {type:'service',id:record.serviceId},
        organizationId:record.organizationId,permittedFranchiseIds:[record.franchiseId],organizationWide:false,
        correlationId:record.correlationId,provenance:'trusted-event' });
      return work(scope);
    });
  } catch { throw new HttpError(denied ? 'ACTION_FORBIDDEN' : 'TEMPORARILY_UNAVAILABLE'); }
}
