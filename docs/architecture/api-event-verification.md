# Issue #4 verification and acceptance evidence

[Architecture](README.md) · [ADR 0007](../adr/0007-api-event-idempotency-contracts.md) · [Reproducible scenarios](api-event-scenarios.md)

## Readiness and inspected baseline

Inspected live [Issue #4](https://github.com/ShippingCo/ShipIT/issues/4) completely, including
its comments (none), and the merged PR bodies/files/checks for [#85](https://github.com/ShippingCo/ShipIT/pull/85)
and [#86](https://github.com/ShippingCo/ShipIT/pull/86), on 2026-09-07 UTC.

| Readiness evidence | Verified result |
| --- | --- |
| Issue #2 / PR #85 | CLOSED at 2026-09-06T22:55:20Z; PR MERGED at 22:55:19Z, merge commit 256512a725c56c5c0e0fa180253add5ac20a69d0 |
| Issue #3 / PR #86 | CLOSED at 2026-09-07T03:36:50Z; PR MERGED at 03:36:49Z, merge commit d039a480eadccb47578c82b1d586b4fdf99ce548 |
| Current main before branch | `d039a480eadccb47578c82b1d586b4fdf99ce548`, confirmed by remote and freshly pulled checkout |
| Latest main CI | [34080238418](https://github.com/ShippingCo/ShipIT/actions/runs/34080238418), Engineering checks successful on that exact main commit |
| Local preservation/workflow | Clean previous issue-3 branch; `git status`, `git checkout main`, `git pull origin main`, then dedicated `issue-4-api-event-idempotency-contracts`; previous branch and unrelated planning directory preserved |
| Issue readiness label | Stale blocked replaced with ready after prerequisite/CI review, then in-progress on branch creation |
| Lint baseline | #5 still OPEN; current root/workspace scripts have no lint; unavailable is not passing |

Read architecture index/context/sequences/open decisions; domain/authorization/lifecycle/
scenarios/verification; ADR index and 0001–0006; CONTRIBUTING, docs/AGENTS and engineering
workflow; prototype transition/store/types/messages/tests; API/DB/shared scaffolds; both
existing planning/domain validators; root/workspace manifests and GitHub workflow/template.
Repository-wide search covered idempotency, event, outbox, schema_version,
aggregate_version, correlation, pagination, cursor, /api/v1, error code, D04 and D05.
Current `.ts`/`.tsx` paths and empty shared/API/DB entry points were inspected; no prototype
baseline or proposed path was assumed to be current implementation. Accepted #3 contracts
supersede its older event candidates and browser assumptions.

## Every Issue #4 acceptance criterion

PASS below means **contract/synthetic validation PASS**, not implemented HTTP/PG/provider
behavior. The validator is a bounded executable model and documentation consistency check.

| # | Issue acceptance criterion | Concrete evidence and limits |
| --- | --- | --- |
| 1 | Each initial event names producer, consumers and committed-state invariant | [17-row catalog](event-contract.md), exact fixture/table consistency and T01–T13 mapping; aggregate, payload, permitted/forbidden effects, ordering/privacy per row. All consumers explicitly future |
| 2 | Same scoped key/body returns original result; different body conflicts | [Canonical scope/intent/replay](idempotency-contract.md), S01 and CommandModel assert original 201/DTO, unchanged counts, 409 mismatch; property/default/media/precondition/array variants and all six scope components checked |
| 3 | API timeout after commit has reconciliation path | [Retention/timeout](idempotency-contract.md), S01 lost result/same key-body replay; S08 expired uncertainty query/reconcile; no new destructive submission |
| 4 | Outbox shares business transaction, no send-before-commit path | [Transaction boundary](event-contract.md), unchanged ADR 0004, S01/S02/S09 atomic publication model, rollback-zero and pre-commit-send rejection; actual PG/crash tests remain #35/domain owners |
| 5 | Aggregate version ordering and explicit stale policy | [M/P/H/R policies](event-contract.md), E02/E05 7→6 non-regression, E03/E06/E07 required gap/recovery, M/P authorized snapshot precondition; no timestamp order |
| 6 | Backwards compatibility and poison handling | [Schema/rollout](event-contract.md), stable event_type/integer schema, safe optional addition validation, required payload/envelope negative controls, v2/v99 quarantine, altered event-ID-content quarantine |
| 7 | Fictional examples; no plaintext OTP/address/provider token | Reference-only fixture/envelopes, recursive denied-key checks and negative controls, parsed JSON examples, manual content review; no contact/secret/proof values or real commercial data |
| 8 | Decisions, evidence and blockers without false implementation claim | [ADR 0007](../adr/0007-api-event-idempotency-contracts.md), D04 acceptance condition / D05 OPEN in [register](open-decisions.md), per-scenario limits and downstream gates below |
| 9 | Current-main paths/commands checked, current workflow followed | Readiness table, current manifests/workflow/scaffolds and actual checks below; dedicated branch, pushed PR and current-head GitHub evidence reported in PR |

## Synthetic verification coverage

[Scenarios S01–S09](api-event-scenarios.md) are reproducible with the standard-library-only
[validator](../../scripts/validate_api_event_contract.py) and [fixture](fixtures/api-event-contract.json).
The existing planning CI entry point invokes it; no manifest/workflow/dependency change.

Checks cover all 17 envelope/payload contracts and required-field negative controls, T01–T13
canonical names, same-key canonical intent and mismatch, all scope tuple fields, original
response loss/replay, reauthorization, 10 W01/R06 access cases from the merged matrix,
cursor limit and query/scope compatibility, exact fake-clock expiry and longer retention,
duplicate logical effects, stale/gap/history recovery, unknown schemas, altered ID content,
rollback/committed outbox and uncertain provider disposition. The existing domain validator
continues checking all seven roles and custody's restricted projection.

Not covered by this model: actual HTTP parsing/status mapping, full product request schemas,
concurrent same/different-key transactions, durable storage/restart/lease behavior, cursor
cryptography/SQL isolation/timing leakage, live membership races, actual protected-data
resolution or external delivery. Owning implementation issues must supply that evidence.
A Python atomic assignment, tuple comparison or synthetic send guard is not DB/HTTP proof.

## Exact local commands and results

Local Node `v24.16.0`, pnpm `10.34.5`, Python `3.14.5`; CI pins Node 22/pnpm 10.34.5.
#5 owns runtime/toolchain alignment. Commands run from ShipIT root on the dedicated branch.

| Exact command | Exit | Actual result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Lockfile up to date/unchanged; existing ignored esbuild@0.25.12 build-script warning |
| `pnpm test` | 0 | 23 prototype tests passed; existing React act(...) warnings |
| `pnpm typecheck` | 0 | All four workspace packages passed |
| `pnpm lint` | 254 | Command lint not found; unavailable, **not passed**; #5 owns baseline |
| `pnpm build` | 0 | Vite built 1,925 modules; HTML 539.56 kB / gzip 156.00 kB |
| `python3 scripts/validate_domain_contract.py` | 0 | 70 matrix rows, 28 access cases, 13 transitions plus prior domain checks PASS |
| `python3 scripts/validate_api_event_contract.py` | 0 | 17 facts, envelope/privacy controls, 10 auth cases, replay/cursor/expiry, 8 consumer streams and commit/crash/timeout checks PASS |
| `python3 scripts/validate_planning.py` | 0 | Existing planning/link/fence checks plus both synthetic validators PASS |
| `git diff --check` | 0 | No whitespace errors; repeated after final review |
| `git diff --exit-code origin/main -- apps packages package.json pnpm-lock.yaml .github/workflows docs/adr/0004-durable-events-and-transactional-outbox.md` | 0 | Runtime/product source, tests, manifests/lockfile, workflows and ADR 0004 unchanged |

No Mermaid diagram or runtime-sequences file is changed; Mermaid revalidation is not
required. Existing prototype tests were not altered to simulate documentary coverage.

## Review, merge gates and scope

Live main protection requires up-to-date `Planning and prototype checks`, resolved
conversations, and admin enforcement. Required approval count is 0 and rulesets are empty;
no independent approving review is claimed. Current PR head CI, comments, reviews, review
threads and mergeability are inspected after push and reported in the PR/final handoff.
PR merge is not claimed by this pre-merge evidence document.

The current repository/issue pre-merge DoD still includes “Lint passes”. #5 has not
established the command. Historical #85/#86 merges and edited PR checkboxes do not establish
a waiver for #4. A maintainer must explicitly resolve the documentation-only lint gate or
#5 must supply a passing baseline before merging under the current policy. No protection,
CI or DoD wording is weakened here. Independent review remains the workflow target.

D04 is fully specified for acceptance and becomes RESOLVED contract on approved merge;
D05 remains OPEN for #35/#39/#40 mechanics. #9/#22/#23/#24/#28/#29 own complete feature
schemas, persistence/concurrency and expired-uncertainty reconciliation; #12/#22 own global
docket allocator/layout. #8/#21/#29/#30 retain financial/receipt policy, #8/#42 proof,
#8/#66 business calendars, #6/#13/#72 security/privacy, #36/#38/#53 provider capability.
Payment.settled and collection/reversal consumers remain gated by those owning policies.

Only Markdown contracts/navigation, fictional JSON and standard-library validation change.
No production API/Fastify routes, auth/RBAC, SQL schema/migrations, idempotency/outbox tables,
worker/queue/timers/retry daemon, provider/WhatsApp/carrier/payment/OTP implementation,
customer migration, UI, pricing/subscription/billing or hosting/deployment is added. Apps,
packages, manifests, lockfile, workflows, existing tests and ADR 0004 remain unchanged.
There is no runtime rollout/data migration; reverting these docs/tools changes no product
state. Future contract changes require reviewed compatibility/migration evidence.
