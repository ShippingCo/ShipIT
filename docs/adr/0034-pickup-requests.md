# ADR 0034 — Scoped pickup requests and committed staff decisions

Status: local implementation for #49, pending user review.

Base: `9f3a72d`, merged #48 PR #133. Its implementation-head Engineering checks
passed. #17/#38/#46/#48 are closed. GitHub milestone 5 is the product's **M4**,
issues #46–#52. The issue has no comments. The existing blocked index/label is
historical; no remote status was changed under this local-only authorization.

Recovered the relevant final decisions from “Review issues 46 and 47” and
“Research Milestone 4”. The approved #48 policy remains weight-based estimates with
manual review for dimensional/unsupported shipments. A suggested model from the
planning discussion was not treated as authorization to add AI. Existing quote,
consent, signed channel, tenancy and outbound code was inspected against these notes.

## Decision and tradeoffs

Keep the existing signed conversation as customer authority and bind every pickup
to its original installation/contact and tenant-owned quote. Use a confirmation key
for business intent, independently of the webhook ID. Persist a small explicit state
machine, expected versions and row locks; do not infer duplicate intent from equal
addresses/weights. Accepting staff become the responsible assignee. This activates
R22/W28 without adding roles or org-admin write inheritance.

Use a dedicated append-only pickup event journal linked directly to the existing
durable outbound table. Its rows are the committed source for #49's messaging effect;
it does not register events in the parcel/booking-only automation catalog. Future
#52 consumers can read the pickup journal without broadening #49 into reporting.
No additional queue, scheduler or service is justified at this product's scale.

Store private address only on the request and short-lived conversation draft; never
in an event, audit or a reply. Expired draft cleanup is a bounded scheduler-only
transaction that returns before acquiring installation locks, preventing inverted
lock order. Current source/consent checks remain at dispatch. Rendering expires
after 24 hours; outside the service window, fail visibly and require recovery after
new customer contact. A template cannot be invented or assumed approved.

## Source-backed engineering lessons

- [AWS Builders' Library — safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
  supports explicit intent identity and atomic persistence of identity plus effects.
- [Stripe engineering — idempotency](https://stripe.com/blog/idempotency) supports
  retaining a retry's identity through uncertain network outcomes.
- [PostgreSQL 18 — explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)
  supports row-lock serialization and consistent acquisition order. `SKIP LOCKED`
  is used only for bounded maintenance/worker selection, not to decide a customer race.
- [Meta — sending messages](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages)
  is the provider reference for free-form service messages and templates. The
  direct re-fetch was rate-limited (HTTP 429); this provider rule is reused from
  the existing #38/#39 contract, not claimed as newly verified provider behavior. The
  already implemented consent/provider boundary remains authoritative; this change
  adds no new template or provider capability and requires separate live qualification.

The 10/day submission budget, 30-day request horizon, 24-hour maximum appointment
window, self-assignment at acceptance, and reuse of own quote inputs are engineering
choices within the issue's bounds, not business capacity or price approvals.
No new pricing/capacity engine would improve the documented acceptance criteria.

## Verification mapping

Signed synthetic messages exercise dialogue, replay/restart, ownership and input
errors. PostgreSQL checks enforce atomic decisions, foreign A/B/C denial, concurrent
accept/cancel, mutation rollback, retained failed messages, retry/STOP/window rules,
draft cleanup and populated migration upgrades. Browser tests cover lazy private
detail access, required confirmations, focus return, empty/error and uncertain retry.
Full quality and #48 regressions remain required; old test results are not new proof.
