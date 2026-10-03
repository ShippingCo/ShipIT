# Issue #59 working and verification record

Date: 2026-10-03. Clean main pulled at `cbe018f` (merged #58, PR #158),
then branch `issue-59-carrier-rates`. No subsequent main changes. Tracker #59 is
M5 (milestone 6), depends on closed #20/#53/#55 and blocks #60/#147. M5 #53–#58
are closed; #59/#60 remain open. #59 has no comments. Historical blocked label
is not evidence of an outstanding prerequisite. No tracker writes performed.

Recovered final decisions and verification from “Implement issue #58”, plus
“Review milestone 4 finance gaps” and the approved tracker finance amendment.
#58's full CI passed before its merge; this is base evidence, not new-code evidence.
The previous manual/file recommendation remains applicable. No live carrier or LLM work.

## Acceptance and design map

| Requirement | Implementation / verification |
| --- | --- |
| Units and file safety | Reused bounded CSV parser; exact decimal-to-integer arithmetic; per-row unit checks; parser tests |
| Explicit normalization | Scoped immutable #54 mapping IDs plus explicit pricing meanings; current-version check at approval |
| Preview | Numbered row diagnostics, overlaps, expected missing/unexpected lanes, weight gaps, finite dates and selling interval conflicts |
| Retry and concurrency | Scoped command keys/fingerprints, unique file/config candidate, immutable single approval; real concurrent requests |
| Pricing authority | W26 and W27 capabilities in one membership transaction; owning Pricing publication seam |
| Financial history | No Booking/Tax/Receipt writer; immutable version source reference in quote; historical snapshot assertions |
| Cost provenance | Separate purchase purpose, no pricing version, explicit unknown actual cost; #147 owns actual costs |
| Isolation/privacy | Admin-only sheet reads, B/C resource and nested mapping denial, audit/response inspection |
| Durability/recovery | Reload with new pool, fault rollback, schema append-only enforcement and populated upgrade |

Runtime: pinned Node 22.23.2 / pnpm 10.34.5 / Python 3.12.14 via existing
`node_modules/.cache/issue35/run.ps1`. PostgreSQL 18.6 disposable Docker fixture.
Use established Windows aggregate budgets, resource registry and sequential DB runs.
One forward migration; released migrations remain untouched. Old migration-count
fixtures and synthetic forward-repair filenames advance with the new migration.

## Current verification

- Parser: 6 passed.
- All five workspace typechecks passed. Lint/tenant-query gate passed.
- Initial focused database run: 2 passed, 2 failed at approval. Fixed the new
  trigger's locking approach and ambiguous OLD alias; removed temporary diagnostics.
- Expanded focused regression: 34/35 passed. The only failure was the legacy
  expected migration-name list, corrected to include the forward addition.
- Final focused financial/upgrade/general-migration run: 11/11 passed, zero
  skips/cancellations/todos, including distinct lower purchase costs, immutable
  booking/receipt snapshots, concurrent replay and lost-COMMIT recovery.
- Subsequent permission assertions for org-admin denial and membership-revoked
  replay passed in the broad run.
- Migration history passed: 39 released files unchanged, one forward addition.
- **Full `pnpm db:local quality` passed, exit 0** on the final code state below:
  toolchain; 35 tooling/security tests; planning; lint/tenant-query gate; all five
  typechecks; 22 testkit tests; 12 DB unit tests; 647 API tests; 189 web tests;
  3 actual disposable S3-compatible object-store tests; 71 PostgreSQL schema/DB
  tests and 410 API/PostgreSQL tests; API and production web builds.
  PostgreSQL reported zero failures/skips/cancellations/todos; both disposable
  containers were removed. Expected negative object-stream diagnostics remained visible.
- Final documentation/planning check passed after adding the guide/ADR/PR draft.
  Final `git diff --check` passed. No runtime/test/migration changes followed the
  complete gate; only evidence text was finalized.

All issue #59 acceptance criteria are locally verified by the mapped automated
scenarios. API tests use the actual Fastify composition with injection and real
PostgreSQL; file inputs are synthetic. No browser surface changed, so new keyboard
tests are inapplicable; the full existing web regression suite passed. No new-code
remote CI, independent review, carrier-specific dialect qualification or live-provider
verification is claimed. #60 owns qualification; #141/#147 own later financial services.

Logs are local `node_modules/.cache/issue59-*`. No secrets, production writes,
commits, pushes, deployments or published PRs are authorized by this task.

Verified-code identity: 48 changed `.ts`/`.cjs` source/test/migration files on the
base above, including untracked additions. SHA256 of sorted `path:SHA256(content)`
lines joined with LF (uppercase inner hashes):
`9072D68E6296F111A48C6715B694B2A7F78BEF2731530E529DE0E286157A3FE7`.
Documentation is excluded so final result recording does not change code identity.
