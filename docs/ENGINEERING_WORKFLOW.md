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

Use the committed `packageManager` (`pnpm@10.34.5`) with a supported Node runtime. Setup CI pins Node 22 and pnpm; no product package upgrade is implied.

```sh
pnpm install --frozen-lockfile --ignore-scripts
python3 scripts/validate_planning.py
pnpm test
pnpm typecheck
pnpm build
```

Baseline inspection/test result: 23 frontend tests pass; typecheck passes all four workspace packages; Vite production build passes. React `act(...)` warnings already occur in the prototype tests. No lint command exists yet. The M0 quality-gate issue adds a reviewed linter and required CI lint check before product development. Planning validation is not a substitute for application lint.

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
