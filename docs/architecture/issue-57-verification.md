# Issue #57 acceptance and verification

Date: 2026-10-03 (IST). Branch: `issue-57-maruti-research`.
[Research report](../integrations/maruti-research.md) · [PR draft](issue-57-pr-draft.md).

## Context, base and working summary

Read the full tracker issue, comments (none), actual milestone **6 / M5 — Courier
Integrations & Pricing**, and its eight associated issues #53–#60. #53–#56 are closed;
#57–#60 remain open. #57's prerequisites are #2/#6/#53, each closed with merged contracts
and locally verified ancestry (`256512a`, `36ce6d3`, `07c667c`). #56 is useful preceding
research, not a prerequisite inferred from issue numbering. Stale `status: blocked` label
remains unchanged; local research does not modify tracker status.

Recovered final decisions, reasoning and verification from **Implement issue #56** and
M5 planning in **Implement issue #53**. No separate M5 planning chat was identifiable;
the actual milestone and #53 sequence supply its relevant context. No missing conversation
blocks this research. Reused #54/#55 docs/code/migrations and #56's merged PR #156, including
its added intermediary research, rather than repeating historical investigation.

Started with a clean tracked working tree; fetched main, checked out main, pulled with
fast-forward only, then created the issue branch at
`f5b84a857aacdfc3ac136b5d14dac429c90440e9`, merged
[PR #156](https://github.com/ShippingCo/ShipIT/pull/156). #56's `7fa9d61` is an ancestor;
there are no commits after its merge in the selected base. At initial inspection five
quality jobs passed and PostgreSQL integration was still running. Subsequent inspection
confirmed all seven checks passed, including PostgreSQL and the final aggregate. This is base CI only;
uncommitted #57 has no CI or independent approval. Preserve other chats' local artifacts.

Requirements: dated precise-carrier evidence, six independent capabilities, access/format
unknowns with owners, manual/file/live comparison, explicit decision and usable fallback,
four-outcome review. Outcome `api_unverified`, live NO-GO, pilot `manual`; public Innofulfill
API documentation exists but authorized branch-account coverage/test access is unverified.
No schema/runtime/UI/configuration/LLM change, provider integration, outreach or deployment.
Existing toolchain runner: `node_modules/.cache/issue35/run.ps1`; logs `issue57-*.log`.

## Nine-step record

1. **History:** instructions, roadmap, actual tracker/milestone, #56 merged base and #53
   planning reviewed. Manual/file are valid final paths; customer prices and estimated/
   actual courier costs remain distinct. No whole-milestone expansion.
2. **Database:** inspected manual-carrier migration, indexed composite ownership, immutable
   mappings/references/docket reservations/observations/receipts and ingestion service.
   R19/W26 scope, organization write lock, atomic receipt/effect/audit and retry behavior
   reused. Research creates no operational records; no migration/backfill/index needed.
3. **Acceptance:** issue is research, not a live implementation/UI. Missing access can
   complete research with evidence-backed fallback; links and matrix below cover criteria.
4. **Research:** public carrier/product/partner sources and rendered v2 developer sections;
   official AWS/Microsoft/PostgreSQL engineering guidance checked for actual design questions.
5. **Challenge:** public API presence does not establish franchise entitlement; callbacks
   lack complete signing/retry details; reference field is not an idempotency guarantee;
   provider examples cannot replace ShipIT proof/tax/money authority.
6. **Approach:** report + acceptance record + PR draft + existing architecture index link.
   Reuse automatic Markdown link/fence checks added by #56; no new scripts, schema or fixtures.
   Manual fallback maps exact dockets to scoped parcels and preserves pending claims.
7. **Implementation:** four documentation files only; no speculative network service,
   credentials, payload storage, provider/client changes or later issue implementation.
8. **Verification:** focused contract/manual/CSV tests and planning/migration checks before
   one required full quality run against disposable development services. See results below.
9. **Delivery:** source/retrieval limits, operator walkthrough, setup and exact validation
   recorded; ready-to-use commit/PR text supplied. Commit/push/PR/merge remain user-reserved.

## Acceptance evidence

All rows are local research coverage; independent evidence review remains pending.

| #57 criterion | Evidence / verification |
| --- | --- |
| Classification, date, confidence; no absence inference | Report Evidence method + C1–C13 matrix and partner leads; API offering positively identified, access separately unverified |
| Authentication, contacts, sandbox, limits, fees/rights | Capability/access tables answer each or name conditional next action/owner; no signup or contact performed |
| Six capabilities; available versus selected | Capability table maps to #53; every network capability false, manual selected; #55 generic CSV distinguished |
| Formats, location/service IDs, reconciliation limits | Sourced sanitized C8 field projection, event/delivery identity/time discussion; no executable fixture or private example copied |
| Manual/file/live feasibility and cost/risk | Alternatives table and engineering decisions; official Innofulfill strongest live lead, file/intermediary unqualified |
| Refused/missing access fallback | Six-step own-franchise manual API walkthrough; sourced evidence remains pending, local booking usable |
| Dated primary sources and explicit live decision | Decision and evidence tables: `api_unverified`, NO-GO / NOT CURRENTLY VERIFIED, selected `manual` |
| Separate outcome/pilot mode | Decision and four-outcome tables; `api_unverified` never operational mode |
| Missing credentials/sandbox not indefinite blocker | Four-outcome review; owners/revisit evidence; no live test claimed or required to substantiate this no-go |
| Commercial/access unknowns assigned | Conditional action/owner table; contact authorization remains explicit |
| Each possible outcome can complete research | Four conditional rows reviewed; denial needs affirmative evidence, unverified access does not mean API absence |
| Research releases only #57 gate after review | #60 slice explicitly retains #58/#59 and qualification; later access is separately scoped, no tracker closure claimed |

## Verification results

Focused current-branch checks passed: 48 tests across contract/manual/CSV suites; planning
Markdown/local-link and domain/security/prototype contracts; migration-history check (38
released files unchanged); whitespace review. Existing planning automatically discovers
new integration reports, as established by #56. No checker change or artificial carrier
fixture is needed. Historical negative checker probes were not rerun against unchanged code.

The first restricted `pnpm db:local quality` attempt failed to access disposable Docker
services (`DB_TEST_LOCAL_FAILED` / `DB_TEST_LOCAL_CLEANUP_FAILED`, plus pnpm EPERM reading
its user configuration). It was not a passing aggregate. Retried with local service access
through the same established Windows runner. That complete aggregate passed with exit 0.

| Current branch command/stage | Actual result |
| --- | --- |
| `check:planning` | Passed; new report/local links/fences and existing contracts validated |
| `check:migrations` | Passed; 38 released migrations unchanged |
| Focused carrier API tests | Three files, 48 tests passed |
| `db:local quality`: toolchain | Node 22.23.2, pnpm 10.34.5, Python 3.12.14 passed |
| Tooling/security | 35 passed, zero failures |
| Planning, tenant-query gate, ESLint | Passed |
| Typechecks | All five workspace packages passed |
| Testkit / DB unit | 22 / 12 passed |
| API / web | 638 / 189 passed |
| Private object-store contract | Three passed; disposable container removed |
| PostgreSQL schema/DB / API database | 69 / 399 passed; zero failed/skipped/cancelled/TODO |
| API / web production build | Both passed; web 168 modules, single-file bundle |
| Aggregate and PostgreSQL cleanup | Exit 0; disposable PostgreSQL container removed |

Logs: ignored `node_modules/.cache/issue57-{planning,migrations,focused,quality}.log`.
Runtime, migrations, fixtures and checkers match merged base `f5b84a8` throughout.
Only documentation changed; source/acceptance review finalized the report and evidence
notes after the broad run, followed by final planning/local-link and whitespace checks.
This is a complete passing local aggregate plus focused/final documentation checks,
not new #57 CI or live-carrier verification. Existing React `act(...)` warnings remained
visible in the passing web suite. No assertions, deadlines, gates or cases were weakened.

Local research criteria are covered. Independent source/decision review, a published PR
and its CI/merge remain pending under the user's explicit approval boundary. No carrier
account qualification, real pilot or completed downstream implementation is claimed.

## Reviewer and operator walkthrough

1. Open the report's C1–C13 URLs without entering tracking IDs, credentials or forms.
   For JavaScript documentation open C7 in a browser and use the named sidebar sections.
   Compare bounded source statements with classification/confidence and selection flags.
2. Distinguish official product API evidence from authorized own-franchise legacy-docket
   coverage. Review exact webhook signing/retry unknowns and remote booking uncertainty.
3. Compare the manual path against #53/#54, including W26/R19, foreign IDs, exact codes,
   current versions, idempotency, immutable history and unknown source timestamps.
4. Run focused fictional demonstration (no carrier sends/account needed):

```sh
pnpm --filter @shippingco/api test test/integration/carrier-contract.test.ts test/integration/carriers.test.ts test/integration/carrier-csv.test.ts
pnpm check:planning
pnpm check:migrations
pnpm db:local quality
```

5. Walk through access refused: local booking → authorized branch handover → scoped manual
   reference → pending observation → lost-response retry preserves same intent → stale/contact
   failure escalates without fabricated ETA/delivery/payment/message. The tests use fictional
   adapters, not proof of actual carrier access or a completed live pilot.
6. Review the four outcome rows. No API credentials required to accept the current research;
   evidence review still required. #60's operational demonstration remains future work.

No setup, new packages, migration, configuration or rollback data operation required for #57.
Existing #54/#55 deployments retain their documented setup. No UI changes justify new browser
journey/accessibility tests. Read-only browser work verified public docs, not application UI.
No live-provider, customer lookup, sandbox request, outreach, account or payment occurred.
Only the linked official developer root was read and returned 401. Retrieval limits are
explicit: JavaScript docs/home needed rendering; Unicommerce direct retrieval failed;
AfterShip was an indexed lead. Carrier terms/public examples are not commercial permission.
