# API/event tabletop and synthetic scenarios

[Architecture](README.md) · [API](api-contract.md) · [Events](event-contract.md) · [Idempotency](idempotency-contract.md) · [Verification](api-event-verification.md)

Reproduce from repository root with `python3 scripts/validate_api_event_contract.py` or
`python3 scripts/validate_planning.py`. The [fixture](fixtures/api-event-contract.json)
is fictional. It reuses Org A/A1/A2 and Org B/B1 relationships from #3; short labels in
command cases correspond to the UUIDs in [domain scenarios](domain-scenarios.md).
The synthetic create body contains only customer reference and two parcel input fragments;
it does not finalize #22's complete commercial/address/tax input schema. Its optional
`synthetic_option` exists only to test omission/default behavior, not as a proposed API field.

The validator executes an in-memory model and consistency/negative controls. The steps
below distinguish modeled outcomes from future DB/HTTP/lease/provider integration proof.
Run each scenario with fresh synthetic state except where a sequence explicitly shares it.
No wall-clock sleeping, production records, database tables or provider sends are involved.

## S01 — Lost API response after commit

1. A1 operator submits the fixture's W01 booking intent for two physical parcels using
   `key_synthetic_01`. Membership/ownership and all input references are authorized.
2. Model a single commit of one Booking, two Parcels, one safe command audit record,
   one original 201 result, and three facts: booking.created plus two parcel.booked.
   Actual downstream audit granularity may add required per-domain evidence in the same transaction.
3. Discard the HTTP response conceptually. Retry the same operation/key/body. Reordered
   JSON properties, declared default expansion and normalized JSON media type still match.
4. Assert original 201/DTO, with unchanged counts `(business=3, audit=1, result=1, outbox=3)`.
   Never replace it with current resource state or repeat attempt/money/notification effects.
5. Change weight with the same scoped key: 409 IDEMPOTENCY_CONFLICT and unchanged counts.
   Change expected_version/resource/query/array order: fingerprints differ too. An uncertain
   timeout is never a reason to create a new key. Domain current-version checks apply to
   genuinely new commands, after authorized replay resolution.
6. Correlated parent/child notification representations share command/purpose/entity/
   recipient identity; two physical parcels yield two per-parcel logical intents, never
   four from duplicate parent/child fanout. By default only booking.created owns this
   Messaging subscription. The public Booking notification granularity is #39/#40 policy.

Automated: `CommandModel`, canonicalization variants and correlated identity set. Future
#22 tests must prove actual transaction/concurrency and response-loss behavior with PG/HTTP.

## S02 — Crash after database commit

1. Begin with S01's committed facts; a conceptual worker durably leases an outbox item.
2. Commit a deduplicated logical notification intent. Crash around delivery/acknowledgement.
3. The bounded lease eventually becomes recoverable under #35's future mechanics. Recover
   the **same** event_id, aggregate revision and logical effect identity; only processing
   attempt metadata may change. The synthetic consumer's second application is duplicate,
   and its effect set still contains exactly one logical intent.
4. If a provider might have accepted before the crash, record uncertain, reconcile through
   verified provider evidence/capability or authorized manual resolution; never blindly send
   again on a timeout. A recoverable lease does not prove exactly-once external delivery.
5. Provider failure leaves business/audit/result/outbox counts unchanged. Relay acknowledgement
   must durably transfer responsibility, not lose a fact between job insertion and ack.

Automated: logical crash/replay and uncertainty disposition only. Actual lease duration,
restart, ack atomicity, provider attempt ledger and reconciliation mechanics remain
#35/#39/#40 integration tests. No synthetic integer is presented as a lease/retry constant.

## S03 — Identical event replay

Fixture E01: from revision 5, deliver event `evt_synthetic_6`, revision 6, schema 1 twice.
Expect applied then duplicate, one effect, revision 6. Changing content under an already
seen event ID instead produces quarantine_identity. Transport redrive cannot create a new
business fact. A different registered purpose/entity/recipient has its own logical identity.

## S04 — Stale version 7 then 6

E02 (Messaging) and E05 (latest projection): start at 5, reconcile an authorized snapshot
at 7, process v7, then receive v6. Expect skipped_stale; revision stays 7. Messaging has
one current effect, not a second obsolete send. Recheck current Parcel relevance again
at send time because the source may advance after enqueue. H/R history/reconciliation may
retain missing old evidence without changing effective state or sending old progress.

