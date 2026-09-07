# Command idempotency and reconciliation contract

[Architecture](README.md) · [API](api-contract.md) · [Events](event-contract.md) · [Scenarios](api-event-scenarios.md)

Issue #4 / v1, contracts and synthetic examples only. PostgreSQL tables, locks, retention
jobs and HTTP handlers remain with their owning issues. This refines [ADR 0004](../adr/0004-durable-events-and-transactional-outbox.md).

## Key, trusted scope and command identity

Every duplicate-sensitive mutation (including booking, T01–T13, route changes, custody,
collection and other approved destructive commands) requires one `Idempotency-Key` header.
A missing/invalid key is 422 VALIDATION_FAILED. Accept 1..255 case-sensitive ASCII letters,
digits, hyphen or underscore; reject duplicates, commas and whitespace rather than joining
or trimming them. Clients generate sufficiently random fresh keys for distinct deliberate
commands and retain them with their request until uncertainty is resolved. Examples use
`key_synthetic_01`; a key is neither a business identifier nor an authorization credential.

Exact scoped identity is the tuple:

```text
(principal_type, principal_id, organization_id, franchise_id_or_null,
 operation_id, idempotency_key)
```

`principal_type` is `user` or `integration`; integration ID is the verified registered
installation identity, not a caller-selected provider label. `operation_id` identifies
the versioned command definition, e.g. `api.v1.bookings.create` or
`api.v1.parcels.dispatch`. Resource IDs belong in intent, not operation identity: reusing
a dispatch key for another parcel in the same scope must conflict. Franchise is the
trusted **acting** franchise for franchise-scoped operations, including C custody work;
the event's owning franchise can differ. Null is reserved for genuinely organization-level
commands. Validate command authority for the actual target ownership/custody separately.

Membership or source-verified integration scope supplies context. Client organization/
franchise selectors cannot manufacture membership. No lookup by raw key alone, no
cross-actor fallback, no organization-wide key search, no public replay-record endpoint.
Different valid scope produces a different namespace, not permission to repeat a business
fact; domain versions/uniqueness still guard duplicate effects across keys and actors.

## Canonical intent and fingerprint boundary

Persist an opaque server `command_id`, a fingerprint of canonical normalized intent,
normalization contract version, original authorized business status/DTO, resource references
needed for replay authorization, commit instant and retention boundary. This is conceptual
record content, not a product schema. Raw keys and fingerprint material never enter events,
public errors or ordinary logs. Stored results themselves remain private and subject to
protected access/retention; a hash is not encryption of sensitive low-entropy input.

The fingerprint input is a canonical JSON object containing `operation_id`, resolved
`resource_ids`, normalized `content_type`, normalized semantic `query` inputs (empty if
none) and validated/default-expanded `body`. Include all intent-bearing fields, nested
IDs, child order where meaningful, expected versions, evidence references and preconditions.
Do not include authentication transport, the key itself, correlation/trace IDs, server
clock, generated result IDs or response preferences with no command meaning.

Canonicalization v1 boundaries:

1. Accept JSON media type case-insensitively, with absent charset or UTF-8; normalize it
   to `application/json`. Reject unsupported media types (415). Reject malformed JSON,
   duplicate object keys and non-finite numbers (400); never let parser last-key-wins
   alter intent. Validate operation-specific typed input before hashing.
2. Normalize only fields whose schema explicitly declares normalization (docket/instant
   rules are in the API contract). Preserve other string case, whitespace and Unicode
   code points; no blanket trimming, case folding or Unicode normalization. Reject lone
   surrogate code points. Resource IDs are opaque, exact strings after URL decoding once.
3. Expand declared defaults: omission equals an explicit default only when the schema says
   so. Explicit null remains distinct unless the schema explicitly equates it; unknown
   fields are rejected. Pin default/schema version with the record so a deployment changing
   defaults cannot turn an old retry into a different command; retain the old normalizer
   for the replay support window. Never reinterpret old intent using new defaults.
4. Recursively sort object keys lexicographically by Unicode code point. Preserve array
   order; a declared set input must normalize by its schema's stable sort/dedup rule.
   Reordered objects match, reordered parcel arrays remain distinct in the synthetic seam.
5. Numeric command fields in these examples are integers within the JSON safe range;
   schema-integer `1`, `1.0` and `1e0` normalize to `1`, and negative zero to `0`.
   Fractional domain inputs require an explicit canonical decimal representation from
   the owner before use; never fingerprint binary floating-point serialization as money.
