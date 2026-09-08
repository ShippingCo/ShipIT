# Quality checks

Issue #5 established local and GitHub checks; #9 added the shared test harness and
#10 activates real PostgreSQL integration. Current checks cover the prototype,
planning contracts and database infrastructure. Production tenancy, delivery proof,
provider integration and deployment remain with their implementation issues.

## Setup

- Node **22.23.2**, from `.node-version` (supported Node 22 maintenance LTS).
- pnpm **10.34.5**, from `package.json` `packageManager`.
- Python **3.12.14**, from `.python-version`. Python assertions must remain enabled.
- Git is needed by tooling tests, migration-history checking and disposable-checkout verification.
- Docker must be running for `pnpm db:local`. It uses the reviewed PostgreSQL 18.6
  Bookworm image pinned by manifest digest; see [the dependency review](architecture/issue-10-dependency-review.md).

Use a version manager or the official Node binary, and install the pinned pnpm.
Put these executables ahead of older wrappers on PATH. Python may also be selected
with the `PYTHON` environment variable naming its executable, without extra arguments.
For Windows, use `pnpm.cmd` if PowerShell blocks a `.ps1` shim. A maintained Python
distribution is needed for 3.12 security releases; Windows also needs IANA timezone
data available to `zoneinfo` (the verified bundled Python includes tzdata 2026.3).
Linux CI uses the runner's IANA timezone database. These fixtures check a modern
Asia/Kolkata date, not historical timezone dataset equivalence.

From the repository root:

```sh
node --version
pnpm --version
pnpm check:toolchain
pnpm install --frozen-lockfile --ignore-scripts
pnpm db:local quality
pnpm check:migrations
```

`pnpm quality` runs, in order: toolchain verification, tooling tests, planning and
domain validators, lint, all workspace typechecks, testkit/DB unit, API and prototype tests,
required real PostgreSQL tests, and web build. It stops on a failed command and requires
guarded test database configuration. `pnpm db:local quality` supplies that configuration
using a fresh container and removes the container afterward; `pnpm db:local` defaults
to the same command. Individual commands are available for faster iteration:

```sh
pnpm test:quality
pnpm check:planning
pnpm lint
pnpm typecheck
pnpm test
pnpm db:local test:db
pnpm build
pnpm check:migrations
pnpm db:local verify:gates
```

The last command needs registry network access and Docker. It snapshots maintained files into
a new temporary directory, installs with a **new empty package store**, runs quality,
injects each controlled failure, restores every changed file, and reruns quality.
It never copies `.env`, `.codex`, developer caches or the local planning pack. The
temporary directory is removed after a checked path-boundary assertion. Sanitized
test output remains under `node_modules/.cache/quality-verification/`.

The verification script has **22 stages**: three setup/clean/restored checks, eight
existing lockfile/lint/types/unit/frontend/build rejection drills, three database
rejections for missing configuration, unavailable service and zero discovered files,
one API assertion rejection, two further database rejections for discovered files with no tests or all skipped tests,
and five executions of the exact final CI gate (success plus failed, cancelled,
skipped or absent database work). Database credentials are redacted before logs
are written. Full clean/restored quality runs inherit the helper's valid bootstrap
configuration; the empty-suite drill restores every removed integration file.

`pnpm check:migrations` is a separate required CI check. It compares files under
`packages/db/migrations/` with `MIGRATION_BASE_SHA`, or fetched `origin/main` locally.
Released `.cjs`, `.mjs`, `.js` and `.sql` files cannot be edited, deleted or renamed;
forward additions are allowed. Missing comparison history fails the command.
It stays outside `pnpm quality` because the verification snapshot has no Git history.
Tooling tests exercise immutability in an independent temporary Git repository.

## Lint policy

ESLint recommended correctness rules and TypeScript recommended rules cover apps,
packages and maintained JavaScript tooling/configuration. TypeScript project service
enables `no-floating-promises` and `no-misused-promises`. React's rules-of-hooks and
exhaustive-deps are errors. React Compiler migration rules are not enabled for this
React 18 prototype. This is a deliberate rule selection, not a claim of all possible
type-aware or accessibility analysis.

