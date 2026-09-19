import { randomUUID } from 'node:crypto';
import { attachmentLimits, type AttachmentIntent } from '@shippingco/shared';
import { assertTenantAccess, scopedQuery, type TenantAccess } from '../security/scope.ts';
import { HttpError } from '../../plugins/errors.ts';
import type { AttachmentRow, AttachmentScope } from './types.ts';
const actions = ['attachments.read', 'attachments.write', 'attachments.download', 'attachments.cleanup'] as const;
/** Parent visibility is narrowed before optional Parcel/attachment lookups. */
export async function parent(s: AttachmentScope, booking: string, parcel: string | null, purpose: string, write: boolean) {
  const c = assertTenantAccess(s.access, actions);
  const row = (await scopedQuery<{ state: string; lifecycle: string }>(s.access, ['attachments.read','attachments.write','attachments.download'], `SELECT b.state,f.lifecycle FROM shipit.bookings b
    JOIN shipit.franchises f ON f.organization_id=b.organization_id AND f.id=b.franchise_id
    WHERE {{franchise:b.organization_id:b.franchise_id}} AND b.id=$1
    AND (NOT $2::boolean OR EXISTS(SELECT 1 FROM shipit.parcels p WHERE p.organization_id=b.organization_id AND p.franchise_id=b.franchise_id AND p.booking_id=b.id AND p.id=$3 AND p.assigned_agent_id=$4 AND p.active_attempt_id IS NOT NULL AND p.status='out_for_delivery'))
    FOR UPDATE OF b`, [booking, s.agentOnly, parcel, c.actor.id])).rows[0];
  if (!row || (s.agentOnly && purpose !== 'parcel_proof')) throw new HttpError('RESOURCE_NOT_FOUND');
  if (write && row.lifecycle !== 'active') throw new HttpError('FRANCHISE_DISABLED');
  if (write && row.state !== 'active') throw new HttpError('PARCEL_STATE_CONFLICT');
  if (parcel) {
    const found = (await scopedQuery(s.access, ['attachments.read','attachments.write','attachments.download'], `SELECT p.id FROM shipit.parcels p
      WHERE {{franchise:p.organization_id:p.franchise_id}} AND p.booking_id=$1 AND p.id=$2
      AND (NOT $3::boolean OR (p.assigned_agent_id=$4 AND p.active_attempt_id IS NOT NULL AND p.status='out_for_delivery')) FOR SHARE`, [booking, parcel, s.agentOnly, c.actor.id])).rows[0];
    if (!found) throw new HttpError('RESOURCE_NOT_FOUND');
  }
}
export async function find(s: AttachmentScope, booking: string, id: string) {
  const c = assertTenantAccess(s.access, actions);
  const row = (await scopedQuery<AttachmentRow>(s.access, ['attachments.read','attachments.write','attachments.download','attachments.cleanup'], `SELECT a.* FROM shipit.attachments a
    WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.booking_id=$1 AND a.id=$2
    AND (NOT $3::boolean OR (a.purpose='parcel_proof' AND EXISTS(SELECT 1 FROM shipit.parcels p WHERE p.organization_id=a.organization_id AND p.franchise_id=a.franchise_id AND p.booking_id=a.booking_id AND p.id=a.parcel_id AND p.assigned_agent_id=$4 AND p.active_attempt_id IS NOT NULL AND p.status='out_for_delivery'))) FOR UPDATE OF a`, [booking, id, s.agentOnly, c.actor.id])).rows[0];
  if (!row) throw new HttpError('RESOURCE_NOT_FOUND');
  return row;
}
export async function list(s: AttachmentScope, booking: string, parcel: string | null) {
  const c = assertTenantAccess(s.access, ['attachments.read']);
  return (await scopedQuery<AttachmentRow>(s.access, ['attachments.read'], `SELECT a.* FROM shipit.attachments a
    WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.booking_id=$1 AND a.state<>'deleted' AND ($2::uuid IS NULL OR a.parcel_id=$2)
    AND (NOT $3::boolean OR (a.purpose='parcel_proof' AND EXISTS(SELECT 1 FROM shipit.parcels p WHERE p.organization_id=a.organization_id AND p.franchise_id=a.franchise_id AND p.booking_id=a.booking_id AND p.id=a.parcel_id AND p.assigned_agent_id=$4 AND p.active_attempt_id IS NOT NULL AND p.status='out_for_delivery')))
    ORDER BY a.created_at,a.id LIMIT 10`, [booking, parcel, s.agentOnly, c.actor.id])).rows;
}
export async function quota(scope: TenantAccess, booking: string, size: number) {
  const row = (await scopedQuery<{ count: number; bytes: number; pending: number }>(scope, ['attachments.write'], `SELECT count(*)::int AS count,coalesce(sum(declared_size),0)::int AS bytes,count(*) FILTER(WHERE state<>'ready')::int AS pending
    FROM shipit.attachments WHERE {{franchise:organization_id:franchise_id}} AND booking_id=$1 AND state<>'deleted'`, [booking])).rows[0]!;
  if (row.count >= attachmentLimits.count || row.bytes + size > attachmentLimits.aggregateBytes || row.pending >= attachmentLimits.pending) throw new HttpError('ATTACHMENT_LIMIT_EXCEEDED');
}
export async function insert(scope: TenantAccess, booking: string, input: AttachmentIntent, now: Date) {
  const c = assertTenantAccess(scope, ['attachments.write']), id = randomUUID();
  return (await scopedQuery<AttachmentRow>(scope, ['attachments.write'], `INSERT INTO shipit.attachments
    (id,organization_id,franchise_id,booking_id,parcel_id,purpose,kind,object_key,declared_size,declared_type,expected_digest,retention_class,initiated_actor,actor_type,actor_id,correlation_id,created_at,upload_expires_at,cleanup_due_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::uuid,'user',$12::text,$13,$14,$14::timestamptz+interval '15 minutes',$14::timestamptz+interval '30 minutes' WHERE {{franchise:$15:$2}} RETURNING *`,
  [id,c.permittedFranchiseIds[0],booking,input.parcel_id??null,input.purpose,input.kind,`evidence/${randomUUID()}`,input.size_bytes,input.media_type,input.sha256,
    input.purpose==='parcel_proof'?'delivery_proof':'operational_evidence',c.actor.id,c.correlationId,now,c.organizationId])).rows[0]!;
}
export async function replay<T>(scope: TenantAccess, operation: string, key: string, fingerprint: string): Promise<T | null> {
  const c = assertTenantAccess(scope, ['attachments.write','attachments.download']);
  const row = (await scopedQuery<{ fingerprint: string; result: T }>(scope, ['attachments.write','attachments.download'], `SELECT fingerprint,result FROM shipit.attachment_commands
    WHERE {{franchise:organization_id:franchise_id}} AND principal_id=$1 AND operation=$2 AND key_digest=$3`, [c.actor.id, operation, key])).rows[0];
  if (!row) return null;
  if (row.fingerprint !== fingerprint) throw new HttpError('IDEMPOTENCY_CONFLICT');
  return row.result;
}
export async function receipt(scope: TenantAccess, row: AttachmentRow, operation: string, key: string, fingerprint: string, result: object, now: Date) {
  const c = assertTenantAccess(scope, ['attachments.write','attachments.download']);
  await scopedQuery(scope, ['attachments.write','attachments.download'], `INSERT INTO shipit.attachment_commands
    (id,organization_id,franchise_id,booking_id,attachment_id,principal_id,operation,key_digest,fingerprint,result,created_at)
    SELECT $1,{{organization}},$2,$3,$4,$5,$6,$7,$8,$9,$10 WHERE {{franchise:$11:$2}}`, [randomUUID(),c.permittedFranchiseIds[0],row.booking_id,row.id,c.actor.id,operation,key,fingerprint,result,now,c.organizationId]);
}
export async function update(scope: TenantAccess, row: AttachmentRow, changes: Partial<Pick<AttachmentRow, 'state'|'scan_state'|'actual_size'|'detected_type'|'digest'|'linked_at'|'cleanup_due_at'|'upload_lease_until'|'upload_attempt'>> & { uploaded_at?: Date; validated_at?: Date; deleted_at?: Date; cleanup_attempts?: number }) {
  const c = assertTenantAccess(scope, ['attachments.write','attachments.cleanup']);
  // Fixed column map; all values remain parameters. No caller-controlled SQL identifier.
  const columns = ['state','scan_state','actual_size','detected_type','digest','linked_at','cleanup_due_at','upload_lease_until','upload_attempt','uploaded_at','validated_at','deleted_at','cleanup_attempts'] as const;
  const values: unknown[] = [row.id,row.version,c.actor.type,c.actor.id,c.correlationId];
  const sets: string[] = [];
  for (const name of columns) if (Object.hasOwn(changes,name)) { values.push(changes[name]); sets.push(`${name}=$${values.length}`); }
  const updated = (await scopedQuery<AttachmentRow>(scope, ['attachments.write','attachments.cleanup'], `UPDATE shipit.attachments SET ${sets.join(',')},version=version+1,actor_type=$3,actor_id=$4,correlation_id=$5
    WHERE {{franchise:organization_id:franchise_id}} AND id=$1 AND version=$2 RETURNING *`, values)).rows[0];
  if (!updated) throw new HttpError('VERSION_CONFLICT');
  return updated;
}
export async function cleanupCandidate(scope: TenantAccess, now: Date) {
  return (await scopedQuery<AttachmentRow>(scope, ['attachments.cleanup'], `SELECT a.* FROM shipit.attachments a
    WHERE {{franchise:a.organization_id:a.franchise_id}} AND a.state NOT IN ('ready','deleted') AND a.cleanup_due_at<=$1
    AND (a.upload_lease_until IS NULL OR a.upload_lease_until<$1) ORDER BY a.cleanup_due_at,a.id LIMIT 1 FOR UPDATE SKIP LOCKED`, [now])).rows[0];
}
