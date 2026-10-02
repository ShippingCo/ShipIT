# Issue #49 verification

Base: `9f3a72d` (merged #48 PR #133), local branch
`codex/issue-49-pickup-requests`. Started with a clean checkout; preserved local
environment files. No commit, push, published PR, production data change or deployment.
All customer/provider data below is fictional. New results are local evidence, not CI
or live Meta qualification. The prerequisite PR #133's implementation-head CI passed.

## Acceptance mapping

Status: all criteria below are **locally verified**. Live Meta delivery and deployed
end-to-end browser qualification remain **unverified**; no local simulation is
presented as that evidence.

| Criterion | Evidence |
| --- | --- |
| One submission on retry | Signed dialogue; stable confirmation key replay after new pool/worker and duplicate webhook; one request/event. |
| Customer ownership | Separate signed phone cannot list/read/cancel another contact; foreign and unknown quote/request responses match. |
| Staff isolation | Valid A request denied to B/C; B/C detail/count-free queues remain isolated; read_only mutation denied. |
| Accept/cancel race | Concurrent customer worker and staff transaction yield one terminal state/version and one decision event. |
| Heavy/unsupported review | #48 policy reason retained; acceptance requires manual-review confirmation; no amount or capacity invented. |
| Staff/window evidence | Acting staff recorded; explicit future agreed window and capacity/customer-agreement confirmation required. |
| Address and usable errors | Unicode/bounds/control validation; invalid dialogue step retained; labelled keyboard controls and mobile browser flow. |
| Notification failure/recovery | Provider unavailable leaves accepted request and retained failed intent; administrator redrive succeeds; STOP suppresses; expired service window fails visibly. |
| Restart/reload | New worker continues draft; HTTP detail returns saved decision; UI refresh reads server state. |
| Invalid/stale/dependency cases | CSRF, unknown ownership fields, stale version, conflicting idempotency body; revoked outbound INSERT rolls back decision/event. |
| Privacy | Logs/audit inspected for address; queue omits address until detail; expired drafts purged; signed owned replies omit address. |
| Migration | Populated migration-32 conversation survives migration 33; repeat no-op; 32 released migration files unchanged. |

Tests: `apps/api/test/database/pickups.test.ts`,
`apps/api/test/integration/pickups.test.ts`, `apps/web/src/test/pickups.test.tsx`.
Database tests use the existing runtime roles, real transactions, signed callbacks,
and isolated disposable PostgreSQL 18.6. Provider outcomes are injected; no real sends.

## Commands and run record

Required toolchain verified: Node 22.23.2, pnpm 10.34.5, Python 3.12.14.
Docker 29.7.2 was available through its installed per-user path. The default shell
PATH selected older tools; commands used the existing pinned local binaries.
Sandboxed pnpm could not launch the installed Vitest shim; normal approved Windows
execution succeeded without installation or dependency changes.

```sh
pnpm --filter @shippingco/api exec vitest run test/integration/pickups.test.ts
pnpm --filter @shippingco/web exec vitest run src/test/pickups.test.tsx
pnpm db:local exec node scripts/test-pickups.mjs
pnpm db:local quality
pnpm check:migrations
```

- Focused pure rules: **4 passed**.
- Focused staff UI components: **5 passed**, including acceptance, required review,
  stale error, uncertain retry with the same intent, empty/read errors and focus return.
- Real headless Chrome at **390×844**: production hash route, private detail, keyboard
  acceptance, saved agreed window and failed-message state passed. No page errors or
  horizontal overflow. API responses were intercepted with fictional DTOs; this is
  browser rendering/interaction evidence, not a live full-stack deployment.
- Typechecks and tenant-query/lint checks passed during focused implementation.
- Migration history: **32 released files unchanged**. `git diff --check` passed.
- Initial database run found an incorrect new staff FK; corrected to `auth_users`.
  Later focused assertions corrected fixture authorization, the existing terminal
  unavailable-send/redrive behavior and STOP's intentionally absent reply.
- Combined focused regression reached all five files; it failed on four historical
  migration inventory/count assertions and one new expected validation status
  (422, not 400). Assertions were updated for the additive migration, not weakened.
  Isolated reruns passed those assertions; one concurrent diagnostic encountered a
  `DB_TEST_CLEANUP_FAILED` hook. A sequential final focused run verifies cleanup.

- Final sequential focused pickup + migration tests: **12 passed**, zero
  failed/skipped/cancelled/todo, including successful cleanup. Subsequent additions
  verify foreign cancellation denial and staff-only contact projection in the broad run.
- The first `pnpm db:local quality` passed the toolchain and **34 tooling/security
  tests**, then stopped at prototype inventory drift. Reviewed inventory comparison
  showed exactly the five new pickup UI tests; each was assigned to #49's assistant
  group with preserved production behavior. No unrelated inventory was regenerated.
- Continued with `check:planning`, `lint`, `typecheck`, `test`, `test:db`, `build`
  under the same supported disposable-database wrapper. This is a failed aggregate
  followed by a stage-by-stage continuation, not one uninterrupted green quality run.

- Broad `check:planning`, lint and all five package typechecks passed. Unit/component
  verification passed: **22 testkit, 12 database unit, 531 API, 182 web, and 3
  object-store contract tests**. The 34 tooling/security tests passed earlier.
- The first full database stage stopped in the schema group on stale migration
  counts in older upgrade tests. A representative isolated failure confirmed the
  expected/actual difference was exactly the new migration. Updated the remaining
  upgrade counts and advanced two synthetic forward-repair timestamps past migration
  33; preserved rollback, immutability and existing-data assertions. No deadlines,
  concurrency limits or assertions were relaxed. Reran only database/build stages.

- Final full PostgreSQL run: **67 schema/database + 369 API tests passed**, zero
  failed/skipped/cancelled/todo. This includes #48 and the final pickup assertions.
- The disposable-database wrapper reached its overall time limit during the build,
  after the entire database stage had passed. Vite printed a successful build, but
  the wrapper exited nonzero. A standalone build rerun supplies the clean result;
  no database tests were repeated and no timeout was increased.
- Standalone `pnpm build`: **passed, exit 0**. Also confirmed with explicit
  `NODE_ENV=production VITE_DATA_MODE=production`: **passed, exit 0**, including
  the production/demo isolation build guard. Final `git diff --check` passed.
- All required quality stages now have passing local evidence, assembled from the
  broad run and the documented corrections/reruns. There is no remaining local
  test coverage gap. No new-branch GitHub CI or live-provider result is claimed.

## Rollout and limits

Apply migration 33 and grants before enabling `pickup_enabled` with existing #48
configuration. The [contract](pickups.md) lists commands, roles, safe errors, exact
grants, state transitions and recovery. Real WhatsApp qualification and approved
outside-window templates are not established here. No new template is assumed.
Abandoned drafts expire/clean up; broader submitted-request retention remains #72.
The staff member must genuinely check capacity and agree the window outside the
software before attesting; the system contains no capacity inventory.

Detailed decision rationale: [ADR 0034](../adr/0034-pickup-requests.md).
