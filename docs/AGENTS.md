# ShipIT agent guidance

Current engineering authority: [CONTRIBUTING](../CONTRIBUTING.md), [engineering workflow](ENGINEERING_WORKFLOW.md), [roadmap](ROADMAP.md), and the assigned GitHub issue. The explicit production-planning request supersedes historical no-Git/no-CI instructions. Git and reviewed PRs are now mandatory. Do not implement product features during project setup.

## Repository reality

React/TypeScript/Vite operator and fictional WhatsApp demo live in `apps/web`. API, DB and shared packages are scaffolds. Read actual `.ts`/`.tsx` paths and package scripts, not older root `.js` examples. Fastify, raw SQL over pg and node-pg-migrate are the chosen backend. Never silently introduce an ORM or a new framework.

## Execution

Start every issue from `git checkout main` and `git pull origin main`, then `issue-<number>-<short-scope>`. Implement the agreed issue only, add/update relevant tests, run checks, push and open a linked PR. Verify CI/review before merge. After merge check out/pull main and clean completed branches. Preserve unrelated work; never code features directly on main. Do the work directly unless the user explicitly authorizes delegation.

Use the shell/platform actually present. Current repository scripts: `pnpm test`, `pnpm typecheck`, `pnpm build`; planning validator: `python3 scripts/validate_planning.py`. Application lint is introduced by its M0 baseline issue; never describe its current absence as a pass. Report warnings and failures honestly. Read the issue's test requirements, not a stale fixed test count.

## Product and design

Prototype v0 is completed before production milestones. Preserve icon/number-led Material 3 UX for courier owner-operators: white surfaces, existing design tokens, 1px outline-variant borders, tabular numbers, a single primary action, visible keyboard focus and reduced-motion behavior. Do not reintroduce Setu branding, greeting headers, decorative gradients or generic dashboard styling. Existing ShippingCo runtime branding/package names stay unless separately scoped.

## Production guardrails

Server owns status, price, money, authorization and delivery proof. Customer phone/docket input is not identity. Every private data path enforces organization/franchise scope. Workers consume trusted durable events; the browser never calls business messaging providers directly. Shared contains public DTOs and pure non-secret rules only. OTP generation/verification/keys remain server-side; no staff code reveal or raw OTP logs. AI may interpret language, never invent operational facts. Carrier integrations are capability-based with manual/file fallback. Demo is fictional and cannot mutate production. See the full issue and workflow for transaction, retry, migration, privacy and testing requirements.

DESIGN_BRIEF is historical design context. Its old bug lists, workflow instructions, market figures and legal/provider assumptions are not current implementation directives.
