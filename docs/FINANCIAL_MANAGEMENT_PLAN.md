# ShipIT financial and management module plan

Approved additive scope, 3 October 2026. [Roadmap](ROADMAP.md) · [Issue index](ISSUE_INDEX.md)
· [GitHub M6](https://github.com/ShippingCo/ShipIT/milestone/7)

The user approved adding all ten modules and required detailed issues in the existing
format without removing old requirements. This plan preserves the original 82 issues
and adds 14 M6 issues. The project now has 96 planned issues across the same nine milestones.
This is planning, not implementation or production-readiness evidence.

## Module coverage

| # | Owner module | Owning issues | Required outcome |
| --- | --- | --- | --- |
| 1 | Daily Sales Dashboard | [#148](https://github.com/ShippingCo/ShipIT/issues/148), [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#62](https://github.com/ShippingCo/ShipIT/issues/62), [#63](https://github.com/ShippingCo/ShipIT/issues/63) | Today/yesterday, bookings, billed amount, average bill, collections and new/returning customers. |
| 2 | Payment Reconciliation | [#138](https://github.com/ShippingCo/ShipIT/issues/138), [#146](https://github.com/ShippingCo/ShipIT/issues/146) | Methods/accounts and allocations; manual verification and bank/provider statement matching with exception review. |
| 3 | Daily Cash Closing | [#140](https://github.com/ShippingCo/ShipIT/issues/140), [#145](https://github.com/ShippingCo/ShipIT/issues/145) | Expenses/transfers, opening and counted cash, discrepancy, employee accountability and approved close. |
| 4 | Customer Ledger & Outstanding Ageing | [#63](https://github.com/ShippingCo/ShipIT/issues/63), [#138](https://github.com/ShippingCo/ShipIT/issues/138), [#142](https://github.com/ShippingCo/ShipIT/issues/142), [#149](https://github.com/ShippingCo/ShipIT/issues/149) | Statements, due dates, partial payments, 0–30/31–60/61+ buckets and owner overdue alerts. |
| 5 | Monthly Account / Corporate Customers | [#141](https://github.com/ShippingCo/ShipIT/issues/141), [#142](https://github.com/ShippingCo/ShipIT/issues/142) | Negotiated rates, terms/credit control, monthly documents and multi-shipment payments. |
| 6 | Daily Delivery Agent Ledger & Settlement | [#143](https://github.com/ShippingCo/ShipIT/issues/143), [#144](https://github.com/ShippingCo/ShipIT/issues/144) | Temporary agents, handover/return receipts, freight/COD custody, fees and settlement. |
| 7 | Daily / Weekly / Monthly Owner Reports | [#149](https://github.com/ShippingCo/ShipIT/issues/149) | Scheduled source-backed financial and operational summaries with revocation-safe delivery. |
| 8 | Revenue & Profitability Analysis | [#147](https://github.com/ShippingCo/ShipIT/issues/147), [#53](https://github.com/ShippingCo/ShipIT/issues/53), [#59](https://github.com/ShippingCo/ShipIT/issues/59) | Revenue dimensions, actual/estimated cost provenance, direct contribution and visible missing-cost coverage. |
| 9 | Discount / Refund / Edit Audit | [#139](https://github.com/ShippingCo/ShipIT/issues/139) | Reasons, approval, actor/time, original values and linked immutable corrections/refunds. |
| 10 | GST & Accounting Reports/Exports | [#62](https://github.com/ShippingCo/ShipIT/issues/62), [#150](https://github.com/ShippingCo/ShipIT/issues/150), [#61](https://github.com/ShippingCo/ShipIT/issues/61), [#67](https://github.com/ShippingCo/ShipIT/issues/67) | Invoice/statement register, saved GST evidence and versioned accountant-reviewed exports. |

## New implementation contracts

All new issues use the existing full outcome/scope/rules/data/API/security/reliability/UX/
acceptance/tests/rollout/DoD/17-step-workflow format. #137 is the prerequisite contract
issue; its completed source prerequisites permit starting the decision work, not enabling
unratified financial permissions. Other new issues are blocked on their named prerequisites.

| Issue | Scope |
| --- | --- |
| [#137](https://github.com/ShippingCo/ShipIT/issues/137) | Ratify financial operations, account billing and reconciliation contracts |
| [#138](https://github.com/ShippingCo/ShipIT/issues/138) | Extend payment recording with methods, receiving accounts and allocation evidence |
| [#139](https://github.com/ShippingCo/ShipIT/issues/139) | Implement approved discounts, cancellations, refunds and financial adjustment audit |
| [#140](https://github.com/ShippingCo/ShipIT/issues/140) | Implement expense records, cashbook movements and acknowledged cash transfers |
| [#141](https://github.com/ShippingCo/ShipIT/issues/141) | Implement monthly customer accounts, negotiated rates and credit controls |
| [#142](https://github.com/ShippingCo/ShipIT/issues/142) | Implement monthly account bills, statements and customer payment allocation |
| [#143](https://github.com/ShippingCo/ShipIT/issues/143) | Implement temporary delivery-agent onboarding and parcel handover receipts |
| [#144](https://github.com/ShippingCo/ShipIT/issues/144) | Implement delivery-agent cash, COD, fees and end-of-day settlement |
| [#145](https://github.com/ShippingCo/ShipIT/issues/145) | Implement daily cash counting, closing approval and discrepancy accountability |
| [#146](https://github.com/ShippingCo/ShipIT/issues/146) | Implement bank and payment statement reconciliation with exception review |
| [#147](https://github.com/ShippingCo/ShipIT/issues/147) | Implement shipment cost capture and revenue contribution analysis |
| [#148](https://github.com/ShippingCo/ShipIT/issues/148) | Implement owner daily sales dashboard and comparable business metrics |
| [#149](https://github.com/ShippingCo/ShipIT/issues/149) | Implement scheduled owner summaries and overdue operational alerts |
| [#150](https://github.com/ShippingCo/ShipIT/issues/150) | Implement accountant invoice register and versioned accounting exports |

## Ordering and retained work

1. Finish M4 on its original terms; only #52 remained open at this planning inspection.
2. Ratify #137: definitions, ownership, permissions, due/credit rules, document type,
   refund/correction rules and cash-close policy. Record accountant/provider decisions
   instead of inventing statutory or integration behavior.
3. Build #138/#139/#140/#141/#143, then monthly billing #142, agent settlement #144,
   cash closing #145 and statement reconciliation #146 according to their actual edges.
4. Build the #61 framework independently, extend #62/#63/#66 when their added sources
   exist, and retain #64 operational and #65 messaging reports in full.
5. Add #147 costs/contribution, #148 dashboard, #149 summaries and #150 accountant exports.
   M5 #53/#59 supply carrier/rate provenance; ordinary financial recording does not wait
   for every carrier integration.
6. Expanded #67 verifies cross-report consistency, and M7 #69–#72/#74–#76 verifies the
   complete operating/restore/security/runbook/release path.

M6 grows from seven to 21 issues. M5 and M7 descriptions gain additional scope; their
existing issues, objectives and exit checks remain intact. No milestone is renumbered.
Completed foundations are reused without reopening them. M8 is still post-pilot SaaS
commercialization; shop customer account billing is a different capability.

## Financial rules to preserve

- A ₹1,000 booking paid ₹600 today and ₹400 tomorrow is one sale and two dated receipts.
- Credit means pay later. A customer advance is money received but not automatically sales.
- Payment recording, external verification and physical money custody are separate facts.
  Agent cash handover neither collects twice nor reopens an already paid customer balance.
- ₹2,000 seller-owned goods COD plus ₹100 freight is not ₹2,100 shop revenue. Track the
  beneficiary liability and agent fees separately; no silent deduction from seller money.
- Monthly documents group source obligations without creating duplicate revenue or debt.
  Invoice-versus-statement and correction rules must be ratified before issuance.
- Expected drawer cash is opening plus cash inflows minus cash outflows. UPI/card do not
  enter the cash drawer; transfers are not sales or expenses. Shortage is not an automatic
  employee deduction or a reason to mark customers unpaid.
- External matching uses account/currency/reference/amount evidence. Amount alone is a
  suggestion; screenshots alone are not bank verification. Re-imports and overlapping
  statement periods must not duplicate transactions or consume one receipt twice.
- Card gross ₹5,000, evidenced fees ₹100 and bank net ₹4,900 can reconcile as one batch.
  Future settlement remains pending until its expected time; unexplained credits are not
  automatically new sales. Recording a previously missing receipt is a separate action.
- Original financial evidence remains immutable. Discounts, cancellations, corrections
  and actual refunds are linked, approved actions with actor/time/reason and balance limits.
- Missing cost remains unknown. Direct contribution is labelled separately from net shop
  profit, which requires approved expense completeness/allocation rules.
- Reports use explicit source IDs, as-of cutoffs and Asia/Kolkata dates; all exports and
  scheduled summaries enforce the same scope and definitions as their source screens.

## Pilot verification and scope limits

The integrated fictional day/month includes split tender, partial/combined payments,
monthly billing, cancellation/refund, expenses, card fees, agent COD/handover, late
correction and missing costs. Dashboard, statements, cash close, agent settlement,
owner summaries and exports must independently reconcile. Test two-org/three-franchise
permissions, revoked recipients, credit/allocation/refund races and crash/retry behavior.

First delivery uses manual checks and explicitly supported bank/provider statement formats.
Automatic live bank connections, gateway refunds, payroll deductions, government filing,
full accounting replacement and analytics warehouse are outside this approved first scope.
One accountant-reviewed target mapping must be qualified before claiming software compatibility.

## Preservation and publication checks

All 15 existing issue bodies were extended with an appended, labelled section; original
titles, state, milestone, labels and assignees are retained. M5/M6/M7 descriptions are
extended without replacing earlier content. The issue index retains every original row
and lists extra prerequisites separately. The planning validator checks all 96 unique
issue IDs, missing/circular dependencies, every new issue's path into #76 and exclusion
of M8 from pilot prerequisites. No runtime feature, customer data or production setting
is changed by this planning update.
