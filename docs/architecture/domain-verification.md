# Issue #3 verification and acceptance evidence

[Architecture index](README.md) · [ADR 0006](../adr/0006-domain-ownership-and-authorization.md) · [Scenarios](domain-scenarios.md)

## Start-state and readiness evidence

Inspected 2026-09-07 UTC (6 September Toronto time): complete live
[Issue #3](https://github.com/ShippingCo/ShipIT/issues/3), closed
[Issue #2](https://github.com/ShippingCo/ShipIT/issues/2), merged
[PR #85](https://github.com/ShippingCo/ShipIT/pull/85), all five merged ADRs, architecture
context/sequences/pilot/decision/verification docs, CONTRIBUTING, engineering workflow,
docs/AGENTS, prototype transition/types/store/tests, package scripts, planning validator,
CI, roadmap and issue index. No production behavior was inferred from scaffold packages.

- #2 closed at `2026-09-06T22:55:20Z`; #85 merged at `2026-09-06T22:55:19Z` with
  `256512a725c56c5c0e0fa180253add5ac20a69d0`.
- Main [CI run 34065401784](https://github.com/ShippingCo/ShipIT/actions/runs/34065401784)
  succeeded on that merged baseline. #3's only named prerequisite is #2; its contracts
  were present, with D01–D03 explicitly assigned to #3. No remaining start blocker found.
- Working tree was clean on the earlier #2 branch. Ran `git status`, `git checkout main`,
  `git pull origin main`; main advanced to `256512a725c56c5c0e0fa180253add5ac20a69d0`.
  The adjacent planning directory and prior branch were preserved.
- Updated #3 from `status: blocked` to `status: ready` with the above evidence, created
  `issue-3-domain-ownership-contracts`, then set `status: in-progress`. No commits on main.
- Issue #5 remains OPEN. Package scripts and current CI still have no application lint
  command. No #5 toolchain/lint implementation is absorbed by this contract issue.

The owner's approved Issue #3 execution requirements supply the business evidence
recorded in ADR 0006. New conservative interpretations are named in the lifecycle's
[decision ledger](parcel-lifecycle.md#explicit-decision-ledger) for PR review. The
original issue's single-parcel suggestion is explicitly replaced, not silently retained.

## Acceptance criteria, mapped before PR creation

PASS here means the documentary evidence and fictional model were checked by the author,
not independent approval, real server enforcement or issue closure.

| Issue #3 acceptance criterion | Result | Evidence |
| --- | --- | --- |
| Role matrix includes list/detail/export/mutate/job access for every private domain | PASS | [Matrix](authorization-contract.md): R01–R30 private resource list/detail; E01–E04 exports; W01–W36 commands, jobs, configuration/destructive/state/custody; explicit denied default for every other action combination |
| Franchise A cannot see B even within the same organization without explicit organizational scope | PASS | [Cases C01/C07/C22/C23](domain-scenarios.md); separate parent, child and customer checks; C06 is narrowly declared custody projection |
| Organization admins gain only declared cross-franchise permissions inside their own organization | PASS | O/V reads, P adoption approval only; C03/C04 allowed, C05/C19/C20/C26 denied; no implicit operational/export/configuration authority |
| Independent franchise ownership does not require an enrolled national carrier | PASS | [Glossary](domain-contract.md#glossary-and-relationships), Org B/B1 synthetic setup; one architecture supports both sales models |
| Custody transfer never grants unrestricted access to the customer directory | PASS | [Custody contract](domain-contract.md#ownership-versus-custody); C06/C07/C22/C23; agent grant C17/C18 |
| State table identifies every permitted transition, precondition and responsible role | PASS | [T01–T13](parcel-lifecycle.md#complete-transition-table), shared retry/audit guarantees, state meanings and explicit deny of all other edges |
| Amounts use INR minor units and rounding rules are explicit | PASS | [Money](domain-contract.md#money-docket-and-time-invariants), 12549/12550/12551 paise fixtures and separate adjustment; no tax-law policy invented |
| Booking/parcel cardinality and docket collision scope are resolved before migrations start | PASS | One-to-many day one; global per-Parcel docket; full [prototype field mapping](prototype-domain-mapping.md), fictional global docket validation |
| Deliverable identifies decisions, evidence and remaining blockers without claiming production features implemented | PASS | [ADR 0006](../adr/0006-domain-ownership-and-authorization.md), [D01/D02 resolved contracts and D03 partial](open-decisions.md), explicit downstream gates, scope statement below |
| Repository paths and commands checked against current main; old prototype notes do not override workflow | PASS | Start-state evidence above, scripts/CI inspection, exact verification results below, retained prototype tests |

Additional requested checks: all 16 intentional prototype/proposal differences are listed
in the mapping; customer-safe timelines exclude proof/PII; audit identifies actor/resource/
UTC/scope/reason/history; cancellation checks every child's historical movement; office
hold/retry/RTO/reversal are explicit; accountant/read_only projections and all export
restrictions have negative cases; adoption M01–M05 requires two approvals and no unresolved
conflicts. D01/D02 acceptance does not waive downstream proof/calendar/money/merge policy.

## Exact validation results

Local runtime: Node `v24.16.0`, pnpm `10.34.5`; CI uses Node 22. #5 owns alignment.

| Command | Exit | Actual result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Lockfile unchanged; installed/up-to-date. pnpm ignored esbuild lifecycle script, as on baseline |
| `pnpm test` | 0 | 23 prototype tests passed; existing React act warnings remain |
| `pnpm typecheck` | 0 | All four workspace packages passed |
| `pnpm build` | 0 | Vite build passed; single HTML 539.56 kB, gzip 156.00 kB |
| `pnpm lint` | 254 | Command not found: lint unavailable / baseline owned by Issue #5; **not a pass** |
| `python3 scripts/validate_domain_contract.py` | 0 | 70 matrix rows, 28 access/projection cases, 13 closed transition/actor rows; Booking field/failure-reason coverage, synthetic docket/ownership, rounding/date/cancellation/adoption predicates |
| `python3 scripts/validate_planning.py` | 0 | Existing planning/link/fence checks plus the same domain contract model, using the existing CI entry point |
| `node /tmp/shipit-issue2/check-mermaid.mjs "$PWD"` | 0 | All five existing Mermaid diagrams parsed, including modified dispatcher-start delivery sequence |
| `git diff --check` and `git diff --cached --check` | 0 | No whitespace errors; complete diff inspected for scope and contract consistency |

The Mermaid utility and its temporary dependency already existed from #2; repeat its
[documented setup/script](verification.md#repeat-mermaid-syntax-validation). No new
application dependency or linter is installed. Contract scripts use only Python standard
library and fictional JSON; they do not import or exercise future API/auth/DB code.

## Reproduce the contract review

1. Run planning validation from repository root; it includes the bounded fixture model.
2. Read [scenarios](domain-scenarios.md) alongside the matrix. Change only the agent grant
   in C17/C18, compare own-org admin read/write, and follow p1 custody versus p2/customer/
   parent denial. Confirm 401/403/404 and the expected projection, not only a success code.
3. Walk L01–L08 through each table guard: repeated command, two failures, office window,
   admin RTO approval, physical recovery before reversal and unchanged payment history.
   These are author tabletop checks, not simulated DB integration success.
4. Review the fake weekday/holiday cases and exact IST/UTC boundary; confirm the real
   calendar remains explicitly blocked until #8/#66 approves it.
5. Walk M01–M05 and inspect the audit example. Both parties approve the same conflict-free
   plan; imported docket/customer conflicts block it; no native collision or data move.
6. Compare every current Booking field against its disposition and verify that app sources,
   existing tests, manifests and lockfile remain unchanged.

## Merge gates and limits

Branch protection inspected via GitHub API requires up-to-date `Planning and prototype
checks`, resolved conversations, and enforces protections on admins. The configured
approving review count is 0 and repository rulesets are empty. This does **not** establish
an independent approving review. The workflow calls that review the production target;
no separate engineer's approval is claimed here.

Lint is not an enforced GitHub status check and the workflow says #5 must add it before
product implementation. However Issue #3 and the repository Definition of Done still
explicitly list **"Lint passes"** among pre-merge gates, and neither is marked satisfied.
The #2 merge is historical evidence, not a waiver for this PR. Therefore this work does
not claim all documented merge gates complete or bypass them: #5 must establish a passing
baseline, or the maintainer must explicitly resolve the documentation-only gate policy.
No protection/ruleset/workflow relaxation is made by #3.

The PR reports CI for its **current head**, comments/reviews and mergeability after push.
A green CI run is not issue closure. #3 remains open until its PR is actually merged;
post-merge checkout/pull/cleanup must happen afterward. No post-merge actions are claimed
by this pre-merge evidence record.

## Remaining downstream owners and scope

D01 canonical domain/state/docket/cardinality and D02 authorization policy are resolved
by this contract on PR acceptance. D03 franchise ownership/isolation is resolved, while
#19 matching/merge stays open. See [register](open-decisions.md) for exact owners: #4 wire/
idempotency; #8/#21/#29/#30 money/proof/reconciliation; #8/#66 calendars; #14 memberships;
#23/#31 projections/attachments; #24 additional exceptions; #42 proof; #72 privacy; #79
migration/history. Those later implementations do not prevent documenting #3's rules.

Changed artifacts are confined to architecture/ADR/prototype-navigation documents,
one synthetic fixture and planning/contract validation. No production tables, migrations,
RBAC, authentication, APIs, WhatsApp/OTP/carrier/payment providers, queues/outbox worker,
pricing plans/subscriptions/billing/white-label, hosting or UI changes are implemented.
No real data, secrets, customer messages or external provider calls appear in tests.
Reverting these documents/tools changes no runtime state and requires no data rollback.
