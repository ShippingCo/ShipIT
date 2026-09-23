# Production architecture

Issue [#2](https://github.com/ShippingCo/ShipIT/issues/2), 6 September 2026.
Baseline: `91dde097307a1558ca0c27474b546189985def82` from freshly pulled `main`.

Issue #2 was closed by merged [PR #85](https://github.com/ShippingCo/ShipIT/pull/85),
commit `256512a725c56c5c0e0fa180253add5ac20a69d0`. ADRs 0001–0005 are the merged
architecture constraints. [ADR 0006](../adr/0006-domain-ownership-and-authorization.md)
records the merged #3 business-policy refinements from [PR #86](https://github.com/ShippingCo/ShipIT/pull/86).
[ADR 0007](../adr/0007-api-event-idempotency-contracts.md) records merged #4 wire/event/replay refinements.
[ADR 0008](../adr/0008-environment-secrets-and-security-baseline.md) records merged #6 environment, secret and threat controls.
All production components described here are **planned**, unless explicitly identified
as existing. No API, schema, authentication, outbox, worker, or provider integration
is implemented by this issue.

## Read in this order

1. [System context, module/data ownership and trust boundaries](system-context.md).
2. [Runtime sequences and authoritative-service walkthroughs](runtime-sequences.md).
3. [ADR index](../adr/README.md), including [API and event conventions](../adr/0004-durable-events-and-transactional-outbox.md).
4. [Pilot gates and commercial boundaries](pilot-boundaries.md).
5. [Open decisions with owners and resolution gates](open-decisions.md).
6. [Issue #2 review and validation evidence](verification.md).
7. [Canonical domain and ownership contracts — Issue #3](domain-contract.md).
8. [Complete role/action/resource matrix](authorization-contract.md).
9. [Parcel lifecycle, failure/collection and correction rules](parcel-lifecycle.md).
10. [Prototype field mapping](prototype-domain-mapping.md), [synthetic scenarios](domain-scenarios.md) and [Issue #3 verification](domain-verification.md).
11. [API v1/error/pagination](api-contract.md), [internal event catalog/ordering](event-contract.md) and [idempotency/timeout/expiry](idempotency-contract.md).
12. [Issue #4 tabletop scenarios](api-event-scenarios.md) and [acceptance/validation evidence](api-event-verification.md).
13. [Configuration/environment contract](configuration-contract.md), [security threat model](security-threat-model.md) and [Issue #6 verification](security-verification.md).
14. [Issue #7 frontend migration contract](frontend-migration-contract.md), [complete behavior and regression inventory](prototype-migration-inventory.md), and [verification](prototype-migration-verification.md).

15. [Issue #8 money/tax/proof/privacy contract](money-tax-proof-privacy-contract.md), [authoritative sources](policy-sources.md), [ADR 0009](../adr/0009-money-tax-proof-and-privacy-policy.md), and [verification](issue-8-verification.md).

16. [Testing layers, fixtures, failure injection and M1 activation — Issue #9](testing-contract.md), with [acceptance evidence](issue-9-verification.md).
17. [Implemented PostgreSQL infrastructure — Issue #10](../../packages/db/README.md), [dependency review](issue-10-dependency-review.md), and [acceptance evidence](issue-10-verification.md).
18. [Membership authorization API — Issue #14](membership-authorization.md), [industry research](membership-authorization-research.md), [ADR 0012](../adr/0012-membership-invitations-and-rbac.md), and [verification](issue-14-verification.md).

## Existing evidence and precedence

The workspace contains React/Vite screens, the browser [store](../../apps/web/src/data/store.ts),
[prototype types](../../apps/web/src/data/types.ts), [message templates](../../apps/web/src/data/messages.ts),
[deterministic bot](../../apps/web/src/data/bot.ts), and [frontend tests](../../apps/web/src/test/app.test.tsx).
The API and shared entry points remain scaffolds. Issue #10 adds DB runtime dependencies
and reusable pool, query, transaction, migration and readiness functions; its sole production
migration creates an empty infrastructure schema, without domain tables.
Existing API module folders contain `.gitkeep` files; proposed
paths below are conventions for later implementation, not links to nonexistent code.

[API](../../apps/api/README.md) and [DB](../../packages/db/README.md) already select
Fastify, PostgreSQL, pg and node-pg-migrate. No stack replacement, runtime dependency,
or hosting vendor is selected here. The local planning pack's additional library/vendor
recommendations have not been treated as accepted repository decisions.

Inspected: package manifests, workspace and TypeScript configurations, all tracked
file paths, business store exports and screen callers, receipt/upload helpers,
message/bot code, tests, docs, workflow/templates, issue #2 and its direct dependents
#3/#4/#6/#7/#10/#53/#56/#57, relevant domain issues, and all nine milestone descriptions.
See [verification](verification.md) for the scope and limits of this inspection.

[CONTRIBUTING](../../CONTRIBUTING.md), [current workflow](../ENGINEERING_WORKFLOW.md),
and issue contracts supersede historical prototype instructions. In particular,
old comments proposing that whole browser records or OTP rules move to shared are
migration evidence, not permission to expose secrets. Follow the
[prototype transition map](../PROTOTYPE_TO_PRODUCTION.md); #7 owns its exhaustive
export/caller inventory and regression disposition.

## Architecture in one paragraph

Issue #13 adds the [operator authentication API](operator-authentication.md) and [ADR 0011](../adr/0011-operator-otp-authentication.md). Issue #14 adds the separate [membership and invitation API](membership-authorization.md) and [ADR 0012](../adr/0012-membership-invitations-and-rbac.md). Live delivery setup remains deferred to M3.

Keep React/Vite as presentation and a Fastify modular monolith as the HTTP/application
boundary. Domain services own commands; scoped SQL queries return public projections.
PostgreSQL persists business state, command deduplication, audit and outbox facts in
transactions. A separate worker process using the same server modules consumes durable
work and invokes application-owned provider ports after commit. Messaging outcomes never
rewrite booking, delivery, or payment truth. No microservice or broker infrastructure is
required by these boundaries. Exact implementation policies are gated in the decision
register rather than silently inherited from the prototype.

- [Tenant query isolation](tenant-query-isolation.md) — mandatory scoped repositories, trusted jobs and AST CI enforcement.
- [Issue #15 verification](issue-15-verification.md) — tenant boundary acceptance evidence.

- [Append-only audit and safe telemetry](audit-contract.md) — canonical compatibility projection, transactional writes, R28 retrieval and counters.
- [Issue #16 verification](issue-16-verification.md) — migration, security and delivery evidence.

Issue #17: [independent onboarding and operator context](independent-onboarding.md) · [verification](issue-17-verification.md).

## Production frontend data access — Issue #18

[Production data access](production-data-access.md) owns validated build composition, the single API client, operator data source, ephemeral cache/command lifetime and fictional demo isolation. [Verification](issue-18-verification.md) maps all twelve acceptance criteria.

## Customer backend — Issue #19

[Tenant-private customers](customers.md) defines R05/W03 contact persistence, bounded lookup,
optimistic edits, scoped replay, immutable audit and the future Booking snapshot boundary.
[Verification](issue-19-verification.md) records real PostgreSQL/HTTP/security evidence.
Production customer UI is consumed by the #33 counter; Booking persistence belongs to #22.

## Pricing backend — Issue #20

[Versioned pricing](pricing.md) owns immutable local rates, exact matching/paise quotes,
finite proposal evidence, override approval, replay and the future Booking validation seam.
[Verification](issue-20-verification.md) maps every acceptance criterion and PostgreSQL gate.
#21 owns tax, #22 persists Booking snapshots and #33 connects the production booking UI.

## Booking backend — Issue #22

[Atomic Booking creation](bookings.md) documents operator-only confirmation, frozen parties,
pricing/tax, uncollected obligation, global permanent dockets, original-result replay and
transactional audit/events. [Verification](issue-22-verification.md) maps acceptance to
unit, real PostgreSQL and HTTP tests. Retrieval, lifecycle, lots, collections, receipts,
production booking UI and relay remain #23/#24/#26/#29/#30/#33/#35 respectively.

## Parcel retrieval backend — Issue #23

[Tenant-isolated Parcel retrieval](bookings.md#tenant-isolated-retrieval--issue-23) adds
docket/UUID detail, bounded filtered keyset listing and deterministic safe timelines over
the durable #22 facts. [Verification](issue-23-verification.md) records authorization,
cursor, restart, migration and real PostgreSQL evidence. Lifecycle commands remain #24;
assignment-aware delivery-agent visibility remains fail-closed until its owning schema exists.

## Parcel lifecycle commands — Issue #24

[Guarded Parcel lifecycle](parcel-lifecycle.md#issue-24-implementation-boundary) implements
typed check-in, dispatch, transit, failed-attempt and RTO commands with optimistic versions,
durable scoped replay, atomic events/audit, closed reasons and fail-closed custody authority.
[ADR 0014](../adr/0014-guarded-parcel-lifecycle-commands.md) records the decision and
[verification](issue-24-verification.md) maps concurrency, tenant, rollback and PostgreSQL evidence.

## Parcel bulk orchestration — Issue #25

[Bulk contract](parcel-bulk.md) · [ADR 0015](../adr/0015-bounded-parcel-bulk.md) ·
[Verification](issue-25-verification.md). Independent single-item transactions, durable
outer intent and reusable partial-result/retry UI; full operational cutover remains #34.

## Implemented persistent lots — Issue #26

[Lot domain/API/state contract](lots.md), [ADR 0016](../adr/0016-persistent-lots.md), and
[acceptance and rollout evidence](issue-26-verification.md) extend the completed production
chain through #25. PostgreSQL is the grouping authority; current/historical membership,
commands, audit and existing domain events commit together. #27 owns route integration
and #34 owns the operational screen cutover. Earlier scaffold descriptions above are
historical issue baselines, not the current implementation state.

## Issue #27 Route authority

[Dispatch routes and immutable manifests](routes.md), [ADR 0017](../adr/0017-dispatch-route-manifests.md), and [verification](issue-27-verification.md) activate persistent initial-dispatch planning, typed sources, frozen deduplicated manifests, Lot guards and authoritative T03 references. #28 adds events and #34 exposes both through the production operator screens.

## Issue #28 operational Route events

[Route events and ETA](route-events.md), [ADR 0018](../adr/0018-atomic-route-events.md), and [verification](issue-28-verification.md) define typed, atomic departure/delay/arrival and immutable per-Parcel outcomes.

## Payments — Issue #29

[Payments](payments.md), [ADR 0019](../adr/0019-payment-ledger.md) and [verification](issue-29-verification.md) implement Booking-level partial collection, append-only correction, scoped replay and genuine settlement without changing delivery.

## Issue #30 — immutable issued receipts

[Receipt ownership, snapshot, R13 and retrieval contract](receipts.md),
[ADR 0020](../adr/0020-immutable-issued-receipts.md), and
[acceptance evidence](issue-30-verification.md). Implements immutable Booking-charge,
collection and linked reversal documents from #21/#22/#23/#29 authority. First authorized
GET materializes canonical evidence; later retrieval/printing preserves identity and
amounts. #33 now exposes production booking and receipt discovery/printing screens.

- [Private attachments](attachments.md), [ADR 0021](../adr/0021-private-attachment-storage.md), [dependency review](issue-31-dependency-review.md), and [Issue #31 verification](issue-31-verification.md).

## Issue #32 — external e-way records and reminders

[E-way authority](eway.md) defines the Booking-scoped external observation aggregate,
declared-goods-value input, immutable correction history, estimate separation, R15/W23
membership boundary, prospective check policy and exact v1 endpoints. [ADR 0022](../adr/0022-external-eway-records.md)
records the application decision. [Issue #32 verification](issue-32-verification.md)
contains the migration, PostgreSQL, HTTP, tenant-isolation and privacy evidence. The
production E-way Bills screen is implemented by #34; compliance/report reconciliation remains #67.

## Issue #33 production counter composition

[Counter verification](issue-33-verification.md) records the implementation, recovery model,
API/DTO boundary, reproducible synthetic browser and PostgreSQL scenarios, accessibility,
privacy evidence and rollout. New Booking and Receipts use #18's scope generation and
immutable command seam without demo imports. Pricing/tax/booking/payment/receipts retain
server authority; attachments attach only to a confirmed Booking. No schema migration,
business rule, role grant or dependency was added.

## Issue #34 production operational composition

[Issue #34 verification](issue-34-verification.md) records the production Dashboard,
Packages, Lots, Routes, To-Pay and E-way cutover. Purpose-specific adapters validate closed
DTOs and bind reads and immutable commands to the current scope generation. The production
shell does not import the fictional Store; it deliberately omits staff delivery completion,
OTP reveal, messaging, Reports and Automation Feed.

Issue #35 adds the [durable outbox worker and operational API](outbox.md), with [verification evidence](issue-35-verification.md) and [ADR 0023](../adr/0023-durable-outbox-worker.md). Provider delivery and business consumers remain downstream.

[WhatsApp installations and templates](whatsapp.md) documents the #36 provider boundary; see [ADR 0024](../adr/0024-whatsapp-provider-registry.md).

[Signed WhatsApp webhooks](whatsapp-webhooks.md) implement operational callback ingestion and durable inbox processing; see [Issue #37 verification](issue-37-verification.md).

[Messaging consent](messaging-consent.md) implements #38's independent source consumption, safe history and current policy checks; [verification](issue-38-verification.md).

[Outbound WhatsApp](whatsapp-outbound.md) implements durable intents, controlled provider attempts, monotone delivery history and audited recovery; [verification](issue-39-verification.md).

[Notification automation](notification-automation.md) implements the versioned #40 event-policy resolver, immutable activation cutover, Route/Parcel overlap suppression and database-only #39 enqueue boundary; [verification](issue-40-verification.md).

[Route-delay notifications](route-delay-notifications.md) implement #41's frozen-membership,
bounded resumable fanout and separately identified W19 reminder; see
[ADR 0029](../adr/0029-route-delay-notification-fanout.md) and
[verification](issue-41-verification.md).

[Secure deliveries](deliveries.md) implement #42's server-owned attempt/challenge authority,
atomic T05/T08/T06 Parcel seams, independent exceptional proof and narrow `delivery_otp`
outbound source; see [ADR 0030](../adr/0030-secure-atomic-delivery-proof.md) and
[verification](issue-42-verification.md).
