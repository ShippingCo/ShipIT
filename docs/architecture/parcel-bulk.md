# Bounded bulk Parcel commands — Issue #25

[ADR 0015](../adr/0015-bounded-parcel-bulk.md) · [Lifecycle](parcel-lifecycle.md) ·
[Verification](issue-25-verification.md) · [Browser seam](production-data-access.md)

## Wire contract

`POST /api/v1/parcels/bulk?organization_id=<uuid>&franchise_id=<uuid>` requires the
existing current session cookie, allowed Origin, CSRF token, supported strict JSON and one
`Idempotency-Key` header. Both query selectors are required and only narrow current membership.
No body field can choose ownership, actor or role. Unknown fields at every depth and duplicate
JSON keys are rejected using the existing 400/422 rules. There is no generic status input.

```json
{
  "action": "check_in",
  "items": [{
    "parcel_id": "00000000-0000-4000-8000-000000000001",
    "idempotency_key": "synthetic-item-command-1",
    "command": {
      "expected_version": 1,
      "evidence_ref": "00000000-0000-4000-8000-000000000002",
      "location_ref": "00000000-0000-4000-8000-000000000003"
    }
  }]
}
```

Allowed actions are exactly `check_in` and `dispatch`. Check-in accepts the unchanged #24
command (`expected_version`, `evidence_ref`, `location_ref`); dispatch replaces location_ref
with `manifest_id`. References are #24's opaque evidence UUIDs, not newly implemented Lot,
Route, attachment or location-directory foreign keys. Bulk neither interprets a reference
as custody nor grants access to a referenced resource. Future owning services must ratify
and validate any live entity relationship before exposing it. Expected version is an integer
1..2147483646. UUID and key syntax is the existing validator; keys use 1–255 ASCII letters,
digits, `_` or `-`, case-sensitive, with no trimming. Query duplicates/arrays are invalid.

`MAX_BULK_PARCELS = 50` in shared is the explicit submitted-entry bound, checked before
iteration/deduplication. Empty or 51 entries gives HTTP 422:

```json
{"error":{"code":"VALIDATION_FAILED","message":"One or more request fields are invalid.","correlation_id":"00000000-0000-4000-8000-000000000004","details":[{"field":"items","code":"OUT_OF_RANGE"}]}}
```

Ambiguous duplicate Parcel intent or a key shared across distinct Parcel IDs returns the
same envelope with `items / INVALID_FORMAT`. The full envelope is rejected before any
receipt/state/event/audit mutation. Identical duplicates collapse once. The unique set sorts
by exact lowercase UUID. Object property order does not matter; sorted unique item order
and duplicate multiplicity do not change identity (provided submitted count stays in range).

## Response and authorization

A valid mixed batch returns HTTP 200, `BulkParcelResult` from shared:

- `action`: submitted allowlisted action.
- `items`: one result per unique Parcel, sorted by UUID.
- Success: `parcel_id`, `outcome: succeeded`, `result`: the **unchanged** canonical #24
  `ParcelTransitionDto` (ID, Booking ID, docket, committed version/status/custody, attempt
  counts, event reference, transition time). It is the original committed result, not a
  claim that a later command has not advanced the Parcel.
- Failure: `parcel_id`, `outcome: failed`, `error: {code}` only. Closed codes are
  RESOURCE_NOT_FOUND, ACTION_FORBIDDEN, VERSION_CONFLICT, PARCEL_STATE_CONFLICT,
  IDEMPOTENCY_CONFLICT, FRANCHISE_DISABLED, ORGANIZATION_DISABLED.
- `summary`: `{succeeded,failed}`, counting the submitted unique IDs only.

Unknown/foreign results differ only in the caller's already-submitted parcel_id. No foreign
current status/version, ownership, reason, customer data or SQL appears. W07 permits operator
only; W08 permits operator/dispatcher/franchise_admin only. No org_admin inheritance,
read_only/accountant mutation or membership-as-custody inference. Each item goes through
current single-item membership/scope/resource checks before conflict information.
Request-level action/scope denials can occur before receipt reservation; 401 aborts the batch.

Every item retains #24 atomic state + receipt + transition + domain event/audit semantics.
Failures do not undo another item's commit. Execution concurrency within a request is **one**.
The outer receipt transaction ends before item execution, avoiding nested held connections.
The existing Organization lock remains conservative serialization, not a new bulk lock.
No delivery/OTP/proof/payment/RTO/transit/lot action is enabled by this route.

## Identity, retry and failure recovery

Outer identity is `(user, actor_id, organization_id, acting_franchise_id,
api.v1.parcels.bulk, SHA256(outer_key))`. Its SHA256 fingerprint uses the existing canonical
object sorter and binds schema version 1, operation, JSON media type, normalized selected
scope and every unique Parcel/item key/expected version/evidence/action field.
Different intent under the same authorized outer identity gives 409 IDEMPOTENCY_CONFLICT.
No stored fingerprint or intent is exposed.

