# Issue #39 verification

Started from clean freshly pulled main `e83c898` on `issue-39-durable-whatsapp-outbound`.
The #38 conversation was recovered, including its implementation and merge turns.
PRs #121/#122 are confirmed merged; #38's implementation tree equals main and no later
changes existed. [ADR 0027](../adr/0027-durable-whatsapp-outbound.md) records research,
dependencies, alternatives and dispatch semantics. Publication and merge were authorized
after the local verification described below.

## Acceptance evidence

| Requirement | Executable coverage |
| --- | --- |
| No duplicate logical messages on normal retries | Concurrent enqueue and concurrent workers; unique identity and one provider call |
| Bounded 429 / Retry-After | Seconds/date parser, wait boundary and five-rejection exhaustion |
| Unknown acceptance is uncertain | Accept-then-throw, lost reservation COMMIT, expired reservation; zero blind resends |
| Delivery/read never regress | Read before delivered/failed; persisted monotone state across restart |
| Revocation before send suppresses | STOP during backoff and signed pending STOP through real HTTP |
| Permanent rejection stops | Credential outcome and closed provider decision matrix |
| Audited identity-preserving redrive | Explicit uncertain decision, same-key replay, canonical audit and total attempts |
| Queue cannot roll back booking | Committed booking snapshot counts unchanged after queue transaction failure |
| Distinct message history | Safe message/attempt API with queued, accepted, delivered, read, failed and uncertain evidence |
| Tenant isolation / malformed input | Sibling B, unrelated C, read_only, nested customer/source and unknown fields |
| Privacy | API/log inspection, ciphertext domain binding, purging and denied direct disclosure writes |
| #38 integration | Verified delivered disclosure followed by evidenced START; acceptance alone creates no proof |
| Migration / restart | Fresh install, populated #38 rollback/retry, original evidence preservation and fresh pool/app |

## Run record

Pinned toolchain and disposable PostgreSQL only. No live Meta credentials or production data.

- Initial typecheck passed. Initial lint failed two control-character regex expressions;
  validation was rewritten without suppressing the rule.
- Initial API aggregate failed because the new unit file imported Node's test runner
  instead of Vitest. The existing 469 tests passed; that aggregate is not counted as a
  successful check. The import was corrected and the aggregate rerun.
- Initial sandboxed Docker startup/cleanup failed. An approved disposable run succeeded.
- First focused PostgreSQL run: **13/13 passed**, seven outbound scenarios and six migration
  cases, with automatic container cleanup.
- Expanded focused PostgreSQL run: **19/19 passed**, including eight #38 consent
  regressions, ten outbound scenarios and the populated upgrade.
- The first full quality run failed PostgreSQL verification: the historical lots upgrade
  still expected 11 remaining migrations instead of 12, and outbound cases failed while
  its scheduler signature was being changed during that run. That aggregate is not a
  pass. The count was corrected, scheduler/grants made consistent, and executable sources
  held unchanged for the replacement full run.
- Focused diagnostic rerun: **31/31 passed** (16 lots, 14 outbound, one populated upgrade),
  with disposable container cleanup. The independently rerun typecheck also passed.
- Final `check:migrations`: **passed**, all 25 released migrations unchanged, forward
  migration 26 allowed. `git diff --check`: **passed**.
- Final full `pnpm db:local quality`: **passed**, exit 0, with executable sources held
  unchanged throughout the run:
  - Pinned toolchain, 29 tooling tests, planning/contracts, tenant-query AST gate, lint
    and all five workspace typechecks passed.
  - 22 testkit tests, 12 database unit/runner tests, **473 API tests**, **155 web tests**
    and **3 S3 contract tests** passed.
  - **64 database integration + 271 API PostgreSQL tests** passed, with zero failed,
    skipped, cancelled or todo tests. This includes #37/#38 regressions and all new
    outbound/migration scenarios.
  - API build/typecheck and Vite production build passed (101 transformed modules).
  - Both disposable PostgreSQL and object-store containers were removed.
- Existing web tests emitted React `act(...)` warnings. S3 failure-injection cases emitted
  expected non-retryable streaming warnings. Neither suite failed; no warning rule was
  relaxed. Runner unit tests intentionally emit sanitized DB_TEST_FAILURE markers while
  proving failure detection; those registered unit tests passed.

Executed through the local pinned-toolchain helper:

```powershell
& node_modules/.cache/issue35/run.ps1 db:local quality
& node_modules/.cache/issue35/run.ps1 check:migrations
git diff --check
```

The helper is local environment setup, not a new repository dependency. With the pinned
tools on PATH, the reproducible repository commands are `pnpm db:local quality` and
`pnpm check:migrations`. The final documentation update was followed by `pnpm check:planning`
and another `git diff --check`.

No UI surface changes: browser keyboard tests are inapplicable to this service-only issue;
the existing web regression suite remains required. Runtime/HTTP and database tests use
synthetic messages and fake clocks, not real customer delivery. Full controlled-failure
`verify:gates`, remote CI and independent PR review are separate from local checks and
are not claimed without execution. Live Meta behavior remains an external staging check.
