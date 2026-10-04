# ADR 0045: Sales/GST evidence and account statements

Status: accepted for the user-approved #62 local implementation, 2026-10-04.
Extends [ADR 0044](0044-bounded-report-snapshots.md) and the immutable tax,
payment and receipt contracts. No government filing or statutory credit-note claim.

## Decision

The report unit is one confirmed shipment booking. A monthly account statement
groups already-booked charges and never creates a second sale or obligation.
This is the user's approved document-policy choice for this implementation.
An issued booking receipt remains original evidence; neither a correction nor a
new tax policy overwrites it. Account statements are not tax invoices. An invoice
register with statutory numbering and filing treatment remains with #150/#137.

Reports capture one PostgreSQL statement snapshot, using saved booking tax facts,
issued receipt IDs where available, payment entries, approved financial changes
and statement membership. Rate filters use normalized exact fractions from the
saved tax components. Missing receipts are explicit, not fabricated or issued by
report capture. Inclusive dates mean Asia/Kolkata booking dates; collections and
refunds belong to those bookings through capture time, not cash-movement dates.

All amounts are exact paise. Per row and aggregate:

- pre-tax = taxable + non-taxable;
- GST = CGST + SGST + IGST;
- gross = pre-tax + GST + rounding;
- net held = collections minus collection reversals minus actual refunds;
- outstanding = max(gross - net held, 0); refundable credit = max(net held - gross, 0).

The simplified original #62 phrase `taxable + GST = gross` omits non-taxable
charges and rounding already required by #21 and the additive finance contract.
The explicit equation above preserves those components instead of silently
changing historical tax evidence. Group totals and exports sum the same saved rows.
Original charge components and approved reduction components remain separate.

## Necessary producer boundary

Append-only financial changes implement the bounded producers needed by #62:
reviewed discount/charge-tax reductions, full financial cancellation, and actual
refund recording. These commands do not cancel parcel movement or transfer money.
There is no automatic tax recalculation; the franchise admin supplies reviewed
component amounts and an opaque approval evidence reference. Refunds require an
opaque returned-to evidence reference and cannot exceed refundable credit.
The references identify externally reviewed evidence; they do not attest that a
government authority or bank verified it. Upward debit adjustments require a
separate approved producer contract and are not accepted as negative reductions.

`finance.adjust` and `finance.statement` are distinct server capabilities with
explicit local franchise-admin authority. R11 report visibility and accountant
membership cannot issue either command. This retains the conservative financial
write ceiling of W20/W21 and adds W47/W48 to the authorization matrix.

The booking obligation row serializes financial and payment commands. Expected
financial/payment versions reject stale decisions. Constraints independently
bound reductions, refunds and subsequent collections; immutable command outcomes
remain replayable. Statement lines have same-owner foreign keys, customer/period
validation and unique booking membership. A retry has the same actor, owner, key
and fingerprint; a changed body conflicts. State and audit commit together.
There is no async side effect or new event consumer in this bounded producer.

Historical payment replay includes only financial changes whose saved
`payment_version` precedes the payment entry's sequence. Occurrence timestamps
are display/audit evidence, not an ordering authority: clock skew or millisecond
rounding must not rewrite an earlier command result. This reuses existing ledger
versions without a new balance table or ordering column.

This does not complete all of #137–#142: customer credit profiles, negotiated
prices, advances, multi-booking allocation, due-date/aging policy and a general
customer ledger remain with their owners. Those issues must not be closed by this
change. Reports consume immutable source IDs and the existing payment ledger;
they do not persist another mutable balance authority. Account statements freeze
their period contents; later corrections appear in new sales snapshots, not by
rewriting an issued statement. A later unissued shipment may get a supplemental
statement, but a shipment cannot be issued twice.

## Research and cost

- **Adopt** scoped request identities and fingerprinted replay from the
  [AWS Builders' Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).
  This prevents duplicate corrections/statements after an uncertain response.
  Cost: append-only command identity storage and exact retry bodies, already used
  by this repository; no retry service or queue.
- **Adapt** [PostgreSQL statement-snapshot isolation](https://www.postgresql.org/docs/18/transaction-iso.html).
  One capture SQL statement avoids mixing totals from different committed states.
  Existing organization locks serialize authorization changes; obligation locks
  and version checks serialize financial writes. Cost: bounded reads and short
  transactions; no distributed lock or warehouse.
- **Adapt** the separation of credit adjustments from money returned in
  [Stripe's customer balance model](https://docs.stripe.com/invoicing/customer/balance).
  A cancellation reduces debt; only explicit actual-return evidence reduces held
  funds. Cost: one small immutable source table and updated payment projections.
  Stripe APIs, payment execution and a general accounting ledger are deferred.
- **Reuse** ADR 0044 CSV escaping, bounded snapshots, current authorization,
  access audit and expiry. No extra export worker, dependencies or LLM integration.

## Rollout and evidence

See [reporting operations](../architecture/reporting.md) for grants, compatibility,
recovery and exact commands; [verification](../architecture/issue-62-verification.md)
for tested outcomes and external completion boundaries.