The immutable outer receipt is a resumable intent guard. It intentionally stores no duplicate
result ledger. Each success lives in the authoritative #24 item receipt, under its existing
`api.v1.parcels.check_in` or `api.v1.parcels.dispatch` namespace. The exact item key is passed
through, so reuse across individual and bulk routes has identical conflict/replay semantics.
A successful item replays before stale-state checks and generates no second audit/event.
Known failed item transactions are re-evaluated on explicit same-batch retry. Their previous
failure observation is not a frozen business result; a revoked membership never gains
receipt visibility from an old batch. All-success replay is stable across new pools/services.

Network loss, dispatched abort, timeout, HTTP 500/503 or malformed success are uncertain.
An unresolved item returns request-level 409 IDEMPOTENCY_IN_PROGRESS. Retain and explicitly
retry the **same outer key/body/item keys/versions/scope**. The orchestrator stops after an
uncertain item rather than claiming a safe per-item failure. Earlier committed work remains
recoverable, and the next attempt may execute previously unexecuted items. No retry loop.
HTTP cancellation does not imply a server transaction rollback.

After a confirmed response, remove successes from selected retry items. Retry failed creates
a new outer identity for that subset. Unchanged item intent keeps its old key. A deliberate
refreshed version/evidence uses a fresh item identity; never increment a version speculatively.
If storage evidence is lost or later pruned, authoritative scoped retrieval/support must
establish certainty before new commands. The current implementation prunes neither level.

## Browser integration and accessibility

`data-access/parcel-bulk.ts` uses #18's API client/immutable intent, credentials, CSRF, safe
errors and AbortSignal. It verifies returned IDs, completeness, unique correlation, counts,
expected next version and exact action status/custody, then projects safe fields before
publishing. Malformed/partial success is uncertain, never an optimistic state update.
The adapter actively refuses demo mode; production failure never imports the fictional store.

`parcel-bulk-controller.ts` is bound to the operator ScopeController. Scope changes abort
and clear selection/results; late responses/errors cannot paint another scope, even if fetch
ignores cancellation. Intents remain in memory only. No private browser storage/reload retry
is added. On reload #34 reauthorizes and retrieves current durable Parcel state; an uncertain
intent lost with the tab requires reconciliation, not a newly generated retry key.

`BulkParcelPanel` provides native labelled checkboxes, existing M3 buttons, textual per-item
outcomes and a polite atomic live summary. Controls stay mounted during completion, pending
selection/actions are disabled, retry is keyboard reachable, and layout wraps at narrow
widths without custom motion. The caller supplies up to 50 candidates and action-compatible
command evidence. It provides `refreshFailed(failedItems, signal)` using authoritative reads
before “Retry failed”; returned IDs must be a unique subset of those failures. Unavailable
items may be omitted and stay represented. The controller regenerates item keys only for
changed command payloads; prior successes remain in the cumulative result summary.

Issue #25 provides the authoritative bounded bulk Parcel API, browser adapter/controller and
accessible partial-result/retry building block. **Issue #34 still owns the complete production
PackagesPage, LotsPage, RoutesPage, Dashboard and EwayPage cutover**, authoritative refresh,
evidence selection and read/mutation integration. The current PackagesPage is fictional;
its touched bulk toast now reports state only, with no “Customers notified” claim.

## Deployment, observability and rollback

1. Apply `1789837200000-bounded-parcel-bulk.cjs` with the migration identity.
2. Apply SELECT/INSERT only on `shipit.parcel_bulk_requests` to the separate runtime role;
   retain existing #24 privileges. There is no backfill or change to released migrations.
3. Deploy compatible API; mount the browser component only through #34's production seam.
4. Verify synthetic success, exact replay, stale and sibling/unrelated tenant denial.
5. Monitor controlled result/error rates and duration. The route's existing process-local
   IP limiter allows 12 batches/minute, at most 600 submitted entries/minute/process/IP.
   It rejects 429 RATE_LIMITED with Retry-After. The global body limit remains 262144 bytes.

Logs contain operation, request correlation, unique count, success count, safe code counts
and duration. They contain no body, result DTO, raw key, cookies, credentials or customer PII.
Each actual transition has the original #24 audit/event; no duplicate bulk transition audit.
A committed event does not claim WhatsApp acceptance/delivery.

Rollback disables/reverts compatible API/browser code, preserving additive schema, outer
intent guards and every committed Parcel transition/audit/event/receipt. Repair schema only
with a future forward migration. Never delete histories to undo the release or enable a
browser-store fallback. Outer guards retain indefinitely; a future coordinated #72 retention
policy must preserve recovery while item effects can still be uncertain.
