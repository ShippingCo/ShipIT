# Repository and reference inspection

Inspected 2026-09-05. Target: [ShippingCo/ShipIT](https://github.com/ShippingCo/ShipIT), public repository, default branch `main`, initial commit `54934846d812226a2a4b6c3b39fdb25003763617`. GitHub API confirms administrator permission. Local workspace initially held an empty Git repository without a remote; it was connected and checked out from origin/main before planning.

## Baseline

- React 18 / TypeScript / Vite frontend in `apps/web`; pnpm workspace with pinned package manager 10.34.5. Actual package versions supersede older notes claiming Vite 5/router 6/JS paths.
- Fastify/raw `pg` SQL/node-pg-migrate chosen in package READMEs; API/database/shared entry points are placeholders, dependencies not yet installed there.
- Operator pages, customer WhatsApp simulation, local store/types/messages/bot, receipt/image utilities and regression test file inspected.
- 23 existing frontend tests pass; all workspace typechecks and production build pass. Existing React act warnings remain. No lint script exists; M0 has a ready CI/lint-baseline issue.
- Initially no issues, milestones, PRs, GitHub templates, Actions workflows, branch protection or rulesets. Ten default labels existed; setup normalizes synonyms while retaining orthogonal triage labels.
- Current GitHub Project CLI access fails because token lacks `read:project`; creating/configuring a Project also requires suitable project write authority. Do not claim a board exists. Milestones plus consistent execution labels remain usable independently.

## Conflicting historical notes

`docs/AGENTS.md` and DESIGN_BRIEF include old no-Git/no-tooling instructions, Windows shell commands, root JS paths and historical test counts. The current explicit user request authorizes GitHub setup, CI/templates, branches, commits, PRs and validated merge. This setup replaces stale agent workflow guidance and marks the design brief historical. Preserve current visual constraints and useful prototype behavior; do not treat old bug lists as unimplemented work.

## Reference issues and workflows inspected

- [Restaurant Reservation #36](https://github.com/patelved3313/restaurant-reservation-system/issues/36), [#38](https://github.com/patelved3313/restaurant-reservation-system/issues/38), [#39](https://github.com/patelved3313/restaurant-reservation-system/issues/39), plus the broader issue index: useful organization/location/auth/tenant/onboarding decomposition. Sampled bodies have generic acceptance criteria, so their wording/quality bar was deliberately not copied. Its `.github` path was not present.
- [AI Travel Magazine #16](https://github.com/patelved3313/ai-travel-magazine/issues/16) and [#17](https://github.com/patelved3313/ai-travel-magazine/issues/17): explicit user outcomes, sequencing, approved-input boundaries, ownership/privacy, schema validation, retry semantics and limits on AI responsibility. Feature form, PR template and CI workflow were also read.
- [Toronto Housing #68](https://github.com/patelved3313/Toronto-student-housing-matrix/issues/68), [#70](https://github.com/patelved3313/Toronto-student-housing-matrix/issues/70), [#71](https://github.com/patelved3313/Toronto-student-housing-matrix/issues/71), plus representative closed issues: concrete test scenarios, reusable calculation boundaries, missing-data cases and branch/PR DoD. Its CI workflow was read.

ShipIT strengthens these patterns for sibling-franchise isolation, money/tax snapshots, secret-dependent delivery proof, durable messaging, unknown external acceptance, carrier provenance and privacy lifecycle. Research issues produce dated evidence and recommendations rather than unsupported API claims.

## Draft audit

80 issues across nine milestones, no duplicate titles or circular/missing dependencies. M0 has two initially ready issues. Every M0–M7 item is an ancestor of the pilot release gate; M8 is never its prerequisite. Each issue includes tailored rules, acceptance tests, security/ownership, failure handling and full branch→PR→merge→pull-main workflow. Full issue bodies live on GitHub, not duplicated in roadmap docs.
