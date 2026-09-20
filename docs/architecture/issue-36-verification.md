# Issue #36 verification

Branch: `issue-36-whatsapp-provider-registry`, based on freshly pulled main
`89b65592a33b88fd3ac0b7cd8fe357a8146d00d0` (PR #119). Starting worktree was clean.
#35 was already merged; the old local branch was preserved. There were no code changes
between its implementation commit `0a23da7` and that merge. Issues #1–#35 were closed,
#36–#83 open; all #36 prerequisites were closed. #36 and relevant #27/#37/#38/#39
contracts and #35 PR were retrieved. #36 had no comments. No remote issue was modified.

The #35 implementation task was retrieved through Codex; its implementation turn was
empty in the task API, so the full local session record was read. It recovered the
earlier correction from #27 to #28 and the actual research, implementation fixes and
test results. #35's gate result remains 23/24 with a separately passing unchanged
quality retry; it is not represented as a passed gate run here.

## Acceptance mapping

| Requirement | Evidence |
| --- | --- |
| Secret confinement and safe responses | Fake credential resolution, forbidden request fields, masked GET, log/API/audit inspection |
| Identity and tenant binding | Config alias ownership, live WABA membership/platform verification, real sibling B and unrelated C resources |
| Approval/language and variables | Exact language lookup, MISSING/REJECTED/PAUSED handling, unsupported shapes/categories, count/type checks before HTTP |
| Rotation | New registered reference, old value absent from API/audit, previous template checks invalidated |
| Persistence and replay | Fresh runtime pool, real loopback HTTP read, concurrent same-key and competing-version commands |
| Atomic failure handling | Injected failure before command write, lost COMMIT response, permission revoked during unlocked provider I/O |
| Database integrity | Owner FKs, unique inbound identity, immutable evidence, column grants, revision/complete-command guards |
| Safe upgrade | Populated 22-migration baseline, failed migration rollback, successful retry/no-op and unchanged old rows/audit |
| Provider failures | Bounded response/deadline/pagination, redirect policy, safe normalized 4xx/5xx/timeout/malformed acceptance |

## Reproduction

Use Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and Docker as in the quality guide.
No production database, real token or customer recipient is used. The API integration
fixtures use the actual Meta adapter with synthetic fetch responses and restricted real
PostgreSQL roles. `pnpm db:local` generates credentials and removes its test container.

```sh
pnpm test:api -- test/integration/whatsapp.test.ts
pnpm check:migrations
pnpm db:local quality
```

The PostgreSQL files are `apps/api/test/database/whatsapp.test.ts` and
`packages/db/test/integration/whatsapp.test.ts`; normal test:db discovers both. Tests
must run through the guarded harness with its resource registry, not bare node:test.
For the smoke flow: connect the fixture alias, synchronize parcel_update/en_US, validate
variables, rotate to alpha_v2, observe stale capability, synchronize again, then restart
and inspect masked state. Repeat with B/C resources and denied roles; no provider POST occurs.

## Results

Executed with the pinned toolchain on 2026-09-20:

| Check | Result |
| --- | --- |
| Toolchain, planning, tenant-query guard, lint and all-package typecheck | Passed |
| Quality/tooling regressions | 28/28 passed |
| Testkit and database runner unit tests | 22/22 and 12/12 passed |
| API integration suite | 441/441 passed, including 16 WhatsApp adapter/configuration tests |
| Migration-history gate | Passed: all 22 released migrations unchanged |
| Real PostgreSQL full suite | First run found three upgrade-fixture failures; corrected full rerun hit `DB_TEST_TIMEOUT` (600 seconds), then removed its container |
| Focused final PostgreSQL verification | 19/19 passed across five files, including all seven WhatsApp tests and the three corrected upgrade files; no skips, container removed |
| S3-compatible object-store contracts | 3/3 passed; disposable container removed |
| Production API and web build | Passed |
| Full `pnpm db:local quality` | Failed twice at unchanged web onboarding wait; 154/155 web tests passed each time |
| Standalone web diagnostics | Default workers: 153/155; one worker: 154/155 (details below) |
| `verify:gates` | Not run for #36; no inherited #35 success claimed |

Both quality attempts stopped at `operator.test.tsx:36`, waiting for “Set up your shop”
while the app showed “Checking workspace access”. A separate default-worker web run
also failed `counter.test.tsx:37`, waiting for “New Booking”. A one-worker diagnostic
passed onboarding but retained the counter startup wait. All frontend source, tests and
timeouts are unchanged. These failures remain unresolved; the quality command is not
reported as green. Object-store, database and build stages were invoked separately
because the quality command stops at its first failing stage.

After the full database rerun timed out, the final focused run used the repository
preflight and registered-resource cleanup with Node's test runner (one file at a time).
Its five files were `apps/api/test/database/whatsapp.test.ts` and the database-package
`whatsapp.test.ts`, `bookings.test.ts`, `eway.test.ts`, and `migrations.test.ts` files.
All 19 tests passed in approximately 76 seconds. This validates the new behavior and
corrected upgrade fixtures but does not replace a green full database regression run.

Initial testing exposed a Node strip-types parameter-property incompatibility, explicit
UUID parameter requirements, and PostgreSQL's bounded-regex repetition limit; these were
corrected. The first full database run also exposed three upgrade-fixture assumptions:
an old remaining-migration count, the expected table inventory, and synthetic repair
filenames that preceded migration 23. Those fixtures were updated. Test setup uses the
required isolated resource registry. No deadlines or security checks were weakened.

## External boundaries

Live Meta onboarding, permission validation, approval and real-message delivery have not
been executed: no sandbox credentials/account were supplied. Contract tests do not claim
provider certification. The local registry's validated state is identity evidence only.
The production sender remains unwired pending #37–#39. Hosted secret-manager composition
and alerts remain #68/#70. No UI changed; existing browser regressions remain required.
No commit, push, PR submission or merge is performed by this task.
