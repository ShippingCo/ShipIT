# Private attachments — Issue #31

[ADR 0021](../adr/0021-private-attachment-storage.md) is the pre-implementation decision.
This module owns private shipment evidence, upload validation, authorized access and
operational cleanup. It cannot complete delivery or decide legal retention.

## API and public model

All paths start `/api/v1/bookings/:booking_id/attachments`. All take narrowing query
selectors `organization_id` and `franchise_id`. They never establish authority.

| Method / suffix | Contract |
| --- | --- |
| POST `/uploads` | Idempotent reservation: purpose, optional parcel_id, kind, media_type, size_bytes, sha256. Strict fields; no filename/key/owner input. |
| PUT `/uploads/:upload_id/content` | Bounded octet stream; session/CSRF, expected checksum, immutable conditional object write and reconciliation. |
| POST `/uploads/:upload_id/finalize` | Empty JSON and Idempotency-Key; content detection, scan and atomic linking. |
| POST `/uploads/:upload_id/cancel` | Empty JSON and Idempotency-Key; cancel only unlinked uploads. |
| GET empty suffix | Bounded metadata only; optional parcel_id for assigned proof. |
| POST `/:attachment_id/download-grants` | Empty JSON and Idempotency-Key; signed relative URL plus fixed expiry. |
| GET `/:attachment_id/content` | Signed grant plus authenticated live R14; no-store bytes with safe generated name. |

Metadata explicitly exposes only id, booking_id, parcel_id, purpose, kind, generated
filename, declared size/media type, lifecycle/scan state, retention class, version,
created/expiry/linked timestamps. Provider paths, digest, scanner detail and command
fingerprints remain private. Org admins cannot obtain bytes. Agent SQL limits both list
and detail to current active assigned parcel proof. Unknown and foreign IDs return the
same 404. Current main cannot prove cross-franchise C; it remains closed (ADR 0014).

## Reliability and operator recovery

Reservation precedes Put. A bounded upload lease prevents simultaneous writers. Conditional
Put and Head reconcile an uncertain response using the same identity/checksum; no duplicate
key is allocated. All incomplete/cleanup-pending rows count against quota until absence is
verified. Finalize performs external validation outside SQL then live-authorizes and locks
again. A scan error remains unreadable and can be retried before expiry. Same key with
changed normalized intent conflicts; receipts survive restarts and are not pruned here.

Pending/quarantined uploads expire after 15 minutes. Cleanup becomes due 15 minutes later;
canceled/rejected uploads become due 15 minutes after the event. The API runtime runs a bounded cleanup tick after startup and every five minutes thereafter. Each tick handles at most 100 rows; #68 must monitor and size capacity for the backlog. Failed/uncertain deletes stay pending and retry; only confirmed absence
becomes a tombstone. Ready evidence is excluded, including from ordinary cancel. #72 must
supply reviewed parent-purpose expiry, legal periods and narrow holds before its destruction.

Apply the additive migration before enabling API and worker. Hosted configuration, private
bucket policy, storage encryption, TLS clamd proxy, scanner signature updates and worker capacity belong
to #68; backups to #69. Compatible rollback disables the feature but preserves reconciliable
identities and audit. Full counter-screen integration remains #33, delivery proof flow #42.

The evidence bucket must be unversioned (never enabled/suspended). Put/Delete verify GetBucketVersioning; runtime credentials require that read permission plus object Put/Head/Get/Delete. Versioning configuration is deployment-only and must be locked. #69 cannot enable versioning without a reviewed version-aware cleanup change. A cleanup tick has bounded rows/network calls; backlog or outage can extend the target interval.
