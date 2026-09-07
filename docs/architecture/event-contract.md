# Internal event and consumer contract

[Architecture](README.md) · [ADR 0007](../adr/0007-api-event-idempotency-contracts.md) · [Idempotency](idempotency-contract.md) · [Scenarios](api-event-scenarios.md)

Issue #4 / v1. These are immutable facts and declared future consumer classes, not running
handlers, a queue schema or a complete catalog for every downstream feature. [ADR 0004](../adr/0004-durable-events-and-transactional-outbox.md)
remains unchanged. Events stay internal/server-side; public DTOs and customer timelines
are separately authorized minimized projections.

## Common envelope, exact fields

All fields below are required except `franchise_id` for genuinely organization-level
facts. Present optional fields must have their declared type; do not use null to mean
an unknown required value. The initial 17 events are all franchise-scoped.

| Field | Type / meaning |
| --- | --- |
| event_id | Opaque unique string identifying this immutable fact; stable across transport replay/redrive |
| event_type | Stable lowercase domain + past factual name, e.g. parcel.dispatched; no command verbs or version suffix |
| schema_version | Positive integer for this event_type's supported wire schema; initially 1 |
| organization_id | Trusted owning organization from committed source |
| franchise_id | Trusted owning franchise when applicable; custody/acting franchise is not substituted for ownership |
| aggregate_type | Closed initial set: booking, parcel, route, payment_obligation |
| aggregate_id | Opaque authoritative entity ID; ordering key never uses parent Booking for separate children |
| aggregate_version | Positive committed revision, same integer bound as public version; allocated by owner, never worker/timestamp |
| occurred_at | Authoritative server fact instant in canonical UTC format from the API contract; distinct source observations stay protected |
| actor | Object with exactly type and id; type is user, integration or service; ID is authenticated actor/verified installation/registered service reference, not a display name |
| correlation_id | Opaque server reference grouping related high-level work; carried through descendants; never authorizes or deduplicates by itself |
| causation_id | Opaque immediate causing command_id or event_id, not a trace/span or timestamp |
| command_id | Opaque server command reference anchoring this mutation to idempotency evidence; never the raw Idempotency-Key |
| payload | Object with event-specific required safe fields in the catalog; versioned optional additions only under compatibility rules |

```json
{"event_id":"evt_synthetic_dispatch","event_type":"parcel.dispatched","schema_version":1,"organization_id":"00000000-0000-4000-8000-000000000001","franchise_id":"00000000-0000-4000-8000-000000000011","aggregate_type":"parcel","aggregate_id":"00000000-0000-4000-8000-000000000301","aggregate_version":4,"occurred_at":"2026-09-07T03:30:00Z","actor":{"type":"user","id":"actor_synthetic_operator"},"correlation_id":"cor_synthetic_01","causation_id":"cmd_synthetic_dispatch","command_id":"cmd_synthetic_dispatch","payload":{"manifest_id":"man_synthetic_01","dispatch_evidence_ref":"evidence_synthetic_01"}}
```

For direct command facts, causation_id equals command_id. When an authorized domain
command reacts to an event, causation_id is that immediate source event ID and command_id
is the new server command reference; carry correlation_id forward. Transport retries
preserve the entire envelope. A worker crash does not mint a business event or a command.
Related route/parcel facts created by one coordinated command share its command_id/cause.
Safe audit separately records owning and acting scope and required grant/evidence details.
No arbitrary client correlation string is copied to logs; the server assigns a safe ID.

Payload `*_ref`, `*_id` and set references are opaque nonempty strings, not signed URLs,
serialized records or credentials. `collection_deadline` is a canonical UTC instant;
`failure_reason` is exactly the seven approved [lifecycle codes](parcel-lifecycle.md).
Set references identify immutable, scoped snapshots, including affected Parcel IDs and
committed revisions and updated/skipped reasons where relevant. A reference is never
permission to traverse a parent Booking, customer directory or other child.

