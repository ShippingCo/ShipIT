import { randomUUID } from 'node:crypto';
import { DatabaseError,withTransaction, type DatabasePool, type TransactionExecutor } from '@shippingco/db';
import { HttpError } from '../../plugins/errors.ts';
import { issueTenantAccess, type TenantAccess } from './scope.ts';
import type { InboxInput } from '../whatsapp/webhook-payload.ts';

/** A hashed grant selects its persisted owner; a docket/phone never supplies scope. */
export async function withCustomerTrackingScope<T>(database:DatabasePool,digest:string,work:(scope:TenantAccess)=>Promise<T>) {
  let domainError:HttpError|undefined;
  try { return await withTransaction(database,async tx=>{
    try {
    const row=(await tx.query<{organization_id:string;franchise_id:string}>(
      'SELECT organization_id,franchise_id FROM shipit.customer_tracking_scope($1)',[digest])).rows[0];
    if(!row)throw new HttpError('RESOURCE_NOT_FOUND');
    return await work(issueTenantAccess(tx,{action:'customer.tracking.read',actor:{type:'service',id:'customer-tracking'},
      organizationId:row.organization_id,permittedFranchiseIds:[row.franchise_id],organizationWide:false,
      correlationId:randomUUID(),provenance:'trusted-event'}));
    } catch(error) {if(error instanceof HttpError)domainError=error;throw error;}
  }); } catch(error) {
    if(domainError&&error instanceof DatabaseError&&error.code==='DB_TRANSACTION_FAILED')throw domainError;
    throw new HttpError('TEMPORARILY_UNAVAILABLE');
  }
}

/** Deployment-only cutover. Owner pairs come from validated server configuration and the
 * definer function accepts only existing tenant owners and the fixed consumer registry. */
export async function activateNotificationPolicies(database:DatabasePool,owners:readonly {organization_id:string;franchise_id:string}[],policies:unknown) {
  try {
    await withTransaction(database,async tx=>{
      for(const owner of owners)await tx.query('SELECT shipit.notification_policy_activate($1,$2,$3)',
        [owner.organization_id,owner.franchise_id,JSON.stringify(policies)]);
    });
  } catch(error) {
    if(error instanceof DatabaseError&&error.sqlState==='P0040')throw new Error('NOTIFICATION_POLICY_VERSION_CONFLICT',{cause:error});
    throw error;
  }
}

/** References are resolved from the durable outbound ledger, never from client ownership. */
export async function withOutboundScope<T>(database:DatabasePool,target:string|null,now:Date|null,work:(scope:TenantAccess,id:string)=>Promise<T>,attention=false):Promise<T|null> {
  return withTransaction(database,async tx=>{
    await tx.query("SET LOCAL transaction_timeout = '25s'");
    const row=(await tx.query<{organization_id:string;franchise_id:string;intent_id:string}>(
      'SELECT organization_id,franchise_id,intent_id FROM shipit.whatsapp_outbound_scope($1,$2,$3)',[target,now,attention])).rows[0];
    if(!row)return null;
    return work(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:row.organization_id,
      permittedFranchiseIds:[row.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),row.intent_id);
  });
}

