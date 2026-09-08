# Contributing to ShipIT

Start with [the roadmap](docs/ROADMAP.md), [issue index](docs/ISSUE_INDEX.md) and [engineering workflow](docs/ENGINEERING_WORKFLOW.md). Prototype v0 is completed before production milestones; preserve its useful UX while production services progressively replace browser authority.

Choose a `status: ready` issue whose prerequisites are merged. Read the full issue, linked ADRs and acceptance criteria before writing code. One issue normally maps to one independently reviewable PR. Document any technically necessary exception and dependency order in both issues/PRs.

```sh
git checkout main
git pull origin main
git checkout -b issue-<number>-<short-scope>
# implement only the issue scope; add/update relevant tests
pnpm test
pnpm typecheck
pnpm lint
pnpm build
git add <reviewed-paths>
git commit -m "Describe the specific outcome"
git push -u origin issue-<number>-<short-scope>
# open PR, link Closes #<number>, verify CI, review, then merge
# after merge:
git checkout main
git pull origin main
git branch -d issue-<number>-<short-scope>
# delete completed remote branch if GitHub has not already removed it
```

Preserve unrelated/uncommitted work before switching branches. Never use reset/force-push to erase another person's work. No feature development directly on main. Start the next issue from newly pulled main.

Run `pnpm quality` with the exact toolchain in [quality checks](docs/QUALITY_CHECKS.md). It runs planning, tooling tests, lint, typecheck, tests and build. `pnpm verify:gates` proves controlled failures in a disposable checkout. See the guide for legacy exceptions and required GitHub check rollout. Never push when the user has reserved permission for a later review.

Security-sensitive findings belong in [private security reporting](https://github.com/ShippingCo/ShipIT/security/advisories/new), not public issue bodies. Use fictional fixtures and sanitized evidence. See [SECURITY.md](SECURITY.md).

See the [testing contract](docs/architecture/testing-contract.md) for fixture APIs, applicable
test layers and the Issue #10 PostgreSQL activation checklist. `pnpm test:web` runs the
frontend independently; `pnpm test:unit` runs the shared harness.
