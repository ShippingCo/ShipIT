# Issue #12 — Organization and Franchise tenancy verification

Starting freshly pulled main: `f3130f9c9dd1ee5298211081e323c10f4304667a`.
Branch: `issue-12-organization-franchise-tenancy`. Prerequisites #3, #10 and #11 were
CLOSED. #11's PR #94 merged at that exact SHA, verified as an ancestor of main.
Main [Engineering checks run 34246723497](https://github.com/ShippingCo/ShipIT/actions/runs/34246723497)
passed all five quality matrix jobs, PostgreSQL integration and the final required gate.
Issue #12 initially had `status: blocked`, changed only to `status: ready` after this gate.
PR creation moves it to `status: review`; the PR and issue remain OPEN for external review.
No downstream issue status is advanced before merge.

## Decisions and implemented boundaries

[ADR 0010](../adr/0010-organization-franchise-tenancy.md), the [domain contract](domain-contract.md),
[authorization contract](authorization-contract.md), [API guide](../../apps/api/README.md)
and [DB guide](../../packages/db/README.md) own the detailed decisions.

- Two roots: Organization owns Franchises; standalone = one of each. No carrier account,
  edition flag, competing tenant type, user or membership table is required.
- Both roots have opaque UUID, minimal display name, active/disabled lifecycle, version,
  and UTC timestamps. Franchise adds immutable organization_id and organization-scoped
  canonical ASCII code. No display-name uniqueness or global business directory exists.
- PostgreSQL enforces the Organization FK, composite `(organization_id,id)` candidate
  key and `(organization_id,franchise_code)` uniqueness. Indexes cover code lookup,
  ownership lookup and `(organization_id,created_at,id)` list traversal.
- Runtime SELECT/INSERT and specific mutable-column UPDATE preserve separate schema
  ownership. No DELETE/TRUNCATE/DDL or immutable-column updates. Identity triggers add
  defense even to ordinary owner SQL; no reparent/adoption bypass is provided.
- W41 is the only new staff permission: explicit F grant for org_admin within own O,
  own F for franchise_admin, controlled disable/reactivate reason and expected version.
  W29, W34, W35 and every unrelated action/role restriction remain unchanged.
- Approved scope is supplied by a trusted injected authorizer, never HTTP authority
  claims. Creation and Organization mutations require internal service authority.
  There are no production private routes; test routes are confined to test composition.
- Shared Organization-then-Franchise locks protect active operational writes in the
  same transaction. Disable acquires the corresponding exclusive lock and linearizes
  at commit. Authorized reads survive disable; ordinary profile changes do not bypass it.
- Safe audit notification follows confirmed commit. Durable audit, transactional audit
  persistence, public request replay and onboarding membership atomicity remain downstream.
  Notification loss/crash and post-commit adapter failure are explicitly unimplemented
  durability boundaries, not proof of rollback or safe automatic retries.

## Acceptance mapping

Real DB commands use the pinned PostgreSQL 18.6 container through the existing guarded
runner, with generated isolated migration/runtime identities and checked cleanup. Paths
below are repository-relative. All fixtures are fictional canonical testkit data.

| Criterion | Decision / implementation path | Test and exact command | Observed result / downstream limit |
| --- | --- | --- | --- |
| 1. Multi-franchise and independent shop | Atomic bootstrap plus scoped create in `apps/api/src/modules/tenancy/service.ts`; two root migration | `apps/api/test/database/tenancy.test.ts` bootstrap/restart and seeded Alpha/Beta; `pnpm db:local test:db` | Final command ledger below; #17 adds identity/membership/onboarding replay |
| 2. Nonexistent organization rejected | `franchises_organization_fk` in new migration | `packages/db/test/integration/tenancy-structure.test.ts` nonexistent parent; `pnpm db:local test:db` | Real PostgreSQL FK rejection, not mocked existence checks |
| 3. Foreign composite keys fail | Unique `(organization_id,id)` supports child composite FK | Disposable test schema ownership child, valid Alpha/Alpha-1 then invalid Alpha/Beta-1 and zero partial row; `pnpm db:local test:db` | Future private tables must use this pattern; no production child table added |
| 4. Disable preserves history and blocks writes | `repository.ts` transaction-capability guard and service lifecycle locks | Active/disabled/history/recovery and both lock orders; `pnpm db:local test:db` | Future business services must guard and write in the same transaction; no booking/parcel claims |
| 5. Ordinary updates cannot reparent | Strict command allowlist, explicit scoped update SQL, column grants and immutable trigger | Mass assignment, owner SQL and actual runtime reparent denial; `pnpm test:api`, `pnpm db:local test:db` | #79 owns any controlled adoption workflow |
| 6. Server-derived permitted lists | Authorizer-supplied O/F, SQL scope before limit+1, checked keyset boundary | Alpha single/multiple, Beta, empty and malicious input cases; `pnpm db:local test:db` | #13/#14 own actual identity/grants; #23 owns opaque public cursors |
| 7. Controlled duplicate conflict | Targeted `ON CONFLICT (organization_id,franchise_code) DO NOTHING` maps only that conflict | Concurrent duplicate creates: one success, one FRANCHISE_CODE_CONFLICT; unrelated MAIN codes; `pnpm db:local test:db` | No broad mapping of arbitrary SQL uniqueness errors |
| 8. Delete is not ordinary CRUD | No delete service/routes; runtime denied DELETE/TRUNCATE, parent FK RESTRICT | Runtime privilege tests and normal HTTP 404; `pnpm db:local test:db`, `pnpm test:api` | Retention/privacy policies remain with their owners |
| 9. Persistence survives restart | Real committed bootstrap and explicit DTO reload | Close API/pool, reconstruct dependencies, read identical roots, add second franchise; `pnpm db:local test:db` | Dependency restart, not PostgreSQL crash/backup restore |
| 10. Valid sibling/unrelated IDs denied | Uniform service not-found plus SQL ownership predicate | Own/sibling/foreign/unknown/disabled and erroneous foreign approved-ID pair; `pnpm db:local test:db` | No claim of #15 product-wide context or RLS |
| 11. Controlled malformed/stale/outage outcomes | Validation, expected_version, transaction error recovery, safe HTTP adapter | Strict fields, version race, real outage, failed second bootstrap write; `pnpm test:api`, `pnpm db:local test:db` | Failed validation/authorization/version/rollback emits no success fact; audit notification failure after commit remains documented |
| 12. No prohibited output | Explicit DTOs, safe error codes, minimal frozen audit facts, existing log serializers | API response/log/audit inspections and future-private-field projection test; `pnpm test:api`, `pnpm db:local test:db` | No real credentials, OTP, PII or external sends used |

## Local validation ledger

Pinned local execution prefixes PATH with
`/tmp/shipit-issue8-tools/node-v22.23.2-darwin-arm64/bin` and sets
`PYTHON=/tmp/shipit-issue8-tools/python/bin/python3.12`.

| Exact command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed; lockfile unchanged, no lifecycle scripts or added dependencies |
| `pnpm check:toolchain` | Passed: Node 22.23.2, pnpm 10.34.5, Python 3.12.14 |
| `pnpm test:quality` | Passed: 10 tooling/gate tests |
| `pnpm check:planning` | Passed: all planning/domain/API/security/prototype/policy validators, including exact W41 and unchanged W29/W34/W35 restrictions |
| `pnpm check:migrations` | Passed: one released infrastructure migration unchanged; forward tenancy addition allowed |
| `pnpm lint` | Passed: zero errors/warnings |
| `pnpm typecheck` | Passed: all five workspaces |
| `pnpm test:unit` | Passed: 22 testkit + 11 DB unit cases |
| `pnpm test:api` | Passed: 90 tests in four files, including seven new tenancy cases |
| `pnpm test:web` | Passed: 24 tests in two files; existing React act warnings remain visible |
| `pnpm db:local test:db` (invokes `pnpm test:db`) | Passed: real PostgreSQL tenancy/infrastructure and API suites; final full-quality run includes 26 DB + 14 API/database cases, zero failed/skipped/cancelled/todo |
| `pnpm build` | Passed: API TypeScript build and Vite production bundle |
| `pnpm db:local quality` | Passed on final implementation/tests: toolchain, tooling, planning, lint, typecheck, all service-free tests, 40 real PostgreSQL cases and build; exact DB/role/container cleanup succeeded |
| `pnpm db:local verify:gates` | Passed all 22 stages: empty-store locked install, clean/restored full quality, deliberate lint/type/unit/API/frontend/build/lockfile failures, missing/unavailable/empty/skipped DB suites and exact required-gate failure/cancellation/skip/missing cases |
| `env -u DATABASE_URL -u TEST_DATABASE_URL -u TEST_DATABASE_IDENTITY -u MIGRATION_DATABASE_URL pnpm test:web` | Passed independently: 24 tests with all four variables absent |
| `pnpm audit` | Passed: no known vulnerabilities |
| `git diff --check` | Passed after full source/SQL/migration/privilege/DTO/auth-seam review |

The final full-quality command executes the listed individual quality layers against
the pinned real PostgreSQL environment. An earlier development API assertion expected
noncanonical trailing UTC zeros; it was corrected to the accepted wire contract and
all final tests pass. A structural deletion test was corrected to PostgreSQL's actual
RESTRICT SQLSTATE (23001); invalid inserted foreign keys remain 23503. The successfully
applied tenancy migration was not edited. Review also fixed explicit `limit:null`
being treated as omission and added its regression test.

Final concurrency evidence uses committed inserts in the existing test-only
`synthetic.fixture` table: a writer that holds the guard first commits its probe before
the disable success fact; guards blocked behind disable and guards started afterward
leave no probe. Index tests inspect exact candidate/code/list keys and execute scoped
runtime-role `EXPLAIN (FORMAT JSON)` without asserting a plan choice or performance
from three fixture rows. The final PostgreSQL suite includes these strengthened cases.

Failure drills use an isolated snapshot with a new empty package store. They passed
before the final probe/index test extensions; final full quality and exact PR-head CI
verify the complete delivered test set. The CI workflow/required gate was not weakened.

## Migration and rollout

The released #10 infrastructure migration is unchanged. The new forward migration is
`packages/db/migrations/1788872400000-organization-franchise-tenancy.cjs`.
Fresh install applies both; upgrade first applies #10, then tenancy; repeat is a no-op.
Apply as migration identity and provision only the documented runtime grants.
Compatible application rollback leaves the additive schema in place; correction of
applied schema uses another forward migration. No production data backfill is required.

## Review and remaining limits

The complete SQL/migration/grant/service/DTO/auth-seam diff receives a self-review and
exact-head CI verification before delivery. The final PR report supplies its immutable
head SHA and GitHub check URLs, since those exist only after this document is pushed.
No dependencies are added; current audit advisories are recorded in the command ledger.
PR merge, issue closure, branch deletion and downstream #14/#15/#17 unblocking are
intentionally reserved for the user's external review. Authentication, memberships,
product-wide tenant context, durable audit, onboarding and business tables remain absent.
