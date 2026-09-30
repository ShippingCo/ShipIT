# Provider-backed messaging history

Issue #44 supplies a read projection and production screen. [Signed inbox](whatsapp-webhooks.md),
[outbound](whatsapp-outbound.md), [automation](notification-automation.md) and
[Route fanout](route-delay-notifications.md) remain the source owners. History writes no ledger,
provider state, message body or audit event. [Verification](issue-44-verification.md).

## Ratified API

All routes require authenticated membership and explicit `organization_id` / `franchise_id`:

| Method and path | Result |
| --- | --- |
| GET `/api/v1/whatsapp/history/messages` | One row per logical outbound intent |
| GET `/api/v1/whatsapp/history/messages/:id` | Joined evidence and newest 100 attempt outcomes |
| GET `/api/v1/whatsapp/history/automation` | Immutable policy decisions and bounded Route fanout root summaries |
| GET `/api/v1/whatsapp/history/automation/:id` | Decision evidence or fanout root and existing bounded item projection |

List accepts `limit` 1–100 (default 50, browser 25), `cursor`, closed `status` and `kind`,
UUID `source_id` and UUID `correlation_id`. Unknown fields, malformed UUIDs, unsupported status/kind
and oversized limits fail validation. No arbitrary text search, phone, body or customer directory
filter exists. Automation status filters decisions (`queued/blocked/suppressed/skipped`) or root
processing (`pending/running/completed/failed`); message status filters transport separately.

Rows contain ID, closed `row_kind`, effective time, safe source/affected/correlation references,
notification kind, nullable `decision`, `message`, `fanout`, and server-derived `recovery`.
Decision includes policy/version/outcome/reason. Message includes logical ID, version, state,
reason, attempt count, normalized progress, independent failure observation and last observation time.
Fanout includes root/Route/original-event IDs and strictly scoped business processing counts.
Detail adds `attempts`, `history_truncated`, `fanout_items` (existing maximum 1,000) and
`reminder.eligible`. There is no total feed count or endpoint to address an attempt directly.

## Joins, identity and time

Messages starts at scoped outbound records and LEFT JOINs decision, fanout/item and normalized
observation evidence. An outbound-only disclosure, assistance or delivery verification record
remains visible. Multiple historical policy decisions can reference one intent; the message row
uses the earliest matching decision, while Automation retains every decision under its own ID.
Automation UNIONs decisions and fanout roots, preserving cutover, suppression and configuration
blocks without fabricating an outbound record. Fanout item correlation uses existing source,
Parcel, item and outbound references; a root is never expanded into an unbounded list page.

All private relations are constrained by Organization and Franchise before lookup/output.
Composite join predicates and existing foreign keys protect nested ownership. Foreign and unknown
IDs return the same `RESOURCE_NOT_FOUND`; foreign filters cannot contribute rows or pagination.
This is not a constant wall-clock timing guarantee on shared PostgreSQL infrastructure.

Order is descending `(effective_time,id)`: outbound creation for Messages, immutable decision time
for decisions and root creation for fanouts. Callback changes never reorder a logical message.
The cursor preserves PostgreSQL microseconds (no JavaScript millisecond truncation). The existing
AES-GCM cursor codec receives a purpose-specific key and boundary validator; other users retain
its original UUID/integer grammar. Tokens expire after 15 minutes and bind view, actor, current
membership revision, Organization, Franchise, filters and limit. Changing any binding requires
starting over. Newer inserts require refresh; status filters reflect current state, not a frozen
snapshot across pages. Within an unchanged result set, equal-time ordering has no duplicates/gaps.

One set-based history SQL query serves a list, with bounded output and no browser N+1 joins.
Unfiltered candidates are limited before enrichment; filtered queries apply their predicates before
the final limit so sparse results are not missed. Detail performs a fixed number of additional
bounded reads. No payload is decrypted. Existing tenant-leading outbound/decision time indexes and
attempt indexes support keysets; see representative EXPLAIN measurements in verification.

## Authorization and content boundary

The existing `withWhatsappScope(..., 'whatsapp.consent.read')` membership path already implements
the required R16/R17 Franchise projection: own selected Franchise for org_admin, franchise_admin,
operator and dispatcher. No new role or PrivateAction is needed. Accountant, read_only and
delivery_agent are denied the general feed. There is no C/A history expansion or customer-directory
access. R18 `outbox.read` and R29 inbox/configuration access remain separate and admin-oriented.

The membership transaction derives local W44/W19 eligibility; the browser cannot assert roles.
The history repository allowlists only operational fields. No phone/address, provider ID/error,
credential, ciphertext, verifier, event envelope, challenge code, rendering or arbitrary inbound text
enters the DTO. Even org_admin sees only **Delivery verification message** for `delivery_otp`.
Rendering remains sealed and is purged by #39 after acceptance/suppression/expiry. Nothing is
reconstructed or retained as plaintext. The #37 encrypted inbox and R29 metadata-only API remain
unchanged; this v1 intentionally provides no chat transcript, inbound-text decryption or composer.

## Provider semantics and recovery

Transport states remain queued, retry_wait, dispatching, accepted, delivered, read, suppressed,
failed and uncertain. **Accepted by provider is not Delivered.** Callback progress is
`none < sent < delivered < read`. History reads normalized observations immediately, including
before outbound worker reconciliation. A later failure never regresses delivered/read; the
independent `failure_observed` flag retains that evidence. Automation outcomes stay immutable.
The last observation timestamp is not presented as a fabricated delivered/read timestamp.

W44 uses the existing `POST /api/v1/whatsapp/outbound/:id/redrive`. Its eligibility predicate is
shared by command and read model: failed/uncertain, retained rendering, unexpired and no delivered/read
observation. Active roots and current local franchise_admin authority are required. The UI refreshes
detail before a new intent, then sends `expected_version`, an Idempotency-Key and
`dependency_repaired` or explicitly confirmed `retry_uncertain_confirmed`. The uncertain warning
explains duplicate external delivery. Transport uncertainty reuses the exact key/body. Recovery
preserves logical ID and previous attempts; W44 revalidates and owns canonical audit.

W19 uses existing `POST /api/v1/routes/:route_id/delay-reminders` with
`{original_delay_event_id}` and its own fresh Idempotency-Key. Only local franchise_admin/operator/
dispatcher and a legitimate fanout root receive the control. Server detail checks active roots,
legitimate source, departed Route, latest delay, policy activation and the existing 60-minute
cooldown predicate. W19 repeats checks under lock and its database cooldown guard remains final.
A reminder has new event/root identity, never changes ETA and never redrives the original message.
No reminder button appears on individual Parcel/message rows.

## Production browser and rollout

`/business/automation` renders `operations/Messaging.tsx` through BusinessShell, with Messages and
Automation filters. `data-access/messaging.ts` uses the existing scoped API, strict allowlist decoders
and immutable command intents. No storage persistence, demo imports or API-failure fallback exists.
Scope/logout/401 invalidation aborts transport and invalidates tickets; OperatorApp's generation key
unmounts private views. Responses from an old scope cannot publish into a new one. Native labeled
selects, async states, text status labels, narrow layouts and Radix focus trapping/restoration provide
the operational UI. There is no clear-history or OTP-reveal control.

Deploy compatible API first, then browser; history requires the existing #37–#43 schema/grants.
No migration or backfill is needed. All 29 released migrations remain unchanged. Rollback restores
compatible API/browser code and retains durable evidence. Demo remains explicitly fictional under
`VITE_DATA_MODE=demo`; its local outbox is never imported. #45 release qualification, #46/#47 customer
conversation workflows and #70 hosted alerting remain downstream.
