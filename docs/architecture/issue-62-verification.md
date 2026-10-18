# Issue #62 local verification

## Completion follow-up — 2026-10-18

Clean main was refreshed with `git pull --ff-only origin main` at
`ad9375b` (PR #180), then branch `issue-62-complete-sales-gst` was created.
Live #62 remains open in M6 (milestone 7); its blocked wording predates the
now-closed #139/#142 prerequisites. #21/#30/#61/#137/#138/#139/#141/#142 are
closed and their producer implementations are in this base. No issue labels or
states were changed. PR #162 is merged at `3eb0e0`; its head's Engineering checks
[run 37209432362](https://github.com/ShippingCo/ShipIT/actions/runs/37209432362)
succeeded. That remote result does not explain the historical local race failure.
Recovered the original #62 final summary/approved statement boundary and #61
foundation summary; ADR 0045 remains the financial authority.

The old four-case sales demo passes unchanged on this base. The remaining work
was integration repair, not another reporting implementation:

- Browser decoders rejected #139's `refund_correction` in reports/current history.
  They now accept it and distinguish reduction of a refund record from money sent.
- Sales statement links used a legacy-only reader and renderer; monthly #142
  documents returned 404. The existing scoped evidence route now reads both
  document kinds. The browser reuses #142's reconciled document decoder and
  displays frozen balances, revision/predecessor and separate advances.
- Membership originally exposed only the first billing document. New captures
  include every owned revision whose frozen lines contain the booking, while
  retaining one sales row per booking. Saved snapshots and issued documents stay
  unchanged. A foreign-franchise statement requires switching to its own scope.

No migration, grants, financial producer, tax policy, payment execution, dependency,
LLM configuration or mutable balance authority was added. One real-PostgreSQL
regression covers late monthly shipments, receipt allocation across two bookings,
separate unused advances, revision links, immutable old snapshots, matching CSV
sums and sibling/unrelated denial. One browser-transport regression covers refund
corrections, both current and saved decoding, and monthly statement drill-through.
The required inventory registers only that new test; other inventory fields are
unchanged. `demo:sales` now includes the existing #139/#142/payment suites.

Research: PostgreSQL's [JSON operators](https://www.postgresql.org/docs/18/functions-json.html)
support checking saved line membership without expanding sales rows. The existing
[single-statement snapshot](https://www.postgresql.org/docs/18/transaction-iso.html)
keeps tax, payments, corrections and document links on one committed view. This is
an application design using scoped saved document membership and bounded saved
payloads; it costs additional reads of issued documents, with no new worker,
ledger or schema. No new regulatory interpretation is involved.

Before the final SQL compatibility correction, `pnpm db:local demo:sales` passed all 31 cases across five
files, with no failures/skips/cancellations/todos and successful container cleanup.
This includes #139's refund-record correction source-to-sales tests, #142's
three-shipment/partial-payment/cancellation/late-document cases, and the historical
two-fitting-collections race. Inspection confirms obligation/franchise row locking
still serializes payment commands; neither current results nor PR #162's green CI
establish the cause of the old intermittent failure. No race fix is claimed.

Final pinned toolchain, 40 tooling tests, planning/inventory, tenant-query/lint,
all five typechecks, production API/web builds, and all 54 released migration
hashes passed. Three focused UI tests pass. The first UI attempt failed because
its synthetic statement omitted reconciled payment/refund evidence and a valid
digest; the corrected fixture passes the unchanged #142 decoder. The first expanded
DB run caught #142's old assertion that monthly documents must be rejected by the
legacy evidence reader. Detailed isolated diagnostics confirmed that assertion;
it now checks equality with the canonical monthly document, retaining all scope
and concurrency assertions. The final 31-case run above passes that updated contract.

`pnpm test` passed 22 testkit tests, 12 DB harness unit tests and 760 API tests,
then failed one of 362 web cases: the existing six-scenario shipment-cost navigation
case exceeded its unchanged five-second deadline. All seven navigation cases pass
alone (affected case 1.643 seconds). This is a failed aggregate, not a quality pass;
isolated success does not establish its cause. The complete web run with two file
workers then passed all 362 tests across 40 files, retaining original assertions
and deadlines (affected case 1.815 seconds). A final default-scheduling run with
all database/browser services stopped reproduced the same timeout. This host
exposes 16 execution threads and 15 GiB RAM. The existing web configuration now
uses Vitest's supported `maxWorkers: 2`, bounding independent DOM environments
while preserving within-test concurrency, every scenario/assertion, isolation and
all original deadlines. Host scheduling pressure is the supported inference;
no navigation business-logic fix is claimed. This small verification correction
is documented in QUALITY_CHECKS and adds no new harness or test. The normal
complete `pnpm test` command passed on this final configuration: 22 testkit,
12 DB harness unit, 760 API, 362 web and three real object-store contract tests. Earlier
database results remain valid because no backend code changed afterward; the
only subsequent UI copy edit calls legacy documents “one-off statements.”
All three real S3-compatible contracts also passed
and the disposable object-store container was removed.

The first full schema shard failed the populated monthly-statement/settings
upgrades. Isolated diagnostics reproduced both failures at their pre-upgrade
sales calls: the new query referenced `account_statements.account_id`, added only
by migration 54 (and a newer account-booking table). The final query instead uses
the existing immutable document payload's line membership and original ownership
columns. Missing `lines` in a legacy payload does not match. No schema detection,
missing-table fallback, edited migration or weakened fixture is involved. This
SQL correction invalidated the earlier database result for capture behavior.
Seven focused sales/upgrade checks passed afterward, followed by all 90 strict
schema tests across 41 files, with zero failures/skips/cancellations/todos and
successful disposal. Tenant-query validation passed again. All four API shards
passed: 146/163/177/101 tests across 20/20/20/19 files, with zero failures, skips,
cancellations or todos and successful disposal. This is complete strict coverage
of all 587 API DB tests plus 90 schema tests. Shard 3 includes final Sales,
payment races, receipts and the 5,001-source contribution case. These final results
supersede earlier focused capture evidence where relevant. The supported existing
CI shards were run serially, without deadline changes or overlapping DB suites.
No single `pnpm db:local quality` aggregate pass is claimed.

Real API/PostgreSQL browser verification used the existing monthly-account fixture:
capture 2099-01-01, inspect one 13,400-paise sale/500 allocated/12,900 outstanding,
follow its monthly statement, verify the separate 1,000-paise advance, and reload
the saved report. Warning/error logs were empty. A 390×844 viewport had document
width 381, no horizontal overflow. The actual downloaded CSV in the user's
Downloads directory was inspected: one row, matching snapshot/statement ID,
gross 13400, collections 500, outstanding 12900. The browser download API call
took unexpectedly long but did return the actual path and file; no native delivery
assumption was used. Synthetic date controls were set through accessibility values
after DOM fill failed to update React state; keyboard activation saved the report.
Both owned services and the disposable fixture database were stopped; the viewport
override was reset. No live customer/provider activity occurred.

Reproduce with the pinned toolchain, Docker and existing test grants:
`pnpm db:local demo:sales`. No new deployment setup is needed. For a manual check,
start the existing `apps/api/test/ageing-browser-demo.ts` disposable fixture (same
two-terminal instructions in reporting.md), capture Sales for 2099-01-01, open
the saved booking evidence and its issued monthly statement, then reload. Expect
one 13,400-paise sale, 500 allocated, 12,900 outstanding, and the statement's
separate 1,000-paise advance; the advance must not become sales collections.

Commit message: `fix(reports): integrate sales with monthly financial evidence`

PR title: `Complete sales reporting integration with finance producers (#62)`

PR body: The merged sales register could not load refund-correction rows or
monthly statement evidence from the completed finance producers. Accept and label
refund corrections, read both statement formats under current report scope, and
include later monthly document revisions without multiplying sales. Reuse existing
snapshots, exact-paise calculations and the canonical monthly document validator.
Keep the query compatible with populated older schemas. Add source-to-total and
browser regressions, extend the existing synthetic verification command, and bound
web test workers after reproducing host scheduling timeouts. No migration or new
financial authority. Closes #62.

PR validation: normal `pnpm test` passes (760 API, 362 web, 34 harness/unit and
three real object-store cases). All five strict PostgreSQL shards pass serially:
90 schema and 587 API DB tests, no failures/skips/cancellations/todos. Real browser
capture/reload/monthly statement/narrow layout and actual CSV bytes match source
totals. Final 40 tooling tests, planning/inventory, lint/tenant queries, all five
typechecks, production API/web builds, whitespace and all 54 released migration
hashes passed after the worker configuration and copy edits. Existing React
`act(...)` warnings and expected SDK warnings from rejected/aborted object-store
streams remain visible; no warnings or assertions were suppressed. No single
`pnpm db:local quality` aggregate pass or current-head remote CI is claimed.
The historical payment-race failure remains unexplained; current focused and full
database tests pass without a claimed race fix. Preserve the documented accountant
review/no-filing boundary. The subsequent explicit user instruction authorizes
commit, push, PR publication and merge after the required gates pass. Deployment
is not authorized.

## Historical implementation evidence — 2026-10-04

Date: 2026-10-04. Branch: `issue-62-sales-gst`. Implementation base:
`cc7088f355258a753776875dbcee9b9219bb2e3e`, freshly pulled main, #61 PR #161.
Initial working tree was clean. No commit, push, published PR or deployment was
authorized or performed. Remote CI for this uncommitted work is therefore pending.

## Base and dependency evidence

The tracker places #62 in M6, milestone ID 7, Reporting, Compliance & Operations.
The milestone has 21 issues; #61 is closed and the other 20 are open at inspection.
#21/#30/#61 are merged ancestors of main. PR #161's seven checks succeeded.
Recovered the #61 and M6 planning chats to confirm the reporting foundation and
the approved ten-module finance expansion; proposals were not treated as merges.

The expanded #62 dependency union is #21/#30/#61/#139/#142. #139 requires #137;
#142 also requires #137/#138/#139/#141/#30 through its dependency closure.
#137/#138/#139/#141/#142 remain open and were not implemented on the base.
The user approved proceeding with the necessary producer subset and account
statements grouping existing charges. [ADR 0045](../adr/0045-sales-and-financial-evidence.md)
records the exact boundary and the wider work that this change does not close.
The remote blocked label is not changed or presented as a readiness certificate.

## Verification and test value

- Exact Node 22.23.2, pnpm 10.34.5, Python 3.12.14; no package/dependency changes.
- `pnpm db:local demo:sales`: four real-PostgreSQL scenarios passed before final
  full-gate execution. They verify persisted source/receipt reconciliation and
  historical rate independence, cancellation/refund and statement invariants,
  authorization/failure atomicity, corrected collection limits, and a populated
  migration-42 to migration-43 upgrade. No skipped assertions or real provider calls.
- Focused unit cases cover nontrivial exact arithmetic for intra/inter/zero tax,
  non-taxable charges, signed rounding, rate normalization and large aggregates.
- React tests cover accessible empty output, reload and saved CSV identity,
  denied export and exact uncertain retry after draft edits. Transport is mocked;
  these tests are not described as database or end-to-end evidence.
- Browser verification uses the actual API and a separately isolated disposable
  database with fictional data, not the mocked React transport.
- Broad gate results and final browser checks are recorded below after completion.

Existing migration tests advance their expected final migration count by one;
released migration files are untouched. The prototype inventory change registers
two sales UI tests and its bounded object-URL cleanup timer, with reviewed regression
dispositions. No exclusions or lint rules were relaxed.

The first broad database run exposed three historical-fixture mismatches: the
table inventory, a repaired-directory migration count, and a pre-30 fixture using
the new payment service before the financial table existed. The old fixture now
seeds a payment through its real v18 command/entry/audit/completion constraints;
production code has no missing-schema fallback. All 14 affected upgrade/sales
checks passed before the final full run. A refund cannot be followed by a
collection reversal that would return the same money again.

Final browser journey used the real API: paid booking → statement → cancellation
→ new report showing ₹134 credit → actual refund → new report showing ₹134
refunds and zero credit → reload → original statement still ₹134. Original and
adjusted component amounts and refund provenance were inspected. Date fields
were operated by keyboard; a 390px viewport check found no document horizontal
overflow, and captured browser error/warning logs were empty. The CSV button
reported success, but the browser tool's download-event wait timed out; downloaded
file bytes were not independently inspected. Matching CSV bytes/metadata are
verified by the API suite. The synthetic fixture database and Vite server were
stopped after inspection. Local screenshot: `node_modules/.cache/issue62-browser.png`.

The existing conversation finance scenario was extended to verify cancellation
and actual refund amounts reach the deterministic customer charge reply, while
the issued receipt stays identical and a recipient remains denied finance access.
All 12 scenarios in that file passed in a separate disposable PostgreSQL run;
lint and all five workspace typechecks were rerun successfully after the test-only
extension. No LLM/provider configuration or live message send was involved.

Final review found and reproduced a timestamp-ordering defect in historical
payment-result reconstruction. The real SQL clock seam dates the first collection
one day ahead, then records a later discount and retries the same collection
reference under a new command key. The timestamp predicate failed that regression.
Migration 43 now uses the financial source's existing `payment_version` versus
the entry sequence, so later corrections cannot rewrite earlier payment results.
The final affected payment/receipt/sales/customer/upgrade suites are recorded with
the completed gate results below; this final change adds no schema column.

## Final gate evidence

The broad `pnpm db:local quality` run passed toolchain validation, 35 tooling
tests, planning validation, lint, all five typechecks, 654 API unit/integration
tests, 194 web tests, three real object-store contract tests and 74 schema tests.
Its API database group exceeded the existing 1,800-second Windows aggregate
budget while an additional isolated database check was also running. This is a
failed aggregate, not a fully passing quality run. No deadline was increased.

After the historical payment-result fix, an affected-suite run reported one
failure in the existing two-fitting-collections race (`payments.test.ts:75`).
The focused diagnostic rerun passed unchanged; its root cause was not established.
The complete database gate was therefore rerun alone instead of treating that
single retry as sufficient evidence. Final isolated results are recorded below.

That isolated run also ended with `DB_TEST_TIMEOUT` after all 74 schema tests
passed. The API database aggregate remains **unverified**; the earlier timeout
cannot be attributed solely to overlapping runs. Its disposable container was
removed successfully. No further expensive rerun was started after the user
requested prompt delivery. Full database-gate completion and diagnosis of the
unreproduced payment race remain a merge-readiness limitation.

Final HTTP review also extended the existing exact-number JSON guard to finance
commands. A route-level regression rejects fractional paise hidden by JavaScript
rounding or underflow before database access. Existing integer request shapes
and database commands are unchanged.

Final API/web build, lint, planning validation and `git diff --check` passed.
The HTTP boundary file passed all 34 tests after registering its finance route
in the test harness (the first attempt returned 404 because that harness disables
application routes). All five workspace typechecks passed before this small guard
change; the final API build also typechecked the guard and regression test.
Released-migration validation confirms all 42 existing migration files unchanged.
These are combined broad and focused results, not a claim that the aggregate
quality command passed. Logs are retained under `node_modules/.cache/issue62-*`.

## Acceptance mapping

| Requirement | Evidence |
| --- | --- |
| Exact gross/GST/components/rounding/collections | Pure arithmetic scenarios and real booked source-to-total checks |
| Current tax settings preserve history | Publish a later different tax policy, compare saved and newly captured old-period rows |
| Original/corrected evidence and actual refunds | Original amounts retained, versioned reductions/refund IDs, old report remains identical |
| Monthly document counts sales once | Unique statement booking membership; report gross identical before/after issuance |
| Own-org aggregation and foreign denial | A/B/C filters, guessed IDs/exports, role denial and membership revocation |
| Matching export, zero/no sales | Saved metadata/rows/totals used by CSV; zero-tax and empty scenarios |
| Reload, retries and failures | New service instance read, uncertain commit replay, changed-key fingerprint conflict, statement insert rollback |
| Privacy | Synthetic API/log inspection; no phone/address/session token/returned-to reference in report/CSV; safe access audit |
| Migration compatibility | Populated old fixture upgraded once, old source amounts unchanged, repeat migration no-op, append-only runtime denial |

## Review boundary

Application summaries and account statements require accountant review; no filing,
government validation, payment execution, statutory credit note or new tax invoice
is claimed. Financial commands require explicit component approval evidence. The
larger credit/account allocation workflows remain owned by their prerequisite
issues. Groq/client/model/reasoning/key configuration is unchanged; customer charge
answers only gain deterministic saved correction/refund amounts.

Suggested commit: `feat(reports): add immutable sales GST summaries and financial evidence`

Draft PR title: `Implement sales/GST reports with immutable financial provenance (#62)`

Draft description: Sales reports now reconcile saved booking/receipt tax components,
approved reductions, actual refunds and account-statement membership without double
counting monthly issuance. Current authorization applies to all selected franchises,
replays and exports. Includes additive migration 43, necessary bounded finance
producers, corrected payment/customer projections, API-backed Material 3 UI and
local verification. References #62; the wider #137–#142 workflows are not closed.

Draft PR validation: final build, lint, planning, HTTP regression and migration
immutability checks pass. Broad API/web/object-store tests and targeted real
PostgreSQL sales/customer/upgrade checks passed as described above. Full database
verification remains incomplete: both aggregate attempts timed out after 74
schema tests passed, and one affected payment-race failure did not reproduce in
isolation. Resolve this gate and verify current-commit remote checks before merge.
