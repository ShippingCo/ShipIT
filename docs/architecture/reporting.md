# Scoped reporting and exports (#61)

M6 makes financial, operational, messaging and compliance reports reconcile to saved
facts. The expanded milestone also adds cash, account billing, agent settlement and
reconciliation workflows. Sources precede their dependent reports; #61 can start on
#15/#21/#23/#29 without waiting for all carrier or future finance work.

The production **Reports** screen creates a booking-cohort snapshot for the selected
franchise and inclusive Kolkata date range. It displays the server count and totals,
loads fixed pages, reloads by snapshot ID and downloads matching CSV. Later #62/#63/#64/
#65 provide specialized reports; #137 ratifies new finance policy; #138–#150 supply their
own sources and consumers. This page does not claim those features are implemented.

## Contract

All endpoints require an authenticated operator session and `organization_id` plus
`franchise_id`. Capture uses the ordinary CSRF and `Idempotency-Key` boundary.

- `POST /api/v1/reports/snapshots`: body `from_day`, `to_day` (YYYY-MM-DD), optional
  `sort` (`confirmed_desc` default or `confirmed_asc`). Returns metadata, first 100
  rows and `next_offset`. Retry an uncertain response with exactly the same key/body.
- `GET /api/v1/reports/snapshots/:id?…&offset=100`: offset is a multiple of 100, at
  most 5,000. Uses the same saved filter/order/cutoff/totals regardless of source changes.
- `GET /api/v1/reports/snapshots/:id/export?…`: returns `{snapshot, columns, csv}`.
  The UI saves these authenticated bytes as a CSV file. Fixed minimal columns are
  explicitly listed; customer names, phones, addresses and bank references are excluded.

The report definition, timezone, saved filter, exact source versions, cutoff, expiry,
source freshness and independent measure states travel with the result. CSV includes
snapshot ID, cutoff, timezone and period in each data row. Empty CSV contains headers;
its response envelope still carries period/cutoff/count/zero known totals. Unknown
future measures remain unknown even for an empty result.

Limits: 31 inclusive days, 5,000 rows, 8 MiB saved rows/CSV, 100 rows/page, 20 unexpired
snapshots per actor/franchise, 24-hour access lifetime. Oversized exports are bounded,
not asynchronous: narrow the period after 413 `REPORT_LIMIT_EXCEEDED`; no truncated
"successful" result is returned. Quota exhaustion gives 429 `REPORT_QUOTA_EXCEEDED`.
Invalid input is 422, conflicting key reuse 409, expired same-key capture replay 410,
foreign/missing/expired reads 404, denied role 403, transient dependencies 503.

Permissions reuse R11 reads and E03 exports. Franchise admins/accountants use their
explicit grants; org admins can capture/read within their own organization but cannot
export without a separate permitted grant. Ordinary operators, read-only and delivery
agents have no financial report grant. An actor cannot retrieve another actor's snapshot.
Membership revocation is checked on replay, pagination and download.

Money semantics and research: [ADR 0044](../adr/0044-bounded-report-snapshots.md).
These are booking-period net collections, not a receipts-by-collection-day report.
For example a ₹1,000 booking with ₹600 collected before capture shows ₹400 outstanding.
Collecting the remaining ₹400 later changes a new snapshot, never the saved one.

## Rollout and operation

Apply forward migration `1792342800000-report-snapshots.cjs` before deploying the new
API/web composition. No backfill, new package, LLM call, key or provider is required.
Keep existing booking/payment/membership runtime read grants and grant the configured
runtime role SELECT/INSERT on `shipit.report_snapshots` and `shipit.report_access_events`,
plus UPDATE(metadata, rows) on snapshots. The database trigger permits only clearing
expired payloads; it rejects changes to unexpired results, identity or lifetime.
Do not grant DELETE or other UPDATE privileges. Test fixtures use
`prepareReports()` to apply these grants. Prior application code remains compatible.

Expiry immediately denies API access. Capture clears that actor/franchise's expired
payloads while preserving replay tombstones. For actors who stop visiting, the deployment
maintenance owner should run this bounded cleanup periodically using its existing
maintenance connection (no scheduler is introduced here):

```sql
UPDATE shipit.report_snapshots SET metadata=NULL,rows=NULL
WHERE id IN (SELECT id FROM shipit.report_snapshots
  WHERE expires_at<=clock_timestamp() AND metadata IS NOT NULL
  ORDER BY expires_at,id LIMIT 1000);
```

Stored snapshot payloads are private derived evidence, not a new ledger. The key/ID
tombstones prevent a retry from silently creating a different report after cleanup.
Audit retention follows the existing private audit policy. Do not manually modify
unexpired snapshots or historical business sources to repair a report; create a new
snapshot and retain the source correction lineage. Disabling the Reports route is a
compatible code rollback; applied schema is repaired forward only.

## Verification / try it

Use the exact Node/pnpm/Python toolchain in [quality checks](../QUALITY_CHECKS.md).
`pnpm db:local demo:reports` provisions disposable PostgreSQL and runs synthetic report,
authorization, source-change, boundary, limit and populated-upgrade scenarios. No real
customer data or external-provider call is used. Log in to development as a franchise
admin/accountant, open Reports, choose a period with bookings and create a snapshot.
Compare the CSV with totals, record a development payment, reload the saved report and
then create a new snapshot to see the changed net collection. Test missing/expired IDs
and switch franchises to confirm access is rechecked.

[Actual verification record](issue-61-verification.md) distinguishes API/SQL fixtures,
mocked React tests, broad local gates and pending external review/CI.

For a reproducible browser fixture, run these in two development terminals:

```powershell
# Terminal 1: disposable database and loopback API on 3061
pnpm db:local exec node --experimental-strip-types apps/api/test/report-browser-demo.ts
# Terminal 2: web development server on 5173
$env:SHIPIT_API_PROXY='http://127.0.0.1:3061'
pnpm --filter @shippingco/web dev
```

Open `http://localhost:3061/_fixture/session` to enter the synthetic accountant session,
then select **2099-01-01** for both days and create a report. The booking has ₹134 gross
and ₹128 pre-tax charges. No real credentials or customer data are needed. If 5173 is
already occupied, set `REPORT_DEMO_WEB_PORT=5174` in terminal 1 and pass `--port 5174`
to the web development command. Stop the fixture with
`Invoke-RestMethod http://localhost:3061/_fixture/stop`, wait for disposable-database
cleanup, then stop only the web server you started. The fixture refuses to run outside
the disposable test database environment.
