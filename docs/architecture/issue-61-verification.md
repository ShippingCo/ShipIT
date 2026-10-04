# Issue #61 working context and verification

Date: 2026-10-04 IST. Base `afd1abdda86ef6c7ce6e261ba1bee01a59cadc37`.
Clean main was refreshed with `git pull --ff-only origin main` (already current), then
`issue-61-scoped-reporting` created. No unrelated local changes existed. No commit,
push, PR publication, merge, deployment or production-data change is authorized.

## Recovered context and prerequisites

Read #60's chat final delivery and checked-in evidence; recovered finance planning
from “Review milestone 4 finance gaps” and the approved additive planning documents.
M4's original seven issues were completed; #152 added planning, not finance features.
Live #61 and its comments (none), the M6 description and its 21 issue bodies were
retrieved. M6 is GitHub milestone 7; #60 belongs to M5, GitHub milestone 6.

Verified #60 merged in PR #160, merge SHA above; all seven checks on its implementation
head `01c24692344c4ae8150fbb548b7573e17ad83c0d` succeeded. Actual #61 prerequisites are
#15/#21/#23/#29, all closed and present in main through PRs #98/#104/#106/#112. The #60
manual carrier decision remains unchanged and is not an artificial report prerequisite.
No missing conversation materially blocks the framework. Historical results are base
context, not evidence that this implementation passes.

Database review: immutable bookings preserve tax/price/customer snapshots; one opening
obligation per booking and append-only collections/reversals own balances. Composite
tenant joins and the existing booking-time/payment-balance indexes are reused. No
contact-table lookup or parcel join is needed. New storage holds only bounded derived
report rows, replay identity and safe access evidence; no financial backfill or change
to released migrations. #137's future financial policy is not silently ratified here.

## Acceptance mapping

| Requirement | Implementation / focused evidence | Status |
| --- | --- | --- |
| Same rows/count/totals/CSV and fixed as-of | Persisted single-statement capture; real ledger change, reload/new-pool and CSV comparison | Verified in SQL/API and browser reload |
| Kolkata day boundaries | Pure inclusive/exclusive UTC conversion and synthetic midnight query fixture | Verified in unit and SQL tests |
| Safe CSV | Quoted/escaped fixed non-contact columns; malicious formula/control/delimiter cases | Unit passed |
| Current permissions, sibling B/unrelated C and foreign IDs | Existing R11/E03 policy, actor-owned snapshots, recheck each request | Focused SQL passed |
| Bounded large export / empty result | 31-day/5,000-row/8 MiB ceiling, zero known totals plus headers | Verified: exactly 5,000 exported; 5,001 rejected |
| Expired download and safe retry | 404 download, 410 replay, fingerprint identity, concurrent capture and injected lost COMMIT | Focused SQL passed |
| Source freshness, missing cost/due date and versioned correction interface | Shared v1 metadata, independent measures and source refs; unavailable producers remain unknown | Implemented; focused contract checks |
| No PII/secrets in output/audit/logs | Allowlisted financial/ID projection; private authenticated no-store delivery | Focused SQL assertions passed |
| Usable production UI | Date/order form, saved totals, fixed pages, reload ID, CSV, loading/empty/permission/error/retry states | 3 mocked React tests plus real browser/API capture and reload; native downloaded file unverified |
| Upgrade/old evidence/query plans | Additive schema, runtime privilege checks, EXPLAIN on fictional cohort | Focused populated upgrade and real query-plan checks passed |

## Verification ledger

- Initial typechecks passed across five workspaces. Pinned Windows runner reused from
  `node_modules/.cache/issue35/run.ps1`; no timeout changes or assertion weakening.
- First unit invocation used the workspace root where Vitest is not installed; corrected
  to the API package and its integration test discovery path. Final **4/4 report unit
  tests passed**, including exact aggregate arithmetic beyond JS safe integers.
- Tenant AST initially rejected a variable action list and the unregistered HTTP query
  field. Replaced with literal action arrays and added the exact report route to the
  existing request-data allowlist. Full lint then passed.
- Docker required sandbox escalation. The final authorized
  `pnpm db:local demo:reports` passed **5/5 PostgreSQL scenarios** (four API/database,
  one populated schema upgrade), and removed its disposable container. Earlier fault
  tests used an invalid raw idempotency header and stopped at validation; those results
  did not prove COMMIT recovery. Corrected headers and a persisted-row assertion now
  prove the injected lost-COMMIT case reached and committed the operation before retry.
