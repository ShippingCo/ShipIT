# Architecture decision records

[Architecture overview](../architecture/README.md)

ADRs 0001–0005 are the merged issue #2 baseline from
[PR #85](https://github.com/ShippingCo/ShipIT/pull/85), merged 2026-09-06. Their original
submission-status text is retained as historical evidence. ADR 0006 was merged through
[PR #86](https://github.com/ShippingCo/ShipIT/pull/86). ADR 0007 is submitted through the Issue #4 PR;
these documents do not claim completed production features. Acceptance
is recorded by the approved and merged PR; superseding a decision requires a new reviewed ADR with migration cost.

| ADR | Decision |
| --- | --- |
| [0001](0001-raw-sql-and-postgresql-access.md) | Preserve Fastify, PostgreSQL, pg and forward-only node-pg-migrate |
| [0002](0002-api-domain-query-boundaries.md) | Modular monolith with explicit HTTP, command/domain, query and persistence boundaries |
| [0003](0003-server-authority-and-tenant-enforcement.md) | Server authority, organization/franchise isolation and public DTO limits |
| [0004](0004-durable-events-and-transactional-outbox.md) | Atomic business/outbox persistence, worker delivery and versioned contracts |
| [0005](0005-external-provider-adapter-interfaces.md) | Application-owned provider ports, normalized outcomes and manual/file capability |
| [0006](0006-domain-ownership-and-authorization.md) | Canonical Booking/Parcel, organization/franchise, custody, authorization, state, money/time/docket and adoption contracts |
| [0007](0007-api-event-idempotency-contracts.md) | API v1/errors/cursors, scoped canonical idempotency, immutable event catalog, compatibility, ordering and replay contracts; refines ADR 0004 |

Detailed policy questions have an [owner and gate](../architecture/open-decisions.md).
No ADR here accepts additional auth, queue, hosting, provider or ORM dependencies.
