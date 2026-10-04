# Scoped reporting and exports (#61, #62)

M6 makes financial, operational, messaging and compliance reports reconcile to saved
facts. The expanded milestone also adds cash, account billing, agent settlement and
reconciliation workflows. Sources precede their dependent reports; #61 can start on
#15/#21/#23/#29 without waiting for all carrier or future finance work.

The production **Reports** screen creates a booking-cohort snapshot for the selected
franchise and inclusive Kolkata date range. It displays the server count and totals,
loads fixed pages, reloads by snapshot ID and downloads matching CSV. The Sales and
GST tab adds the #62 definition described below. #63–#65 and the wider #137–#150
workflows retain their own sources and consumers.

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

Open `http://localhost:3061/_fixture/session` to enter the synthetic franchise-admin session,
then select **2099-01-01** for both days and create a report. The booking has ₹134 gross
and ₹128 pre-tax charges. No real credentials or customer data are needed. If 5173 is
already occupied, set `REPORT_DEMO_WEB_PORT=5174` in terminal 1 and pass `--port 5174`
to the web development command. Stop the fixture with
`Invoke-RestMethod http://localhost:3061/_fixture/stop`, wait for disposable-database
cleanup, then stop only the web server you started. The fixture refuses to run outside
the disposable test database environment.

## Sales/GST contract (#62)

[ADR 0045](../adr/0045-sales-and-financial-evidence.md) defines the approved money,
correction and account-statement boundary. The default Reports tab is now Sales
and GST; Booking snapshots remains available, including old `?snapshot=` links.
The fictional prototype retains its existing test coverage and is not imported
into production. No localStorage fallback is permitted.

- `POST /api/v1/reports/sales`: same date/sort fields and idempotency as booking
  reports, plus `rate` (null or exact fraction, e.g. `5/100`) and `franchise_ids`
  (1–50 distinct IDs including the selected anchor franchise). Omission selects
  the anchor. Every requested franchise must pass current R11 authorization.
- `GET /api/v1/reports/sales/:id?…&offset=100`: immutable `sales_gst_v1` page,
  totals, rate/treatment/jurisdiction groups and source IDs/versions. Reauthorizes
  every saved franchise, not just the anchor. Same 24-hour lifecycle as #61.
- `GET /api/v1/reports/sales/:id/export?…`: matching saved CSV, requiring E03 in
  every saved franchise. Formula-safe escaping and size limits are unchanged.
  CSV exposes source IDs and independent paise measures, not customer PII or
  returned-to references. The original and adjusted gross are separate columns.

Sales rows include the original and corrected pre-tax/taxable/non-taxable,
CGST/SGST/IGST/GST, rounding and gross, net recorded collections, actual refunds,
outstanding and refundable credit. Correction/refund IDs, reason, approval reference,
timestamp and amounts remain visible. An absent issued receipt is labelled explicitly.
Zero-tax groups use `0/1`; no-sales results have zero totals and header-only CSV.
These are application summaries for accountant review, never official tax returns.

### Necessary financial producers

All endpoints require the same session, selected organization/franchise, CSRF
for POST and current server authorization. Reads use R11. W47/W48 allow only an
explicit local franchise-admin grant; org-admin or accountant visibility alone
does not grant financial writes. No new role is introduced.

- `GET /api/v1/finance/bookings/:id`: current financial/payment versions,
  remaining components, collections/refunds and safe change history.
- `POST /api/v1/finance/changes`: `booking_id`, `expected_version`,
  `payment_version`, `kind` (`discount`, `cancellation`, `correction`, `refund`),
  reason and opaque `approval_ref`. Reduction fields `pre_tax`, `taxable`, `cgst`,
  `sgst`, `igst`, `rounding` are integer paise. A cancellation consumes every
  remaining charge/tax/rounding component. Refunds instead supply positive
  `refund` and `returned_to_ref`; they record actual money already returned.
  Financial history is bounded to 100 entries per booking. Money is never sent
  by this endpoint. Use non-sensitive evidence IDs, not account numbers or names.
- `POST /api/v1/finance/statements`: `customer_id`, `from_day`, `to_day`.
  Issues an immutable account statement of this customer's unissued shipments
  in that franchise/period. No duplicate charge, tax invoice or payment obligation
  is created. An empty/already-issued period returns `STATEMENT_EMPTY` (409).
- `GET /api/v1/finance/statements/:id`: retrieves the saved statement after
  current scope authorization and records access. No public document URL exists.

All responses use `Cache-Control: no-store`. Unknown/foreign IDs are 404; denied
local roles 403; malformed fields 422; stale versions 409 `VERSION_CONFLICT`;
incompatible reductions/refunds 409 `FINANCIAL_CONFLICT`; dependency failures 503.
For uncertain writes retry the *same* key/body; conflicting reuse is 409.
After a version conflict reload current evidence and create a reviewed new intent.
After a successful financial write create a new report to see it. Reopening the
old report/statement intentionally shows its original cutoff.

