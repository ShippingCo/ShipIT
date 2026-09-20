# ADR 0027: Durable outbound WhatsApp intents

Status: implemented for issue #39 review. Date: 2026-09-20.

## Starting evidence

Recovered issue #38's complete available implementation conversation,
including implementation progress, research, command results, failed checks, corrections
and subsequent authorized publication. PR #122 is merged at `e83c898`; its tree matches
`85fd86a`. PR #121 contains #37, PR #120 #36 and PR #119 #35. Fresh main pull was already
current, the working tree was clean, and no intervening implementation exists. Work is
on `issue-39-durable-whatsapp-outbound`; no prerequisite was copied or cherry-picked.
All 82 indexed issues were retrieved; #2–#38 are closed, #39–#83 open. #39 has no comments.

The recovered lessons remain applicable: commit ingress before acknowledgment; derive
tenant authority from persisted sources; use independent downstream receipts; keep
network calls outside transactions; distinguish acceptance uncertainty from failure;
preserve immutable evidence; test populated migrations and record failed checks honestly.
#38's conservative START/disclosure rule and contact generation remain unchanged.

## Decision

Keep Fastify, pg and PostgreSQL 18.6. No broker, ORM, new dependency or generic workflow
framework. A database-only `enqueueMessage` accepts a trusted consumer capability and
an immutable source reference. Its owner/source/customer/purpose unique constraint is
the logical identity; keyed canonical rendering fingerprints reject conflicting reuse.
Randomized encryption is not used as identity. Replay returns the same ID, including
after suppression or expiry. #35 consumers can commit this effect with their receipt;
#40 still owns event selection, content policy, historical suppression and registration.
There is no new subscription replaying all historical bookings automatically.

Event requests currently address the booking customer and validate the owning booking,
parcel or explicit booking reference and original snapshot phone against the current
customer. Route recipient fanout and verified shipment-recipient grants require their
owning #41/#46 integration; arbitrary phone numbers never grant access. Requested
assistance uses a same-customer consumed inbound source, independently rechecked by #38.

One short transaction locks roots, installation, contact and intent, evaluates current
policy, and commits a dispatch reservation with a unique attempt and 30-second lease.
That commit is the dispatch linearization point. The installation UPDATE lock conflicts
with both signed ingress and consent consumption: an already committed STOP cannot
slip between the pending check and reservation. Root/contact/installation changes also
serialize with this decision. A STOP after reservation cannot retract in-flight HTTP.
No database lock spans network I/O. Failed or ambiguous reservation commit never starts
HTTP; an expired reservation becomes uncertain, including crash-before-send (a deliberate
availability tradeoff). A five-second Meta deadline is shorter than the reservation lease.

Only explicit non-acceptance (429) is retried automatically: five attempts per cycle,
jittered exponential delay capped at 300 seconds, extended by Retry-After. Provider waits
over one day dead-letter rather than retrying earlier than requested. Timeouts, thrown
transport failures, 5xx and malformed acceptance are uncertain. Permanent credential or
template rejection stops retries. No provider idempotency guarantee is assumed. A known
accepted provider ID maps to its original installation and attempt; unmapped uncertainty
requires explicit privileged `retry_uncertain_confirmed`, which acknowledges duplicate
delivery risk and preserves the original intent. This is not universal exactly-once delivery.

Reconciliation joins #37 observations through that installation/message mapping. Read
and delivered outrank later failure/stale observations. Acceptance alone is never delivery.
Attempts and redrives are append-only; canonical audit retains sanitized send/redrive facts.
Safe history and health use existing R18 operations permissions; W44 grants local franchise
administrators controlled redrive. No new role or W34 arbitrary staff-send permission.

Sensitive rendering is AES-GCM sealed with a separate outbound AAD domain, key version
and intent ID using the existing configured encryption key. A keyed fingerprint prevents
offline guesses of short content. No extra plaintext phone directory is stored. Rendering
is removed after acceptance/suppression or a maximum 24-hour dispatch deadline. That is
an operational freshness bound, not a statutory retention period for evidence. Failed or
uncertain work can be redriven only while its rendering is still usable. Safe identity and
attempt evidence remain for #72's approved retention/holds workflow. OTP is not supported.

## Disclosure integration

`consent_disclosure` is a fixed server-rendered, franchise-named requested-assistance
message, allowed only in the current service window with a same-contact inbound source.
It never initiates unsolicited contact or bypasses STOP. It states optional shipment
updates, START UPDATES, STOP and no effect on shipment service. There is no staff send API.
The stored hash represents that exact rendering. A narrow definer function writes #38
disclosure evidence only after a mapped signed delivered/read observation. It uses the
earliest delivery/read timestamp, never the latest observation timestamp, so a late read
cannot turn a pre-STOP disclosure into post-STOP evidence. Expiry is the original intent
deadline. Missing/invalid proof remains closed. Conversation orchestration stays downstream.

## Research and alternatives

- [AWS Builders' Library: Making retries safe](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  supports an explicit stable caller identity and conflict detection for changed intent.
  We reuse source identity, rather than inferring duplicates from identical text.
- [Stripe engineering: Idempotency](https://stripe.com/blog/idempotency) explains ambiguous
  network failures and retry safety. A local transaction cannot deduplicate an external
  provider lacking a verified idempotency contract; uncertainty therefore remains explicit.
- [PostgreSQL 18 SELECT](https://www.postgresql.org/docs/18/sql-select.html) documents row
  locking and queue coordination. Existing row locks and indexed due selection fit this
  modular monolith; adding Redis/distributed locks would add failure boundaries.
- [WhatsApp Business Policy](https://whatsappbusiness.com/policy/), checked 2026-09-20,
  supports respecting withdrawal and the service-window/template distinction. The existing
  stricter #38 evidence policy is retained; this implementation is not legal certification.
- The [Meta message reference](https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages)
  returned HTTP 429 during research. The existing pinned adapter contract and synthetic
  HTTP tests are the implemented boundary; live transport/onboarding remains unverified.
  No undocumented callback correlation or provider deduplication field was added.

Rejected: provider calls inside booking/outbox transactions, automatic retry of unknown
acceptance, plaintext queued bodies, manufacturing delivered evidence from a successful
POST, global phone matching, staff consent overrides, and automatic historical fanout.

## Consequences

Migration 26 is additive without old-row backfill or rewriting released migrations.
Three tables, due/history indexes, ownership FKs and immutable evidence guards are added.
Schema/grants precede code and explicit `outbound_enabled`; default is disabled. Old
producer code remains compatible. Current polling is bounded to one send/reconciliation
per second per process, coordinated by row locks; it is not a throughput/fairness SLA.
Hosted alert delivery and capacity qualification remain #70/#74. Safe health is durable
across restarts, with franchise_admin as recovery owner.

See [operations](../architecture/whatsapp-outbound.md) and
[verification](../architecture/issue-39-verification.md).
