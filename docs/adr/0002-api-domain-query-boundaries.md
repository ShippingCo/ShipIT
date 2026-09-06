# ADR 0002: HTTP, application/domain and query boundaries

Status: proposed for acceptance by the issue #2 reviewed PR. Date: 2026-09-06.

## Context

The [API layout](../../apps/api/README.md) already organizes by domain. The browser
[store](../../apps/web/src/data/store.ts) currently mixes persistence, rules and messaging.
A two-developer product needs clear ownership without network services for every domain.

## Decision

Use a modular monolith with a web/API process and a worker process sharing server-owned
modules. A domain service is an in-process boundary, not a separately deployed service.
Keep existing `@shippingco` package names. Follow the concrete
[module/data ownership table](../architecture/system-context.md).

- HTTP routes validate DTOs, obtain authenticated scope, dispatch to services/queries and
  map errors/results. They do not contain transaction/business logic.
- Application services authorize intent and coordinate a transaction; domain functions
  validate legal transitions and calculations without HTTP or provider SDK types.
- Each mutation has one owner. A cross-domain command calls that owner's internal
  functions with the same transaction context. It does not directly edit another
  module's records or expose internal trusted transitions as public generic endpoints.
- `queries.ts` contains scoped read SQL and internal write SQL helpers. Read/query entry
  points cannot mutate business state; write helpers are called only by the owner service.
  SQL helpers do not choose business policy, permissions or transaction lifetime.
- Query/service mappers return purpose-specific public DTOs; DB row types stay internal.
- `packages/db` supplies connection/transaction/migration primitives, not domain rules.
  Pure browser-safe code can enter shared; sensitive/current-state rules stay server-side.
- The worker calls declared consumers and adapters after commit. Producers retain business
  authority; consumers own notification, reconciliation or projection effects only.

[Walkthroughs](../architecture/runtime-sequences.md) resolve cross-domain coordination:
Booking coordinates customers/parcels/payment/receipt; Routes coordinates parcel ETA;
Deliveries approves proof and calls Parcels' restricted completion operation. Reports
read facts and cannot repair the ledger by writing totals.

## Consequences and alternatives

This avoids both giant route handlers and a distributed transaction problem. Explicit
internal interfaces and transaction passing cost some code but allow Fastify injection,
pure-rule tests, DB integration tests and provider fakes independently. Queries share
the same DB; no separate CQRS bus/read infrastructure is introduced.

Split a deployable service only after measured isolation/scaling or ownership needs,
with a reviewed ADR addressing transaction consistency, operational cost and migration.
Exact DTO/event catalog is #4 (D04); schema and role details remain #3/#10, not duplicated here.
