# Issue #60 working and verification record

Date: 2026-10-03 (IST). Base `56ad538ea268ef8cbca797a190e12d8c30d1db66`.
Clean main was pulled (already current), then `issue-60-manual-carrier-qualification`
  created. No subsequent main change was present at start. No unrelated edits existed.

**Final outcome: all shared and selected-manual acceptance criteria are locally verified.**
Verification combines the broad quality attempt with corrected-fixture checks, a
successful full database rerun, final demo, typechecks/lint and builds. No single
successful aggregate `pnpm quality` invocation is claimed; failures are recorded below.
API/file-only criteria are N/A. Real carrier onboarding, remote CI and PR review/merge
remain outside this authorized local delivery.

## Recovered context and scope

Tracker #60 is open, M5 / milestone 6, with no comments. M5 has seven closed issues
(#53–#59) and #60 open. Dependencies #53/#56/#57/#58/#59 are merged; #54/#55's supporting
manual/file implementation is also merged. Git history records PRs #153–#159.
#59 is actually merged in PR #159 at this base, and GitHub's seven checks on
`4d311d2829bd5663eeb9b50d091cba3825c6caf4` all succeeded. Its prepared prompt alone was
not used as completion evidence. No overlapping #60 implementation was found locally.

Recovered final decisions from chats “Implement issue #59”, “Implement issue #53”,
“Implement issue #56” and “Implement issue #57”, plus their checked-in reports.
AGC intermediary API leads and Maruti Innofulfill documentation do not verify legitimate
ShipIT access or branch-docket scope. The manual recommendation remains appropriate.
No inaccessible conversation materially blocks this implementation. #59's historical
tests are base context, not proof of these changes.

Database review: installations, commands, references, observations and tracking decisions
already persist owner, actor, timestamps, version and audit. Existing transaction,
membership lock, scoped SQL and canonical event boundaries are reused. No customer data
is copied. One additive boolean and one health index are needed to enforce a per-installation
manual-only selection and query latest evidence. Existing released migrations are untouched;
historical upgrade tests advance expected remaining migration counts only.

## Acceptance mapping and implementation

| Shared/manual requirement | Implementation and evidence | Status |
| --- | --- | --- |
| One carrier, owner, bounded capability slice and N/A matrix | AGC manual selection, franchise-admin duty owner, research links and runbook | Verified locally (documented) |
| Local operations with machine interfaces false | Actual booking/check-in/dispatch/manual/review journey; existing domain suites for remaining workflows | Verified locally |
| Scoped references, distinct dockets, actor/time and source | Existing #54 adapter/persistence, health projection, fictional pilot | Verified locally |
| Duplicate/retry/fallback safety | Lost COMMIT, identical retry, concurrent resolve, independent repeat unable to reapply; #58 file/poll replay regression | Verified locally |
| Canonical timeline and allowed messaging only | Real domain event plus replayed notification consumer; one skipped decision (`unsupported_source_cause`) and no outbound | Verified locally |
| No proof/OTP/payment bypass | Manual delivered claim rejected, money/proofs unchanged; existing #58 edge cases | Verified locally |
| Malformed/stale/unmapped/conflicting outcomes | #60 unknown/future/invalid cases and #58 stale/conflict/rollback regression | Verified locally |
| Recovery, fallback and ownership | Human-source runbook; lost-response replay, reject/correct/append, persistent old history | Verified locally |
| Source/freshness/unresolved cases visible | Scoped health endpoint, elapsed age, explicit unknown/future, counts independent of queue page | Verified locally |
| Fictional end-to-end fixture | `pnpm db:local demo:carrier`, real API/PostgreSQL, no live carrier or customer send | Verified locally |
| Reload/restart persistence | New runtime pools load health/decisions; replay retains outcomes | Verified locally |
| RBAC and tenant privacy | Read-only mutations, delivery-agent aggregate denial, valid B/C and missing IDs, nested references | Verified locally |
| Safe logs/API/audit | UUID source actor only; no contact-table join; safe-payload assertions and existing #54/#58 audit coverage | Verified locally |
| Immutable corrections/history | Reference correction creates next version; rejected observation retained; audit inspected | Verified locally |
| Import disabled, backward compatibility | Explicit false rejects before parsing; omitted flag preserves old fingerprint/true selection; populated upgrade | Verified locally |
| API criteria | **N/A — live API capability not selected**, research and runbook explain revisit gates | N/A |
| File criteria | **N/A — file capability not selected**, generic #55/#59 remain regression scope | N/A |

## Verification ledger

- Pinned toolchain check passed: Node 22.23.2, pnpm 10.34.5, Python 3.12.14.
- Initial Docker invocation was blocked by the filesystem/runtime sandbox; approved
  escalation used the standard disposable PostgreSQL fixture. It was not a product failure.
- Initial four pilot/schema tests: two passed, two failed due to fixture expectations
  (audit action spelling and equal receipt timestamps). Fixed by asserting the actual
  canonical audit fields and advancing the fake clock for the later receipt.
- Final focused regression: **21/21 passed**, no skipped/cancelled/todo. Includes pilot,
  populated upgrade, general migration tests, #58 reconciliation and #59 rates.
  Disposable PostgreSQL removed. Local log: `node_modules/.cache/issue60-focused-final.log`.
- Validation/adapter unit tests: **12/12 passed**. Local log: `issue60-unit.log`.
- Initial lint/tenant-query check passed. Intermediate typecheck found test-helper
  input inference too narrow for intentional invalid inputs; corrected to `unknown`
  at the test HTTP boundary. Final static checks remain pending.
- Final static typechecks and documentation/planning passed. Public
  `pnpm db:local demo:carrier` passed all four tests and removed its container.
  Later test-only assertions strengthen immutable selection retry and health-state checks;
  they are included in the final broad gate.
- Migration-history check passed: all 40 released files unchanged, one forward addition.
- First broad quality run stopped at lint (`no-unsafe-finally` in the new demo wrapper).
  Moved the immutable temporary-path guard before cleanup; isolated lint passed.
  This run is failed, not aggregate success. Final full quality rerun is pending.
- Second broad run passed tooling/planning, lint, all five typechecks, 22 testkit,
  12 database-unit, 648 API, 189 web and three actual disposable object-storage tests.
  It then failed four historical upgrade cases: two missed repair-directory counts,
  and two pre-#60 fixtures invoking the new installation writer against old schema.
  A shared legacy-shape seed now writes the original columns transactionally. The
  CSV snapshot compares original fields so the additive flag does not look like
  changed historical data. The pilot upgrade separately asserts its true default.
  Isolated correction run passed 8/9, with one missing test-local service declaration;
  the corrected CSV fixture then passed 1/1. Final full rerun remains pending.
- Third broad run passed all earlier stages and **72/72 schema/database tests**,
  zero failures/skips/cancellations/todos. It then reported eight API historical-upgrade
  fixture failures: their expected remaining migration counts also needed +1 for
  the additive migration. The application code did not change. Those eight assertions
  are corrected; targeted upgrade verification and a full database/build completion
  run remain pending. Do not describe any of these aggregate quality attempts as passing.
- Targeted API upgrade verification now passed **8/8**, zero failures/skips/cancellations/todos.
  Final typechecks and lint on every changed fixture passed. Full database gate,
  final public demo and builds were then run sequentially. For future additive migrations,
  inventory count assertions in both `packages/db/test` and `apps/api/test/database`
  before the expensive gate; this investigation initially missed the latter.
- **Final `pnpm db:local test:db` passed, exit 0: 72 schema/DB + 413 API/PostgreSQL
  tests; zero failures/skips/cancellations/todos.** This reran the full groups, not
  just the corrected cases. Log: `node_modules/.cache/issue60-database-final.log`.
- **Final `pnpm db:local demo:carrier` passed 4/4**, exit 0, using the repository
  runner source and final fixtures. Log: `issue60-demo-final.log`. Both disposable
  PostgreSQL containers were removed; the broad run's object-store container was removed.
- **Final `pnpm build` passed** for API and production web. Log: `issue60-build-final.log`.
  Final typechecks and changed-fixture lint passed (`issue60-types-final.log`,
  `issue60-fixture-lint.log`). Runtime code did not change after the broad lint/648 API/
  189 web/3 object-storage successes. Only the eight upgrade-count assertions changed.
- Final documentation/planning and `git diff --check` passed. Final source checksum
  matched the identity below. No runtime/test/migration changes followed this verification;
  only the result record was finalized.

All service tests use actual Fastify injection/SQL, not a browser or live carrier.
New runtime pools demonstrate durable state reload, not host disaster recovery.
The notification consumer is real; provider methods fail if called. No provider-send
evidence is claimed. No UI changed; existing web regressions still apply. No performance
benchmark or production scale claim. No real onboarding, deployment or release approval.

Local logs are under `node_modules/.cache/issue60-*`. No new-code CI, independent PR
review, commit, push, PR publication or merge has been authorized or performed.
Downstream #71/#73/#74/#75/#76 may proceed only after their other prerequisites and
#60 review/merge are complete. This work does not implement those issues.

Final code identity for verification: 50 changed/untracked non-documentation files
(including package.json), SHA256 of sorted `path:SHA256(content)` lines joined with LF,
uppercase inner hashes:
`8CD2F28C68CCC0ADFCDBB2A28ED9F14711DA5933B3F5E8D8E720D78D34186F31`.
Documentation is excluded so recording test outcomes does not change code identity.
