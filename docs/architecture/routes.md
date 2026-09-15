# Dispatch routes and immutable manifests

[ADR 0017](../adr/0017-dispatch-route-manifests.md) · [Verification](issue-27-verification.md)

Issue #27 activates a Fastify/domain/raw-SQL Route module. One trusted Organization and
Franchise own each opaque server UUID. Browser selection never confers ownership. No
human code, location directory, carrier installation or alternate Lot model is introduced.

## Metadata and lifecycle

Origin/destination are trimmed Unicode labels of 1–120 code points without controls or
unpaired surrogates. Mode is exactly `road | rail | air | sea`. Optional `carrier_code`
is null or `[A-Z0-9][A-Z0-9_-]{0,63}`. It is an inert reference: no installation lookup,
credentials, adapter selection or network request. These fields are operational labels,
not a place to store customer names, contact details or full addresses.

`scheduled_departure_at` is required, a valid explicit RFC3339 instant with UTC offset,
at most millisecond precision. Validation canonicalizes to UTC before fingerprinting;
PostgreSQL stores `timestamptz`. Responses use UTC `Z`. `2099-01-01T09:00:00+05:30`
is `2099-01-01T03:30:00Z`, 09:00 Asia/Kolkata. Missing time is never filled from now.
Created/updated times come from the database clock, distinct from the schedule.

Lifecycle is `planning → finalized` or `planning → archived`. A positive Route version
starts at 1 and advances once per accepted mutation. Finalization seals a nonempty
checked-in manifest for initial forward dispatch; it does **not** assert departure, change
any Parcel status, calculate ETA or send anything. Both terminal Route states reject edits.
Archive is W06 for franchise_admin only: it cancels an unexecuted planning Route, retains
sources/history/current manifest and advances the Route version without a new snapshot.
Finalized Routes cannot be archived. Physical DELETE/reactivation is unavailable.

## Sources and snapshot truth

`route_lots` and `route_parcels` separately record typed source relationships with start
command/time and one-way optional end command/time. Reattachment creates a fresh source
UUID. Duplicate active relationships are conflicts. A Lot must be active and nonempty;
its authoritative current members are resolved through the owning Lot repository. Direct
Parcel input is an identity, never a Booking ID or client-supplied Lot expansion.

Every non-archive command, including create and metadata update, appends `route_manifests`
at the new Route revision. Initial empty manifests are permitted. `route_manifest_parcels`
is a set keyed by tenant, manifest and physical Parcel UUID. `route_manifest_sources`
preserves all contributing source UUIDs plus exact Lot/membership UUIDs where applicable.
Lot+direct overlap has one Parcel entry with two provenance records. The #26 single-active-
Lot invariant precludes a Parcel simultaneously belonging to two live Lots.

A manifest is immutable immediately, including planning versions. Reads never recompute
history from current grouping. Each Route exposes `current_manifest_id`; manifest version
is the Route version that created it, so archive's Route version is one higher than its
last manifest. Current and historical reads use the same persisted projection. Items sort
by Parcel UUID; sources sort direct first, then Lot, then source UUID.

Planning construction accepts only `booked`/`checked_in` Parcels with active Bookings.
Finalization accepts only `checked_in`. Dispatched, in-transit, delivery, terminal or
cancelled-booking members reject the **whole command** with `PARCEL_STATE_CONFLICT`;
no silent filtering or status mutation. Empty attached Lots conflict. If a planning source
becomes ineligible, detach it or archive the Route; historical snapshots remain evidence.
At most 100 live sources and 1000 distinct Parcels are allowed. Bounded reads fetch one
extra to detect overflow and return `ROUTE_LIMIT_EXCEEDED`, rolling back all work.

A partial unique index permits only one finalized **initial-dispatch** manifest for a
Parcel. Multiple planning Routes may reference it, but only one can finalize. This prevents
ambiguous initial dispatch authority. Cancellation/replacement of a finalized allocation,
subsequent route legs and cross-franchise custody require a reviewed downstream contract.

## Lot guard and T03

