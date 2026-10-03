# PR title

Implement reviewed carrier rate imports with separate selling and purchase purposes

## Description

Closes #59.

Franchise admins can upload a bounded carrier rate CSV, review unit/mapping/lane/date
errors and approve a complete version. Selling policies publish through the existing
Pricing service; supplier estimates remain separate and never change customer prices
or represent actual expense. Quotes retain a resolvable immutable import source.
Existing bookings, taxes and receipts preserve their original snapshots.

Reuses #54 mapping identities, #55's CSV grammar and #20 publication rules on merged
#58. Adds scoped immutable candidates, commands and approvals, current W26/W27 checks,
duplicate-file identity, safe retries, atomic publication and stale-mapping rejection.
The additive migration preserves 39 released migrations and existing data. Apply it
and SELECT/INSERT runtime grants before deploying compatible API code; rollback retains
evidence. No new secret, dependency, LLM, provider transport or browser surface.

Validation: the complete local `pnpm db:local quality` gate passed: planning, lint,
five typechecks, 35 tooling/security, 22 testkit, 12 DB unit, 647 API, 189 web,
3 object-storage, 71 schema/DB and 410 API/PostgreSQL tests, and both builds.
PostgreSQL reported zero failures/skips/cancellations/todos. Migration-history
and final documentation checks passed. Focused tests cover concurrent retry,
unit/mapping/overlap failures, scoped denial, receipt preservation, purchase-purpose
separation, rollback and lost-COMMIT recovery. Exact evidence and final code checksum
are in [the verification record](issue-59-verification.md).
Remote CI and independent review have not run for this uncommitted implementation.
All carrier inputs are synthetic. #60 qualification,
#141 negotiated agreements and #147 actual costs remain separate work.

See [the operating guide](carrier-rates.md) for setup, JSON/CSV examples, error recovery,
single-origin policy limits and test commands; [ADR 0042](../adr/0042-reviewed-carrier-rates.md)
links the research and explains adopted/deferred practices.

## Suggested commit

`feat(carriers): import reviewed selling rates and purchase estimates`
