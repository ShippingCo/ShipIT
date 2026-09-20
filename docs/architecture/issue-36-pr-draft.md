# Issue #36 delivery draft

Commit message: `feat: add tenant-scoped WhatsApp provider and template registry`

PR title: `Add tenant-scoped WhatsApp provider and approved-template registry`

## Description

Closes #36.

Business messaging needs a server-owned installation and template boundary before
webhooks, consent enforcement and durable sending can be implemented. Add a Meta Cloud
API adapter and tenant-scoped connect, rotate, disable, template-sync and capability APIs.
Administrators select deployment-provisioned aliases; credentials remain server-side and
responses expose only masked installation identity. Unsupported, stale, unapproved or
wrong-language templates fail capability checks with controlled reasons.

Use existing live membership authorization (R29 and the documented W45 mutation grant),
strict request validation and CSRF protection. Provider reads occur outside transactions;
authorization and optimistic versions are checked again before atomic persistence.
Idempotency receipts preserve the original result across concurrent retries and uncertain
commit responses. The adapter bounds deadlines, response size and pagination, refuses
redirects and does not automatically retry uncertain message acceptance.

Migration 23 adds installations, immutable template revisions and command receipts with
composite ownership constraints, immutable identity, restricted runtime grants and
deferred completeness checks. Extend canonical audit with safe command metadata. Existing
migrations, business events and the #35 outbox worker remain unchanged. Existing upgrade
fixtures account for the new migration and place synthetic repairs after it.

Configuration is optional. Apply the migration and documented runtime grants before
enabling it; old code remains compatible with the additive schema. The sender port is
contract-tested but remains unwired pending #37–#39; capability does not grant consent or
enable customer sends. No new dependency or frontend change is included.

## Validation

Passed: lint, tenant-query guard, planning, typecheck, released-migration integrity,
28 tooling tests, 34 testkit/database-runner unit tests, 441 API tests, 19 focused real
PostgreSQL tests, three object-store contracts, and production API/web builds.

Full quality remains failing at unchanged web startup waits. The corrected full database
rerun reached its existing 600-second timeout; the final focused database run passed
all new WhatsApp tests and corrected upgrade tests without skips. A green full regression
run remains required before merge. No test deadlines or security guards were weakened.

See [the verification report](issue-36-verification.md) for exact commands, results and
recorded failures, including migration rollback/retry, real PostgreSQL role isolation,
concurrency, replay after an uncertain commit, permission revocation during provider I/O,
restart persistence, loopback HTTP and safe API/audit/log projections.

Live Meta onboarding, permissions and actual delivery are unverified without a sandbox
account. No production data or customer recipients were used. Research, alternatives and
the approval-policy boundary are documented in [ADR 0024](../adr/0024-whatsapp-provider-registry.md).
