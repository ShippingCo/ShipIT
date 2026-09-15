# Route events and route-leg ETA

[ADR 0018](../adr/0018-atomic-route-events.md) · [Issue #28 verification](issue-28-verification.md)

## Contract

Issue #27 owns planning/finalization and immutable manifests. Issue #28 advances the
Route aggregate version while retaining `state: finalized` and the same manifest.
Execution is pending → departed → arrived. Only a departed Route accepts delay.

POST `/api/v1/routes/:route_id/events` requires the existing session, Origin/CSRF boundary,
one Idempotency-Key and explicit organization_id/franchise_id query selection.

Common fields: `kind` (`departure`, `delay`, `arrival`), `expected_version`, `manifest_id`,
`manifest_version`, `effective_at`, `evidence_ref`. UUIDs are validated; versions are
positive integers; time is an explicit RFC3339 instant normalized to UTC, with at most
millisecond precision. Unknown fields, titles, status strings and incident notes are rejected.

- Departure additionally requires `base_eta_at`: an explicit instant at or after the
  effective time, or null. It represents estimated arrival on this route leg, not delivery.
- Delay additionally requires integer `total_delay_minutes` in 0–43,200. This is the
  absolute delay relative to the departure baseline. It cannot decrease in v1. Clients
  must not submit “additional hours.”
- Arrival accepts neither ETA field; it records arrival and ends the active route-leg ETA.

The exact finalized manifest ID/version is mandatory. Effective times strictly increase;
stale expected versions or effective times return VERSION_CONFLICT. Historical snapshots
remain readable and never expand from current Lot membership.

## Parcel effects and permissions

W18 permits franchise_admin, operator and dispatcher in their owning franchise. R09 permits
those roles plus read_only; org_admin reads require an explicit own-org franchise selection.
Accountant and delivery-agent full Route access remain denied. Roles do not inherit grants.

Only active-Booking Parcels in dispatched/in_transit are eligible. A departure containing
dispatched Parcels additionally requires W09 dispatcher authority. The Parcel service applies
T04 in the coordinator's transaction, preserving existing lifecycle guards, audit, version,
event and original command evidence. An operator cannot gain transit authority through W18.
Checked-in/booked active Parcels block departure and must use T03 first. T03 rejects new dispatches after departure/arrival; an original authorized dispatch retry still replays. A departure replay that originally performed T04 rechecks the current dispatcher grant.

Arrival and delay do not change Parcel lifecycle, custody, delivery assignment or proof.
Every distinct manifest Parcel receives one immutable outcome: updated, or skipped with
terminal, booking_inactive or ineligible_state. Delivered/RTO status and active ETA are
untouched. Lot/direct overlap retains its source provenance but produces one effect.

## ETA and reads

`revised_eta = base_eta + total_delay_minutes`. No estimate is derived from current time.
A null baseline stays unavailable even after a delay. ETA provenance lives in immutable
route_parcel_effects with source event, Route revision and effective time, independently
of Parcel status history. Consumers must distinguish route-leg arrival from delivery ETA.

GET `/api/v1/routes/:route_id/events` returns `{route_id,version,latest}`; latest is null
before the first operational event. GET `/api/v1/routes/:route_id/events/:event_id` returns
the original result and all reference-only per-Parcel outcomes, sorted by UUID and bounded
by the 1,000-Parcel manifest cap. This is an immutable event snapshot, not a claim about a
Parcel's current delivery status. Unknown and foreign event/manifest/Route IDs return the
same RESOURCE_NOT_FOUND response. No names, phones, addresses, raw receipts or notes appear.

Results contain event/Route/manifest identities and versions, kind, effective time,
updated/skipped counts, and ETA state/base/revision/delay. Route events use schema v1 and
payload `{manifest_id,affected_set_ref}`. The affected set reference is the event UUID;
each transit effect links its Parcel event UUID and shares request correlation. Messaging
consumers can deduplicate on source event + Parcel + purpose. No notification is sent here.

## Reliability, D11 and rollout

The existing organization coordinator and franchise lock precede Route and sorted Parcel
locks. Work is atomic for at most 1,000 distinct Parcels. A failure at any point rolls back
the Route, all Parcel transitions, effects, audit, events and response receipt. Database
uniqueness enforces one effect per event/Parcel; deferred checks require a complete affected
set and exact result/evidence. History rejects updates, deletion and late inserts.

Retry an uncertain response using the identical request/key. Changed intent gives
IDEMPOTENCY_CONFLICT; lock contention gives IDEMPOTENCY_IN_PROGRESS after rollback.
Current identity/permissions are checked on every retry. Do not retry a conflict with a
fresh key to force a stale command. Unexpected database failures return the existing safe 503.

Apply additive migration `1790096400000-atomic-route-events.cjs`, then the exact runtime
grants in the [DB guide](../../packages/db/README.md), then compatible API code. No released
migration or receipt is rewritten. Old planning endpoints/DTOs remain compatible; screens
remain #34. Rollback disables operational event writes and preserves schema/history for a
forward repair. D11 implementation is bounded atomic work; production load qualification
and throughput targets remain #74. A broker and asynchronous ETA mutator are unnecessary.
