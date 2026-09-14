# ADR 0015: bounded Parcel command orchestration

Status: proposed for independent review in Issue #25's PR. This implementation refines
ADRs 0007/0014; it does not broaden their action authority. Prerequisites #23/#24 merged.

## Decision

`POST /api/v1/parcels/bulk` orchestrates only W07 check-in and W08 dispatch through
`createParcelService.execute`. A request contains 1–50 entries **before deduplication**;
all inputs validate before any receipt or item work. Fifty matches the existing Booking
child bound and is below the general 100-row query ceiling. Execution is sequential.
It adds no lifecycle rules, generic bulk permission, provider calls or whole-batch transaction.

Exact duplicates (Parcel, item key and normalized command) collapse. Conflicting duplicates
or an item key shared by different Parcels reject the entire envelope. The unique set sorts
by exact UUID, making response correlation and outer identity independent of input order.
The outer operation is `api.v1.parcels.bulk`; action is intent, so changing check-in to
dispatch under the same outer identity conflicts if the caller has the necessary authority.

## Two-level recovery

A new immutable `parcel_bulk_requests` row binds authenticated actor, selected authorized
Organization/Franchise, outer key digest, canonical fingerprint/version, action, count,
correlation and creation/retention boundary. It stores no raw keys, commands, customer data
or copied business result. Its recovery state is intentionally implicit: a bound intent
may always be resumed with its exact body. This is an intent guard, not a worker lease.

Reservation commits in a short transaction **before** the first item. Each item then
independently reauthenticates and executes in the existing single-Parcel transaction.
Successful item results are recovered from that service's durable receipt. Concurrent
same-outer requests may both orchestrate, but the owning service serializes matching item
identities and competing versions. There is no second winner or duplicated business fact.
No connection/transaction is held while awaiting another command transaction.

Known item denials/conflicts are observations from rolled-back single-item commands, not
committed business outcomes. They are re-evaluated on explicit same-intent recovery;
successes return their original DTOs. Consequently a mixed batch's failure observations
can change after an authorization or dependency correction. The outer receipt does not
freeze denial evidence or retain old permissions. All-success replay returns identical
business results. This specializes the general failed-transaction retry rule; it does
not promise a byte-identical cached mixed response. A new failed-only subset uses a new
outer key; unchanged item intent retains its item key. Refreshed/changed commands use new
item keys. Earlier successes are excluded from that subset.

An uncertain item COMMIT, unexpected exception, session failure or unresolved item receipt
aborts response construction with a canonical request-level error. Earlier commits remain.
No 200 response calls an uncertain item failed. Retrying the original intent recovers those
commits and resumes unexecuted items. No background importer, auto-retry or cancellation
rollback promise is introduced.

Outer intent guards have infinite retention and no delete/update runtime grant. This
conservatively prevents key rebinding during arbitrarily late partial recovery. Existing
item receipts retain their minimum 24-hour boundary and currently are never pruned.
A future #72 retention implementation must jointly reconcile incomplete bulk intents and
item receipts; deleting item evidence independently cannot preserve this recovery guarantee.
If evidence is lost, stop retrying and reconcile with authorized Parcel retrieval/support.

## Consequences and limits

Normal valid batches return 200 with one safe outcome per unique ID. Foreign and unknown
items carry only `RESOURCE_NOT_FOUND`. The route has a 12 requests/minute/IP bound in the
existing process-local limiter, capping a single process/IP at 600 submitted entries/minute;
ordinary per-request body limits and live action checks remain. This is not a distributed
capacity or tenant spend limiter. #74 still owns production capacity qualification.

The UI building block is independent of the fictional store. #34 supplies authoritative
reads, evidence selection, refresh integration and full operational screen cutover. #25
supplies a reusable controller/panel, safe DTO projection and partial/uncertain retry state.
The full exact wire/rollout contract is in [bulk Parcels](../architecture/parcel-bulk.md).
