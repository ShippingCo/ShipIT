# Issue #37 verification

Branch: `issue-37-signed-whatsapp-webhooks`, from freshly pulled main
`42097f064eeef17d392d8b7f3fd520f2d7a913c5` (PR #120). Starting checkout was clean.
#36 was already merged, though local main initially lagged and the checkout remained
on its feature branch. The existing #35/#36 branches were preserved.

The complete available “Solve issue #36” implementation task was retrieved, including its
implementation updates and actual test outcomes, and checked against source and ADR 0024.
Issues #1–#36 are closed and #37–#83 open. #37 has no comments or linked discussion
changes. #35 PR #119 and #36 PR #120 were inspected; #120 has no review comments or
submitted reviews. A merge is not represented as independent approval. The implementation
and merge trees for #36 are identical. [ADR 0025](../adr/0025-signed-whatsapp-inbox.md)
records the recovered lessons, dependency analysis, alternatives and research.

## Acceptance mapping

| Requirement | Verification |
| --- | --- |
| Invalid signature rejected before processing | Missing/wrong/byte-tampered signature, database spy remains untouched |
| Replayed callback is one logical event | Six concurrent signed requests, item-level deduplication and one effect/attempt per item |
| Unknown installation quarantined without guessing | Real A/B/C installations, wrong WABA/phone, app allowlist mismatch, digest-only quarantine |
| Database outage returns retryable failure | Revoked database access/terminated connections, HTTP 503, no inbox record; restored access and replay |
| Oversized/malformed body safe | 256 KiB, 100-item limit, duplicate keys, depth, UTF-8, timestamp/contact validation, encoding rejection |
| Reordered callbacks do not regress state | Read/delivered/sent raced through workers, later failure preserves progress 3 |
| Handshake distinct from authentication | Independent token, duplicate parameters rejected, no session/cookie or DB access |
| Provider encoding fixture | UTF-8 Indic text/emoji plus escaped Unicode verified as exact original bytes |
| Restart/reload survives | Fresh pool/worker/application and real loopback HTTP replay, persisted projection and completion |
| Tenant isolation and nested IDs/counts | Real sibling B/unrelated C inbox IDs denied from A, scoped health counts, denied read_only and cross-owner processing |
| Controlled stale/failure behavior | Conflicting digest preserves original, disabled owner quarantines, five fault-injected failures exhaust retries |
| Secrets/PII excluded from logs and API | Dedicated AES-GCM ciphertext and keyed fingerprints, identity/key-version tamper denial, minimized health/detail/log inspection; encryption/signing rotation preserves replay fingerprints |
| Additive migration integrity | Populated 23-migration #36 baseline, injected migration failure/rollback, successful retry/no-op and unchanged prior rows/audit |
| Crash atomicity | Failure before COMMIT rolls back projection and attempts; lost successful COMMIT response retains one completed effect |

## Reproduction

Use Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and Docker per
[quality checks](../QUALITY_CHECKS.md). Run from the repository root:

```sh
pnpm test:api -- test/integration/whatsapp-webhook.test.ts
pnpm check:migrations
pnpm db:local quality
```

The real database harness discovers `apps/api/test/database/whatsapp-webhook.test.ts`
and `packages/db/test/integration/whatsapp-webhook.test.ts`. It uses restricted runtime
roles, generated credentials, isolated databases, preflight, resource registration and
cleanup. Do not run bare node:test without that guard/registry. The shared synthetic
fixture is `apps/api/test/webhook-fixture.ts`; none of its values are live credentials.

The end-to-end fixture connects A/B/C through the real #36 service with synthetic Meta
responses, signs callbacks locally, races POSTs, restarts the worker, and inspects safe
API metadata plus stored source/attempt/projection state. It then exercises actual
database unavailability, commit uncertainty and a failing SQL projection trigger.
No production data, Meta sandbox token or real customer recipient is used.

## Results

Executed on 2026-09-20 with the pinned toolchain:

| Check | Result |
| --- | --- |
| Full `pnpm db:local quality` | Passed on corrected rerun; container removed |
| Toolchain, planning/domain contracts, tenant-query gate, lint and all-package typecheck | Passed |
| Tooling/security gate tests | 29/29 passed, including exact ingress/scheduler restrictions |
| Testkit and database-runner unit tests | 22/22 and 12/12 passed |
| Full API suite | 448/448 passed |
| Full web suite | 155/155 passed; no frontend source/test/timeouts changed |
| Full real PostgreSQL suite | 62 DB + 249 database-backed API tests passed; zero failed/skipped/cancelled/todo |
| Object-store contracts | 3/3 passed; container removed |
| API and production web builds | Passed in quality and independently |
| Released-migration history | Passed; all 23 released files unchanged |
| Final focused provider/webhook API check | 23/23 passed after privacy/key validation refinements |
| Final focused PostgreSQL check | 16/16 passed across new webhook API/upgrade plus #35 outbox and #36 provider regressions; container removed |
| Final lint, typecheck, planning and diff whitespace check | Passed |
| `verify:gates` and remote GitHub CI | Not run; no inherited gate success or remote approval claimed |

The initial focused API run passed 7/7 and the first PostgreSQL run passed 5/5.
A subsequent 14-test upgrade run passed 13 and found a missing migration-24 entry in
the existing expected migration-name list. The first full quality attempt failed at
that same fixture: an initial replacement had missed its multiline representation.
The corrected full quality rerun passed, including the entire database suite. This
failure history is retained rather than representing the first run as green.

Final review then keyed content fingerprints against offline guessing and required
four distinct secrets. The affected API tests (23), real database/upgrade/#35/#36
regressions (16), lint and typecheck were rerun successfully. Production builds completed
with the keyed-fingerprint implementation. The full suite result and these targeted
final checks are distinct; the entire quality command was not rerun after the last
configuration uniqueness assertion. The stricter nullable-status constraint and
cross-owner/partial-batch rollback checks also passed real PostgreSQL diagnostics.

Local commands use `node_modules/.cache/issue35/run.ps1` to select the already-provisioned
pinned tools. Focused database diagnostics used its adjacent `focused.mjs`, which runs
the repository preflight, a unique resource registry, node:test and registered cleanup.
The final four files were `apps/api/test/database/whatsapp-webhook.test.ts`,
`packages/db/test/integration/whatsapp-webhook.test.ts`,
`apps/api/test/database/whatsapp.test.ts` and `apps/api/test/database/outbox.test.ts`.
The maintained full quality/test:db commands above discover those tests without that
local diagnostic helper. No timeout, test discovery or production guard was weakened.

## External boundaries

Live Meta account/subscription verification and real callback delivery are not executed
without a sandbox account. Synthetic HMAC fixtures verify the application boundary,
not provider certification. No frontend changes or customer-send path are introduced.
#38 owns consent consumption, #39 owns outbound reconciliation and #72 owns approved
retention/deletion. Global/terminal quarantine requires deployment-operator investigation
and reviewed forward repair; there is no generic API redrive or tenant reassignment.
