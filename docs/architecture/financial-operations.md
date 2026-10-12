# Financial operations contract (#137)

Status: **product policy ratified and merged through [PR #165](https://github.com/ShippingCo/ShipIT/pull/165)**.
The [owner approval](https://github.com/ShippingCo/ShipIT/issues/137#issuecomment-6094308527)
ratifies D137-1–D137-5. Prepared 10 October 2026 against main `7ff46da`.
This is a ratified product contract, not runtime activation of new
financial actions. [Payments](payments.md), [ADR 0045](../adr/0045-sales-and-financial-evidence.md),
[role matrix](authorization-contract.md) and [module plan](../FINANCIAL_MANAGEMENT_PLAN.md)
retain authority for their already-approved scope.

## Existing evidence and approval gates

Merged foundations #8/#14/#16/#19/#20/#21/#22/#29/#30/#42 provide money,
membership, audit, customer, frozen pricing/tax, booking, payment, receipt and
delivery ownership. Their PRs are ancestors of the base. #62's partial PR #162
establishes bounded corrections/refunds and account **statements**, with W47/W48
franchise-admin authority. It does not ratify the wider #137–#142 workflows.

| Decision | Evidence / status | Owner and gate |
| --- | --- | --- |
| Statements group existing obligations without booking new revenue; not tax invoices | ADR 0045 and merged PR #162 | Preserve accepted boundary; accountant qualifies any later statutory document in #150 |
| Exact INR paise, immutable booked tax, separate COD ownership, append-only corrections | Existing domain contracts and approved finance expansion | Preserve; no new approval requested |
| D137-1 permissions below | Product-owner approved D137-1–D137-5, 10 October 2026 | Product owner approves precise role/action changes; maintainer independently reviews PR |
| D137-2 debtor, due dates and credit rules below | Product-owner approved D137-1–D137-5, 10 October 2026 | Product owner approves; accountant reviews ledger consequences |
| D137-3 new/returning and financial metrics below | Product-owner approved D137-1–D137-5, 10 October 2026 | Product owner approves definitions |
| D137-4 cash close, self-approval and reopening below | Product-owner approved D137-1–D137-5, 10 October 2026 | Product owner approves responsibility policy |
| D137-5 cancellation/refund and fee treatment below | Product-owner approved D137-1–D137-5, 10 October 2026 | Product owner approves operating policy; accountant qualifies tax/document treatment |
| Target accounting format, bank/card sample mappings and statutory numbering | Unresolved external inputs | #150 accountant mapping; #146 evidence-format owner; do not claim qualification without reviewed fixtures |

Approval evidence must identify decision IDs, approver, date and immutable review
or conversation reference. A prepared document, CI pass or agent review is not
ratification. Issue #137 is closed through its reviewed merge; later feature issues
must still meet their own acceptance and review/CI gates. Later external format qualification
belongs to #146/#150; this contract names those gates rather than claiming support.

## Definitions and source ownership

All measures declare owner, source IDs/versions, business date, as-of cutoff and
currency. Event time is UTC; business dates are Asia/Kolkata. Mutation values are
positive integer paise; aggregate arithmetic uses numeric/BigInt and decimal
strings when JSON safe integers are insufficient. Signed effects are derived from
entry kind, never supplied as unexplained negative money.

| Measure | Meaning and authoritative owner |
| --- | --- |
| Original billed gross | Frozen Booking charge including tax and rounding (#21/#22) |
| Adjusted billed gross | Original components minus approved linked reductions (#139); financial cancellation is distinct from physical shipment cancellation |
| Tax-exclusive revenue | Adjusted taxable plus non-taxable charge components; excludes GST, seller COD, advances, transfers and bank matching (#139/#62) |
| Recorded collections | Actual receipt inflows less corrections of incorrectly recorded receipts (#29/#138); does not imply bank verification |
| Refund outflow | Actual money returned with beneficiary/evidence reference (#139); adjustment approval alone is not a refund |
| Outstanding | Remaining source obligation after valid allocations, reductions and refunds; no second balance authority (#138/#142/#63) |
| Refundable credit | Customer funds above adjusted obligation; shown separately, never hidden negative debt (#139) |
| Advance | Actual received, unapplied customer funds; customer liability until allocated/refunded (#138/#142); neither credit permission nor sales |
| Seller COD liability | Goods principal owned by identified seller/beneficiary; separate from freight revenue and agent fees (#144) |
| Cash custody | Named employee/agent/drawer possession, independent of customer's settled debt (#140/#144) |
| Verified settlement | External account credit/debit matched to recorded evidence; matching creates no receipt or sale (#146) |
| Expense / direct contribution | Approved expense record (#140); shipment tax-exclusive revenue minus attributable costs with provenance (#147); unknown cost gives unknown contribution, not zero cost |

For existing single-booking sources, let G = adjusted gross, C = collections minus
recording reversals, F = actual refunds and H = C - F. Then
outstanding = max(G - H, 0), refundable credit = max(H - G, 0), and
G + refundable credit = H + outstanding. A reduction of G may create refundable
credit; only F records money leaving. Original tax/receipt evidence never changes.
Allocation and unapplied-advance totals must be kept separately when #142 generalizes
this equation; subtracting an account receipt from each shipment is forbidden.

## D137-1: proposed permission extensions

Use the existing seven roles. The current matrix remains effective until this
proposal is explicitly ratified and the owning implementation updates it.
`F` means current explicit own-franchise membership; `O` is existing declared
own-organization read only; `A` means active own assignment and minimal evidence.
All unlisted grants are denied. Custody never grants customer-directory access.

| Action | Proposed grant | Owner / constraint |
| --- | --- | --- |
| Record actual receipt and allocate it | franchise_admin, operator: F | #138/#142; extends W20 deliberately; no accountant or org_admin write |
| Reverse mistaken receipt; approve discount/cancellation/refund | franchise_admin: F | #139; existing W21/W47 ceiling retained; operator may request only |
| Record expense or initiate cash transfer/count | franchise_admin, operator: F | #140/#145; no requester-provided approval flag |
| Approve expense, cash close, discrepancy/reopen | franchise_admin: F | #140/#145; distinct approval evidence and expected version |
| Import statements, propose/confirm or reject reconciliation match | accountant, franchise_admin: F | #146; no creation of collection/expense by matching |
| Configure receiving account, monthly terms, credit limit or negotiated rate | franchise_admin: F | #138/#141; administrator-only configuration, no org_admin implicit mutation |
| Issue account statement and approve account corrections | franchise_admin: F | #142; preserves W48; accountant may preview/export only |
| Register temporary agent; accept/reject custody handover and approve settlement | franchise_admin: F | #143/#144; active employee records do not automatically become members |
| Record own handover request / acknowledge own assignment | delivery_agent: A | #143/#144; no general ledger mutation, customer-payment reversal or beneficiary-money deduction |
| Read/export financial evidence | Existing R25/R28/E03 grants | org_admin own-org read; franchise_admin/accountant F exports; operator minimum recording result only |

Separate request, approval, record, reconcile and export. Server derives ownership,
actor/time and grants; nested references, replay, background execution and downloads
reauthorize. Admin in franchise A cannot write B even in the same org. Org admins
cannot export without a separate permitted franchise grant. Read-only never mutates.
Agent registration without authenticated membership supports admin-recorded evidence
only; it does not invent login rights. #143 owns that access lifecycle.

## D137-2: proposed account, due-date and credit policy

The responsible debtor is an explicitly selected franchise-private customer/account,
not an inferred phone match or physical recipient. An ordinary sender defaults to
the booking customer only when confirmed by the booking contract; freight payer
exceptions require explicit source ownership. Seller COD has a separate beneficiary.

Ordinary To-Pay obligations are payable on the saved booking business date.
Monthly accounts require explicitly configured terms: closing day and nonnegative
days after closing. No automatic universal net-30 policy. Freeze due day and terms
version per obligation; legacy records lacking approved due evidence show **unknown
due**, never invented historical overdue. Monthly statements group those obligations
without changing frozen due dates; changed terms affect future bookings only.

Age since booking and days overdue are separate fields. Overdue starts the day
after due day; not-yet-due balances are separate. Known overdue buckets are 0–30,
31–60 and 61+ calendar days, disjoint, with explicit unknown-due count/amount.
#63's existing booking-age buckets keep their original definition and version.

An account has active/suspended state and an approved paise credit limit.
Credit is permission to defer payment, not receipt evidence. Booking checks outstanding
plus new adjusted exposure against the frozen limit under the account lock; pending
uncommitted bookings cannot both consume the same capacity. Advances reduce exposure
only through explicit valid allocation. Limit overrides require franchise-admin
approval evidence for that booking; no silent bypass by role or frontend flag.

## D137-3: proposed customer and dashboard definitions

New customer means their first confirmed, non-financially-cancelled booking within
the selected franchise-private relationship. Returning means an earlier eligible
booking existed before the current booking, even outside the report period. Ties
use confirmed timestamp and immutable ID. A later cancellation is evaluated at
the stated cutoff and does not delete historical source evidence. No cross-franchise
phone/person merging. Customer count is distinct relationship IDs, not parcels.

Booking count is commercial bookings; shipment/parcel count remains separate.
Average bill = adjusted billed gross divided by eligible booking count, labelled
with rounding; zero denominator shows unavailable. Today/yesterday share local-day
definitions and cutoff/freshness. Collection-day receipts and booking-cohort receipts
are labelled distinctly. Financial comparisons retain complete versus partial-day
labels. Net shop profit is deferred until expense completeness/allocation policy
is approved; direct contribution never claims to be net profit.

## D137-4: proposed closing and responsibility policy

Expected drawer = approved opening + actual cash inflows - actual cash outflows.
UPI/card are receiving-account records, not drawer inflows. Transfers have equal
linked out/in ownership; initiated is not received. Count variance = counted -
expected, signed and explicit. Neither shortage nor agent retention reopens debt
or creates an automatic payroll deduction.

States: draft count -> submitted -> approved -> superseded by approved reopen.
Only a franchise admin approves/reopens with reason and source version. Where a
second admin exists, require a distinct approver. For a sole-admin shop, explicit
self-approval is allowed and visibly labelled; it must not masquerade as independent
review. Submitted count and approval are immutable; reopening adds a linked version.
Late evidence is a visible subsequent correction/variance requiring reconciliation,
never an edit of closed evidence. No invented lockout time or overnight cutoff.

Custody handover states: requested -> accepted/rejected; settlement states:
draft -> submitted -> approved. Do not remove sender custody on an unacknowledged
transfer. Partial acknowledged amounts create linked evidence and leave the rest
outstanding. Agent fees are a separate approved expense; never silently net them
against seller principal. Closed settlement reopening follows the same append-only
approval rule as drawer close.

## D137-5: proposed correction, cancellation and refund policy

Preserve #62's component-wise reviewed reductions and explicit actual refunds.
Operators may request an action; only franchise admins approve/apply it, referencing
reason and evidence. This proposal adds no automatic upward debit producer.
Cancellation never implies zero cost or completed physical RTO. After payment,
cancel adjusted charges first; then refund at most available refundable credit.
Refund recording requires evidence of actual return and target beneficiary; no live
gateway call or claim of bank confirmation. Incorrect-receipt reversal is distinct
from a customer refund. Expected payment/financial versions reject stale approvals.
No universal refund deadline, fee percentage or statutory treatment is invented.

Monthly statements stay statements. #150 must obtain accountant-reviewed document
types, statutory numbering and correction mappings before advertising invoice/software
compatibility. Existing receipts are not automatically relabelled as tax invoices.

## Contract ownership, integrity and migration handoff

Proposed v1 names below are gated on ratification; owners finalize wire DTOs and
closed reason/state enums in their own issue before adding routes. Reuse the
current session, CSRF, scope, idempotency, audit and event conventions.

| Owner | Proposed contract families / retained facts |
| --- | --- |
| #138 | payment receipt/method/account/allocation; retain existing payment entries and opaque receipt references |
| #139 | financial request/approval/change/refund; reuse `financial_changes` and source component/version lineage |
| #140 | expense, cash movement, transfer acknowledgement; actor/custodian/account/version |
| #141 | debtor account, terms/limit/rate versions; franchise-private customer FK |
| #142 | statement issue, receipt allocation, advance application/refund; reuse `account_statements` and source-line uniqueness |
| #143/#144 | agent assignment/handover/settlement, COD beneficiary liability; assignment does not transfer financial ownership |
| #145/#146 | cash-close approval/reopen; statement-import/match/exception; match does not create money |
| #147–#150 | cost provenance, comparable dashboard, summaries, accountant export mapping; consumers never become ledger authorities |

Every owned entity has composite organization/franchise/resource foreign keys,
stable ID, source/version references and appropriate scoped uniqueness/indexes.
No cascade deletion of financial evidence. Multiple obligations in an allocation
lock in stable ID order after membership/account authorization, and commit receipt,
allocations, audit and required durable event atomically. Allocation sums cannot
exceed receipt capacity or obligation balance; advance/refund races share the same
source lock. Versions reject stale decisions; constraints enforce invariants independently.

Identity is scoped actor + versioned operation + request key digest, with canonical
intent fingerprint. Same identity/intent returns original result after current
authorization; changed intent conflicts. Before-commit failure rolls back all owned
effects. Lost commit response retries the exact identity, never a new key. No blind
retry of uncertain external acceptance. Import identities include receiving account,
currency, format/version and external transaction identity, not file name/amount alone.
Overlapping statements cannot consume a transaction/receipt twice; amount-only is
a suggestion. Card gross/fee/net settlement requires explicit batch evidence.

Consumers use one consistent cutoff and source versions; no current-policy tax
recalculation. Unknown bank match, due day, cost, method/account or legacy allocation
remains unknown. Each producer supplies an additive fresh/populated upgrade plan,
explicit legacy semantics and backward-compatible readers. Never edit released
migrations or pretend synthetic backfill verifies a real historical event.

## Worked fictional acceptance examples (contract evidence)

All rupee amounts here represent exact integer paise internally. IDs below are
fictional aliases scoped to org A/franchise A1; not production evidence.

| Scenario / source | Independent reconciliation |
| --- | --- |
| B1 booked ₹1,000; R1 ₹600 day 1; R2 ₹400 day 2 | One booked sale ₹1,000; dated net collections ₹600 + ₹400; due ₹400 then ₹0; later allocation/banking adds no sale/receipt |
| B2 freight ₹100; seller S1 goods COD ₹2,000; agent AG1 collects ₹2,100 | Shop freight collection ₹100; seller liability ₹2,000; agent custody ₹2,100. Acknowledged shop handover moves custody only; seller payout extinguishes liability, not shop expense. Fee ₹50 is separate expense; principal stays ₹2,000 |
| B3 ₹1,000, B4 ₹500; month-end statement ST1; receipt R3 ₹900 | Statement source gross ₹1,500, no new sale/debt. Explicit allocations ₹600 to B3 and ₹300 to B4; due ₹400 + ₹200 = ₹600 |
| Cancel B3 after that payment; refund RF1 ₹600 | B3 adjusted gross ₹0, held ₹600, refundable credit ₹600, due ₹0 before refund. After actual refund held/credit ₹0. B4 remains gross ₹500, held ₹300, due ₹200. Adjusted sales ₹500; dated inflows ₹900, refund outflow ₹600, retained ₹300. ST1 retains original source values; linked correction is shown separately |
| R4 ₹700 received as advance; allocate ₹200 later | Advance ₹700 then ₹500, booking due reduces by ₹200, total actual receipts still ₹700; no new receipt/revenue on allocation |
| Drawer opening ₹1,000; freight cash ₹100; COD cash ₹2,000; seller payout ₹2,000; cash expense ₹50; UPI ₹300 | Expected drawer ₹1,050. Count ₹1,040 gives variance -₹10. UPI does not alter drawer. Freight revenue ₹100, COD is liability, payout not expense, ₹50 expense. No employee deduction or debt reopening |
| Card receipts ₹5,000, evidenced fees ₹100, bank settlement ₹4,900 | Existing receipts remain ₹5,000; fee expense ₹100; matched bank credit ₹4,900. No additional sale/receipt. Without fee/batch evidence leave exception unresolved |

Authorization tabletop: org A has A1/A2, unrelated org C has C1. A1 operator may
record only an A1 receipt under proposed D137-1; A1 accountant reconciles/exports
A1 finance but cannot issue/refund or browse delivery history. Org A admin reads
declared A1/A2 aggregates without write/export inheritance. AG1 sees only active
assigned work and permitted own evidence. A1 guessed A2/C1 IDs and unknown IDs share
controlled 404; visible but denied action is 403. Revoke before replay/export/job
execution: deny without rows/totals or a second effect. These are required runtime
tests for owners, not claims that proposed APIs have been executed.

Failure tabletop: concurrent ₹600 + ₹600 allocations against ₹1,000 permit at most
one ₹600 (remaining ₹400); duplicate key appends once; changed body conflicts;
stale approval fails; uncertain commit retries identical intent; missing bank/cost/due
evidence stays unknown. #67 independently reconciles the combined day/month, denied
scopes and recovery; M7 repeats restore/security/release qualification. Report/public
fixtures contain no real PII, raw bank statements, OTPs or credentials.

## Research decisions, cost and verification

- Adopt scoped intent identity and atomic persistence from [AWS Builders' Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).
  Applies to lost responses/repeated approvals; reuse current command receipts and
  exact retries, with storage cost but no extra queue/framework. Owners verify
  duplicates, changed intent and before/after-commit faults.
- Adapt [PostgreSQL 18 isolation](https://www.postgresql.org/docs/18/transaction-iso.html):
  statement snapshots for coherent reports, explicit shared balance locks for
  writes, full-transaction retry where serialization requires it. Our lock-order
  recommendation is an application design inference. Cost is short lock contention;
  defer distributed locks/warehouse. Owners verify real concurrent transactions.
- Adapt [Stripe's immutable credit ledger and cash/credit distinction](https://docs.stripe.com/invoicing/customer/balance):
  separate reductions, actual received money and actual refunds. Use our existing
  source services rather than Stripe's automatic invoice-credit behavior. Cost is
  linked entries; no provider integration. Verify source-to-total examples above.
- Defer statutory document certification: [CBIC invoice rules](https://cbic-gst.gov.in/gst-invoice-rules.html)
  show document-specific requirements. This is not a current-law completeness
  certification; a qualified accountant must review the applicable rules/mapping.
  Cost is one targeted qualified review in #150, no government-filing feature.

No runtime schema, UI, provider, credential or deployment change occurs in #137.
Verification is repository planning/link checks and reproducible arithmetic/tabletop
review. Runtime authorization/concurrency/restore tests remain with the owning
implementation issues. CI cannot approve these business policies.

## Local verification on the proposed document revision

10 October 2026, base `7ff46da`; only this contract, the architecture index link and
engineering workflow continuation section changed. Pinned toolchain, `pnpm
check:planning`, `pnpm check:migrations`, `pnpm test:quality` (35 passed), `pnpm lint`
and `pnpm typecheck` passed. All seven walkthroughs were independently checked with
Node BigInt assertions of the listed paise balances. Unit/API/web stages passed;
`pnpm test` failed at container-backed attachments because the Docker engine was
unavailable. The initial `pnpm db:local quality` failed at container creation and
cleanup; no complete quality/DB/attachment pass is claimed. Full logs are in ignored
`node_modules/.cache/goal/137-*.log`. Build and final-commit CI are recorded in the PR.

Reproduce: use the pinned PATH/PYTHON in QUALITY_CHECKS, run `pnpm check:planning`
and `pnpm check:migrations`, independently trace each named source in the example
tables, then run `pnpm db:local quality` with an available Docker engine. Contract
arithmetic and existing runtime regression checks cannot ratify proposed policy or
qualify the future finance APIs. Required business and independent review remain open.

Product-owner ratification: [issue #137 decision evidence](https://github.com/ShippingCo/ShipIT/issues/137#issuecomment-6094308527), originating human reply on 10 October 2026: D137-1–D137-5 approved as proposed. This approves the policy definitions and permission extensions for their owning implementations. No independent GitHub approving review is claimed. Accountant/software and statement-format qualification stay assigned to #150/#146. Existing runtime grants are unchanged by this documentation commit. Production build also passed locally.

### Reviewed request and actual refund application (#139)

The request (`finance.request`, W53), review (`finance.approve`, W54) and apply
(`finance.apply`, W55) capabilities are separate. Operators and local franchise
admins may request; only an active local franchise admin may review or apply.
Accountant, org-admin and read-only membership do not grant these write actions.
The API rechecks current membership, ownership, policy and financial/payment versions
on each call, including retries. Completed command identities retain their original
outcomes when new writes are disabled; conflicting reuse fails.

Policy revisions have no seeded threshold or self-approval default. Approval requires
the request's explicit current enabled policy; where that policy requires separation,
the requester cannot approve. Changing policy or source invalidates an unapplied
approval. A new legacy direct-change command cannot bypass an enabled request policy.
New workflow writes remain disabled by the service/server default; completing the
remaining workflow, rollout configuration and acceptance gates precedes activation.

Applying a reviewed reduction appends `financial_changes` and an immutable applied
decision together. An enabled-policy effect without its applied decision fails at
commit. Cancellation removes reviewed charge components and leaves actual collected
money as refundable credit; it neither creates a transfer nor undoes delivery proof.
A refund consumes remaining credit without adding/reversing a collection entry.

Actual manual refunds additionally append private `financial_refund_evidence` linked
to the effect/request, actor and current owned source account revision. Evidence
records occurrence time, beneficiary reference and transfer/acknowledgment reference;
it is recorded evidence, not bank/provider verification. Source account, method and
transfer reference identify one recorded outflow within its franchise. Future times,
stale/inactive accounts, foreign IDs and duplicate transfer references are rejected.
The deferred completeness guard rejects refunds lacking this private evidence.
Original booked tax snapshots and payment entries remain intact. Cash custody and
unallocated advance refunds retain their own #145/#142 contracts.

Workflow audit history projects the immutable request, decision, policy and refund
source records in the same committed state. Safe facts contain actor, server time,
reason, source reference, correlation and version; no transfer/beneficiary reference,
account name, key digest or fingerprint appears in the audit projection. Financial
accountant audit grants cover owned request/change facts, not policy configuration or
unrelated administrative history. Owner/admin scope remains explicit.

Request drill-through reconstructs its original components and net collections using
the request's financial version and payment-ledger sequence. The before/proposed
balances therefore remain tied to that observation after later refunds or collections.
Request and decision actor/time lineage is explicit. Detail reads enforce current
financial-read membership/scope and record financial access; they expose no private
refund evidence. The live request status is distinct from the original amount preview.

Correction requests may include at most ten canonical source-document links. Issued
receipt links must resolve within the same organization, franchise and booking;
external invoice/credit-note references are explicitly labelled unverified. Links
append in the original request transaction and cannot be added later, updated or
deleted. The issued receipt snapshot is never rewritten or represented as a qualified
statutory credit note. Accountant/tax document qualification remains with #150.

The financial request DELETE endpoint always denies deletion. For a verified owned
request and a permitted financial reader, the service commits a minimal immutable
denial fact before returning forbidden, so throwing the response does not roll back
the only evidence. Unknown/foreign IDs do not create owned denial facts. Other
permission failures retain the existing safe security-audit hook. Denial recording
works when new financial writes are disabled and grants no charge/payment authority.

A requester can amend their own pending proposal by appending a replacement request;
this never updates the original rows or financial entries. The replacement links back
to the same owned booking/request, refreshes source and policy versions, and starts
pending with fresh immutable document links. The original gains a superseded decision
in that same transaction. Both database guards and a deferred completeness check enforce
this pair. Only one concurrent amendment can succeed. Reviewed/applied/superseded
requests cannot be edited through this path. Exact completed amendment replay returns
the same replacement even while new writes are disabled; different content conflicts.

A limited `GET /api/v1/finance/my-requests/:id` read rechecks `finance.request`
authority and returns only the current actor's original proposal, status/version and
immutable document links. Other actors' and foreign requests return not found. It
records booking financial access, works while new writes are disabled, and exposes
no booking balance, customer directory, other actors' decisions or private transfer
evidence. The financial-reader detail remains separately authorized.

An erroneous refund record is corrected through an approved `refund_correction`
request with reason `incorrect_refund_recording` and `refund_correction_of` linking
the original refund in the same owned booking. Its positive amount cannot exceed
the original refund's uncorrected remainder or current net recorded refunds. The
appended effect reduces recorded refunds and restores eligible held credit; it
records no new transfer or receiving-account evidence. Charge components, original
refund/evidence, tax snapshots, issued documents and payment entries remain intact.
A later actual refund requires its own approval and private outflow evidence.
Payment, sales, ageing and customer payment projections include the signed effect;
request previews retain their original financial/payment prefixes and saved report
snapshots retain their captured totals. These records do not establish bank or
provider verification. Accountant document qualification remains with #150.

The scoped financial audit capture combines financial requests and their recorded
approval/amendment/source-document lineage, earlier manual adjustments, original
quote overrides, direct erroneous-collection reversals, receipt allocation releases
and committed deletion denials. Each row labels its source and monetary basis;
manual legacy approval references remain unqualified, quote tolerances retain their
own policy, and a collection correction is never labelled an actual customer refund.
Private receiving-account names, bank/beneficiary/transfer references, customer
contact details and command fingerprints are excluded from this audit projection.

`POST /api/v1/finance/audit` captures a single franchise under current R11 authority,
with recorded-date range (inclusive Asia/Kolkata calendar days, at most 31), kind,
status, actor and booking filters. The ordered rows, nested lineage and counts are
captured in one SELECT. This applies PostgreSQL's statement snapshot guarantee
([PostgreSQL 18 transaction isolation](https://www.postgresql.org/docs/18/transaction-iso.html));
separate live detail queries would risk different committed states. ShippingCo adapts
that guarantee by retaining the existing private report snapshot for subsequent
100-row pages, row detail and export, rather than adding a reporting worker/store.
Storage and synchronous capture costs remain bounded by the existing 5,000-row,
8-MiB, 20-active-snapshots-per-actor/franchise and 24-hour limits. Control counts are
audit facts; before/proposed amounts across different bases are not additive totals.

`GET /api/v1/finance/audit/:id`, `/rows/:row` and `/export` read the same captured
rows. Every request rechecks current membership/franchise authority and snapshot
ownership/expiry; export separately enforces E03. Capture/read/export access is
recorded. Saved queue statuses are labelled captured; approval/apply commands still
revalidate live policy and source versions. Exact capture retries return the same
snapshot, while changed filters conflict and expired retries require a new capture.
CSV quotes/escapes every cell and neutralizes spreadsheet formula prefixes. It
contains safe source IDs and labelled amounts, not private transfer evidence.

Once a franchise has an explicit financial policy history, disabling that policy
retains approval governance: it cannot reopen direct legacy adjustment writes.
Completed legacy command replay remains available, while new changes still require
a matching approved request under an enabled current policy. The service and the
database's deferred effect-completeness guard enforce this boundary independently.
Booked price overrides retain an explicit owned quote/booking link for booking
filters; an unfiltered quote gets a booking ID only when exactly one linked booking
exists, so reused proposals do not imply an arbitrarily chosen transaction.


`GET /api/v1/finance/bookings/:id/proposal` gives an authorized proposal creator
only the selected booking's current component amounts, financial/payment versions,
financial position and same-booking refund correction targets. The franchise and
booking locks use the write path's order so the amounts and versions agree. The
read works during disabled rollout and records financial access. It exposes no
customer directory, other actors' decisions or private beneficiary/transfer evidence.
A submitted proposal still rechecks source versions and current policy server-side.

The production `/business/financials` workspace uses these scoped APIs. Operators
can submit or amend their own pending proposals and read their own saved status.
Franchise administrators can review the server preview from the original source
versions, approve/reject and apply an approved change. Actual refund application
requires an active source-account revision, permitted return method, actual Kolkata
time and private beneficiary/transfer references; erroneous refund corrections
record no new transfer. Organization administrators and accountants receive the
financial reader/audit view without proposal or decision controls. Source receipt
links retain issued-source qualification; external invoice/credit-note references
remain explicitly unverified. Amendments retain editable source links and require
fresh source versions and approval.

Pending or uncertain commands lock replacement actions, workspace navigation and
franchise selection. Reconciliation reuses the retained path, body and idempotency
key. Decision/application response IDs never replace the selected request ID.
Scope invalidation removes private state and prevents replay under another scope.
Audit captures retain their filter identity, counts, rows, focused captured detail
and matching CSV. Captured statuses are distinct from a subsequently opened live
request. These controls do not activate the server feature flag. Policy configuration
uses the separately approved baseline below.


On 10 October 2026, the product owner authorized the recommended #139 baseline:
no preset monetary threshold and a different administrator approving a submitted
request. Every financial request still needs an administrator decision; this does
not relax quote-price tolerances or infer financial self-approval from sole-admin
cash-close approval. The current configuration API accepts an explicit null discount
review threshold and `allow_self_approval: false`; other values are rejected.

W56 `finance.policy.configure` allows only an active selected-franchise administrator
to read the latest policy and append an immutable revision through
`GET /api/v1/finance/policy` and `POST /api/v1/finance/policy/revisions`. Configuration
requires the current revision number (zero when absent), an explicit enabled state,
`discount_review_threshold_paise: null`, `allow_self_approval: false`, and an
idempotency key. Exact completed retries return their original revision after later
policy changes; different content conflicts. Policy preparation works while workflow
writes are disabled. Changing a policy invalidates requests against older policy
revisions: their creators can amend pending requests; an already approved request
needs a new proposal with fresh source versions. No revision changes an existing
financial effect or grants the requester approval authority.

Rollout requires forward migration 45 and the existing managed runtime role's
SELECT/INSERT access to `financial_policy_revisions`,
`financial_adjustment_requests`, `financial_request_decisions`,
`financial_document_links`, `financial_refund_evidence` and
`financial_deletion_denials`, in addition to the existing payment/report/receiving
account grants. Do not grant UPDATE/DELETE on these immutable evidence tables.
Configure the franchise policy and verify an operator proposal and different-admin
decision in development/staging before enabling `FINANCIAL_WORKFLOW_ENABLED=true`.
The flag defaults to false, accepts only literal true/false, and cannot be enabled
in demo mode. A disabled flag prevents new request, amendment, decision and effect
commands while retaining reads, policy preparation and exact completed-command
replay. A disabled franchise policy prevents new approvals/applications and never
reopens legacy adjustments. Deployment and production policy writes remain separate
authorized actions; no environment flag or production data was changed by this work.


Acceptance verification for #139 uses the real financial services and PostgreSQL
constraints in `apps/api/test/database/financial-workflow.test.ts`. In addition to
paid/unpaid cancellations, partial refunds, immutable correction lineage, scoped
audit capture and policy governance, two distinct approved ₹300 refund requests
against ₹500 credit run concurrently: only one applies and the stale request
conflicts. Injected failures before refund-evidence insertion, applied-decision
insertion and COMMIT leave no partial effect. A lost response after COMMIT is
reconciled through a fresh pool with the retained intent; no second financial
effect, applied decision or private refund evidence appears. Collection entries
remain unchanged.

Browser acceptance used production Financials components and scoped adapters with
explicitly fictional controlled transport. Keyboard submission, excess-charge
validation, uncertain-response navigation locking/exact retry, approval/application,
frozen audit versus live status, and a 375-pixel layout were checked. The datetime
control did not retain an automated fill, so successful browser refund entry and
browser future-time rejection are not qualified by that run; the real database
cases verify refund application and server-authoritative future-time rejection.
The controlled CSV download verifies browser download binding, while real database
audit/export cases verify the production captured schema and privacy.

Fully corrected refund sources remain immutable history but are excluded from new
correction choices. The selected-booking read still works after a correction is
exhausted; another attempt against that original source is rejected server-side.
No new asynchronous consumer subscribes to #139 financial adjustments: readers
capture committed source tables, and safe audit facts derive from those immutable
rows in the same transaction. Existing payment/outbox producers remain responsible
for collection events. This issue initiates no provider transfer or notification.

Reproduce #139 verification with the pinned toolchain and an owned disposable
PostgreSQL database configured as described in [testing](testing-contract.md):

```sh
pnpm --filter @shippingco/api test test/integration/financial-changes.test.ts
pnpm --filter @shippingco/web test src/test/financial-workflow.test.tsx src/test/financial-audit.test.ts
pnpm test:db
pnpm quality
pnpm build
```

The database runner includes the financial workflow service, constraint and populated
upgrade cases. UI tests use fictional controlled responses; they do not qualify a
bank, accountant format or external transfer. In development/staging, configure the
approved policy, load the booking's source amounts as an operator, submit a charge
reduction, then open the reference as a different franchise admin and approve/apply.
Capture the audit before applying and compare its retained status with live evidence.
For actual refunds, cancel a paid fictional charge, approve a partial refund, then
record its source-account revision, actual Kolkata time and private return references.
Disable new writes to stop entry while preserving source reads and exact replay.

Final compatibility verification ran all 79 PostgreSQL schema cases successfully,
including the populated pre-45 financial-history upgrade. Initial PR CI identified
stale latest-schema upgrade-count assertions in 25 older fixtures; their expected
counts were increased exactly for migration 45. Initial-version, no-op, failed
migration/rollback and source-preservation assertions were retained. The full schema
run then passed with zero failed, skipped or cancelled cases.

The subsequent CI run passed all 79 schema cases and identified eight API
populated-upgrade fixtures with the same stale total. Their exact latest-schema
counts were corrected without changing historical-row, old-writer or no-op
assertions. All eight affected API cases then passed against disposable PostgreSQL
with their original case deadlines; no skipped, cancelled or failed cases. This
focused result does not replace the full final-commit CI integration gate.

## #140 expense and cashbook implementation plan

The shop needs an explainable recorded drawer balance, private expense evidence and
acknowledged custody transfers. Reuse receiving-account identities and immutable
receipt/refund sources; keep revenue, customer allocations and actual custody distinct.
No bank API or daily-close workflow is introduced.

Approval rule D140-1 (product-owner approved in this Goal on 10 October 2026): operators and franchise
admins submit expense, opening-float/owner-fund and correction requests; a different
franchise admin approves or rejects, and an admin applies the exact approved proposal.
Corrections retain the original, reason, prior version and linked replacement effects.
An administrator cannot approve their own submitted request. This extends the explicit
#139 review rule to #140; D137-4's labelled sole-admin cash-close exception stays specific
to #145. Transfer acknowledgement is performed by the named active receiving custodian,
not by an initiator setting an approval flag. Existing D137 permissions do not grant
accountants, organization admins, agents or read_only financial mutations.

Implementation:
- Add migration 46 with scoped immutable cash locations, request/decision/effect and
  transfer/acknowledgement sources, bounded exact-intent command results, composite
  ownership constraints and indexed source joins. No historical balance/expense seed.
- A location combines a receiving account with an authorized cash custodian; noncash
  accounts retain account-level recorded funds. New opening float is an explicitly
  additive amount introduced into custody, not a replacement for a historical total.
  Owner funds are external inflows. Cash receipts contribute once; allocating or releasing
  an allocation cannot change that receipt's drawer inflow. Unknown legacy custody is
  displayed separately, never assigned to the current actor or silently treated as zero.
- Approved cash expense is an outflow from its owned location; noncash expense affects
  its noncash source only. Deposit/withdrawal commits equal linked cash/noncash legs,
  preserving owned money and creating no sales/expense. Manual evidence is recorded,
  with bank clearance explicitly unverified. Actual refunds drill through to the owning
  refund source; expense input cannot create a second refund. Custodian attribution for
  new cash refunds is explicit; unresolved old refund custody remains unknown.
- Requested handover retains sender possession and separately reserves its remainder.
  Partial acceptance atomically commits paired legs and leaves the rest outstanding;
  rejection releases the unaccepted remainder. Scoped expected versions, current account
  revisions and receiver membership are checked before effects and exact replay.
- Use short existing PostgreSQL transactions, deterministic lock order, actor-scoped
  idempotency keys/fingerprints and retained outcomes. Preserve exact intent after an
  uncertain response; commit source, audit and effects together. No new asynchronous
  consumer is needed: committed sources and audit remain the authority.
- Add expense-parent attachment authorization while reusing existing storage, scanner,
  size/media limits, upload leases and private grant primitives. Preserve booking/proof
  parent checks and recheck expense authority after storage delays before bytes release.
- Deliver Material 3 cashbook list/detail/filter/export, expense request/approve/correct
  and transfer request/accept/reject flows with keyboard/mobile/error/loading/pending/
  uncertain states. Capture one cutoff for every exposed aggregate and drill-through;
  private payee/bank references are excluded from audit/export. Feature writes default off.
- Append recorded/occurred timestamps and correction/source versions for #145's future
  reviewed-close snapshots and late-evidence reconciliation. No existing closed source is
  edited, and no synthetic daily-close record is created by migration.

Research and complexity: adapt [AWS caller request identity and atomic effects](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
for acknowledgements/lost responses, and [PostgreSQL row locks with consistent ordering](https://www.postgresql.org/docs/18/explicit-locking.html)
for balance capacity. ShippingCo's application is an inference from those practices:
reuse current transaction/command patterns with immutable paired legs and no new queue.
Cost is additive tables/indexes and brief franchise-level money serialization at shop
scale; verify scoped plans and races rather than adding speculative infrastructure.

Verification maps to #140's full live acceptance: ₹1,000 float + ₹4,000 cash receipt −
₹500 cash expense = ₹4,500, UPI expense leaves cash unchanged, allocation release leaves
cash unchanged, ₹2,000 deposit preserves total owned funds, raced/partial/retried
acknowledgements post one receiving side, prior-day correction retains original evidence,
unknown/revoked/sibling/unrelated scope cannot leak source totals or private evidence,
source/capacity/date/amount/version errors preserve balances, and pre/post-COMMIT faults
recover by exact identity. Real PostgreSQL constraints/services/upgrades and browser
keyboard/mobile flows complement pure arithmetic tests. All final-commit CI/review/merge,
issue closure and main/branch cleanup remain required; provider/accountant qualification
is not claimed.

Foundation verification for #140 (not full issue acceptance): seven pure equation/input
cases and five real PostgreSQL location/source-version/service cases passed. The revised
single-query location selector additionally passed a real scoped keyset-pagination case.
Seventeen native compatibility cases passed: six migration/lock recovery cases, two
financial-workflow schema cases, six existing cancellation/refund/audit service cases and
three copied-schema/forward-repair cases. Source assertions preserve old rows and issued
financial evidence. Workspace types, scoped query AST, changed-file lint and exact
R33/R34/W57–W61 matrix assertions passed. Initial failures were diagnosed as an incomplete
test-only direct membership revocation (replaced with the real service), stale explicit
migration inventory/ledger expectations and strict missing-row typing (now asserted).
Migration 46 remains unreleased and will be extended with expense/transfer/evidence
sources before full verification. Expense application, transfer commands, private expense
attachments, cashbook projections/UI, broader native/browser gates and final PR CI/review/
merge are still pending; these foundation results do not close #140.

Request/decision implementation for #140 (still partial): `cashbook_requests` retains
an expense, additive opening float, owner-fund introduction, deposit or withdrawal
proposal with its exact amount, currency, current location revisions, source generation,
responsible employee, private payee/category where applicable, reason and occurred time.
`cashbook_request_decisions` appends one different-admin approval or rejection; both
sources are immutable and server timestamped. Neither submission nor approval creates
money effects, reservations, receipts or a source-generation increment. Application and
corrections remain pending. A deposit must propose cash to noncash, a withdrawal noncash
to cash, and opening float requires cash. These are manual recorded-funds proposals;
no bank settlement is verified.

The request service rechecks current scoped memberships and source/account revisions
under the franchise money lock. Operators submit against their own cash location or a
noncash source and read only their own proposals; authorized finance readers can read
franchise proposals. Private payees remain in the scoped request detail. Approval rejects
stale source generations, deactivated accounts/locations or departed custodians; a
different admin can reject a stale proposal while retaining its original evidence.
Submitting an unchanged new-key proposal is a separate request; actor-scoped exact-key
replay returns the original submission or decision, including after writes are disabled
or a source changes. Current caller authority remains required for replay. New writes
stay disabled by default, and HTTP/configuration/UI integration is pending.

Verification for this request slice: eight unit/input cases passed and twelve native
PostgreSQL cases passed (three request/movement service cases, six migration cases and
three existing location/receipt/populated-upgrade cases). Native evidence covers all
five proposal kinds, different-admin enforcement at both service and database boundaries,
private own-request reads, denied roles and cross-franchise/organization access, stale
sources, paired-source validation, competing decisions, immutable evidence, failed
inserts and recovery from post-COMMIT lost acknowledgement using a fresh pool. Requests
and decisions leave receipt counts and source generations unchanged. A unit timestamp
expectation initially used fixed milliseconds; it was corrected to the existing canonical
`instant` representation after diagnosis. The original failed log remains local. Scoped
query AST, API types and changed-file lint passed. These checks do not qualify money
application, handover acknowledgement, attachment authorization or the cashbook UI.

Atomic movement application for #140 (remaining scope below still pending): an admin
applies the identity of a different-admin approval with request version 2. The apply
body cannot supply an amount, location or approval flag. Immutable `cashbook_effects`
and `cashbook_effect_legs` bind the exact request and decision; a deferred completeness
check rejects missing legs, and leg guards reject incorrect amounts, locations and
insertion outside the owning transaction. One source generation increment is committed
with the complete effect. Current source revisions/generation, eligible custodians and
capacity are rechecked under the franchise money lock. An unchanged completed-key replay
returns the original complete effect after writes are disabled, without another generation
increment. Request detail now shows applied version 3 and immutable effect legs.

`cashbook_source_facts` projects one actual money receipt independently of booking
allocation/release, explicit noncash refund accounts, unknown old cash refund custody,
unknown legacy collection/correction sources and committed movement legs. Legacy payment
entries linked to a receipt are excluded from the legacy union and its source-version
hook. New unlinked legacy collection/correction writes increment source generation;
historical migration creates no generation seed. Legacy recording corrections are labelled
as such, not described as verified new transfers. The owning refund workflow now accepts
an explicit cash-location/current-revision pair, bound to the original source account and
an eligible current custodian. Cashbook-enabled new cash refunds require that pair; the
actor is never inferred as custodian. The additive nullable fields preserve existing
refund evidence as unknown custody, and immutable guards prohibit later attribution.
Refund corrections retain the original location/account. Relevant unresolved unknown
refund amounts block spending; complete approved record annulment releases that block
while both source facts remain visible. Unknown legacy collections never add guessed
location capacity. HTTP/configuration wiring of the cashbook flag is still pending.

The scoped position query captures location control totals, unknown source count and source
generation at one statement MVCC cutoff. All amounts use exact numeric/BigInt arithmetic;
gross turnover is returned as decimal strings. `known_recorded_paise` explicitly describes
the attributed portion. Unknown sources mark an incomplete position, negative recorded
amounts mark an exception, and neither represents a qualified actual cash count or bank
settlement. Only finance readers receive this projection; operator selection still grants
minimum location choices and their own submitted proposal/decision/effect evidence.
Full cashbook fact drill-through, filters, captured exports, corrections, custody transfers,
expense attachments, HTTP/configuration wiring and Material 3 UI are still pending.

Application verification for this slice: both native PostgreSQL application cases passed
with their original 30-second case deadlines. The real-source journey establishes
₹1,000 opening float + ₹4,000 actual received cash − ₹500 expense = ₹4,500, unchanged cash
for a UPI expense, unchanged receipt inflow after booking allocation/release, and conserved
owned funds through ₹2,000 deposit and a withdrawal. The race/fault case establishes
rollback of failed or incomplete/forged legs and their generation increment, one exact
same-key concurrent outcome, stale-source/capacity denial, immutable effects and fresh-pool
recovery after lost post-COMMIT acknowledgement. Nine unit/input cases, scoped query AST,
changed-file lint and all five workspace type checks passed. Two initial native failures
were diagnosed and retained locally: the deferred completeness CASE expression needed
parentheses, and the runtime scope compiler requires a SELECT root (the capture now uses
the existing SELECT-LATERAL pattern). A lint-only fixture binding was corrected to const,
and the UPI fixture retains the existing receipt API receiver/custodian contract. No
production privacy/isolation rules, assertions or test deadlines were weakened.

Seventeen native compatibility cases passed on this application/source implementation:
six fresh/upgrade/advisory-lock migration cases, two financial-workflow schema cases,
six existing cancellation/refund/audit/policy service cases and three copied-schema
forward-repair cases. The extended populated pre-140 upgrade case also passed: all old
collection evidence is preserved, all seven new cashbook source tables are empty after
upgrade, the old collection appears as unknown account/custody, and a new legacy recording
correction advances generation once while both source facts remain unassigned. There
were no skipped, cancelled or failed cases in these completed runs. This evidence remains
partial #140 acceptance; recording corrections, handovers,
private expense attachments, captured cashbook journeys and final PR gates remain pending.


Cash-refund custody verification for #140: ten unit/input cases, all five workspace type
checks, changed-file lint and the tenant-query AST gate passed. All six existing native
financial workflow cases passed after extending the actual paid-refund journey: explicit
cash custody differs from the applying admin, missing/unknown/stale locations are denied,
corrections retain original custody, unknown refunds block spending until fully annulled,
and a UPI refund affects the recorded noncash account while cash stays unchanged. These
are real PostgreSQL application services, not qualification of a bank transfer provider.

A separate populated migration-45 refund upgrade passed on native PostgreSQL. The test
uses the released writer's actual old column list and caller-intent digest before applying
migration 46. Every old evidence field and all financial/payment/booking rows remain
unchanged, new custody fields are null, and all seven new cashbook tables remain empty.
The old apply key returns the exact retained outcome with financial writes disabled and
new cashbook enforcement enabled; changed intent is rejected and no source generation is
fabricated. The initial policy fixture omitted its two required approved-policy fields;
that diagnosed failure log is retained, and the fixture was corrected without changing
production rules, assertions or the original 60-second deadline. All seven final native
cases completed with zero failures, skips, cancellations or todos. Expense/fund/movement
record corrections, handovers, attachments, full cashbook journeys and final PR gates
remain pending; this slice does not close #140.


The extended paid-refund native case also verifies the independent database boundary:
a synthetic writer corrupts the custody revision after service validation. PostgreSQL
rejects it, and the previously appended financial change, source-generation increment and
refund evidence all roll back. The unchanged approved request then succeeds normally.
The original 60-second case deadline, API types and changed-file lint passed.


Linked recording corrections for #140 now reuse the same request, different-admin
approval and exact-approval apply path. A correction names an applied request's current
chain head through an owned `correction_of` reference. Movement kind, original source and
target identity and original occurrence time stay fixed; safe replacement metadata and
the corrected total amount live in a new immutable request. Requests with no correction
reference still require positive paise. A zero replacement annuls the prior recorded
meaning, while an unchanged amount with corrected metadata produces no money legs.
Both retain the complete approval/effect evidence and advance the source generation once.

Application posts only the difference from the previous applied amount. Expense increases
produce an outflow difference; reductions produce an inflow correction. Opening/owner fund
corrections reverse that sign, and deposit/withdrawal corrections produce two equal and
opposite legs. These are corrections of recorded meaning, not verified new transfers or
sales. SQL computes the same intended legs for capacity bounds, direct-leg intent and
deferred completeness. Missing, incorrect or incomplete legs roll back the whole effect
and generation increment. Original requests, approvals and legs cannot be rewritten.

Current actor/scope, chain head, source generation and current location revision remain
required. Operators can correct their own applied proposals using their permitted custody
choices; current franchise admins can submit historical corrections after an account or
custodian becomes inactive. Historical corrections do not require claiming new receipt by
that former custodian, and new actual movements still require active accounts/custodians.
The responsible employee on the new correction must be eligible now. A different current
admin reviews the exact correction, including when another admin submitted it. Exact-key
completed retries preserve their prior outcome with writes disabled, but still require the
caller's current authority. Competing corrections cannot create two applied successors.

A truthful correction may expose a negative recorded balance; it is labelled an exception
with zero available money. Both positive and negative totals must remain within the exact
safe paise bound. Original occurrence time and the new server-recorded time remain visible
for later cutoff/close evidence. #145 owns actual daily-close approval and reopening;
these tests do not fabricate an already reviewed close or qualify that future workflow.


Correction verification: eleven unit/input cases passed. Thirty-one native PostgreSQL
cases passed across the complete cashbook service set (nine cases), one additional signed-
bound/paired-completeness case, all four cashbook source/fresh/populated-upgrade cases and
seventeen existing finance/migration/copied-schema compatibility cases. The three new
correction journeys cover retained prior-day requests/legs, exact ₹500-to-₹700 differences,
metadata-only zero-leg effects, full annulment and successive replacement, inactive-account/
departed-custodian admin recovery, all five original movement kinds, paired owned-money
conservation, unknown/unapplied/changed/stale targets, operator ownership, sibling/unrelated
scope denial, self-approval denial, direct SQL forgeries, competing applied successors,
failed/missing/incomplete/wrong legs, both signed safe-money bounds, source-generation
rollback, fresh-pool recovery after lost COMMIT acknowledgement and current-role denial on
replay. Completed native runs had zero failures, skips, cancellations or todos with their
original 30/60-second case deadlines; disposable clusters were stopped and cleaned.

All five workspace type checks, final API fixture types, changed-file lint, tenant-query
AST, the exact 99-row authorization contract and diff checks passed. Initial static errors
were diagnosed as using a field outside the existing validation-field union and missing
assertions on the fixture's two known race keys; the safe existing `$` validation field
and non-null fixture index assertions corrected them without changing runtime assertions.
This is service/schema acceptance for corrections, not full #140 completion. Transfer
acknowledgements/reservations, expense attachments, captured query/export journeys,
HTTP/configuration wiring, Material 3 UI and final PR gates remain pending.


Acknowledged handovers for #140 now use immutable `cash_handovers`,
`cash_handover_commands` and `cash_handover_legs`, extending unreleased migration 46
without historical seeds. A request reserves its amount while the sender retains recorded
possession. The named active target custodian accepts a positive portion or rejects the
remaining portion; an initiator cannot supply an acceptance flag or act as a different
recipient. Each accepted command has one identity and two exact opposing custody legs,
with deferred completeness and owning-transaction guards. Rejection/cancellation produces
no actual money legs and releases only the unaccepted remainder. Current own sender or
franchise admin can append cancellation after source deactivation or custodian departure,
while all accepted history stays immutable. This custody acknowledgement is distinct from
the different-admin expense/fund/correction approval path under D140-1.

Requests and responses check current scoped roles, location/account revisions, eligible
custodians, source generation and expected handover version under the same short franchise
money lock. Every request/response advances the generation once; exact actor/key/intent
replay returns the original immutable outcome before disabled-write and changed-source
checks, while still requiring current command authority. A later partial acceptance cannot
rewrite an earlier command's retained amount/remainder or legs. Accepted fact occurrence
uses the server-recorded acknowledgement time, not an earlier requested date; the request's
own original occurrence remains separately visible. No bank transfer provider is invoked.

The same-cutoff location projection now reports pending reservations and shortfall
separately from known recorded possession. New expense/deposit/withdrawal checks subtract
reserved custody at both service and SQL boundaries. An acknowledgement excludes its own
reservation when checking capacity, still protects other reservations and blocks unresolved
unknown refund custody. A truthful prior-source correction may reveal a shortage; available
money becomes zero and acceptance/spending stops. Shortfall is an exact derived decimal
quantity and can exceed the safe bound of an individual stored money amount; actual signed
recorded balances and requested/accepted amounts keep their existing bounds.

Purpose-limited target choices expose only active location identity/revision, staff label
and custodian identity. They require an authorized source and reveal neither other balances
nor receiving-account configuration. Operator inbox/detail/history includes only their own
initiated/source/target handovers; finance roles retain their scoped reads. Lists use bounded
UUID keyset pages, and command history uses at most 100 rows with an explicit version cursor
and one batched leg query. Source generations and current totals share the held read cutoff.
An operator's participating handover evidence does not confer franchise-ledger access.

Verification: twelve unit/input cases passed. Thirty-four distinct native PostgreSQL cases
passed: thirteen cashbook service cases, four fresh/source/populated-upgrade cases and
seventeen existing finance/migration/copied-schema cases. The strengthened reservation
case was additionally retested with complete, otherwise valid expense legs to prove the
independent SQL capacity denial, plus denied direct/request over-reservation. Final selector/
inbox and both-custodian-departure admin recovery changes were verified by rerunning the
two affected native cases. Native evidence covers partial acceptance, rejection, one paired
receiving side under same/distinct-key races, failed/omitted/incorrect legs and rollback of
reservations/generation, fresh-pool recovery after lost request/ack COMMIT responses, current-
role replay denial, stale/inactive sources, scope/role denial, 101 acknowledgements across
bounded history pages, safe recipient fields, immutable accepted evidence and shortage
recovery. The actual refund fixture also confirms that an unresolved old cash refund blocks
a new handover without creating a request or generation increment. All final completed runs
had zero failures, skips, cancellations or todos under the original case deadlines, and
disposable clusters were stopped and cleaned. Populated upgrades preserve old evidence and
leave all ten new cashbook tables empty, including handovers.

All five workspace type checks, final changed-file lint, tenant-query AST, exact 99-row
permission contract and diff checks passed. Initial failures remain in local logs: a missing
reservation projection field, PostgreSQL 42803 from the ungrouped correlated scope columns,
strict pagination-query selection and two malformed fixture/source-body paths. The missing
field/group columns and explicit query allowlist were fixed, and the fixture paths were
corrected without weakening constraints, assertions, privacy rules or deadlines. Handover
services now satisfy their scoped custody/retry contract; full #140 acceptance still needs
captured cashbook source/filter/export journeys, private expense attachments, HTTP/strict
feature-flag integration, Material 3 UI/browser qualification and final PR CI/review/merge.

## #140 request inbox acceptance slice

The live request inbox now supports bounded UUID keyset pages (1–100 items) and
strict movement, category, approval/application state, source custody, responsible
employee and half-open occurrence-time filters. Operators see only their own
submitted requests; current finance readers see their permitted franchise. Applied
correction links retain the original request and expose metadata-only corrections
that have no money legs. Payee/reason text, account metadata, keys and fingerprints
remain absent from list rows. Scoped detail retains private request evidence.

One SQL statement captures each page's status, correction head, source generation
and timestamp. This is a live inbox, not a frozen monetary report or export. Existing
membership transactions already hold the organization authority lock across detail
reads, so decisions and effects form a consistent prefix. No extra read lock was
needed. A native regression pauses a real detail read and observes PostgreSQL's
concurrent approval lock wait before releasing it and checking before/after prefixes.

Focused native cashbook compatibility passed 14 cases; final inbox and authority-lock
cases passed two cases (one repeated inbox plus one additional distinct regression),
with original 30-second case deadlines and no failures/skips/cancellations/todos.
All disposable clusters were stopped and removed. Workspace types, changed lint,
tenant-query AST, exact 99-row permission contract and diff checks passed; final
fixture/API types and query checks passed after the lock-test correction. Evidence
is in ignored local 140-request-inbox-* and 140-request-detail-lock-native.log logs.
The first lock regression waited at the wrong boundary (franchise after the already
exclusive organization lock) and hit the existing timeout; its full failed log is
retained as 140-request-detail-lock-wrong-boundary-failure.log. The test now observes
the actual authority boundary and the redundant proposed lock was removed. Assertions
and deadlines were retained. The matrix validator's initial Windows decoding error
was corrected by its established PYTHONUTF8 environment setting. Full #140 source
reports, attachments, HTTP/UI and final delivery acceptance remain pending.
## #140 captured cashbook sources

Cashbook source capture reuses report snapshots, their per-actor retained keys,
24-hour lifetime, 20-live-snapshot quota, 5,000-row/8-MiB bounds, access audit and
current read/export authority. New capture needs no table, job or provider. Each
captured row has a kind/source/location identity so the two custody legs of an
accepted handover or bank movement remain distinct while sharing the owning source.
Capture, read, pagination, drill-through and export are private to the capturing
principal and current permitted franchise. Finance readers can capture/read;
exports retain the existing franchise-admin/accountant gate. Operators retain the
separate own-request/participating-handover inbox, without a ledger report grant.

Rows filter by Kolkata occurrence-day range (maximum 31 days), source kind and
owned location, with deterministic occurrence/source ordering. Independently
aggregated selected-row controls distinguish known and unassigned inflows/outflows.
The complete current custody position and pending reservations are captured at the
same statement cutoff; they are explicitly current positions, not balances for a
filtered date/category cohort. Rows, controls and complete positions are read from
the canonical source view in one SQL statement. Amounts/control totals remain exact
decimal paise strings. CSV repeats the retained cutoff, generation, selected-source
controls and each row's current recorded/reserved/available/shortfall state; private
payees, reasons, customer details and bank/transfer references are absent. Opaque
owned source/account IDs support authorized drill-through. Empty captures keep their
metadata and zero controls. A zero-leg recording correction remains in the request
history without inventing a monetary source row.

This adapts PostgreSQL 18's documented statement snapshot behavior under Read
Committed: successive statements can see different committed data, while one read
statement sees a consistent committed snapshot. Source:
https://www.postgresql.org/docs/18/transaction-iso.html (verified 10 October 2026).
The ShippingCo choice is to retain that single capture through the existing bounded
report service rather than change the application's isolation level. Its cost is
one scoped aggregation plus the existing snapshot/audit storage, with no speculative
queue or reconciliation service. Native checks compare independently aggregated
controls with source rows and the existing position API, then change sources and
confirm the old capture and CSV remain byte-for-byte stable. Recorded positions do
not qualify bank clearance, physical cash count or #145's reviewed daily close.
Captured-source acceptance evidence: final four affected native cases passed in
140-source-report-final-native.log with original 30/60-second case deadlines and
zero failures/skips/cancellations/todos. Actual receipt allocation/release remains
one inflow; ₹1,000 float + ₹4,000 cash − ₹500 expense reconciles, UPI stays in its
noncash source, and paired deposits/withdrawals conserve ₹4,700 total recorded funds.
Independent report controls equal the sum of all nine retained source rows. The
existing 101-ack journey now checks all frozen pages without omission/duplication
and an identical export row count. Partial acknowledgement exposes reserved remainder,
filtered transfer legs reconcile separately from complete current custody, and
source changes leave the earlier snapshot/CSV unchanged. Pre-audit failure rolls
back capture; lost COMMIT acknowledgement recovers the exact retained capture from
a fresh pool. Role/foreign-scope/foreign-principal/revocation/export denials and
legacy collection's unknown account/custody remain real PostgreSQL evidence. Expiry
rejects reads/retries and later capture removes expired payload while retaining the
original key tombstone. All disposable clusters were stopped and removed.

All five workspace types, changed lint, tenant-query AST, exact permission contract
and diff checks passed. Logs remain in ignored 140-source-report-* files. Earlier
two-case runs cover the same cases and are not counted again. An inferred non-null
pagination cursor fixture variable was explicitly typed number|null; the initial
failed type logs are retained as *-types-offset-failure.log. Unnecessary escaping
in the CSV assertion was removed without changing its expected string or behavior.
The shared current-position mapping was extracted without changing its calculation.
No schema or released migration changed in this slice. Full #140 HTTP/UI, attachment,
explicit expense-method and final delivery acceptance remain pending.
## #140 explicit expense payment methods

Every expense proposal now records cash, UPI, card, bank transfer or the receiving
account's configured other method. The chosen method is immutable proposal evidence;
review/apply never accepts a caller-supplied substitute. Cash requires a cash custody
location and noncash methods require a noncash location. The chosen method must be
allowed by that location's recorded account revision. Current account/revision checks
still reject a new expense or approval when the account changes. Location selectors
return the recorded method choices without exposing balances. Non-expense requests
keep their previous normalized intent shape and have no invented expense method.

A linked recording correction can retain its predecessor's recorded method even
after the current account drops it. A changed method must be permitted by the current
recorded revision and remain consistent with the unchanged custody location. This
changes recorded meaning under different-admin approval; it does not create an actual
transfer. A metadata-only correction has no money leg and remains visible in request
history. Original money source rows retain the method recorded at their own occurrence;
zero-leg annotations do not rebucket historical physical money. A new expense cannot
use this correction exception. The migration is still the same unreleased #140 forward
migration; no historical expense exists in released migration 45 to populate or infer.

Request lists can filter by explicit method. Captured source rows and CSV expose the
original recorded receipt/refund/payment/expense method, and acknowledged handover legs
are cash. A fund/deposit/withdrawal source without a separately recorded expense method
is labelled not_recorded rather than guessed. Method filtering changes selected-source
controls; complete current custody remains separately labelled and shares the cutoff.
Legacy payment method can be known while its account/custody remains unknown. Private
payee, reason and bank reference exclusions are unchanged. These extend the approved
immutable-approval, idempotency and one-statement report practices already researched
for #140; they add no provider, queue, new table or paid dependency.
Explicit-method acceptance evidence: 39 distinct scoped native cases passed on this
slice: complete cashbook API file18 (140-expense-method-cashbook-compatibility.log),
source/populated-upgrade4 (140-expense-method-source-upgrades.log), and existing
finance/migration/copied-repair17 (140-expense-method-finance-migration-compatibility.log).
Original 30/60-second cases and 300-second file deadlines were retained; zero failures,
skips, cancellations or todos; all clusters/data/leases were cleaned. Focused method/
movement2 passed earlier and cover the same cases, so are not counted again.
Mixed UPI/card choices remain distinct approved evidence; forged/missing/unsupported
methods fail API and real SQL; stale account review fails; original-method exact retries
survive writes disabled and changed account methods. Same-method historical annotation
and an allowed changed-method annotation each retain the original and apply zero money
legs. Current list/source filters, frozen CSV evidence and recorded/cash-control totals
agree. Released45 populated collections/refunds and exact old apply fingerprints remain
unchanged, with no invented custody or expense backfill.

Unit12, all five workspace types, changed lint, tenant-query AST, exact99-row permission
contract and diff checks passed (ignored 140-expense-method-* logs). No failed native or
static check occurred in this slice. Expense DTOs now require an explicit method at the
runtime expense boundary; the new feature has not yet been wired into HTTP or enabled.
Private attachment parent/snapshot authorization, API/UI journeys, broader final gates
and reviewed PR delivery remain required for full #140 completion.

### #140 reviewed expense attachment foundation

Unreleased migration46 extends the existing private attachment metadata, commands
and audit tables with an explicit expense-request parent. Every row has exactly
one booking or expense parent and an owned composite foreign key. Expense evidence
is restricted to an expense proposal (including its linked correction), with no
parcel parent or inherited delivery-agent access. Released migrations remain unchanged.
Booking DTOs, grant payloads, retained command fingerprints and purpose rules remain
unchanged. Existing ready attachment immutability and cleanup discovery are reused.

Expense metadata writes require a current local franchise admin or the current
operator who submitted the proposal. Worker updates remain restricted to cleaning
non-ready evidence. The expense parent lock enforces the existing 8 MiB file,
10 item, 32 MiB aggregate and three pending limits per exact expense, alongside the
existing media, integrity and lifecycle constraints. Approval and upload share the
franchise/request lock order; an upload racing review cannot be added after approval.
Approval rejects pending or quarantined evidence and generates an immutable sorted
snapshot of ready file IDs, versions and SHA-256 digests. Callers cannot supply this
snapshot. Ready evidence cannot change after review; rejected unsettled evidence
can still be canceled or cleaned. Later evidence belongs to a new correction request.
This is ShippingCo's implementation of D140-1's exact approved-request contract,
using the existing short-transaction and idempotency practices researched above.

Cashbook decision DTOs include the snapshot only when it contains evidence, retaining
existing empty-evidence response shapes. The approval service independently rejects
unsettled evidence before the SQL guard. Its runtime identity needs scoped internal
SELECT access to attachment metadata; deployment grants and the private expense
read/download service remain part of the outstanding HTTP integration work.

The native metadata fixture verifies unsettled and forged approvals, exact retained
snapshots, wrong/non-expense parents, other-operator denial, reviewed immutability,
expense audit ownership, competing pending quota reservations, upload/review races
and cleanup after rejection. These SQL metadata fixtures are not scanner or object
store qualification. Populated migration45 evidence includes a ready booking file,
retained grant command and all original audits: every original field remains equal
after migration46 and no expense/custody backfill is created. Actual upload/scanning,
private download grants with post-provider authority checks, expense routes and UI,
and final full-issue acceptance/delivery remain outstanding.


Foundation static verification passed: all five workspace typechecks, repository lint
including the tenant-query AST gate, migration history (all 45 released files
unchanged), and diff checks. The first metadata fixture failed because its actor
parameter was used as both UUID and text without the existing explicit casts;
strict TypeScript also required asserting count-row presence. These fixture errors
were corrected without changing the assertions or deadlines; original failure logs
remain in ignored `140-expense-attachment-fixture-*` files. The package-local lint
command does not exist; the required root lint command passed instead.

Native foundation verification passed 39 distinct cases: cashbook services19
(16 in `140-expense-attachment-cashbook-compatibility.log`, three handovers in
`140-expense-attachment-handover-compatibility.log`), schema/populated upgrades4
(`140-expense-attachment-populated-upgrades.log`), and existing booking attachments16
(`140-expense-attachment-booking-boundaries.log`). Earlier focused metadata and booking
lifecycle passes cover the same cases and are not counted twice. Original case/file
deadlines remained unchanged; final scoped runs had zero failures, skips, cancellations
or todos, and all disposable clusters/data/leases were cleaned. This verifies the
schema foundation and existing synthetic-provider booking paths, not live expense
storage/scanner qualification or full #140 delivery.


### #140 private expense attachment service

A server-selected expense factory now reuses the existing upload lease, bounded
stream, MIME/digest validation, scanning, immutable command replay and signed-byte
lifecycle. Expense DTOs expose an expense-request ID with a fixed expense purpose;
they cannot carry a booking or parcel parent. The booking factory retains its
original DTOs, canonical intent fingerprints and seven-field signed-grant payload.
An expense parent is domain-separated as `expense:<request UUID>` in fingerprints
and signed grants, so an otherwise valid booking-domain token cannot release its bytes.

The expense factory issues the existing W58 cashbook.request capability for writes
and R33 cashbook.select capability for scoped evidence reads/downloads, using the
existing current-membership transaction. Finance roles read scoped expenses, while
an operator must be the immutable submitting requester. Dispatcher, delivery-agent,
read-only and unrelated/sibling owners gain no access. Every private lookup proves
an owned expense proposal before looking up its attachment. A held franchise lock
serializes review and evidence changes; the immutable proposal itself requires no
UPDATE privilege. Upload and finalization require an undecided proposal and enabled
new writes. Exact command retries are checked before the new-write gate, preserving
retained outcomes after review or disabled writes while rechecking live authority.
Rejected unsettled evidence can still be canceled and cleaned. No permission-matrix
row or production provider configuration is broadened.

Downloaded bytes remain bounded and digest-checked, and authority is rechecked after
provider delay before release. Grant commands retain the exact expense parent in
private metadata and audit events. The existing cleanup worker handles rejected or
orphaned expense evidence; ready files remain immutable. At this service-only slice the new service was not yet registered in HTTP and its
factory defaulted to writes disabled. The subsequent HTTP integration/rollout section
below supersedes that status; expense UI and full issue acceptance remain required.

Three native service cases verify actual PNG bytes through synthetic storage/scanner
adapters, role/private-parent denials, immutable approval snapshots, disabled/reviewed
exact retries, uncertain provider writes, the final-ready lost-COMMIT outcome and
fresh-pool recovery, parent-domain/session grant isolation, membership revocation
during download and scanning, scanner error/infection and rejected-evidence cleanup.
This establishes application/SQL integration with controlled adapters, not live S3
or antivirus qualification. The initial service failure exposed an unnecessary
FOR UPDATE on immutable proposals: native SQL confirms runtime lacks that privilege
(42501); the existing franchise lock supplies serialization without broadening grants.
The initial COMMIT fault targeted the preparatory transaction, not final ready commit;
the corrected fixture follows the existing booking test by interrupting the second
commit. Original failed logs are retained in ignored service-lock/fault-phase logs.
The tenant-query gate initially rejected identifier-only action allowlists; explicit
closed allowlists fixed that without changing the gate.


Service verification: 19 distinct native cases passed (expense lifecycle3 in
`140-expense-attachment-service-native.log`, existing booking lifecycle16 in
`140-expense-attachment-lifecycle-booking-compatibility.log`). The first expense
case was then strengthened and passed again in `140-expense-attachment-service-parent-boundaries.log`
with an authorized sibling-franchise reader and a non-expense fund proposal; that
repeat is not counted twice. Original deadlines were retained, all final runs have
zero failed/skipped/canceled/todo cases, and all disposable clusters/data/leases
were cleaned. Stream/scanner/grant and tenant-capability unit checks17 passed in
`140-expense-attachment-service-unit.log`. All five workspace types, final API types,
root lint/query AST and diff checks passed in service-final logs. No HTTP route,
browser journey or live expense provider qualification is claimed by this slice.


### #140 HTTP integration and rollout

The authenticated server now registers the complete cashbook location, proposal,
review/application, position, custody and retained-source endpoint families described
in the API contract. It also reuses the existing seven private attachment routes
with a server-selected expense-request parent when storage/scanner dependencies exist.
Current membership, owning parent proof, browser CSRF/origin and idempotency checks
remain in force. Every cashbook response is no-store. Exact numeric JSON validation
now includes this financial namespace, and the binary media exception names only
its PUT upload-content path alongside the existing booking path.

CASHBOOK_ENABLED defaults false, accepts only literal true/false and cannot be enabled
in demo. New mutations are disabled without it; reads, authorized financial snapshot
capture and exact completed-command recovery remain available. The owning financial
workflow receives the cashbook flag independently of FINANCIAL_WORKFLOW_ENABLED so
new refund evidence uses explicit approved custody when cashbook writes are enabled;
legacy NULL custody and retained original fingerprints are not backfilled or rewritten.
No production configuration or data has been changed.

Development/staging rollout requires migration46 and existing money receipt, receiving
account, membership, report-snapshot and audit grants. Grant SELECT/INSERT to the managed
API runtime on cash_locations, cash_location_revisions, cashbook_requests,
cashbook_request_decisions, cashbook_effects, cashbook_effect_legs, cash_handovers,
cash_handover_commands and cash_handover_legs. Grant SELECT only on
cashbook_source_versions, cashbook_source_facts and cash_handover_positions. Preserve
existing narrow franchise locking grants; do not grant UPDATE/DELETE on the immutable
cashbook evidence tables or direct source-version writes. Expense approval also needs
SELECT on attachments. Uploads use the existing attachment SELECT/INSERT and exact
lifecycle/lease/audit-actor UPDATE column grants; do not permit changing their parent,
identity or ready evidence. Existing cleanup discovery EXECUTE grants stay unchanged.
Enable the flag only after a different-admin proposal/apply and custody acknowledgement
have been verified against the actual staged schema, then verify the same retained
command with the flag disabled. Production activation remains separately authorized.

Native HTTP acceptance passed a real float/expense/scanned-byte review/application,
partial paired custody acknowledgement/cancellation and retained-source CSV chain.
A separate native case proves disabled new intent versus exact old replay, CSRF denial,
fractional/duplicate JSON and unsupported binary rejection, anonymous/finance-write
denial and revoked replay. Controlled storage/scanner adapters are labelled synthetic.
Five native booking attachment cases preserve upload/list/content/grant/cancel,
current role/assignment and real sibling-owner boundary behavior with shared routes.
These seven distinct native cases passed in cashbook-http-final-native and
cashbook-http-booking-compatibility logs, with original deadlines, zero bad statuses
and all disposable clusters/data/leases cleaned. Earlier focused runs are the same
cases and are not counted twice. Config/HTTP parser/attachment unit checks88 passed;
all five workspace types, root lint/query AST, 25 query-gate cases and diff checks passed.

Failures were diagnosed and retained: the initial expense PUT hit the old booking-only
binary media check; the exact new route was added. The malformed fractional fixture
expected 400 but the established field-validation contract is 422; rejection stayed
intact. An omitted optional webhook field in the server test fixture was supplied.
The new route was added to the existing Fastify request.query data exception; its
negative extraction test exposed an overbroad prior exception, now narrowed to direct
data arguments. Raw method calls/extraction remain denied, including the new route,
and maintained source checks still pass. No query compiler, assertion or deadline
was weakened. Full UI/browser, remaining direct SQL/lifecycle acceptance and final
full-issue quality/CI/review/merge remain outstanding.


#### Expense and custody web workflows

The production `/business/cashbook` route uses scoped API adapters; its request
and custody workflows are separate views. Operators and franchise admins select
actual permitted locations and current responsible employees, record explicit
expense methods or compatible cash/noncash fund movements, and submit immutable
requests. Current franchise admins can review another user's request and apply
its exact approved decision. Finance readers have no mutation forms. Saved detail
shows private payee/reason only through the scoped request endpoint; list responses
exclude these fields. Corrections retain the original occurrence and location
identity, accept zero annulment, and preserve every paise in editable amounts.

The custody view uses the current permitted target directory and captured source
versions. The named current receiver can accept an actual partial amount or reject
the remaining reservation; the current sender or franchise admin can cancel the
remainder. Historical acknowledgement pages show recorded amounts and reasons.
Server checks remain authoritative for current membership, revisions, capacity,
reservations and receiver identity. No operator balance is inferred or exposed.

One command lifecycle covers both views. Pending/uncertain commands disable edits,
view changes, links and franchise navigation; replay retains the original path,
body and idempotency key. Scope invalidation unmounts private state. Selection of
a different request immediately hides the preceding detail/actions. Explicit
selector labels support keyboard and assistive technology. Response projections
reject inconsistent request/decision/effect links, self approval, monetary control
totals, handover conservation and paired acceptance legs; they discard unknown
private fields. Captured report and location-configuration views are implemented below; private
expense attachment UI is still outstanding. Component evidence does not establish
native browser or live-provider qualification.

Ten focused web checks cover protocol integrity, lost response and same-key replay,
blocked navigation, current scope revocation, another-admin review/application,
partial custody acknowledgement, read-only finance roles, and exact correction
inputs/zero annulment through actual adapters with controlled fictional transport.
This is component/transport evidence, not native browser or live-provider evidence.
The first uncertain-expense case identified a selector accessible-name failure;
explicit aria labels fixed it, with the failed log retained. Existing messaging and
demo regression tests emit React act warnings; these are recorded separately from
cashbook outcomes. Full issue SQL/lifecycle acceptance, remaining UI, browser checks,
quality/CI/review and merge remain required before #140 can close.

The final web slice passes 228 tests across 21 files, web typecheck, production web
build, root lint/query AST and whitespace checks. Logs are retained locally under
`140-cashbook-web-{focused-final,regression-final,final-types,build,final-lint}`.
The ten cashbook checks are included in the 228, not additional cases. Native browser qualification still needs explicit acceptance. The recovery detail
contract below removes dependency on the currently loaded location choices; the
location list itself retains inactive rows. Do not infer full recovery acceptance
from the partial acknowledgement fixture.


#### Captured sources, configuration and custody recovery UI

Finance readers can capture sources filtered by Kolkata occurrence days, payment
method, source kind and location; open a saved snapshot; page its original rows;
read composite source detail; and inspect its filtered controls alongside complete
current recorded positions at the same cutoff. The two sets of controls are
explicitly labelled. Unknown custody and shortfalls remain visible. Receipt
allocations do not become new receipt rows. Amounts use exact decimal paise for
aggregate display. Franchise admins and accountants can download the matching
CSV; org admins read without export and operators have no captured finance view.

The browser retains identical snapshot metadata across pages, detail and export.
A response changing the saved cutoff or controls fails instead of mixing evidence.
Download reads are aborted on unmount/current scope loss and check the scope again
before creating a local blob. The lifetime works with the application's existing
React StrictMode effect cleanup. Capture uses the shared command lifecycle and
keeps its exact identity after an uncertain response. The client default order
matches the server's `occurred_desc` when optional filters are omitted.

Franchise admins configure actual receiving-account/custodian locations, using
current account versions and the selected location version. Existing account and
custodian identity is fixed; new revisions rename, deactivate, reactivate or
refresh the recorded account revision. Inactive locations can be opened by their
reference. Actual account and employee selectors are paged, with loading/failure
states and no fabricated defaults. Receiving accounts remain configured through
the existing Money receipts workflow.

Expense/fund inbox filters now include status, kind, category, method, source
location, responsible employee and occurrence range. Kolkata input becomes an
inclusive start and explicitly exclusive end in UTC. Detail shows category,
responsible employee and source/target references without placing private payees
in list responses. Finance readers also see permitted custody history without
reservation/acknowledgement forms.

Handover detail returns the scoped source/target custodian IDs already joined by
its participant lookup. Current senders/receivers can find recovery controls even
when a selector page is absent, including after account/location deactivation.
This introduces no additional query, table, grant, custodian directory or operator
ledger access. The command service still checks current named membership and
validates movement capacity/revisions; rejection/cancellation moves no cash.
The existing real PostgreSQL current-authority/private-paging/inactive-source
recovery case passed with explicit participant assertions, original 60-second
case deadline, zero bad statuses, and disposable cluster/data/lease cleanup.

Nineteen focused component checks use actual adapters with controlled fictional
transport. They include capture paging/detail/control retention, exact capture
replay, CSV mismatch rejection, successful StrictMode export, late export discard
after scope invalidation, finance read/export distinctions, exact location revision
inputs, half-open Kolkata request filters and recovery without selector/cross-parent
reads. The initial report detail fixture looked up an ID appearing both as source
and request; it now explicitly expects both displayed references. The failed log
is retained. These checks do not establish native browser qualification. Full
attachment UI, direct SQL lifecycle acceptance and final full-issue quality/CI/
review/merge remain required before #140 closes.

The final finance-view increment passes all five workspace typechecks, 237 web
tests across 21 files, production web build, root lint/query AST and whitespace
checks. The nineteen cashbook checks are included in that 237. Native recovery
passed separately with its existing original deadline and cleaned infrastructure.
Final logs: `140-cashbook-finance-ui-final-{types,web,build,lint}` and
`140-custody-recovery-native`. Diagnosed failures remain in the override, cleanup
and detail-fixture failure logs. The URL test shim needed explicit TypeScript
`override` modifiers; delayed blob cleanup needed to retain its original URL
implementation rather than look up a restored global after test teardown. No
assertion, compiler option, timeout or asynchronous-error check was weakened.
### #140 private expense proof UI

Expense request detail now reuses the booking attachment transport and uploader with
an explicit expense parent and purpose. The submitter adds optional supported private
photos, voice notes or videos; permitted finance readers request ready bytes explicitly.
Booking/parcel metadata, foreign grant URLs, mismatched parents and command identities
are rejected before accepting evidence. Scope invalidation aborts work and revokes local
previews. Approval hides new uploads and shows the frozen reviewed evidence references;
the server remains authoritative over current access, review and file safety.

An uncertain initiation, upload or cancellation retains its original intent and command
identity. Cancellation stays visible until confirmed or current evidence reconciles it;
an unknown cancellation cannot be presented as successful. Pending submitter proof work
locks expense navigation and other financial commands. Read-only metadata loading does
not lock another admin's review. Existing booking attachment callers retain their parent
contract and use the same recovery implementation.

Verification: final web suite passes 248 tests in 22 files, including 10 expense proof
transport/lifecycle checks, 20 cashbook checks and 14 existing booking attachment checks
(these counts are included in 248). All five workspace typechecks pass; after callback
dependency fixes the affected web typecheck passes again. Root lint/query AST, production
web build and whitespace checks pass. Controlled fictional HTTP/XHR and component
fixtures prove the exercised UI recovery boundaries, not live storage/scanner or native
browser qualification. Logs are ignored local 140-expense-proof-final-* files. The initial
hook-dependency/unused projection lint failure is retained and corrected without relaxing
the gate. Direct SQL lifecycle acceptance, native browser journeys and final full-issue
quality/CI/review/merge remain required before #140 closes.

### #140 direct expense proof lifecycle acceptance

The unreleased migration 46 now locks and reads current organization then franchise
lifecycle for user expense evidence writes. New metadata/upload/finalization transitions
cannot proceed after parent disable; current membership and user lifecycle still gate
the actor. Cancellation/temporary-byte cleanup remains bounded by the existing state
machine. The trusted cleanup worker can delete abandoned unsettled evidence after
organization/franchise disable and submitter revocation, but cannot upload, link or
rewrite ready evidence. Booking parents return through their existing guard unchanged.

This adapts PostgreSQL's [row-lock behavior](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS)
to ShippingCo's existing organization-before-franchise API authority boundary. The
locking read waits for a concurrent lifecycle change and checks the committed row;
this is verified by observing an actual blocked PostgreSQL writer, then committing
organization and franchise disables separately. It adds no worker, table or new API
permission. Arbitrary direct updates may acquire their target row before a trigger
runs; this does not promise deadlock-free client SQL. Owning APIs keep the documented
authority/parent lock order and transactional retry contract.

Nine distinct real PostgreSQL checks pass for expense metadata/review, service recovery,
HTTP integration and the new direct SQL lifecycle/quotas/ownership cases. The disable
race case was strengthened to check both parents and passed again with its original
30-second deadline. A revoked submitter cannot cancel by forging user metadata, while
actual trusted cleanup deletes its abandoned temporary evidence on disabled parents.
Four ready 8 MiB records exhaust the 32 MiB parent limit; ten small ready records exhaust
the count limit. Existing pending quota/review races remain covered. Wrong expense,
missing parent, mixed booking/expense, sibling franchise and unrelated organization
command references fail; grant audits retain exact parent and actor. Runtime roles
cannot read/write audit history, delete/truncate evidence or disable triggers.

Sixteen existing native booking attachment lifecycle/authority checks pass unchanged
against the final migration (140-expense-sql-booking-compatibility). Together these
are 29 distinct native checks; the strengthened parent race rerun is included, not
an extra distinct case. The four native cashbook source/upgrade cases also pass, preserving populated pre-140
collections, released booking attachment tuples and original refund exact retry without
fabricated custody. Final API types, root lint/query AST and migration history pass
(all 45 released migrations unchanged). Logs: 140-expense-sql-native,
140-expense-sql-parent-races, 140-expense-sql-upgrades, 140-expense-sql-final-types,
140-expense-sql-final-lint and 140-expense-sql-migrations. Native test resources and
loopback cluster are cleaned after each run. These controlled metadata/storage fixtures
do not qualify a live provider or finish native browser and full-issue release gates.

### #140 owning refund HTTP qualification

The actual server composition is qualified with both financial workflow and cashbook
writes enabled, and with both disabled. New cash refund application requires the exact
current cash location/revision; missing or incomplete custody evidence fails before any
financial change. An approved but unexecuted refund remains blocked when writes are
disabled. Existing legacy application replays with its original key/body across either
configuration, retaining its original NULL custody evidence. Current actor/tenant grants
are checked before replay, including sibling/unrelated scopes and revoked membership.

The native scenario passes with the original 60-second deadline. A reviewed 100000-paise
float remains unchanged by a legacy 10000-paise refund with unknown custody; the next
20000-paise refund explicitly records its owning drawer, leaving 80000 known recorded
paise. Replay across enabled/disabled servers adds no second outflow or source generation.
Original collection count stays one, original refund evidence remains byte-for-byte equal,
and financial sources reconcile gross 0, collections 50000 and refunds 30000. Live position
comparisons require the same complete financial facts/source generation and a nondecreasing
current cutoff; each read deliberately has its own as-of time.

Logs: 140-refund-http-native, 140-refund-http-final-types and 140-refund-http-final-lint.
Initial fixture failures are retained: the applied command identity was mistaken for the
financial evidence identity (now queried by immutable request parent), and a live cutoff
was incorrectly expected to equal an earlier read's time. An initial typecheck also caught
a nonexistent derived field; assertions now reconcile the actual authoritative source DTO.
No source/amount assertion, privacy check or deadline was relaxed. This adds acceptance
evidence only, without changing the owning refund implementation or released schema.
Native cluster/data/lease cleanup completed. Browser and final full-issue gates remain.


### #140 browser evidence and source-row mobile correction

Actual React cashbook components, API adapters and production styles were exercised
in the native in-app browser with explicitly fictional controlled transport. This
qualifies browser rendering and interaction, not live providers or a full actual-API
end-to-end deployment. At a 360-pixel viewport (350-pixel content area), the expense
request, private proof, different-admin keyboard review, exact application and
correction draft remain contained without horizontal overflow. The ready PNG preview
decoded, Tab focused Record review with a visible solid outline, approval retained
proof ID/version 3, and the applied request exposed a correction draft with immutable
kind, source and occurrence. Ending the synthetic scope removed private evidence.

Captured-source paging retained the saved cutoff and complete control totals across
101 synthetic rows; the final page contained one row. Accountant controls exposed
no expense/configuration mutations. The browser completed the controlled CSV download,
whose payload was synthetic; this is download interaction evidence, not accountant
format qualification. Earlier controlled custody checks exercised partial acceptance
and ending the remaining amount without a second movement.

With production CSS, source-row labels were clipped by inherited nowrap styling.
Only cashbook source buttons now wrap, grow in height and contain long identifiers.
The measured row changed from a 283-pixel client width/397-pixel scroll width to
283/283 with normal whitespace and a 72-pixel height. An earlier page-overflow
observation came from missing production styles in the temporary fixture and is
not counted as a product defect. Fixture parent/decision identity mistakes were
corrected without relaxing the production decoders. Native date fill did not persist
a custom date; custom date interaction is not yet qualified by this browser evidence.

After the scoped style change, all 248 web tests in 22 files, all five workspace
typechecks, root lint/tenant-query AST checks and production web build passed. Logs:
140-browser-final-web, 140-browser-final-types, 140-browser-final-lint and
140-browser-final-build. No additional mirror test was added for this style change.
Browser failure/uncertain/empty/configuration checks and final whole-issue gates
remain; #140 stays open.


The next native browser pass also confirmed empty request/handover states, the
controlled read-outage message and Retry action, uncertain review navigation locks
and recovery through Retry same request. Configuration showed fixed account/custodian
identity with current account revision 5, then rename/deactivation advanced location
revision 1 to 2. Empty fixture responses initially omitted cutoff/source generation;
these were corrected to the real DTO without decoder changes. An export-mismatch
browser attempt was inconclusive and is not recorded as passing. The temporary tab
and Vite process were closed and the viewport override reset.

The first whole-quality run stopped at the strict prototype source inventory:
thirty new cashbook/expense proof test declarations and five UI effects had no
reviewed dispositions. Their reports/proof ownership and preservation rationale
are now recorded in the existing inventory and document; callers, routes, exports,
storage operations and fingerprints did not drift. The validator was unchanged.


Final source review corrected one controlled handover fixture: an acknowledgement
previously overwrote the parent inbox identity and requested amount. The fixture
now updates only the cumulative custody state/version and history. The existing
partial-acceptance UI test additionally requires the refreshed inbox to retain
its original 20000-paise request with 10000 accepted and 10000 remaining, without
a read-error fallback. All 20 cashbook UI cases pass after this correction; no
production handover behavior changed.

Whole local quality passed pinned tooling, planning, gate/unit checks, lint, types,
689 API and 248 web tests, then failed Docker-backed attachment creation/cleanup.
Separate API/web production build and 45-file migration-history checks passed.
The complete native cashbook file reached its existing 300000ms deadline after
19 passing cases (one cancelled file); it is not a full pass. The nine unreached
cases passed separately under unchanged original deadlines, with no failures,
cancellations, skips or todos. Thus all 28 distinct cases have passing evidence
across those runs; the cancelled aggregate remains recorded. Both native database
clusters/data/leases were cleaned. Full final-head Linux CI remains the release gate.


### #143 agent onboarding and physical parcel custody implementation plan

Status: implementation in progress; this plan is not acceptance evidence. Prerequisites
#14/#24/#27/#42/#137 are merged. #143 owns parcel custody; #144 owns agent money
settlement and #145 owns cash close. D137 and D140 approvals do not grant agent
ledger access or a new self-approval exception.

Keep the seven approved roles. Reuse identity-bound membership invitations, acceptance,
revocation and current franchise scopes for temporary delivery agents. Revocable access
satisfies the engagement requirement without inventing a new login system or default
employment duration. Local franchise admins manage their agents under W30; organization
administrators retain only existing W42 management authority. Invitation creation returns
its token once; the agent accepts as the named signed-in user. No directory search by
customer phone, anonymous staff identity or deletion of historical evidence.

The operational parcel status/custody fields describe lifecycle state; they do not prove
physical receipt. Add an append-only physical receipt chain, scoped manifest and immutable
items tied to actual dispatcher assignments and delivery attempts. Preparing a manifest
reserves no physical possession. The named active recipient acknowledges the exact current
manifest items; a committed receipt records server time, responsible agent, previous
receipt, current parcel/attempt references, actor and command. Lock the organization,
franchise and bounded parcel IDs in canonical order. A unique parcel sequence and unique
predecessor prohibit competing successors; no browser value establishes custody.
Legacy assignments with no receipt remain explicitly unknown; do not backfill evidence.

Initial handovers require the current W10 assignment. Reassignment requires a separate,
exact dispatcher instruction and W16 responsible-franchise admin preparation; named
recipient acknowledgement records receipt, not an independent transfer permission.
Recheck the dispatcher, administrator and recipient's current scopes at acknowledgement.
The owning deliveries service then changes the current attempt agent and parcel assignment
atomically with the acknowledged receipt, retaining the original attempt, assignment ID,
recipient, challenge, lock state and resend/verification counters. Preserve old/new agent
history. A new assignment is not a failed attempt or retry. Any exceptional-proof request
from the previous agent becomes invalid; never carry its approval to the next agent.
Existing OTP identity does not bind the agent, so reassignment requires no code disclosure,
challenge regeneration or additional message send. Completion still requires #42 proof
and the current assignment; the old agent immediately loses completion authority.

Independent transfer initiation by an agent remains W16/G: add explicit W17 admin-granted,
revocable capability bound to current assignment, source receipt and permitted destination.
Never turn named-recipient acknowledgement into a blanket transfer grant. Agent release
and receiving-agent acknowledgement preserve both sides of an agent-to-agent movement;
admin recovery after access revocation records the administrator's physical receiving
acknowledgement and discrepancy, not a fabricated agent signature. Capability revocation
or membership removal preserves all receipts, commands and proofs.

Physical return records a shop administrator's receiving acknowledgement, linked source
receipt and a bounded discrepancy reason. It does not change attempt failure, office hold
or carrier RTO state. Block proof completion while the tracked parcel is physically at the
office; a subsequent acknowledged handover and current assignment restore eligibility.
On genuine #42 completion, append recipient receipt referencing that exact immutable proof
in the same transaction. No custody command may create delivery proof or money movement.

Serve a bounded agent worklist using explicit current assignment/receipt predicates;
owner manifest detail includes authorized source receipts and proof links. Never add agents
to full-franchise shipment/customer/finance reads. Every retry, detail, worklist and receipt
download rechecks current membership and nested ownership. Bulk delivery export is E04,
franchise-admin only, with the existing private captured-export/access-audit discipline.
Receipt retrieval is a single scoped record; it grants no bulk enumeration.

Manifest outcomes at one server cutoff are mutually exclusive: delivered with real proof,
physically returned, held by its named agent, reassigned, awaiting acknowledgement, or
unknown historical custody. Failed-attempt count is a separately labelled overlapping
operational count; never subtract it as another physical outcome. Every count retains
manifest item, receipt/proof and failure source IDs and reconciles to its drill-through.
Reassignment preserves the original manifest and distinguishes the later custodian.

Implement additive migration47, runtime least-privilege grants, custody capability and
idempotent command services, owning deliveries integration, validated Fastify routes and
public DTOs. Update the production operations seam with agent onboarding/accept/revoke,
manifest prepare/acknowledge/reassign, physical returns/discrepancies and source worklist.
Reuse Material 3 tokens and provide labelled inputs, preserved safe drafts, visible pending,
empty/error/retry states, keyboard focus and narrow-screen layouts. Demo remains fictional.

Verification maps the full contract: a ten-parcel real PostgreSQL cohort with six actual
#42 proofs, two office receipts and two held; two competing handovers; stale/repeated/lost
acknowledgements; reassignment retaining challenge counters and old-agent denial; return
without synthetic failure/RTO; revoked access with retained owner evidence; sibling/other-org
read/write/export/retry denial; runtime immutable/FK/atomic constraints; fresh and populated
migration46-to47 upgrades without backfill; exact cutoff/source counts; production UI
keyboard/mobile and failure recovery. Focused checks precede final required quality/CI,
review and gated merge. No live provider, accountant format or physical count qualification
is implied by fictional evidence.

Roll out schema and least-privilege grants first, then deploy APIs/UI with new custody writes
disabled by default. Reads retain known/unknown history while disabled. Enable only after
the synthetic full workflow and revocation checks. Compatible rollback disables new writes
and retains evidence; schema repairs are forward-only. Existing legacy proof behavior remains
compatible until a deployment enables tracking; once a parcel has tracked receipt evidence,
proof must respect it even if new custody writes are subsequently disabled.

Research and design challenge: [PostgreSQL row locking](https://www.postgresql.org/docs/18/explicit-locking.html)
supports serialized bounded writers and consistent lock order; adapt existing transactions
and verify races with independent connections. [PostgreSQL partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html)
can enforce one active projection, but defer a second mutable projection: an indexed unique
append-only successor chain plus parcel locks supplies one authoritative latest physical
receipt with less repair work. This is ShippingCo's inference, not a claim about a company's
implementation. [AWS request identity guidance](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
supports retaining scoped caller keys and semantic fingerprints across uncertain replies;
reuse existing command patterns and test post-commit replay, conflicts and revocation.
All choices use existing PostgreSQL/services; no provider, queue or framework is added.


#### #143 tracked proof and receipt chronology

The #143 forward migration attaches physical-custody guards to the existing #42 proof
and owned parcel transition. A tracked office receipt blocks proof completion. Only
the actual immutable proof can append its recipient receipt, saved custody command
and event in the same delivery transaction. A deferred proof check also requires that
receipt. Replayed #42 commands do not rerun the transition. Untracked legacy deliveries
retain their original behavior; no historical receipt is invented. These guards remain
authoritative when new custody entry points are disabled.

Receipt recording uses database transaction time. #42 proof completion can sample its
server clock later within that transaction, so recording time is not a bound on the
proof's completion instant. [PostgreSQL documents this distinction](https://www.postgresql.org/docs/18/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).
For historical outcomes both receipt recording and proof completion must be at or before
the same cutoff; proof must still belong to the exact parcel, attempt, preceding agent
and receipt chain, and cannot predate that agent's receipt. This adapts the existing
transaction clock without adding infrastructure or weakening source identity checks.

Initial real PostgreSQL evidence: 143-proof-custody verifies a real OTP blocked at the
office, acknowledged handback using the same attempt/challenge, one genuine proof and
recipient receipt on exact retry, and unchanged customer debt. This is focused synthetic
evidence. Subsequent native cohort, reassignment and browser qualification are recorded below; final CI and merge still gate completion.

### #143 exceptional review after acknowledged handover

An exceptional delivery review belongs to its acknowledged physical custody receipt. Migration 47 adds a nullable, composite-owned receipt reference to delivery exception requests; existing requests stay NULL with no invented history. The unique key permits one request for each acknowledged receipt and retains one NULL request per legacy attempt. PostgreSQL 18's [unique-constraint NULLS NOT DISTINCT semantics](https://www.postgresql.org/docs/18/ddl-constraints.html#DDL-CONSTRAINTS-UNIQUE-CONSTRAINTS) support retaining that legacy limit without a separate partial index; the adopted cost is one bounded composite index plus the existing transaction and receipt chain. Duplicate requests return the existing controlled exception-invalid response after rollback. Database triggers derive the current receipt, reject requests or approvals while the parcel is at the office or held by another agent, and invalidate prior pending/approved reviews when custody changes. Proof insertion additionally checks the approved request against the exact current receipt. Recipient release preserves the completed review history.

The delivery projection prefers the current non-invalidated request before timestamp ordering, so tied test clocks cannot select an obsolete approval. A return and handback permit fresh independent review without resetting the assignment, challenge, resend count, or failed-verification count. This is authority separation within the existing #42 review policy; it does not relax evidence requirements or permit self-approval. Native PostgreSQL evidence uses a protected finalized attachment and real delivery services, denies office-held requests and old approvals, then records one exceptional proof and recipient receipt with exact replay.

### #143 acknowledged reassignment implementation

A current dispatcher authorizes an exact parcel, attempt, assignment, original agent, receiving agent and parcel version. The physical handover still requires a live franchise-admin preparation or the current giver's scoped grant, the giver's release, and the named receiving agent's acknowledgement. Preparation and release leave completion authority with the original agent. Acknowledgement applies the owning delivery module's api.v1.deliveries.reassign command, one same-status parcel transition and one delivery.assignment_changed event, followed by the immutable receiving receipt and custody command, in the same transaction.

The original attempt ID, assignment ID, recipient binding, challenge and remaining verification/resend counters survive. Only the current agent and parcel version change. The old agent loses reads/completion through existing current-assignment checks; the receiving receipt invalidates the old exceptional review and permits a fresh independent review. A guarded runtime grant permits updating the attempt's agent column; a BEFORE guard binds it to the exact reserved reassignment, and a deferred constraint requires its committed owning parcel transition. The parcel command's deferred completeness check additionally requires the actual receiving receipt and custody acknowledgement. SQL updates cannot substitute a journal row for receipt acknowledgement.

Migration 47 extends the existing parcel edge/input/event contracts without changing released migrations. It follows the released receiving-account migration's explicit handling of the absent separate event owner check; existing event creation, shape and command-completeness guards retain ownership. Native verification identified that catalog difference before the correction, and the failed run remains recorded separately. A real different-agent handover verifies challenge preservation, old-agent proof denial, fresh independent exceptional review and exactly one transition/event. Faults after the parcel update or omission of the event roll back assignment, receipt and approval invalidation before exact-key retry.

### #143 complete manifest counts and current worklist

The private manifest report reads the entire manifest (at most 50 items) at one server cutoff under the existing current-membership transaction. Each item links its initial agent receipt, last eligible receipt, proof and failed-attempt source IDs. Indexed latest-receipt and first-departure lookups traverse receipt history without imposing an arbitrary history cap or deriving totals from a paged subset. Recipient receipt and actual proof must both be visible at the cutoff. Failed attempts are an overlapping subtotal within the responsible agent's custody interval; physical return never implies failure or carrier RTO.

The current worklist pages 50 parcels using a parcel UUID cursor. Agents see currently assigned work or parcels they still physically hold; another agent's new assignment removes the previous holder's operational access. Completed parcels remain in the manifest's evidence and counts. A legacy assignment without a custody receipt explicitly shows unknown physical custody. Worklist DTOs contain operational references and docket only, with no recipient contact, OTP, customer directory or money. Owner and agent permissions are derived on each read; revocation does not erase owner history.

The native ten-parcel scenario uses real #42 OTP completion for six parcels, real office receipts for two, and two retained agent receipts. It verifies every delivered count against actual proof IDs, re-reads the earlier held cutoff after those changes, adds a genuine failed attempt without changing 6/2/2 physical counts, and checks agent/other-agent/sibling/revoked access. The initial failure subtotal assertion exposed the pricing fixture's future parcel-service clock; the report correctly excluded that future source. The corrected test uses the owning parcel service's live clock for operational failure and reuses already completed runtime permission setup for its ten journeys. Its original 60-second case deadline remains unchanged.

### #143 private custody exports and access history

Custody exports reuse the existing report snapshot store and its immutable 24-hour payload, per-actor franchise key, expiry cleanup and active snapshot quota. A franchise admin captures the complete manifest cohort once; retrieval and CSV download require that same actor's current local admin authority. Each snapshot identifies custody_manifest_v1, the tenant, source manifest, agent, source cutoff, complete control totals and source-linked item rows. Later operational changes do not alter those rows or the same-key capture response. Generic report readers reject this definition; custody readers reject other definitions.

The CSV quotes cells through the existing formula-safe report encoder. Each parcel row includes the common manifest, agent, cutoff and cohort control totals, followed by its item, parcel, outcome, initial/current receipt, delivery proof and failed-attempt IDs. These are operational evidence references; no recipient contact, OTP or money is exported. The production API transport and operator download now use this same protected snapshot seam.

Read and worklist access, capture, snapshot read and download append immutable custody_access_events with actor, tenant, manifest/snapshot references, action, server time and request correlation. Composite foreign keys preserve source ownership. The safe canonical audit projection includes these records. Read-only query capabilities remain unable to mutate business or audit data: the membership boundary issues a separate scoped audit capability, and only an already-authorized custody export receives the snapshot-storage capability. Native tests caught and corrected accidental use of read and export capabilities for writes, without relaxing the generic scope guard.

The real ten-parcel scenario additionally verifies immutable captured rows/CSV after a new failed attempt and exact replay; agent, another admin, sibling-franchise and revoked-admin download/capture denials; retained actor/correlation audit facts; and direct database rejection of audit update/deletion. A fresh inventory and populated migration upgrade validate the additive access table, with no fabricated historical accesses.

### #143 production transport and rollout

The custody services now register with the production Fastify composition. CUSTODY_ENABLED is explicit true/false, defaults false and rejects demo activation; apply migration 47 and runtime privileges before enabling physical commands. Reads and export capture remain available for authorized historical evidence while new physical commands are disabled. API handlers reuse the existing secure/developer session cookies, global browser CSRF checks, strict field validators and same-key server transactions. All custody responses are private/no-store. CSV is available through the existing JSON export seam and a protected attachment download with a UUID filename and nosniff.

A native production-server case creates 51 actual scoped parcels and verifies complete keyset traversal without duplicates, agent and read-only ceilings, missing authentication and CSRF denial, disabled new writes and exact prepare/ack replay, private named manifest selection, source counts, protected export headers, later physical return with captured CSV unchanged, sibling download denial and revoked agent reads. Configuration validation and the tenant AST's real-call/extracted-query rejection controls also pass. The new HTTP file receives only the same request-query-data allowance as existing route files; SQL execution remains rejected. Subsequent real browser, competing-agent and export recovery qualification are recorded below; final repository gates remain required.

### #143 operator custody controls

The scoped operator custody page lists current parcels and handover manifests with explicit physical custody, operational status, source receipts and genuine proof references. Named agents acknowledge every prepared item; franchise admins capture private reports and download the unchanged CSV. Dispatcher reassignment authorization, admin preparation of up to 50 selected parcels, specific transfer approval/revocation, giver release, office receipt/discrepancies and prepared-manifest cancellation use the same command-intent seam. Preparation uses current parcel versions and receipt references; a changed assigned agent requires the dispatcher instruction, and an agent-held source requires its transfer approval. Missing records a discrepancy without asserting office receipt. Server responses supply saved references for the subsequent transfer steps.

Pending and uncertain commands block navigation, franchise changes and replacement submission. Recovery retains the exact original body and key; scope generation changes clear private page state. DTO projections reject invented proof, partial acknowledgement, inconsistent cohort totals and reused evidence. Nine focused web tests verify those source, role, form and lost-response risks with synthetic transport; they do not qualify real browser journeys. Native tests separately traverse 101 active agent identities over two pages with no duplicates, excluding sibling and revoked memberships and denying continuation after reader revocation. Identity selection uses bounded UUID keyset pages rather than a silent 100-agent limit. The subsequent browser and native recovery evidence below qualifies those journeys and failure cases; full repository checks and review remain required before issue completion.

The temporary-agent access panel reuses the existing membership endpoints. An administrator invites an existing verified account for the selected franchise; the named account accepts through the existing operator footer, activating the delivery-agent membership. The footer displays the signed-in account reference so the agent can supply the correct identity. Revocation uses the current membership version and keeps custody and access history; reactivation issues a fresh invitation. The panel projects only this franchise's single-franchise delivery-agent grants. Multiple-franchise grant changes remain in organization administration.

Membership writes do not claim custody-command idempotency. A lost response blocks replacement writes and navigation until current membership/invitation records can be read. Invitation codes are one-time response data held only in component memory. If creation committed without delivering its response, a pending invitation is visible but its code cannot be recovered; an administrator can revoke it and create a replacement. Three web tests verify that recovery, exact current-version revocation, private projection and tenant/multiple-franchise boundaries. The extended native production HTTP case verifies identity-bound acceptance, unauthorized and sibling-franchise denial, seven-day expiry, custody visibility before/after activation and revocation, fresh reactivation and retained active/revoked history. Its first new assertion expected 403 for an unmanaged franchise; the existing resource-hiding contract correctly returned 404, and the strict assertion was corrected after inspecting that service. All original native deadlines remain unchanged.

Current transfer discovery now provides the giving agent with approved source receipts, named destinations and matching current dispatcher instructions. The agent can prepare a handover directly from that evidence, find its pending outgoing manifests and confirm release without manually entering those references. Preparation remains conditional on an active delivery attempt and current assignment/instruction; recipient acknowledgement remains separate. Owners can revoke a displayed approval. Agent-only reads do not expose another giver's approval, and current choices exclude revoked grants, inactive giver/recipient identities and sources already transferred. Grant and outgoing-manifest lists use 50-row UUID keyset pages.

Three focused web tests verify exact discovered-source preparation/release, named response binding, absence of another account's giver controls, private projection and contradictory preparation claims. Extended native grant/recovery tests verify actual query output before/after dispatcher instruction, giver-only discovery, released-manifest evidence, revoked grant hiding and removal of stale dispatcher/inactive recipient choices. The production HTTP test separately qualifies both new read routes, malformed cursors, another-agent denial, office release evidence and disappearance after actual return. Those tests pass with the original case/file deadlines and do not replace real browser, competing-agent race or export failure qualification.

### #143 browser and recovery qualification before merge

The loopback-only synthetic browser fixture runs the production React page, Fastify routes, runtime PostgreSQL role and existing auth/membership services. Actor selection creates a fresh disposable session through AuthRepository; production session expiry remains unchanged. Browser qualification exposed a delivery-agent workspace-context omission. Operator context now lists the agent's explicit active franchise metadata without granting general franchise-profile, directory or finance authority. Native HTTP verifies ready context for the local franchise, sibling hiding and unavailable context after revocation.

Actual keyboard browser actions confirmed admin preparation, named-agent receipt, dispatcher instruction, specific admin transfer approval, giver preparation/release and receiving-agent acknowledgement. Preparation/release retained the old physical holder until acknowledgement. The owner report showed one reassigned and one actual damaged office return, zero delivered, and linked origin/current receipts. A missing report retained agent custody and did not create proof or an office receipt. A separate fresh fixture confirmed identity-bound invitation acceptance, activated scoped workspace, admin revocation and subsequent unavailable workspace. These are synthetic production-path browser checks, not provider qualification or production rollout.

At a 390 by 844 viewport the report remained within the viewport (document width381, viewport390), with wrapped evidence references and usable controls. An owner captured and downloaded the actual protected CSV; its three records contained the header and two held parcels, matching total 2 / held 2 / delivered 0 and receipt IDs. Switching to the sibling franchise removed the old manifest, parcels and captured download; returning did not restore the captured private state. The browser viewport override was reset and temporary tab closed. The initial download observation timed out and reset browser control; a bounded concurrent event/control observation later returned the real downloaded file path and CSV bytes. The timeout is not recorded as passing evidence.

Two additional native cases verify different receiving agents racing for a released source (one acknowledged custodian and one owning reassignment/event, exact winner replay, losing conflict, former-agent worklist removal), and snapshot rollback/lost committed response/expiry/quota (one immutable capture identity, retained expired replay identity, twenty active captures, exact replay at quota). They passed with the original 30-second case and 300-second file deadlines. Full repository quality, final CI and PR review remain required before completion.

The native pagination-only case creates 51 current grants and 51 pending outgoing manifests through actual services, reads each complete 50+1 result without duplicates, and denies receiving-agent, sibling, revoked-grant and revoked-giver continuations. Its initial and timing-instrumented runs cancelled at the original 30-second deadline before paging assertions: prerequisite helpers repeatedly launched the migration CLI for unchanged schema. The fixture now actually applies and asserts all 47 migrations once, suppresses only redundant no-op launches during prerequisite permission setup, then restores the real migration function before business commands. The case passed in 25.8 seconds without changing its deadline, assertions, runtime permissions or writes. Fresh/populated migration acceptance is covered by its separate native cases, not this fixture optimization.

The browser adapter binds acknowledgement/cancellation/revocation confirmations to the requested resource and rejects receipt claims from preparation, authorization, grant or release responses. Seven adapter tests include mismatched capture source, sibling snapshot, mismatched download identity and stale in-flight capture. Existing transport returns an aborted failure for a request cancelled while in flight; replaying its stale scope intent is rejected before dispatch. The original test's mistaken SCOPE_CHANGED expectation was corrected after inspecting that established transport contract. Other focused form, transfer, access and uncertain-receipt tests passed separately; no failed aggregate is labelled passing.

### #143 operator and development runbook

Apply migration 47 with the existing separate migration identity. Keep the application role's existing session, membership, delivery, parcel-command/transition/event and scoped read privileges. Add SELECT/INSERT on the12 custody tables listed by migration 47, SELECT/INSERT and expiry-only UPDATE(metadata,rows) on report_snapshots, and UPDATE(agent_id) on delivery_attempts. The SQL guards enforce exact owning commands and immutable evidence; the application role receives no schema ownership, trigger disable, table DELETE or other-column update grant. Check these permissions using the native runtime cases before setting server-only CUSTODY_ENABLED=true. Disable that flag to stop new physical commands while preserving authorized history and exact committed outcomes; repair released schema through a forward migration.

In the production Parcel custody page, a franchise admin invites an existing verified account; that exact account accepts its one-time invitation in the operator footer. Prepare up to 50 current parcels for a named agent, then have that agent confirm actual receipt. For a different agent, obtain the dispatcher instruction and the specific admin transfer approval, let the giver prepare/release, and let the receiver acknowledge. Only that last step changes assignment and custody. For return, the admin records the actual received condition; missing records a discrepancy without office receipt. Inspect the manifest's source counts; delivered requires #42 proof. Capture/download is admin-private for 24 hours, limited to 20 active snapshots per actor/franchise; source changes do not rewrite a capture. Revoke an agent to remove current access while retaining owner history.

For a fictional browser check with the guarded pinned disposable PostgreSQL runner, run `pnpm db:local exec node --experimental-strip-types apps/api/test/custody-browser-fixture.ts`. In another terminal start the existing web Vite task in production data mode, with API proxy `http://127.0.0.1:3061` and browser origin `http://localhost:5173`. The fixture prints only synthetic actor/parcel references. Open its localhost actor-selection URL for admin/giver/receiver/dispatcher/candidate, exercise the page, then request its loopback stop endpoint or interrupt the fixture. It cleans its registered resources; the runner owns cluster cleanup. The fixture accepts the canonical db_test and native Windows db_test_1 identities, requires NODE_ENV=test, and retains the existing guarded database provisioning. These actor-selection routes belong only to this synthetic fixture, never production buildServer.

Local final planning (including219registered web declarations and17negative inventory controls), root lint/query AST, affected web/API types, API build and production web build passed. Released migration history confirms all46existing files unchanged. The first aggregate quality command passed37tooling tests but stopped at unregistered new source inventory; its log is retained. Exactly18reviewed custody/access test declarations and8navigation/download effects were registered with strict checks that no existing regressions, coupled fingerprints, exports, dependencies or routes changed. The corrected local aggregate passed tooling37, planning/prototype checks, lint, all five workspace types, testkit22, database unit12, API699 and web266 tests, then failed attachment infrastructure creation/cleanup because the local Docker engine is unavailable. The disposable native PostgreSQL wrapper stopped successfully. This is a failed aggregate; separate API/web builds and the focused native/browser results above do not establish full quality or final-commit CI. Full Linux integration and required final-commit gates remain necessary before merge.

Linux CI head7502c946 passed all five quality jobs, including container-backed attachment tests, but failed three existing migration-repair cases before the API database group. Native reproduction confirmed all three: copied-directory repair counts in booking/proof still expected46 migrations, and the e-way synthetic repair timestamp preceded new migration47. Update those exact remaining counts and make synthetic booking/e-way repairs sort after47; retain rollback, unchanged populated source, immutability, repeat-install and original deadline assertions. Failed CI/native logs are retained. All three corrected native cases passed under their original30-second case/300000ms file deadlines, with no skips/cancellations and successful cluster cleanup. Planning/prototype validation also passed. Final-head Linux CI remains required; this focused result does not establish passing aggregate checks.

Subsequent custody CI headbec8693 passed all83 database/schema cases and all five quality jobs, but named an existing messaging-effectiveness API failure before cancellation at the unchanged15-minute job limit. Native reproduction found #65's queue-age calculation used PostgreSQL microseconds while publishing a millisecond cutoff; its exact partial-hour equation failed. The owning correction was delivered separately in PR172, merged as e06da3914a9b0998a19e67c1537b9e499882799f after all7 checks passed (83DB+478API, zero failures/skips/cancellations/todos, container cleanup confirmed). Custody now incorporates that merged correction. The failed custody aggregate remains failed/cancelled evidence; original individual/file/job budgets and equality assertions are retained. The strengthened weekly fixture also passes on custody's migration47 schema under its original60-second case deadline, with successful owned-cluster cleanup. Final custody-head CI remains required before completion.

Custody head3c1dfab completed83DB+493API integration cases with zero failures/skips/cancellations/todos and removed its disposable container, but the overall job was cancelled at the existing15-minute limit during completion. The required aggregate failed; those case results are not a passing job. Service fixtures now use the same bounded setup approach as pagination: assert one actual migration47 install, retain real prerequisite runtime grants, reuse the successfully completed membership/booking preparation within that disposable fixture, suppress repeated unchanged no-op migration CLI launches, and restore the real migrator after custody preparation. Dedicated populated46-to47 migration checks remain unchanged. No test assertion, individual/file/job deadline or production code changes in this correction. The first Windows whole-file run passed11cases but timed out two unchanged attachment-backed fixtures and reached its original300-second file deadline (three cancellations); its failed log is retained and the owned cluster stopped and cleaned up. Those two scenarios now inject the same prepared database through a backward-compatible optional test-fixture argument; other attachment tests retain their default setup. The corrected full native custody file passed all15cases in199.6seconds under the original300-second file cap and unchanged individual deadlines, with zero failures/skips/cancellations/todos and successful owned-cluster stop/data cleanup. The two previously timed-out attachment cases completed in12.1/13.6seconds; no acceptance assertions changed. API typecheck, fixture lint and planning/prototype219declarations+17negativecontrols passed. All final-head CI gates remain required before completion.

## #144 agent money and settlement implementation plan

Issue #144 starts from main e35ce18 after #138/#139/#140/#143 merged. Its outcome is a daily agent statement that separates customer freight collection, seller-owned goods COD, physical cash custody and earned fees. The approved D137 rules prohibit silent netting, duplicate collection, automatic payroll deductions and invented proof. D140-1 continues to govern expense approval. Migration47 is released; preserve it and all earlier migrations. New schema is additive migration48, with fresh/populated upgrade qualification and no synthetic historic collections or fees.

### Authority and approved decision D144-1

Operators and franchise admins record actual collections through #138; an explicitly scoped current delivery agent may be the named receiver/cash custodian, but receives no general collection, customer directory or ledger mutation grant. A current agent can read minimum own financial evidence and request own handover/settlement. Operators receive minimum recording/request evidence; current franchise admins configure terms/beneficiaries, review and approve settlement, and apply approved financial actions. Existing finance readers/exports retain their explicit franchise grants; organization-wide read does not imply mutation/export. Reauthorize nested references, retries and downloads. Revocation removes agent access while keeping owner-readable liabilities and source history; owner recovery from a historical revoked custodian needs a current named receiver and genuine handover evidence.

**D144-1 was approved by the product owner on 11 October 2026:** agents/operators/admins may prepare and submit the exact source-linked daily settlement or correction; a different current franchise admin approves/rejects it. Approval acknowledges the saved statement and discrepancy/carry, not an actual cash transfer or fee payment. Admin-submitted requests cannot be self-approved. No sole-admin settlement exception is inferred from #145's cash-close exception. Actual expense approval retains D140-1 independently; approving settlement cannot substitute for it. An admin may configure versioned fee terms within the ratified configuration grant; this is distinct from approving a submitted expense/payment.

### Collections, COD and receipt ownership

Reuse the actual #138 receipt once: a ₹2,100 receipt can have ₹100 freight allocation and an explicit ₹2,000 goods-COD allocation against a separate owned obligation and seller/beneficiary. Freight To-Pay never becomes goods COD by inference. Freeze beneficiary, obligation/version, amount and source receipt/booking/parcel references; corrections append bounded reversals linked to original evidence. An onward seller remittance needs actual amount/method/account/time/reference evidence and approved source capacity. It reduces seller liability, not revenue or expense, and never calls a bank/carrier provider.

A single locked receipt supports both allocation domains: net freight applications plus net reserved COD cannot exceed received paise. Both the new COD path and later ordinary freight allocations enforce this equation in SQL as well as the service. Refunds/corrections cannot consume seller-owned capacity. Current available funds must be distinguished from the immutable result of an earlier receipt command; replay preserves its original result and a current projection reports the new reservation. Direct-to-shop UPI is receiving-account evidence and contributes zero agent cash custody, even when the collection is associated with an agent's delivery.

### Physical money and carried evidence

Reuse #140 handover requests and the one acknowledged out/in command; preparation leaves source custody unchanged. Add source-linked receipt/component attribution for agent handovers, constrained to exactly the acknowledged amount and remaining owned capacity. Fungible cash attribution uses a documented stable source order; it is accounting attribution, not a claim to identify physical notes. A partial receipt leaves its remainder outstanding. Opening carried balance is the prior source history still held, not a second inflow or a new customer charge. Legacy missing custody or beneficiary evidence remains explicitly unknown until an approved source-backed correction supplies it.

Known agent cash at the cutoff equals owned cash receipt inflows plus accepted incoming custody minus accepted outgoing custody and valid source-linked corrections. Money received directly into a shop noncash account is excluded. Seller liability equals valid COD allocations minus valid remittances/reversals; handover changes physical custodian only. Counted minus expected cash is a signed discrepancy. Shortage remains explained/carrying evidence without debt reopening or automatic deduction. An excess count cannot manufacture a receipt, revenue or owner-fund source; unidentified money remains an actionable exception.

### Fees, advances and one expense

Store immutable, admin-approved agent terms with explicit per-delivery amount or an agreed amount/covered period and version. Per-delivery accrual uses genuine completed #42 proof and the agent identity bound to that source; a failed attempt, pending parcel, office return or reassignment alone earns no delivery fee. Agreed fees require their explicit approved source rather than a guessed rate. Save the terms revision and eligible source; uniqueness prevents repeated accrual for one earning identity.

Reuse #140's exact request, distinct-admin decision and applied effect for the fee expense. Fee advances are separately approved actual outflows with their own agent/source identity, not earned expense or customer collection. Applying an owned advance to an approved earned fee is an explicit bounded noncash application. The expense record retains gross earned amount; its new cash leg is only the unpaid portion, with the difference exactly linked to previously paid advances. Extend the owning request/effect guards narrowly for these linked fee sources; ordinary expense amount/leg rules remain unchanged. Never invent a clearing bank account or an extra cash inflow to balance the application. One fee accrual, one approved expense recognition and bounded actual payout/application evidence must reconcile; every later report distinguishes gross expense from cash paid. A fee payout or advance does not reduce seller COD or agent-held customer collections.

For ₹40 earned, a ₹10 paid advance and ₹30 later payment, show earned expense ₹40, advance paid/applied ₹10, later paid ₹30 and remaining fee ₹0. Shop cash left once for ₹10 and once for ₹30. For ₹2,000 seller COD plus ₹100 freight and ₹40 earned, show custody ₹2,100, COD liability ₹2,000, freight collection ₹100 and fee ₹40 separately through handover and payment.

### Transactions, statements and UI

Use existing membership transactions, organization/franchise lock order, raw parameterized SQL, scoped commands/fingerprints and expected versions. Append state, source links, audit and event atomically. Lock receipt/obligation/agent settlement sources in stable order; use composite owned foreign keys, positive integer INR paise, unique earning/effect links and immutable correction chains. Concurrent approval, remittance, allocation or payout must not exceed source capacity or create a second economic effect. An uncertain committed response reuses the original identity; flag-off retains authorized history and exact committed replay. New writes default off behind the owning settlement flag and remain unavailable in demo.

Capture each daily draft/submission from one server SQL cutoff and explicit source versions, with source-linked prior carry, receipts/methods/owners, handovers, COD liabilities/remittances, fees/advances/payments, signed discrepancies and independent #143 parcel outcomes. Submission is immutable; changed sources require refresh or a linked correction, not silent editing. Approval checks current scope/version and appends its decision; it does not mark unreceived money paid. Private captured exports reuse existing bounded, expiring, actor-owned report storage and audit. Lists page completely; totals cover all authorized sources at the cutoff and never claim page totals are complete.

Implement the owner/agent settlement workspace and recording selectors through the existing production data-access seam and Material3 controls. Clearly label recorded, requested, approved, physically received and actually paid. Provide source drill-through, loading/empty/error/stale states, exact uncertain retry, scope-switch clearing, keyboard/focus and narrow-screen behavior. Preserve demo isolation and existing workflows. Update role/API contracts, flags, migration fixtures, operator recovery runbook and strict prototype inventory.

### Acceptance and verification

Verify distinct risks using meaningful pure equation tests, real PostgreSQL services/constraints and API paths, plus production browser journeys. The primary cohort shows ₹2,000 COD + ₹100 freight + ₹40 fee, direct shop UPI with zero agent cash, partial handover carried to the next day without recollection, independent physical returns, and the ₹10 advance/₹30 fee payment equation. Inspect actual source rows, not only responses. Test two approvers and competing allocation/remittance/payout, stale source/version, exact/conflicting retries, rollback/lost COMMIT, revoked recovery and membership, malformed/foreign nested IDs, sibling/unrelated reads/writes/exports/retries, one-cutoff source totals and complete pagination. Preserve original deadlines/assertions. Fresh and populated migration upgrades preserve old receipts/proof/money and show missing history as unknown.

Run cheap types/lint/planning and focused checks while implementing; stabilize/review the complete diff before required quality/build and final-head CI. Retain failures as failures. Merge/close only with full acceptance, actual D144-1 evidence, all final-head gates and actual review requirements; then sync main and clean this branch. #145 drawer close, #146 external reconciliation and #150 provider/accountant qualification remain their owning issues.

### #144 implementation progress — 11 October 2026

The first implementation slice supplies owned beneficiary/COD revisions, immutable receipt reservations and exact scoped commands. Both COD reservation and ordinary freight allocation enforce shared receipt capacity; the freight service checks current reservation separately from its immutable prior response. Current admin/operator authority is checked before replay. Configuration freezes collected ownership and amount; approved corrective/remittance operations will have their own source-backed records. New service writes default off. Existing production receipt/location/handover routes support explicitly named agent custody behind strict default-off `AGENT_MONEY_ENABLED`; COD routes, fee/advance integration and settlement UI remain under implementation.

Four real PostgreSQL cases qualified fresh private schema, actual ₹2,100 receipt/₹100 freight/₹2,000 COD capacity under competing writers, source-derived audit, runtime permission denial plus owner-trigger immutability, exact historical receipt replay, service role and sibling isolation, duplicate retries, rollback, lost-COMMIT recovery and revoked access. The populated migration47-to48 case preserved actual receipt, allocation, command, payment and event rows and allowed a subsequent ordinary freight allocation; no historical beneficiary or COD evidence is backfilled. The 47 released migrations remain unchanged. This is foundation evidence, not completion of #144 or full settlement acceptance.

The initial four-case run exposed a real command timestamp mismatch when the service trimmed trailing fractional zeros. Command results now use the canonical PostgreSQL millisecond timestamp directly. After that correction and the upgrade fixture's event-key correction, all four cases passed with zero failures, skips, cancellations or TODOs under the original 30/60-second case and 300-second file limits. API/database types, focused lint and the tenant-query AST gate passed. Full issue quality/build/browser/final CI remain pending.

The custody slice passed all six real PostgreSQL cases (four foundations plus two agent cases). A ₹2,100 cash receipt remained separate from a ₹2,100 shop UPI receipt; ₹2,090 acknowledged into office custody left ₹10 held. After agent/source account/drawer deactivation, a current admin prepared recovery and the named current receiver acknowledged ₹10. Actual cash moved once; the ₹2,000 COD reservation stayed unchanged. This does not establish seller remittance or fee payment. Agent-only general receipt/expense/location/position remained forbidden; unrelated handovers, sibling scope and revoked retries remained denied. Duplicate HTTP acknowledgement committed one command/two legs; injected pre-leg failure rolled back. All six passed without skips/cancellations under original limits (`.codex/144-custody.log`).

After the final purpose-binding change, five targeted compatibility cases passed (both agent cases and three existing operator handover cases), with zero failures, skips, cancellations or TODOs (`.codex/144-handover-compatibility.log`). Both PostgreSQL wrappers stopped and removed their verified data/lease. The strict flag pure/config suite passed four cases. This is partial #144 evidence: receipt/component custody attribution, COD corrections/remittance, fee terms/earnings/advances/payouts, reviewed daily statements, exports and owner/agent UI remain under implementation.

The fee foundation adds immutable current-admin approved per-delivery term revisions with explicit validity bounds and INR amount. An earning records the exact term revision and genuine completed #42 proof/agent identity once. Failed/pending attempts cannot substitute for proof; stale term revisions and proofs outside the approved period are rejected. A departed agent retains entitlement from genuine historical work; the current administrator must still have authority. Accrual produces no receipt, expense effect or cash leg. Agreed fees, expense recognition, advances and actual payouts remain under implementation.

The first seven-case run passed all six existing foundation/custody cases on the extended schema but failed the new fee case because it expected a raw database error instead of the existing public `TEMPORARILY_UNAVAILABLE` contract. That aggregate remains failed (`.codex/144-fees-public-error-expectation-failure.log`). After correcting the expectation, the strengthened fee case passed alone in 29.540 seconds under the original 60-second case limit (`.codex/144-fee-proof.log`). It verified actual OTP proof, stale/out-of-period terms, exact duplicate-proof SQL rejection, wrong-amount trigger rejection, rollback and lost-COMMIT recovery, parallel exact retry, departed-agent entitlement, current actor revocation, immutable earning/terms and one ₹40 earning with zero expense effects/cash legs/receipts. No synthetic proof or monetary effect was inserted. Types, tenant-query AST, focused lint, diff checks and all 47 released migration hashes passed; full issue qualification remains pending.

The advance slice extends the existing #140 request/decision/application contract with the distinct `agent_advance` kind and an owned current-agent payee. It retains current responsible employee, permitted company source custody, exact method/revision/generation, different-admin approval and real cash-capacity checks. New advance commands require both write gates; exact authorized replay survives flag-off. Recording corrections link the previous applied source and preserve payee/occurrence, including historical agent departure. They correct recorded facts and do not claim a new physical transfer. Source reports label advance outflow separately from expense. No earned fee, customer allocation or seller liability changes automatically. Explicit earned-fee expense/payment and advance application are implemented below; the complete settlement journey remains pending.

The actual advance-source PostgreSQL case passed under its original 60-second limit in 8.806 seconds (`.codex/144-advance-source.log`): ₹10 paid once from ₹100 shop funds, no expense/earning and unchanged freight debt; self-approval and overspending denied; raw effect-capacity guard denied forged overpayment; lost-COMMIT recovery and parallel exact replay produced one leg; revoked payee blocked new advances while linked source-voucher correction remained possible. Three existing expense/request scenarios passed on the new schema (`.codex/144-advance-expense-compatibility.log`); its TAP summary also counts an unmatched file container, so this evidence establishes three meaningful cases, not four feature cases.

All 21 owning web tests passed, including a new advance correction journey preserving payee and actual payment method plus missing/wrong payee decoder rejection. This is component/controlled transport evidence, separate from real monetary effects and the still-pending production settlement browser journey. API/web types, tenant-query AST, focused lint and released47 migration history passed. The populated upgrade case now creates a real released47 expense through its original SQL guards, independently approves and applies its cash leg, then verifies original expense/decision/effect/leg preservation and disabled-write replay after48. The full eight-case native integration run passed in 67.813 seconds with zero failures, skips, cancellations or TODOs (`.codex/144-money-integration.log`). It requalified all COD, custody, genuine-proof fee, advance and strengthened populated-upgrade cases on the current schema under their original 30/60-second case and 300-second file limits. PostgreSQL stopped successfully and verified data/lease cleanup completed.


### #144 explicit fee expense and payment implementation

An earned-fee expense names the immutable earning and agent, records its gross amount exactly, and supplies separate `fee_cash_paise` and `fee_advance_paise` amounts. An applied advance is referenced by its original owned request; the current applied correction determines available advance capacity. Fee expense/payment occurrence cannot precede its earning’s effective source: completed proof time for per-delivery fees, recorded entitlement time for agreed fees. Service and SQL compare exact stored timestamps, including PostgreSQL microseconds, using the same definition as historical snapshots; standalone advances remain valid before an earning exists. A positive advance application cannot occur before that advance was paid: service and SQL guards compare the preserved occurrence instants, allowing equality. Historical snapshots therefore include the funding advance whenever its fee application is included; the browser also reconciles summed advance applications against fee applications. Only the explicit cash amount produces a cashbook leg. Zero-cash recognition or advance application produces no invented cash inflow. One applied gross expense is permitted per earning; `agent_fee_payment` records a later bounded actual payment/application without a second expense. Current applied correction heads drive private fee/advance position views, keeping gross expense, actual cash paid, advance applied and remaining entitlement separate.

These requests retain D140's distinct current-admin review and exact application, current responsible employee and company source custody. Earned historical payees remain identifiable after departure. Both write flags govern new fee commands; current-authority exact replay survives disabled writes. An advance correction cannot reduce its recorded amount below the amount already applied to earned fees. Fee corrections preserve earning, agent and original advance references, including when an advance application is corrected to zero. The raw SQL boundary also rejects removing fee references to turn a fee correction into an ordinary expense. The existing correction form displays fixed gross entitlement and explicit replacement cash/advance amounts; it never silently nets them.

Native PostgreSQL qualification includes genuine OTP delivery proof and a ₹40 earning, an actual ₹10 advance and ₹30 fee cash payment. It verifies gross expense ₹40, cash paid ₹30, advance applied ₹10, remaining fee zero, exactly ₹40 leaving shop cash and unchanged customer obligation/receipt count. Duplicate expense, excess payout and over-applied advance are denied. Rollback before effect insertion, lost-COMMIT exact parallel replay, raw SQL correction source preservation, explicit partial-payment correction, competing later payouts, zero-cash unapplication and subsequent bounded advance correction are covered. Populated47 upgrade compares every original request field and all decisions/effects/legs unchanged, with all five new nullable request columns separately asserted null. No released migration changed. Full settlement capture, COD remittance/correction, receipt-component attribution, export and the production settlement workspace remain pending; this is partial #144 evidence.


### #144 agreed-period fee sources and current qualification

Approved term revisions also support `agreed_period`: an explicit INR amount and half-open covered period. A current franchise admin records an earning against that exact current active revision. This is an explicit agreed entitlement, not an inferred delivery count, salary schedule, automatic accrual or assertion that a parcel was delivered. The immutable earning freezes its basis and covered dates, with null proof/parcel references. Per-delivery earnings still require genuine completed proof. Current authority is checked before exact replay; a historical entitled agent may have departed, while new term configuration requires a current local agent.

SQL and service checks reject duplicate/overlapping agreed earning periods and prevent the same work being accrued under both agreed-period and per-delivery bases, including after changing term revisions. Adjacent half-open periods remain distinct. Command completion seals exact source intent and audit labels distinguish terms, delivery earnings and agreed earnings. These sources feed the same bounded gross-expense/payment/advance path. An approved ₹20 gross agreed expense with zero cash paid produces no cash leg and leaves ₹20 owed; the database test also confirms an empty shop drawer remains zero. No proof, customer collection or payroll record is manufactured.

The final current ten-case PostgreSQL run passed in 98.279 seconds, with zero failures, skips, cancellations or TODOs (`.codex/144-money-integration.log`). It includes genuine-proof tests of cross-basis duplication in both directions, fee payout concurrency and rollback, agreed source ownership/amount/date immutability, overlap/adjacency, lost-COMMIT retries, current actor revocation and historical agent entitlement, plus all COD/custody/advance and fresh/populated47 upgrade cases. Original 30/60-second case and 300-second file limits remain unchanged. PostgreSQL stopped successfully and verified data/lease cleanup completed. The earlier ten-case run failed its agreed-fee fixture because the zero-cash expense omitted its required payment method; that failed aggregate is retained as `.codex/144-money-integration-20261011100005.log`. Correcting the fixture preserved the production paid-method rule and all assertions.

Planning passes with the exact 102-row matrix and 221 prototype regression declarations plus all 17 negative controls. R35/W62/W63 use authenticated-self scope S with explicit current-franchise and immutable participant requirements; parcel-assignment scope A remains specific to parcels. The two new web regression declarations preserve advance/fee correction source identity; previous declarations, dependency fingerprints, effects and routes remain unchanged. This evidence remains partial #144 qualification. Full quality/build, the complete settlement browser journey and final-head CI/review/merge remain pending.


The API unit/injection suite passed all 703 tests across 52 files (`.codex/144-fee-api-tests.log`). The full web suite passed all 268 tests across 27 files after correcting exact-paise input/display handling (`.codex/144-fee-final-web.log`). The maximum safe integer amount is parsed through BigInt with the same backend bound, and its final paise is retained in displayed/formatted values; signed amounts below one rupee preserve their sign. The earlier owning web precision test failed because the shared input parser allowed only 13 rupee digits; its failure log is retained. The final owning cashbook run passed all 22 tests after showing original advance/later-payment kinds in correction forms and verifying explicit zero-annulment of a later payment (`.codex/144-fee-correction-web.log`). These are controlled web/API checks, distinct from real PostgreSQL monetary evidence and the still-pending full production settlement browser journey.


### #144 manual seller remittance contract

`cod_remittance` reuses the existing exact cashbook proposal, distinct-current-admin review and administrator application. Its immutable request names an owned COD receipt allocation, actual amount/method/company cash location/occurrence, current responsible employee, reason and private payment reference. The allocation freezes its receipt, obligation and approved beneficiary revision; a remittance correction preserves this allocation and original occurrence. It creates the one actual outflow leg, consumes bounded seller liability and creates no expense, fee, customer collection or provider call. Preparation/approval alone changes no paid amount. A linked recording correction appends the cash delta and changes the current reported remittance; it does not claim a new physical transfer.

The owning franchise lock serializes request/review/application with other money producers. Service and raw SQL reject an amount above remaining principal and a second current applied remittance with the same reference for the same allocation. A positive remittance cannot occur before its original receipt occurred; exact instant equality is allowed, independently of later receipt recording or COD reservation time. Zero-amount correcting annulments retain their recovery path. This keeps seller-remittance evidence and physical outflow visible under the same historical cutoff. Exact committed retry retains its original result; a different command identity cannot reuse the same saved allocation/reference to manufacture another payment. Current correction heads drive the private `cod_receipt_positions` view. References remain minimum private financial detail and are absent from the request inbox and audit payload. An original receipt remains reserved for its COD principal even after seller payment: remittance never releases that principal for new freight allocation/refund. Both existing cashbook and agent-money write gates apply to new commands.

Foreign source/location/allocation identity is bound before reporting current source-generation conflicts. This preserves the controlled not-found boundary for nested sibling/unknown references while retaining normal stale-source failures for owned requests. The existing cashbook correction form and strict decoder retain seller source/payment reference, and label the transaction as remittance rather than expense. Complete settlement creation UI and receipt-component attribution are still pending. The approved source-linked reversal below now provides the allocation correction path.

Verification reuses the actual agent receipt/handover fixture: ₹2,100 received once, ₹100 allocated to freight and ₹2,000 reserved for the frozen seller. A genuine full agent-to-office acknowledgement supplies company custody. Manual seller payout/partial recording correction/competing final payments must leave exactly ₹100 in office custody and zero seller liability, with original receipt/freight/debt rows unchanged and zero expense records. Qualify raw capacity/reference guards, distinct approval, disabled-write replay, rollback/lost COMMIT/current actor revocation and populated47 compatibility. The first eleven-case aggregate passed the ten existing cases but failed the new sibling-source assertion because source-version failure preceded ownership binding; the source ordering was fixed rather than weakening its not-found assertion. This failed aggregate remains failed and retained. The corrected eleven-case run passed in 108.251 seconds; a later twelve-case run including reservation reversal passed in 121.378 seconds, with no failures, skips, cancellations or TODOs and successful verified database cleanup.

### #144 approved COD reservation reversal

`cod_reservation_reversal` uses the existing exact request, different-admin review and admin application. It binds the original owned COD allocation and receipt account/custodian, carries no payment method/reference, and produces zero cash legs. It changes classification capacity only; it does not assert refund, seller payment, customer recollection, revenue or expense. Original receipt and beneficiary evidence remain immutable. Historical receipt custody can be corrected after an agent departs without reactivating the agent or asserting a physical transfer. The responsible employee and reviewing/applying admins must still have current local authority.

Current applied correction heads define gross collected principal, reversed reservation, remitted principal, reserved principal and remaining seller liability separately. Reversal plus remittance cannot exceed original principal. Remittance alone preserves the receipt reservation. Both existing receipt writers and COD writers now use net reserved principal for their common capacity equation. A reversal releases capacity for a later explicit freight allocation; correcting that reversal downward is rejected if restoring the reservation would overfill the receipt. Scope, original receipt context and capacity are enforced in service and SQL under the owning franchise lock.

The twelve-case real PostgreSQL run verifies a ₹2,100 original receipt, ₹100 freight and ₹2,000 COD: approved ₹10 reversal moves zero cash, a later explicit ₹10 freight application succeeds, and restoration to zero fails. After a separate genuine departed-agent recovery handover and actual ₹1,800 seller remittance, only ₹190 can still be reversed; two competing final reversal commands produce one effect. It also covers distinct-admin/self-approval rules, foreign source/custodian/franchise, agent denial, rollback, lost-COMMIT same-key parallel replay, current actor revocation, immutable original receipt and no expense. Fresh and populated migration47 upgrades pass; all47 released migration files remain unchanged. The strengthened twelve-case run passed in 122.174 seconds, including direct SQL wrong-receipt-context and reservation-restoration capacity rejection, plus a valid unchanged zero-leg recording correction as control. There were zero failures, skips, cancellations or TODOs; PostgreSQL stopped successfully and the verified data/lease were removed. Full log: `.codex/144-money-integration.log`.

API703 tests pass; the full web suite passes270 tests across27 files, and the owning controlled-transport cashbook suite passes24 tests, including reversal source/occurrence preservation and absence of payment evidence. The strict detail decoder rejects any claimed reversal cash leg. The first new browser-transport declaration failed because it attempted correction before asynchronous detail loading completed; it now waits for the loaded source detail, without changing timeouts or weakening assertions. Whole-repository lint/tenant AST, API/web typechecks, planning223 declarations/17 negative controls, released47 migration history and diff whitespace checks pass. Full production browser journeys, immutable daily submissions/approval/export and receipt-component attribution remain pending. These are partial #144 results, not completion evidence.

### #144 cash handover receipt/component attribution

Migration48 adds private, server-generated `cash_receipt_component_captures`, `cash_receipt_components` and `cash_handover_attributions`. When both actual acknowledgement legs are present, PostgreSQL captures exactly the acknowledged amount under the existing franchise lock. Components for a receipt freeze at its first attribution: net freight by booking, explicitly reserved COD by original allocation, and residual unallocated receipt money. COD allocation retains its original obligation and seller revision; no To-Pay inference or seller backfill is introduced. Subsequent approved financial classification corrections remain separate from these historical physical-source snapshots. Current liability and the component captured at handover can therefore differ truthfully.

Fungible cash uses stable arrival-credit time/kind/identity order within each location, with original receipt identity as a secondary key and freight then COD then unallocated components. Incoming acknowledgement credits remain separate lots. Outgoing attribution freezes the exact credit consumed. This prevents a later-arriving older receipt from retroactively replacing a source already spent and handed over. Remaining source capacity includes original cash inflows, carried incoming source attribution and accepted outgoing attribution, after ordinary recorded outflows consume capacity in that order. Shop noncash receipts contribute no cash roots. Agent-to-agent and onward office transfers retain the original receipt/component references; they do not create another collection. The order is accounting attribution of amounts, not a claim about physical notes. Historical handovers without attribution remain a distinctly labelled unattributed root; a later transfer carries that uncertainty rather than guessing a receipt or beneficiary.

Attribution rows have owned foreign keys and immutable server-only insert guards. The runtime role has no attribution/capture write privilege and cannot execute the private capacity functions. A deferred command constraint requires exactly the acknowledged amount before commit; reject/cancel commands require zero attribution. Trigger failure rolls back command, legs, component capture and attribution together. Existing idempotent command replay returns its original result and reads the same immutable source rows. No released migration is changed and no historic rows are backfilled.

The private `GET /api/v1/cashbook/handovers/:id/attributions?command_id=...` uses the existing current handover-read authority and exact participant binding before command lookup. It returns captured cutoff, complete acknowledged/attributed/unattributed/unallocated controls and at most100 ordered rows per page. `legacy_unattributed` reports the whole historic acknowledgement as unattributed with no invented rows. It exposes source/booking/COD IDs and capture time, not customer contact, payment reference, OTP or a new directory. Current revocation and sibling scope apply to every page. The existing handover screen now loads this evidence explicitly, labels captured components and later corrections separately, and preserves loading/error/retry/paging and scope-switch clearing through the existing scoped adapter.

PostgreSQL18 documentation confirms that AFTER triggers see changed rows, deferred constraint triggers can validate at transaction end, and row locks serialize conflicting transactions ([trigger timing](https://www.postgresql.org/docs/current/sql-createtrigger.html), [explicit locks](https://www.postgresql.org/docs/current/explicit-locking.html), checked11 October2026). ShippingCo adapts these established mechanisms to the existing franchise lock and exact paired handover, without a new provider, dependency or clearing account. The operating cost is private immutable source rows and scoped source-capacity queries; correctness is checked through real SQL failure/rollback, same-key uncertain replay, competing acknowledgements, partial carry/onward transfer and populated47 history.

Initial migration/compatibility qualification passed12 cases in121.818 seconds. The next genuine source/API run passed13 cases in132.925 seconds, with zero failures/skips/cancellations/TODOs and verified cluster cleanup. Its source case uses one ₹2,100 agent cash receipt and a separate direct shop UPI receipt: ₹2,090 transfers as ₹100 freight plus ₹1,990 COD, the same original receipt carries the remaining ₹10, and onward agent transfer retains those references. A deliberate database attribution constraint proves atomic rollback; lost-COMMIT and parallel same-key recovery do not duplicate rows. Direct writes/edits/deletion, unrelated operator/sibling reads and revoked-agent history are denied. Strengthened14-case qualification now adds two competing half-remainder acknowledgements, later approved COD reversal without rewriting the saved physical snapshot, and actual populated47 handover/ordinary expense/onward unknown-source evidence. The fourteen-case run passed in143.180 seconds. Review then found the older-receipt arrival ordering gap; separate location credits and its genuine regression passed three focused cases in27.651 seconds. All15 current cases subsequently passed in150.685 seconds with zero failures/skips/cancellations/TODOs and verified PostgreSQL stop/data/lease cleanup. Current full log: .codex/144-money-integration.log.

The owning controlled web suite passes25 tests. Its first new negative-control run failed because the test expected an error name not defined by the transport contract; the expectation now checks the actual `TEMPORARILY_UNAVAILABLE` protocol failure and dispatched metadata, preserving all malformed ownership/control cases. The UI loads source evidence after a real controlled acknowledgement and rejects incorrect command identity, component ownership, amount, totals, cursor and legacy classification. The actual private HTTP route qualifies101 independently recorded one-paise receipts:100+1 pages preserve the same cutoff, distinct receipt IDs and complete101-paise controls. Authorized flag-off history reads succeed; unrelated participant/sibling/wrong-parent and malformed cursors are rejected, with private no-store headers. Full API703 and web271 tests pass; current lint/tenant AST, planning224 declarations/17 negative controls, released47 history, typechecks and web production build pass. Complete daily settlement capture/submission/approval/export and the production settlement workspace remain pending; attribution is partial #144 progress.

#### Daily cash capture source foundation (#144, partial)

`agent-settlements/daily-cash.ts` builds the physical-money portion of a future immutable statement in one scoped SELECT. The count instant must belong to the selected Kolkata day and precede the server's capture cutoff. Facts have occurred by the count instant and been recorded by capture; late-entered historical facts therefore change a new capture, while the prior returned frame remains unchanged. Opening carry uses explicitly owned prior-day cash facts, and current-day inflows/outflows use actual location custody, including inactive historical drawers. Named receiver receipts remain separate evidence: direct shop UPI never adds agent cash. Unknown franchise cash sources are a count of uncertainty, without assigning them to an agent by recording actor. Negative recorded expected cash is a labelled ledger exception; variance remains observational, with no receipt, debt, deduction, expense or cash effect.

The source query projects explicit source IDs, exact decimal paise and UTC instants; it excludes customer identities, contacts and payment references. Internal access currently uses the existing admin/accountant `agent_money.read` capability; this does not grant agents or operators a new read path. Source arrays fail explicitly above the existing 5,000-source / 8 MiB capture limits instead of presenting truncated evidence as complete. Computing opening carry currently scans owned history, so work grows with agent history; a source-linked carry baseline is deferred until needed and must preserve late-entry and correction evidence.

Research checked 11 October 2026: PostgreSQL [Read Committed statement visibility](https://www.postgresql.org/docs/current/transaction-iso.html) and [STABLE function snapshot semantics](https://www.postgresql.org/docs/current/xfunc-volatility.html) support a single-statement source frame. ShippingCo's choice to capture all inputs in one SELECT is an application of these guarantees. Several separate queries could observe different committed source generations. Future durable capture must store the exact frame, compare refreshed source evidence before submission, and approve the historical submitted frame under D144-1 rather than perform a cash movement. Durable capture/submission/decisions, parcel and fee/COD statement sections, purpose-scoped agent/operator access, production UI, exports and events remain pending; this foundation does not complete #144.

Foundation qualification (11 October 2026): full #144 native suite passed16 cases in152.645 seconds before the final millisecond-cutoff alignment; the final affected custody/source file passed3 cases in26.646 seconds after that alignment and explicit source cutoff assertions. All other native behavior is unchanged. Real services verify late-recorded one-paise evidence, two-paise prior-day opening, cross-franchise denial and a209000-paise physical handover: it leaves1003 paise currently held and does not change the earlier count's physical closing. Full API704 tests, five owning pure rule cases, API typecheck, focused lint, tenant AST, planning224 declarations/17 negatives, released47 history and configured diff checks pass. No failures/skips/cancellations/TODOs in the qualified native runs; disposable PostgreSQL stopped and its data/lease removed. Exact code/test fingerprint: `65d2f611209d6de3215f37aebce04dcbe5f8b615590ff3b4512c93e4b249de76` (sorted changed/new apps/packages/scripts path, NUL, file bytes, NUL). The first two focused native aggregates failed because the scoped-query wrapper rejects leading WITH and the day alias needed explicit AS; both were diagnosed and corrected with existing assertions and deadlines preserved. This is source-foundation evidence, not durable statement approval or issue completion.


#### Immutable cash captures and current authority (#144, partial)

Physical count/source evidence now persists in `agent_daily_cash_captures`. The private PostgreSQL source function fixes source visibility in one statement and the INSERT guard derives the snapshot/cutoff itself; runtime/public have no direct function EXECUTE grant. UPDATE/DELETE and client/owner attempts to supply derived evidence are rejected. Capture keys are actor/franchise-scoped and preserve exact immutable retry results after uncertain commit. No monetary version, cash leg, expense, debt or deduction is produced. A bounded purpose-scoped preflight supplies clear date/source-limit errors; the independent SQL guard remains the authority for stored evidence. This adds one private table/function/guard and reuses the existing source view, tenant authorizer, idempotency and rollout flag rather than introducing a new financial ledger.

R36/W64 implement the owner-approved minimum cash-capture grants: agent self, operator-prepared requests, franchise-admin historical recovery and existing selected-franchise finance readers. A role downgrade is checked before read/replay; a former admin with only agent membership cannot recover another agent's old capture through a saved key. Revocation removes agent access while the current owner can read and capture historical sources. POST/GET cash-capture HTTP uses normal session/origin/CSRF and private/no-store responses, default-off/demo-forbidden agent-money rollout, with authorized exact flag-off replay/history.

Final native17 cases pass in 380.531 seconds on code/test fingerprint `138209cdf98c59de62555b9d258c0dec3ea65a5ecb13b3c080f3701012c0cd46`; fresh/private-empty/no-op48 and real populated47 are included. Real HTTP and service cases cover minimum ownership, SQL forged source/actor rejection, owner immutable writes, preinsert rollback, lost COMMIT plus parallel exact retry, current revocation and admin-to-agent downgrade. API704 tests, typecheck, whole lint, tenant AST plus26 checker controls, planning104 role rows/224 declarations/17 negatives, released47 history and diff checks pass. The first capture aggregate failed because the administrative test helper deliberately sanitizes database errors; it now uses the supported owner pool and retains explicit23514 assertions. The route checker required the same exact request.query-as-data exemption as other HTTP registration modules; direct query calls remain forbidden and26 controls pass. Original deadlines/required cases/assertions are preserved.

This is an immutable physical-money input, not a submitted or approved daily settlement. The full COD/fee/parcel frame, exact submission and distinct-admin approval/correction, trusted events, settlement workspace and exports still require implementation and qualification before #144 can be complete.

#### Same-cutoff COD and fee evidence (#144, partial)

Cash captures now include a server-derived `finance` section. A private STABLE wrapper obtains cash and finance in one calling-query MVCC snapshot and passes the exact cash capture cutoff into the finance function. The function reconstructs applied correction heads using only effects recorded by that cutoff, with monetary occurrences within the count window; it does not read current position views for historical captures. Freight allocation/release evidence uses the committed receipt command's recorded timestamp. Original receipt identity, COD obligation/beneficiary revisions, genuine delivery proof and fee-term revisions remain source-linked. A later corrected payout or advance cannot rewrite an earlier stored capture or a historical cutoff query.

The section separates receipt funds, freight applied, COD reserved/remitted/reversed and remaining seller liability, earned expense, direct fee payment, physical cash payment, noncash payment, explicit advance applied, remaining fee and unapplied advance. Receipt-origin seller liability is expressly not agent debt and persists after physical handover. Receipt-origin views are non-additive across receiver/custodian perspectives: company reports must deduplicate receipt/allocation IDs rather than sum agent statements. Direct shop UPI appears as receipt evidence without adding physical agent cash. A per-delivery earning uses the genuine proof completion as its effective event; an agreed-period earning uses its explicit recorded entitlement, without inventing proof or asserting that a future period has already completed. Accepted owned-participant handovers include minimum immutable component/source references, while old handovers lacking attribution retain an explicit legacy count.

The snapshot projects IDs, timestamps, methods and exact decimal paise, without customer/contact fields, beneficiary names or private payment references. Its complete cash-plus-finance source count is bounded to5,000 entries and its stored JSON to8MiB; SQL program-limit failures become public `REPORT_LIMIT_EXCEEDED` and roll back the capture. One real-service boundary case records1,670 additional one-paise receipts: the combined5,015 source entries reject the new count without saving a capture or changing money versions, while the earlier count returns its complete smaller source set. Source arrays are never silently truncated into a saved frame. This limit includes lifetime source evidence, with multiple entries per receipt; advancing the business day does not reset it. Qualifying larger histories requires a source-linked opening carry design before use at those volumes, not truncating evidence or assuming daily reset.

Research checked11October2026: PostgreSQL [STABLE query snapshot guarantees](https://www.postgresql.org/docs/current/xfunc-volatility.html) and [recursive source-chain queries](https://www.postgresql.org/docs/current/queries-with.html) support the wrapper and historical advance/correction reconstruction. This application of PostgreSQL guarantees is ShippingCo's design; it is not a claim about another company's architecture. Cost is three private SQL functions and bounded source materialization over owned franchise history, with no additional ledger, provider or queue. Full parcel outcomes, exact settlement submission, distinct-admin approval/correction, trusted events, UI and exports remain pending; cash/finance capture is not settlement approval.

Direct fee payment includes both cash and bank/UPI payouts. `fee_direct_paid_paise` is the total direct payment; `fee_cash_paid_paise` is physical cash only and `fee_noncash_paid_paise` is the remainder. Fee positions expose the same distinction. Remaining entitlement subtracts direct payment and explicitly applied advances once. Financial effects and advance positions retain their payment method. A real approved UPI fee expense must settle its earning without adding physical agent cash. The existing request field `fee_cash_paise` retains its established direct-payment meaning for compatibility.

Finance-frame qualification (11 October 2026): final18 genuine PostgreSQL cases passed in423.376 seconds with zero failures/skips/cancellations/TODOs and verified disposable-cluster cleanup. Focused bank/UPI fee control passed in43.790 seconds. Historical correction/remittance/reversal cutoffs, cash/custody attribution, populated47 compatibility, concurrency/replay/rollback, private capture authority and real combined-source overflow all remain qualified. API704, type/lint/tenant-query, planning and released47-history evidence remains valid for the affected code; method-specific type/lint/query checks and final planning/diff passed. Code/test fingerprint `f018709a83d0c1f48506f9fc3f2c467284d8bba8d45349fad3b48d25d98f03f1`. Full daily submission, approval, parcel assembly, UI and exports remain pending; this is partial #144 progress.

#### Same-cutoff parcel reconciliation (#144, partial)

`source_snapshot.parcels` derives physical custody from immutable #143 receipt chains at the same cash/finance count and capture cutoff. Opening held parcels use the last known receipt before the Kolkata day; closing held parcels use the last known receipt by count. Day receipt transitions distinguish agent receipt, genuine recipient delivery, actual office return and acknowledged transfer to another agent. The flow equation is opening + received − delivered from custody − returned to office − transferred to agent = held at count. A source release or missing-parcel report does not move custody. Discrepancy references remain evidence even after the parcel is actually returned.

Genuine delivery proof is a separate measure with its immutable proof ID, completion instant and committed delivery-command cutoff. Legacy proof without tracked physical receipt is explicitly counted as `untracked_proved_deliveries`; it never fabricates an agent receipt or a physical return. Proof totals and custody-delivery totals are overlapping perspectives and must not be added. The source projection excludes recipient contacts, OTP/challenge material and private payloads. Held positions, transitions, proof and discrepancies count toward the combined 5,000-entry / 8 MiB bound; oversized inputs still fail atomically. Historical reconstruction uses immutable receipt and proof commands rather than today's mutable parcel/attempt state. Full immutable submission, distinct-admin decision, correction, trusted events, UI and captured export remain pending.

Parcel-frame qualification (11 October 2026): final20 genuine PostgreSQL cases passed in507.710 seconds with zero failures/skips/cancellations/TODOs and verified disposable-cluster cleanup. The focused two-case parcel file passed85.935 seconds: genuine missing/actual return/tracked and untracked proof, mathematical next-day carry, persisted reload/historical cutoff/sibling isolation/privacy, source release and actual target acknowledgement reconcile independently from money. Existing17 source/authority cases plus the real combined-source bound remain qualified. API typecheck, focused lint, planning/diff pass; unchanged API704 and web271/build evidence remains applicable. Code/test fingerprint `c4e60fdd5ad051ae6cc0ce0b39e31212d8c4a8c7422a0366a9af6493db32d000`. Full settlement submission, distinct-admin decision, correction, trusted events, workspace and export remain pending; #144 is incomplete.

#### Immutable daily submission and independent review (#144, partial)

A submission binds one saved cash/finance/parcel capture to an immutable agent/day revision. The server derives agent, day, revision and time; clients provide only the capture, expected previous revision/reference and an explanation. A new revision requires a new capture and links the current predecessor. Pending, rejected and approved predecessors remain available with their original capture and any original decision. Later revisions mark older revisions superseded in current views without editing their evidence. Operator corrections require their own authorized predecessor; agents remain self-bound, and current franchise admins may handle local historical statements.

D144-1 is enforced in both current membership authorization and PostgreSQL: only a different current franchise admin approves or rejects the current revision. There is no sole-admin exception here. Approval confirms the submitted count, source frame, discrepancies and recorded carry; it creates no receipt, cash handover, customer charge, COD netting, fee expense or payout. Those retain their separate approved workflows. A shortage remains an explained observation. Captured source history backs opening carry; an approved statement does not overwrite actual source-ledger custody with its reported count.

Submission and approval reconstruct the same counted window at a fresh server cutoff and compare full relevant cash/finance/parcel source identity. Capture times and the coarse franchise cashbook version are excluded from identity: an unrelated later-occurrence receipt cannot invalidate an earlier count merely by bumping that global version. A late-recorded event within the count window changes the relevant evidence and produces `VERSION_CONFLICT`; prepare a fresh capture and linked revision. Rejection may resolve a stale pending submission. Superseded/already-decided revisions and mismatched predecessors also reject current writes. Exact committed-key replay returns its original immutable result after current authority checks, even with entry disabled; conflicting key/body fails.

Source-derived `agent_settlement_events` append submitted/approved/rejected evidence atomically with the immutable source row. Runtime cannot insert events, and owner-trigger controls reject fabricated source identity or edits/deletion. Standard audit history projects safe source action/actor/correlation/time rather than raw financial payloads. These are durable private event records; public event-consumer/catalog integration, full production workspace and captured export remain pending.

Research checked 11 October 2026: PostgreSQL [row locking and transaction lifetime](https://www.postgresql.org/docs/current/explicit-locking.html) supports reusing the existing organization-then-franchise serialization order. PostgreSQL [row-trigger behavior](https://www.postgresql.org/docs/current/trigger-definition.html) supports deriving protected fields before insert and appending source-derived evidence in the same transaction. ShippingCo applies these mechanisms with composite ownership, immutable revision/decision rows and unique source/event keys. Cost is three private tables and small trigger/service code; no new ledger, provider or background queue. Real competing-review, rollback/uncertain-commit and direct-SQL controls verify this application.

Submission/review qualification (11 October 2026): final23 genuine PostgreSQL cases passed in582.363 seconds with zero failures/skips/cancellations/TODOs and verified disposable-cluster cleanup. The owning review file verifies independent concurrent review, no financial side effects, lost submission/decision commit recovery, stale and irrelevant source distinctions, immutable correction history, source-derived event/audit controls, private HTTP/CSRF, current revocation, denied org-admin/accountant/read-only writes, foreign/unknown predecessor parity and genuine101-header pagination. Earlier failure used the wrong validation error name; the next exposed cutoff-string normalization. The corrected implementation retains exact cutoff assertions. Full API704, whole lint/tenant AST, API typecheck and planning106 roles/224 declarations/17 negative controls pass. Code/test fingerprint `35d9589b12155fecc2faf808961b6f3d512d9e5ad0308e6e434d1be9d092d845`. Production workspace, captured export and public trusted event-consumer integration remain pending; #144 is incomplete.

### #144 production statement workspace — 11 October 2026 (partial)

The production `Agent settlements` workspace now uses the existing scoped API lifetime to capture, separately submit, read immutable revisions and record a different current franchise administrator’s approval/rejection. Operators select an authorized agent reference through the existing custody selector; agents are self-bound. Existing identity stores have no person display-name field, so references use the established account-reference labels without exposing login identifiers or inventing names. A current admin can prepare a correction of an owned historical agent statement even when that agent is absent from the active selector. Corrections preserve agent/day/predecessor/version and require a new immutable capture. Agents/operators/accountants cannot approve; submitting administrators see an explicit different-admin requirement. Accountants have evidence-only access. Current scope loss clears private evidence, and an uncertain command retains its exact intent/key while navigation and franchise changes are guarded.

The browser projects a complete allowlisted cash/finance/parcel frame, validates the common count/cutoff, bounded source counts, source ownership and exact integer-paise equations, and displays totals independently of collapsed/paged source disclosures. Incoming handover components may retain another receiver’s original receipt; they do not become the current custodian’s origin-receipt seller liability. Origin receipts, cash custody, seller COD, gross earned fees, recognized expense, direct/cash/noncash payments, applied advances and fees still owed remain separate. Genuine proof without a physical custody receipt is explicit; reported missing/failed attempts do not imply return. Recorded decisions remain visible on superseded revisions. Monetary aggregates are formatted with BigInt, never rounded through Number.

Qualification: controlled browser-transport/component tests cover separate capture/submission, lost-response exact retry, derived revision/reviewer response binding, source projection/arithmetic, the ₹2,000 COD/₹100 freight/₹40 fee cohort, ₹10 advance/₹30 noncash fee payment, incoming peer-origin attribution, explicit agreed-period sources, historical-agent correction, private scope clearing, accountant read-only and no self-approval. Full web279 tests passed in29 files before the final narrow-screen wrapping fix; final affected tests/types/lint/build qualify that fix separately. Whole lint/tenant AST and planning106 role rows/232 declarations/17 negative controls passed. These component fixtures are controlled transport evidence, not database or provider qualification.

An actual browser used production React/Fastify and disposable PostgreSQL18.6 sources with a real receipt, freight allocation, COD reservation, genuine OTP delivery proof and explicit fee accrual. The operator captured/submitted ₹2,100; own-agent evidence showed ₹2,000 seller liability/₹100 freight/₹40 unpaid fees with no approval control. An independent admin approved revision1, then submitted a linked ₹2,090 count correction and could not approve it. A different admin approved revision2: expected custody stayed ₹2,100, shortage ₹10, seller liability ₹2,000 and fees owed ₹40. Revision1 retained its original approval after supersession. Switching to the sibling franchise cleared all old private evidence; an accountant had no capture/review controls. Keyboard Tab reached a visible outlined capture control and Enter captured through the real API. At390px, initial list buttons caused462px document overflow; wrapping fixed it to381px with no horizontal overflow, including accountant evidence. Both browser fixtures/servers were stopped with exit0; PostgreSQL data/lease cleanup and no3061/5173/55464 listener were verified. The first fixture lacked the reused custody access-audit grant; it was cleaned up and corrected with `prepareCustody`, without changing production grants or weakening tests.

This is statement workspace evidence, not completion of #144. Bounded E03-authorized captured exports, remaining owner COD/fee configuration/accrual and payment journeys, required trusted event-consumer integration, complete final quality/CI/review/merge/main cleanup remain pending. The separately approved statement decision never performs a physical handover, remittance, expense approval or payout.


### #144 captured statement CSV - 11 October 2026 (partial)

The statement workspace now exposes E03-authorized capture/download for franchise admins and accountants through the production API. The exact approved settlement review policy remains D144-1; exporting never approves a settlement or performs cash handover, seller remittance, fee expense/payment or correction. Agents/operators and org-admin-only users have no export privilege. Existing actor-owned `report_snapshots` provide exact-key recovery, serialized quota20, immutable24-hour artifacts and expired payload purge; released migrations are unchanged. Four labelled summary rows are stored in metadata separately from up to5000 complete source rows, preserving the released storage row constraint and full CSV source coverage. CSV uses public scalar field allowlists, shared versioned column schema, exact paise, Kolkata/INR metadata, formula neutralization and8MiB bounds. Unknown contacts, OTP/private root credits never enter export projection or client state.

The workspace retains frozen revision/status, original count/source cutoff, distinct export cutoff, source count and expiry. Capture recovery retains the original intent/key; current server authority is checked before download. Source rows and nonadditive cash/origin-receipt liability/earned-expense-payment summaries are explicit. The existing financial-effect field `fee_cash_paise` means all-method direct payment; this export names it `fee_direct_paid_paise` and retains actual method plus separately derived cash/noncash totals. Historical export remains read-only when money-write entry is disabled.

Controlled transport/component qualification: eleven affected tests pass, including exact uncertain export recovery, wrong returned statement/tenant/expiry/cutoff/count rejection, private response projection, CSV column/byte bounds, accountant capture/download and scope clearing. The native export cases passed genuine rollback/lost-commit recovery, 125-source complete100/25 pagination plus four summaries, frozen saved status/data after linked correction, current role/actor/franchise isolation, genuine membership revocation, quota20, expiry/purge without durable statement loss, CSRF and access audit with money writes off. Expiry alone uses the established test-only owner retiming fixture with immutable production guard rejection and exact24-hour spacing; it is not a fabricated historical financial source.

The affected review/pagination native run exposed a millisecond-boundary assumption: the first application-clock cutoff could precede the last just-committed row, legitimately leaving100 visible rows and no next cursor. List cutoff now comes from owned PostgreSQL `date_trunc('milliseconds', statement_timestamp())`. The test waits for the actual database millisecond boundary to include all101 committed rows and retains its100/1 completeness, identical cutoff, cursor ownership and event-count assertions. No assertion or original60-second case deadline is weakened. Current aggregate qualification is recorded in the checkpoint after rerun.

This remains partial #144: actual browser export qualification, full native/application/final quality gates, remaining owner COD/fee configuration/accrual/payment journeys, required trusted event-consumer integration and final PR/CI/review/merge/main cleanup remain pending. Earlier qualification records describe the code and scope tested at those times.

Current export qualification after the cutoff correction: all six affected native PostgreSQL cases pass with original deadlines and zero failures/skips/cancellations; the cluster stopped and its lease/data were removed. Full web282 tests in29 files and API704 tests in52 files pass; current API/web type checks, whole lint/tenant AST, reviewed planning235 declarations/17 negative controls and web build pass. A required test-only TypeScript override modifier was corrected after the full runtime suite; it has no runtime behavior change and current types/owning lint qualify it. This is scoped local qualification, not full native26/final issue/CI/provider completion.


### #144 actual browser export and owner HTTP - 11 October 2026 (partial)

Actual production React/Fastify against disposable PostgreSQL18.6: an operator captured/submitted a genuine current count, then an accountant captured and downloaded its saved CSV. The actual downloaded file contained seven complete source rows and four summaries with exact210000 custody/200000 seller liability/10000 freight/4000 earned paise. All rows shared saved artifact/status/Kolkata/INR metadata. Enter downloaded identical bytes; keyboard focus showed a solid outline. At390px document width was381px without horizontal overflow, and long references/cutoffs wrapped. A current administrator could also capture; switching to the sibling franchise removed old statement/agent references and the saved download control. Operator/agent had zero export controls; the accountant had evidence/export access without count or approval writes. Screenshot and parsed fictional CSV are retained in the local Goal workspace. API/PG stopped with exit0, verified data/lease removed, temporary viewport reset and browser closed. Vite was intentionally interrupted. Initial dev startup used an invalid data-mode value and exited before serving; the validated `production` mode was used for qualification. A sandbox-blocked loopback stop attempt was retried with already-authorized test-infrastructure access and cleaned up the same live fixture.

The existing COD/fee services now have eight protected production HTTP command routes documented in the API contract. Two genuine native HTTP cases pass under original60-second case limits, zero failures/skips/cancellations/TODOs,20.573s total, PGstop0. They prove versioned beneficiary and explicit agreed-period fee accrual, same-key replay/conflict, disabled-entry completed recovery, no new collection/expense/payment/cash leg, role/sibling/nested-ID/CSRF/mass-assignment denial, stale obligation revision, full receipt capacity rejection and revoked-key recovery denial. A valid agreed earning remains4000 earned/0 expense/0 direct paid/4000 owed. Existing domain native qualification separately covers genuine per-delivery proof, original allocation capacity, concurrent/uncertain effects and forward upgrade; this HTTP subset is not a claim that every new route's valid path or the remaining owner UI is complete.

Fee recording corrections now label the established `fee_cash_paise` value as direct fee payment by the selected payment method. Physical cash and noncash remain distinct in statement summaries; the API field is unchanged for compatibility. The existing fee-correction tests retain their arithmetic, immutable source and exact request assertions while using the accurate label.

Remaining #144 acceptance includes owned bounded source readers/selectors and owner forms for configuration/accrual, new fee expense/payment/advance/remittance/reversal proposals through existing cashbook approval/application, their critical browser flows, trusted event-consumer integration, full native28 and final quality/CI/review/merge/main cleanup. No production/provider/accountant-format qualification or complete issue is claimed.

### #144 owned money sources and owner forms - 11 October 2026 (partial)

`GET /api/v1/agent-settlements/finance/:kind` provides nine bounded catalogs: beneficiaries, obligations, allocations, fee terms, fee earnings, advances, completed proofs, receipts and booked parcels. Current franchise administrators, organization administrators and scoped accountants can read the selected franchise; ordinary operators and agents receive no general finance grant. Each page uses one SQL statement, returns at most 100 rows and carries its own database cutoff. The opaque keyset cursor binds actor, catalog and organization/franchise. Later pages are live reads, not one frozen report or an aggregate total. Current authority is checked on every request.

Catalogs expose only financial references, revisions, exact paise amounts and required dates. Proof references exclude OTP/challenge/contact information. Parcel recorded time comes from the committed booking command, independently of the business confirmation clock. Fee earnings distinguish all-method direct payment, actual cash payment, noncash payment and advance application. Advance identity is the original request; the current correction head is separate evidence. Clients reject malformed ownership, cutoffs, duplicate/out-of-order identities and broken COD, receipt, fee or advance equations before rendering.

The production settlement workspace now has an explicit COD/fee view. Franchise administrators select owned sources to create/revise beneficiaries and parcel COD, reserve actual receipt funds, configure explicit fee terms, and record completed-proof or agreed-period entitlement. Accountants and organization administrators have source-only access. Configuration/accrual does not approve expenses or move cash. Commands keep their exact original body/key through uncertain recovery, lock navigation, and clear the form after a confirmed write or explicit refresh. Source pages show their own cutoff; loaded pages are not represented as a single complete snapshot.

Qualification: the two genuine PostgreSQL source cases passed in 29.928 seconds, with zero failures, skips, cancellations or TODOs and verified cluster cleanup. They verify genuine proof/receipt/expense/advance data, UPI direct fee payment with unchanged physical cash, 102-source complete pagination, actor/kind/tenant-bound cursors, role and sibling/foreign isolation, minimum projections and current membership revocation. Earlier failures identified a fixture business clock used as a parcel recorded timestamp, an invalid noncash receipt receiver/custodian pair and missing delivery-read preparation for the empty proof catalog; the correction preserves cutoff and authority assertions. Three controlled client/UI cases verify exact reconciliation, minimum projections, uncertain key recovery, navigation locks and accountant read-only forms. Full web 285 tests across 30 files, API/web type checks, whole lint/tenant AST, planning (238 reviewed declarations/17 negative controls) and web build passed.

Actual browser evidence uses production React/Fastify with the disposable native PostgreSQL fixture: seller creation, revision to version 2 and explicit 2000-paise COD for a second booked parcel were recorded and reread. The accountant saw the catalogs with no configuration form. At a 390-pixel viewport, document width was 381 pixels; keyboard focus was visible. Fee-term date entry was not browser-qualified: the automation input rejected the datetime-local values, so no term/earning was submitted in that attempt. Screenshot is retained locally in the goal task's `work/144-owner-sources-mobile.png`.

Remaining acceptance: new remittance/reservation-reversal/advance/fee expense/payment proposals through the existing independent cashbook approval/application flow, remaining configuration/accrual browser journeys, trusted public event-consumer integration, full native 30-case cohort and final quality/CI/review/merge/main synchronization and cleanup. #144 remains open and incomplete.


### #144 money requests and browser qualification - 11 October 2026 (partial)

The admin cashbook now creates source-backed advance, fee expense, fee payment,
seller remittance and unused reservation-reversal requests. It retains the existing
different-admin review and exact approved application. Selectors use owned current
fee, advance, allocation, receipt, location and staff sources. The fee expense keeps
gross entitlement even when initially paid zero; a later payment applies the original
advance request and creates a cash leg only for the direct amount. Reversal permits
only the original receipt account/custodian and moves no cash. Current agent-held
cash is eligible behind the agent money gate; responsible staff and reviewers remain
operators/admins and agents gain no ordinary ledger permission.

Genuine production React/Fastify/PostgreSQL browser actions recorded and independently
applied one INR40 expense with zero initial payment, a separate INR10 cash advance,
and INR30 direct cash plus INR10 advance application. Saved sources showed earned
4000, expense4000, cash-paid3000, advance-applied1000 and remaining0 paise. Separate
INR1000 seller remittance and INR10 unused reservation reversal left collected200000,
remitted100000, reversed1000, reserved199000 and remaining99000 paise. An explicit
agreed period from 9 October midnight to 10 October midnight Kolkata was entered
through the browser keyboard and produced one INR40 earning for another agent with
zero expense/payment. Source reads preserved the exact UTC period boundaries.

The actual browser found two recovery issues. Source validation initially rejected
current agent cash custody; the narrowly gated current-membership checks and forward
migration now permit it while preserving responsible-staff authority. Canonical
fractional timestamp spelling initially left a committed request uncertain; retrying
the retained exact intent after the client comparison fix confirmed the same request,
without replacement. Timestamp comparison accepts only the same instant; controlled
regressions reject changed occurrence, amount, direct payment and agent identity.

The focused native source cohort passed all three cases in38.004 seconds, including
real expense/advance/payment effects, same-key replay, one expense/receipt, denied
self approval, gate-off and revoked custodian. The focused web run passed28 cases in
8.19 seconds. The 390-pixel money request viewport had document width381. Local
screenshots are `work/144-applied-fee-payment.png` and
`work/144-money-requests-mobile.png` in the goal task; all data is synthetic.

The remaining event-contract question is resolved by the private source-derived
journal documented in [event contract](event-contract.md#agent-statement-journal-144).
There is no required asynchronous side effect or automatic consumer in this scope.
Earlier references to pending public consumer integration were speculative; approval
and protected journal evidence are atomic, and notifications/payout automation are
separate scope. Full31 native qualification, remaining owning journey evidence and
final quality, review, CI, merge and main cleanup remain pending. #144 remains open.


### #144 final owner and agent browser paths - 11 October 2026 (partial gates)

The remaining source-browser fixture kept actual completed OTP proof unearned until
the owner selected its current term and accrued4000paise in the production page.
An attempt to revise already reserved COD was rejected by the existing frozen-source
rule. The owner then created an explicit2000paise COD obligation on another parcel
for the same customer and reserved a separately recorded unallocated2000paise receipt
through the production selector. Neither action manufactured delivery proof or another
collection. Earlier agreed-period browser evidence remains separately qualified.

Browser qualification exposed a missing agent UI entry: handover APIs were permitted
but ordinary cashbook navigation correctly remained unavailable. Agent settlements
now opens only the existing handover workflow with bounded own-sending source
discovery. It exposes no general cashbook/account/expense grant. Two focused web
regressions verify that entry, exact uncertain retry/navigation lock, own-custodian
projection/paging guards and canonical identical occurrence recovery. All eight
focused handover/statement workspace cases passed. The owning native file passed all
five cases in59.858seconds, including actual100+1 source pagination and revoked
continuation. Its preceding4/5 run failed only because a new malformed-cursor assertion
expected400 instead of the established422 validation response; that failure remains
in the retained log. Original deadlines and assertions remain intact.

Actual agent browser actions requested210000paise with zero accepted cash. The named
operator acknowledged209000paise, leaving1000paise with the agent. Captured provenance
showed10000 freight and199000 COD, with zero unattributed amount. The agent captured
and submitted an actual1000paise count against1000 expected custody, while origin
seller liability stayed200000paise and unpaid earned fee4000paise. A different current
admin approved that statement without economic movement. The agent reread its saved
partial handover. At390px document width was381px; the observed clipped inbox label
was fixed with the existing wrapped-button pattern and visually rechecked.
Local synthetic screenshots: `work/144-partial-handover-carry.png` and
`work/144-agent-handover-mobile.png` in the goal task. Fixtures stopped with PostgreSQL
cleanup; tabs closed and viewport reset.

The preceding complete14-file31-case native run passed in384.608seconds with zero
failures/skips/cancellations/TODOs at code/test fingerprint
`80f8e04ab967ae482035c5a2ac0fbc5c4b417edb368517603269fd9bdd524b46`.
The added own-source API was subsequently qualified by the five-case owning run;
that earlier aggregate is not relabelled as a run of the later diff. Required broader
quality, final-head CI, review, merge, issue closure and main cleanup remain pending.


The configured aggregate exposed stale released migration-count expectations in
the existing schema upgrade tests. A focused PostgreSQL18.6 diagnostic established
that migration48 applied successfully (48 actual versus47 expected). The upgrade
expectations now include48; limited historical installs, rollback checks, retained
fixture snapshots and repeated no-op assertions remain unchanged. The exact table
and ledger inventory includes the new owned agent/COD tables, and the synthetic
forward booking repair follows48. All six focused migration cases passed with
zero skipped/cancelled/TODO cases and disposable-container cleanup. This explains
the failed aggregate; it does not make that aggregate a passing run.


The later API aggregate exposed the same stale total in nine legacy API fixture
files, including custody's full-install helper. Only final unbounded migration
counts were advanced; initial limited installs, retained source snapshots and
no-op expectations are unchanged. All15 legacy custody cases passed after the
correction, including populated upgrade, role revocation, races and real proof.

CI at `fe1fa2de` passed its five quality jobs and83 schema cases but was cancelled
at the existing15-minute database-job limit before an API aggregate result. It is
not qualifying completion evidence. Fixture grant preparation now reuses knowledge
of a successfully completed full default install instead of repeatedly invoking
the migration runner as a no-op. Explicit migration calls always use the real
runner, and alternate/partial/failed attempts invalidate that knowledge. Grants
still execute on every preparation. The existing lock-disconnect case verifies
real grants, cached preparation under the held lock, rejection of explicit migration,
invalidation after that failure and recovery. All six migration cases passed.
The same five-case agent-cash file passed in53.210seconds versus59.858 previously;
no deadlines, concurrency limits, assertions or registered cases were changed.
DB/API type checks passed. Fresh complete verification and final PR gates remain
required; neither earlier failed/cancelled aggregate is relabelled as passing.

### #145 reviewed physical drawer closing

`cash_close_sessions` form one linear sequence per owned cash location. Immutable
`cash_close_commands` retain each open, count, submission, decision and reasoned
reopen; SQL guards alone update the compact session projection. No closing command
inserts a cashbook source, receipt, expense, debt, payroll deduction or spending grant.

For a count window `(opening_at, counted_at]`, expected attributable cash equals
accepted physical opening + actual cash inflows − actual cash outflows. Variance is
counted − expected; shortage/excess remain separately visible explained discrepancies.
For example, ₹1,000 opening + ₹5,000 receipt − ₹800 expense expects ₹5,200. An
accepted ₹5,000 count carries ₹5,000, with the ₹200 shortage still linked. Source-ledger
known position and unknown-custody coverage are separate controls; arithmetic agreement
never proves all real activity was recorded. Pending handovers remain sender custody;
only acknowledged legs move cash. Noncash sources do not enter a drawer's turnover.

The first opening is an attributed physical observation, approved separately or together
with the ending count. Current assigned operators and local admins may record the ending
even when another active actor observed the opening. Initial amount/time corrections append
a reasoned exact linked revision; they never overwrite the original observation.
Each counter submits their own exact capture; an admin cannot approve their own count
by having another actor submit it. Subsequent openings reference the exact accepted
predecessor submission/count and counted instant, including overnight activity without
a midnight gap. Integer paise and optional exact denomination sums include zero counts.

One statement captures complete source identities, native occurrence/recording times,
independent totals and historical pending-handover controls. Submission/approval
rechecks that same interval under the organization→franchise locks shared by money and
membership writers. Later-occurring facts do not invalidate earlier windows. A late
expense occurring at/before the successor's physical opening changes prior reconciliation;
it is excluded from successor turnover, avoiding a second deduction from observed cash.
Capture storage is bounded to 5,000 source/pending records and 8 MiB; overflow fails
without truncation. An oversized anchored interval needs a reviewed storage remedy,
not a fabricated intermediate physical count.

D137 review is `independent`, or `sole_admin_self` with explicit acknowledgment and a
locked count of distinct current active local-admin users. Org-admin-only, sibling,
invited, revoked and inactive grants do not count. This exception is specific to closing;
expense and agent settlement review policies are unchanged. Approved predecessor authors
and administrative reopen initiators do not create additional approval restrictions.

Reopen preserves the accepted predecessor until replacement approval. Each replacement
adds an indexed upstream dependency notice with old/new submissions and whether the
physical amount/boundary changed. An immediate open/submitted successor must explicitly
refresh and resubmit when its predecessor changes. Approved descendants remain immutable
and show dependency warnings; repair proceeds one session at a time. Same-count corrections
change source/dispute meaning, not physical carry. Prior discrepancies remain evidence,
not new cash movements or automatically settled employee liability.

Cashbook's production closing view exposes source controls/paging, count/review history,
current late-evidence comparisons and actor-owned expiring E03 CSV exports. Explanations
remain private authorized history and are excluded from CSV/audit payloads. Automated
source-to-total evidence lives in `apps/api/test/database/cash-close.test.ts`; upgrade
compatibility in `packages/db/test/integration/cash-close.test.ts`. These are synthetic
checks, not bank verification or production deployment qualification.

Owner checklist and recovery:

1. Choose the correct named cash drawer and explicit business date. For its first
   session, record an actual opening time/count; otherwise inspect the exact accepted
   predecessor and its unresolved discrepancies. Count zero explicitly when appropriate.
2. Count the physical notes/coins at the recorded ending time. Optional denomination
   rows must total the observation. Inspect every retained source page, the occurrence
   window, recorded cutoff, coverage and pending handovers. Explain differences before
   submitting the exact saved count; saving a new capture does not edit earlier evidence.
3. The reviewer checks both physical observations, source controls, pending custody and
   shortage/excess reasons. Approve an opening separately when its author must later
   independently review another actor's ending; retain both exact approval references. Another current local administrator reviews a counter's
   own submission. Only when that counter is the sole eligible local admin may they use
   the explicitly labelled self-approval acknowledgment. Rejection asks for a new count
   capture/submission; it cannot alter the submitted one.
4. Start the next session from the approved physical ending count. Keep prior shortage,
   excess and dependency notices visible. Do not enter an expense or deduction merely
   to clear the difference, and do not treat accepted physical cash as new source capacity.
5. For late evidence or an incorrect opening, inspect the original interval. Correct
   initial evidence while open/rejected; ask an administrator to reopen submitted or
   approved sessions for a reasoned linked correction. Retain the actual ending time when still valid. Review and
   approve its replacement, then reconcile each affected successor explicitly. Original
   accepted submissions and exports remain available. A changed chronological boundary
   may require a genuinely new observation; never invent one to make arithmetic fit.
6. An uncertain command blocks navigation: retry the same saved request. A source/opening
   conflict requires refreshed evidence and a new reviewed revision. A 5,000-record/8-MiB
   error requires a reviewed storage remedy for that anchored interval. Disabled writes
   preserve history and authorized exact replay. Lost membership stops access immediately.

| Current authority | Inspect closing | Open/count/submit or correct initial evidence | Review/reopen | Private export |
| --- | --- | --- | --- | --- |
| Local operator | Own drawer sessions | Own drawer; submit own capture | No | No |
| Local franchise admin | Selected franchise | Selected franchise; submit own capture | D137 current reviewer rules | Own captured export |
| Accountant | Selected authorized franchise | No | No | Own captured export |
| Org-admin-only | Selected authorized franchise | No | No | No |
| Agent-only or read-only | No | No | No | No |

Combined roles retain their existing scoped grants; this table does not grant organization
administrators operational powers. Any currently authorized assigned operator or local
admin can observe an ending, irrespective of who opened the session. The exact counter
must submit that capture. Current source/evidence authors remain attributable; an opening
approval is separate from an ending approval when needed. For two admins, A can observe
the opening, B can approve that exact opening and observe/submit the ending, and A can
independently approve B's ending. B's opening review does not approve B's ending. A combined
first-close approval remains available to an admin distinct from both unreviewed observers,
or with the explicit D137 acknowledgment when self-review is currently sole-admin eligible.
An opener can independently reject another counter without approving their own opening;
the review selector applies the eligibility of the selected decision. Each saved opening
review has its own independent/self label even when a combined closing self-reviews the
ending. A departed observer's evidence remains immutable; current authorized recorders can continue.

Correct a mistaken initial amount/time using **Correct initial opening evidence** while
open or rejected. Submitted/approved sessions first need an administrator's **Start linked
correction**. Enter the actual amount/time, optional denominations and supporting reason;
the command links the exact previous initial revision and advances the session version.
Original observations, approved counts, signatures and exports remain unchanged. The new
opening requires its own approval and a fresh capture of the ending against its amended
source interval. A retained ending time is permitted only if still later than that actual
opening. A reason explains evidence; it does not authorize a fabricated observation.

A separate opening approval references the exact revision and is allowed before or after
ending capture/submission. Final closing approval records the exact opening approval used
for independence, even when that approval came after capture. Old count snapshots never
acquire a later approval by mutation. Replacing an opening clears only current opening
approval; the checklist marks its new approval pending and old capture stale. A predecessor
carry cannot be client-corrected: reconcile its originating session instead. Replacement
closing approval marks downstream physical carry changed only when the accepted ending
amount or time changed; opening/source-only repairs still produce provenance notices.


[Issue 145 verification](issue-145-verification.md) distinguishes automated transport,
real source-backed PostgreSQL, actual browser and release-gate evidence.

### #145 qualification: agent statement clock consistency

An existing agent statement list issued a PostgreSQL cutoff but validated the next
page against the application host clock. A deliberately trailing100ms host clock
rejected its own valid cursor. Cursor generation and true-future validation now both
use the owned database statement clock; actor/franchise binding and fixed pagination
cutoff remain unchanged. The real101-row case explicitly covers this skew and still
rejects a future-dated cursor. Existing advance-history fixture boundaries now follow
native database earning chronology instead of assuming host time follows its commit.
No financial producer, historical arithmetic, released migration or deadline changed.
The original aggregate failures were not reproduced without deliberate skew; their
exact original cause remains unproven. [Verification](issue-145-verification.md) keeps
that distinction explicit. The role table above also clarifies existing E03 behavior:
org-admin-only users can inspect closing history but cannot capture/download exports.

The closing view includes a derived checklist for opening provenance, current physical
count, source/coverage evidence, difference explanation, submission and approval.
Captured rows are labelled available for inspection, never automatically reviewed.
A reopened session shows its replacement count/submission/review as pending while
retaining the old approval. Late source/opening changes label reconciliation work
without revoking or overwriting the historical approved evidence. Checklist states
come from the current server detail; no new attestation policy or stored checkbox exists.
