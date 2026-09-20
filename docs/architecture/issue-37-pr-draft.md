# Issue #37 delivery draft

Commit message: `feat: add signed idempotent WhatsApp webhook ingestion`

PR title: `Add signed WhatsApp webhook inbox and durable processing`

## Description

Closes #37.

Operational WhatsApp callbacks previously had no durable business ingress. Add separate
verification and signed raw-body POST endpoints that acknowledge only after an atomic
inbox/quarantine commit. Resolve scope from a server-provisioned app/WABA binding and
#36's immutable installation identity. Concurrent replay stores one logical event;
conflicts preserve the original, and unknown identities retain digest-only quarantine.

Add bounded PostgreSQL inbox jobs with atomic projection/attempt/completion, crash
recovery and five-attempt quarantine. Delivery/read observations remain monotone under
reordering and failure callbacks. Encrypt minimized inbound contact/content with a
dedicated versioned AES-GCM key and use stable keyed replay fingerprints; keep raw callbacks and sensitive data out of logs and
responses. Expose R29-scoped health/detail for investigation.

Migration 24 adds inbox, attempt, quarantine and delivery-observation tables with owner
constraints and restricted function-based writes. Existing #35 courier events/workers
and #36 configuration contracts remain compatible. Apply schema/grants before enabling
the optional webhook catalog property. Existing migration-upgrade fixtures include the
new schema and place synthetic repairs after it. No released migration or dependency changes.

The branch starts from the verified #36 merge (PR #120), with no intervening code changes.
The inbox uses short database-only job transactions because the existing outbox accepts
courier aggregates with different producer constraints. Consent, replies, outbound
sending and attempt reconciliation remain with #38–#39. Terminal/global quarantine
requires operator investigation and reviewed forward repair; there is no universal retry API.

## Validation

Full local quality passed after correcting the expected migration inventory: 448 API
tests, 155 web tests, 62 database tests, 249 database-backed API tests, 29 tooling checks,
34 testkit/database-runner unit tests, three object-store contracts, lint, typecheck and
builds. Migration history confirms all 23 released files are unchanged.

After final fingerprint/key-validation refinements, 23 focused API tests and 16 real
PostgreSQL tests passed, including the new inbox/upgrade behavior and #35/#36 regressions.
Final lint/typecheck and the keyed-fingerprint build passed. See the
[verification report](issue-37-verification.md) for precise run sequencing, the initial
migration-fixture failure, crash/outage/tenant evidence and acceptance mapping.

Live Meta onboarding/callback delivery is unverified without sandbox credentials; no
real customer messages were sent. Remote CI and independent PR review remain pending.

[Design and research](../adr/0025-signed-whatsapp-inbox.md) · [Rollout and recovery](whatsapp-webhooks.md)
