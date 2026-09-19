# ADR 0021: Private attachment storage and validation

Status: implementation decision recorded **before code** for Issue #31; independent
acceptance through the reviewed PR. Date: 2026-09-19. Starting main:
`35d91c2c1bb7d64a6606ea1f3e9c5adccba3df42` (PR #114).

## Decision and authority

ADRs 0003/0006/0007/0008/0009/0013/0014 remain authoritative. All #2–#30
merge commits are ancestors of the clean baseline; main run 35121785412 passed.
This settles D09's application design under the user's explicit #31 authorization.
It does not assert independent approval, deployment or legal retention certification.

1. PostgreSQL owns metadata and composite Organization/Franchise/Booking/optional
   Parcel identity. A single Attachment identity also represents its upload. Binary
   bytes live in private S3-compatible storage behind `AttachmentObjectStore`.
   AWS SDK v3 implements signed Put/Head/Get/Delete; hosted vendor/account is #68.
   No public ACL, public bucket, client-supplied key or permanent public URL. The evidence bucket must never have versioning enabled: Put/Delete check GetBucketVersioning and fail closed on Enabled/Suspended, so delete markers cannot masquerade as physical cleanup. #69 must design recovery independently of implicit evidence versions.
2. Keys are random UUIDs under a constant opaque namespace, without tenant/customer
   names, phone, filename or addresses. One immutable key per upload; single-object
   conditional Put (`If-None-Match: *`) prevents overwrite and bounds uncertainty.
   Provider metadata binds the upload UUID, declared byte count and expected SHA-256.
   Uploading uses the expected digest only as a checksum assertion; validation computes
   the digest from actual stored bytes. Provider checksums and metadata are reconciled.
3. Server-mediated `application/octet-stream` upload has live W22 and CSRF before
   reading. A byte-counting stream enforces both declared size and the absolute limit,
   including chunked requests. No global JSON limit change (256 KiB), base64, multipart
   session or unbounded buffer. The SDK gets one bounded stream and no automatic retries.
   A committed reservation precedes external I/O. External I/O never masquerades as SQL.
4. Pilot limits: **8 MiB (8,388,608 bytes) per file**, nonempty; **10 active objects**,
   **32 MiB aggregate reserved bytes per Booking**, **3 incomplete uploads per Booking**.
   Pending, quarantined and cleanup-pending objects reserve quota until confirmed deletion;
   ready objects continue reserving it. Booking row locks and database constraints protect
   concurrent reservations. These are conservative pilot capacity choices, explicitly
   ratifying 8 MiB for evidence rather than copying a browser localStorage requirement.
5. Closed types: photo `image/jpeg`, `image/png`; voice `audio/mpeg`, `audio/wav`;
   video `video/mp4`. `file-type` detects bytes; declared kind/type must agree exactly.
   Unsupported/ambiguous content is rejected. No SVG, HTML, archive, executable or URL.
   Header detection is not a complete decoder or polyglot-proof sanitizer. ClamAV must
   independently scan every complete stored object. Browser image re-encoding strips
   common EXIF from the derivative; no claim of complete media metadata removal.
6. `AttachmentScanner` has a real clamd INSTREAM adapter using Node sockets, a bounded
   response, a deadline and exact clean/infected/error parsing. Hosted sockets use TLS
   with peer verification (a local clamd proxy is provisioned by #68); only explicit
   developer configuration permits plaintext loopback. Timeout, transport/protocol error,
   oversize and unknown response are never clean. No process execution or shell arguments.
7. States: `pending_upload → quarantined → ready`; quarantine may become `rejected`
   or remain quarantined with `scan_state=error`. Pending/quarantine may be canceled.
   Unlinked expiry/canceled/rejected → `cleanup_pending → deleted`. Deleted is a retained
   tombstone. `ready` requires actual size/digest/detected type, clean scan and linked time.
   Identity/purpose/parent/declared intent never change. Version increases per transition.
8. Upload expiry is **15 minutes** from initiation and is never extended by retry.
   Pending/quarantined expiry is eligible for cleanup at expiry + **15 minutes**;
   cancellation/rejection at event + **15 minutes**. A bounded cleanup tick runs every
   **5 minutes** in the configured API runtime, targeting deletion within 20 minutes of cancellation/rejection or after upload expiry when there is no backlog; tick processing time, backlog and outages extend this target. A deterministic worker
   entry point implements the tick here. The runtime starts after one second and schedules the next tick five minutes after completion; #68 sizes replicas and monitors backlog.
9. Storage uncertainty retains the original object identity and reservation. A retry
   Heads and reconciles the same object before attempting conditional creation. Missing
   bytes are retryable before expiry. A partial, mismatched or failed upload never links.
   Cancellation cannot race deletion with an in-flight Put: upload attempts have a bounded
   lease/deadline, while deletion eligibility exceeds that deadline. Delete is idempotent;
   verify absence before tombstoning. Uncertain deletion keeps quota and retry state.
10. Finalization loads only the authorized upload, retrieves and bounds stored bytes,
    verifies identity/size/digest/content, scans outside a SQL transaction, then rechecks
    live authorization and version/expiry before linking. Concurrent finalizations converge
    under row locking; command receipt and safe audit commit with the single transition.
    Lost response/restart retries return the original result without repeating an audit.
11. R14 remains metadata-only for org_admin. Franchise_admin/operator/dispatcher may
    read approved evidence under F; only franchise_admin/operator have W22 F. A delivery
    agent may upload/read **parcel_proof** only with matching current persisted assignment
    and active attempt; booking-wide **shipment_evidence** is denied. Agent lists are
    parcel-restricted in SQL. Mixed roles are explicit independent grants. Accountant and
    read_only are denied both R14/W22. As ADR 0014 documents, current main has no durable
    cross-franchise custody authority: C stays fail-closed until its owning domain supplies
    that evidence; a role, route or organization match cannot stand in for custody.
12. Short-lived download capabilities are signed **application URLs**, not S3 presigns.
    TTL is exactly **60 seconds**. The authenticated byte endpoint rechecks R14, purpose,
    current membership/assignment, clean/ready state, version and signed session binding.
    This deliberately strengthens revocation over direct provider URLs: authority loss or
    cancellation/unavailability prevents new retrieval immediately, even within TTL.
    Already delivered bytes and a stream already authorized cannot be recalled.
13. Grant issuance is an idempotent CSRF-protected command and leaves a reference-only
    audit. Persist only its safe receipt (identity/expiry/version), never signed URL/token.
    Replaying does not extend expiry. Grant/download responses are no-store, nosniff and
    use a generated safe filename. Logs include route templates only, never URL queries.
14. Retention classes are `operational_evidence` and `delivery_proof`, derived from
    immutable purpose. Operational cleanup only removes unlinked temporary/rejected bytes.
    Ready evidence cannot be deleted by ordinary W22 cancellation. #72 owns final legal
    applicability, parent-purpose expiry, narrow holds and authorized deletion execution.
    No whole-customer hold or universal numerical legal period is invented. Safe tombstones
    preserve ID/class/state/deletion time; temporary internal metadata can be minimized.
15. Private byte access uses the API's storage identity; upload never grants read authority.
    Storage outage yields a controlled unavailable result, retaining resumable identity.
    Scanner failure is a visible retryable quarantine; retry finalization before expiry.
    Both integrations have explicit deadlines, aborts and sanitized errors. Quotas bound
    storage per parent; existing rate limiting and deployment resource limits address abuse.
16. Browser adapter uses JSON only for metadata, a separate credentialed CSRF-protected
    XHR transport for binary progress/cancel, and ephemeral Blob URLs for previews.
    Scope invalidation/logout/replacement/remove/unmount abort work and revoke URLs.
    No local/session storage for bytes, grants or filenames; no production demo fallback.
    #33 consumes the reusable uploader later; NewBookingPage remains the fictional demo.
17. No new general domain event is justified: state/audit/command evidence is sufficient.
    No messaging, payment, receipt, challenge or delivery-completion side effect.
18. Storage/scanner credentials resolve only through startup's injected secret resolver.
    Staging/production configuration is required and fail-closed; test adapters cannot
    become an implicit hosted fallback. #68 owns buckets, environment identities, TLS,
    encryption, malware database updates, network isolation and worker capacity.
    #69 owns backup/restore qualification; #72 owns legal privacy execution.
19. A pinned disposable MinIO service verifies actual S3 behavior (privacy, conditional
    writes, checksum/identity, retrieval and deletion). A deterministic real TCP server
    verifies clamd framing, response/error/deadline behavior without a production scanner
    or unpinned signature downloads. It proves protocol behavior, not malware detection
    efficacy; deployment must qualify/update its real ClamAV engine under #68/#73.
20. Apply one new forward migration before compatible API/worker. Existing released
    migrations stay byte-identical. Rollback disables the feature; retain reservations,
    receipts/audit and keys for reconciliation. Never revert authority to browser JSON.

## Alternatives and consequences

Direct S3 signed downloads have an unavoidable TTL revocation window; authenticated
application capabilities permit live revocation and avoid exposing the bucket/key.
Direct browser uploads make provider-specific hard byte enforcement harder; bounded API
streaming keeps one reviewed transport. A hand-written S3 signer/content sniffer saves
dependencies but unnecessarily recreates security-sensitive protocol parsing; reviewed
pinned libraries are preferred. Node's socket primitives suffice for clamd framing.

[Domain contract](../architecture/attachments.md) ·
[Dependency review](../architecture/issue-31-dependency-review.md) ·
[Verification](../architecture/issue-31-verification.md).
