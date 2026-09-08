# Issue #11 — Fastify boundary verification

Implementation date: 2026-09-08. Freshly pulled starting main:
`ca735482b95251715387b25248f2cce16872e2e3` (Issue #10 / PR #93).
Branch: `issue-11-fastify-server-boundary`. Prerequisites #4, #6, #9 and #10
were CLOSED and their merged API, environment/security, test harness and PostgreSQL
contracts were present. Main CI run [34239219015](https://github.com/ShippingCo/ShipIT/actions/runs/34239219015)
passed all five matrix jobs, PostgreSQL integration and the final required gate on that SHA.
Issue #11 initially had `status: blocked`; after verification it moved to `status: ready`.
PR delivery moves it to review and leaves both issue and PR OPEN, retaining the branch.
No merge, post-merge CI or downstream unblocking is claimed.

The [API guide](../../apps/api/README.md), [configuration contract](configuration-contract.md),
[public error contract](api-contract.md) and [dependency review](issue-11-dependency-review.md)
record implementation decisions. Hosted managed-store composition belongs to #68;
this change neither selects a vendor nor supplies a production local-secret fallback.

## Acceptance mapping

Paths below are repository-relative. API tests run with `pnpm test:api`; real DB cases
run through `pnpm db:local test:db` (the helper invokes `pnpm test:db` against guarded
PostgreSQL 18.6). All data is synthetic. Observed final totals and gates follow below.

| Acceptance criterion | Decision and implementation | Automated test / exact command / observed result | Downstream limitation |
| --- | --- | --- | --- |
| buildServer injection without port | `apps/api/src/server.ts` constructs Fastify with injected config/DB/log sink; never listens/connects | `boundary.test.ts`, builds/injects test, `pnpm test:api`: listening remains false; live 200; DB untouched | Auth/domain plugins are not implemented |
| Missing/malformed environment fails with redacted details | `src/env.ts`, immutable pure validation; `src/secrets.ts` local isolation; `src/index.ts` controlled startup | `config.test.ts` missing/malformed/mode/local/managed cases and `lifecycle.test.ts` process validation and `config.test.ts` resolver timeout, `pnpm test:api`: config rejected, only safe field/code output, process exits 1 | Managed workload identity/version enforcement must be provided by #68 |
| Live succeeds during DB outage, ready unavailable | `src/modules/health/routes.ts` reuses `checkDatabaseReadiness` | `boundary.test.ts` available/outage/recovery; `test/database/runtime.test.ts` actual DB disabled/restored; `pnpm test:api` and `pnpm db:local test:db`: live 200 throughout, ready 200/503/200, no DB details | Product dependency checks can extend readiness under their owners |
| Malformed/oversized JSON fails before domain handlers | `src/plugins/json.ts`: fatal UTF-8, native grammar + bounded duplicate/pollution scanner; explicit 256 KiB; native AJV strict schema | `boundary.test.ts` malformed/decoded duplicate/depth/UTF-8/size/media/schema cases, `pnpm test:api`: 400/413/415/422, handler count unchanged; inclusive byte boundary passes | No production test or domain command endpoint |
| Graceful shutdown stops work and closes pool by deadline | `src/lifecycle.ts`: 10 s drain/15 s total, supported Fastify close and Node forced connection cleanup; pool closes once | `lifecycle.test.ts` real in-flight HTTP, forced drain, stuck/failed DB, bind failure, SIGTERM/SIGINT; `pnpm test:api`: new work denied, in-flight drains, normal exit 0, timeout rejects safely | Long-running future domain work needs explicit cancellation/transaction ownership; no upgraded connections |
| Hostile CORS/spoofed forwarding cannot alter trust | `src/server.ts`: exact origins, credentials off; proxy IP allowlist AND hop bound | `boundary.test.ts` approved/hostile/preflight/direct/trusted/unapproved peer cases, `pnpm test:api`: hostile has no access grant; direct peer remains effective identity; only approved arrangement changes forwarded context | #68 enforces network/proxy overwrite controls; CORS/IP never authorize |
| Errors/logs exclude headers, cookies and bodies | `plugins/logging.ts` controlled fields/serializers/redaction/LogController; `plugins/errors.ts` stable public mapping; router/HTTP transport early rejection sanitized | `boundary.test.ts` distinctive auth/cookie/set-cookie/body/query/path/DB/password/provider/OTP/verifier/address markers, `pnpm test:api`: absent from responses/logs; error ID equals response header | Future logging calls must also use controlled fields/literals; arbitrary free-text secrets are prohibited |
| Applicable happy path survives restart with synthetic fixture | Existing guarded DB infrastructure, one pool per process; no fake production persistence endpoint | `test/database/runtime.test.ts`, `pnpm db:local test:db`: insert bound synthetic fixture, close server/pool, rebuild, ready 200 and same stored label; zero open pool resources | Customer/business persistence and authenticated happy path belong to later domain issues |
| Foreign tenant denial or equivalent infrastructure isolation | No HTTP header becomes user/franchise authority; local resolver cannot access hosted mode, foreign host/DB/login; canonical testkit retained | `boundary.test.ts` arbitrary identity headers have no authority; `config.test.ts` isolation refusals; existing `packages/db/test/integration/pool-security.test.ts` runtime/foreign DB denial; `pnpm test:api` + `pnpm db:local test:db`: passed | No claim of implemented sibling-franchise SQL/auth; Alpha/Beta enforcement remains #12/#13/#14/etc. |
| Malformed/stale/dependency failures controlled, no partial unauthorized mutation | Generic 400/404/408/413/415/422/429/431/500/503 mapping; JSON/schema/rate rejection precedes handler; no domain mutations | `boundary.test.ts` framework/security tests, `test/database/runtime.test.ts` outage; same two commands: controlled errors and handler nonexecution | Version/idempotency/stale business state remains owning downstream command work |
| Inspect responses/logs for secrets, OTP, unnecessary PII | Synthetic marker assertions cover startup, health, parser, validation, unexpected errors and structured logs | `config.test.ts`, `boundary.test.ts`, `lifecycle.test.ts`, DB API case; same commands: all prohibited marker assertions pass | No browser/API product data flows or audit stream exist yet; frontend remains unchanged |

## Local quality evidence

Observed validation: **83 API tests** (40 configuration, 33 HTTP/security, 10
lifecycle/transport), **33 unit tests** (22 testkit + 11 DB), **24 frontend tests**,
**18 PostgreSQL tests** (17 existing DB + 1 API), and **10 tooling tests** passed.
The API security/configuration subtotal is 73; the real DB API case is additional.
No test was skipped or reported as passing without execution.

| Exact command | Observed result |
| --- | --- |
| `pnpm check:toolchain` | Passed: Node 22.23.2, pnpm 10.34.5, Python 3.12.14 |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed; lockfile unchanged and lifecycle scripts disabled |
| `pnpm test:quality` | 10 passed |
| `pnpm check:planning` | All planning/domain/API/security/prototype contract validators passed |
| `pnpm check:migrations` | One released migration unchanged; no new production migration |
| `pnpm lint` | Passed with zero warnings/errors |
| `pnpm typecheck` | All five workspaces passed |
| `pnpm test:unit` | 22 testkit + 11 DB unit cases passed |
| `pnpm test:api` | 83 passed, including real listener/signal and transport-error tests |
| `pnpm test:web` | 24 passed; also independently with DB/API variables removed |
| `pnpm db:local test:db` | Invokes `pnpm test:db`: 17 DB + 1 API passed; owned PostgreSQL 18.6 container removed |
| `pnpm build` | API TypeScript check and frontend production bundle passed |
| `pnpm db:local quality` | Full quality passed with real PostgreSQL and checked container removal |
| `pnpm db:local verify:gates` | All 22 stages passed: empty-store install, clean/restored quality and expected rejection drills, including API assertion failure and every existing PostgreSQL/final-gate negative case |
| `pnpm audit` | No known vulnerabilities; no suppression |
| `git diff --check` | Passed |

Independent frontend command actually executed:

```sh
env -u DATABASE_URL -u TEST_DATABASE_URL -u TEST_DATABASE_IDENTITY \
  -u MIGRATION_DATABASE_URL -u DATABASE_SECRET_REF -u LOCAL_DATABASE_URL \
  -u ALLOWED_ORIGINS -u TRUSTED_PROXY_HOPS pnpm test:web
```

The final CA parsing refinement was followed by the complete API suite, API typecheck,
lint and full DB-backed quality again. Failure-drill machinery was unchanged.
Existing React act warnings and the whatwg-encoding deprecation remain visible;
no new warning suppression or dependency upgrade was introduced.

Failures found and corrected during implementation: initial Fastify serializer/proxy
option type errors; use of deprecated logging switches; a missing new-document link
in planning validation; and self-referential factory inference after adding the early
transport handler. Self-review additionally caught raw malformed-URL responses and
hop-only proxy trust hazards, added correlated URL/HTTP parser handling, rate-limited
unknown routes, and required parsed X.509 certificates in optional CA bundles.
The final passing checks supersede these intermediate failures.

Raw local logs
are in ignored `node_modules/.cache/issue-11/`; isolated failure-drill logs use the existing
`node_modules/.cache/quality-verification/` directory. No credentials are committed.

## Review boundary

Existing main protection requires the exact `Planning and prototype checks` status,
strict up-to-date checks, resolved conversations and administrator enforcement. GitHub
currently requires **zero** approving reviews; independent external review is nevertheless
the user's explicit delivery requirement. Protection is not changed. PR-head SHA/checks,
mergeability and conversation state are verified after pushing and reported with the PR,
so this file does not cite an older commit's checks as current PR evidence.

Downstream #12, #13, #16, #18, #35 and #68 remain blocked on the unmerged #11 prerequisite;
no downstream status is changed based on this PR. No login, sessions, business tables,
providers, webhooks, ORM or browser fallback is introduced. Rollback is an API code/config
rollback; no production data migration is required. The existing released DB migration
remains unchanged.


## Changed-file inventory

### Added

- `apps/api/src/env.ts`
- `apps/api/src/lifecycle.ts`
- `apps/api/src/modules/health/routes.ts`
- `apps/api/src/plugins/errors.ts`
- `apps/api/src/plugins/json.ts`
- `apps/api/src/plugins/logging.ts`
- `apps/api/src/runtime.ts`
- `apps/api/src/secrets.ts`
- `apps/api/src/server.ts`
- `apps/api/test/database/runtime.test.ts`
- `apps/api/test/integration/boundary.test.ts`
- `apps/api/test/integration/config.test.ts`
- `apps/api/test/integration/lifecycle.test.ts`
- `apps/api/test/support.ts`
- `apps/api/vitest.config.ts`
- `docs/architecture/issue-11-dependency-review.md`
- `docs/architecture/issue-11-verification.md`

### Changed

- `.env.example`
- `apps/api/README.md`
- `apps/api/package.json`
- `apps/api/src/index.ts`
- `apps/api/tsconfig.json`
- `apps/web/package.json`
- `docs/ENGINEERING_WORKFLOW.md`
- `docs/QUALITY_CHECKS.md`
- `docs/architecture/api-contract.md`
- `docs/architecture/configuration-contract.md`
- `docs/architecture/security-threat-model.md`
- `docs/architecture/testing-contract.md`
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `scripts/quality.test.mjs`
- `scripts/test-database.mjs`
- `scripts/verify-gates.mjs`
