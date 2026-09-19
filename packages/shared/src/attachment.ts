/** Public policy mirrors for UX only; the API enforces every limit and permission. */
export const attachmentLimits = Object.freeze({ fileBytes: 8 * 1024 * 1024, count: 10, aggregateBytes: 32 * 1024 * 1024, pending: 3 });
export const attachmentMedia = Object.freeze({ 'image/jpeg': 'image', 'image/png': 'image', 'audio/mpeg': 'audio', 'audio/wav': 'audio', 'video/mp4': 'video' } as const);
export type AttachmentMedia = keyof typeof attachmentMedia;
export type AttachmentKind = typeof attachmentMedia[AttachmentMedia];
export type AttachmentPurpose = 'shipment_evidence' | 'parcel_proof';
export type AttachmentState = 'pending_upload' | 'quarantined' | 'ready' | 'canceled' | 'rejected' | 'cleanup_pending' | 'deleted';
export interface AttachmentDto {
  id: string; booking_id: string; parcel_id: string | null; purpose: AttachmentPurpose;
  kind: AttachmentKind; filename: string; size_bytes: number; media_type: AttachmentMedia;
  state: AttachmentState; scan_state: 'pending' | 'clean' | 'infected' | 'error';
  retention_class: 'operational_evidence' | 'delivery_proof'; version: number;
  created_at: string; upload_expires_at: string; linked_at: string | null;
}
export interface AttachmentIntent {
  purpose: AttachmentPurpose; parcel_id?: string; kind: AttachmentKind;
  media_type: AttachmentMedia; size_bytes: number; sha256: string;
}
export interface AttachmentDownloadGrant { url: string; expires_at: string }
