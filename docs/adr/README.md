# Architecture decision records

[Architecture overview](../architecture/README.md)

ADRs 0001–0005 are the merged issue #2 baseline from
[PR #85](https://github.com/ShippingCo/ShipIT/pull/85), merged 2026-09-06. Their original
submission-status text is retained as historical evidence. ADR 0006 was merged through
[PR #86](https://github.com/ShippingCo/ShipIT/pull/86). ADR 0007 was merged through
[PR #87](https://github.com/ShippingCo/ShipIT/pull/87). ADR 0008 was merged through [PR #89](https://github.com/ShippingCo/ShipIT/pull/89);
ADR 0009 is submitted through Issue #8;
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
| [0008](0008-environment-secrets-and-security-baseline.md) | Isolated environments, public/server/secret configuration classes, rotation, prohibited logs and threat-to-test ownership gates |
| [0009](0009-money-tax-proof-and-privacy-policy.md) | Money/tax snapshots, challenge and exceptional proof, field retention and e-way provenance; narrow W37–W40 amendment |
| [0010](0010-organization-franchise-tenancy.md) | Organization/Franchise persistence, active/disabled lifecycle, explicit W41 franchise administration, ownership/privilege/concurrency defenses; submitted through Issue #12 |
| [0011](0011-operator-otp-authentication.md) | Email/WhatsApp OTP identity, revocable sessions, CSRF and narrow delivery queue; implemented through Issue #13 |
| [0012](0012-membership-invitations-and-rbac.md) | Organization/Franchise memberships, identity-bound invitations, W42 administration, live revocation and redacted transactional audit; proposed through Issue #14 |
| [0013](0013-tenant-scoped-query-capabilities.md) | Immutable scope capabilities, SQL ownership predicates, trusted-job port and AST regression gate; proposed through Issue #15 |

[Issue #8 owning contract](../architecture/money-tax-proof-privacy-contract.md).

Detailed policy questions have an [owner and gate](../architecture/open-decisions.md).
The baseline ADRs do not select additional auth, queue, hosting, provider or ORM dependencies.
Live authentication delivery setup remains deferred to M3.
