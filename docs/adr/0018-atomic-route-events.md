# ADR 0018: Atomic route events and authoritative ETA revisions

Status: implementation decision for issue #28; review pending.

## Context

Issues #24–#27 supply guarded Parcel transitions and immutable finalized manifests.
D11 requires a bounded transaction. W18 does not override dispatcher-only T04/W09.

## Decision

Use the existing PostgreSQL transaction, organization/franchise coordinator and a locked
Route. Consume its exact finalized manifest ID/version (maximum 1,000 distinct Parcels),
then lock Parcels in UUID order. State, immutable per-Parcel outcomes, ETA revisions,
audit, domain events and the original command response commit together. Any item failure
rolls everything back. No provider I/O occurs within or after this command.

POST `/api/v1/routes/:route_id/events` accepts typed `departure`, `delay`, `arrival`,
expected Route/manifest versions, an explicit effective UTC instant and evidence UUID.
No free-text title or incident note is accepted. Route execution is pending → departed →
arrived; delay is accepted only while departed. Effective instants strictly increase.
Planning state and frozen manifests remain unchanged; the Route aggregate version advances.

Departure applies T04 only to already dispatched Parcels and requires live dispatcher
authority when any such effect exists. Checked-in Parcels must first use T03; this is not
a combined dispatch/transit bypass. Arrival records a physical observation without changing
Parcel lifecycle, delivery proof or custody. Terminal and ineligible Parcels have explicit
skipped outcomes. Existing in-transit Parcels may receive ETA revisions.

Departure supplies an explicit nullable `base_eta_at`. The value describes arrival on this
route leg, never promised recipient delivery. Delay supplies `total_delay_minutes`, an
absolute nonnegative revision relative to that baseline (maximum 43,200 minutes). A lower
delay is rejected in this initial monotonic contract. ETA is baseline plus total delay,
never previous ETA plus a delta. Null baseline remains unavailable. Arrival ends the active
leg ETA. The immutable per-Parcel effect preserves baseline, revised ETA, route revision,
effective instant and source event. It does not forge a Parcel status transition.

Scoped idempotency keys retain the original response; reuse with different normalized
intent conflicts. Expected Route versions additionally prevent a repeated event under a
new key from applying again. References in the Route event identify the immutable affected
set; T04 events share correlation and link through their effect row. Notifications remain
owned by #35/#40. Reads expose only authorized reference/count/ETA data.

## Complexity and evidence

Work and storage are O(n) in the already distinct manifest; sorting locks is O(n log n).
The existing 1,000-Parcel cap bounds atomic work; database lock/statement timeouts retain
their existing fail-closed behavior. Production throughput qualification remains #74.

- [AWS: retry-safe APIs](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  supports explicit request identities, intent comparison and atomic receipt/effect storage.
- [Stripe: idempotency](https://stripe.com/blog/idempotency) supports returning the original
  result after lost responses.
- [PostgreSQL: explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)
  supports transactional row locks and consistent ordering to avoid deadlocks.

No broker, ORM, prediction service, LLM or new dependency is needed. Additive migration
preserves existing receipts and frozen manifests. Roll back compatible code, retain history,
and repair schema forward.
