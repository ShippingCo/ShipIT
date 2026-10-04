# Ready-to-use PR draft

Title: **Add scoped report snapshots and matching CSV exports (#61)**

## Description

Courier teams need report totals and downloaded rows to agree even when another
payment arrives. Add a Reports screen that saves one authorized booking cohort and
uses it for totals, pagination, reload and CSV. A ₹1,000 booking with ₹600 collected
shows ₹400 outstanding; a later payment changes a new report, never the saved one.

The API captures booking and payment facts in one PostgreSQL statement, stores a
bounded immutable snapshot, rechecks current membership on every access, and audits
capture/read/export. Actor-scoped idempotency handles duplicate requests and responses
lost after commit. Kolkata date boundaries, exact paise arithmetic, CSV escaping and
minimal non-contact columns are shared across the UI and export contract.

Limits are 31 days, 5,000 bookings, 8 MiB, 100 rows per page, 20 active snapshots per
actor/franchise and 24-hour expiry. Requests exceeding limits fail explicitly. Unknown
costs, due dates and future finance measures remain unknown. Typed version/correction
references establish the common interface; downstream M6 reports and source workflows
are not implemented by this change.

## Rollout

Apply additive migration `1792342800000-report-snapshots.cjs`, then grant the configured
runtime role SELECT/INSERT on both new report tables and UPDATE(metadata, rows) on
snapshots only. A trigger restricts that update to expired-payload cleanup. No business
backfill or new provider configuration is needed. Schedule the bounded maintenance
query in [the report guide](reporting.md) to clear payloads for inactive actors while
retaining replay tombstones. Existing application versions remain compatible.

## Validation

- Focused `pnpm db:local demo:reports`: 5/5 scenarios, including populated upgrade,
  tenant/role denial, revoked access, matching saved CSV, source changes, concurrent
  retry, lost COMMIT, rollback, Kolkata boundaries and the exact 5,000/5,001 limit.
- React component coverage: keyboard form, saved-ID reload, empty/export handling,
  denied export, errors and same-intent uncertain retry.
- Real browser → API → disposable PostgreSQL: capture and reload preserve ₹134 gross,
  ₹0 collected and ₹134 outstanding. Narrow-screen layout has no horizontal overflow.
- Native downloaded-file delivery remains unverified after the browser event hook
  timed out; API CSV bytes and React Blob initiation are tested separately.
- Full `pnpm db:local quality` passed: lint, five-workspace typechecks, 35 tooling,
  22 testkit, 12 DB unit, 652 API unit, 192 web, 3 storage contracts, 73 schema and
  417 PostgreSQL API tests, plus API/web production builds. No failures or skips.
  Additional final test-file lint/typecheck and documentation/migration checks passed.
  See [the verification record](issue-61-verification.md) for the earlier fixture
  failures, corrections and exact code identity. Remote CI has not run for this
  unpublished branch.

[ADR 0044](../adr/0044-bounded-report-snapshots.md) records PostgreSQL snapshot,
AWS retry and OWASP CSV research, tradeoffs and scope.

Closes #61.

Suggested commit message: `feat(reports): add scoped snapshots and matching CSV exports`
