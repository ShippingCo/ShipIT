# Public API contract v1

Issue #32 ratifies its exact e-way endpoints and DTO projections in
[eway.md](eway.md). They follow the v1 rules below: unknown request fields are rejected,
private ownership is selected from the authenticated membership, writes require scoped
idempotency keys and expected versions, and reminder/history cursors are encrypted and
query-bound. The e-way API stores externally observed facts only; it does not file or
verify a government record.

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
| 409 | RTO_NOT_ELIGIBLE | Authorized RTO command lacks configured attempt/reason eligibility and no valid privileged override was supplied |
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
| `POST /api/v1/parcels/{parcel_id}/dispatch` | W08/T03 roles and proven F/C scope; `Idempotency-Key`; `expected_version`, `manifest_id`, `evidence_ref` | 200 Parcel DTO at committed version; stale new command 409 VERSION_CONFLICT; wrong state 409 PARCEL_STATE_CONFLICT |
| `GET /api/v1/parcels` | R07 projection with current membership; normalized filters, cursor and limit | 200 list DTO; read_only gets permitted basic fields; no directory/history through custody |
| `GET /api/v1/parcels/{parcel_id}` | R07 current visibility | 200 permitted Parcel DTO; foreign/unknown 404, including docket lookup |

Dispatch fragment (expected current revision 3):

