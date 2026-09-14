# Issue #25 verification

Starting main: `336486c97c8f1c99b99f8813f08d47c4028172bc`, pulled from origin after a
clean checkout on 2026-09-14. Branch: `issue-25-bounded-bulk-parcels`. Issues #2–#24 are
closed; #23/#24 PRs #106/#107 are merged ancestors. Their current diffs, verification,
service/SQL tests and architecture contracts were inspected. #34 remains open and owns
full operational UI migration. Issue #25's stale blocked label became in-progress.

[Exact contract](parcel-bulk.md) and [ADR 0015](../adr/0015-bounded-parcel-bulk.md) document
action allowlist, 50-entry rationale/validation/rate bound, sorted deduplication, per-item
atomicity, two-level intent/recovery semantics, privacy, deployment and rollback.

## Acceptance evidence

| Criterion | Executable evidence |
| --- | --- |
| Mixed valid/stale/foreign cannot mutate unauthorized state | API PostgreSQL `bulk mixed A/current/stale, sibling B, unrelated C and unknown`: real A/B/C services create valid ownership graphs; only one A transition; every other version unchanged |
| Safe per-item errors, foreign indistinguishable from unknown | Same test compares exact `{code:RESOURCE_NOT_FOUND}` and rejects foreign version/status/customer details |
| Duplicate ID processed once | PostgreSQL duplicate/concurrent replay test: one command, transition, event and audit per success, despite repeated IDs and parallel same-key requests |
| Failed-only retry cannot repeat successes | PostgreSQL failed-only subset counts two total effects; frontend verifies request contains B/C only and cumulative A result remains |
| Oversized batch rejected before work | Service-free zero-connect test plus PostgreSQL max+1 test: zero receipt/command/transition/event/audit; exact 50 succeeds |
| No OTP/payment bypass | Closed-action malformed envelope matrix and real PostgreSQL prohibited-operation tests; no proof/payment service or generic status mutation |
| Accessible result summary and retry | React DOM panel test checks native selection, focusable actions, pending disabled state, live textual counts, failure text and retry; browser fixture below |
| Happy path survives restart | Lost-response test commits two items, recreates runtime pool/service, recovers both receipts, completes third; repeat returns original results with exactly three effects |
| Sibling B/unrelated C denied | Real mixed fixture plus reverse-scope member tests; live single-item policy, no custody inference |
| Malformed/stale/dependency controlled | Entire envelope unit matrix; real state guards; post-commit fault stops response construction with 503 and same-intent recovery; retained effects counted |
| No prohibited secrets/PII | Real test inspects API DTO, structured logs and Parcel audit for synthetic contact/address/phone/session/raw keys; explicit DTO projection rejects extra private fields |

Tests: `apps/api/test/integration/parcel-bulk.test.ts`,
`apps/api/test/database/parcel-bulk.test.ts`,
`packages/db/test/integration/parcel-bulk.test.ts`,
`apps/web/src/test/parcel-bulk.test.tsx`. No required PostgreSQL behavior is mocked.
The exact role matrix is W07 operator only; W08 operator/dispatcher/franchise_admin.
read_only, accountant, org_admin and delivery_agent cannot gain either action by bulk.
Replay after operator revocation returns canonical 404 without the stored result.

## Persistence and security review

Migration `1789837200000-bounded-parcel-bulk.cjs` adds only immutable scoped intent guards.
Fresh install, upgrade from all 13 main migrations, repeat no-op, failed migration rollback
and fresh retry run on PostgreSQL. Runtime has SELECT/INSERT only; UPDATE/DELETE/TRUNCATE/DDL
and mismatched owner pairs fail. Existing migrations remain byte-identical. Existing
historical upgrade expectations advance by one; no assertions or gates are removed.
The tenant-query AST gate now also explicitly checks all `parcel_*` tables for both owners.

The outer receipt contains no body/result/customer fields or raw key. Its infinite retention
prevents rebinding incomplete intent; current item receipts are not pruned. A future #72
cleanup must coordinate both levels. No new dependencies or provider calls. Underlying
state/history SQL remains solely in #24; bulk repositories contain no Parcel UPDATE.

Known failed items are re-evaluated on explicit same-batch recovery, as documented in ADR
0015. Uncertain outcomes stop the HTTP result; already successful commits never roll back.
Browser intent is ephemeral, purged on scope changes, and not restored after tab loss.
Authoritative retrieval/support reconciliation is required then. This is an explicit limit,
not permission to regenerate an uncertain command. No performance qualification is claimed.

## Local execution record

Pinned Node 22.23.2, pnpm 10.34.5, Python 3.12.14; existing verified local runtimes:

```sh
export PATH=/tmp/shipit-issue8-tools/node-v22.23.2-darwin-arm64/bin:$PATH
export PYTHON=/tmp/shipit22-toolchain/python/bin/python3.12
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local quality
pnpm db:local verify:gates
```

