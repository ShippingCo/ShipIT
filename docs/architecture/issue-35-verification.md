# Issue #35 verification

Branch: `issue-35-durable-outbox-worker`, based on current main
`d0f8670aa1a0053a908cf2f6f437a6d243b981e3` (PR #118). The starting tree was clean.
Local main was behind by #32–#34 and was fast-forwarded before branching. Issues
#2–#34 and all #35 prerequisites were closed; main's required checks were successful.
The issue's old blocked label does not describe a remaining implementation prerequisite.
No label, issue, remote branch, PR or merge was changed by this task.

The recovered ChatGPT conversation **Implement issue 28** supplied methodology and
design context beyond Git. Its exact domain scope was Route departure/delay/arrival;
it did not establish a messaging worker. Existing Route manifests, immutable effects,
live role checks and additive schema were preserved. Subsequent payment, receipt,
attachment, e-way and production-counter implementations were reviewed. Outbox handlers
do not replace those owners or reuse the separate authentication outbound queue.

## Acceptance evidence

All fixtures are fictional. Database tests use disposable PostgreSQL 18.6, restricted
runtime roles and no production URLs. API tests run through the real membership/auth
boundary; the smoke fixture starts a loopback HTTP listener and production-clock worker
loop and drains it cleanly. Stopping between exported relay/claim/effect/ack phases models
process loss deterministically; it is not an operating-system SIGKILL/load qualification.

| Requirement | Executable evidence |
| --- | --- |
| Committed event eventually enqueued | API DB outbox: real Booking/Parcel/Route/payment producers; idempotent relay; late producer COMMIT remains discoverable |
| Effect survives crash before ack, without duplicate | API DB outbox: fresh-pool restart, immutable effect receipt, lost-COMMIT-response reconciliation and rollback before receipt |
| Expired lease recovery without active writer overlap | API DB outbox: two claims, stale token denied, locked effect excludes reclaim, expiry before receipt rolls back, next owner applies once |
| Bounded poison/dead-letter plus alert | API DB outbox: five transient/expired claims, immediate permanent/schema quarantine, persisted alert recovered after restart |
| Documented aggregate order | API DB outbox: actual Route revisions delivered out of order; projection stale skip and unreconciled gap quarantine; API integration covers all M/P/H/R dispositions |
| Redrive original identity and evidence | API DB outbox: same key/intent replay, changed-intent conflict, stale revision rejection, completed repaired attempt and canonical audit retaining quarantine history |
| Fair scheduling | API DB outbox: A has 105 events, B has one; bounded relay turns and claims rotate, including new worker pool |
| Schema mismatch quarantined | API DB outbox: incompatible registered schema never calls effect; common-envelope unit tests reject owner/shape/version mismatch |
| Authorized restart/reload result | API DB outbox: durable job reads after worker restart plus real HTTP health before/after the loop |
| Tenant/role isolation | API DB outbox: real jobs in sibling B and unrelated C; detail/redrive/count denial, all seven roles, cursor binding, revoked grants, disabled franchise, CSRF and strict inputs |
| Controlled failures, no partial mutation | API DB outbox and DB upgrade: rollback, lease fencing, bounded retry, immutable source and append-only evidence; null/stale lease tokens and null expected revisions rejected |
| Safe audit/API/logs | API DB outbox: safe closed error codes, no envelope/token/secret exception in DTOs or logs; audit exposes only redrive evidence |
| Upgrade/backward compatibility | DB outbox: populated 21-migration baseline, injected migration failure rollback, successful retry/no-op, exact existing data/audit preservation, composite owner FKs and restricted runtime DML |
| Scope gate remains closed | scripts/tenant-queries.test.mjs: all six tables require both owners; only exact owner discovery is exempt; appended SQL and product-module raw calls fail |

## Commands and results

Pinned Node 22.23.2, pnpm 10.34.5 and Python 3.12.14 were used. Local defaults differ;
an ignored invocation helper selects the pinned tools. Dependencies were restored from
the unchanged lockfile before validation. No deadlines or guard checks were weakened.

| Check | Actual result |
| --- | --- |
| Focused API integration outbox tests | PASS: 6 tests |
| Focused PostgreSQL outbox/upgrade tests | PASS: 6 parent tests, zero skips; expanded real-C/null-token coverage subsequently passed in focused run |
| `pnpm check:migrations` | PASS: all 21 released migrations unchanged |
| `pnpm quality` inside isolated `pnpm db:local verify:gates` | PASS: clean snapshot; 27 quality guards, 22 testkit + 12 DB unit, 425 API + 155 browser + 3 object-store tests; 59 DB + 239 DB-backed API tests with zero failures/skips; lint/typecheck/build passed |
| `pnpm db:local quality` (unchanged final retry) | PASS: exit 0; same complete counts as the clean snapshot, lint/typecheck and production build; disposable services removed |
| `pnpm db:local verify:gates` | 23/24 stages passed; restored quality stopped on unchanged operator onboarding wait (154/155 browser tests passed). The command did not pass. |

Initial focused testing found PostgreSQL bigint parsing and explicit UUID parameter-type
requirements; these were corrected before passing tests. Full regression exposed an
expected migration-name list and the API Lot-upgrade count that needed the new 22nd migration. Existing upgrade tests
advance their remaining counts and synthetic repair timestamps; no released migration
was edited. The clean full-quality snapshot passed after both assertion corrections. The gate drill completed 23/24 stages; its restored run hit the existing operator onboarding UI wait timeout at `apps/web/src/test/operator.test.tsx:36`. This file and its production UI source are unchanged. No assertions, timeouts or checks were weakened. The separate unchanged `pnpm db:local quality` rerun passed completely (exit 0), including all 155 browser tests and 59 DB + 239 database-backed API tests with zero failures/skips. The gate command itself remains reported as 23/24, not passed.

## Review and deployment boundaries

[ADR 0023](../adr/0023-durable-outbox-worker.md) records alternatives, AWS/Stripe lessons
and PostgreSQL queue-locking guidance. [Operations](outbox.md) documents exact roles,
endpoints, constants, recovery, test reproduction and schema-first rollout.

The production registry is intentionally empty: #39/#40/#55/#58 own business handlers
and provider intent. #68/#70 own hosted managed-identity composition and external alert
delivery; #74 owns production-scale qualification. These tests establish correctness,
not a production throughput SLO. UI was unchanged; existing browser regressions run in
quality. ADR/W44 require independent PR review. Remote CI has not run on these uncommitted
changes. Commit, push, PR submission and merge remain explicitly unperformed.
