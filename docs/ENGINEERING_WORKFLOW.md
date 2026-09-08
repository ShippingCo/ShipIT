# Engineering execution workflow

GitHub issues are the authoritative implementation contracts. Milestones group product outcomes; status labels and an optional Project track execution, not sprints. `docs/ROADMAP.md` maps the release path and `docs/ISSUE_INDEX.md` indexes dependencies. Do not copy full issue bodies into roadmap prose.

## Mandatory issue lifecycle

1. Switch to main: `git checkout main` (first preserve unrelated work; never discard it).
2. Pull the latest main BEFORE branching: `git pull origin main`.
3. Create a dedicated issue branch: `git checkout -b issue-<number>-<short-scope>`.
4. Implement only the agreed issue scope.
5. Add/update the relevant automated tests.
6. Run required tests, typecheck, lint and production build; record exact results.
7. Commit with a meaningful message.
8. Push the branch: `git push -u origin <issue-branch>`.
9. Create a Pull Request targeting main.
10. Reference and close/link the issue in the PR, normally `Closes #<number>`.
11. Verify required CI checks on the current PR commit.
12. Review the diff and resolve review feedback before merge.
13. Merge only when acceptance criteria and Definition of Done are satisfied and no conflicts remain.
14. Switch back to main: `git checkout main`.
15. Pull newly merged main: `git pull origin main`.
16. Delete the completed local/remote issue branch when appropriate; never delete another person's active work.
17. Start the next issue from this newly updated main, not the previous feature branch.

## Readiness and status

- Backlog: triaged work not yet selected; no execution-status label is required.
- Ready / `status: ready`: prerequisites merged, scope/acceptance criteria reviewed, no unresolved decision preventing work.
- In Progress / `status: in-progress`: a contributor has claimed the issue and created its branch.
- In Review / `status: review`: pushed PR ready for review with current CI.
- Blocked / `status: blocked`: a named unresolved prerequisite or external decision prevents starting/continuing. Link it in the issue.
- Done: issue closed only with completed acceptance evidence and merged PR; finish local main/branch cleanup afterward. Reopen if acceptance is demonstrably unmet.

Use at most one execution-status label. A merged prerequisite does not automatically make dependents ready: re-evaluate every prerequisite and contract. During initial setup only architecture ratification and CI/lint baseline are ready. Research can start as soon as its own M0 dependencies are satisfied. M8 is future work and never blocks the pilot.

## Branches, PRs and review

Preferred branch format is `issue-<number>-<short-scope>`, for example `issue-12-tenant-isolation`. Setup-only changes may use `chore/project-roadmap-and-engineering-workflow`. No implementation is committed directly to main. Avoid unrelated formatting, dependencies or UI rebuilds. Document justified multi-PR sequencing in the owning issue.

PRs must link the issue, map changed behavior to acceptance criteria, include tests and limitations, and explain migration/rollback and tenant/privacy effects. Do not check post-merge items before merging. Review the exact final commit/diff; push new fixes and rerun affected checks. Required checks must pass on the current PR head and unresolved conversations must be resolved. Do not bypass protection or force merge.

An independent approving review is the production workflow target. Setup may be reviewed by the configuring maintainer before enabling the final protection rule; record that limitation rather than inventing another reviewer. Future main protection requires a PR, up-to-date CI, resolved review conversations and an approving reviewer. Only maintainers change protection after documenting a justified policy change.

## Quality commands and current baseline