6. Serialize UTF-8 canonical JSON without insignificant whitespace: JSON string escaping
   for quote/backslash as `\"` / `\\`; use `\b`, `\f`, `\n`, `\r`, `\t` for their
   five control characters and lowercase `\u00xx` for remaining U+0000–U+001F controls.
   Do not escape `/`; emit literal other Unicode characters, lowercase
   `true`/`false`/`null`, decimal integers with no exponent/leading zeroes. Hash these bytes
   with SHA-256; compare within the scoped namespace. The fixture uses no sensitive input.

A future change to canonicalization must preserve outstanding replay evidence or explicitly
version the operation with a reconciliation/migration contract. Hashing raw JSON bytes is
invalid. The fixture checks nested property order, defaults/nulls, arrays, preconditions,
resource IDs, media types and excluded correlation values.

## Commit, duplicate and concurrency behavior

Authorize identity, current action, target scope and every returned field/resource before
exposing stored data or mismatch existence. Then resolve scoped key/intent:

| Evidence | Result |
| --- | --- |
| Committed same key + same intent | Return original committed status/DTO after current replay authorization; no new mutation, counters, audit, outbox or notification |
| Committed same key + different intent | 409 IDEMPOTENCY_CONFLICT, no stored result/fingerprint disclosure |
| Same intent still in progress / commit unresolved | Serialize or wait within bounded request handling; if unresolved, 409 IDEMPOTENCY_IN_PROGRESS; client retains same key/body |
| No committed evidence and no competing command | Execute once subject to all current domain guards and expected versions |
| Failed transaction / pre-execution validation denial | No successful command result or business/outbox effect; same key/body may be retried after cause resolved |
| Expired evidence / uncertain old command | Original replay is not promised; reconcile authoritative resources before authorizing any new destructive command |

If an in-progress key already has a known different fingerprint, return
IDEMPOTENCY_CONFLICT; never rebind a reserved key or start a second command while commit
certainty is unresolved. Exact reservation/wait/recovery mechanics belong to the owners below.

Required future concurrency proof: two same-key commands cannot both win; competing keys
cannot both pass a stale version/unique business invariant. Locking, DB constraints and
isolation details are #10/#22/#24/#28, not this in-memory model. Replay authorization must
cover current permission to invoke the original action **and** the original DTO, even
when membership/assignment changes. Replays do not rerun already-satisfied lifecycle state
checks or repeat proof counters. If returning the original DTO would exceed current
permission, deny the whole replay using canonical 401/403/404; do not leak partial fields
or silently convert it into a new response. A separate authorized query may return a
narrower current projection.

Domain commands that intentionally commit unsuccessful attempt evidence (e.g. a wrong
own active proof under #42) must retain the same safe attempt outcome as their command
result, so one retry cannot spend another counter. That is not a successful delivery event.
#42 owns the detailed proof schema; no plaintext proof is modeled here.

Business changes + relevant immutable safe audit + idempotent result + every required
producer outbox fact commit in **one PostgreSQL transaction**. Consumers observe committed
facts only. Rollback leaves none of those successful effects. Provider I/O is after commit,
outside the business transaction; later failure cannot undo business/delivery/payment truth.

## Lost response, retention and expiry

If the API commits and the HTTP response is lost, the client must keep the same key,
body, path/resource and expected version. Reauthorize and return the original committed
result on retry. A transport timeout/500/503 does not prove rollback. Never generate a
fresh key merely because the outcome is uncertain.

Ordinary duplicate-sensitive commands retain replay evidence for **at least 24 hours from
commit**. This is a minimum, not a maximum; a sensitive domain may require longer. The
server records `retain_until >= committed_at + 24 hours`. Replay is guaranteed while
`now < retain_until`, subject to current authorization. At/after `retain_until` evidence
may still exist and safely replay, but is no longer promised. Fake-clock examples choose
exactly the minimum solely to demonstrate the boundary; no cleanup schedule is inferred.

After expiry, an old key is not permanent identity. Clients query by known entity ID/
docket under current authorization, or use the owner's authoritative scoped reconciliation
workflow if the lost response never supplied an ID. If that workflow cannot establish
certainty, escalate for authorized reconciliation; do not guess and submit again. #22/
#24/#28/#29 must define such query/reconciliation seams before supporting expired uncertain
commands. The server cannot always distinguish a never-used key from deleted evidence,
so no universal expired-key HTTP detection is promised. A client with known uncertainty
must stop automatic resubmission even when the server no longer remembers the key.