### Additive rollout and recovery

Apply `1792429200000-sales-financial-evidence.cjs` after migration 42, before the
new API. It creates empty append-only tables; no historical amounts are backfilled
or rewritten. Grant the configured runtime role SELECT/INSERT on
`shipit.financial_changes`, `shipit.account_statements`,
`shipit.account_statement_lines` and `shipit.financial_access_events`.
Keep SELECT on booking/tax/payment/customer/issued-receipt sources and the existing
payment command/audit privileges. Database integrity triggers invoke the private
`payment_result` wrapper as owner; do not grant it to the application. Do not grant UPDATE/DELETE or owner access.
`prepareReports()`/`preparePayments()` demonstrate the test grants. Audit history
includes financial changes, statement issuance and private evidence reads.

The deployment composition enables these endpoints and UI together; no new flag,
background job, provider, secret or dependency is introduced. Before any financial
changes are accepted, previous code can still read unchanged historical records.
After changes exist, retain the new payment/customer projections during rollback:
old readers would show original debt and cannot represent refundable credit.
Disable the financial command routes if needed, keep evidence readable, and repair
with a forward migration/code fix. Do not delete financial evidence or replay an
actual refund under a new key to resolve an uncertain response.

`pnpm db:local demo:sales` runs focused real-database reconciliation, receipt and
rate-history, statement uniqueness, cancellation/refund concurrency, corrected
collection limits, authorization/revocation, uncertain replay and populated-upgrade
checks. The browser fixture above can start with `REPORT_DEMO_PAID=1` to create a
paid ₹134 synthetic booking. As franchise admin, choose 2099-01-01, capture Sales,
inspect evidence, issue an account statement, then record its complete cancellation
with `SYN_REVIEW`. A new report shows ₹0 gross, ₹134 collections and ₹134 credit.
Record a ₹134 actual refund with a synthetic returned-to reference: a new report
shows ₹134 refunds and zero credit; old reports and the issued statement remain
unchanged. No real transfer occurs. See the [verification record](issue-62-verification.md).

## To-Pay ageing and collection reconciliation (#63)

The user selected the original report scope on 2026-10-04 after reviewing the
missing expanded finance producers. This does **not** complete all of #63.
Monthly debtor terms/opening balances, combined receipt allocations, unallocated
advances and producer-backed overdue alerts remain blocked by #137/#138/#141/#142.
ADR 0045's correction/refund equations and statement policy remain unchanged.

`POST /api/v1/reports/ageing` accepts the usual organization/franchise selection,
Idempotency-Key and `{anchor:"booking"|"due", status:null|parcelStatus,
customer_id:null|UUID, balances:"outstanding"|"all"}`. Defaults are booking age,
all statuses, all authorized customers and outstanding only. Unknown fields,
arbitrary historical cutoffs and policy overrides are rejected. This is one
franchise per snapshot; R11 reads/E03 exports and creating-actor ownership apply.
`GET /api/v1/reports/ageing/:id` (offset in multiples of 100) and `/export` use
the same stored rows. Every read/export rechecks current membership. Unknown
and foreign customer IDs or snapshots return the same controlled not-found.

Each booking appears once with its parcels. A status filter matches any parcel
and includes the whole booking debt once; there is no invented per-parcel split.
All booking dates are eligible, so old debt is never hidden by a recent cohort.
Delivery never settles debt. Original gross includes booked tax and rounding;
adjusted gross subtracts approved reductions. Net collections = collections −
reversals − actual refunds. Outstanding = max(adjusted gross − net collections,0);
refundable credit = max(net collections − adjusted gross,0), kept separate.
Customer totals group the existing private booking customer ID, not a newly
invented debtor account. Read-only drill-through retains entry IDs, sequences,
reversal links, correction IDs and parcel status without contacts or payment
external references. Cash custody is not a reporting balance input.

Age is the difference between Asia/Kolkata calendar dates at capture, with
exclusive buckets 0–30, 31–60 and 61+ days. Negative ages are explicitly Future;
missing anchors are Unknown. Booking age is never labelled days overdue. Due
dates and overdue flags remain null until a reviewed due-date producer exists;
selecting due-date age therefore puts current rows into Unknown. It never
substitutes booking date for a missing due date. Bucket totals age remaining
outstanding only, not original gross or settled amounts.

Capture uses one PostgreSQL 18 statement snapshot across all sources; as-of
means facts visible to that query, not arbitrary backdated reconstruction.
Totals, customer groups, history, pages and formula-safe CSV use stored evidence.
The CSV includes the saved filter, source versions and collection/correction
history. The current 5,000-row/8 MiB/24-hour and actor quota bounds apply; narrow
by customer/status on REPORT_LIMIT_EXCEEDED. Retrying uncertain creation must
reuse the exact key/body; changed intent conflicts. Expiry requires a new
snapshot. Source/audit failure rolls back capture. Access is audited without
customer contact or raw request logging.

