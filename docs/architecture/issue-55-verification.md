# Issue #55 working record

## Context and acceptance plan

Recovered final decisions and verification from the `Implement issue #54` and
`Implement issue #53` chats, the finance planning chat, owning guides and ADRs.
Read the full #55 issue (no comments), M5 description and all eight issue summaries.
Prerequisites #15/#16/#35/#53/#54 are closed. PR #154 is merged; all seven checks
on its head passed. Clean checkout switched to main, pulled with fast-forward only,
then branched `issue-55-csv-imports` from `cefdc1a756b3eaa6848a126b1cad43936421256b`.
No later code changes exist. Historical #54 verification combined a failed aggregate
with corrected targeted reruns; those results do not verify this change.

M5: #53 contract and #54 manual persistence exist; #55 adds reviewed file ingestion.
#56/#57 research carrier access; #58 reconciles claims; #59 publishes reviewed rates;
#60 qualifies one path. Neither live-provider access nor M4 LLM qualification blocks
this work. Groq and all financial/proof authorities remain unchanged.

Database review: composite franchise ownership, immutable installations/mappings/
references/observations, installation+docket reservations, membership organization
locks and durable carrier command receipts are reusable. New immutable import runs,
commit intents and row outcomes are needed for restart/retry and source deduplication.
No existing record backfill or released migration edits. Runtime grants stay bounded.

## Final approach and acceptance mapping

All twelve issue acceptance criteria are **verified locally at the API/service/database
level** by the focused scenarios and complete database rerun below. This is the issue's
documented service-only workflow; browser UI and live-provider qualification are not claimed.

Service-only API delivery, consistent with #54 and the explicit issue allowance.
Create returns a saved dry-run preview, GET reloads it, commit accepts up to 20 chosen
rows and processes each in its own reauthorized transaction. At most 64 KiB UTF-8 CSV,
200 data records and 16 columns; explicit header and status mappings, no guessed dates.
Raw bytes/filenames are never saved or logged (zero persistent raw retention).
Only validated operational codes/IDs and safe row error codes are retained.

| Acceptance | Implementation and planned verification |
| --- | --- |
| Dry run changes no operational state | Save preview only; compare carrier/domain/money counts |
| Actionable wrong columns/encoding/size | Bounded parser, fatal UTF-8, numbered safe errors; parser/API tests |
| Repeat file/run no duplicate effects | Run+row receipt and installation source identity; races/replay/re-upload |
| Foreign docket denial | Scoped lookup and commit recheck; B/C unknown-equivalent errors and counts |
| Partial resume | Atomic per-row effect+outcome; injected failure after one row, fresh service retry |
| Formula data | Inert parser strings, strict operational-code validation, no raw re-export |
| Stale/unmapped status | Preview rejection and commit version/reference/time recheck |
| Reconciled summary | Disjoint pending/rejected/conflicted/applied/duplicate counts total to row count |
| Persistence | Real API with PostgreSQL, reload with fresh service/pool |
| Privacy/permissions/errors | W26/R19, revoked/disabled scope, safe response/audit/log inspection |
| Compatibility | Populated #54 forward migration, immutable originals, broad regression gate |

Shipment imports attach references to existing bookings; they cannot create bookings.
Tracking imports use #53 file provenance and #54 ingestion, always pending review.
Source identity conflicts require a corrected file/new preview, never silent overwrite.
No queue/provider calls needed for small synchronous batches. #58 owns cross-channel
semantic reconciliation and domain transitions; #59 owns prices. No UI journey claimed.

## Environment and verification

Pinned existing Windows wrapper: `node_modules/.cache/issue35/run.ps1` (Node 22.23.2,
pnpm 10.34.5, Python 3.12.14). Disposable PostgreSQL through the established harness.
Initial focused verification passed 48 Vitest tests (14 CSV, 11 manual boundary,
23 carrier contract), all workspace typechecks and lint/tenant-query enforcement.
The first Node DB attempt stopped before tests because TypeScript parameter properties
are not supported by Node's strip-only runtime; corrected to ordinary class fields.
The first Vitest run found a test expectation using milliseconds where the repository
canonical timestamp omits zero milliseconds; corrected the expected representation.
No assertion or timeout was weakened.

