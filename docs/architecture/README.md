# Production architecture

Issue [#2](https://github.com/ShippingCo/ShipIT/issues/2), 6 September 2026.
Baseline: `91dde097307a1558ca0c27474b546189985def82` from freshly pulled `main`.

This is the production architecture decision baseline submitted for PR review. The
ADRs become accepted repository decisions when that review is approved and merged;
this document does not assert that another engineer has already ratified them.
All production components described here are **planned**, unless explicitly identified
as existing. No API, schema, authentication, outbox, worker, or provider integration
is implemented by this issue.

## Read in this order

1. [System context, module/data ownership and trust boundaries](system-context.md).
2. [Runtime sequences and authoritative-service walkthroughs](runtime-sequences.md).
3. [ADR index](../adr/README.md), including [API and event conventions](../adr/0004-durable-events-and-transactional-outbox.md).
4. [Pilot gates and commercial boundaries](pilot-boundaries.md).
5. [Open decisions with owners and resolution gates](open-decisions.md).
6. [Reproducible review and validation evidence](verification.md).

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
