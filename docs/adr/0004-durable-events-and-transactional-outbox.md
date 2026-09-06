# ADR 0004: Durable events and transactional outbox

Status: proposed for acceptance by the issue #2 reviewed PR. Date: 2026-09-06.

## Context

Prototype `save()` and `queueMsg()` are separate browser writes. Issue #4 requires
versioned API/events, command deduplication and ordering; #35/#39 implement durability.
A valid committed booking must survive a provider outage or a lost HTTP response.

## Decision and transaction invariant

Business mutation, relevant safe audit, idempotent command result and producer's outbox
append share one PostgreSQL transaction. Consumers see only committed facts. Provider
calls happen after commit via a worker; never while holding the operational transaction
open. Rollback means no committed business effect and no published event. After commit,
provider failure cannot roll back or silently compensate the booking/ETA/delivery/ledger.

An event is an immutable fact, not a request for a consumer to decide whether source
business state exists. Producers own source state; each registered consumer owns only
its declared effect. A worker uses short transactions to claim work with a bounded lease,
then performs external I/O outside DB transactions, and records outcome durably. Expired
leases recover crashed work; a crash after an external effect can still cause ambiguity.
Do not claim exactly-once external delivery. #35's relay may materialize separate durable
job records: insertion with unique event/consumer identity and dispatch acknowledgement
must be atomic in PostgreSQL, or independently replay-safe without losing committed work.
An in-database implementation needs no external broker. Relay acknowledgement never
means that a provider accepted or delivered the message.

## Command and REST conventions

Use `/api/v1` as the public API version prefix; resource/action paths and final schemas
belong to #4 and the owning feature issue. No endpoint implementation or invented route
catalog is implied. Commands express validated intent and return canonical business
results; queries are scoped and do not mutate business state. Separate request, response,
internal row and event schemas. Version compatibility is part of #4's contract review.

Use a stable structured error strategy: machine-readable code, safe message, correlation
ID, and optional safe validation details. #4 fixes field names/schema and pagination.
Use 401 for missing identity, 403 for denied action on visible scope, uniform 404 for
foreign/unknown objects, and 409 for stale state or mismatched replay. Never expose SQL,
provider internals, credentials or private existence through errors. Client tenant fields
are requested selectors only; authenticated membership or a verified registered provider
installation determines actual context.

For duplicate-sensitive commands, persist a key scoped to the authorized actor/installation,
organization/franchise and operation, with canonical request fingerprint and original
result. Same key/body returns the original authorized result; different body conflicts.
Concurrent submissions serialize through DB constraints/locking. After timeout, retry
with the same key/body to reconcile instead of creating a fresh command. Reauthorize
before returning a stored result; revoked access must not expose historical data.
Exact normalization, retention and expired-key behavior are D04, resolved before #22/
#28/#42 implementation. No indefinite idempotency guarantee is implied by this ADR.

## Internal event envelope convention

| Field concept | Meaning |
| --- | --- |
| Event ID | Stable identity of the immutable fact across replay |
| Event type and schema version | Domain fact name plus explicit payload contract version |
| Aggregate type, ID and version | Owning entity and committed revision; version is not a timestamp ordering substitute |
| Organization/franchise context | Trusted ownership copied from persisted source; absent franchise only for genuinely organization-level facts |
| Occurred-at | Server UTC time of the fact |
| Payload | Minimum non-secret references/facts required by declared consumers |
| Correlation and causation | Link command → route/parcel effects → notification purpose without double-send |
| Command reference | Opaque server reference to deduplication evidence; no credential-bearing raw key |

This is an internal envelope, not a promise to export all events through shared or public
HTTP. Never include OTP, verifier, full address, token or raw provider payload. Recipient
and protected content are resolved by the authorized owning service at processing time;
challenge events carry an opaque reference only. #4 ratifies catalog/schema details
including `booking.created`, `route.delayed`, `delivery.completed` and their producers.
These names are candidate examples from #4, not implemented handlers.

## Retries, ordering and side-effect identity

Conceptual processing lifecycle: pending → leased → completed, or retry-wait → leased;
permanent/poison/exhausted outcomes → quarantined/manual review. Lease/outcome metadata
may change; event facts do not. #35 owns lease, retry bounds, fairness and safe redrive.
Redrive preserves logical identity; it does not mint a new fact.

Consumers deduplicate by consumer + source/cause + purpose + affected entity/recipient
within scope; exact keys are #4/#40. Duplicate route/parcel causes cannot create redundant
same-purpose notifications. Apply aggregate-version ordering; duplicates/stale events
cannot regress facts or send obsolete updates. Gaps/unknown mandatory schema versions
remain blocked/quarantined for reconciliation, not silently interpreted. #4 defines
compatible evolution and per-consumer stale/gap policy (D04).

Messaging state is separate: intent pending/blocked/skipped, provider accepted, verified
delivered, retryable failure, uncertain acceptance, or terminal/manual review. These are
semantic states for #39's final schema. Accepted is not delivered. Recheck current consent,
terminal parcel status and template eligibility at send time. Persist safe skip reasons.

Retry only when safe given provider acceptance semantics. Use a stable provider idempotency
reference if the verified capability supports it. If the request may have been accepted,
record uncertain and reconcile by provider evidence, or require operator resolution;
never assume a network timeout proves no send. Lease ownership and DB deduplication alone
cannot prevent duplicate external effects after worker crash. Verified callbacks persist
before acknowledgement and cannot regress newer delivery state.

## Consequences and alternatives

The PostgreSQL outbox avoids a database/message dual-write failure and does not require
Redis, Kafka or another queue dependency. It adds lease/retry/poison management and
operational observability. Direct post-save sends lose work on crash; sends inside the
transaction couple business validity to provider availability. Neither is accepted.

#35 chooses implementation mechanics within this invariant (D05). Any future broker is
an explicitly reviewed implementation choice, never a substitute for atomic source/outbox
persistence. See [runtime failure walkthroughs](../architecture/runtime-sequences.md).
