# Tenant-private customers — Issue #19

[Domain](domain-contract.md), [R05/W03/W34](authorization-contract.md), [API](api-contract.md),
[idempotency](idempotency-contract.md) and [ADR 0013](../adr/0013-tenant-scoped-query-capabilities.md)
are the authority. This document ratifies the previously deferred Customer v1 fields and
endpoint/search mechanics on reviewed merge. [Verification](issue-19-verification.md).

## Relationship and fields

A Customer is one franchise's private relationship, never a global person or login.
Immutable server-generated `id`, `organization_id`, `franchise_id`, `created_at` identify
ownership. The composite Franchise FK rejects mismatched parents. There is no merge,
delete, reparent, deduplication or phone uniqueness, including within one Franchise.

| Input/storage | V1 contract |
| --- | --- |
| `name` | Required, trimmed, 1–120 Unicode code points; no controls or lone surrogates |
| `phone` / `phone_display` | Required explicitly international input, 1–40 ASCII characters; trim ASCII spaces only, preserve remaining display text |
| `phone_normalized` | Remove allowed spaces/hyphens between digit groups; `+` followed by nonzero digit and 7–14 more digits (8–15 total), same structural E.164 bounds as auth |
| `address` | Optional on create, omission equals empty string; trimmed single-line contact address, 0–500 Unicode code points, no controls or lone surrogates; not a validated shipment destination |
| `version` | PostgreSQL integer, starts at 1; every accepted new edit increments exactly once, even an identical-value edit |
| `created_at`, `updated_at` | Server UTC instants, millisecond precision; only updated_at changes on edit |

Phone formatting accepts `+91 98765 43210` and `+91-98765-43210`. Only single spaces or
hyphens between digit groups are allowed. Letters, extensions, parentheses, national-only
numbers, leading zero after +, missing digits and impossible structural lengths fail.
No country inference, assignment/reachability check, geography database or authentication
by contact number. Safe display format is retained independently of canonical search.
Unicode whitespace is trimmed for name/address; all C0/C1 controls and surrogate code points
are rejected before trimming. Case and Unicode normalization are otherwise preserved.

Create body is exactly `{name, phone, address?}`. PATCH is a contact replacement with
`{name, phone, address, expected_version}`; all four fields are required, so omission cannot
silently clear existing data. Accepted expected_version is 1..2147483646; the storage ceiling
fails closed. Unknown fields (including ownership, id, version, timestamps) fail 422.
Validation details use only fixed schema field names/codes; unknown names use `$`.

DTO fields are exactly `id`, `name`, `phone` (canonical), `phone_display`, `address`,
`version`, `created_at`, `updated_at`. Explicit projection never serializes ownership or
storage/audit/auth internals. Shared exposes only browser-safe DTO/request/snapshot types.

## Authorization and endpoints

Base: `/api/v1/organizations/:organization_id/franchises/:franchise_id/customers`.
Both IDs are validated selectors narrowing live membership; neither creates authority.

| Method | Path suffix | Action | Result |
| --- | --- | --- | --- |
| GET | base | customer.list | 200 bounded repeat-customer search |
| GET | /:customer_id | customer.read | 200 CustomerDto |
| POST | base | customer.create | 201 CustomerDto; Idempotency-Key required |
| PATCH | /:customer_id | customer.update | 200 CustomerDto; Idempotency-Key and expected_version required |

R05/W03 allow only active `franchise_admin` or `operator` membership explicitly covering
the selected Franchise. No role inheritance. org_admin's separate V verified-purpose
workflow is not implemented and fails closed; dispatcher, delivery_agent, accountant and
read_only get no directory access. This intentionally overrides the stale Issue #19
“read_only may only view” prose. W34 denies delete/merge to everyone.

The operation-lifetime staff scope rechecks identity/grants and holds the Organization
lock throughout SQL and commit. It narrows the capability to exactly one Franchise.
Collection/action denial is 403; inaccessible object/Franchise selectors and foreign or
unknown Customer IDs are uniform 404. No global ID lookup. Resource-dependent version,
replay or lifecycle conflicts follow visibility. Authorized detail/history reads remain
available when roots are disabled; new writes use the existing active parent/child lock
guard. Search requires active roots. Replays reauthorize but do not reapply lifecycle or
expected-version preconditions already satisfied by the original command.

## Repeat lookup and pagination

Required query fields: `search_by=name|phone` and `q`. Optional `limit` (1–100, default 50)
and opaque `cursor`; no offset, arbitrary sort, wildcard language or empty directory list.
Name search is a case-sensitive literal prefix of the trimmed stored name, up to 120 code
points, with at least three Unicode letters/digits. Phone search uses the same explicit
international formatting and 8–15 digit structure as input, up to 40 input characters;
it is a canonical prefix, never a suffix/national-number search. `%`, `_`, and backslash
in name input are literal SQL-escaped characters. Different canonical numbers are never
consolidated. Exact same-phone queries return every distinct authorized candidate, subject
to pagination. #33 must require explicit record-ID selection when ambiguous.