Any planning Route with an open Route/Lot relationship blocks Lot grouping add/move/remove
and Lot archive for **all roles** with `LOT_ACTIVE_ROUTE`. The owning Lot service checks
this within its transaction; SQL triggers independently enforce it. Rename stays allowed.
Detach, Route archive or finalization releases the guard. A later Lot correction does not
change any old manifest. No Route command writes Lot membership or Parcel lifecycle.

T03 uses the existing Parcel service transaction and W08 authority. After live authorization
and original-receipt lookup, it loads the scoped Parcel and validates `manifest_id` in the
same transaction before exposing version/state conflicts. Unknown and foreign manifests
both return `RESOURCE_NOT_FOUND`; a visible planning manifest or a finalized manifest
without that Parcel returns `PARCEL_STATE_CONFLICT`. Success preserves #24's version,
transition, custody, audit, domain event and original-result replay. #25 bulk delegates to
this exact service and retains bounded per-item partial outcomes.

An AFTER INSERT trigger on new Parcel dispatch commands independently validates finalized
membership and creates immutable `parcel_dispatch_manifests`. The composite binding joins
command, Booking, Parcel and manifest ownership. Runtime cannot insert or alter it.
Pre-#27 opaque command/transition/event evidence is left byte-for-byte intact, without
invented Routes or bindings. Authorized exact legacy retries return their original result
before new validation. New opaque references fail at both API and DB. Binding absence on
existing dispatch commands distinguishes legacy evidence; it is never an API bypass.

## HTTP and DTOs

All endpoints require session and explicit `organization_id`/`franchise_id` query selection.
Mutations require the standard Origin/CSRF boundary and exactly one Idempotency-Key.
Unknown keys, duplicate JSON keys, malformed UUIDs/types/enums/times and bad versions fail
closed. Existing body/header limits, no-store and route-template logging apply.

| Method/path under `/api/v1` | Body / result |
| --- | --- |
| POST `/routes` | metadata; 201 RouteDto |
| GET `/routes` | optional state, limit, cursor; RouteDto page |
| GET `/routes/:route_id` | RouteDto |
| PATCH `/routes/:route_id` | expected_version plus full metadata; RouteDto |
| POST `/routes/:route_id/archive` | expected_version; RouteDto |
| POST `/routes/:route_id/finalize` | expected_version; RouteDto |
| POST `/routes/:route_id/lots` | expected_version, lot_id; RouteDto |
| POST `/routes/:route_id/lots/:lot_id/remove` | expected_version; RouteDto |
| POST `/routes/:route_id/parcels` | expected_version, parcel_id; RouteDto |
| POST `/routes/:route_id/parcels/:parcel_id/remove` | expected_version; RouteDto |
| GET `/routes/:route_id/parcels` | current manifest and item page |
| GET `/routes/:route_id/manifests/:manifest_id` | historical manifest and item page |

RouteDto exposes only id, origin, destination, mode, carrier_code,
scheduled_departure_at, state, version, current_manifest_id, created_at, updated_at.
ManifestDto exposes id, route_id, version, finalized, parcel_count, created_at. Each item
has parcel_id and sources: `{kind:direct, source_id}` or
`{kind:lot, source_id, lot_id, lot_membership_id}`. No customer/Booking snapshots, phone,
address, raw receipt or auth fields. Mutations return the original RouteDto on replay.

Pages contain `items` and `page:{has_more,next_cursor}`; manifest pages also contain
`manifest`. Limits are 1–100 (default 50); cursors are encrypted/authenticated, 15-minute,
purpose/actor/current-membership/scope/filter/limit bound. Route order is creation time
and UUID descending. Manifest cursors bind the exact snapshot, so changing current
membership rejects an old current cursor; the original historical URL still accepts it.

## Authorization, transactions and evidence

R09 activates org_admin O by selecting one own-org franchise, plus franchise_admin,
operator, dispatcher and read_only F. Delivery-agent assignment snippets are downstream;
full manifests and accountant operations are denied. W05 create/update/source/finalize
permits only franchise_admin/operator/dispatcher F. W06 archive permits franchise_admin F.
Roles do not inherit privileges. Every call/retry checks live session/membership; revoked
scope fails closed. Disabled roots block new commands/replay; approved historical reads
remain available. Source visibility is checked before Route version/locked-state conflicts.

