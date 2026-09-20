# Issue #39 delivery draft

Publication and merge were authorized after local verification. This records the approved
commit and PR details; remote CI and review requirements still apply before merge.

## Commit message

```text
feat(whatsapp): add durable outbound intents and delivery reconciliation
```

## PR title

```text
Implement durable WhatsApp outbound queue and delivery reconciliation
```

## PR description

Closes #39.

Customer sends need a durable identity across worker retries, crashes and ambiguous
provider responses. This adds tenant-owned outbound intents, bounded provider attempts,
delivery reconciliation and audited recovery. A timeout after possible acceptance stays
uncertain and cannot trigger an automatic resend. Confirmed 429 rejection observes
Retry-After within a five-attempt cycle; permanent failures require administrator review.

### Implementation

- Add a database-only enqueue service for trusted post-commit consumers, with stable
  source/customer/purpose identity, conflicting-replay detection and encrypted rendering.
- Reserve each send in a short transaction after rechecking current installation,
  template, contact and consent. Serialize signed inbound processing with reservation;
  perform all provider HTTP outside database transactions.
- Map provider message IDs to attempts and reconcile signed #37 observations. Delivered
  and read never regress. Expired reservations recover as uncertain, preserving evidence.
- Expose scoped message history, health and versioned/idempotent redrive through existing
  R18/W44 permissions. Failed/uncertain work remains visible after restart and emits safe
  review alerts. No message content, phone or credentials enters these DTOs or audit facts.
- Record #38 disclosure evidence only after verified delivery of fixed server-rendered
  disclosure text. Provider acceptance alone cannot authorize START UPDATES.
- Add migration 26, ownership constraints, immutable attempt/redrive evidence, restricted
  grants and scheduling functions. Update migration inventories and historical upgrade
  counts without changing any released migration.

### Dependencies and rollout

#35–#38 were confirmed merged before implementation. Recovered the #38 implementation conversation,
including research, implementation, failed checks, corrections and merge evidence.
Started from clean freshly pulled main `e83c898`; #38's implementation tree matches it,
with no intervening changes or unfinished prerequisite work to copy.

Deploy additive schema and documented grants before code, then explicitly enable
`outbound_enabled` in the existing WhatsApp configuration. It defaults off. There is no
backfill or registered historical fanout: #40 owns event automation, #41 route fanout,
#42 delivery challenges and #44 the history UI. Roll back compatible code/configuration
while retaining evidence; repair applied schema forward.

Rendering expires after 24 hours and is removed on acceptance or suppression. Recovery
cannot resend purged content. Explicit uncertain redrive accepts possible duplicate
external delivery; no universal exactly-once provider guarantee is claimed. Hosted alert
transport and capacity qualification remain with #70/#74.

### Validation

`pnpm db:local quality` passed: toolchain, 29 tooling tests, planning, lint, typecheck,
22 testkit and 12 DB unit tests, 473 API tests, 155 web tests, three S3 contract tests,
64 DB + 271 API PostgreSQL tests (zero failures/skips), and API/frontend production builds.
`pnpm check:migrations` passed with all 25 released migrations unchanged; `git diff --check`
passed. Disposable services were cleaned up. Existing React act warnings and expected
S3 failure-injection warnings remain; no check was relaxed.

See [the verification record](issue-39-verification.md) for commands, initial failures
and their corrections. Coverage includes concurrent enqueue/dispatch, accept-then-timeout,
lost commits, process restart, callback reordering, STOP during backoff, credential and
template repair, audited redrive, tenant B/C isolation, roles/CSRF, committed booking
independence, privacy and a populated #38 migration rollback/retry.

Synthetic Fastify servers were started on real loopback ports with disposable PostgreSQL;
signed STOP ingestion and restarted history reads were exercised. No production data or
real customer delivery was used. No UI changed; the existing web regression suite remains
part of the full gate. Live Meta acceptance requires sandbox credentials and remains
unverified. Full `verify:gates` failure drills, remote CI and independent review are not
claimed as local results.

Design decisions and influential AWS, Stripe, PostgreSQL and provider sources are in
[ADR 0027](../adr/0027-durable-whatsapp-outbound.md). The [operations guide](whatsapp-outbound.md)
documents APIs, exact grants, the feature flag, recovery and reproducible fixtures.
