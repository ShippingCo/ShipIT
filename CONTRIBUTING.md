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
pnpm lint  # introduced by the M0 lint-baseline issue; missing is not passing
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

The current root scripts are test, typecheck and build. This setup adds planning validation/CI; the M0 quality-gate issue owns installing/configuring the application linter. Until then, report lint as unavailable, never green. All product implementation depends on that baseline. No product functionality is implemented by the planning setup.

Security-sensitive findings belong in [private security reporting](https://github.com/ShippingCo/ShipIT/security/advisories/new), not public issue bodies. Use fictional fixtures and sanitized evidence. See [SECURITY.md](SECURITY.md).
