# Public API contract v1

[Architecture](README.md) · [ADR 0007](../adr/0007-api-event-idempotency-contracts.md) · [Idempotency](idempotency-contract.md) · [Events](event-contract.md) · [Verification](api-event-verification.md)

Issue #4 defines wire conventions and bounded examples, not implemented HTTP routes.
The [Issue #3 role matrix](authorization-contract.md), [domain](domain-contract.md) and
[closed lifecycle](parcel-lifecycle.md) remain business authority. Feature owners finish
endpoint-specific input/projection schemas within these conventions; unspecified business
policies remain denied. Request DTO, response DTO, internal database row and event are
four separate schemas. Never serialize a row or internal event as a public response.

## Version and scalar conventions

Public paths begin `/api/v1`. A breaking public wire change requires a new major path,
e.g. `/api/v2`: removing/renaming fields, changing meaning/type, making optional input
required, or expanding a closed response enum that old clients cannot handle. Optional
additions may stay in v1 only when old clients safely ignore them. Publish overlapping
supported majors and migration guidance before retiring an old one; #9 and feature owners
agree support windows before rollout. No retirement schedule is selected here.

Use JSON with snake_case field names and natural typed success DTOs, without a mandatory
`data` wrapper. Clients ignore unknown optional response fields; command schemas reject
unknown input fields rather than silently dropping intent. Resource IDs are opaque strings;
prefixes in examples are fictional, not a UUID/allocator decision. Positive resource
`version` / command `expected_version` are JSON integers in 1..9007199254740991. Version
exhaustion must fail closed pending a new representation, never wrap. Money is integer INR
paise with Issue #3's one final rounding boundary; request amounts never override Pricing.

Wire instants are UTC RFC 3339 strings `YYYY-MM-DDTHH:mm:ss[.fraction]Z` (at most six
fractional digits); equivalent accepted offsets normalize to UTC before fingerprinting.
Output omits trailing fractional zeroes. Date-only `YYYY-MM-DD` is an Asia/Kolkata
business date, not an instant. Reporting intervals are half-open as defined by #3.

A docket is an opaque, globally unique permanent Parcel identifier. Canonical wire values
use uppercase ASCII letters, digits and internal hyphens. Lookup normalization trims
leading/trailing ASCII space/tab and uppercases ASCII a–z; it does not remove internal
punctuation, fold Unicode lookalikes, or interpret a tenant prefix. Reject any remaining
character outside `[A-Z0-9-]` or an empty value. #12/#22 own allocator layout/length and
global uniqueness, not client counters. Imported carrier/legacy aliases remain a separate
provenance namespace under #53/#79. A docket never grants access or an existence probe.

## Exact public error envelope

Required fields: `error` object containing `code` (stable uppercase machine code),
`message` (safe human explanation) and `correlation_id` (opaque server reference).
Only validation errors may add `details`, an array of objects with exactly `field`
(schema field path, never a submitted value) and `code` (safe validation code).
Do not parse messages for behavior. No stack, SQL, raw provider response, credentials,
OTP/verifier, full address, sensitive proof or internal authorization explanation may
appear. Unhandled errors use a generic message; diagnostic internals stay in protected,
minimized server evidence. Never echo a supplied key or invalid value.

```json
{"error":{"code":"PARCEL_STATE_CONFLICT","message":"Parcel cannot be dispatched from its current state.","correlation_id":"cor_synthetic_01"}}
```

```json
{"error":{"code":"VALIDATION_FAILED","message":"One or more request fields are invalid.","correlation_id":"cor_synthetic_02","details":[{"field":"customer.phone","code":"INVALID_FORMAT"}]}}
```

| HTTP | Stable code | Meaning / client action |
| --- | --- | --- |
| 400 | MALFORMED_REQUEST | Unparseable JSON, duplicate JSON object keys, malformed query/header syntax; correct request |
| 401 | UNAUTHENTICATED | Missing/invalid identity; no private output |
| 403 | ACTION_FORBIDDEN | Denied action on legitimately visible data, or private collection context with absent membership |
| 404 | RESOURCE_NOT_FOUND | Identical safe message/shape for unknown or foreign private resources/nested IDs; never name the foreign tenant |
| 408 | REQUEST_TIMEOUT | HTTP transport request deadline exceeded; reconnect and retain command identity |
| 409 | VERSION_CONFLICT | Authorized new command has stale expected revision; query current truth before a new deliberate command |
| 409 | MEMBERSHIP_CONFLICT | The user already has the requested active role in the Organization |
| 409 | INVITATION_CONFLICT | A pending invitation already exists for the same user, Organization and role |
| 409 | FRANCHISE_CODE_CONFLICT | Authorized internal tenant creation conflicts with an existing code in the approved Organization; choose another canonical code |
| 409 | FRANCHISE_DISABLED | The authorized target Franchise is disabled; new operational writes are unavailable until an approved lifecycle recovery |
| 409 | ORGANIZATION_DISABLED | The authorized target Organization is disabled; new operational writes are unavailable until approved internal recovery |
| 409 | PARCEL_STATE_CONFLICT | Authorized command conflicts with current lifecycle/custody/attempt state |
| 409 | IDEMPOTENCY_CONFLICT | Same scoped key has different canonical intent; never return original result or fingerprint |
| 409 | IDEMPOTENCY_IN_PROGRESS | Same intent is still unresolved; retry same key/body, never execute concurrently |
| 413 | PAYLOAD_TOO_LARGE | Request body exceeds the explicit byte limit; reduce payload |
| 415 | UNSUPPORTED_MEDIA_TYPE | Command body is not supported JSON media type |
| 422 | VALIDATION_FAILED | Parseable input fails schema/semantic validation, including missing key/version, wrong type, unknown field or limit outside 1..100 |
| 422 | CURSOR_INVALID | Invalid/tampered/expired or query-incompatible cursor; generic message, restart authorized query |
| 429 | RATE_LIMITED | Request budget exceeded; obey Retry-After, retain command identity |
| 431 | HEADERS_TOO_LARGE | HTTP headers exceed the server transport bound; reduce headers |
| 500 | INTERNAL_ERROR | Generic unexpected failure; commit may be uncertain, retry same key/body |
| 503 | TEMPORARILY_UNAVAILABLE | Temporary service failure; do not infer no commit, retain same key/body |

Validation detail codes are `REQUIRED`, `INVALID_TYPE`, `INVALID_FORMAT`, `OUT_OF_RANGE`,
`UNKNOWN_FIELD`; arrays use schema paths such as `parcels[0].weight_grams`. The 400/422
split applies uniformly to all endpoints. Authentication and private resource visibility
must be resolved before exposing resource-dependent validation/conflicts/replay existence.
Syntactic parsing may precede authorization but cannot disclose private state.

## Cursor pagination

```text
GET /api/v1/parcels?limit=50&cursor=<opaque>
```

```json
{"items":[{"id":"par_synthetic_01","docket":"SYN-SHIPIT-000001","status":"booked","version":1}],"page":{"next_cursor":"cur_synthetic_next","has_more":true}}
```

Exactly `items` and `page` form the list DTO. `page` has required `next_cursor`
(string or null) and `has_more` (boolean); no next page means null/false together.
Default limit **50**, maximum **100**, minimum 1. Reject invalid limits with 422 rather
than silently clamping. An integer decimal query value is required, never a fraction.

Each query declares deterministic sort and a unique tie-breaker. The representative
parcel query uses immutable `created_at DESC, id DESC`; cursor boundary includes both.
Clients cannot decode/build cursors. Server validates cursor integrity and binds its
query identity, effective authorized organization/franchise and projection scope,
normalized filters, sort and limit. Any change requires a new query; equivalent filter
ordering/defaults is compatible. No offset or total-count promise is introduced.

Reauthorize every page and referenced resource. A changed membership/projection requires
a fresh cursor; revoked scope denies access before any stored cursor detail is exposed.
An otherwise authorized request with a cursor from another scope gets `CURSOR_INVALID`,
never foreign rows. Explicit foreign resource selectors retain uniform 404. Server-side
scope filtering applies before page boundaries, `has_more` and counts; frontend filtering
is never authorization. A cursor is not a credential and carries no plaintext private
values. #9/#23 own integrity encoding and bounded lifetime; no SQL is implemented here.

This is a live keyset query, not an immutable snapshot: concurrent insertions ahead of
the boundary may be absent, deleted/revoked records disappear, and filter membership may
change. Immutable sort prevents reorder duplicates; refresh from page one for current
truth. Reports needing a consistent snapshot must declare one under #61/D12.

## Representative command seams

All paths below are proposed examples only. Feature owners #22/#24/#28 finalize their
full DTOs; these compact fragments prove the common conventions without inventing tax,
recipient-entry or proof policy. No generic status-setter is permitted.

| Example | Contract input / role | Success and conflict |
| --- | --- | --- |
| `POST /api/v1/bookings` | W01 operator/dispatcher/franchise_admin in own F; `Idempotency-Key`; validated customer/commercial input plus one or more parcels | 201 Booking DTO with all child IDs/dockets/versions, all or none; original 201/body on authorized replay; changed intent 409 |
| `POST /api/v1/parcels/{parcel_id}/dispatch` | W08/T03 roles and F/C scope; `Idempotency-Key`; `expected_version`, `manifest_id`, `dispatch_evidence_ref` | 200 Parcel DTO at committed version; stale new command 409 VERSION_CONFLICT; wrong state 409 PARCEL_STATE_CONFLICT |
| `GET /api/v1/parcels` | R07 projection with current membership; normalized filters, cursor and limit | 200 list DTO; read_only gets permitted basic fields; no directory/history through custody |
| `GET /api/v1/parcels/{parcel_id}` | R07 current visibility | 200 permitted Parcel DTO; foreign/unknown 404, including docket lookup |

Dispatch fragment (expected current revision 3):

```json
{"expected_version":3,"manifest_id":"man_synthetic_01","dispatch_evidence_ref":"evidence_synthetic_01"}
```

```json
{"id":"par_synthetic_01","status":"dispatched","version":4}
```

Booking success fragment (input describes two distinct physical pieces):

```json
{"id":"booking_synthetic_01","version":1,"parcels":[{"id":"par_synthetic_01","docket":"SYN-SHIPIT-000001","status":"booked","version":1},{"id":"par_synthetic_02","docket":"SYN-SHIPIT-000002","status":"booked","version":1}]}
```

Current role/scope authorizes the entire response and nested children before replay.
Never substitute a newly fetched latest state for the original committed DTO. HTTP
correlation headers may describe the retry; the stored business result stays unchanged.
After a lost response, retain and retry the **same key and request**, including expected
version. Check replay before reapplying state/precondition guards; otherwise a successful
first command would incorrectly conflict with its own new version. See [timeout and
expiry reconciliation](idempotency-contract.md) and [tenant scenarios](api-event-scenarios.md).

## Tenancy service boundary — Issue 12

[ADR 0010](../adr/0010-organization-franchise-tenancy.md) adds only the three tenant
conflict codes above. Organization/Franchise profile results use explicit allowlisted
DTO mapping, never raw DB rows. UUIDs remain opaque; lifecycle is exactly `active` or
`disabled`. Stored versions use PostgreSQL `integer` in 1..2147483647, within the general
safe-integer contract; these commands accept `expected_version` in 1..2147483646 so the
next revision cannot overflow. At the storage ceiling, further mutation/no-op requests
fail `VALIDATION_FAILED` pending a reviewed storage widening. Profile display names
are trimmed strings of 1–120 Unicode code points without ASCII controls. The stable Franchise code must already match
ASCII `[A-Z][A-Z0-9_]{0,31}`: no casing, whitespace or Unicode normalization is performed.
These validation rules apply consistently at the service and database boundary.

Internal commands accept only their declared fields. Profile updates require
`display_name` and `expected_version`; lifecycle commands require the explicit target
state, `expected_version`, and its controlled reason. A code, `organization_id`, role,
identity, timestamps or arbitrary lifecycle in a profile command is not mass assignable.
Unknown fields and invalid scalar/version/reason/pagination input are controlled
`VALIDATION_FAILED`; successful syntax parsing cannot make an input authoritative.
Visibility/action scope is resolved before disclosing resource-dependent version,
duplicate or disabled-state conflicts. An unknown and a foreign private resource have
the same `RESOURCE_NOT_FOUND` response. Profile updates require an active target and,
for a Franchise, active parent. Explicit lifecycle recovery remains available while
disabled under its own approved action. Database constraint names, SQL and supplied
values never enter conflict messages. Database dependency failures remain controlled
`TEMPORARILY_UNAVAILABLE`; a failed/uncertain response is not proof that no commit occurred.
Issue #16 replaces the post-commit audit notification with mandatory transactional
insertion. Failure rolls back state and audit together; an uncertain COMMIT response
still returns controlled 503 and does not justify blindly replaying a mutation. See the
[audit contract](audit-contract.md). No general outbox or persisted command replay is added.

The authorization seam is internal: R01 `organization.profile.read`, R02
`franchise.profile.read` / `franchise.profile.list`, W29 `franchise.profile.update`, and
W41 `franchise.lifecycle.manage`. Client body/query/header scope or role claims cannot
produce an approval. Normal `buildServer()` production composition registers no private
tenant detail/list/mutation routes before #13/#14; there is no unauthenticated tenant
directory or bootstrap endpoint. Test-only trusted injection does not establish live
authentication or RBAC.

Permitted-franchise lists implement an internal bounded keyset over
`created_at ASC, id ASC`, default 50 / maximum 100. SQL restricts the trusted Organization
and permitted Franchise set before keyset boundary, `limit + 1` and `has_more`; disabled
roots retain authorized historical visibility. The internal continuation boundary is
not a public cursor or credential. No public wire-list route is activated while cursor
integrity/query/scope encoding remains with #9/#23. No durable request replay is claimed;
database uniqueness, optimistic versions and transactions provide the current service
reliability boundary, and #17 owns authenticated onboarding replay and atomic membership.


## Membership boundary — Issue #14

The seven implemented membership endpoints, their strict inputs and success shapes are
defined in the [membership API](membership-authorization.md). They use the #13 session and
CSRF boundary. Collection access without management authority is 403; an unknown or foreign
membership/invitation object is the same 404. Expired, used, revoked or wrong-user
invitation tokens are the same 403. Stale updates are 409 `VERSION_CONFLICT`; duplicate
active roles and pending invitations use the two membership-specific conflicts above.

An invitation token is returned once only. It must not appear in list DTOs, persistence,
logs or audit facts. All membership decisions use current database state rather than role
claims embedded in a request or session. Issue #15 still owns product-wide query scoping;
Issue #17 owns public onboarding and initial-administrator coordination.

## Implemented framework boundary — Issue #11

Health paths are the explicit unversioned infrastructure exceptions to `/api/v1`:
`GET /health/live` returns 200 with `status: alive` without DB access; `GET /health/ready`
returns 200 with `status: ready` or the public 503 envelope. Product routes remain downstream.
Every request has a server-generated UUID in `x-request-id`; errors use that exact value
as `correlation_id`. Incoming correlation/identity headers grant no authority.

Framework additions ratified here are 408 `REQUEST_TIMEOUT`, 413 `PAYLOAD_TOO_LARGE`,
429 `RATE_LIMITED` and 431 `HEADERS_TOO_LARGE`. Transport parser failures use the
same safe envelope and server correlation header before Fastify request hooks exist.
Unknown routes use 404 `RESOURCE_NOT_FOUND`; unexpected errors use 500 `INTERNAL_ERROR`.
Only validation failures (422) include safe schema field/code details; root or unknown
properties use `$`, never the submitted property name. Native schema validation rejects
unknown fields without coercing values or inserting defaults.

Bodies support only application/json with optional UTF-8 charset, a 262,144-byte inclusive
limit, strict UTF-8, no duplicate decoded keys at any depth, at most 64 nested containers,
no prototype/constructor keys and no nonfinite JSON numbers. Invalid JSON/parser cases
return 400 without input excerpts. Unsupported body media returns 415. Endpoint authors
must keep unknown-property rejection and safe schema paths; attachments need separate
bounded upload contracts. The [API guide](../../apps/api/README.md) owns operational
CORS/proxy/rate/logging/shutdown details. CORS and rate limits are not authorization.


## Audit boundary — Issue #16

`GET /api/v1/audit` is ratified with current-session R28 authorization, a required
Organization selector, bounded exact resource/Franchise and UTC date filters, limit 1–100
(default 50), and opaque expiring cursors. Own-Organization org_admin and complete-scope
franchise_admin administrative projections are implemented; accountant cannot browse
these nonfinancial facts. Identity-only history never enters the tenant projection.
Malformed or scope/query-incompatible cursors return controlled 422 `CURSOR_INVALID`;
foreign/unknown exact resource selectors return uniform 404. GET has no mutation-only
CSRF requirement. [The audit contract](audit-contract.md) defines exact filters, DTO,
ordering, correlation, grants, compatibility and privacy rules.

## Customer boundary — Issue #19

[Customers v1](customers.md) ratifies the explicit Organization/Franchise nested collection
`/api/v1/organizations/:organization_id/franchises/:franchise_id/customers`: GET search,
POST create, and GET/PATCH `/:customer_id`. No DELETE. Both ownership IDs are narrowing
selectors, outside the mutable body. R05/W03 permits franchise_admin/operator only; V
verified-purpose org_admin directory access is not implemented. Idempotency-Key is required
for both commands, expected_version for PATCH. Search requires search_by and a bounded
literal prefix, with canonical items/page and encrypted keysets. All normal safe errors,
session/CSRF/Origin, no-store and redacted route-template logging remain in force.

## Pricing boundary — Issue #20

[Pricing v1](pricing.md) ratifies `POST /api/v1/pricing/quote` with required
organization_id/franchise_id query selectors narrowing live membership. Body contains
only destination_key, service, integer weight_grams and optional structured freight
override. Idempotency-Key is required; result is a proposal, never a booked total.
The nested `/organizations/:organization_id/franchises/:franchise_id/pricing/versions`
base supports POST draft, GET effective approved policy, GET/PUT /:version_id admin
view/replacement, and POST /:version_id/publish. PUT/publish require expected_version.
W27 controls administration; R21 controls effective views and suggestions; W01/W43
control ordinary/privileged overrides. Unknown fields, ownership bodies and client
calculated totals are rejected. Original numeric tokens are checked for exact integers
before JSON precision loss; fractional/unsafe input is 422, nonfinite JSON remains 400.

Additional safe conflicts: 409 NO_RATE (no exact effective match), RATE_CONFLICT
(overlap/invalid publication), QUOTE_STALE (requote required). The existing envelope,
CSRF, Origin, bounded bodies, no-store and route-template-only logging remain unchanged.
Time input accepts seconds with at most millisecond precision, normalizes explicit
UTC offsets, and rejects invalid calendar dates. No quote confirmation HTTP route.
