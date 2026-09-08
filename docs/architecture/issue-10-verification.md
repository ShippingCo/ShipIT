# Issue #10 — PostgreSQL infrastructure verification

Implementation date: 2026-09-08. Starting main was freshly pulled at
`53d298338a9b0f1c44f593c270f26b5e78049082` (Issue #9, PR #92).
Branch: `issue-10-postgres-infrastructure`. Issues #2, #4, #5 and #9 were closed;
their architecture, wire/idempotency, quality and testing contracts were present.
Main's Engineering checks run `34233927703` passed on that exact starting SHA.

The requested delivery boundary is an open PR for maintainer review and merge.
This document does not claim a merge, Issue #10 closure, post-merge CI, branch
cleanup or downstream readiness. PR-head CI evidence belongs to the PR checks and
delivery report, because those results are available only after pushing this document.

## Implementation and dependency decisions

The accepted stack remains PostgreSQL, `pg` and explicit parameterized raw SQL,
with `node-pg-migrate`. There is no ORM, API endpoint or domain schema. The only
production migration creates the empty `shipit` schema and revokes PUBLIC access;
the migration tool owns `shipit_migrations.pgmigrations`. Synthetic fixture tables
exist only inside generated disposable test databases.

The [preinstallation dependency review](issue-10-dependency-review.md) selected
`pg@8.23.0`, `node-pg-migrate@9.0.0` and dev-only `@types/pg@8.23.1`. They support
Node 22.23.2 and the repository's ESM/erasable TypeScript approach. Versions are
pinned in the DB package because no other package consumes them; existing shared
TypeScript/Node types remain in the workspace catalog. The final lockfile adds 33
package versions and removes none. Installing migrate's `jiti@2.7.0` also changes
ESLint's optional peer context from the existing `jiti@1.21.7`; ESLint, frontend and
all other pre-existing package versions remain unchanged. No lifecycle scripts ran.

The official PostgreSQL `18.6-bookworm` image is pinned to multiarchitecture digest
`sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`.
Major 18 is supported through 2030; the dependency review links the registry and
upstream support evidence. This is not an operating-system image vulnerability scan.

The [DB operating guide](../../packages/db/README.md) specifies the exported API,
configuration, migration command, role policy and recovery. Defaults are 10 clients,
2 s acquisition/connect, 30 s idle, 5 s statement, 6 s client query, and 10 s idle
transaction timeouts. Every configurable limit has a positive upper bound. Shutdown
invalidates outstanding leases, waits for queued acquisitions and actual sockets to settle and fails within
the configured connect timeout plus 2 s. Dedicated migration/admin clients also
have bounded close. The future API must drain application work before pool closure.

Production and staging require certificate-verified TLS; all environments choose TLS
explicitly. URL options and fragments are rejected. Driver fields are fully supplied,
including password, encoding, search path and TLS negotiation, so ambient `PG*`
variables cannot select another database or inject options. Application composition
injects typed resolved server-only configuration; the separate migration CLI reads
`MIGRATION_DATABASE_URL`, never ordinary application or test fallback credentials.

Transactions use one checked-out client for BEGIN, callback queries and COMMIT or
ROLLBACK. An application/SQL failure rolls back; even a caught SQL error cannot turn
PostgreSQL's `COMMIT` command response of `ROLLBACK` into a success. A rejected commit
returns `DB_COMMIT_UNCERTAIN`, discards the client and is never retried automatically.

Migration serialization uses the pinned runner's native session advisory lock
`7241865325823964`, acquired before schema/ledger work. Contention fails immediately
with `DB_MIGRATION_LOCKED`; pending migrations execute in one transaction. Success,
failure and connection closure release the lock. Applied history is immutable in
review and the required `check:migrations` CI step; additions are forward migrations.
Git comparison is separate from `quality`, whose negative drills use a history-free
disposable snapshot. It does not claim protection against rewriting Git history or
out-of-band database changes.

## Acceptance evidence

Each DB test below executes through `pnpm db:local test:db`, which invokes the actual
`pnpm test:db` command against PostgreSQL 18.6. The five migration, five transaction
and seven pool/security tests passed: **17 passed, zero failed/skipped/cancelled**.
Paths in the table are relative to the repository. Test names are abbreviated only
where the behavior is unambiguous.

| Issue acceptance criterion | Decision and implementation path | Test / exact command and observed evidence | Remaining boundary |
| --- | --- | --- | --- |
| Fresh migrations and repeat no-op | `packages/db/src/migrations.ts`, `packages/db/migrations/1788868800000-infrastructure-schema.cjs`: native ledger and one transaction | `packages/db/test/integration/migrations.test.ts`, fresh/repeat test via `pnpm db:local test:db`: first run applies one; repeat applies zero; schema and ledger inspected; no domain tables. Prior-snapshot test applies fixture migration 1, persists a row, applies migration 2 and inspects preserved value/new column. | The first release has only one infrastructure migration; the two-version upgrade is a generated test fixture, not a future domain migration. |
| Concurrent migration safety | Native fail-fast PostgreSQL advisory lock in `src/migrations.ts` | Real two-process test observes held lock, starts contender, verifies one success/one controlled failure, exactly one ledger row and clean retry. Separate lock-owner close test verifies release. Command: `pnpm db:local test:db`; passed. | Operators retry a rejected contender after the active run ends; no infinite waits. |
| Applied migrations immutable | `scripts/check-migrations.mjs` compares base blobs/modes with current files, fails on missing base, edit, deletion or rename; CI planning uses PR base/previous main SHA | `pnpm check:migrations`: first migration is an allowed addition. `pnpm test:quality`: temporary Git repository tests additions and forbidden history changes for cjs/mjs/js/sql; passed. Controlled failed-migration test removes only an unpublished/unapplied fixture and adds a new correction. | Existing applied/released files are never repaired in place. No second migration registry. |
| Runtime lacks schema-owner/tenant-bypass powers | `packages/db/test/support.ts` provisions separate random bootstrap, migration and runtime identities; runtime is NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/NOBYPASSRLS, has CONNECT plus explicit synthetic DML grants | `pool-security.test.ts`, privilege test via `pnpm db:local test:db`: CREATE TABLE/SCHEMA/TEMP, ALTER, DROP and ledger reads denied with 42501; intended synthetic INSERT/SELECT/UPDATE/DELETE succeed; actual role flags and DB owner inspected. | No tenant schema/RLS/auth exists yet. Production role provisioning and tenant enforcement remain downstream. |
| Bounded exhaustion/outage and recovery | `src/pool.ts`, `config.ts`, `readiness.ts`: capped pool and timeouts, controlled failures | Pool tests exhaust one-client pool, observe bounded failure, release and recover; shutdown with two queued acquisitions waits until both reject DB_CLOSED and waiting count is zero; real statement timeout recovers; database ALLOW_CONNECTIONS=false plus backend termination causes bounded not-ready, then restoration succeeds. `pnpm db:local test:db`; passed. | The outage drill disables only its disposable DB, not the Docker daemon/network or a production service. |
| Failed transaction rolls back and releases | `src/transaction.ts`: one client, rollback on SQL/application failure, discard uncertain/damaged connections | `transactions.test.ts`: duplicate SQL failure and callback error both leave zero persisted rows, released connection and successful later work; caught SQL error rejects; pre-commit backend termination returns uncertainty. `pnpm db:local test:db`; passed. | The terminated-backend drill knows it killed before commit; real lost commit replies remain uncertain and require domain reconciliation. |
| CI exercises real PostgreSQL | `.github/workflows/ci.yml`, `scripts/with-test-postgres.mjs`, `scripts/test-database.mjs`: required PostgreSQL job, generated credentials, bounded startup and exact cleanup | Local `pnpm db:local test:db`: actual image, 17 real tests, successful resource/container teardown. Required final gate consumes both quality matrix and DB result. Tooling/failure drills reject failed, cancelled, skipped or missing DB results. | Exact PR-head GitHub results must be checked after push; local success is not a CI claim. |
| Readiness privacy | `src/readiness.ts`, `errors.ts`: SELECT 1, only ready or not_ready with controlled code | Outage/exhaustion/closed tests assert exact result shape, no URL/host/user/password/SQL/error object. `pnpm db:local test:db` and `pnpm test:unit`; passed. | #11 owns eventual HTTP mapping; no HTTP readiness endpoint exists. |
| Authorized happy path persists across restart | Canonical testkit Alpha/Beta IDs in synthetic UUID/text table, runtime transaction dependency | `transactions.test.ts`: three writes return one backend PID, commit, pool closes, fresh pool reads all committed values. `pnpm db:local test:db`; passed. | This is persistence across pool/dependency restart, not a database server crash or a business workflow. |
| Foreign-resource isolation equivalent | Existing `validateTestDatabaseConfig` plus trusted host/name/identity policy and distinct runtime credentials | Testkit unit refusals and DB runner config tests reject unsafe environments/no TEST_DATABASE_URL fallback. Two real generated DBs cannot read each other's fixture and first runtime lacks CONNECT to second. Canonical sibling/foreign IDs remain available. Commands: `pnpm test:unit`, `pnpm db:local test:db`; passed. | Domain ownership filtering, nested foreign IDs/counts and authorization remain #12/#13 and owning domain work. |
| Malformed/stale/dependency failures controlled | `config.ts`, `errors.ts`, scoped transaction lifecycle, guarded runner | Unit tests reject malformed URL/TLS/unbounded settings and ambient PG overrides; closed pool is controlled. Real failed migration rolls back schema changes, leaves failed name absent from ledger and permits forward correction. Commands: `pnpm test:unit`, `pnpm db:local test:db`; passed. | No domain stale-version policy is implemented. |
| Log/error/privacy inspection | Sanitized DB errors have code/optional SQLSTATE only; migration logger silent; test child communicates controlled results; no production import of testkit | Reviewed source and observed test output. Docker receives generated passwords through environment, never argv; role password literals are produced by PostgreSQL parameterized `format`, not application SQL concatenation. Container statement/error-statement logging is disabled for these fixtures. `pnpm lint` enforces fixture import boundary. | No business audit trail/API/browser DB response exists to inspect. No real customer data, OTP or provider traffic is used. |

## Test lifecycle and required gates

The Issue #9 `validateTestDatabaseConfig` boundary is retained before test connection,
creation, migration, destructive state changes and cleanup. Accepted inputs require
NODE_ENV=test, explicit TEST_DATABASE_URL/TEST_DATABASE_IDENTITY and trusted test
host/name policy. No caller-controlled host allowlist or DATABASE_URL fallback exists.
CI connects to a loopback-published Docker service; the trusted policy also includes
the `postgres` service hostname. Bootstrap may provision only the disposable environment;
tests exercise the correct migration/runtime identity for each assertion.

Each test gets a random `shipit_<16hex>_test_1` DB with matching generated role names.
A mode-0600 registry records exact names before creation, never credentials. Test hooks
close clients/pools and drop owned resources, then the parent runner retries exact cleanup
idempotently. Cleanup errors fail the run. No wildcard database deletion occurs. The
outer helper removes only its labeled container and volumes, even after command failure.

Missing/unsafe config, unreachable PostgreSQL and zero discovered test files are explicit
nonzero outcomes. Execution-result checks also reject empty/all-skipped required suites;
the negative gate drill exercises these separately. `test:web` stays independent. Full
`quality` requires `test:db`; only the independently named unit/frontend commands are partial.

## Local command ledger

Use Node 22.23.2, pnpm 10.34.5 and Python 3.12.14. On this workstation the pinned Node
binary directory was prepended to PATH and PYTHON selected the pinned Python executable.
Docker Desktop was running; no paid/cloud/production resource was provisioned.

| Exact command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed; lockfile unchanged, no install scripts. |
| `pnpm audit` | Passed; no known vulnerabilities. |
| `pnpm check:migrations` | Passed; zero previous released migration files, first addition allowed. |
| `pnpm db:migrate` | Separate guarded disposable-role CLI smoke passed twice: applied 1, then applied 0, no URL in output. The smoke harness used generated credentials through child environment and exact registered teardown. |
| `pnpm db:local test:db` | Passed; 17 PostgreSQL tests, no skips/cancellations; DB/role/container cleanup passed. |
| `env -u DATABASE_URL -u TEST_DATABASE_URL -u TEST_DATABASE_IDENTITY -u MIGRATION_DATABASE_URL pnpm test:web` | Passed: 24 frontend tests in two files with every listed DB variable absent. Existing React act warnings remain visible. |
| `pnpm db:local quality` | Passed: exact toolchain, 10 tooling tests, planning validators, lint, all five workspace typechecks, 22 testkit + 11 DB unit tests, 24 frontend tests, 17 real PostgreSQL tests and production build. Container cleanup passed. |
| `pnpm db:local verify:gates` | Passed: all 21 stages, including fresh-store frozen install, clean/restored full quality, existing failure probes, missing/unavailable DB, empty discovery/execution, skipped suite and exact final-gate failure/cancellation/skip/missing checks. |
| `git diff --check` | Passed after complete source, fixture, workflow, dependency and documentation review. |

Initial full-gate attempt correctly failed planning validation while this new verification
document was still being written; its temporary PostgreSQL container was removed. Final
ledger results supersede that development attempt without claiming it passed.

Review also identified and fixed ambient pg option fallback, caught SQL errors returning
ROLLBACK from COMMIT, socket-aware bounded shutdown, queued acquisition settlement,
and Node's success result for empty/all-skipped test files. Regression tests now exercise
each boundary. The runner uses actual per-file test summaries, validates completed counts,
rejects skipped/cancelled/todo or incomplete suites, suppresses raw test assertions/stdout/
stderr, and emits only controlled diagnostics with known source filename/line on failure.
Signal/deadline tests prove child and descendant termination before parent resource cleanup.

Read-only GitHub protection inspection found the existing `Planning and prototype checks`
required context with strict up-to-date status checking, administrator enforcement and
conversation resolution. Required approval count is currently zero; no protection changes
were made. Maintainer review remains the requested delivery boundary regardless of that
repository setting.

## Remaining downstream work

API composition and HTTP readiness are #11. Tenant schema, domain constraints/auth,
idempotency state, audit/outbox, workers and provider integrations are downstream. Pool
parameter binding is a reusable seam, not proof of all future SQL safety. Verified-TLS
configuration is tested structurally; this local image uses isolated plaintext loopback,
so production CA rotation/handshake and managed-service deployment require later testing.
Migration deployment roles/grants must follow the documented separation; this issue does
not purchase/provision a production DB or claim backup/restore/crash-recovery validation.
Maintainer review and merge remain pending at the user's explicit request.
