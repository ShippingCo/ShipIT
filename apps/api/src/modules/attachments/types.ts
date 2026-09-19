import type { AttachmentDto, AttachmentIntent } from '@shippingco/shared';
import type { Readable } from 'node:stream';
import type { TenantAccess } from '../security/scope.ts';
export type AttachmentAction = 'attachments.read' | 'attachments.write' | 'attachments.download' | 'attachments.audit' | 'attachments.cleanup';
export interface AttachmentScope { access: TenantAccess; agentOnly: boolean; metadataOnly: boolean }
export interface AttachmentRow extends Omit<AttachmentDto, 'filename' | 'size_bytes' | 'media_type' | 'created_at' | 'upload_expires_at' | 'linked_at'> {
  organization_id: string; franchise_id: string; object_key: string; declared_size: number;
  declared_type: AttachmentIntent['media_type']; expected_digest: string; actual_size: number | null;
  detected_type: string | null; digest: string | null; created_at: Date; upload_expires_at: Date;
  linked_at: Date | null; cleanup_due_at: Date | null; upload_lease_until: Date | null;
  upload_attempt: string | null; version: number; cleanup_attempts: number;
}
export interface StoredIdentity { uploadId: string; size: number; digest: string }
export interface StoredObject extends StoredIdentity { body: Readable }
export interface AttachmentObjectStore {
  head(key: string, signal?: AbortSignal): Promise<StoredIdentity | null>;
  put(key: string, body: Readable, identity: StoredIdentity, signal: AbortSignal): Promise<void>;
  get(key: string, signal?: AbortSignal): Promise<StoredObject>;
  delete(key: string, signal?: AbortSignal): Promise<void>;
  close?(): void;
}
export interface AttachmentScanner { scan(bytes: Buffer, signal?: AbortSignal): Promise<'clean' | 'infected' | 'error'> }
export interface AttachmentDependencies { store: AttachmentObjectStore; scanner: AttachmentScanner; signingKey: string; clock?: () => Date }
export function attachmentDto(row: AttachmentRow): AttachmentDto {
  const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'video/mp4': 'mp4' }[row.declared_type];
  return { id: row.id, booking_id: row.booking_id, parcel_id: row.parcel_id, purpose: row.purpose,
    kind: row.kind, filename: `${row.kind === 'image' ? 'photo' : row.kind === 'audio' ? 'voice-note' : 'video'}.${extension}`,
    size_bytes: row.declared_size, media_type: row.declared_type, state: row.state, scan_state: row.scan_state,
    retention_class: row.retention_class, version: row.version, created_at: row.created_at.toISOString(),
    upload_expires_at: row.upload_expires_at.toISOString(), linked_at: row.linked_at?.toISOString() ?? null };
}
