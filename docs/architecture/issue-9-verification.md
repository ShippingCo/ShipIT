# Issue 9 verification

[Testing contract](testing-contract.md) · [Testkit](../../packages/testkit/README.md)

## Starting state and dependencies

Started 2026-09-08 from clean freshly pulled main
`a9cb1958af656b9bf26ede640fc41e7b72e50576`, including Issue #8 / merged PR #91.
Dedicated branch: `issue-9-test-harness`. No unrelated edits were present or discarded.
`gh issue view 4`, `5`, `6` verified CLOSED; merged PRs #87/#88/#89 and their contracts
are present in main history. Main CI run `34231679859` succeeded on that exact SHA.
Issue #9 labels progressed blocked → ready after verification, then in-progress after
branching, preserving area/type/priority labels. #8 was already merged and is not a #9 dependency.

Inspected AGENTS, CONTRIBUTING, workflow/quality/prototype transition, ADR indexes and
0006–0008, domain/authorization/API/event/idempotency/security/configuration/open decisions,
API/DB scaffolds, workspace/package/TypeScript/ESLint configuration, CI, current frontend
tests, #5 tooling scripts/evidence and #6/#7 planning fixtures/validators/evidence. Paths and
commands here refer to this current checkout, not the historical issue baseline.

## Every acceptance criterion

| Criterion | Decision | File/evidence | Verification command | Result / downstream owner |
| --- | --- | --- | --- | --- |
| 1. Six layers without every layer for every change | Layer responsibility table, applicable-layer selection with meaningful omissions | `testing-contract.md`, Choose layers | `pnpm check:planning`; review table | Defined; owners add actual feature-layer cases |
| 2. Siblings and unrelated tenants | Deterministic Alpha/Alpha-1/Alpha-2 and Beta/Beta-1 with seven roles, valid UUID records | `packages/testkit/src/fixtures.ts`, `fixtures.test.ts` | `pnpm test:unit` | Serialization/relationships/foreign IDs tested; #14/#15 implement server enforcement |
| 3. Commit timeout, stale version and duplicates | Await commit before lost response; separate pre-commit failure; N/N+1 and same-identity replay | `failures.ts`, `provider.ts`, corresponding tests | `pnpm test:unit` | Controlled boundaries tested; #10/business/worker owners prove real persistence |
| 4. Refuse production database targets | Test mode, dedicated URL/test identity/name, trusted host allowlist and overriding denials; redacted errors | `database.ts`, `database.test.ts`; configuration guide | `pnpm test:unit` | Local/CI acceptance and unsafe refusal tested; #10/#68 bind actual deployment identity/network |
| 5. No silent required-DB skip | Inactive command is deliberately nonzero; activated required dependency must fail clearly | `scripts/test-database.mjs`, `database.test.ts`, activation checklist | `pnpm test:db` (expected exit 1); `pnpm test:unit` | Explicit inactive diagnostic tested both with/without config; #10 replaces with real missing/unreachable DB negative tests |
| 6. Explicit M1 CI activation | #10 installs pg/migrations and requires PostgreSQL job in final gate | Testing checklist; `packages/db/README.md`; quality guide | `pnpm check:planning`; checklist review | Unambiguous downstream #10 gate; no SQL tests claimed |
| 7. Frontend remains independent | Direct web command unchanged; root test includes both suites | Root/web manifests; `scripts/quality.test.mjs` | `env -u DATABASE_URL -u TEST_DATABASE_URL -u TEST_DATABASE_IDENTITY pnpm --filter @shippingco/web test` | Direct execution result recorded below; #18 owns future frontend integration |
| 8. Decisions, evidence, blockers; no production claims | Test-only models and dependency-free runner, explicit runtime limits | Testing contract, testkit README, this document | `pnpm quality`; complete diff review | No API/auth/schema/provider production implementation; #10/#11 and feature owners remain |
| 9. Current-main paths/commands | Current SHA/dependency evidence and real manifests checked; docs linked in architecture/developer guides | Baseline above; existing planning link checker | `pnpm quality`; `git diff --check` | Final command evidence below; remote head checks in PR |

## Implementation review

