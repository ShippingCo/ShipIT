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
| [0014](0014-guarded-parcel-lifecycle-commands.md) | Typed Parcel commands, optimistic versions, durable scoped replay, atomic transition/event evidence and controlled failure/RTO policy; proposed through Issue #24 |

[Issue #8 owning contract](../architecture/money-tax-proof-privacy-contract.md).

Detailed policy questions have an [owner and gate](../architecture/open-decisions.md).
The baseline ADRs do not select additional auth, queue, hosting, provider or ORM dependencies.
Live authentication delivery setup remains deferred to M3.

- [0015: Bounded Parcel bulk orchestration](0015-bounded-parcel-bulk.md) — Issue #25; proposed for PR review.

- [0016: Persistent lots and versioned membership history](0016-persistent-lots.md) — Issue #26; proposed for PR review.

- [0017: Dispatch routes and immutable Parcel manifests](0017-dispatch-route-manifests.md) — Issue #27; proposed for independent PR review.

- [0018: Atomic route events and ETA revisions](0018-atomic-route-events.md) — Issue #28; review pending.

- [0019: Payment ledger, settlement and financial corrections](0019-payment-ledger.md) — Issue #29; independent review pending.

- [0020: Immutable issued receipt snapshots](0020-immutable-issued-receipts.md) — Issue #30; first-retrieval materialization, R13, global numbering, entry-only acknowledgements and immutable reversal linkage; independent review pending.

- [0021 — Private attachment storage and validation](0021-private-attachment-storage.md): D09 application protocol, quarantine, exact limits, live access and temporary cleanup.

- [0022 — External e-way observations and prospective check reminders](0022-external-eway-records.md): bounded declared-value input, immutable revisions, external/estimate provenance, scoped replay and fail-closed reminder policy for Issue #32.

- [0023: Durable outbox worker](0023-durable-outbox-worker.md): PostgreSQL leases, atomic receipts, fair scheduling and controlled W44 redrive for Issue #35; independent review pending.

- [0024: WhatsApp provider registry](0024-whatsapp-provider-registry.md): Scoped installations, versioned templates and server-only Meta adapter for Issue #36; independent review pending.

- [0025: Signed WhatsApp inbox](0025-signed-whatsapp-inbox.md): Raw-byte authentication, trusted installation scope, durable inbox jobs and monotone callback evidence for Issue #37.

- [0026: Scoped messaging consent](0026-scoped-messaging-consent.md): Evidence, contact identity, deterministic withdrawal and current dispatch policy for Issue #38.

- [0027: Durable WhatsApp outbound](0027-durable-whatsapp-outbound.md): Stable intents, fenced dispatch, uncertainty, delivery reconciliation and disclosure proof for Issue #39.

- [0028: Event-to-notification automation policies](0028-event-notification-automation.md): Stable consumer identity, versioned policies, immutable cutover/decisions and Route/Parcel cause suppression for Issue #40.

- [0029: Resumable Route-delay notification fanout](0029-route-delay-notification-fanout.md): Frozen effect membership, 20-item durable batches, current-state/ETA policy, separately identified W19 reminders and database-enforced cooldown for Issue #41.

- [0030: Secure and atomic delivery proof](0030-secure-atomic-delivery-proof.md): Versioned protected challenges, atomic T05/T08/T06, independent exception approval and delivery-owned durable WhatsApp identities for Issue #42.
