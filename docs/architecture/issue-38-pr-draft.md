# Issue #38 delivery draft

Commit message: `feat: enforce scoped messaging consent and send-time policy`

PR title: `Add scoped WhatsApp consent and current send policy`

## Description

Closes #38.

Persist explicit WhatsApp consent independently from webhook ingestion. Consume
signed, tenant-bound inbox records once, retain immutable source/policy evidence and
canonical audit, and recognize STOP/START before general conversation handling.
START requires current same-contact disclosure context; unknown consent never grants
permission. Contact identity changes on phone edits, including restoration of an old
number, and consent never crosses franchise boundaries.

Add one current policy service for queue and dispatch integration. Check pending
inbound work, current contact/installation authority, revocation, requested assistance,
the 24-hour service window, and current approved utility-template capability.
Unresolved or unsupported inbound work fails closed. OTP exceptions and marketing
remain explicitly unavailable. R16-scoped history and policy reads expose safe outcomes
without phone numbers, content, ciphertext or credentials; staff cannot override consent.

Migration 25 adds contact identity and consent state/disclosure/receipt tables, owner
constraints, indexes, source-bound writes and immutable evidence. Apply additive schema
and documented restricted grants before code; retain evidence and roll back compatible
code/configuration only. Existing migrations are unchanged. Historical upgrade fixtures
now account for the added migration and preserve the original customer fields.

Started from freshly pulled clean main `4da7c8f`, after verifying #37 PR #121 merged and
its implementation tree matches main. Recovered its full available implementation/merge
conversation and carried forward its transaction, privacy, failure and test lessons.
#36 PR #120 and all issue-roadmap dependencies were reviewed. No prerequisite work was
duplicated and no unrelated local changes existed.

## Validation

Full local quality passed: 469 API tests, 155 web tests, 63 database tests, 257
database-backed API tests, 29 tooling tests, 34 testkit/runner unit tests, three
object-store contracts, lint, typecheck and production builds. All 24 released
migrations are unchanged. Final focused PostgreSQL validation passed 15/15 against
the final source; final lint, typecheck and planning checks passed.

The first full run failed the table-inventory fixture; the correction and exact run
sequencing are recorded in the [verification report](https://github.com/ShippingCo/ShipIT/blob/issue-38-scoped-messaging-consent/docs/architecture/issue-38-verification.md).
Coverage includes unknown/affirmative/revoked consent, queued STOP suppression,
duplicate/concurrent callbacks, stale and expired evidence, ambiguous contacts, phone
changes, A/B/C tenant isolation, forbidden roles, template changes, rollback/lost commit,
real HTTP and restart, populated #37 upgrade and restricted runtime privileges.

## Boundaries

#39 owns actual outbound intents and provider dispatch, including verified disclosure
delivery recording; it must invoke the policy at queue and final dispatch. Synthetic
fixtures provision disclosure evidence with the migration identity. Live grant collection
stays closed until that integration exists; no staff write endpoint is provided.
#42 owns the reviewed delivery-challenge/authentication-template extension. There are
no live Meta/customer sends, new UI, demo-state imports or legal certification claims.
Remote CI must pass on the published head before merge. No independent approving
review is claimed; the maintainer authorized publication and merge after verification.

[Design, alternatives and sources](https://github.com/ShippingCo/ShipIT/blob/issue-38-scoped-messaging-consent/docs/adr/0026-scoped-messaging-consent.md) ·
[API, rollout and recovery](https://github.com/ShippingCo/ShipIT/blob/issue-38-scoped-messaging-consent/docs/architecture/messaging-consent.md)
