# ADR 0009: Money, tax, delivery proof and privacy policy

Status: submitted for acceptance through the Issue #8 PR; accepted on reviewed merge.
Date: 2026-09-08. Owner: #8 / domain architecture and compliance.

[Contract](../architecture/money-tax-proof-privacy-contract.md) · [Sources](../architecture/policy-sources.md) · [Verification](../architecture/issue-8-verification.md)

## Context and authority

Fresh main `d4f036b5ca6d09946003aef59f3f6152faa8f194` contains merged #3/#6
(PRs #86/#89), quality baseline #5 (PR #88), and migration plan #7 (PR #90).
ADRs 0006/0008 outrank browser money, OTP and e-way behavior. This is a documentary
contract, not legal certification, production implementation or permission to launch.
The user's Issue #8 execution instructions authorize the conservative pilot policy.

## Decision

- Preserve INR integer paise and exact rational tax arithmetic, one final whole-rupee
  customer rounding with 50 paise upward, and an explicit reconciliation adjustment.
  Freeze confirmed Booking commercial facts independently of Parcel lifecycle.
- Version and effective-date approved local pricing/tax configuration under W27
  franchise_admin authority. Unknown jurisdiction blocks confirmation. Freeze resolved
  jurisdiction, rule/rate references, basis, components and final payable on Booking.
- Use documented deterministic largest-remainder allocation at paise precision for
  engineering fixtures. It is not a legal component-rounding ruling; qualified tax
  validation gates #21 production configuration and statutory reporting adapters.
- Set challenges to 10 minutes, five failed verifications per physical-attempt lineage,
  60-second resend cooldown and three resends. Resend preserves challenge, expiry and
  counters; replacement invalidates old versions and preserves lineage failures.
  No employee may retrieve plaintext challenges or verifiers.
- Exceptional proof is a separately requested, independently approved evidence path.
  The current responsible franchise_admin approves; the assigned agent still performs
  T06/T10 completion under W11. Approval never creates custody or payment settlement.
- Use class/field retention, narrow reviewed holds and minimal safe proof/audit metadata.
  Remove challenge secret material at lifecycle end; no support/debug retention.
  The designated ShippingCo compliance owner (project owner until designated) validates
  applicable rules with qualified Indian advice before release, every six months and
  upon material law/notification/provider changes.
- Separate externally issued e-way validity and provenance from labelled ShippingCo
  estimates. Neither a number entry nor a distance calculation proves government validity.

## Narrow amendment to ADR 0006 authorization contract

This ADR explicitly amends the closed matrix with W37–W40: own-franchise deliberate
jurisdiction resolution, assigned-agent challenge resend/replacement, assigned-agent
exception request, and current responsible franchise_admin exception approval. These
are reviewed additions within the existing seven roles, not inherited admin powers.
Historical “supervisor” language in Issues #8/#42 is superseded by this explicit
franchise_admin policy; there is no eighth role. W27 stays local; W11 retains completion authority; W34 privacy destruction stays denied
pending #72. No accepted money, lifecycle, custody or security invariant is superseded.
If legal validation requires a conflicting rule, stop that production path and obtain a
reviewed amendment/superseding ADR; do not alter historical amounts or expose secrets.

## Consequences, alternatives and rollout

A city-only default cannot establish place of supply. Recalculating old bookings from
new settings corrupts receipts. Revealing a code destroys the meaning of recipient proof.
One blanket deletion period either loses protected records or over-retains profile data.
The contract chooses explicit outcomes and release gates instead of these alternatives.

#21 implements taxes, #29 payments, #42 challenges/proof, #66 settings/calendars and #72
privacy. #31 owns attachments, #32/#67 e-way records/reporting, #36/#38/#39 messaging,
#22/#30 booking/receipts. No runtime, tables, providers or jobs are added. Rollback before
implementation is a reviewed documentary revert; after adoption, changes require versioned
compatibility/migration evidence and preserved historical snapshots. See the contract's
remaining gates for partial collections, negative credits and operating calendars.
