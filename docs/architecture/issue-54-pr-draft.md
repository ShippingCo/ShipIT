# PR draft — issue #54

## Title

Implement scoped manual carrier references and tracking evidence

## Description

A franchise needs to work with a courier that has no API. Add authorized manual
installation setup, service/location mapping review, external docket reference versions
and tracking observations using #53's adapter contract. An admin can record a reported
delivery, but it remains pending review and cannot change delivery proof, payment or price.

Persist evidence and idempotent outcomes atomically with safe audit metadata. Enforce
installation docket uniqueness, nested tenant ownership, immutable corrections, W26/R19
permissions and expected versions. Add bounded reads with scope-bound cursors and a
forward-only migration preserving existing bookings. Local booking needs no carrier I/O.

Service-only API workflow; no new screen, dependency, environment variable or LLM change.
CSV import (#55), reconciliation/application (#58), rates (#59) and actual costs (#147)
remain separate. Installations have one explicit franchise grant; shared installation
configuration and historical docket reassignment are not introduced.

Validation: 624 API, 189 web, 68 schema/DB tests and all tooling/unit/storage stages passed,
as did lint, types and separate API/web production builds. The broad quality command exited
1 on eight stale API upgrade migration-count assertions. Corrected those eight counts;
all eight targeted upgrade reruns and affected static checks passed. No full aggregate
rerun or remote CI is claimed. See [exact results and acceptance evidence](issue-54-verification.md).
Six focused PostgreSQL scenarios also passed, covering persistence/fresh-pool replay,
duplicate/correction races, foreign IDs, roles, safe errors, rollback/lost COMMIT,
audit privacy and populated-schema upgrade/rollback.

Apply migration `1791910800000-manual-carriers.cjs` and the SELECT/INSERT runtime grants
in [the guide](manual-carriers.md) before enabling the API build. Existing data needs no
backfill; compatible code rollback is supported and schema repair remains forward-only.

Closes #54

## Suggested commit

`feat(carriers): persist scoped manual references and tracking evidence`

This is a local draft, not a published PR or claim of remote CI approval.
