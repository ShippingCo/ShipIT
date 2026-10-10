# Financial operations contract (#137)

Status: **product policy ratified; PR verification and merge pending**. Prepared 10 October 2026
against main `7ff46da`. This is a ratified product contract, not runtime activation of new
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
ratification. Issue #137 remains open until its required decision evidence, checks and review are accepted
and normal review/CI/merge conditions hold. Later external format qualification
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