NEVER put plaintext OTP/verifier, auth/session/provider/carrier secrets, full addresses,
phone numbers, sensitive proof, raw provider payload or operational free-text narratives
in general envelopes. Resolve protected content under the consumer's **own current**
authority through owning services; restrict challenge material to approved delivery send
paths. D07/D08 and #6/#13/#42/#72 own those controls; this contract adds no secret storage.

## Initial catalog and ownership reconciliation

Every catalog row is a distinct committed fact. T01 emits one `booking.created` for the
commercial parent and one `parcel.booked` per child from the same transaction. The latter
establishes each physical child's initial revision/docket/awaiting_intake fact; it does
not authorize a second booking confirmation. All child creation is atomic, not best effort.

T01–T13 map to [Issue #3's exact transition/audit facts](parcel-lifecycle.md). T11 and T12
share `parcel.rto_approved` with an eligibility evidence reference. T10 emits
`delivery.collected`, not an additional `delivery.completed`; T13 emits
`delivery.reversed`, not another `parcel.held_at_office`. Event prefix names the fact,
not automatically the producer: Parcels owns T13's correction/lifecycle invariant.
Deliveries owns attempt/proof facts (including T07's ended attempt); Parcels owns each
associated physical lifecycle/counter change. These owners share the transaction and
Parcels supplies the committed parcel revision to Deliveries. No consumer can later
perform the missing half. This preserves the restricted completion boundary in #2/#3.

All delivery lifecycle facts use the **Parcel** aggregate revision so T02–T13 form one
ordering domain; this does not transfer proof ownership to Parcels or give Deliveries
independent version allocation. No redundant parcel.out_for_delivery/parcel.delivered
facts are emitted for the same edge. The old Issue #4 candidates
`parcel.out_for_delivery` and `delivery.failed` are replaced by
`delivery.attempt_started` and `delivery.attempt_failed`. The UI label out_for_delivery
remains the canonical state, not an event alias. in_transit is an approved factual state
name despite its grammatical shape. Commands such as send_whatsapp, dispatch_parcel,
complete_delivery and verify_otp are not events.

Ordering abbreviations M/P/H/R are defined below and are mandatory for each corresponding
consumer category. Every row's privacy rule includes the envelope restrictions above.
All consumers are **planned**, and references do not imply their services already exist.

| event_type | Producer | Aggregate / fact | Committed-state invariant | Schema | Minimum required payload | Declared future consumers | Consumer-owned effect | Forbidden authority | Ordering | Privacy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| booking.created | bookings | booking / T01 | Parent commercial/customer snapshots and every child Parcel committed atomically | 1 | parcel_set_ref | messaging, reports | Booking confirmation intent; scoped commercial projection | No child lifecycle writes or automatic payment collection | M/P | Reference-only; current scoped resolution |
| parcel.booked | parcels | parcel / T01 | This child has a unique global docket, booked state and awaiting_intake custody | 1 | booking_id | reports, timeline | Per-parcel initial projection; no separate booking confirmation | No duplicate parent confirmation or customer-directory traversal | P/H | Reference-only; current scoped resolution |
| parcel.checked_in | parcels | parcel / T02 | Physical intake receipt and initial office/hub custody committed; parent active | 1 | receipt_ref | messaging, timeline | Safe received-at-office intent and timeline | No inferred dispatch or independent custody transfer | M/H | Reference-only; current scoped resolution |
| parcel.dispatched | parcels | parcel / T03 | Validated manifest, physical release, route_dispatch custody and permanent movement committed | 1 | manifest_id, dispatch_evidence_ref | messaging, timeline | Safe dispatch intent and timeline | No carrier acceptance claim or ETA/lifecycle mutation | M/H | Reference-only; current scoped resolution |
| parcel.in_transit | parcels | parcel / T04 | Authorized movement evidence and in_transit state committed; route custody retained | 1 | route_id, movement_evidence_ref | messaging, timeline | Safe journey intent and timeline | No sibling handover or delivery assignment from a route label | M/H | Reference-only; current scoped resolution |
| delivery.attempt_started | deliveries | parcel / T05 | Parcels committed out_for_delivery with accepted assignment/handover; Deliveries committed one active attempt and protected challenge | 1 | attempt_id, assignment_id, challenge_ref | messaging, timeline | Restricted challenge-send intent and safe progress projection | No plaintext challenge in envelope or consumer-created attempt/state | M/H | Reference-only; current scoped resolution |
| delivery.completed | deliveries | parcel / T06 | Deliveries accepted proof and consumed challenge; Parcels committed delivered and recipient handover, closing assignment/attempt | 1 | attempt_id, proof_ref | messaging, timeline, reports | Safe completion intent and scoped delivered projection | No payment settlement or proof reuse | M/H/P | Reference-only; current scoped resolution |
| delivery.attempt_failed | deliveries | parcel / T07 | Deliveries ended attempt and invalidated challenge once; Parcels committed failed_attempt/count under lifecycle guards | 1 | attempt_id, failure_reason | messaging, timeline | Safe unsuccessful-attempt intent and timeline | No automatic retry, RTO, payment write or raw reason narrative | M/H | Reference-only; current scoped resolution |
| delivery.retry_started | deliveries | parcel / T08 | Second/final attempt and fresh protected challenge committed with reconciled assignment/custody and out_for_delivery state | 1 | attempt_id, prior_attempt_id, assignment_id, challenge_ref | messaging, timeline | Restricted second-attempt intent and timeline | No third physical attempt or reset of first-attempt evidence | M/H | Reference-only; current scoped resolution |
| parcel.held_at_office | parcels | parcel / T09 | Authorized physical receipt, office custody and pinned collection clock committed; assignment closed | 1 | receipt_ref, calendar_ref, collection_deadline | messaging, timeline | Safe collection-availability intent and timeline | No invented business calendar, automatic RTO or hold extension | M/H | Reference-only; current scoped resolution |
| delivery.collected | deliveries | parcel / T10 | Approved in-window collection proof accepted; Parcels committed delivered/recipient handover and closed office assignment | 1 | proof_ref, collection_ref | messaging, timeline, reports | Safe collected intent and projection | No third doorstep attempt or payment collection | M/H/P | Reference-only; current scoped resolution |
| parcel.rto_approved | parcels | parcel / T11,T12 | Responsible franchise_admin approved eligible reason-driven return with safe evidence and accountable return plan; forward work invalidated | 1 | approval_ref, eligibility_ref, return_plan_ref | messaging, timeline | Safe return-initiated intent and timeline | No physical-return-completed claim or refund | M/H | Reference-only; current scoped resolution |
| delivery.reversed | parcels | parcel / T13 | Owning franchise_admin correction, recovered physical receipt and new hold clock committed; original delivery retained and reconciliation obligation appended | 1 | original_delivery_event_id, correction_ref, receipt_ref, calendar_ref, collection_deadline, reconciliation_ref | messaging, timeline, reports, payments_reconciliation | Safe correction intent; append history and reconciliation work reference | No erased delivery/ledger, automatic refund or attempt reset | M/H/R | Reference-only; current scoped resolution |
| route.departed | routes | route / route | Authorized typed departure evidence and validated frozen membership committed; any Parcel state effect passed its own role/transition guards | 1 | manifest_ref, affected_set_ref | messaging, reports | Safe per-affected-parcel route update intents and route projection | No automatic Parcel transit bypass or carrier acceptance claim | M/P | Reference-only; current scoped resolution |
| route.delayed | routes | route / route | Typed delay, distinct frozen affected set, updated/skipped outcomes and eligible Parcels ETA changes committed atomically | 1 | affected_set_ref, outcome_ref | messaging, reports | Per-parcel delay intents from committed affected set; scoped route projection | No asynchronous consumer ETA changes or terminal-parcel regression | M/P | Reference-only; current scoped resolution |
| route.arrived | routes | route / route | Authorized typed route arrival and physical observation committed; affected membership validated | 1 | manifest_ref, affected_set_ref | messaging, reports | Safe route arrival update intents and projection | No recipient delivery/proof or sibling custody grant | M/P | Reference-only; current scoped resolution |
| payment.settled | payments | payment_obligation / payment | Authoritative append-only collection evidence satisfies the Booking obligation under approved finance policy; no delivery inferred | 1 | booking_id, settlement_ref | reports, receipts | Scoped finance projection/receipt reconciliation under owning policy | No parcel delivery, automatic receipt reissue or invented refund/partial-allocation policy | P/R | Reference-only; current scoped resolution |

`payment.settled` is the already-justified settlement fact owned by Payments, versioning
the Booking's payment obligation, not the physical Parcel. Its emission remains disabled
until #8/#21/#29 approve the concrete financial/collection policy. Mere obligation creation,
partial delivery, provider receipt or a To-Pay flag cannot emit it. Receipts consumes only
within #30's approved issue/reconciliation policy; it cannot silently reissue an artifact.
Route facts are authoritative typed observations under #28, not carrier-title parsing;
operational Parcel effects still need their exact #3 actor/transition guards. Delay ETA
changes commit before route.delayed, not in a notification consumer.

No speculative parcel.eta_updated, cancellation, custody, grant, adoption, challenge-resend
or return-completed event is added here. Existing commands still require their approved
immutable audit facts; their owners #14/#16/#22/#24/#42/#79 extend the catalog when a
concrete consumer needs a safe durable fact. Not every audit row is an integration event.
No extra lifecycle edge or unresolved financial/proof/calendar policy is invented.

## Compatibility and rollout

`event_type` is stable and `schema_version` is a positive integer; never encode `.v1` in
the fact name. Common fields and catalog payload fields are required. A safe optional
addition may remain in the supported schema only if every supported old consumer can
ignore it without changing meaning, privacy or side effects. Unknown optional fields
may be ignored after privacy/schema validation. Unknown mandatory semantics cannot.

Removing/renaming a field, changing type/units/meaning, making a field required, or adding
a closed-enum value that old consumers cannot handle requires a new schema_version.
Optional does not mean safe to leak; privacy restrictions apply to every new field.
Consumers declare event_type/version support and migration tests. Deploy compatible
consumers before enabling new producers. Old v1 events remain immutable and replayable
while newly committed v2 facts may coexist. Each fact has one event_id and one immutable
schema representation; do not republish it with a new ID to manufacture compatibility.
Use an explicitly reviewed lossless reader/upcaster where possible, preserving source
identity and effect dedupe; otherwise quarantine. No automatic downgrade or lossy coercion.

Owners #35/#39 agree a support window covering retained backlog, retry, redrive and
reconciliation evidence before retiring readers. There is no invented operational
retention schedule here. Producer rollback requires continued support for already-emitted
new versions. A v1 consumer seeing mandatory incompatible v2/v99, an unknown event type,
invalid envelope or missing required field must record poison/quarantine/reconciliation,
with safe event/type/version/cause references and reason. It must not guess, acknowledge
semantic success, discard evidence as complete, or send. Transport acknowledgement is
safe only after a durable quarantine handoff guarantees recovery; mechanics belong to D05.

## Ordering, deduplication and gaps

Order within `(aggregate_type, aggregate_id)` using aggregate_version, with organization
scope validated too. There is no global order across children, parent, route and payment.
Use cause/affected-set references for cross-aggregate correlation, not timestamp sorting.
Each owner allocates one monotonic committed revision for a mutation; a replay allocates
none. Distinct facts sharing a revision, if a future catalog needs them, require event-ID
tracking in addition to version tracking and a declared completion set. The initial
catalog emits at most one listed fact per aggregate revision. Other authorized non-status
mutations (ETA/custody/assignment) may advance revision without a subscribed event.

Duplicate event_id with identical envelope is transport replay. The same ID with altered
content is an integrity/poison condition, not a valid update. A new ID with an already-seen
revision is not silently treated as a duplicate; reconcile unexpected facts according to
the declared stream contract. Aggregate high-water alone never replaces event-ID dedupe.

| Policy / consumer category | Duplicate and stale v7 then v6 | Gap v5 then v7 |
| --- | --- | --- |
| M: Messaging / side-effect intents | Deduplicate event and logical purpose; v6 cannot send obsolete same-purpose updates or overwrite newer intent. Mark skipped_stale with safe reference; recheck current Parcel state/version, consent, recipient scope and template at actual send | May skip versions only after authorized current-state/affected-set reconciliation shows the intent is still relevant. No need for every lifecycle event; unsupported/uncertain relevance stays blocked |
| P: Latest-state reports/projections | Duplicate is no-op; stale v6 cannot replace v7. Record safe stale disposition | May refresh from authoritative scoped snapshot at revision >=7 and replace projection atomically; never apply a delta as if v6 existed |
| H: Complete timeline/history consumers | Deduplicate by event ID. Late v6 may append missing immutable historical evidence in revision order, explicitly historical; never regress current state or send old notifications | If every subscribed fact/revision is required, record gap and hold dependent v7 projection until missing evidence or certified non-emitting revision is reconciled; no false complete flag |
| R: Reconciliation / ledger-sensitive consumers | Deduplicate source/effect; old evidence may remain relevant to reconciliation but cannot overwrite newer source or directly settle/reverse money | Require complete needed evidence; record unresolved gap/quarantine and reconcile through owning domain, never infer a financial adjustment |

A consumer requiring every aggregate revision must obtain authoritative revision coverage,
including mutations that emit no subscribed event. It cannot mistake an intentionally
unpublished revision for lost work forever, or treat filtering a stream as proof of
completion. Source snapshot/coverage contracts are feature-owner prerequisites. Quarantine
is an operational disposition, not permission to delete or rewrite the immutable fact.

Conceptual logical effect identity:

```text
(consumer_id, organization_id, owning_franchise_id,
 source_identity, purpose, affected_entity_id, recipient_ref_or_null)
```

For a simple event source_identity is event_id. For correlated booking/parcel or route/
parcel fanout for the **same purpose**, use the shared command_id (the originating cause)
as source_identity for every representation. Do not mix event-ID and cause-ID identity
for the same registered purpose. Correlation_id alone is too broad. Recipient is an opaque
reference resolved under current authority, not a plaintext phone/address. Per-parcel
booking confirmation uses the same cause/purpose/parcel/recipient if both sources are ever
registered; by default parcel.booked has no Messaging subscriber. Distinct reminders need
a separately authorized purpose/cause, not replay of the original effect.

Deduplication ownership/side-effect intent persistence must be atomic or independently
replay-safe; a crash cannot lose committed work by recording success before its effect
exists. Redrive preserves event and logical identity, even if processing attempt IDs
change. D05/#35/#39/#40 choose persistence, leases and atomic fanout mechanics. This issue
models one logical notification, not exactly-once external provider delivery.

## Transaction, worker and uncertain provider boundary

Business mutation + safe audit + original command result + all required producer outbox
facts share one PostgreSQL transaction. No send-before-commit path exists. Consumers
observe committed facts only; rollback publishes nothing. Worker/provider failures after
commit cannot roll back a booking, Parcel, route, delivery or ledger fact.

Conceptual processing: pending → leased → completed, retry_wait → leased, or
quarantined/manual_review. Claim durably with a bounded lease; expired work is recoverable.
Provider I/O runs after business commit, outside DB transactions; outcomes use later short
transactions. Relay/job insertion + dispatch acknowledgement must be atomic or separately
replay-safe as ADR 0004 requires. Claim/acknowledgement never equals provider delivery.

After provider acceptance but before local acknowledgement, a worker crash/network timeout
may leave **uncertain** acceptance. Retain logical identity and reconcile with verified
provider evidence/idempotency capability; otherwise require safe authorized manual
resolution. Do not blindly resend. Accepted and verified delivered are separate messaging
truths; neither is Parcel delivery or payment truth. Carrier observations and LLM text
cannot authorize lifecycle/ledger changes. Worker dedupe and leases cannot establish
universal exactly-once external delivery.

D05 stays **OPEN**: #35 owns lease duration, recovery, concurrency, polling, retry/backoff,
fairness, poison/redrive mechanics; #39 owns messaging processing/provider ambiguity;
#40 owns consumer dedupe persistence. No numeric worker values, queue library, production
table, adapter, timer or daemon are introduced by these contracts.
