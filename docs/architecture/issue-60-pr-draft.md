# PR title

Qualify the Akash Ganga manual carrier path with scoped health and recovery

## Description

Closes #60 after review and successful verification.

Operators need one supported carrier workflow even without a verified API or export.
This qualifies Akash Ganga manual docket mapping and observations through the existing
adapter and reconciliation services. Manual-only installations reject file imports;
scoped health shows source actor, observation age and unresolved/unmapped review counts.
The runbook covers uncertainty, corrections, lost responses and continued local work.

Adds an immutable installation flag with a compatibility default and a manual-health
index. Existing generic installations, rate workflows, booking snapshots and receipts
retain their semantics. Apply the forward migration before code. Old code does not
enforce the flag: preserve enforcement or disable import/rate writes before rollback.
No new dependency, secret, UI, carrier transport or LLM integration.

Validation combines the broad quality run with isolated fixture fixes and final
complete database/build reruns: 648 API, 189 web, 72 schema/DB, 413 API/PostgreSQL,
3 disposable object-storage, 22 testkit, 12 DB-unit and 35 tooling tests passed,
plus lint, all five typechecks and production builds. The final public demo passed
4/4. Earlier aggregate runs failed on new-runner lint and historical migration-fixture
assumptions; these were fixed and affected checks rerun. No single clean aggregate
quality run is claimed. Released migrations remain unchanged. See
[acceptance evidence](issue-60-verification.md) and [repeatable runbook](carrier-pilot.md).
Fixtures are fictional. Live API/file criteria are N/A, not claims of carrier access.
Remote CI and independent review must run on the eventual PR commit.

Suggested commit: `feat(carriers): qualify manual pilot with scoped health and recovery`