Use Node 22.23.2, pnpm 10.34.5 and Python 3.12.14. The version files and packageManager are authoritative. See [quality checks](QUALITY_CHECKS.md) for setup, registered exceptions and enforcement rollout.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local quality
# Optional full controlled-failure drill in a disposable checkout:
pnpm db:local verify:gates
```

`db:local` starts a pinned disposable PostgreSQL container with generated credentials and removes it after the command. Docker must be running. With an independently provisioned, guarded test database, run `pnpm quality` / `pnpm verify:gates` directly. Full M1 quality requires real PostgreSQL; `pnpm test:unit` and `pnpm test:web` remain independently runnable.

Historical baseline: 23 frontend tests, four workspace typechecks and build passed. Issue #5 added real lint and gate-verification tests. Existing React `act(...)` warnings remain visible. The required final check keeps the name `Planning and prototype checks` and accepts only successful results from all five matrix jobs **and** the PostgreSQL integration job. CI also requires `check:migrations`, which compares released migration files with Git history and rejects edits, deletion or renaming; corrections are new forward migrations. Remote CI/protection verification is still required after pushing; local passing results are not GitHub merge approval.

Use real PostgreSQL/runtime roles for tenant constraints and transactions once M1 activates them. Use fake clocks for expiry and dates, signed synthetic webhooks, fake providers, and fault injection for commit/ack/timeout boundaries. Browser tests cover meaningful workflows, keyboard/focus and intentional prototype regressions. No real customer sends or production credentials in CI.

## Architecture and security guardrails

- Retain React/Vite, Fastify, `pg`, raw SQL and `node-pg-migrate` unless an ADR justifies a change. Backend scaffold files are not implemented services.
- Keep API routing/validation, domain services and parameterized queries distinct within domain modules. Share public DTOs/pure rules only; secret-dependent OTP and authorization stay server-side.
- Store operational ownership explicitly. Every private query, nested ID, cache, export, attachment and worker enforces organization/franchise scope. Physical custody does not grant directory access.
- Commit trusted domain events with state; automation consumes them and enqueues durable message intents. Provider calls never originate in frontend business handlers.
- Use request fingerprints/idempotency, expected versions and unique constraints. Treat unknown external send outcomes explicitly; never promise exactly-once delivery unsupported by the provider.
- Money, tax snapshots, delivery proof and payment ledgers are authoritative services. AI may interpret language; it cannot invent or write operational facts.
- Use forward-only migrations, reviewed expand/contract compatibility and tested restore. Never edit applied migrations or import browser state silently.
- Review dependencies/actions/install scripts before additions; credentials remain server-only. Never log OTPs, full private payloads or secret-bearing URLs.
- Preserve the icon/number-led Material 3 design, white surfaces and existing tokens. Production API failures cannot silently revert to demo/localStorage.

## Definition of Done

- [ ] Agreed scope is fully implemented; no unrelated feature responsibility was absorbed.
- [ ] All acceptance criteria are satisfied with linked evidence.
- [ ] Relevant automated tests are added or updated.
- [ ] Tests pass.
- [ ] Typecheck passes.
- [ ] Lint passes; M0 lint-baseline issue must establish the command before product implementation (never report a missing command as passing).
- [ ] Production build passes.
- [ ] No known regressions are introduced; intentional prototype behavior changes are documented.
- [ ] Security/privacy requirements for this issue are verified.
- [ ] Tenant-isolation behavior is verified when applicable, including sibling franchises and unrelated organizations.
- [ ] Relevant developer/operator documentation is updated.
- [ ] Work was started from the latest main after git checkout main and git pull origin main.
- [ ] A dedicated issue branch was created.
- [ ] No implementation was committed directly to main.
- [ ] Branch was pushed to GitHub.
- [ ] Pull Request was created against main.
- [ ] Pull Request links/closes this issue.
- [ ] Required CI checks pass on the current PR commit.
- [ ] Review feedback is resolved.
- [ ] PR merges cleanly into main only after acceptance criteria and pre-merge DoD gates pass.
- [ ] No unresolved merge conflicts remain.
- [ ] After merge, local main is checked out and pulled.
- [ ] Completed branch is cleaned up when appropriate.
- [ ] Demo/verification scenario is documented and reproducible.

## Milestone review

Review outcome evidence, dependency closure, negative authorization cases and representative failure recovery. A milestone is complete only when its exit criteria are demonstrated. Security defects affecting tenant isolation, money, proof or durable work block pilot. M7 re-verifies controls that earlier issues already implement. M8 commercialization is not an MVP requirement.

## Testing layers and M1 activation

Use the [Issue #9 testing contract](architecture/testing-contract.md) to choose applicable
unit, DB, API, contract, worker and browser tests. `pnpm test` now includes the harness
and frontend; `pnpm test:web` remains independent. Issue #10 activates `pnpm test:db`
and required real PostgreSQL CI. Missing or unsafe configuration, unavailable PostgreSQL,
an empty required suite, test failure or cleanup failure returns nonzero. See
[Issue #10 verification](architecture/issue-10-verification.md) for persistence,
transaction, migration and privilege evidence. Issue #11 activates API injection and real DB compatibility tests.


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