Final implementation checks on 2026-09-14:

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Pass; lockfile unchanged, no added dependencies |
| `pnpm check:migrations` | Pass; all 13 released migrations unchanged, one forward addition |
| `pnpm test:unit` | Pass: 22 testkit + 12 database harness tests |
| `pnpm test:api` | Pass: 272 tests in 15 files |
| `pnpm test:web` | Pass: 95 tests in 5 files |
| `pnpm typecheck` | Pass: all five workspace packages |
| `pnpm lint` | Pass: tenant-query AST gate and ESLint, zero warnings |
| `pnpm build` | Pass: API types and production Vite bundle |
| `pnpm db:local quality` | Pass: complete prescribed aggregate, including 47 DB + 137 API PostgreSQL tests |
| `pnpm db:local test:db` | Independent pass: 47 DB + 137 API PostgreSQL tests; zero failed/skipped/cancelled/todo |
| `pnpm db:local verify:gates` | Pass: all 24 drills, including clean/restored full quality and expected failure propagation |
| `git diff --check` and staged diff review | Pass; reviewed all changed lines, no unrelated files or released migration edits |

The final restored-quality drill also passed 20 tooling tests and **47 DB + 137 API
PostgreSQL tests**, with zero failed/skipped/cancelled/todo. PostgreSQL is the pinned
18.6 disposable harness with separate owner/runtime identities. Sanitized drill logs are
under `node_modules/.cache/quality-verification/` (not committed); the final aggregate is
`24-restored-quality.log`. The normal web run emits an existing AppContext `act()` warning
in the fictional app suite; the new bulk suite passes without that warning.

Initial PostgreSQL runs exposed historical migration-count/name/repair-order expectations
and a revoked-member test expecting 403 instead of canonical 404; these were corrected.
The focused real bulk suite then established mixed-tenancy/replay/restart/max-bound behavior.
No weakened authorization or skipped test is used to correct those expectations.
An initial aggregate invocation omitted the pinned `PYTHON` environment and correctly
failed toolchain validation; reruns use the exact environment above.

GitHub delivery: [PR #108](https://github.com/ShippingCo/ShipIT/pull/108) against main,
with `Closes #25`. Implementation commit: `da882f4463422a1cef0a81449658802371b99efc`.
The [current-head checks](https://github.com/ShippingCo/ShipIT/pull/108/checks) and PR
delivery evidence record the final head SHA, run URL and conclusions after any documentation
follow-up. This document does not claim that publication alone passed GitHub CI. It must
include the required **Planning and prototype checks** aggregate, all five quality jobs
and PostgreSQL integration. A local pass or an older commit's CI is not a delivery pass.

## Synthetic browser reproduction

Run `pnpm dev` in production mode, then open
`http://localhost:5173/src/test/fixtures/parcel-bulk.html`.
This explicitly fictional test-only fixture mounts the real adapter/controller/panel with a
synthetic transport and no API/provider network calls. Select Parcels 1/2/3 with keyboard,
activate Check in, observe 1 completed/2 need attention, then Retry failed. The visible
“Last submitted” output must show only Parcels 2/3. Narrow viewport to 375 pixels; check
wrapping, keyboard focus and live region. Fixture files are absent from production imports.
Real API/DB durability is separately established by the PostgreSQL tests above.

Executed in the in-app Chromium browser on 2026-09-14: Tab/Space selected all three native
checkboxes; Enter activated Check in; pending controls disabled. Completion announced
`2 selected · 1 completed · 2 need attention` and focused the status summary. Tab reached
Retry failed; Enter sent only Parcels 2/3 and finished at `0 selected · 3 completed · 0 need
attention`. At 375×812, content width was 365px with no horizontal overflow; the controls
wrapped and stayed keyboard reachable. Material symbols rendered with existing app fonts.
The browser exposed a focus-loss case caused by disabling the initiating button; the
component now focuses its status after pending completion when focus remains in the panel
or falls to the document body, without stealing focus from another control outside it.

## Delivery boundary

Issue #25 provides the authoritative bounded bulk Parcel API, browser adapter/controller
and accessible partial-result/retry component. Issue #34 still owns the full PackagesPage,
LotsPage, RoutesPage, Dashboard and EwayPage production cutover, authoritative read/refetch
integration and evidence selection. No lot/route/payment/proof responsibility is absorbed.

Deployment: additive schema → least-privilege grants → API → synthetic success/replay and
mixed-tenant denial → observe controlled rates. Rollback disables/reverts compatible code,
preserves all committed transitions/audit/events and receipts, and repairs schema forward.
No browser fallback. PR delivery stops **before merge**. Independent approving review,
maintainer merge, automatic Issue closure and branch cleanup remain outstanding by design.