- The 5,004-source synthetic fixture initially exceeded the unchanged query timeout in
  one bulk insert. Batching fixture inserts and flushing deferred constraints before
  restoring fixture-only triggers fixed setup. The actual bounded capture, page and CSV
  requests pass unchanged production limits. No production financial rows were edited.
- Initial React run exposed a transient double-render after creation. The screen now
  reloads only the saved snapshot ID; **3/3 React tests passed** afterward. Tests use
  mocked transport and do not claim a live-browser or live-provider journey.
- Migration history check passed with all 41 released migrations intact and one forward
  addition. Planning initially detected intentional inventory drift; reviewed the three
  new React tests and Blob cleanup timer, regenerated that evidence, and planning passed
  (79 exports, 67 members, 23 callers, 16 routes, 145 test declarations, 17 controls).
- A loopback real Fastify/PostgreSQL fixture and Vite on port 5174 exercised the actual
  browser. The 2099-01-01 synthetic booking displayed ₹134 gross, ₹128 pre-tax, ₹0 net
  collected and ₹134 outstanding. Reload restored the same snapshot ID/cutoff/totals.
  Empty capture also worked. At 375×812, document and scroll widths both measured 366px;
  no browser console warnings/errors were found. Screenshot:
  `node_modules/.cache/issue61-browser.jpg` (local, ignored evidence).
- Browser CSV initiation reached the API, but the browser download-event hook timed out.
  Native file delivery was **not verified**. API tests verify exact CSV rows/totals and
  the React test verifies Blob/link initiation. The UI therefore says “CSV ready. Check
  your downloads.” The temporary API/database and Vite fixture were stopped; an existing
  unrelated Vite server was left untouched.
- The first full quality run stopped in three historical migration repair tests: two
  copied-directory remaining counts still expected 41 migrations, and two synthetic
  forward-repair filenames sorted before the new migration. Updated those expectations
  and synthetic filenames; all **8/8** cases in the three affected files then passed.
  These were fixture defects in this change, not pre-existing failures or production
  migration failures. The first aggregate run is not reported as passing.
- Restarted the full `pnpm db:local quality` gate. Before its database stage started,
  final review strengthened the report assertions for every CSV field, immutable active
  payloads, 410 replay before/after tombstone cleanup and revoked download access.
  API typecheck and direct Node/ESLint on that file passed afterward. A standalone
  `pnpm exec eslint` attempt could not resolve the Windows shim; direct invocation of
  the installed ESLint module succeeded without changing code or lint rules.
- **Final `pnpm db:local quality` passed, exit 0**, on the code identity below:
  - Toolchain, 35 tooling tests, planning/domain/security checks, tenant AST gate,
    lint and five-workspace typechecks passed.
  - 22 testkit, 12 database unit, 652 API unit, 192 web and 3 private object-store
    contract tests passed.
  - **73 schema/DB + 417 API/PostgreSQL tests passed**, with zero failures, skips,
    cancellations or todos. This reran the full groups, including the strengthened
    report assertions; it is not a result assembled from partial database reruns.
  - API and production web builds passed (171 transformed web modules, 872.16 kB
    HTML / 222.24 kB gzip). Disposable PostgreSQL and object-storage containers were
    removed. Expected SDK diagnostics from deliberately rejected S3 streams did not
    indicate test failures.
  - Log: `node_modules/.cache/issue61-quality-final.log`. Final documentation/planning,
    migration-history and `git diff --check` checks passed separately. No runtime,
    migration or test changes followed the successful verification.

The strengthened test file received an additional typecheck and lint pass because
those assertions were added after the aggregate's static stage but before its database
stage. All final source was exercised by the relevant checks. No timeout was increased,
test skipped or assertion weakened. Logs are under `node_modules/.cache/issue61-*`.

## Verified code identity

59 changed/untracked non-documentation files, SHA256 of sorted
`path:SHA256(content)` lines joined with LF, uppercase inner hashes:
`1D679A67DF86A906DD9C74C7CC6D15DD2205F3B4811E91894EA354F6BDE31411`.
Documentation is excluded so recording test outcomes does not change code identity.

## Delivery boundary

All local implementation acceptance items have passing evidence above, with native
browser downloaded-file delivery explicitly unverified. The browser capture/reload is
a real API/SQL journey; component transport is mocked; storage contracts use a local
S3-compatible service. No live carrier, bank, government, messaging or LLM provider was
called. Query-plan fixtures qualify the bounded pilot, not production-scale throughput.

No new-code remote CI, independent PR review, commit, push, PR publication, merge or
deployment occurred. Those workflow steps remain subject to the user's authorization.
#61 remains unpublished local work and M6 is not complete. The other report consumers,
financial source workflows and policy decisions retain their own issues/prerequisites.
