# Issue #17 verification

Starting main: `3cefe534b6ca23fc8ffdd5a77f2bb57f5517a361` (pulled 2026-09-12). The tree was clean. Prerequisites #12,
#13, #14, #15 and #16 are CLOSED and their merged implementations were inspected.
Branch: `issue-17-independent-franchise-onboarding`.

## Acceptance evidence

| Criterion | Evidence |
| --- | --- |
| Independent owner onboarding without national account/carrier | Existing verified identity signs in; three-field form; real PG organization/franchise/org_admin transaction |
| Timeout retry returns original workspace | Lost COMMIT acknowledgement fault injection; original durable DTO; no extra audit |
| Concurrent bootstrap cannot duplicate roots | Four concurrent same-key requests; distinct-key race; user PK direct-SQL rejection |
| Selector contains only granted scopes | Real A1/A2/B1 role matrix and browser option assertions; SQL applies live grants |
| Switching clears previous private state | Synchronous controller invalidation, keyed shell, late A after B generation tests |
| Revoked/disabled access recovers safely | Real membership/root/account denial; protected browser navigation clears prior context |
| Accessible required errors | Label/error association and first-invalid focus tests; live browser validation |
| Keyboard and narrow completion | Live browser at 375×812: Tab/Enter completed real API onboarding, visible required controls, no horizontal overflow |
| Reload/restart persistence | Browser reload from real PG; reconstructed API/pool context and replay tests |
| Foreign/nested tenant references denied | Own/sibling/unrelated/unknown HTTP matrix and retained #14/#15 nested scope/FK tests |
| Malformed/stale/dependency failures controlled | Strict unknown-field/key validation; each real-write rollback; safe recovery tests |
| Secret/PII inspection | Exact public DTO projection, unchanged redacted logger/audit seam, token absence assertions, production store exclusion |

## Executed browser walkthrough

The guarded fixture in `apps/api/test/onboarding-demo.ts` ran against disposable PostgreSQL
18.6. The browser opened its synthetic session, submitted empty required fields and focused
the business-name input. At 375×812, Tab traversed business name → location name → code →
Create workspace; Enter committed the workspace. The resulting heading received focus.
Reload returned the same persisted organization/location. The DOM width was within the
viewport. Disabling the synthetic account and navigating returned sign-in with no prior
workspace content. Desktop sign-in was inspected at 1280×900. Temporary viewport override
was reset. No real contacts, provider sends or credentials were used.

## Verification commands

Use the pinned Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and Docker. On this host:

```sh
export PATH=/tmp/shipit-issue8-tools/node-v22.23.2-darwin-arm64/bin:$PATH
export PYTHON=/tmp/shipit-issue8-tools/python/bin/python3.12
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local quality
```

Remote CI is verified after pushing the final commit. Earlier checks caught
migration-list/count assertions, a typed test request payload, required key newline
validation, and a selector accessible-name mismatch; these were corrected before the
final gate. The source-inventory fixture was deliberately updated for the composition
split and new security regressions; no validator, exception list or negative control was
weakened. No external dependency was added: lockfile changes link the existing shared
workspace package to API/web.

## Product boundaries and review

[The onboarding contract](independent-onboarding.md) is the API/operator/rollout authority.
ADR 0011's previously verified enrollment remains required: this does not add open public
registration or an account recovery bypass. `org_admin` has the existing restricted role,
not inherited operational authority. Booking/customer workflows remain unavailable in
production pending their owning issues. The existing 24 browser prototype regressions
remain explicitly fictional. Browser automation supplements jsdom coverage; it does not
claim a newly installed end-to-end runner or CI browser/device farm.

One additive migration introduces initial-bootstrap replay evidence and its unique user
constraint. Existing applied migrations are untouched. Runtime only gains SELECT/INSERT
on that table. Replay reauthorizes current org-admin and active franchise access; expired
or inaccessible session/scope cannot disclose a previous result. No new raw-query or
issuer exception was added. Invitation acceptance remains in the existing domain.

Delivery targets a reviewed, pushed PR ready for maintainer review. No merge or issue
closure is claimed before GitHub confirms it; independent maintainer approval remains
separate from the implementation author's review.

## Initial full-gate result and bundle review

The first complete `pnpm db:local quality` run passed: tooling 15, testkit 22, DB unit 12,
API Vitest 126, web 36, and real PostgreSQL 31 DB + 55 API; no skipped/cancelled/todo DB
tests. Planning, lint, all workspace typechecks and production build passed. Existing
prototype React act warnings remain visible.

Post-gate independent diff/bundle inspection found that an unconditional lazy demo import
was retained by the single-file bundler. The mode guard now wraps the import declaration.
A subsequent production `pnpm build` passed and explicit artifact inspection confirmed
`shippingco_v1`, `setu_courier_v2` and `revealOTP` absent. The reviewed inventory records
that change. Final verification reruns the complete gate after this correction and the
additional database-outage regression; the earlier passing run is not substituted for it.

## Final local results

| Exact command / layer | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS; existing workspace dependency links only |
| `pnpm check:migrations` | PASS; six released migrations unchanged |
| `pnpm db:local quality` | PASS after all implementation corrections |
| `pnpm check:toolchain` | PASS, pinned Node/pnpm/Python |
| `pnpm test:quality` | PASS, 15 controls |
| `pnpm check:planning` | PASS, including reviewed migration inventory and negative controls |
| `pnpm lint` | PASS, unchanged tenant-query AST restrictions and zero lint warnings |
| `pnpm typecheck` | PASS, all five workspace packages |
| `pnpm test` | PASS: testkit 22 + DB unit 12 + API Vitest 126 + web 36 |
| `pnpm test:db` inside disposable PostgreSQL | PASS: 31 DB + 56 API, zero failed/skipped/cancelled/todo |
| `pnpm build` | PASS; API typecheck + production Vite bundle |
| `VITE_DATA_MODE=demo pnpm --filter @shippingco/web build --outDir /tmp/shipit-17-demo-dist` | PASS, explicit demo build |
| Built-artifact inspection | PASS: production excludes both legacy persistence keys and OTP-reveal marker; demo retains its own store |
| `git diff --check` | PASS |

No full `verify:gates` failure drill or dependency advisory audit was run for #17. Existing
React act warnings remain in fictional prototype tests; no warning was suppressed. The
previous issue's documented development-tool advisory status has not been reassessed.

## Author review and delivery boundary

A separate review pass inspected product entry, persisted state, transaction/replay,
franchise authorization, membership invalidation, race handling, secret projection,
keyboard/mobile behavior and scope discipline. It found and corrected the single-file
lazy-import retention issue described above. SQL remains bound; raw-query and scope-issuer
allowlists remain unchanged; applied migrations are untouched; demo operational screens
remain unavailable in production. No unresolved implementation finding remains in this
review. This is the author's review pass, not a fabricated independent human approval.

Main protection was read: the strict required check is `Planning and prototype checks`,
administrators are enforced, and the configured approving-review count is zero. The PR
must still be reviewed by its maintainer before merge under the engineering workflow.
This task delivers the PR open; neither merge, issue closure nor post-merge cleanup is
claimed. Temporary browser viewport overrides, local servers and the disposable browser
fixture were cleaned up.