SQL ownership predicates apply before filtering, `(created_at ASC, id ASC)` keyset,
`limit + 1` and has_more. No public total_count; the extra authorized row is the only
cardinality signal. Exact list shape is `{items, page:{next_cursor, has_more}}`.
Tenant-leading phone/name text_pattern_ops indexes support literal prefixes; the
Organization/Franchise/created_at/id index supports deterministic ordered scans. Filtered
prefix queries may sort scoped candidates or scan the scoped ordering index; representative plans are verified with synthetic
rows. No global contact index. This is live pagination: edits can change filter membership;
refresh from page one for current truth.

AES-256-GCM cursors use the audit pattern with a distinct purpose-derived key, 15-minute
expiry, and actor, Organization, selected Franchise, live membership revision, normalized
query, limit and ordering binding. No plaintext contact data in tokens. Reauthorization
precedes decoding; changed scope/filter/limit/revision fails CURSOR_INVALID. Same deployment
key permits restart continuation; key rotation invalidates cursors.

An additional Fastify limiter permits 30 customer searches per 60 seconds per normalized
network identity per API process, shared across customer paths/selectors/queries. It uses
the established bounded 10,000-entry store, includes failed attempts, and preserves the
global 120/minute limiter. Controlled 429 includes Retry-After. No phone/query key or log.
This bounds enumeration, not authorization; distributed/IP-changing abuse and production
capacity qualification remain #68/#71/#74. Scale-out requires a reviewed shared limiter
before claiming a fleet-wide budget; no Redis dependency is added.

## Concurrency, retry and immutable evidence

Each mutation is one transaction: live authorization, target visibility, scoped receipt
resolution, active-write guard for a new command, customer mutation, immutable customer
fact and original response receipt. Organization serialization already used by memberships
also serializes customer commands. The unique receipt key is the final invariant. Bounded
lock failure returns 503 TEMPORARILY_UNAVAILABLE; retain the same intent and key.

Receipts bind user + Organization + acting Franchise + versioned create/update operation
+ SHA-256 key digest. Keys are exactly 1–255 ASCII letters/digits/underscore/hyphen, without
trimming or duplicate-header joining. SHA-256 fingerprints use recursively sorted canonical
validated v1 intent, operation, normalized media type, empty query and resource IDs, including
expected_version and preserved display format. Only the original minimal response DTO is
retained, never the raw request, query or credentials. Receipt PII/fingerprints remain private
storage, absent from ordinary logs/audit/shared types. Same key/intent replays the original
status/DTO after current action and resource authorization, even after later edits; changed
intent returns 409 IDEMPOTENCY_CONFLICT. New stale edits give 409 VERSION_CONFLICT.

Receipts are immutable, SELECT/INSERT only, with no runtime cleanup. A 25-hour retain_until
from receipt creation exceeds the 24-hour minimum from commit under the bounded transaction
timeouts. Existing evidence continues replaying after that boundary; #72 owns reviewed
retention/cleanup. Never automatically retry uncertain expired commands with a new key;
query known Customer IDs or seek authorized reconciliation if the result ID is unknown.

Customer facts have their own append-only source and SECURITY DEFINER append function,
with fixed search_path, closed create/update action, UUID ownership/customer/actor/correlation,
committed version and time. The canonical audit_history view adds `customer:UUID` facts
without changing old facts; no fake tenancy lifecycle fields. R28 audit grants only safe
references, never directory access. Security denial actions record caller/category only,
with null guessed target/tenant. Ordinary logs retain route templates, status, duration and
request UUID, never query strings or contact DTOs. No customer event/outbox consumer is
ratified in #19; no provider I/O occurs.

## Snapshot and delivery boundary

`customerSnapshot` materializes independent, frozen scalar contact values with source
Customer ID/version. Customer ID may identify the source relationship, but Booking/Shipment
party details are value snapshots at booking time. Future #22 must authorize/materialize
and persist them in its booking transaction, never historical live joins to Customer.
Changing the relationship has no reference/mutation path into a prior snapshot. No Booking
or Parcel schema, booking API/event/idempotency or persisted shipment snapshot exists here.

#33 owns production customer/booking/receipt screens and adapters. Production web composition,
BusinessShell, localStorage and fictional demo behavior remain untouched. No legacy import,
UI activation or production fallback is included.

Roll out the additive migration, explicit runtime grants, compatible API, then synthetic
verification; only later enable #22 consumers and #33 UI. AUTH_SECRET_REF remains the API
activation boundary. Roll back compatible application code/disable routes, retain applied
schema and all records, and repair with a new forward migration. Never edit applied files.
