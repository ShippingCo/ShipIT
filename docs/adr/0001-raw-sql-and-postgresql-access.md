# ADR 0001: Fastify and raw PostgreSQL access

Status: proposed for acceptance by the issue #2 reviewed PR. Date: 2026-09-06.

## Context and evidence

The root [README](../../README.md), [API README](../../apps/api/README.md), and
[DB README](../../packages/db/README.md) already select Fastify, pg and node-pg-migrate.
API/DB entry points are empty. Courier queries require explicit ownership joins,
transactional money/state changes and inspectable SQL.

## Decision

Keep React/Vite and Fastify; PostgreSQL is the durable business authority. Use raw SQL
through pg, with versioned node-pg-migrate migrations in `packages/db/migrations`.
Do not introduce an ORM. Keep DB infrastructure in `packages/db` and domain-specific
SQL beside its owning API module. Bind every data value as a SQL parameter; dynamic
identifiers/order clauses require a closed server allowlist rather than interpolation
of client text. All private query/write paths include explicit, indexable ownership
constraints on organization/franchise and referenced parents.

A transaction helper retains one checked-out connection through begin, all module
writes, commit/rollback and release. No nested module silently uses the pool and commits
outside the caller's transaction. Use constraints plus scoped concurrency guards;
frontend preflight checks cannot guarantee docket uniqueness or ledger safety.

Migrations are forward-only: never edit an applied migration; correct it with a new
migration. Serialize migration runners, separate migration/runtime privileges and prove
fresh/upgrade/repeat behavior under #10. No tables or migrations are created in #2.

## Alternatives and consequences

An ORM would add a second abstraction and migration workflow without removing the need
to review tenant joins and transactions. Raw SQL makes query plans, locking and ownership
visible, at the cost of manually maintained row types, DTO mapping and more explicit
SQL. Tests must exercise real PostgreSQL semantics; mocks alone cannot establish safety.

Revisit only with measured query-maintenance or correctness costs, a concrete missing
capability, or supported-runtime constraints. A replacement ADR must compare evidence,
training/rewriting costs, migration/data compatibility, test coverage and rollback.
Preference or a diagram is not sufficient evidence. #10 selects reviewed dependency
versions; this ADR is not a security-advisory clearance.
