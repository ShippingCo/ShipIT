# Production architecture

Issue [#2](https://github.com/ShippingCo/ShipIT/issues/2), 6 September 2026.
Baseline: `91dde097307a1558ca0c27474b546189985def82` from freshly pulled `main`.

Issue #2 was closed by merged [PR #85](https://github.com/ShippingCo/ShipIT/pull/85),
commit `256512a725c56c5c0e0fa180253add5ac20a69d0`. ADRs 0001–0005 are the merged
architecture constraints. [ADR 0006](../adr/0006-domain-ownership-and-authorization.md)
records the merged #3 business-policy refinements from [PR #86](https://github.com/ShippingCo/ShipIT/pull/86).
[ADR 0007](../adr/0007-api-event-idempotency-contracts.md) records merged #4 wire/event/replay refinements.
[ADR 0008](../adr/0008-environment-secrets-and-security-baseline.md) proposes #6 environment, secret and threat controls.
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

## Existing evidence and precedence

The workspace contains React/Vite screens, the browser [store](../../apps/web/src/data/store.ts),
[prototype types](../../apps/web/src/data/types.ts), [message templates](../../apps/web/src/data/messages.ts),
[deterministic bot](../../apps/web/src/data/bot.ts), and [frontend tests](../../apps/web/src/test/app.test.tsx).
The API, DB and shared entry points export empty modules. Only the web package has
runtime dependencies. Existing API module folders contain `.gitkeep` files; proposed
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

Keep React/Vite as presentation and a Fastify modular monolith as the HTTP/application
boundary. Domain services own commands; scoped SQL queries return public projections.
PostgreSQL persists business state, command deduplication, audit and outbox facts in
transactions. A separate worker process using the same server modules consumes durable
work and invokes application-owned provider ports after commit. Messaging outcomes never
rewrite booking, delivery, or payment truth. No microservice or broker infrastructure is
required by these boundaries. Exact implementation policies are gated in the decision
register rather than silently inherited from the prototype.