Expanded focused PostgreSQL verification passed 11 scenarios: four new import API
scenarios, five #54 regressions and two populated-schema upgrade scenarios. Zero
failed/skipped/cancelled/TODO; disposable service removed. Final review then added
local import capability advertisement and same-file source conflict detection; final
focused rerun passed the same 11 scenarios. Final typecheck, lint and 48 Vitest tests
also passed before the broad run.

The broad `pnpm db:local quality` run passed toolchain, 35 tooling/security tests,
planning, lint, all workspace typechecks, 22 testkit tests, 12 DB unit tests,
638 API tests, 189 web tests and three object-store contract tests. It then exited 1
in the schema database group: bookings:22, delivery-proof:18, eway:13 and migrations:61,
83,187. **That aggregate run failed and is not described as passing.** The API database
group and builds had not run at that point.

Diagnostics identified missed fixture maintenance: remaining counts in repaired copies,
fresh migration counts/names/table inventory, and synthetic forward-repair timestamps
older than the new migration. Updated only those expectations and synthetic filenames.
All 14 tests in the four affected schema files then passed (zero skipped/cancelled/TODO),
including the preservation/recovery assertions after the original failure points.
API and production web builds passed separately. The complete `pnpm db:local test:db`
rerun passed **69 schema/DB + 399 API database tests**, zero failures/skips/cancellations/
TODOs, exit 0. The disposable PostgreSQL container was removed. Final DB-package typecheck,
ESLint on the four corrected schema files, planning/link validation and whitespace checks
passed. Expected React act warnings and negative object-stream test warnings remained visible.

Verification combines one broad run, corrected targeted schema reruns, a **complete**
passing database gate and separate builds/final affected static checks. No single fully
passing aggregate quality rerun or new remote CI run is claimed. No unresolved failure
remains in the required checks. Runtime code did not change after final focused verification.

Ignored local logs: `node_modules/.cache/issue55-quality.log` (failed aggregate),
`issue55-schema-diagnostic.log`, `issue55-schema-final.log` (14 passed),
`issue55-database-all.log` (complete 69+399 passing), `issue55-db-final.log` (11 focused),
`issue55-unit-final.log` (48), `issue55-types-final.log`, `issue55-lint-final.log`,
`issue55-build.log`, `issue55-db-types-final.log`, `issue55-fixture-lint.log`,
`issue55-planning-final.log` and `issue55-migrations.log`.

Final code review covered parser bounds/quoting, strict tenant lookups, per-row atomicity,
deferred effect checks, request-body log redaction, source identity conflicts and the
unchanged carrier proof/payment boundary. Local capability advertisement composes the
generic CSV service with manual entry; it does not claim carrier network qualification.

Migration history passed: all 37 released migrations unchanged. Existing upgrade
fixtures increment their remaining-migration expectation by one; their data-preservation
and rollback assertions are unchanged. No arbitrary timeout changes or parallel runs
against shared mutable database state.

## Verified code identity and delivery boundary

SHA256 recorded before the broad run (runtime unchanged during verification):

| File | SHA256 |
| --- | --- |
| `apps/api/src/modules/carriers/csv.ts` | `7fc5881c14c58d893ebd5414217e3dfb55978449b5bb72e4787528209a60f243` |
| `apps/api/src/modules/carriers/import-service.ts` | `7a5601cd47cc015461e6e792f962b865c7c30d32e37b5d96efb1b4e2d92491dc` |
| `apps/api/src/modules/carriers/import-repository.ts` | `c8b4d84e913c5b9d9c9d836bc58e4812cc721f337b34127b4e4b81c83d19ca15` |
| `packages/db/migrations/1791997200000-carrier-csv-imports.cjs` | `962e5c03e97b5678b35d4254bee4ebf16fdfda45a5288056d3103f0034f9360f` |
| `apps/api/test/database/carrier-imports.test.ts` | `41e06e165c6399ed543be0dc995151753e434f1cde542efc9b155ed64fac8b49` |

No production database, customer send, live carrier, browser journey, deployment or
remote CI run was used. Real PostgreSQL and real Fastify/session/CSRF routes were exercised;
synthetic clocks/data and injected database failures are clearly test controls. No UI
changed, so no new browser/keyboard journey is applicable. Existing web regressions
remain in the broad gate. No provider mock is represented as a live integration.

Reviewable work is local and uncommitted. [Setup/API guide](carrier-csv-imports.md),
[research decision](../adr/0040-csv-carrier-imports.md) and
[commit/PR draft](issue-55-pr-draft.md) provide the handoff. No push, merge or PR publication.
