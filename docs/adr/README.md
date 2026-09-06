# Architecture decision records

[Architecture overview](../architecture/README.md)

Status for ADRs 0001–0005: **proposed for acceptance in issue #2's reviewed PR**.
The decisions below are the concrete baseline to review, not completed production
features or evidence of prior human approval. Acceptance is recorded by the approved
and merged PR; superseding a decision requires a new reviewed ADR with migration cost.

| ADR | Decision |
| --- | --- |
| [0001](0001-raw-sql-and-postgresql-access.md) | Preserve Fastify, PostgreSQL, pg and forward-only node-pg-migrate |
| [0002](0002-api-domain-query-boundaries.md) | Modular monolith with explicit HTTP, command/domain, query and persistence boundaries |
| [0003](0003-server-authority-and-tenant-enforcement.md) | Server authority, organization/franchise isolation and public DTO limits |
| [0004](0004-durable-events-and-transactional-outbox.md) | Atomic business/outbox persistence, worker delivery and versioned contracts |
| [0005](0005-external-provider-adapter-interfaces.md) | Application-owned provider ports, normalized outcomes and manual/file capability |

Detailed policy questions have an [owner and gate](../architecture/open-decisions.md).
No ADR here accepts additional auth, queue, hosting, provider or ORM dependencies.
