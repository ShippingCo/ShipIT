# Issue #58 verification and working record

Date: 2026-10-03. Base: `65dfb2e`, merged #57 (PR #157), clean main pulled before
branch `issue-58-carrier-reconciliation`. No subsequent base commits. Tracker M5
is milestone 6: #53–#57 closed; #58–#60 open. Declared dependencies #24, #35,
#53, #54, #55 are closed and present. Issue #58 has no comments. The tracker retains
its original blocked label; this work does not change tracker state. Base CI's five
quality jobs passed when first checked; a later check confirmed all seven base CI
checks passed, including PostgreSQL and the aggregate gate. This is base CI, not CI
for these uncommitted changes.

Recovered summaries and relevant decisions from “Implement issue #57” and
“Implement issue #53”. Reused #54/#55 schema, API and verification guides. #57's
manual pilot recommendation remains intact; no LLM or live-carrier change.

## Acceptance mapping

| Requirement | Implementation / evidence |
| --- | --- |
| File/poll duplicate causes one transition | Installation/source identity, instant comparison, duplicate link; real CSV + normalized poll + concurrent HTTP approval scenario |
| Older observation cannot regress state | Source/Parcel timestamps, newer evidence check, expected Parcel version; out-of-order and stale cases |
| Delivered claim needs proof | No Deliveries/Payments writer; blocked claim, unchanged proof/obligation assertions |
| Conflicting docket quarantined | Scoped reference validation and retained `reference_conflict`; no reassignment |
| Unknown timezone/status explicit | Closed known/unknown time and mapped/unmapped status; unit and real DB rejection cases |
| Tenant/installation mismatch | R19/W26 plus nested ownership checks; sibling B and unrelated C API and internal-port denial |
| Human resolution/source/version | Immutable decision, source reference, actor/reason/time, expected case/Parcel version and audit; concurrent winner/replay |
| Outage retains labeled state | Atomic checkpoint, unchanged poll cursor and last-known source/receive/check times |
| Reload/restart | New service with new pool reads committed decision and identity; no process-memory state |
| Controlled failure/privacy | Transaction fault injection, malformed input, role denial, response/log checks and immutable records |
| Existing-data compatibility | Populated #55 migration, backfill, forced rollback and repeat no-op |

## Verification status

- Focused policy tests: 3 passed.
- Initial focused PostgreSQL regression run: 19 passed, zero skipped/cancelled/todo.
  Covered manual/CSV, new reconciliation and general migration tests.
- Final focused PostgreSQL 18.6 run: all 8 scenarios passed, zero
  skipped/cancelled/todo. This includes the final cross-installation conflict guard,
  evidence constraints, concurrent checkpoint/decision checks, explicit permission
  intersection and populated upgrade. No runtime changes followed this run.
- The broad `pnpm db:local quality` run passed toolchain, 35 tooling/security,
  planning, lint, all five typechecks, 22 testkit, 12 DB unit, 641 API, 189 web and
  three object-storage tests. It stopped at two legacy migration-repair fixtures;
  it is **not** reported as a passing aggregate.
- Diagnosis: the synthetic repair filename in Booking/E-way tests sorted before
  the newly added migration. Moved only those test filenames after the latest
  migration, retaining all assertions and timeouts. Isolated rerun: 6 passed,
  zero skipped/cancelled/todo. No runtime change.
- The subsequent full `pnpm db:local test:db` run passed all 70 schema tests,
  then reported eight application upgrade-test failures: stale remaining-migration
  counts after adding migration 39. Corrected each expectation by one. All eight
  failed cases passed targeted reruns (9 tests in the preservation filter, including
  two additional regression cases; 1 pickup migration test). No other application
  failures were reported. The failed aggregate does not provide a passing total,
  and is not claimed as passing.
- Final lint, all five typechecks, API and production web builds, planning and
  migration-history checks passed on the final runtime/test code. Verification
  combines broad runs with targeted reruns; no clean end-to-end aggregate or
  new-commit CI result is claimed. Final documentation links were checked separately.
- Initial sandbox Docker attempt failed; elevated disposable-container runs work.
  First raw test invocation lacked the required registry; corrected local runner uses
  the existing registry/cleanup protocol. Implementation debugging found/fixed a
  wrong creation-time query and timestamp-format comparison. No assertion was weakened.

Migration history passed: all 38 released files unchanged, one forward addition.
The complete diff has been reviewed; most pre-existing test changes only increment
the expected remaining migration count by one. No released migration was edited.
All issue acceptance rows above are locally verified with synthetic carrier input;
live-provider qualification, independent review and deployed behavior are unverified.
Logs are local under `node_modules/.cache/issue58-*`; no private fixtures are published.
At initial local delivery, no commit, push, PR, deployment, production write,
live-provider call or external message had been performed. The subsequent user
request authorizes committing, pushing, opening a PR and merging after required
checks. Independent review and new-commit CI were pending at this local snapshot;
the PR records subsequent remote checks and merge status.
