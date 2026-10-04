# Issue #62 local verification

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
