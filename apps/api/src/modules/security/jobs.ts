import { randomUUID } from 'node:crypto';
import { withTransaction, type DatabasePool, type TransactionExecutor } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { issueTenantAccess, type TenantAccess } from './scope.ts';

// Legacy installation-specific scope seam. Generic outbox authority below derives
// ownership from persisted jobs/events and does not require a provider installation.
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

/** Global scheduler sees only one due owner pair from the fixed definer function.
 * No client selector, object identity/key, issuer or executor crosses this boundary. */
export async function withNextAttachmentCleanupScope<T>(database:DatabasePool,now:Date,work:(scope:TenantAccess)=>Promise<T>):Promise<T|null> {
  return withTransaction(database,async tx=>{
    const row=(await tx.query<{organization_id:string;franchise_id:string}>(
      'SELECT organization_id,franchise_id FROM shipit.attachment_cleanup_scope($1)',[now])).rows[0];
    if(!row)return null;
    const scope=issueTenantAccess(tx,{action:'attachments.cleanup',actor:{type:'service',id:'attachment-cleanup'},
      organizationId:row.organization_id,permittedFranchiseIds:[row.franchise_id],organizationWide:false,
      correlationId:randomUUID(),provenance:'trusted-event'});
    return work(scope);
  });
}

/** Fixed definer queries return only persisted owner references, never event bodies. */
export async function withNextOutboxScope<T>(database:DatabasePool,consumer:string,types:readonly string[],
  mode:'relay'|'claim'|'alert',now:Date|null,work:(scope:TenantAccess)=>Promise<T>):Promise<T|null> {
  return withTransaction(database,async tx=>{
    const row=(await tx.query<{organization_id:string;franchise_id:string}>(
      'SELECT organization_id,franchise_id FROM shipit.outbox_next_scope($1,$2,$3,$4)',[consumer,types,mode,now])).rows[0];
    if(!row)return null;
    return work(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:row.organization_id,
      permittedFranchiseIds:[row.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}));
  });
}
export async function withOutboxJobScope<T>(database:DatabasePool,job:string,work:(scope:TenantAccess)=>Promise<T>):Promise<T|null> {
  return withTransaction(database,async tx=>{
    await tx.query("SET LOCAL transaction_timeout = '25s'");
    const row=(await tx.query<{organization_id:string;franchise_id:string}>(
      'SELECT organization_id,franchise_id FROM shipit.outbox_job_scope($1)',[job])).rows[0];
    if(!row)return null;
    return work(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:row.organization_id,
      permittedFranchiseIds:[row.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}));
  });
}