```json
{"expected_version":3,"manifest_id":"00000000-0000-4000-8000-000000000001","evidence_ref":"00000000-0000-4000-8000-000000000002"}
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

## Booking creation — Issue #22

The [ratified Booking v1 request/response](bookings.md#ratified-v1-api) activates
`POST /api/v1/bookings?organization_id=...&franchise_id=...`. It requires a session,
CSRF/Origin protection and exactly one Idempotency-Key. The strict body is customer_id,
expected_customer_version, tax_calculation_id, exact tax_intent (quote_id, pricing_input,
facts), and 1–50 ordered parcels (integer weight_grams, recipient contact, optional docket).
One whole-booking quote covers the sum of parcel grams. Ownership, state, totals, lot_id,
paid/settled/payment_mode and confirmation evidence are not accepted input.

The Issue #22-specific active-franchise **operator** policy is intentionally narrower
than the W01 representative ceiling above; it does not activate other roles or amend the
global matrix. 201 returns immutable Booking identity/state/version, authorized owners,
customer and shipment-party snapshots, authoritative charges/tax, initial uncollected
obligation, all children with permanent dockets/booked/awaiting_intake, and event references.
Authorized replay returns the original 201 DTO. DOCKET_CONFLICT is safe 409 for an unusable
manual/generated docket, without existing ownership information; all existing pricing,
tax, version, lifecycle, auth, validation and idempotency errors retain their envelopes.
No retrieval/search API, lot relationship, issued receipt or payment collection is added.

## Guarded Parcel lifecycle — Issue #24

All routes require `organization_id`, `franchise_id`, authenticated session, CSRF/Origin,
and exactly one `Idempotency-Key`. All body objects reject unknown fields. Evidence values
below are UUID references to separately authorized facts, never truthy proof flags or text:

| Route | Strict body after common `expected_version`, `evidence_ref` |
| --- | --- |
| `POST /api/v1/parcels/{parcel_id}/check-in` | `location_ref` |
| `POST /api/v1/parcels/{parcel_id}/dispatch` | `manifest_id` |
| `POST /api/v1/parcels/{parcel_id}/transit` | `route_id` |
| `POST /api/v1/parcels/{parcel_id}/failed-attempt` | `attempt_id`, closed `reason_code`; closed `failure_subreason_code` required only for `other_controlled` |
| `POST /api/v1/parcels/{parcel_id}/rto` | `approval_ref`, `return_plan_ref`; optional closed `override_reason_code` |

Success is the allowlisted Parcel transition DTO: `id`, `booking_id`, `docket`, `version`,
`status`, `custody`, `attempts_started`, `failed_attempt_count`, `event_id`,
`transitioned_at`, and `reason_code` only for a failed attempt. Tenant IDs, assignment IDs,
input evidence, command metadata and event envelopes are omitted. Replay returns the exact
stored DTO. A new stale command returns VERSION_CONFLICT; wrong edge/attempt/agent returns
PARCEL_STATE_CONFLICT; ineligible ordinary RTO returns RTO_NOT_ELIGIBLE.

There is no generic Parcel PATCH, delivered command, out-for-delivery command, OTP/proof
input or timer-triggered RTO. Cross-Franchise C authority requires future durable custody
evidence and is currently denied; assigned-agent A is enforced for failed-attempt. See
[ADR 0014](../adr/0014-guarded-parcel-lifecycle-commands.md) and
[verification](issue-24-verification.md).

## Bounded Parcel bulk — Issue #25

[Bulk Parcel v1](parcel-bulk.md) defines POST `/api/v1/parcels/bulk`, required trusted-scope
selectors, strict 1–50 entries, check_in/dispatch allowlist, sorted unique per-item 200
results and canonical request-level failures. It reuses #24 command bodies and transition DTOs.

## Issue #26 lot endpoint activation

The exact ten endpoints, closed bodies, operation IDs and DTOs are ratified in the
[lot API contract](lots.md#api-and-optimistic-concurrency). They use this contract's session,
CSRF, no-store, canonical Idempotency-Key and error envelope. All select one authorized
organization/franchise; paginated lists contain items/page, never unauthorized totals.
R08 is lots.read/lots.list; W04 is lots.create/update/archive and
lots.membership.add/move/remove. Internal lots.audit/events are independent capabilities.

New 409 codes: LOT_STATE_CONFLICT (choose an active lot), LOT_MEMBERSHIP_CONFLICT (refresh
current membership), LOT_CODE_CONFLICT (refresh/reconcile allocation), and
LOT_DESTINATION_MISMATCH (choose/create the correct destination lot). Stale versions use
VERSION_CONFLICT; delivered/rto entry uses PARCEL_STATE_CONFLICT. Unknown/foreign nested
IDs use RESOURCE_NOT_FOUND without values. Fixed mismatch text and #34 corrective interaction
are specified in [safe failures](lots.md#safe-failures-and-ui-consumer-contract).
New validation fields are lot_id, target_lot_id, membership_id, expected_target_version and state.
Existing name, destination_key, parcel_id, expected_version, limit, cursor and
selectors retain their declared meanings. No generic Parcel mutation or destructive DELETE.

## Issue #27 Route API activation

[Routes](routes.md#http-and-dtos) defines the 12 implemented endpoints, strict metadata/version/source bodies and bounded current/historical manifest pages. Planning/finalized/archived are the only Route states. Every new T03 manifest_id must identify a same-scope finalized manifest containing the Parcel; exact pre-#27 receipts still replay. Unknown/foreign manifests return RESOURCE_NOT_FOUND, visible ineligible manifests PARCEL_STATE_CONFLICT. No `/routes/:id/events` endpoint is activated.

## Issue #28 Route event API

POST `/routes/:route_id/events` and GET latest/event-detail endpoints use the [typed Route event contract](route-events.md). Strict W18 plus per-effect W09, immutable outcomes and explicit unavailable route-leg ETA apply.

## Issue #29 Payments

[Payments](payments.md#api-intent-and-safe-responses) activates POST Booking payments and
nested reversals, plus current balance and immutable-entry GET projections. Closed INR
integer-paise input replaces any browser paid/settled authority. The existing 400 syntax /
422 semantic-validation distinction, authenticated scoped errors and retry rules remain.

## Issue #30 receipt retrieval

[Receipts](receipts.md) and [ADR 0020](../adr/0020-immutable-issued-receipts.md) ratify
GET `/api/v1/bookings/:booking_id/receipt`, GET
`/api/v1/bookings/:booking_id/payments/:payment_id/receipt`, and GET
`/api/v1/receipts/:receipt_id`, each with required organization_id/franchise_id selectors.
The first two have a bounded persistence exception: the owner materializes the one
canonical snapshot and issuance audit on first authorized retrieval; retries reuse it.
HEAD is not exposed. No client-supplied content/version, request key, public URL or print
success command. The direct ID route reads existing evidence only. No money/message/event
effect. All use live R13, no-store, minimal allowlisted DTOs and existing controlled errors.

## Attachment binary exception (#31)

[Attachments](attachments.md#api-and-public-model) defines seven versioned endpoints beneath `/api/v1/bookings/:booking_id/attachments`. Only PUT upload content accepts `application/octet-stream`; it has a dedicated bounded streaming parser, session/CSRF and W22. The normal 256 KiB JSON limit is unchanged. Initiate/finalize/cancel/download-grant commands require Idempotency-Key and live authorization on replay. Responses explicitly project safe metadata; private grants and bytes are no-store. No attachment domain event is added.

## Outbox operations (#35)

[Outbox operations](outbox.md#api-and-permissions) defines session-protected health, bounded job listing/detail and CSRF-protected redrive. R18 governs reads and W44 governs privileged redrive; live scope checks precede original-result replay. No raw event or lease token is returned.

Issue #36 adds masked installation reads and idempotent connect/rotate/disable/template-sync commands. [WhatsApp API contract](whatsapp.md) defines exact bodies, W45/R29, capability reasons and the disabled customer-send boundary.

## Issue #37 business callbacks

[Signed operational webhooks](whatsapp-webhooks.md) define GET/POST /webhooks/whatsapp and R29-scoped inbox health/detail. Signed provider identity owns ingress scope; callbacks never establish operator authentication. The POST acknowledges only durable inbox/quarantine persistence.

Issue #38: [consent read and policy HTTP contract](messaging-consent.md) adds customer-scoped safe history and current eligibility. No public consent mutation or phone-based authorization endpoint is added.

## Issue #39 outbound operations

[Outbound API and runbook](whatsapp-outbound.md) specifies R18 history/health and W44 revision-checked, idempotent redrive under /api/v1/whatsapp/outbound. Enqueue is a trusted consumer service only; no staff or browser provider-send endpoint is added.

## Issue #42 delivery proof API

[Secure deliveries](deliveries.md#commands-and-apis) ratify Delivery-owned list/detail,
eligible-agent, start/retry, resend/replace, proof completion and exceptional
request/approval/completion endpoints. They use the standard selector, session,
Origin/CSRF, one `Idempotency-Key`, expected version, canonical fingerprint, receipt and
replay reauthorization. Unknown fields are rejected. No generic Parcel delivered endpoint
exists and no DTO contains the code, verifier, ciphertext, contact or provider payload.

Stable safe codes are `DELIVERY_PROOF_INVALID` (422),
`DELIVERY_CHALLENGE_EXPIRED`/`DELIVERY_CHALLENGE_LOCKED`/
`DELIVERY_EXCEPTION_INVALID` (409), and `DELIVERY_RESEND_COOLDOWN`/
`DELIVERY_RESEND_LIMIT` (429). Tenant/assignment visibility still takes precedence and uses
the ordinary indistinguishable `RESOURCE_NOT_FOUND` boundary.


## #140 expense and cashbook HTTP

Authenticated cashbook endpoints require explicit organization/franchise query IDs,
current owning permission and no-store responses. POST commands require CSRF/origin
and Idempotency-Key; cashbook JSON uses exact-integer parsing before schema validation.
Services, not routes or callers, own approval, amounts, source versions and custody.

| Route under `/api/v1/cashbook` | Methods and behavior |
| --- | --- |
| `/locations`, `/locations/:id`, `/locations/:id/revisions` | GET minimum owned selections/detail; POST initial location and append-only revisions |
| `/position` | GET current finance-only custody controls, unknown sources and reservations |
| `/requests`, `/requests/:id`, `/requests/:id/decisions`, `/requests/:id/apply` | GET scoped inbox/detail; POST immutable proposals, different-admin decision and exact approved application; corrections use linked proposals |
| `/locations/:id/handover-targets`, `/handovers`, `/handovers/:id`, `/handovers/:id/commands` | GET owned recipient choices/inbox/detail; POST sender reservation and receiving-custodian accept/reject or permitted cancellation |
| `/snapshots`, `/snapshots/:id`, `/snapshots/:id/export`, `/snapshots/:id/rows/:row` | POST finance snapshot capture; GET retained pages, principal-bound CSV result and owned captured source detail |
| `/requests/:request_id/attachments` | Existing seven private attachment operations, with a server-selected expense parent: GET list/content, POST uploads/finalize/cancel/download-grants, PUT upload content |

Handover detail includes `source_custodian_id` and `target_custodian_id` from its
scoped participant lookup. These IDs identify recovery choices even if location
selectors have not loaded the relevant page; they grant no authority to send,
accept, reject or cancel. Every command still checks current membership and the
named custodian server-side. No extra location lookup or operator ledger permission
is required. This response does not expose an unrelated custodian directory.

#144 adds dedicated `cashbook.handover.request`, `.acknowledge` and `.select` capabilities to existing handover routes. Current agents request from their own source and accept/reject only as the named receiver. Their inbox/detail exclude unrelated handovers; target choices expose only active location/revision, label and custodian IDs. General location, position, expense and receipt APIs remain unavailable to agent-only callers. Current franchise admins may recover deactivated historical agent source custody to an active named recipient; receiver acknowledgement records the actual paired legs.

Literal `AGENT_MONEY_ENABLED=true` enables new named-agent receipt custody, cash-location configuration and agent handover writes. It defaults false, rejects invalid values and cannot be true in demo. Owning `MONEY_RECEIPTS_ENABLED`/`CASHBOOK_ENABLED` gates still apply independently. Exact completed replay follows current authorization even with new writes disabled. Recording staff remain operators/admins; naming an agent as custodian grants no recording permission. Direct shop UPI creates no agent cash. Full COD/settlement APIs remain under implementation.

The #144 `agent_advance` cashbook request kind records actual company money paid to a named current local delivery agent. Its body adds `agent_payee_id` and requires `payment_method`; category/payee text and target location remain null. The named agent differs from the current responsible employee. Operators/admins submit within existing permitted custody, a different current franchise admin approves, and a current admin applies the exact proposal. New request/decision/application requires both owning cashbook and agent-money write gates; authorized exact replay remains available when disabled. Agent-only callers gain no expense/advance mutation. An advance is an actual outflow source kind, not earned expense, customer collection or fee earning. Corrections retain the same named payee and original occurrence, with linked recording deltas; they do not transfer newly received cash. Current-admin correction after agent departure preserves historical payee identity. Fee expense and later payment use the explicit source fields below; the full settlement workspace remains under implementation.

New financial writes require literal `CASHBOOK_ENABLED=true`; the default is false
and demo activation is rejected. Historical reads, authorized snapshot capture and
exact completed-command replay remain available with new writes disabled. Attachment
routes require the existing configured storage/scanner dependencies; absent dependencies
leave those optional routes unavailable. Only their exact PUT content route accepts
`application/octet-stream` with the existing 8 MiB cap; other requests retain strict
JSON/256 KiB limits. Expense signed grants use a distinct parent domain and repeat
current authority after provider delay before bytes are released. Existing booking
attachment paths, purposes, fingerprint and signed-grant formats are unchanged.

### #143 physical custody HTTP boundary

Authenticated /api/v1/custody endpoints select organization_id and franchise_id explicitly. GET worklist and manifests accept an optional UUID cursor (50 rows per page); GET eligible-agents accepts an optional UUID cursor (100 identities per page) and returns agents plus next_cursor; an agent is limited to their own identity. All three lists use an extra-row probe rather than silently truncating available evidence. GET manifests/:id and manifests/:id/report return the named permitted handover and its complete source-linked cohort.

GET transfer-grants lists up to 50 current, unrevoked source-specific approvals using an optional UUID cursor. Giving agents see only their own current physical receipt; staff readers remain within their permitted franchise. Returned or transferred sources and inactive giver/recipient identities are excluded. DTOs expose only parcel/receipt/agent references, current version, matching active-dispatcher instruction, preparation eligibility and office-release reference. GET transfer-grants/:id/manifests pages up to 50 pending outgoing manifests for that exact current approval and source, reporting whether the giver has released the parcel. It hides another giver's approval from agent-only readers. Neither read changes custody or supplies delivery proof.

POST assignment-instructions is dispatcher-only; POST manifests prepares an exact bounded handover; POST manifests/:id/acknowledge is named-agent-only; POST manifests/:id/cancel, returns, grants and grants/:id/revoke require the owning franchise admin. POST releases requires the current giver's exact scoped grant. All writes use existing browser-cookie/CSRF and idempotency-header validation; server services own status, custody, version and proof. CUSTODY_ENABLED defaults false and cannot be true in demo. Disabled physical writes retain current-authority exact replay and private historical reads.

POST manifests/:id/exports captures immutable actor-private evidence with an empty body and an idempotency key. GET exports/:id reads it; GET exports/:id/export returns the same protected snapshot and CSV for the established scoped UI download seam; GET exports/:id/download serves text/csv with a safe UUID filename and nosniff. Every capture/read/download rechecks current local-admin authority and logs successful access. Responses, including private reads, use no-store, private cache policy. No custody endpoint accepts browser delivery proof or changes payment, fees or carrier RTO.


#144 fee-linked `expense` and `agent_fee_payment` bodies carry `agent_payee_id`, `fee_earning_id`, `fee_cash_paise`, `fee_advance_paise` and nullable `fee_advance_request_id`. Expense amount equals the immutable gross earning, while cash plus applied advance may be a partial payment. A later fee-payment amount equals its explicitly recorded cash plus applied advance and requires the gross expense already applied. Advance application references an original applied advance with bounded current remaining capacity. Actual cash legs use only `fee_cash_paise`, including zero legs for zero-cash recognition/application. New submission/review/application requires both existing cashbook and agent-money gates; exact replay preserves current-authority checks. Ordinary requests omit these optional source fields and retain their prior command fingerprints. Corrections preserve earning, agent, original advance reference and original occurrence; replacement payment amounts remain bounded. Full COD/settlement routes and source-qualified exports remain pending.


#144 fee term service accepts `basis: per_delivery | agreed_period`, an explicit integer INR amount and valid-from/until bounds. Per-delivery earning names genuine proof and terms. Agreed earning names only the exact current approved term revision and freezes the explicit covered period without proof/parcel substitution. Overlapping agreed earnings and delivery earnings already covered by an agreed period are rejected in both service and SQL. Adjacent periods remain distinct. These service contracts remain behind the agent-money gate; their full HTTP/settlement workspace integration is pending.


#144 `cod_remittance` cashbook request requires `cod_allocation_id`, private `payment_reference`, `payment_method`, actual positive INR amount, company source location/revision/generation, responsible employee, reason and occurrence. Category/payee, fee and agent-payee fields and target location remain null/absent. A different current franchise admin reviews; a current admin applies the exact proposal. New commands require both write gates; exact current-authority replay survives disabled writes. One current allocation/reference cannot produce repeated payment under new keys. Corrections preserve COD allocation and original occurrence, append recording deltas and may correct the private reference. The original receipt's COD reservation is unchanged by remittance. Strict detail/inbox/source decoders and the existing correction form support this distinct kind. Full settlement creation and COD allocation reversal remain pending.

Issue #144 `cod_reservation_reversal` extends the cashbook request kind: owned `cod_allocation_id` required; payment method/reference, expense category/payee, fee and agent-payment references absent/null. Distinct-admin review and exact admin application produce zero cash legs. Original receipt context is fixed even after agent departure. Applied-head net reversal releases receipt allocation capacity, while remittance alone does not. Restoration is rejected if current freight uses that capacity. No bank/provider, refund or recollection is implied.

Issue #144 handover attribution: `GET /api/v1/cashbook/handovers/:id/attributions` requires selected organization/franchise and an accepted `command_id`; optional ascending integer `cursor` pages at most100 immutable rows. Header includes `as_of`, acknowledged `amount_paise`, complete `attributed_paise`, `unattributed_paise`, `unallocated_paise` and `coverage` (`captured`/`legacy_unattributed`). Rows retain original source/receipt/component IDs and captured component time; amounts are exact decimal paise strings. Historical commands without rows remain entirely unattributed. Exact handover ownership is checked before the nested command. No payment reference, contact or OTP is returned. Source generation/current financial reclassification never rewrites an acknowledgement snapshot.

### #144 immutable daily cash capture (partial settlement input)

`POST /api/v1/agent-settlements/cash-captures` accepts selected `organization_id`/`franchise_id`, an idempotency key, and exactly `{agent_id, day, counted_at, counted_paise, reason}`. `day` is Kolkata-local, `counted_at` is an actual UTC instant within that day and no later than server capture, and `counted_paise` is a nonnegative safe integer. PostgreSQL derives and seals the source snapshot, UTC cutoff and exact decimal aggregate paise; clients cannot provide derived sources or totals. Response201 includes the immutable capture identity, actor, reason and `source_snapshot.kind=physical_cash_capture`. This capture does not submit/approve a settlement or write a receipt, cash movement, expense, deduction, payroll liability or seller payment.

`GET /api/v1/agent-settlements/cash-captures/:id` returns the same saved frame under current R36 authority. Both routes use private/no-store responses; writes retain normal session/origin/CSRF protection. W64 capture is disabled by default under `AGENT_MONEY_ENABLED`; demo cannot enable it. Authorized history and exact committed retries work with the flag off, but current membership and target/self restrictions still apply. The key is actor/franchise scoped; changed intent conflicts, concurrent identical retries return one saved identity, and uncertain commits are recovered by the same key. Captures do not advance monetary source versions.

Agents can capture/read only their own current agent identity. Operators can capture a current local agent and read only captures they prepared (plus their own identity if separately granted delivery-agent membership). Current franchise admins can capture departed local agents' historical cash evidence; approved current finance readers remain franchise-scoped. Current role changes are checked before saved-key replay: a former admin retaining only an agent role cannot recover another agent's capture through an old key. Source projection includes owned cash fact/receipt IDs and precise dates/paise, excludes customer contacts/payment references, and labels unknown franchise sources without assigning them to an agent. The existing 5,000-source /8MiB bounds reject an oversized capture rather than returning a truncated statement. Full COD/fee/parcel statement assembly, submission, different-admin approval/correction and export remain separate pending #144 work.

Cash-capture `source_snapshot.finance` adds source-linked receipt positions/freight applications, COD positions, fee positions, advance positions, immutable financial-effect references and accepted handover attribution references. Its `as_of` equals the saved capture cutoff and its `counted_at` equals the actual count instant. Per-delivery fee effective time is the genuine proof completion; agreed-period effective time is the explicit earning record. Financial effects must have occurred by count and been recorded by capture. Corrections select the head visible at that cutoff rather than today's head. The seller-liability measure is explicitly labelled as liability linked to origin receipts, not debt owed by the agent; source IDs do not grant customer directory or general ledger access. Minimum evidence excludes customer contacts, beneficiary names and payment references. Combined cash/finance source limits reject atomically with `REPORT_LIMIT_EXCEEDED` rather than returning partial arrays. The capture remains partial statement input until parcel/submission/approval contracts are implemented.

The finance snapshot distinguishes `fee_direct_paid_paise` (all direct fee payment), `fee_cash_paid_paise` (physical cash), and `fee_noncash_paid_paise` (bank/UPI). Each fee position exposes `direct_paid_paise`, `cash_paid_paise`, and `noncash_paid_paise`; remaining fees subtract direct payment plus explicit advance applications. Financial effects and advance positions include payment method. These snapshot labels clarify the established request field `fee_cash_paise`, which continues to represent direct payment across methods.

The cash-capture snapshot also includes `parcels` at its exact `as_of` and `counted_at`. `held_positions` reference opening/closing custody receipts; day `transitions` include original/previous receipt, parcel, attempt and proof references. `delivery_proofs` distinguish genuine proof with a tracked custody receipt from explicit untracked legacy proof. `discrepancies` retain source receipt and reason codes without changing custody. Totals separate opening/received/delivered-from-custody/returned-to-office/transferred-to-agent/held-at-count, genuine proof, untracked proof and reported missing. Physical flow reconciles independently of fee, receipt and COD amounts. All parcel entries share the capture's complete-source and byte limits; proof/challenge secrets and recipient contacts are excluded.

Agent settlement submissions and decisions (D144-1):

- `POST /api/v1/agent-settlements/submissions` uses selected organization/franchise, an idempotency key and exact `{capture_id, previous_submission_id, expected_version, reason}`. First revision uses null predecessor/version0. Agent/day/revision/actor/time are server-owned. A fresh linked revision replaces the current view; prior evidence is immutable. Capture and predecessor IDs require current owned access, with foreign/unknown IDs returning the same not-found response.
- `POST /api/v1/agent-settlements/submissions/:id/decisions` accepts `{kind: approve|reject, expected_version, reason}`. Only a different current franchise admin may decide. Approval of changed relevant sources, stale revision, superseded record or a previously decided record conflicts. Approval records review rather than a money/payment effect. Saved decision key/body replay stays exact and checks current authority before history recovery.
- `GET /api/v1/agent-settlements/submissions/:id` returns immutable capture/header/decision evidence and current `pending|approved|rejected|superseded` status. Agents see self, operators their own prepared submissions (plus separately authorized self agent history); current local finance readers retain scoped history.
- `GET /api/v1/agent-settlements/submissions` returns100 headers per page, a fixed millisecond-format `as_of` and actor/tenant-bound `next_cursor`. Revision/decision state on subsequent pages uses that same cutoff. No global page-total claim. Current authorization is rechecked on every page.

All routes use standard session/origin/CSRF protection and private no-store responses. New submit/decide entry defaults off with `AGENT_MONEY_ENABLED`; saved-key replay/read history remains within current authority. W65 separates submission from W66 independent decision and R36 read. Captured CSV uses E03 as described below. PDF export and public event-consumer integration remain pending.


Agent statement captured CSV (E03):

- `POST /api/v1/agent-settlements/submissions/:id/exports` accepts exactly `{}` with session/origin/CSRF and an idempotency key. A current local franchise admin or accountant captures the owned immutable statement source frame and current revision status/decision under the existing franchise lock. Agents/operators and organization-admin-only sessions cannot export. Server-owned export metadata includes original count/source cutoff, distinct export cutoff, Kolkata day/timezone, INR, revision/status, source count and exact 24-hour expiry.
- `GET /api/v1/agent-settlements/exports/:id` returns saved metadata and up to100 source rows, with `offset` in multiples of100. Four explicit statement/cash/finance/parcel summaries reside in metadata; `count` and `source_count` both count source rows. This preserves all5000 permitted source rows without changing released report storage. The complete CSV has four additional summary rows.
- `GET /api/v1/agent-settlements/exports/:id/download` returns `{snapshot, columns, csv}` from the captured data. Fields use the shared explicit `agent_statement_v1` schema, allowlisted scalar projections, exact integer-paise strings and formula-neutralized quoted CRLF CSV, bounded to8MiB. Summary balances overlap and remain labelled; custody, origin-receipt seller liability and agent entitlement are separate. Legacy `fee_cash_paise` represents all-method direct fee payment and is exported as `fee_direct_paid_paise`; actual payment method and cash/noncash totals are retained.

Every capture/read/download rechecks current E03 authorization and actor/organization/franchise ownership. Wrong actor/tenant/ID and expired reads return not-found; replay of an expired capture key returns `REPORT_EXPIRED`. Same-key replay returns the identical saved artifact even after statement correction/supersession; a changed statement conflicts. Existing shared snapshot quota20, expired payload purge, report access audit and private no-store responses apply. Saved statement evidence remains durable after artifact expiry. No new table, migration, permission, physical money effect or provider is introduced. Read/capture of this historical export remains available when new agent-money writes are disabled.

The workspace shows capture/download controls only to current franchise admins/accountants, retains an uncertain capture's exact immutable request/key, shows frozen revision/status/cutoffs/expiry and downloads the matching saved CSV. Scope loss cancels/discards private responses and removes captured metadata. Download uses current server authorization and cannot substitute a new statement revision.


Owner COD and fee command HTTP boundary (#144, partial owner workspace):

- `POST /api/v1/agent-settlements/cod-beneficiaries` accepts `{expected_version:0, name, active}`. `POST /cod-beneficiaries/:id/revisions` uses the same fields and current positive version; `:id` is the beneficiary root, not its revision.
- `POST /api/v1/agent-settlements/cod-obligations` accepts `{booking_id, parcel_id, expected_version:0, beneficiary_id, beneficiary_revision_id, amount_paise, currency:INR, active}`. `POST /cod-obligations/:id/revisions` uses the current positive version and obligation root. Owned parcel/booking and approved beneficiary revision are bound before immutable configuration. Existing collected/reserved principal rules govern changes.
- `POST /api/v1/agent-settlements/cod-allocations` accepts `{receipt_id, obligation_id, obligation_revision_id, amount_paise, currency:INR}`. It reserves owned goods principal within the receipt's common freight/COD capacity; it does not record another collection or seller payment.
- `POST /api/v1/agent-settlements/agents/:id/fee-terms` accepts `{expected_version, basis:per_delivery|agreed_period, amount_paise, currency:INR, valid_from, valid_until, active}`; current agent identity, latest version and approved half-open period are checked by the existing fee service.
- `POST /api/v1/agent-settlements/fee-earnings/delivery` accepts `{proof_id, term_revision_id}` and requires genuine eligible completed proof and current per-delivery terms. `POST /fee-earnings/agreed` accepts `{term_revision_id}` for the explicit approved agreed period. Neither accrual recognizes expense or pays money; overlapping accrual remains rejected.

All eight commands return201 with `{command_id, resource_id, recorded_at}` from the existing actor-owned immutable command record. `resource_id` names the new beneficiary/obligation/term revision or allocation/earning as appropriate. Session/origin/CSRF, strict fields, current owned scope, idempotency fingerprint, optimistic version, private no-store response and existing franchise-lock rules apply. Configuration/accrual requires current local franchise admin; receipt COD reservation allows the existing admin/operator action. Org-admin-only, accountant/read-only and agent membership confer no new mutation capability. `AGENT_MONEY_ENABLED` defaults off for new entry; exact completed-key recovery rechecks current authority and remains available with entry disabled. Existing cashbook proposal/different-admin approval/application still owns fee expense, advance/payment, remittance and corrections. Production owner read selectors/forms remain pending and cannot be replaced by these service endpoints alone.

#### #144 bounded owner finance sources (partial)

`GET /api/v1/agent-settlements/finance/:kind?organization_id=...&franchise_id=...&cursor=...` accepts `beneficiaries`, `obligations`, `allocations`, `fee-terms`, `fee-earnings`, `advances`, `proofs`, `receipts` or `parcels`. It returns `{kind,organization_id,franchise_id,as_of,timezone:"Asia/Kolkata",currency:"INR",items,next_cursor}` with at most 100 minimum scalar rows. Current scoped finance-read authority is required. Cursors bind actor/catalog/tenant; each page has one current SQL snapshot. No frozen multi-page or total-count promise is made. These private reads remain available with agent money writes disabled. Unknown query fields and mismatched/malformed cursors are validation errors; sibling/foreign ownership is concealed.

Public shared `agent-money.ts` specifies source projections. Fee `direct_paid_paise` includes all payment methods; `cash_paid_paise` and `noncash_paid_paise` partition it. Original advance request `id` is the payment binding and `head_request_id` is correction evidence. Genuine completed-proof references exclude proof secrets; parcel `recorded_at` uses committed command time. The owner form calls the previously documented versioned command routes and rereads current catalogs after confirmation. Request submission, independent approval and applying money effects remain separate cashbook routes.


#### #144 source-backed money requests

The franchise-admin cashbook view offers actual agent advance, earned fee expense
recognition, payment of an already recognized fee, seller COD remittance and unused
reservation reversal. It uses the existing cashbook request/decision/application
routes and current source version. A different current local franchise admin must
review; an admin applies the exact approved request. Accountants and agents receive
no money mutation grant. Responsible employees remain current operators/admins.
Current delivery agents may be cash custodians only behind the agent money gate;
that extension grants them no ordinary cashbook write authority.

Fee expense amount preserves the full earned entitlement once. Direct payment and
explicit application of an original same-agent advance are separate bounded fields.
The selected payment method affects only the direct amount. Later fee payment
requires recognized expense and cannot exceed remaining entitlement or advance.
COD remittance binds its original allocation and beneficiary revision. Reservation
reversal has a null method, uses the original receipt account/custodian and creates
no cash leg. The receipts catalog adds only `account_id` for that owned selector.

Exact request recovery compares occurrence timestamps by their identical instant
when the server canonicalizes fractional zeros; all money and source fields retain
exact comparison. A different instant or amount remains a protocol failure.


#### #144 own-agent handover entry

Agent settlements exposes a handover-only screen for delivery agents.
`GET /api/v1/cashbook/handover-sources` uses the existing handover-select authority
and returns at most100 current owned cash locations plus a UUID keyset cursor.
Fields are only `{id,name,custodian_id,kind:cash,active:true}`. Every location belongs
to the signed-in actor and selected franchise, with an active current account/location
revision; even an admin using this selector receives only their own sending locations.
Continuation rechecks current scope and membership. The existing target selector
supplies current revisions and source version; request/acknowledgement routes retain
their exact owner and named-receiver checks. General cashbook locations, balances,
requests, expense and money receipt endpoints remain forbidden to agent-only users.

The handover workspace preserves its immutable uncertain request, blocks settlement
and franchise navigation, and recovers the same key. Occurrence spelling is compared
by identical instant, while source/target references and amounts remain exact.

#### #145 physical closing

All paths are under `/api/v1/cashbook`, with the normal organization/franchise selection,
current cookie identity, origin/CSRF, private/no-store response and actor-owned versioned
idempotency contract. `CASH_CLOSE_ENABLED=true` enables new mutations; default false,
invalid flag values and demo activation are rejected. Saved history and exact committed
replay remain available under current authority when disabled.

| Route | Evidence / action |
| --- | --- |
| GET/POST `/sessions` | Bounded actor-bound cursor list / open exact drawer revision and business date |
| GET `/locations/:id/closing-summary` | Minimum own-drawer latest accepted opening and current session eligibility |
| GET `/sessions/:id` | Frozen current/accepted count, review and separate current-source/dependency comparisons |
| POST `/sessions/:id/opening-revisions` | Append initial-only correction: exact `opening_id`, expected version, actual `counted_at`, integer `counted_paise`, denominations and evidence/reason; open/rejected only |
| POST `/sessions/:id/opening-reviews` | Current admin approves exact `opening_id` with expected version, reason and explicit `sole_admin_acknowledged`; open/rejected/submitted only |
| POST `/sessions/:id/counts` | Append immutable physical capture with expected version, actual time, paise, optional denominations and explanation |
| POST `/sessions/:id/submissions` | Submit own exact `count_id` and expected session version |
| POST `/sessions/:id/decisions` | Review exact `submission_id`, `approve`/`reject`, reason and explicit `sole_admin_acknowledged` |
| POST `/sessions/:id/reopens` | Current-admin reasoned replacement; accepted evidence remains unchanged until replacement approval |
| GET `/sessions/:id/sources?capture_id=…` | Retained complete frame in 100-row actor/scope/capture-bound pages |
| GET `/sessions/:id/history` | Immutable commands/counts/submissions/decisions in 100-row actor-bound pages |
| POST `/sessions/:id/exports` | E03 snapshot of exact `capture_id` under existing report quotas/expiry/audit |
| GET `/close-exports/:id/download` | Current E03 authorization plus snapshot actor ownership; frozen formula-safe CSV |

Mutations return an immutable command outcome (`command_id`, `session_id`, operation,
version, state, recorded time and the applicable opening/opening-review/count/submission/decision DTO). Never
mass-assign server ownership, sources, totals, clocks or review mode. Operational states
are `open`, `submitted`, `approved`, `rejected`; every save advances the expected session
version. Approved counts and old submissions do not change on reopen, source correction,
deactivation or successor repair. Native microsecond boundaries are preserved. Captures
and aggregate amounts use decimal-string paise; user amount inputs remain safe integers.

`CASH_CLOSE_SOURCE_CHANGED` requires explicit recapture; `CASH_CLOSE_OPENING_CHANGED`
requires refreshed initial or predecessor evidence; `CASH_CLOSE_REVIEW_REQUIRED` reports current
D137 reviewer eligibility; `CASH_CLOSE_LIMIT_EXCEEDED` names the 5,000-record/8-MiB
technical bound. Existing stale/idempotency/not-found/error envelopes apply. No error
reveals foreign record counts or amounts. Operators see only assigned drawer evidence;
no agent role or source reference grants customer directory access.

Initial-only `revise_opening` and `review_opening` commands never replace predecessor carry.
Session detail retains original `initial_opening`, exposes `current_initial_opening` and
its exact `initial_opening_review`, and distinguishes current capture readiness from
historical accepted evidence. Opening snapshots include `initial_revision_id` and
`previous_initial_revision_id` (null for predecessor carry). Counts/submissions bind the
selected revision; altered initial evidence requires fresh capture before submission.
Closing decisions preserve `opening_revision_id` and `opening_review_id`; a combined
approval returns its own opening-review DTO, while a rejection never establishes approval.
Private CSV metadata includes those exact references for the exported capture and its
saved decision; already-captured exports never change. Separate opening approval after
count capture is attached to the final decision, not retroactively to that frozen count.

The detail review block exposes separate `mode` (approval), `rejection_mode`, and
`opening_mode`. Rejecting another counter requires no approval of the rejecter's own
initial opening; the UI uses the selected decision's server eligibility. Neither rejection
nor merely capturing an ending creates an opening approval. A combined closing's self-review
label may differ from its opening-review label when only the ending is self-authored; each
saved approval describes the evidence author it actually reviewed.

### Shipment costs and contribution (#147)

Public types are in `packages/shared/src/shipment-cost.ts`. All endpoints are scoped by
`organization_id`/`franchise_id`, authenticated cookie and standard CSRF on writes,
`Cache-Control: no-store`. Franchise admins alone mutate costs (W70); report R25/R28
reads and E03 exports remain unchanged. An org-admin/accountant/operator read grant
never implies cost mutation. Reauthorize current membership before every replay.

- `GET /api/v1/shipment-costs?cursor=`: 100 source heads, opaque scoped keyset cursor.
- `GET /api/v1/shipment-costs/selectors?cursor=`: bounded owned booking/parcel, applied
  expense and approved purchase-rate references; no customer directory projection.
- `GET /api/v1/shipment-costs/:id`: immutable revisions and allocation history, bounded
  at 5,000 revisions and 8 MiB with a controlled limit error, never truncated.
- `POST /api/v1/shipment-costs`: one `ShipmentCostInput`, durable actor-key command.
- `POST /api/v1/shipment-costs/:id/revisions`: same input with matching `source_id` and
  `expected_version`; full replacement allocations, no silent over-allocation.
- `POST /api/v1/shipment-costs/imports/preview`: `{rows: ShipmentCostInput[]}` (1–100),
  or `{format:'shipit_cost_csv_v1',content_base64:string}`. Strict CSV headers are
  `category,state,amount_paise,effective_at,reason,reference,supplier,document,line,booking_id,parcel_id`;
  each row is one whole-source booking allocation. JSON supports split allocations,
  corrections and native rate/expense references. Preview resolves server evidence,
  records precise row failures and is immutable. It never applies money or costs.
- `POST /api/v1/shipment-costs/imports/:id/apply`: `{}` and a durable command key;
  all rows commit atomically after revalidating the exact preview source versions.
  Invalid preview, stale sources and conflicting canonical identity fail the batch.
- `POST /api/v1/reports/contribution`: `ContributionFilter`; null E/K chooses the
  same current server instant. A selected E/K is canonicalized to six fractional
  digits without rounding source facts. 31-day IST booking cohort, 5,000 rows,
  8 MiB, actor-bound 24-hour frozen snapshot and 100-row pages.
- `GET /api/v1/reports/contribution/:id?offset=` and `.../:id/export`: existing
  report authorization/expiry semantics; source evidence in each booking row supports
  drill-through. Export returns formula-safe CSV with allowlisted columns and source
  IDs, never private reasons or invoice details.

`SHIPMENT_COST_WRITES_ENABLED=false` by default. Disabled entry retains history and
exact completed-command replay. Uncertain results must retry the identical key/body;
changed bodies conflict. There are no monetary side effects or external deliveries.

## Versioned settings and authorized report scope (#66)

`GET /api/v1/settings/organization?organization_id=…` returns own-org defaults to
org_admin; `GET /api/v1/settings/franchise?organization_id=…&franchise_id=…` resolves
R20 effective preferences. Both return `SettingsDto` schema 1 with owner version,
organization version and each allowlisted key's value/state/source version and effective
and recorded times, editability, consumer contract and current availability. An absent
local key inherits the organization key, otherwise remains unconfigured. Empty explicit
lists remain configured. Organization values say configured, not inherited.

POST to the same URLs takes exactly `{expected_version,changes,reason}` plus the scoped
`Idempotency-Key` header. Zero is the initial version; each `changes` key contains a typed
value or null to clear (restore inheritance locally). Omitted keys are unchanged. A
bounded reason is mandatory. No caller actor/owner/version ID/effective time is accepted.
Versions become effective at their server-recorded instant until superseded, with no
scheduled/future overlapping intervals. The immutable version, command receipt, safe
version audit and durable `settings.versioned` event commit atomically. Event metadata
contains keys/scope/version, not entire values or credentials.

GET `/settings/{organization|franchise}/history` uses the same required scope query and
optional positive integer `before`; it returns at most 50 administrative history items
and `next_before`. R38 governs history. Reads use no-store. Standard cookie/session/CSRF,
strict unknown-key rejection and a 64 KiB POST limit apply. Exact current-authorized
key/body replay returns its original result; altered intent gives IDEMPOTENCY_CONFLICT.
Stale expected version gives VERSION_CONFLICT; reload the effective endpoint without
losing the local draft before explicitly replacing its expected version. New commands
require active organization/franchise and default-off SETTINGS_WRITES_ENABLED. Disabled
new commands return SETTINGS_DISABLED; completed replay stays available after authority
checks. Foreign and unknown scope/reference IDs both return RESOURCE_NOT_FOUND. Known
own-scope missing actions return ACTION_FORBIDDEN, malformed input VALIDATION_FAILED.

`GET /api/v1/reports/scopes?organization_id=…&franchise_id=…[&cursor=…]` lists up to 50
current permitted financial report franchise IDs/names and per-franchise E03 export
hints, `next_cursor`, and `maximum_selection:50`. Unknown/unpermitted cursors are concealed.
A capture must still include the active franchise and reauthorize its entire scope.

The strict public key/value allowlist is `packages/shared/src/settings.ts`; see
[settings operations](settings-operations.md) for each consumer. Optional
`settings_version_id` in `PricingQuoteInput`, `SalesFilter` and `ContributionFilter`
identifies an explicitly accepted service/report-scope suggestion. On a NEW quote/capture
its current effective owned key must match both source ID and selected value. The
immutable quote inputs (including booked quote evidence) or report filter pins this ID.
Absent optional fields preserve legacy decoding and idempotency fingerprints. Old quote
validation/replay and saved report reads never replace their source with newer defaults.

### #142 account statements

See [account statement API and recovery](account-statements.md). Version-checked previews/issues, immutable reads, bounded history and actor-owned 24-hour private CSV captures reuse existing session/CSRF/scoped retry contracts.

The same runbook specifies receipt-bound unused-advance request, independent
review and actual-return endpoints. Approval alone posts no movement. Actual
returns use immutable manually recorded evidence, a current configured source
location and shared receipt/COD capacity; noncash returns feed optional manual
reconciliation without duplicate financial posting.

## Owner daily metrics (#148)

The versioned `owner_daily_v1` summary/evidence contract is exposed through
`POST /api/v1/reports/daily`, `GET /api/v1/reports/daily/:id` and its `/export`
endpoint. Filters, half-open Kolkata comparison cutoffs, source equations, error
codes and R11/E03 reauthorization follow [the reporting contract](reporting.md#owner-daily-dashboard-148).
Capture is a private saved report, not a financial mutation or a new ledger.