There is no formatting rollout. Existing strict TypeScript settings remain intact;
the web package's existing `noImplicitAny: false` remains migration debt owned by
the prototype migration work (#7/#18). Explicit `any` is still linted. Underscore
prefixed unused **parameters** are accepted, for deliberate argument/property omission;
unused local variables and imports are still errors.

Lint exits nonzero for any error or warning. Unused disable directives are errors.
Source folders (including imported UI components) are linted. Only dependencies,
generated bundles/coverage, local agent/cache files and the separate local planning
pack are ignored. Python files use the existing executable contract validators;
ESLint does not pretend to lint Python.

## Prototype exceptions

All eight hook exceptions are **one-line, one-rule** directives. The tooling test
counts them and rejects new unregistered frontend exceptions. Each change requires
review of this register and the test. They are owned by the developer implementing
#7, to be covered by migration fixtures and revisited before the #18 data seam lands.
No person is assigned without their agreement; no GitHub issue was edited here.

| ID | Location | Why retained | Removal condition |
| --- | --- | --- | --- |
| L01 | ReportsPage, two report selectors | `data` is the invalidation signal for getters reading the mutable store | Replace with explicit snapshot inputs; test report updates |
| L02 | EwayPage, e-way selector | Same store invalidation requirement | Explicit snapshot inputs; test refreshed e-way rows |
| L03 | CustomerWhatsApp, greeting | Seed at persona change without replaying initialization on every store update | Test persona/greeting initialization with the new data seam |
| L04 | LotsPage, open defaults | Recomputing destinations every render must not reset an edited form | Stable initialization model with edit-preservation regression |
| L05 | RoutesPage, open defaults | Business/time changes must not reset an in-progress form | Test opening defaults and retained edits separately |
| L06 | LotsPage, city defaults | Existing exception: preserve manual parcel/name overrides between city changes | Test city selection and manual overrides |
| L07 | PackagesPage, initial URL cleanup | Existing exception: consume initial deep-link parameters once after state initialization | Test deep-link state capture and cleanup |

The router declaration is **not a suppression**: declarative HashRouter navigation
returns void. Revisit the declaration before migrating to data-mode RouterProvider.
Real Promise-returning event handlers remain checked by the negative verification.
Both file upload handlers already catch file-processing errors; their wrapper now
explicitly discards the handled Promise. No async checks are disabled globally.

## GitHub enforcement

Every PR into main and main push runs five independent matrix jobs on ubuntu-24.04:
`Quality (planning)`, `Quality (lint)`, `Quality (types)`, `Quality (tests)`,
`Quality (build)`, plus the required **PostgreSQL integration** job. Each job has a
15-minute timeout and the same pinned toolchain. The PostgreSQL job runs
`pnpm db:local test:db` with a digest-pinned container, generated credentials,
loopback-only port binding, bounded readiness and cleanup after failure or interruption.
Matrix fail-fast is disabled so one failure does not hide other results. Older runs
are cancelled when replaced. There are no changed-path shortcuts.

The branch-required check remains **Planning and prototype checks**. It runs with
`always()` and depends on both the entire matrix and PostgreSQL integration. Its
two-minute inline gate accepts exactly those two successful results. Failure,
cancellation, skip, neutral, missing or malformed results cannot pass. It does not
depend on checkout or installation.
The tooling test executes the actual inline gate body for success and negative cases.

The planning job also runs `pnpm check:migrations`. Its checkout fetches full history
and supplies the PR base SHA or previous main SHA as `MIGRATION_BASE_SHA`; this check
cannot silently pass because a comparison commit is unavailable. The **10 tooling
tests** cover the workflow, final gate, migration history, container lifecycle,
toolchain and lint/import boundaries.

Actions use immutable reviewed commit pins; checkout does not persist credentials.
Default token permissions are read-only; no production secrets, deployments or real
customer sends are configured. Cache only pnpm's package store, keyed through setup-node
and the lockfile. A cache hit never skips locked installation or checks. Lifecycle
scripts remain disabled; a future necessary exception requires a dependency review.

Inspect actual branch protection/rulesets when verifying a PR and confirm that the
existing required name is enforced on the current commit. Workflow YAML alone does
not configure repository protection. Preserve existing review and merge requirements;
record current-commit CI evidence in the issue verification document. Issue #10 is
delivered as a PR for the maintainer to review and merge.

If a merge queue is introduced later, add and verify `merge_group` before enabling
it. These checks do not add a deployment pipeline, coverage target, access to
production databases or provider security certification.

## Maintenance and recovery

Keep Node/pnpm/Python version files, documentation and CI in sync through reviewed
PRs. Check security updates promptly and review other updates regularly. Pinning is
not permission to ignore updates. Action updates also need pin and behavior review.
Keep failures visible; do not add `continue-on-error`, automatic retry-until-green,
blanket disables or silent test exclusions. Existing React act warnings remain visible
and need test isolation/waiting remediation under #7/#9. Do not silence console output.

For a broken gate, inspect the named job and reproduce its command with the pinned
toolchain. Fix or revert the responsible change through review. Revert the issue's
tooling changes if necessary; no customer data migration is involved. Any proposal
to relax merge enforcement needs a separate explicit maintainer decision.

## Issue #5 dependency review (historical)

Reviewed 2026-09-08 against npm metadata, OSV and pnpm's registry audit. These are
development-only dependencies. Registry integrity is recorded in the lockfile.

| Dependency | Exact version | Purpose | Release reviewed |
| --- | --- | --- | --- |
| eslint | 10.10.0 | Supported linter | 2026-09-04 |
| @eslint/js | 10.0.1 | JavaScript recommended rules | 2026-02-06 |
| typescript-eslint | 8.68.0 | TS parser/rules/project service | 2026-08-24 |
| eslint-plugin-react-hooks | 7.1.1 | Hook correctness rules | 2026-04-17 |
| globals | 16.5.0 | Browser/Node global definitions | 2025-11-01 |
| yaml | 2.8.3 | Parse and verify actual workflow | 2026-03-21 |

Official project packages and compatible peer/engine ranges were checked. Direct
packages have no install/preinstall/postinstall scripts; globals has a source-build
prepare script, and all lifecycle scripts are disabled for installs. ESLint 10.10.0
is a recent four-day-old release of the supported major; its age was considered and
the exact release checked instead of installing an unpinned latest version. The
initially considered ESLint 9 release was rejected as unsupported.

Publisher/source review: eslintbot/OpenJS Foundation for ESLint packages,
typescript-eslint's GitHub Actions publisher with jameshenry/bradzacher maintainers,
react-bot for React Hooks, sindresorhus for globals and eemeli for yaml. Registry
attestation metadata was present for typescript-eslint; no attestation verification
is claimed for the other packages. The lockfile adds 92 package versions (379 to 471),
removes none, and keeps the web production dependency resolutions unchanged. Vite
and related tooling gain yaml peer-context suffixes, not a product version upgrade.

OSV returned no listed advisories for the selected direct versions; the resolved
registry audit reported zero listed vulnerabilities. This is dated evidence, not a
guarantee of no vulnerabilities. The existing whatwg-encoding deprecation and React
act warnings are retained rather than triggering unrelated dependency upgrades.
Node's downloaded archive SHA256 and pnpm's downloaded tarball SHA512 were verified.
GitHub's Python release manifest confirms 3.12.14 is available for the Linux runner.

References: [ESLint configuration](https://eslint.org/docs/latest/use/configure/configuration-files),
[typed linting](https://typescript-eslint.io/getting-started/typed-linting/),
[React lint rules](https://react.dev/reference/eslint-plugin-react-hooks),
[router return types](https://reactrouter.com/api/hooks/useNavigate#return-type-augmentation),
[GitHub required checks](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks),
[GitHub security](https://docs.github.com/en/actions/reference/security/secure-use).

## Harness inclusion and Issue #10 PostgreSQL activation

[Testing contract](architecture/testing-contract.md) owns layer selection, deterministic
fixtures, fake clocks/providers, failure boundaries and database isolation requirements.
`pnpm test` runs `pnpm test:unit` (Node testkit and DB unit tests), then
`pnpm test:api` (Vitest API), then `pnpm test:web` (Vitest frontend).
`pnpm --filter @shippingco/web test` remains independently runnable without PostgreSQL.
The CI tests matrix job requires these service-free suites; the separate PostgreSQL
job requires the real database suite. Testkit remains a development-only workspace.
Lint restricts production imports and tooling tests check manifests. The original
#9 dependency and inactive-runner evidence remains in [its historical verification](architecture/issue-9-verification.md).

Issue #10 replaces the inactive diagnostic with **17 real PostgreSQL integration
tests**: five migration cases, five transaction cases and seven pool/security/isolation
cases. They cover fresh/repeated/forward migration, failed migration rollback and
advisory-lock recovery, atomic commit/rollback and uncertain commit outcomes, bound
SQL values, runtime privileges, timeouts/outage recovery and exact resource cleanup.
They use synthetic fixture tables; production tenant tables and authorization tests
remain with their feature owners. `pnpm quality` now requires this suite to pass.

The runner fails for missing/unsafe configuration, unreachable bootstrap, empty
discovery/execution, skipped/cancelled/todo tests and setup/cleanup failures. Its parent
cleans registered disposable databases and roles; the outer helper removes its exact
container and anonymous volumes. Generated passwords stay in child environment/driver
configuration. The disposable service uses `log_statement=none` and
`log_min_error_statement=panic`. Frontend commands require no DB setup.


## Issue #11 API boundary checks

`pnpm test:api` activates the pinned Vitest API suite in normal tests/quality/CI;
`pnpm build` now checks the erasable TypeScript API before building the frontend.
`pnpm test:db` requires both the existing 17 DB cases and the API real PostgreSQL
restart/outage case. The required final gate still depends on PostgreSQL integration.
`pnpm test:web` remains runnable with all DB/API configuration absent.
`pnpm db:local verify:gates` adds an intentional API test failure drill to the existing
21 stages. No existing PostgreSQL drill or enforcement is removed.
See [Issue #11 verification](architecture/issue-11-verification.md) and
[API operating guide](../apps/api/README.md) for exact policy and acceptance evidence.
Issue #11 delivery stops with the PR open for independent external review; merge,
issue closure, downstream unblocking and branch cleanup require later authorization.

## Issue #12 tenancy checks

The required API suite now includes strict tenancy input/DTO/authorization-seam cases
and confirms normal production composition exposes no private tenant routes. The real
PostgreSQL suite adds tenancy schema/privilege/ownership constraints, service scope,
version and duplicate races, transaction rollback, disable/write lock ordering and
restart persistence. Existing API, PostgreSQL and final required gates are preserved.
Use the same `pnpm db:local quality`, `pnpm db:local verify:gates` and
`pnpm check:migrations` commands; the infrastructure migration remains unchanged.
See [Issue #12 verification](architecture/issue-12-verification.md) for exact results and
the explicit external-review boundary: leave its PR open and branch retained.