No schema, grant or configuration change beyond existing migration 43 and
report grants is needed. Released migrations and fixture counts remain unchanged.
Compatible rollback removes these routes/UI; saved snapshots expire normally.
No background worker, provider call, LLM, auto-collection or mutable balance is
introduced. Broader account workflows stay with their owning issues.

Design sources: reuse [ADR 0044](../adr/0044-bounded-report-snapshots.md) and
[ADR 0045](../adr/0045-sales-and-financial-evidence.md), especially
[PostgreSQL statement snapshots](https://www.postgresql.org/docs/18/transaction-iso.html).
Adopt the [distinction between due-date ageing and invoice age](https://stripe.com/resources/more/what-is-an-aging-report-what-is-in-one-and-how-to-use-it),
using the issue's three buckets and retaining unknown due terms. A due-date
policy and second financial authority are deliberately not inferred.

Verification: `pnpm db:local demo:reports` now includes the ageing database
scenarios alongside snapshot/storage checks. `pnpm test:api`, `pnpm test:web`
and `pnpm db:local quality` include the focused business/UI/database regressions.
The real database fixture delivers a synthetic parcel through the proof service,
leaves it unpaid, records a partial collection and reversal, and reconciles the
saved CSV to its ledger without multiplying its two parcels.

Manual check: start the existing loopback `apps/api/test/report-browser-demo.ts`
fixture and Vite as described above, open Reports → To-Pay ageing, create a
snapshot, inspect Collection history and parcels, reload, then download CSV.
Switch Age from to Due date and create a new snapshot: dates/age must be Unknown.
Set `REPORT_DEMO_AGEING=1` before starting the fixture to deliver one parcel,
collect ₹10 and reverse ₹4 through the real services. Filter Delivered and verify
₹128 outstanding from ₹134 tax-inclusive gross. The second parcel remains booked;
the obligation must still appear once. All dates includes the
existing future-dated synthetic booking, labelled Future rather than overdue.

### Local verification of the original #63 scope — 2026-10-04

Base: `3eb0e0142d63a13806e2f100eed2bdaf84160421`, latest main containing
PR #162; clean issue branch `issue-63-to-pay-ageing`. Original prerequisites
#29/#61 are merged. #62's head passed all seven remote checks, including
PostgreSQL integration; no subsequent payment-race fix was found. Expanded
finance prerequisites remain open. No commit, push, PR or deployment was made.

- Passed `pnpm db:local demo:reports`: eight real PostgreSQL scenarios, including
  three ageing scenarios for tax-inclusive debt, delivery, reversals, refunds,
  A/B/C authorization, restart, exact replay, expiry and atomic failure.
- Passed focused ageing business tests (3) and UI tests (2). Initial UI failures
  exposed select accessible-name ambiguity, fixed with explicit labels. The
  initial DB failure was a test using a nonexistent membership column; the final
  test uses the real membership revocation service. The full focused suite passed
  after that correction, with no weakened assertion or increased timeout.
- Full `pnpm db:local quality` passed 35 tooling tests, planning, lint and tenant
  checks, five typechecks, 22 testkit and 12 DB harness unit tests, 658 API tests,
  196 web tests, three real object-store contract tests and 74 schema tests.
  Its 47-file API database group reached `DB_TEST_TIMEOUT` at the unchanged
  1,800-second Windows aggregate cap. **The full quality gate did not pass.**
- Progress diagnostics showed continuously registered fixtures and advancing
  test files, with no long query/lock wait in the sampled database activity.
  The final-only reporter did not preserve a complete API result before timeout.
  These samples do not establish a complete root cause or prove every file passed.
  No overlapping database suite ran; no blind aggregate retry was launched.
  The inherited #62 payment-race failure remains unexplained, not claimed fixed.
- The separately required final `pnpm build` passed API and web production builds.
  `pnpm check:migrations` confirms all 43 released migrations unchanged. A file
  hash manifest confirmed reviewed source stayed unchanged during the quality run.
- Real browser on an isolated local port verified delivered/unpaid filtering,
  the ₹134 − (₹10 − ₹4) = ₹128 calculation, two parcels counted once, history,
  reload, explicit unknown due-date bucket, keyboard capture and a 390px viewport
  without horizontal overflow. Browser warning/error log was empty. CSV initiation
  succeeded but the browser download event timed out; native downloaded-file
  delivery remains unverified. API tests independently verified CSV bytes/sums.
- Disposable database/object-store/browser fixtures were cleaned up. The user's
  pre-existing localhost:5173 server was preserved. No production data was used.

The original implementation is reviewable, but aggregate DB verification and
expanded producer-dependent acceptance remain incomplete; do not close #63 or
claim merge readiness from these results. Current-change remote CI is not run
because publication is outside authorization.