/** Called only after raw-byte authentication/normalization. No caller-supplied tenant scope. */
export async function persistBusinessWebhook(database:DatabasePool,events:readonly InboxInput[],wabas:readonly string[],correlation:string) {
  return withTransaction(database,async tx=>{
    const result=await tx.query<{whatsapp_receive:number}>('SELECT shipit.whatsapp_receive($1,$2,$3)',[JSON.stringify(events),wabas,correlation]);
    return result.rows[0]?.whatsapp_receive??0;
  });
}
/** The selection lock, projection and completion share one bounded transaction. */
export async function withNextInboxScope<T>(database:DatabasePool,work:(scope:TenantAccess,id:string)=>Promise<T>):Promise<T|null> {
  return withTransaction(database,async tx=>{
    await tx.query("SET LOCAL transaction_timeout = '25s'");
    const row=(await tx.query<{organization_id:string;franchise_id:string;inbox_id:string}>(
      'SELECT organization_id,franchise_id,inbox_id FROM shipit.whatsapp_inbox_next()')).rows[0];
    if(!row)return null;
    return work(issueTenantAccess(tx,{action:'whatsapp.inbox.work',actor:{type:'service',id:'whatsapp-inbox-worker'},organizationId:row.organization_id,
      permittedFranchiseIds:[row.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),row.inbox_id);
  });
}

/** Signed inbox ownership only; a savepoint removes all tool effects before fallback. */
export async function withNextConversationScope<T>(database:DatabasePool,work:(scope:TenantAccess,id:string)=>Promise<T>,
 fallback:(scope:TenantAccess,id:string)=>Promise<T>):Promise<T|null> {
 return withTransaction(database,async tx=>{
  await tx.query("SET LOCAL transaction_timeout = '15s'");
  await tx.query("SET LOCAL statement_timeout = '3s'");
  await tx.query("SET LOCAL lock_timeout = '1s'");
  const row=(await tx.query<{organization_id:string;franchise_id:string;inbox_id:string}>(
   'SELECT organization_id,franchise_id,inbox_id FROM shipit.customer_conversation_next()')).rows[0];
  if(!row)return null;
  const scope=issueTenantAccess(tx,{action:'whatsapp.inbox.work',actor:{type:'service',id:'whatsapp-inbox-worker'},organizationId:row.organization_id,
   permittedFranchiseIds:[row.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'});
  await tx.query('SAVEPOINT conversation_tool');
  try {const result=await work(scope,row.inbox_id);await tx.query('RELEASE SAVEPOINT conversation_tool');return result;}
  catch {await tx.query('ROLLBACK TO SAVEPOINT conversation_tool');return fallback(scope,row.inbox_id);}
 });
}

/** Consent consumption has an independent durable receipt; inbox completion is not opt-in. */
export async function withNextConsentScope<T>(database:DatabasePool,work:(scope:TenantAccess,id:string)=>Promise<T>):Promise<T|null> {
  return withTransaction(database,async tx=>{
    await tx.query("SET LOCAL transaction_timeout = '25s'");
    const row=(await tx.query<{organization_id:string;franchise_id:string;inbox_id:string}>(
      'SELECT organization_id,franchise_id,inbox_id FROM shipit.whatsapp_consent_next()')).rows[0];
    if(!row)return null;
    return work(issueTenantAccess(tx,{action:'whatsapp.consent.work',actor:{type:'service',id:'whatsapp-consent-worker'},organizationId:row.organization_id,
      permittedFranchiseIds:[row.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),row.inbox_id);
  });
}

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

/** Expired/terminal challenge ownership is selected only by the fixed definer scheduler. */
export async function withNextDeliveryCleanupScope<T>(database:DatabasePool,now:Date,work:(scope:TenantAccess,id:string)=>Promise<T>):Promise<T|null> {
  return withTransaction(database,async tx=>{
    const row=(await tx.query<{organization_id:string;franchise_id:string;challenge_id:string}>(
      'SELECT organization_id,franchise_id,challenge_id FROM shipit.delivery_challenge_cleanup_scope($1)',[now])).rows[0];
    if(!row)return null;
    return work(issueTenantAccess(tx,{action:'deliveries.cleanup',actor:{type:'service',id:'delivery-cleanup'},organizationId:row.organization_id,
      permittedFranchiseIds:[row.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),row.challenge_id);
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

/** Route-delay fanout ownership is derived only from the persisted root selected by
 * the fixed database scheduler. One item and its progress commit per transaction. */
export async function withNextRouteDelayFanoutScope<T>(database:DatabasePool,now:Date,work:(scope:TenantAccess,id:string)=>Promise<T>):Promise<T|null> {
  return withTransaction(database,async tx=>{
    await tx.query("SET LOCAL transaction_timeout = '25s'");
    const row=(await tx.query<{organization_id:string;franchise_id:string;fanout_id:string}>(
      'SELECT organization_id,franchise_id,fanout_id FROM shipit.route_delay_fanout_scope($1)',[now])).rows[0];
    if(!row)return null;
    return work(issueTenantAccess(tx,{action:'outbox.work',actor:{type:'service',id:'outbox-worker'},organizationId:row.organization_id,
      permittedFranchiseIds:[row.franchise_id],organizationWide:false,correlationId:randomUUID(),provenance:'trusted-event'}),row.fanout_id);
  });
}
