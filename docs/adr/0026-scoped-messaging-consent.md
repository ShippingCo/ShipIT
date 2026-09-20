# ADR 0026: Scoped consent and current messaging policy

Status: implemented for issue #38 review. Date: 2026-09-20.

## Context and history

Retrieved the complete available “Solve issue #37 using issue #36” task, including
implementation progress, research tool results, database corrections, tests and the
later authorized publication. GitHub PR #121 merged at `4da7c8f`; its tree equals
`0b7ce62`. Local main was clean, pulled and current before creating
`issue-38-scoped-messaging-consent`. No intervening changes exist. PR #120 contains
#36. Issues #2–#37 are closed; #38–#83 remain open. #38 has no comments or additional
discussion requirements. Prerequisites #8/#15/#16/#36/#37 are available; there is no
unfinished local prerequisite to duplicate. The remote #37 head has seven successful
checks; this does not substitute for testing #38 or independent review.

Recovered lessons: scope comes from persisted installation identity; ingestion must
commit before acknowledgement; source evidence is immutable; downstream consumption
needs its own identity; no network call belongs inside database effect transactions.
Keyed fingerprints protect short content from offline guessing. Migration inventories
and populated upgrades must be tested, and failed runs retained in the report. #37
eventually passed full quality after a migration-list correction; #36's earlier web
wait/database timeout history is not silently described as success.

## Decision

Keep the modular monolith, Fastify, pg and PostgreSQL 18.6. No dependency, broker,
ORM or generic workflow framework is added. A short independent consent consumer
decrypts only an already scoped, completed inbound record. Its immutable inbox-ID
receipt, consent state and canonical audit projection commit together. Duplicate
callbacks cannot duplicate transitions. Installation locking serializes competing
contact decisions; provider timestamps determine order, with STOP winning a tie.
Invalid future timestamps and unavailable keys fail closed with safe evidence.

Consent belongs to the organization, franchise, installation, channel, purpose and
current customer contact identity. A server-generated UUID changes on phone edits,
including changing back to an old phone. A domain-separated HMAC identifies the
channel contact; no second plaintext phone directory is created. Multiple matching
customers cannot receive inferred affirmative consent. STOP still suppresses that
contact. No existing customer or demo flag is backfilled as opt-in.

The selected conservative affirmative rule is exact START or START UPDATES replying
to recorded, unexpired disclosure evidence for the same installation/customer/contact
identity and current policy. Bare commands without context remain unconfirmed. A
disclosure predating STOP cannot restore consent. STOP, STOP UPDATES and UNSUBSCRIBE
are recognized before any general intent. Natural-language interpretation is #47/#51;
ordinary text neither grants nor clears consent.

Disclosure evidence is an internal integration boundary, not an operator consent
override. #39 must record the actual delivered disclosure identity and immutable
content hash through a reviewed server-owned integration before soliciting START.
No public or staff write endpoint or runtime disclosure-table write grant is exposed.
Tests provision fictional disclosure evidence with the migration identity. Until #39
provides this path, production grants remain unavailable rather than inventing proof.

At queue and final dispatch, #39 must call `checkCurrentConsent` with its trusted job
scope, current customer and requested purpose. Queue results are not authorization
tokens. Missing/revoked consent, contact changes, inactive/configuration-mismatched
installations, unresolved inbound work and ineligible templates suppress dispatch.
The pending check deliberately covers the whole installation: encrypted queued STOP
cannot be identified cheaply without decryption. This costs availability during a
backlog but prevents already-received STOP from being bypassed. #74 owns load sizing.

Requested assistance is separate from optional updates and requires a recent,
same-contact non-consent inbound reference. It never grants future updates. Revocation
still blocks it. Text requires an open 24-hour window. Template sends require current
exact-language approved supported utility metadata, matching credential revision,
less than fifteen-minute freshness and valid variables. These reuse #36's conservative
capability; neither provider approval nor policy eligibility promises delivery.
Marketing is unsupported. Delivery OTP returns `operational_exception_unapproved`:
#36 does not support authentication templates, and #42 must supply a reviewed challenge
and purpose-specific policy before enabling it. There is no blanket operational bypass.

## Research and alternatives

- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/), checked
  2026-09-20, requires permission and respect for withdrawal, limits free-form replies
  to the customer-service window, and requires eligible templates outside it. The
  application chooses stricter explicit evidence; this is not legal certification.
- [AWS Builders' Library: Making retries safe](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  supports preserving caller/source identity across retries. Here the immutable inbox
  ID plus atomic receipt is enough; a new user-supplied retry key would add ambiguity.
- [Stripe engineering: Idempotency](https://stripe.com/blog/idempotency) distinguishes
  lost responses from failed effects. Tests retry the same source after both rollback
  and lost commit acknowledgement; no universal exactly-once provider claim is made.
- [PostgreSQL 18 explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)
  supports row-level coordination. Existing PostgreSQL transactions fit this scale;
  a distributed lock service would create another failure boundary without benefit.

Rejected alternatives: default opt-in, a global phone consent flag, staff overrides,
cached enqueue permission, and widening courier domain events to carry private chat
bodies. Safe consent receipts are the domain facts for future consumers; this issue
does not change the courier event/outbox catalog or create outbound messages.

## Consequences

Migration 25 is additive and forward-only; prior migrations stay unchanged. Customer
DTOs remain compatible. Evidence and HMAC keys follow the existing field/class
retention policy; #72 owns deletion/holds. No new global retention duration is invented.
The existing fictional demo remains isolated and is not a source of production consent.
R16 local org/franchise admins, operators and dispatchers may read safe customer-scoped
history/policy. Assignment/custody projections await their owning workflows; this
directory endpoint does not grant delivery agents general customer access. W34 remains
denied for every staff role. No new screen is required for this service-only issue.

See [operations](../architecture/messaging-consent.md) and
[verification](../architecture/issue-38-verification.md).
