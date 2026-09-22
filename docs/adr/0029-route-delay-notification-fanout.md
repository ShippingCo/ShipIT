# ADR 0029: Resumable Route-delay notification fanout

- Status: proposed for Issue #41 review
- Date: 2026-09-22
- Owners: Route events (#28), notification automation (#40/#41), outbound WhatsApp (#39)

## Context

A `route.delayed` event can bind as many as 1,000 distinct Parcels. The #40 consumer
transaction is suitable for bounded policies, but processing the whole affected set there
would make one large transaction the recovery boundary. The authoritative affected set and
ETA already belong to #28; consent and provider reliability already belong to #38/#39.

The v1 Route envelope is unchanged and is exactly
`{manifest_id, affected_set_ref}`. `affected_set_ref` is the event UUID and joins only to
the immutable `route_parcel_effects` rows for that event.

## Decision

### Durable identities

The stable `customer-notifications` consumer validates and activates policy
`route-delayed:1`, then creates or recovers one root identified by tenant + source identity
+ purpose. For an original alert, the source identity is the `route.delayed` event and the
purpose is `route_delay`. It performs no provider call and enumerates no item set in that
source-effect transaction.

Each result is unique on tenant + source identity + Parcel + purpose. The root binds the
original event, Route, immutable manifest and version, policy/version, correlation, frozen
item count and progress. It stores no phone, address, event body, rendered message or
credential.

### Batch, cursor and recovery

One worker pass processes at most 20 items. Each item and its root progress commit in a
separate transaction. The root is selected through a fixed security-definer scheduler and
locked with `FOR UPDATE`/`SKIP LOCKED`; its cursor is the greatest processed frozen Parcel
UUID. Item uniqueness and trigger-checked counts protect replay and concurrent workers.
A crash after N commits leaves those N terminal item results durable; a new process resumes
strictly after the cursor. Outcomes are `queued`, `skipped`, `suppressed` or `blocked`.
Blocked items are terminal policy decisions; #39 continues to own retry and provider state
for a queued intent.

### Eligibility and ETA

Frozen membership answers only which Parcels the delay affected. At item time the worker
rechecks the current Booking, Parcel, Customer contact, Route execution state and #38
consent. Original terminal/ineligible effects, delivered/RTO Parcels, inactive Bookings,
changed/unavailable recipients and revoked consent do not create an active alert.

The original alert is suppressed as `state_superseded` if a later Route delay exists or the
Route is no longer departed. Otherwise its variables come from the latest authoritative
`route_parcel_effects` delay row. A null `revised_eta_at` becomes the literal closed value
`unavailable`; messaging never calculates an ETA. The v1 allowlist is `docket`,
`effective_at`, `revised_eta_at`. `revised_eta_at` is mandatory for `route-delayed:1`. A
Route-delay template that cannot represent the trusted ETA or the explicit `unavailable`
value must not be activated. Template name, language and variable order remain server-only
configuration bound into the immutable policy activation hash.

Events before the policy activation create bounded `historical_cutover` results, never
customer sends.

### Intentional reminder

W19 is implemented as `POST /api/v1/routes/:route_id/delay-reminders`. Only active
franchise_admin, operator and dispatcher memberships in the owning Franchise are allowed.
The request contains only `original_delay_event_id`, requires normal session, Origin/CSRF
and `Idempotency-Key`, and reauthorizes before replay. Same key/same canonical intent
returns the committed result; changed intent conflicts.

A reminder is an immutable automation event named `route.delay_reminder.requested`, not a
Route aggregate `domain_events` revision. This deliberately preserves #28 Route sequencing
and links the reminder to the legitimate, latest `route.delayed` fact. Its new event UUID is
the fanout/outbound source identity and purpose is `route_delay_reminder`, so it cannot
impersonate or modify the original alert.

The cooldown is 60 minutes per tenant/original delay. A database advisory lock and trigger
enforce it across keys, processes, restarts and concurrent requests. The controlled API
result is `RATE_LIMITED`. Reminder creation does not update Route version, base ETA, absolute
delay or revised ETA.

### Consent, provider and observability

Eligible items reuse #39 `enqueueMessage`. STOP before enqueue produces a suppressed item;
STOP after enqueue is caught by #39 immediately before provider dispatch. No fanout
transaction performs network I/O or manufactures a replacement after uncertain acceptance.

R16-authorized reads expose root state, processed/total, queued, skipped/suppressed and
blocked counts, safe reasons, timestamps and safe item references. They never claim queued
means accepted, delivered or read and never expose PII, ciphertext or provider payloads.

## Persistence and rollout

Forward migration `1791046800000-route-delay-fanout.cjs` creates immutable reminder
command/event evidence, fanout roots/items, composite tenant FKs, unique identities,
progress/source triggers and the fixed scheduler. It narrowly extends #39's outbound source
guard to accept the new immutable reminder event. Released migrations are unchanged.

Apply the schema and least-privilege grants before deploying the consumer/worker. Activate
the exact `route-delayed:1` binding before starting it. Rollback disables the new reminder,
fanout and source-consumer paths while retaining committed data; repair is a new forward
migration. Never delete roots/items or rebind policy version 1.

## Consequences and limits

The root is durable and bounded at the cost of one transaction per item. Batch size and
cooldown changes are policy changes requiring review and test updates, not environment
knobs. Production throughput/SLA qualification remains #74. Messaging/history UI remains
#44; delivery completion policies remain #43; live provider/template approval remains an
external deployment validation.
