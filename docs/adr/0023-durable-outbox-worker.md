# ADR 0023: PostgreSQL outbox jobs and fenced database effects

Status: proposed for independent review with Issue #35. Implements D05 within ADR 0004.

## Context and evidence

Starting main is `d0f8670aa1a0053a908cf2f6f437a6d243b981e3` (PR #118).
Issues #2–#34 are closed; all six #35 prerequisites and their implementations are
present. There are 21 released migrations. Booking, Parcel, Lot, Route and payment
producers already commit immutable events. No producer transaction is replaced.

The recovered **Implement issue 28** conversation establishes the working method:
reconstruct actual merged state, study the owning domains and permissions, compare
primary engineering sources, record bounded decisions, implement additive schema,
test real PostgreSQL crash/concurrency/isolation behavior, and report actual gates.
Validation reports distinguish completed checks from interrupted or unexecuted checks.

## Decision

Use PostgreSQL, the existing transaction wrapper and tenant capabilities. Do not add
a broker, queue library, workflow engine, provider traffic or business consumers.
The production consumer registry starts empty; downstream owner issues add reviewed
handlers. Synthetic consumers demonstrate real database effects in tests only.

Jobs reference immutable source events, unique by `(event_id, consumer_id)`. The relay
anti-joins missing jobs repeatedly; it has no event timestamp/sequence watermark and
therefore also discovers a transaction that commits late. Unknown versions of a
subscribed event become jobs and are quarantined before handler invocation. Events
with no registered subscriber remain immutable and available for future registration.

The state machine is `pending/retry_wait -> leased -> completed`, with permanent,
incompatible, unreconciled and exhausted work entering `quarantined`. Five claims are
allowed per redrive cycle, including expired leases. Total attempts never reset.
Lease duration is 30 seconds on the PostgreSQL clock. Claim and acknowledgement are short transactions;
database effects execute in a separate transaction with a 25-second database deadline. Every transition uses
the current opaque lease token. The effect holds the job row and aggregate stream
row until commit, so recovery cannot overlap a stale database writer. A lease is
checked again before receipt insertion. External calls are forbidden in handlers.
Future provider delivery needs #39's separate intent/uncertainty protocol.

The effect and immutable consumer receipt commit together. A separate acknowledgement
can be lost without repeating the effect. Reclaim observes the receipt before running
a handler. Retain all receipts, attempts and redrives; deletion policy belongs to #72.
Retry delays use exponential backoff with bounded jitter, 1–30 seconds. Database outage
leaves the lease recoverable; no raw exception is persisted or logged.

Scheduling persists separate relay/claim/quarantine-alert turns per organization/franchise. A short
try-advisory-locked scope selector chooses the least recently serviced eligible
tenant, then each transaction admits at most 100 relay jobs or one claim. For N
continuously eligible tenants, each receives a turn within N successful selections,
assuming bounded transactions and a stable tenant set. Busy selectors return no work;
workers poll again. No global FIFO or fixed prefix can permanently starve tenant B.
Default polling is one second, one in-flight job per process; multiple processes may
run. Consumer registration is bounded to 32 consumers and 64 types per consumer.

Ordering uses aggregate type/ID/version, not wall-clock event timestamps. Stream
high-water and exact event receipts are separate. Another event at an already
receipted version is quarantined as an integrity conflict. M/P stale events receive
`skipped_stale`; H/R may process historical evidence without lowering high-water.
Every gap (including first event >1) requires a registered reconciliation callback
to certify safe handling within the same transaction, otherwise quarantine. H can
certify non-emitting versions; P must refresh authoritative state; M must check current
relevance; R must reconcile its owner. The infrastructure does not invent that truth.

R18 exposes minimized job state/count/age/history to org_admin within its organization
or franchise_admin within its explicit grants. W44 adds controlled quarantined-job
redrive to franchise_admin in F scope only, with live membership, active roots,
expected job revision, scoped idempotency key and closed reason (`dependency_repaired`,
`consumer_upgraded`, `ordering_reconciled`). W34 arbitrary redrive stays denied. Redrive
preserves event, consumer, job, attempts and quarantine history; it cannot change a
payload or clear a receipt. The canonical audit projection includes redrive evidence.

## Alternatives and primary research

- [PostgreSQL 18 SELECT](https://www.postgresql.org/docs/18/sql-select.html): SKIP LOCKED
  is appropriate for competing queue consumers; it is not a consistent business read.
- [AWS: Making retries safe](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/):
  stable intent identity and atomic recording of effects/replay evidence apply directly.
- [Stripe: Idempotency](https://stripe.com/blog/idempotency): ambiguous outcomes need
  safe retries and bounded backoff. A remote timeout is not proof of nonacceptance.

These lessons justify durable identities and failure tests, not Kafka, distributed
consensus or universal exactly-once claims. A broker would retain the producer outbox
and add deployment/reconciliation effort without a demonstrated need here.

## Implementation and acceptance mapping

One forward migration adds jobs, schedule state, streams, receipts, immutable attempts
and redrives; immutable source rows and all released migrations remain unchanged.
Narrow definer functions discover owner references and perform fenced transitions.
Private repositories still require scoped SQL; workers mint only infrastructure
capabilities from persisted records. Existing product write actions remain membership-only.

Worker module and process: relay/restart/late-commit, two-worker contention, expired and
stale token, effect-before-ack crash, transient/permanent failures, schema quarantine,
aggregate stale/gap and fairness tests. Authenticated operational API: all seven roles,
sibling B/unrelated C/unknown selectors, strict input, CSRF, original redrive replay,
changed intent, stale revision, revoked grants and safe DTO/log/audit inspection.
Database tests: populated upgrade/no-op, constraints, runtime privileges, immutable
history, transaction rollback and no producer/evidence rewrite. Run focused tests then
full quality and migration integrity; report gate-drill completion precisely.

Rollout: apply additive migration, grant only documented runtime permissions, deploy
compatible API/worker, validate synthetic consumers in an isolated test DB, then enable
reviewed downstream subscriptions. Stop worker to roll back; retain schema/evidence and
repair forward. Large-backlog production qualification remains #74; hosted identity,
alert delivery and dashboards remain #68/#70. Quarantine state is durable and the worker
emits a closed actionable alert code; no external recipient is contacted by #35.
