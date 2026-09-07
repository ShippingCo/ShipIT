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
| 409 | VERSION_CONFLICT | Authorized new command has stale expected revision; query current truth before a new deliberate command |
| 409 | PARCEL_STATE_CONFLICT | Authorized command conflicts with current lifecycle/custody/attempt state |
| 409 | IDEMPOTENCY_CONFLICT | Same scoped key has different canonical intent; never return original result or fingerprint |
| 409 | IDEMPOTENCY_IN_PROGRESS | Same intent is still unresolved; retry same key/body, never execute concurrently |
| 415 | UNSUPPORTED_MEDIA_TYPE | Command body is not supported JSON media type |
| 422 | VALIDATION_FAILED | Parseable input fails schema/semantic validation, including missing key/version, wrong type, unknown field or limit outside 1..100 |
| 422 | CURSOR_INVALID | Invalid/tampered/expired or query-incompatible cursor; generic message, restart authorized query |
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