The new workspace is test-only because API/DB/worker/provider tests need the same reusable
fixtures. Its only dev dependencies are existing catalog TypeScript 5.9.3 and Node types
20.19.43. There are no new third-party packages or resolved versions, install scripts,
Fastify/pg/node-pg-migrate dependencies or application imports. The lockfile change is
only a nine-line workspace importer. Node's existing tooling runner executes erasable
TypeScript on pinned Node 22.23.2; Vitest remains the application/frontend convention.
ESLint and tooling tests enforce production import/dependency restrictions.

Fixtures are small composable fictional references; canonical roles are checked against
the accepted authorization table. Callback signatures use an explicitly public synthetic
key for a fictional protocol. No real phone/address/email/GSTIN, OTP/verifier, production
credential/provider payload, product tables or business endpoints were added. Existing
frontend app/test source is unchanged. No deployment or data migration is involved;
reverting this harness changes no product state.

Real PostgreSQL integration testing is intentionally not active until Issue #10.
The evidence-array commit test proves helper ordering, not SQL transaction semantics.
Synthetic HMAC proves raw-byte integrity for its fixture protocol, not Meta/carrier
verification. There is no installed Fastify server or passing API injection suite.
No production tenant isolation, auth, delivery proof or worker dedupe is certified here.

## Final local verification

Commands use repository-pinned Node 22.23.2, pnpm 10.34.5 and Python 3.12.14. This host's
isolated tools already existed from #8, so no global installs or pin changes were needed:

```sh
export PATH="/tmp/shipit-issue8-tools/node-v22.23.2-darwin-arm64/bin:$PATH"
export PYTHON="/tmp/shipit-issue8-tools/python/bin/python3"
pnpm install --frozen-lockfile --ignore-scripts
pnpm quality
env -u DATABASE_URL -u TEST_DATABASE_URL -u TEST_DATABASE_IDENTITY pnpm --filter @shippingco/web test
pnpm test:db  # expected nonzero until Issue #10
pnpm audit --json
git diff --check
```

| Exact command/check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS, exit 0; six workspace projects, unchanged package resolutions |
| `pnpm quality` | PASS, exit 0: 7 tooling tests, planning/domain/API/security/policy/migration validators, zero lint warnings/errors, 5 workspace typechecks, 23 testkit tests, 24 frontend tests, production build |
| `pnpm test:unit` (executed inside `pnpm quality`) | PASS: 23 tests, zero failed/skipped/cancelled |
| `env -u DATABASE_URL -u TEST_DATABASE_URL -u TEST_DATABASE_IDENTITY pnpm --filter @shippingco/web test` | PASS, exit 0: all 24 existing tests without DB configuration |
| `pnpm test:db` | EXPECTED exit 1 with `DB_TEST_RUNTIME_NOT_ACTIVE`; not a SQL test pass |
| `pnpm verify:gates` | PASS, exit 0: all 11 disposable stages including new `testkit-rejection`, clean/restored full quality and empty-store frozen install |
| `pnpm audit --json` | PASS, exit 0: zero advisories at execution time |
| `git diff --check` | PASS; complete new/changed diff reviewed |
| Source diff / built HTML inspection | Existing web app/test source and API/DB/shared scaffold source unchanged; no testkit sentinel/key/guard markers in built HTML |

The disposable drill proves root `pnpm test` fails for a real failing testkit assertion,
as well as the existing lockfile/lint/promise/type/frontend/build failures. Initial local
iteration corrected a role-table test lookup and awaited Node test registration under the
existing floating-promise lint rule. Final review added invalid-calendar-date clock rejection;
clean/restored quality includes that fix. No lint suppression or quality gate was weakened.

Existing three React `act(...)` warnings and whatwg-encoding deprecation remain visible.
The web bundle is 539.55 kB (156.30 kB gzip), matching the existing baseline. These prototype
warnings are not new harness failures or evidence of production security behavior.

At baseline GitHub protection required strict/up-to-date `Planning and prototype checks`,
admin enforcement and resolved conversations, with **zero** required approving reviews and
no additional rulesets. The user explicitly authorizes normal self-merge if allowed. Recheck
protection, actual final PR head CI and review conversations before merge; no independent
approving reviewer is invented and no policy is changed. PR CI/review/merge/closure are
external lifecycle evidence recorded in the PR, not pre-merge claims in this document.
