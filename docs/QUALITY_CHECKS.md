# Quality checks

Issue #5 adds local and GitHub checks before changes enter main. These checks cover
the existing prototype, scaffold types and planning contracts. They do not certify
production tenancy, delivery proof, provider integration or deployment.

## Setup

- Node **22.23.2**, from `.node-version` (supported Node 22 maintenance LTS).
- pnpm **10.34.5**, from `package.json` `packageManager`.
- Python **3.12.14**, from `.python-version`. Python assertions must remain enabled.
- Git is needed only by the disposable-checkout verification command.

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
pnpm quality
```

`pnpm quality` runs, in order: toolchain verification, tooling tests, planning and
domain validators, lint, all workspace typechecks, prototype tests, and web build.
It stops on a failed command. Individual commands are available for faster iteration:

```sh
pnpm test:quality
pnpm check:planning
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:gates
```

The last command needs registry network access. It snapshots maintained files into
a new temporary directory, installs with a **new empty package store**, runs quality,
injects each controlled failure, restores every changed file, and reruns quality.
It never copies `.env`, `.codex`, developer caches or the local planning pack. The
temporary directory is removed after a checked path-boundary assertion. Sanitized
test output remains under `node_modules/.cache/quality-verification/`.

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
`Quality (build)`. Each job has a 15-minute timeout and an identical pinned toolchain.
Matrix fail-fast is disabled so one failure does not hide other results. Older runs
are cancelled when replaced. There are no changed-path shortcuts.

The branch-required check remains **Planning and prototype checks**. It runs with
`always()` and depends on the entire matrix. Its two-minute inline gate accepts only
an explicit successful matrix result. Failure, cancellation, skip, neutral, missing
or malformed results cannot pass. It does not depend on checkout or installation.
The tooling test executes the actual inline gate body for success and negative cases.

Actions use immutable reviewed commit pins; checkout does not persist credentials.
Default token permissions are read-only; no production secrets, deployments or real
customer sends are configured. Cache only pnpm's package store, keyed through setup-node
and the lockfile. A cache hit never skips locked installation or checks. Lifecycle
scripts remain disabled; a future necessary exception requires a dependency review.

After the user authorizes pushing, inspect actual branch protection/rulesets and
verify the existing required name is enforced on the current PR commit. Require
up-to-date integration with main, one independent approval, stale-approval dismissal,
resolved conversations and enforcement for administrators. Do not weaken existing
rules or claim that workflow YAML alone configures repository protection. A controlled
failing PR check must visibly block merge. The user has not authorized pushing yet,
so remote CI, protection changes and the merge-block demonstration are pending.

If a merge queue is introduced later, add and verify `merge_group` before enabling
it. No deployment pipeline, code coverage target, production DB tests or provider
security certification is added by this issue; #9, M1 and later release issues own them.

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

## Dependency review

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