## S05 — Required revision gap

E03/E07: history or reconciliation consumer at 5 gets 7. Record missing-6 evidence and
reconcile_gap; do not advance high-water or record successful completion. E06 then delivers
6 and redrives the original 7: both apply in order and final revision is 7. A quarantined
gap must not be marked deduplication-success before redrive can finish it. If a revision
was intentionally not emitted/subscribed, obtain authoritative coverage instead of inventing
it. M/P consumers may refresh a current snapshot; a gap without one remains blocked.

## S06 — Unknown mandatory schema

E04/E08: v1 consumer receives schema 99 or 2. Expect quarantine_schema, no effect and no
version advance. Envelope missing required fields, invalid revision/type or command-style
fact name is rejected by negative controls. An old/new rollout must deploy supporting
consumers first and retain support for existing backlog; no guessing, silent downgrade or
false successful discard. A safe optional field may be ignored within v1; incompatible
meaning/required fields/closed-enum expansion requires a new schema.

## S07 — Tenant isolation and current replay authority

The original private result belongs to A/A1 and actor_synthetic_operator. The model reads
W01/R06 grants directly from the merged authorization table, not admin-name inheritance.

| Case | Current request | Expected contract/synthetic decision |
| --- | --- | --- |
| A01 | Same A1 operator, membership and action still valid | 201 original replay |
| A02 | Same actor now operating under sibling A2, no A1 booking scope | Uniform 404, no original result |
| A03 | Same actor under unrelated B/B1 | Uniform 404, no result/probe |
| A04 | A1 membership revoked | Uniform object 404; no replay exposure |
| A05 | A1 actor now read_only | 403 action denied despite visible Booking |
| A06 | Org A org_admin reads A1 Booking while selecting A2 | 200 declared R06 organization projection only |
| A07 | Org A org_admin attempts booking mutation | 403; no implicit W01 grant |
| A08 | Org B org_admin requests A1 Booking | Uniform 404 |
| A09 | Another A1 operator knows original key | No original actor's record; model lookup 404, no cross-actor replay fallback |
| A10 | Original actor lacks valid identity | 401 |

A09's synthetic lookup is not a public command-record route. A new valid command in a
different principal namespace would still face its domain uniqueness/version guards; it
cannot fetch the old principal's stored result. A missing collection membership uses 403
as #3 prescribes. Client payload scope fields and frontend filters never grant access.
Callbacks must verify source before deriving registered integration scope; implementation
is #6/#13/#36/#53. Custody grants shipment-only access, not a Booking replay/customer
history; #3's broader validator checks that and the full seven-role matrix.

Cursor model changes organization, franchise, projection, query, filter, sort and limit
one at a time; each incompatible cursor is rejected. Reauthorize first, scope before page
metadata, and restart the authorized query after CURSOR_INVALID. Default/max limits are
50/100; 0, 101, fraction and boolean are invalid. Cryptographic opacity/integrity, timing
leakage and DB filtering remain downstream tests, not claims from comparing fixture tuples.

## S08 — Minimum retention and expiry

Use the fake clock: committed `2026-09-07T03:30:00Z`; retain exactly the minimum 24 hours
in this ordinary synthetic example. At `2026-09-08T03:29:59Z`, same request returns the
original authorized result. At `03:30:00Z` and `03:30:01Z`, the model returns the **client
reconciliation disposition** reconcile_expired, not a promised server HTTP response.
No additional destructive command or fact is created. Query authoritative IDs/dockets,
or use scoped owner reconciliation when IDs were lost; unresolved certainty requires
manual resolution. A separate synthetic 48-hour retention case still replays after 25
hours, demonstrating that 24 hours is a minimum, not maximum or automatic cleanup job.

## S09 — Rollback and send boundary negative controls

Model failure before commit: zero business/audit/result/outbox effects. The synthetic send
boundary rejects an uncommitted source. After commit, provider unknown acceptance yields
uncertain_reconcile and leaves source facts intact. This is a contract model, not fault
injection into PostgreSQL, a broker or a real provider. Future integration evidence must
inspect persisted source/result/outbox state and crashes at each actual boundary.
