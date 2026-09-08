# Issue 5 verification

Local branch: `issues/5-ci-and-linters`.
Base: `308f247566dae99a9f116121f244b1fc8a90cbfb`, freshly pulled main.
The user's explicit instruction requires permission before pushing. No push, PR,
GitHub settings mutation, merge or issue closure is claimed.

## Baseline

Using Node 22.23.2 and pnpm 10.34.5, frozen installation without lifecycle scripts
passed. All 23 existing tests, all four package typechecks and web build passed.
Existing React act warnings were recorded. Root lint was absent before this issue.
The user's modified .gitignore and local .codex/planning files remain unrelated work.

## Acceptance evidence

Local verification completed 2026-09-08. Remote evidence remains pending
until the user authorizes pushing; local tests cannot prove GitHub protection settings.

| Criterion | Evidence and state |
| --- | --- |
| Fresh locked install | PASS: disposable checkout and new empty pnpm store; locked install without lifecycle scripts exited 0 |
| Deliberate lint failure | PASS: debugger, floating Promise and Promise-returning UI handler each fail the real lint command with the expected rule |
| Test/type/build failures | PASS: failing assertion, wrong TypeScript assignment and missing build module each fail their corresponding command |
| Narrow legacy exceptions | Eight single-line Hook directives, seven registered reasons; counted by tooling test |
| Safe CI permissions | Parsed workflow test checks read-only token, pinned actions, install flags, no secrets or privileged PR trigger |
| Required check matches actual jobs | Preserved final name and actual inline gate tested locally; remote completed jobs/protection pending |
| Exact tools and commands | Node/Python version files, packageManager/engines and QUALITY_CHECKS guide |
| Scope and context preserved | Existing strict options and domain contracts retained; targeted lint fixes only |
| Final PR and review | Pending user permission to push and independent review |

## Local command results

| Command | Result |
| --- | --- |
| `pnpm quality` in working checkout | PASS: exact toolchain; tooling tests; planning/domain/API-event validators; zero lint warnings/errors; all 4 workspace typechecks; 24 frontend tests; build |
| `pnpm verify:gates` | PASS: all 10 stages below; the same complete quality suite passed before and after failure injection |
| `pnpm audit --json` | PASS: zero listed vulnerabilities in the resolved registry audit |
| `git diff --check` | PASS: no whitespace errors |

The 24 frontend tests include all 23 existing tests and one Sparkline regression.
The five tooling tests include per-workspace lint probes, Hook errors, obsolete
suppression detection, registered exceptions, workflow security checks and ten
success/failure/missing-result cases against the actual final CI gate body.
Final self-review added a negative check proving that PYTHONOPTIMIZE cannot disable
the contract validators' assertions. Both the toolchain and planning wrappers reject
optimized Python with an explicit runtime check (not an assert that could be stripped).

The complete disposable drill recorded these exits:

1. New empty store installation: 0.
2. Clean full quality suite: 0.
3. Lockfile mismatch: 1, expected ERR_PNPM_OUTDATED_LOCKFILE.
4. Debugger lint violation: 1, expected no-debugger.
5. Floating Promise: 1, expected no-floating-promises.
6. Async UI handler: 1, expected no-misused-promises.
7. Wrong TypeScript value: 2, expected TS2322.
8. Deliberately failing test: 1, expected assertion failure.
9. Missing build input: 1, expected missing-module failure.
10. Restored full quality suite: 0.

Each negative case checks the expected diagnostic, not only a nonzero exit. Every
injected file is restored byte-for-byte or removed before the final pass. The local
checkout and index are not mutated by the drill. Logs are in the ignored directory
`node_modules/.cache/quality-verification/`; repeat the command to reproduce them.

The verified environment was Windows with the exact pinned tools and bundled IANA
timezone data. GitHub's Python manifest was checked for Linux availability. Linux
execution is not claimed: Docker's daemon was unavailable locally, and the user
has not authorized a push that could start GitHub-hosted jobs. The current-head
Ubuntu run, independent approval and live merge-protection demonstration remain
mandatory before calling the issue complete or production enforcement active.

Existing React act warnings and whatwg-encoding deprecation remain visible. The
production web bundle was 539.55 kB (156.30 kB gzip); baseline was 539.56 kB
(156.30 kB gzip). No production dependency resolution changed.

## Targeted source changes

- Fix conditional useId in Sparkline; test empty/populated rerenders and stable ID.
- Correct declarative router navigation return types without changing runtime routing.
- Explicitly discard already-handled upload Promises at the UI callback boundary.
- Remove unused types/imports/ref and one redundant initial value; keep the route
  card's store subscription even though its return value is unused.
- Spell the CSV byte-order mark as a Unicode escape, preserving output bytes.
- Document existing intentional catch behavior and eight scoped Hook exceptions.

See [quality guide](QUALITY_CHECKS.md) for exact commands, dependency review,
remediation owners, security controls and remote rollout steps.
