# Issued receipts — Issue #30

[ADR 0020](../adr/0020-immutable-issued-receipts.md) records the v1 decision before
implementation. Receipts owns immutable documentation, Bookings owns commercial facts,
and Payments owns money. No other domain is mutated by retrieving or printing a receipt.

## Retrieval and identity

All routes require live authentication, explicit organization_id/franchise_id selectors,
no-store responses and current R13 authorization:

| GET route | Result |
| --- | --- |
| /api/v1/bookings/:booking_id/receipt | One durable Booking-charge artifact, materialized on first retrieval |
| /api/v1/bookings/:booking_id/payments/:payment_id/receipt | One immutable collection acknowledgement or linked reversal document |
| /api/v1/receipts/:receipt_id | Existing artifact only |

First GET persistence is the explicit ADR exception: the owning transaction freezes the
representation, not a financial mutation. HEAD is disabled. Repeated GETs reuse UUID,
number, issued_at and snapshot. No request key, expiry, public download URL, bearer token,
number search, PDF generation or receipt directory exists. The DTO is the download;
printing uses HTML locally after an explicit user gesture.

`RCT-` + 19-digit global sequence is globally unique across all tenant scopes and kinds.
Allocation is nontransactional, gaps are allowed after rollback, and numbers are never
recycled. Authorization never depends on unpredictability. UUID, schema_version and kind
are distinct from the number. Collection/reversal links are same-owner, same-Booking FKs.

## Snapshot and reconciliation

Booking documents copy frozen customer name (no current Customer join), confirmed_at,
ordered docket/gram references, service and the saved pricing/tax evidence: freight,
packing, pre-tax/basis, CGST/SGST/IGST, allocated components and exact rational rates,
tax total, unrounded payable, signed adjustment, final payable, jurisdiction and policy
references. Final amounts are copied in integer paise; neither server issuance nor browser
presentation reprices, recalculates tax, derives current balance or rounds again.

Issuer organization/franchise display names and stable franchise code freeze at first
issuance. Supplier state and the referenced immutable published tax policy's GSTIN provide
historical tax identity. That policy lookup uses the booked policy UUID and same owners,
never an effective/current-policy query. Reprints read only the issued snapshot. No
browser business profile, logo/URL, contact details, inferred ETA or government invoice
claim appears. Recipient contact and unrelated customer/operational history are omitted.

Booking-charge wording is **Booked total**. Payment is independent of delivery. A collection
acknowledgement copies only its actual immutable entry: amount, INR, method, context,
collection reference, entry ID/version and occurred_at. `paid_counter` describes context,
not proof of full settlement. No current/as-of balance or PAID/SETTLED label is included.
A reversal document copies the existing positive reversal amount and reason, links
`correction_of` to the original acknowledgement, and preserves original evidence. Version
is the Payment ledger sequence, so later corrections increase without requiring contiguous
receipt versions. Each acknowledgement also references the Booking receipt. No generic
receipt editing or Booking financial amendment is authorized. Recollection is a new entry
and acknowledgement. Retrieving a reversal first materializes its required originals in
the same transaction; it never fabricates ledger entries.

## R13, isolation and errors

| Role | Scope |
| --- | --- |
| org_admin | Explicit selected franchise within its own organization |
| franchise_admin | Own granted franchise |
| operator | Own granted franchise |
| accountant | Own granted franchise, same minimum finance artifact |
| dispatcher, delivery_agent, read_only | Denied |

Roles do not inherit. Current session/membership is checked in the same transaction as
all repository work; selectors only narrow. A dedicated internal Payments entry-read
capability allows the minimum R13 projection without granting R11 ledger access. Every
lookup binds both owners before matching Booking/receipt/payment/link IDs. Unknown and
foreign nested resources return the same 404; there are no counts or public links.
Disabled roots retain authorized historical retrieval; revoked membership does not.

Malformed syntax follows 400; malformed UUID/query uses 422 VALIDATION_FAILED; missing
session is 401, visible scope with denied role 403, unknown/foreign resource 404.
Dependency/invariant/schema failure or uncertain commit is generic 503. No new error code,
SQL, constraint, input value or stack is exposed. Retry the same authorized GET after
recovery. There is no mutable receipt version input and hence no stale-write endpoint.

## Durability, audit and rendering

The existing Organization authorization lock and scoped obligation lock serialize initial
materialization; logical unique indexes independently forbid duplicates. An insert trigger
derives all snapshot/identity data from same-owner retained sources. Column grants deny
caller-supplied snapshots/numbers; immutable triggers reject UPDATE/DELETE even for ordinary
owner SQL. One reference-only receipt issuance audit is inserted by the same transaction
and appears in audit_history. Failed insertion/commit leaves no visible partial artifact
or audit. No receipt.printed/downloaded event is emitted. Retries add no audit business
fact, event, payment or messaging row. Safe denial/access logging uses existing mechanisms.

Explicit DTO mapping omits ownership, actors, correlation, command/key/fingerprint data,
raw tax intent, contacts, event envelopes and SQL metadata. Stored JSON is never blindly
returned. The renderer escapes every display value, accepts no URLs and performs only
integer paise formatting. It has no store/network/domain mutation dependency. Print cleanup
removes private markup; #33 must integrate its cleanup with existing scope invalidation
when mounting the production screen. The separate demo adapter remains fictional and may
convert prototype rupees for display; it never supplies a production fallback.

## Upgrade and rollback

Apply `1790269200000-immutable-issued-receipts.cjs` using the migration owner, then the
[minimum runtime grants](../../packages/db/README.md), then compatible authenticated API.
No rows are backfilled: pre-#30 Bookings receive actual first-issuance timestamps when
legitimately retrieved. No amounts, policies or collections change. The normal migration
ledger makes repeat a no-op and migration failure rolls back schema/ledger together.

Rollback disables/reverts compatible receipt code, keeps evidence/sequence, and repairs
schema forward. Do not down-migrate, reset numbers, prune evidence or use localStorage as
recovery. #33 screens, #47/#62 consumers, reports, settings, #72 retention and messaging
remain deferred. [Executable verification](issue-30-verification.md).
