# ADR 0033 — Customer shipment estimates

Status: Local implementation for #48; publication awaits user review.

## Evidence and approved scope

On 2026-10-02, read the complete accessible chats “Research Milestone 4”,
“Research milestone 4 and solve issue” and “Solve issue #47”, the issue body,
dependencies and merged PRs #131/#132. Issue #48 has no comments. Its prerequisites
#20, #38, #46 and #47 are closed; #49, #51 and #52 follow this work. GitHub milestone
5 is named M4. Local main was updated to `368edb0` before the issue branch.

The user explicitly chose existing weight-based rates, with staff review for
dimensional or unsupported shipments. They authorized local work and verification,
not commit, push, PR publication, merge or production changes. Earlier research
recommendations alone were not treated as approved pricing policy.

## Decision

Extend the signed, consent-processed #47 conversation with a fixed QUOTE dialogue.
Collect origin, destination, actual grams, all three dimensions in millimetres and
service. Persist incomplete inputs within the existing 15-minute conversation.
Use the existing Pricing `calculate` function through a narrow trusted-worker seam.
No customer override, staff impersonation, new pricing engine, AI or dependency.

A franchise administrator uses existing W27 pricing authority to explicitly approve
a published rate version, origin, supported lanes, weight-only eligibility and
inclusive heavy/large thresholds. An optional manual-review policy suppresses
automatic amounts. No threshold, rate or lane is silently enabled by migration.
An estimate uses actual weight only after every policy check passes. Missing rates
and unsupported/dimensional inputs produce an immutable reference and reason without
an amount. The customer is told to contact staff; #50 owns actual case creation.

Engineering choices: at most 60 quote turns per contact/installation/hour, one package,
whole grams/millimetres, and expiry at the earlier of 15 minutes and Pricing's expiry.
These limits are implementation safeguards, not inferred business approvals.
Amounts are explicitly non-binding freight plus packing in INR. Tax, final payable
rounding, pickup, insurance and special handling are excluded.

Store immutable inputs, policy/rate/rule identity, assumptions, exclusions, expiry and
optional prior-reference link. Request identity is the signed inbox ID, not an input
hash: separate identical shipments may legitimately have separate references.
Dialogue, evidence and encrypted reply commit together under the existing ordered
worker transaction/savepoint. Dispatch rechecks consent, policy, contact, installation
and expiry. Foreign references are indistinguishable from unknown references.

QUOTE reference reuses a live approved estimate; expired or superseded estimates
recalculate from stored inputs and produce new evidence. CONFIRM QUOTE uses the same
check and explicitly never books. Existing booking validation accepts only staff
Pricing quotes, so a customer estimate cannot bypass fresh staff booking checks.

## Research and alternatives

- [AWS: safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/): explicit request identity and atomic effects.
- [Stripe: idempotency](https://stripe.com/blog/idempotency): retain retry identity and distinguish retry from a new operation.
- [PostgreSQL 18 locking](https://www.postgresql.org/docs/18/explicit-locking.html): use consistent lock order and serialize state changes.
- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default and authorize every resource request.

These sources support the transaction and authorization approach; they do not define
ShipIT's tariff policy. Automatic dimensional pricing was rejected by the user.
Public rate-card exposure and a second quote engine would increase disclosure and
calculation drift. A new queue or model is unnecessary for five validated inputs.

## #46/#47 review repairs

Pending consent processing now defers outbound replies without purging their payload
or consuming a send attempt. Exact docket selection is case insensitive. Delay replies
use recorded Route-effect minutes and stop exposing them after route arrival or a
Parcel leaves the relevant transit states. No elapsed-time inference is introduced.

## Verification and operations

See [contract](../architecture/customer-quotes.md) and
[verification](../architecture/issue-48-verification.md). Apply the additive migration
and least-privilege grants before enabling the server-only flag. Disable it for rollback,
retain compatible workers to suppress queued quotes, and repair schema forward.
Live Meta qualification, actual rollout and retention policy (#72) remain separate.