The membership coordinator issues single-franchise `TenantAccess`; repositories use closed
actions and parameterized `scopedQuery`. Source reads use owning Lot/Parcel seams in the
same transaction. Explicit composite RESTRICT FKs enforce tenant relationships independently
of code. The AST gate includes all nine tables and a narrow HTTP request-query data rule;
raw pool SQL, organization-only ownership and unauthorized capability issuance still fail.

Lock order uses the existing organization coordinator, franchise, Route, then sources and
Parcels. Shared serialization also orders Lot and Parcel commands. Every mutation supplies
expected_version (1–2147483646); conflicting edits have one winner. Lock timeout becomes
`IDEMPOTENCY_IN_PROGRESS` after rollback, not a retry inside an aborted transaction.

Receipts bind principal, org, franchise, operation and SHA-256 key digest. Canonical version-1
fingerprints cover Route/source IDs, expected version and normalized input. Exact retry
returns the originally stored DTO without another version/source/snapshot/event/audit.
Changed intent is `IDEMPOTENCY_CONFLICT`. At least 24-hour retention is recorded; no cleanup
is implemented. Referenced command/history records remain permanent. Lost COMMIT responses
can safely retry through a fresh service/pool. No raw idempotency key is stored.

Each accepted command emits exactly one Route event and one immutable audit record in the
same transaction. Types are route.created, route.updated, route.archived,
route.manifest_finalized, route.lot_attached/detached, route.parcel_attached/detached.
Schema version 1 envelope carries trusted owners, aggregate UUID/revision, actor, UTC time,
correlation and command/causation IDs. Payload is exactly `{manifest_id}`; no labels, carrier
code, customer data or request body. `audit_history` adds a Route source through the existing
R28 projection; append_route_audit is a fixed-search-path SECURITY DEFINER function.
Deferred commit checks require matching receipt/result/state/revision, exact source delta,
complete set/provenance, eligibility and event/audit consistency. Snapshot/history mutation
and late inserts after command completion are forbidden.

Safe additional conflicts are ROUTE_STATE_CONFLICT, ROUTE_MANIFEST_CONFLICT,
ROUTE_LIMIT_EXCEEDED and LOT_ACTIVE_ROUTE; existing VERSION_CONFLICT, IDEMPOTENCY_CONFLICT,
IDEMPOTENCY_IN_PROGRESS, PARCEL_STATE_CONFLICT, LOT_STATE_CONFLICT and root/auth failures
retain fixed envelopes. Unexpected DB failures are sanitized TEMPORARILY_UNAVAILABLE;
SQL, constraint names and stack never enter public responses/logs.

## Rollout and downstream ownership

Apply additive `1790010000000-dispatch-route-manifests.cjs` after all 15 released migrations,
install the [exact runtime grants](../../packages/db/README.md#issue-27-dispatch-routes),
then deploy the API and exercise synthetic create/attach/check-in/finalize/dispatch/replay.
No migration edits, destructive backfill, browser import or live data fixtures. A failed
transaction rolls back; migration failure/retry and tracking no-op are tested.

Rollback stops new Route/dispatch writes and rolls back compatible application code only;
retain additive schema and all committed history, repair forward. Old opaque-dispatch
writers intentionally fail after migration. Do not disable constraints, rewrite evidence,
or drop schema to make an old binary accept dispatches.

#28 owns departure/arrival/delay events and coordinated Parcel/ETA effects. It must consume
the frozen manifest UUID/version without expanding current Lots. There is no route-event
HTTP endpoint here. #34 owns production screen cutover; prototype RoutesPage/store/tests
remain fictional migration evidence. Workers, carrier integrations, messaging, OTP/proof,
payments, reporting and provider credentials remain with their owning downstream issues.

## Issue #28 operational extension

[Route events](route-events.md) implements the departure/delay/arrival boundary deferred above. It advances the Route version without changing its frozen manifest or planning DTO.
