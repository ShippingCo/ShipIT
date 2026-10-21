# Scoped reporting and exports (#61, #62, #148)

M6 makes financial, operational, messaging and compliance reports reconcile to saved
facts. The expanded milestone also adds cash, account billing, agent settlement and
reconciliation workflows. Sources precede their dependent reports; #61 can start on
#15/#21/#23/#29 without waiting for all carrier or future finance work.

The production **Reports** screen creates a booking-cohort snapshot for the selected
franchise and inclusive Kolkata date range. It displays the server count and totals,
loads fixed pages, reloads by snapshot ID and downloads matching CSV. The Sales and
GST tab adds the #62 definition described below. #63–#65 and the wider #137–#150
workflows retain their own sources and consumers.

## Integrated reconciliation evidence

[Issue #67 verification](issue-67-verification.md) ties sales, dashboard, accounts,
cashbook/close, agent settlement, reconciliation, contribution, audit and scheduled
summary/export evidence to one runtime-service fixture. Sales collections are
allocations to a booking cohort; daily collections are actual receipt occurrences.
Compare matching definitions and capture windows, not the two amounts indiscriminately.
Run `pnpm db:local demo:reconciliation` for the reproducible cycle and producer regressions.

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
These are booking-period net collections, not a receipts-by-collection-day report. With #138, the existing `collections` fields retain their
booking-ledger meaning: legacy entries plus funds applied from actual receipts, less
linked releases/reversals (and separately labelled actual refunds where supported).
A multi-bill receipt contributes only its application to each bill, never its whole
received amount to every bill. Unallocated advances stay in the receipt workspace.
Allocation timestamps describe application, while receipt `occurred_at` describes
actual money receipt; neither creates another booked sale. Receipt-date inflow and
advance control totals must use each immutable `money_receipts` source once and its
allocation balance, with legacy missing provenance explicitly unknown. Existing
booking-period CSV schemas and saved snapshots retain their compatible meanings.
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

The completed #138/#139/#142 producers use these same authoritative payment and
financial-change rows. Collections include allocated receipt amounts, never unused
customer advances. A `refund_correction` reduces a previously recorded refund;
it does not record another transfer. The Sales screen accepts and labels that
evidence in both saved reports and current booking history.

New sales captures include every issued monthly statement revision containing
the booking, alongside legacy statement membership. Each booking remains one
sales row regardless of its document count. The existing private
`GET /api/v1/finance/statements/:id` evidence link reads either the legacy
`account_statement` or the monthly `account_statement_v2` document under current
R11 scope. Monthly documents show their frozen opening/charges/credits/allocated
payments/refunds/closing equation and separate advances. Issuing monthly documents
still belongs to Customer accounts; the legacy issue command cannot replace that
workflow. For another included franchise, switch to that franchise before opening
its statement. Existing report snapshots and issued documents are not rewritten.

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

The original scope shipped in PR #163. The 2026-10-18 completion consumes the
merged #138 receipt allocations, #139 adjustments, #141 frozen account terms and
#142 monthly statements. ADR 0045's financial equations remain unchanged.

`POST /api/v1/reports/ageing` accepts the usual organization/franchise selection,
Idempotency-Key and `{anchor:"booking"|"due", status:null|parcelStatus,
customer_id:null|UUID, balances:"outstanding"|"all", overdue_only?:boolean}`. Defaults are booking age,
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
Customer totals and the customer filter use the frozen responsible debtor on
account bookings, otherwise the original booking customer. Shipping customer,
account and terms-revision IDs remain separate evidence. Read-only drill-through retains entry IDs, sequences,
reversal links, correction IDs and parcel status without contacts or payment
external references. Cash custody is not a reporting balance input.

Age is the difference between Asia/Kolkata calendar dates at capture, with
exclusive buckets 0–30, 31–60 and 61+ days. Negative ages are explicitly Future;
missing anchors are Unknown. Booking age is never labelled days overdue. Due
dates come from the immutable customer-account booking terms. Overdue is true
only for positive remaining debt after that date in Kolkata, independently of
the selected age anchor; `overdue_only:true` is the source query for #149.
Legacy bookings with no terms retain null due dates and overdue flags. It never
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

No new migration or policy is introduced. All existing migrations remain unchanged.
Runtime report reads need SELECT on the existing account-booking/statement, receipt,
allocation, COD-reservation and advance-return tables; the fixture grants mirror
that read boundary. Existing R11/E03 and statement permissions remain unchanged.
Compatible rollback removes these routes/UI; saved snapshots expire normally.
No background worker, provider call, LLM, auto-collection or mutable balance is
introduced. Broader account workflows stay with their owning issues.

### Monthly evidence and advance reconciliation

One MVCC query captures debts, receipt allocations, separate advances and the latest
issued statement reference containing each booking. Receipt/allocation IDs explain
combined payments without counting the receipt amount again. Signed refund
corrections reconcile the displayed evidence to totals. Cash custody, agent fees
and handovers cannot reopen customer debt.

Advances are franchise-wide or restricted to the selected debtor, independent of
parcel-status, overdue and outstanding filters. Each receipt appears once:
received minus allocated minus seller COD reservations minus actual advance returns
equals unallocated. Advances do not offset a different obligation automatically.
The screen explains this scope; CSV retains the same advance evidence JSON once,
on the first debt row or a metadata-only row when there is no debt. Such a row has
no booking or money amount cells and is not an additional obligation. Both debt
and advance sources are limited to 5,000 and the complete CSV to 8 MiB.

Expand an issued statement from a booking to read its opening balance, charges,
credits, allocated payments, refunds and closing balance plus source IDs. This is
the retained document at its displayed as-of, which may differ from the report's
current snapshot. The existing statement endpoint rechecks its own permission;
report access never confers statement or allocation write authority. A booking
without an issued statement says so explicitly. Older v1 saved snapshots remain
readable with unavailable advance evidence and optional new provenance fields.

Reproducible fixture: `apps/api/test/database/ageing-accounts.test.ts` creates two
monthly shipments, pays the first in full and the second partly from one receipt,
leaves 1,000 paise unapplied and cash with a delivery agent, then issues a statement.
It reconciles totals/CSV, day 30/31/60/61, the Kolkata due-day boundary, saved reload,
later allocation and isolated B/C tenants. It uses producer services and substitutes
only the report capture clock, never mutating frozen booking or ledger records.

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

At the time of this historical run, aggregate DB verification and expanded producer-dependent acceptance were incomplete. These results alone did not establish merge readiness. Later PR #163 checks passed before its merge; the 2026-10-18 follow-up verification is recorded separately.

### Expanded account-ageing verification — 2026-10-18

The completion branch starts at merged PR #179 (`ae3bf6d`), after all #63
prerequisites were verified closed. Reproduce the browser fixture with
`pnpm db:local exec node --experimental-strip-types apps/api/test/ageing-browser-demo.ts`,
then start Vite with `SHIPIT_API_PROXY=http://127.0.0.1:3061` and open
`http://localhost:3061/_fixture/session`. The existing two-terminal instructions
above also describe the optional 5174 port and clean shutdown.

The real API/PostgreSQL browser check verified due-date selection, keyboard snapshot
creation, reload, receipt evidence, separate advances and issued-statement expansion.
The synthetic example shows 13,400 paise gross, 500 allocated, 12,900 outstanding
and 1,000 unallocated; the issued statement reconciles to those values. A 390px
viewport had no horizontal overflow, and browser warning/error logs were empty.
The CSV button reported success; exact export bytes are verified by automated
service tests, not a claim that a native download was inspected. Both owned browser
fixture services and their disposable database were stopped after verification.

The final strict `pnpm db:local demo:reports` run passed all 22 cases across six files, including original and expanded ageing, with no failures/skips/cancellations/todos and disposable resource cleanup.

Local checks on the final implementation: toolchain/tooling, planning, lint, all
five workspace typechecks, 760 API tests, 361 web tests, three S3-compatible
contracts, 90 schema database tests, and production build passed. Migration
history confirms all 54 released files unchanged. The aggregate Windows
`pnpm db:local quality` run failed at the existing
`shipment-costs.test.ts:127` 5,001-source case; its strict reporter did not retain
the underlying assertion. That full command is **not** recorded as passing.
Detailed diagnostics passed all 11 shipment-cost tests alone, then all 74 tests
across that file and its eight neighbors with the normal two workers; the
5,001-source case took 82 seconds. Those checks did not reproduce or establish
the root cause of the original failure. No test, timeout or assertion was weakened.
Current-head GitHub quality and every PostgreSQL shard remain required before
merge; the PR records their final results. No independent human approval is
claimed; current branch protection and review conversations must be checked.

## Delivery and route performance (#64)

`POST /api/v1/reports/performance` captures `delivery_performance_v1` for inclusive
Kolkata `from_day`/`to_day`, `sort` and `eta` (`original` default, or `revised`).
Saved reads and private CSV use `/api/v1/reports/performance/:id` and `/export`.
They retain #61 limits, lifetime, actor ownership, current authorization, exact
idempotent retry, audit and safe errors. A new snapshot never modifies source state.

Each row is one owning-franchise parcel from a booking-date cohort. `booked` is the
whole cohort, `dispatched` is the subset with immutable dispatch history, delivered
and final RTO are separate outcomes, and open means neither delivered nor RTO.
Failed parcels/attempt counts consume immutable failed-attempt records; a parcel
may have failed attempts and later deliver. These measures overlap deliberately;
they are not statuses whose sum should equal the cohort.

Actual delivery uses the saved delivery-proof completion timestamp, not a status
edit or ETA. Duration is dispatch-to-delivery, excluding missing/backwards timing.
Original ETA is the first non-null applied base ETA of that dispatch manifest;
revised ETA is the last applied version effective no later than delivery. Each row
retains both timestamps and route versions. On-time is actual <= selected ETA, only
for delivered parcels with both timestamps. Numerator, eligible denominator and
excluded-delivered count are explicit; zero denominator is unavailable. Open parcels
are not failures. Future planned times never become actual route departure/arrival.

Frozen booking pricing supplies destination/service and opaque customer relationship
ID; actual dispatch-manifest route supplies courier/route provenance. Missing
courier/destination/timing remains unknown. No current customer directory, proof
method/detail, OTP, phone/address or financial amount is exposed. #147 owns financial
cost/contribution; #149 may consume these saved operational exceptions and freshness.

Destination and route groups reconcile to the same complete snapshot. Optional
`destination` and `route_id` on reads/exports select saved rows before pagination;
`$unknown` selects a missing dimension. Returned `selection.count/summary` describes
that exact subset while snapshot metadata retains the full cohort. A route ID absent
from the saved scope is 404. Matching CSV exports the entire selected subset, including
pages not loaded yet, with spreadsheet-safe cells and source IDs. No lot/direct-membership
join multiplies a parcel: the query starts at parcels and reduces each source relation.

Read permissions use R26 full-franchise org-admin/franchise-admin/operator/dispatcher/
read-only grants, separately from financial R25. E04 exports require explicit
franchise-admin membership. Accountant-only grants cannot browse this report. An
assignment-only delivery agent can capture only parcels whose latest persisted
attempt belongs to that agent, including completed deliveries after the current
assignment field clears. Metadata and CSV label the audience as assignment or
franchise. Agent results contain no franchise totals and cannot be exported. A
full operational grant takes precedence when an actor holds both grants.
Capture is derived read evidence, not a new business mutation privilege. Current
membership is checked on replay, pagination, drill-through and download. For agent
reads/replays, the entire saved selection must still belong to that agent before
any metadata/counts/pages return; reassignment or loss of the full-franchise grant
makes an incompatible saved snapshot unavailable (404). Create a new snapshot to
see the current assignment selection.

Research: adapt [Google SRE's numerator/eligible-event approach](https://sre.google/workbook/implementing-slos/)
for honest denominators/exclusions; using it for courier cohorts is our application
inference, not a claim that Google uses this courier policy. Adopt the existing
[PostgreSQL statement snapshot](https://www.postgresql.org/docs/18/transaction-iso.html)
for a consistent source view. Cost: bounded indexed reads and short snapshot transactions;
no warehouse, new queue, dependency, provider or LLM. Verify denominator boundaries
in rule tests, owning-source joins/authorization/replay in real PostgreSQL, and
reload/filter/export/retry behavior in production UI tests.

No new schema or historical backfill is needed. Existing runtime reads of bookings,
parcels, transitions, failures, dispatch manifests/routes/effects and delivery proofs
must be provisioned alongside #61 snapshot/access-event grants. Grant only needed
SELECT access, preserving existing write restrictions. Unknown legacy evidence stays
unknown. Rollback disables the new route/view without changing saved source facts.

Development verification: use the pinned toolchain and `pnpm db:local quality`.
Focused rules: `pnpm --filter @shippingco/api exec vitest run test/integration/performance.test.ts`.
Focused UI: `pnpm --filter @shippingco/web exec vitest run src/test/performance.test.tsx`.
Real DB coverage lives in `apps/api/test/database/performance.test.ts`, discovered
by the required database runner. With fictional bookings, open Reports → Delivery
performance, capture a date cohort, compare original/revised timing, choose a destination
or route, export, and reload the saved URL. A new delivery changes a new capture only.
Local Docker availability and final code-version verification are recorded in the PR;
this guide itself is not an executed database or live-browser qualification claim.

## Messaging and assistant effectiveness — issue #65

The production report uses `messaging_effectiveness_v1`, selected by a fixed closed
UTC Monday-to-Monday week within 53 weeks, with the #52 15-minute closing grace.
`POST /api/v1/reports/effectiveness` captures `{week}`; authenticated organization/
franchise selection is query scope, never request ownership. `GET /:id` reloads it;
optional `section` and `category` select saved aggregate cells before returning them.
Unknown category IDs are 404; unknown filters are rejected. There is no transcript,
customer list, arbitrary customer/time filter, export or provider-send endpoint.
R27 allows selected own-franchise org-admin/franchise-admin only. R22 support access
and financial report access do not grant this report. Current membership is checked
on capture, replay and drill-through. Another actor's or foreign snapshot is not found.

One SQL statement captures the existing owning sources and a statement cutoff.
The cutoff is truncated to milliseconds before both returning `as_of` and computing
queue business minutes. This matches the JavaScript/JSON timestamp precision so
an elapsed partial business hour reconciles exactly to the published cutoff.
[PostgreSQL's datetime contract](https://www.postgresql.org/docs/18/functions-datetime.html)
specifies a stable statement start and explicit `date_trunc` precision; this adapts
those functions to the existing public timestamp contract with constant SQL work,
no schema/backfill and no client-supplied clock. The native weekly fixture includes
all-day staffing to exercise a partial hour on any weekday, independent DST projection,
reopen anchors, and separate exact equations for each captured snapshot's own cutoff.
Messages are a creation-week cohort of immutable logical outbound IDs; all normalized
attempt observations are reduced before joining. Read/delivered evidence wins over
an earlier failed attempt. Accepted/sent/pending/uncertain are explicitly not proof
of delivery. Recorded attempt receipts count separately from logical messages.
Current provider failure, historical provider failure observed, pre-send configuration
failure, consent suppression and other policy suppression are separate categories.
Consent unknown/revoked/processing-pending are consent suppression. Overlapping route
notification decisions are not consent denials. No-outbound automation decisions do
not become provider messages. Known customer records are distinct saved customer
UUIDs, independent of retries/contact changes; replies without a saved customer
identity remain unknown-customer intents, never inferred people or unique phone users.

Assistant cells reuse #52 immutable categories, failure reasons, support events,
clarification-expiry and interpretation/reply observations. Success means a tool
result, thanks means the saved gratitude signal, case resolution means a staff event.
They do not imply receipt, overall resolution, satisfaction, calls saved or ROI.
Turn denominators include measured primary turn categories once, excluding historical
unmeasured turns; staff-event denominators use opened/resolved/reopened event IDs.
Other observational cells have an unavailable denominator rather than an invented
rate. Receipt-to-record latency is not message transport latency.

Queue cells describe all current open/claimed cases at capture, including older cases,
separately from the weekly cohorts. Latest immutable opened/reopened event anchors
age; notes, incoming turns and claims do not reset it. Business minutes project that
interval through the captured configured weekdays/start/end in its explicit IANA zone,
using PostgreSQL timezone conversion and elapsed intervals. The captured current
schedule is not historical staff availability; holidays and schedule changes are
unmeasured. Missing/unavailable staffing or missing/future anchors make age unknown,
not zero. Counts and eligible mean-age subsets have their own disclosure checks.

Fixed cells include zero and distinguish suppressed/unknown values. #52 retains its
five-conversation suppression and hidden failure parent. Messaging uses at least five
internal recipient subjects (saved customer identity, otherwise scoped installation/
contact identity); queue uses distinct conversations. Small nonzero cells, complementary
parents and their denominators/exclusions are hidden. No contact identity leaves the
query or is copied into snapshots. This is conservative disclosure minimization, not
differential privacy. `snapshot.count` is the fixed number of stored metric cells,
not a message, customer or conversation total. Related totals may be unavailable even
when a large leaf cell is visible. The UI presents counts/denominators/exclusions
without an unsupported causal resolution or delivery rate.

Snapshots reuse actor/tenant ownership, 24-hour expiry, 20-active-snapshot quota,
8-MiB bound, atomic saved evidence/access audit, and exact idempotent retry. Saved
results remain unchanged if later callbacks, staff actions or staffing settings change;
a new capture produces new freshness evidence. No source schema/backfill is needed.
Provision existing report snapshot/access-event rights and SELECT on outbound,
attempts, delivery observations, conversation turns/inferences, support cases/events
and franchise ownership. Preserve every existing source write restriction. Rollback
can disable the API/view without changing immutable sources or released migrations.

Research: adapt the [OpenTelemetry distinction between messaging operations and
messages](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-metrics/)
(the semantic convention is Development status) without adding an SDK. Use
[PostgreSQL named-zone date/time operations](https://www.postgresql.org/docs/18/functions-datetime.html)
and the existing statement snapshot for consistent bounded source aggregation.
Our courier cohorts, calendar projection and disclosure choices are application
judgments; these sources do not promise a courier SLA or anonymous data. Reuse
ADR0037/#52 evidence minimization. Cost is indexed source reads and short snapshot
transactions; no warehouse, background counter, new broker, provider or LLM change.

Verification: with the documented disposable PostgreSQL environment and pinned
runtimes, run `pnpm db:local demo:reports` for the fictional report suites. The new
`apps/api/test/database/messaging-effectiveness.test.ts` exercises source retries,
callback order, provider rejection vs consent/template policy, owning failed-tool
then handoff events, populated weekly thanks/failure/staff-event reconciliation,
NY daylight-saving elapsed hours, Kolkata partial-day/weekend/reopen/note ageing,
restart/replay, R27 isolation, atomic rollback and concurrent capture. Historical
fixtures insert copies of real worker outcomes without disabling source constraints.
Matching integration/web tests cover disclosure and keyboard/reload/drill-through/
uncertain retry. Required final-head CI and review gate merge; passing focused tests
alone does not establish completion. Actual checks/environment limitations are in
the PR. Manual synthetic example: capture a closed Monday week as a franchise admin,
inspect accepted versus confirmed delivery and thanks versus staff resolution, open
a category, reload its snapshot URL, and repeat as a foreign franchise/operator to
confirm denied counts. Use signed fake callbacks and fictional fixtures only.

## Owner daily dashboard (#148)

Verified implementation base: main `37e3d97`, after merged sales PR #181, ageing
PR #180 and monthly-statements PR #179. Named prerequisites #61, #62, #63, #138,
#139 and #142 are closed. #67 and #149 consume this work. The approved D137-3
identity/metric definitions remain authoritative; no owner role or financial write
permission is added. Production Workspace shows the dashboard to R11 report readers.
The fictional prototype dashboard remains isolated and unchanged.

API (authenticated organization/franchise selection, no-store responses):

- `POST /api/v1/reports/daily`: optional `day` (YYYY-MM-DD, null means server today),
  `mode` (`same_elapsed`, default; or `complete_day`), and `franchise_ids` (1–50,
  including the active anchor). Future days, invalid dates, duplicates and unknown
  fields are rejected. CSRF and an exact idempotency key/body are required.
- `GET /api/v1/reports/daily/:id`: saved `owner_daily_v1` summary plus 100 source
  rows. Optional `period=today|yesterday`, `metric` (a summary key), optional collection `method`, and `offset`
  (multiples of 100) filter the saved evidence without recalculating the summary.
  Capture initially returns selected-day rows. `today` names the selected day;
  historical requests retain explicit calendar windows in the metadata and UI.
- `GET /api/v1/reports/daily/:id/export`: the same optional period/metric selection;
  fixed minimal, formula-safe CSV with source IDs and independent integer paise.
  Summaries retain their full saved meaning; exported filtered rows match the
  clicked measure. Customer metrics reconcile by distinct franchise/customer IDs;
  average reconciles by eligible gross divided by eligible booking count.

Every source query and both periods use one PostgreSQL statement view. Selected day
runs from Kolkata midnight to the earlier of next midnight or capture time. Complete
comparison uses all of yesterday; elapsed comparison stops yesterday at the same
elapsed local-day instant. Duration arithmetic is exactly 24 hours, independent of the database session timezone. Both ranges are half-open, so midnight is never counted
twice. All source evidence visible at capture is evaluated at each period's effective
cutoff. Later recorded/backdated facts appear only in new snapshots; this is not a
claim to reconstruct exactly what an operator knew yesterday.

Equations and source ownership:

- Bookings: confirmed commercial bookings in the window, excluding financial
  cancellations effective before that window's cutoff. Parcels are not bookings.
- Billed gross and tax-exclusive revenue: booking snapshots less the existing
  component-wise financial reductions effective by cutoff. Monthly documents do
  not create bookings, revenue or an additional obligation.
- Average bill: adjusted cohort gross / eligible bookings, nearest integer paise
  (half up). No eligible booking means `null` / Unavailable. No NaN or infinity.
- Collections: each immutable money receipt once by actual `occurred_at`, including
  advances and receipts for older bookings. Receipt allocation/release ledger entries
  are excluded from inflows. Legacy independent collections less their reversals
  retain their saved method; no receiving-account provenance is invented.
- Actual refunds: booking refund records less refund corrections, plus actual unused
  advance returns by their transfer instant. Requests/approvals and allocation
  releases do not constitute an actual refund. Refunds remain separate from inflows.
- Outstanding: sum of positive adjusted booking gross - net ledger applications +
  actual booking refunds, for all bookings before each cutoff. This is a stock of
  customer debt, not today's sales, bank matching, cash custody or agent retention.
- Customers: distinct `(franchise_id, customer_id)` among eligible window bookings.
  New means no earlier eligible booking before the window; otherwise returning.
  A customer first booking in this window is counted once as new even if they book
  repeatedly. Earlier cancellations are evaluated at each cutoff. No cross-franchise
  phone merging. New + returning = eligible unique relationships.
- Comparison: signed current - previous; percentage is the signed change divided
  by the previous value, truncated to two decimal places. A zero or unavailable
  denominator produces an unavailable percentage, never an infinite increase.

Snapshot storage, ownership, 24-hour expiry, 20-active quota, 5,000 source-row and
8 MiB bounds reuse #61. The row bound covers both periods, including historical
unpaid bookings. Limits fail atomically with 413, never partial successful totals.
Narrow franchise selection if necessary. There is no new editable totals store,
projection service, cache, job, provider call, dependency or financial mutation.
Read/capture/export access events use the existing private report audit.

All selected franchises require current R11 grants. Saved reads, pagination, exact
capture retries and exports reauthorize the whole saved selection; E03 is additionally
required in every exported franchise. Snapshots belong to their capturing actor.
Unknown, expired and foreign IDs have the same controlled 404. Revocation removes
access. UI failures do not fall back to localStorage. The shell's existing authority
lifetime unmounts private dashboard state on franchise/user/membership changes.

Research/design review: adopt a single SELECT view, rather than a new isolation or
projection subsystem, following [PostgreSQL 18 snapshot semantics](https://www.postgresql.org/docs/18/transaction-iso.html).
Use explicit Kolkata conversion and half-open ranges following [PostgreSQL date/time documentation](https://www.postgresql.org/docs/18/functions-datetime.html).
Reuse the stored key/fingerprint/result and expose exact uncertain retries, adapting
[AWS Builders' Library idempotent API guidance](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/).
These practices address mixed-cutoff totals, midnight ambiguity and duplicate capture
respectively, with no new dependencies. Materialized projections and distributed
caches are deferred: no measured need justifies their operational cost here.

Rollout: apply existing migrations through all 54 released files before the API/web
update. No new migration, backfill, secret or feature flag is required. In addition
to #61 grants, the report runtime needs SELECT on `money_receipts`,
`money_receipt_allocations`, `advance_refund_commands` and existing booking/payment/
financial-change sources. `prepareReports()` and `prepareMoneyReceipts()` supply
fixture grants; production grants belong to the deployment owner. Keep existing
SELECT/INSERT and restricted cleanup UPDATE on report snapshots/access events.
Rollback compatible API/web code to remove entry points; retain saved/private history
until ordinary expiry cleanup. Do not rewrite original financial evidence.

Manual verification: use disposable PostgreSQL, set `REPORT_DEMO_DAILY=1`, and run the
existing `report-browser-demo.ts` command above. Open its fixture-session URL, use
Workspace, leave day blank and press Load daily dashboard. Expected fictional values:
1 booking, ₹134 gross, ₹128 tax-exclusive, ₹60 collected, ₹74 outstanding, 1 new
customer. Switch comparison modes; click each current/previous metric for matching
saved source rows, download CSV, and reload the `daily_snapshot` URL. Test narrow
screens and keyboard focus. Stop via the documented fixture-stop endpoint. No real
customer, bank, accountant or provider compatibility is claimed.

Automated evidence: `apps/api/test/integration/daily-dashboard.test.ts` protects IST
midnight/modes, integer average, cancellation denominator, identity partition,
zero comparison and evidence selection. `apps/api/test/database/daily-dashboard.test.ts`
uses real PostgreSQL/runtime roles for ₹1,000/₹600/₹400 timing, three bookings/one
customer, receipt/advance allocation deduplication, independent CSV equations,
cancellation/refund and historical-cutoff behavior, immutability, concurrent exact
capture, lost commit acknowledgement, scope escalation/revocation and expiry.
`apps/web/src/test/daily-dashboard.test.tsx` covers selected controls, server values,
saved reload/evidence, exact uncertain retries, late-response rejection, protocol
projection and empty states. Existing sales/monthly-statement tests protect document
issuance without duplicate revenue; their producer commands are reused unchanged.

Local verification on 18 October 2026 (pinned Node 22.23.2, pnpm 10.34.5,
Python 3.12.14; disposable PostgreSQL 18.6 and private object-store fixtures):
763 API unit/integration tests, 365 web tests, 3 object-store contract tests and
90 schema tests passed. The final four maintained API database shards ran serially:
124, 138, 182 and 145 tests respectively, totaling 589 tests across all 80 files,
with no failures, skips, cancellations or todo cases. Tooling/testkit/DB unit,
planning, tenant-query lint, all workspace types, all 54 released migration hashes
and the API/web production build also passed. The final source manifest was stable
through these database shards. Real browser checks used the fictional API/database
fixture for capture, both modes, metric/method evidence, CSV bytes, saved reload,
empty/future dates, keyboard focus and a 390-pixel viewport without page overflow.

This evidence combines broad checks with affected reruns; neither earlier aggregate
is represented as green. The first root quality run stopped on an existing shell
test's global option selector; scoping it to the Franchise select preserved its
two-franchise and stale-state assertions, and all 365 web tests then passed. A later
continuation hit its outer 30-minute wrapper limit and removed PostgreSQL during
remaining workers. Its sparse shipment-cost failure cannot be timed reliably
relative to that shutdown. An unchanged-assertion, unchanged-timeout 18-case cost
diagnostic passed; this alone did not explain the earlier failure. All final API
shards, including costs and the interrupted workers, passed with the repository's
existing literal `test:db` wrapper budget and case/file deadlines. A demonstrated
New York DST regression (one booking instead of two) was fixed using exact 24-hour
arithmetic; both modes and Kolkata midnight boundaries passed in the final daily
database test. No real provider, production deployment, final-head CI or review
approval is claimed by these local results.

## Scheduled owner summaries and overdue alerts (#149)

The product owner selected in-app reports plus optional WhatsApp notifications on
18 October 2026. WhatsApp starts disabled. The recipient must explicitly opt in
using their own verified WhatsApp login identifier. A message contains only an
authenticated report link, with no financial amounts, customer names, bank references
or public bearer grant. Customer/shipment consent does not authorize owner reports.

Reports → Owner summaries and alerts supports schedule creation/editing/disabling,
selected franchises/recipients, timezone, daily/weekly/monthly frequency, local time,
corrected versions, overdue thresholds, explicit notifications and repeat policy,
self opt-in, acknowledgement, status history, saved evidence and matching CSV.

Daily means the previous complete local day. Weekly means Monday–Sunday, due on the
selected ISO weekday; monthly means the previous calendar month, due on day one.
The configured minute is local wall-clock time. A skipped DST time becomes due at
the first existing local time after it; repeated times share one period identity.
A watermark prevents backwards generation across clock changes. Starting a schedule
captures the most recent due period, not an unbounded backlog. Checks are five
minutes apart per schedule. Weekday is ignored for daily/monthly schedules.

Captures retain a half-open economic period [from,to), a recorded capture cutoff,
and original safe source rows under one repeatable-read view. #148 owns booking,
correction, receipt/allocation, refund, customer and historical-debt definitions.
Reporting never writes financial facts. Additional source definitions are:

- Expenses: applied expense-request heads at the period cutoff, including recognized
  agent-fee expenses. Advances, fee payments and transfers are not expenses.
- Overdue: positive #63/#141 debt using frozen contractual due dates. Missing dates
  stay unknown; minimum paise and overdue-day thresholds are explicit.
- Agent-held: known cashbook facts at agent cash locations, distinct from earnings
  and debt. Unassigned custody retains separate counts, source IDs and reasons.
- Cash differences: absolute variances of each session's latest recorded period
  count, with signed evidence retained. Counts are not approvals or transfers.
- Reconciliation: the manual report owner's pending/different/unassigned rows only.
  Recorded/verified rows are not exceptions. Disabled reconciliation stays disabled
  and does not block ordinary reports. Raw references/statements are excluded.

Late backdated source evidence can create explicitly corrected versions when enabled;
original versions and periods remain. A current administrator may also request a
correction within 90 days. Changing franchise selection cannot change an old report.
Overdue evaluation uses current debt independently of summary frequency. Stable
schedule/booking alerts notify once or at the configured repeat interval (minimum
24 hours). Acknowledgement stops repeats. Payment or falling below threshold resolves
the condition; a later recurrence reopens it. Alert notifications save their exact
current cutoff and evidence rather than linking to moving totals.

Configuration requires current franchise-admin grants in every selected franchise.
R11 readers must be current recipients or full selected-scope administrators. E03
still governs exports. Org-admin-only access grants no configuration/export power;
read_only, operators and agents gain no financial reporting access. Every nested ID,
read/export, exact retry, acknowledgement and worker reservation rechecks scope.
Unknown, foreign and expired report IDs have controlled 404 behavior. Commands and
access events project into the canonical private audit history without payloads.

The WhatsApp reservation commit is the send-time authorization point, following
#39. No database lock spans HTTP. Revocation before reservation suppresses sending.
A crash or ambiguous commit after reservation becomes uncertain and never automatically
resends. Only confirmed non-acceptance retries, with bounded backoff and five attempts.
A current administrator can retry a repaired failed configuration, but must inspect
Meta records for uncertain acceptance. Sent means provider accepted, not guaranteed
delivery. In-app availability commits atomically and survives WhatsApp failure.
A failed source capture exposes a failed run/schedule and safe diagnostic code,
delays that schedule, and lets other schedules progress. No raw provider body is logged.

Limits: 20 schedules per owning franchise, 50 selected franchises, 20 recipients,
5,000 combined source rows and 8 MiB per snapshot/export. Limits fail atomically.
Payloads expire after 24 hours; worker maintenance also visits disabled schedules.
The UI shows the most recent 100 authorized reports within 90 days. History/access
records and resolved alerts are purged after 90 days; command receipts have a
365-day retry horizon. Correction chains remain until their newest evidence ages
out. Recipient preferences remain account configuration without copying phones.

API prefix /api/v1/owner-reports: GET workspace; POST schedules, schedules/:id,
consent, alerts/:id/acknowledge, runs/:id/correct, deliveries/:id/retry; GET runs/:id
and runs/:id/export. Normal session, organization/franchise selection, CSRF and
scoped idempotency headers apply. Inputs reject ownership fields, stale versions
and conflicting keys. DTOs are in packages/shared/src/owner-summaries.ts.

Rollout: apply additive migration 55 (1793466000000-owner-report-schedules.cjs), then
enable OWNER_SUMMARIES_ENABLED=true in API and worker. No source backfill, historical
sends or automatic conversion of #66 reporting_schedule selection intent occurs.
Create owner schedules explicitly. prepareOwnerReports() in packages/db/test/support.ts
is the runtime-grant reference: source SELECT, owned command/state tables, restricted
snapshot-payload cleanup, and narrow worker discovery/cleanup EXECUTE. Never grant
public discovery or schema ownership. Reuse the existing start:worker entry point.
In-app-only operation needs no WhatsApp configuration. Owner-only WhatsApp does not
require enabling customer automation policies.

Optional delivery uses the existing server-only WhatsApp secret, outbound_enabled,
an owned connected installation and an actually approved/synced UTILITY template
with exactly one text variable for the report URL. Add this to that configuration:

```json
"owner_reports": {
  "template_name": "owner_report_ready",
  "template_language": "en_US",
  "app_origin": "https://your-existing-operator-origin.example"
}
```

The origin must exactly match an allowed operator origin and use HTTPS outside
development. Current installation identity, credential revision and registered
approval/template shape are rechecked before reservation. Real approval and delivery
are not established by synthetic provider tests. Rollback disables the flag and
reverts compatible code; retain history and repair schema forward. No deployment
or production mutation is part of local verification.

Research: adopt [PostgreSQL calendar/timezone operations](https://www.postgresql.org/docs/18/functions-datetime.html)
and [repeatable-read visibility](https://www.postgresql.org/docs/18/transaction-iso.html)
for consistent source cutoffs. Adapt [AWS idempotent intent guidance](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
to scoped identities, fingerprints and committed reservations. Reuse the provider
under [Meta's business-initiated template guidance](https://about.fb.com/news/2025/04/ways-to-manage-your-businesses-chats-on-whatsapp/).
No new scheduler, broker, LLM, bank integration or package dependency is introduced.

Preview is POST schedules/:id/preview with the current expected_version and an
idempotency key. It creates a private, immutable preview artifact without any
delivery intent, including for disabled schedules. Preview and scheduled/alert run
kinds remain distinct. Captures record the first MVCC snapshot's server time; send
reservation uses READ COMMITTED so an opt-out committed while waiting for the owner
lock is respected. A controlled two-transaction regression exercises that race.

Reproducible fictional verification: run the owner-summary database file through
the guarded PostgreSQL harness, the owner-summaries web test, and `pnpm quality`.
The seven database scenarios cover calendar boundaries, persisted equations and
HTTP response dates, uncertain acceptance/crash recovery, an opt-out racing the
send reservation, overdue acknowledgement/repeat/payment resolution, every selected
franchise's grants, real expense/count/custody/reconciliation sources, preview,
late correction, payload expiry and capture-failure recovery. The populated-upgrade
test in packages/db/test/integration/owner-reports.test.ts verifies migration 54→55,
atomic rollback, retained financial records and no fabricated delivery intent.

Manual developer check: start the existing report-browser-demo.ts fixture with
REPORT_DEMO_OWNER=1, REPORT_DEMO_WEB_PORT=5174 and TEST_DATABASE_IDENTITY=db_test against a disposable guarded test
database; start Vite on 5174 with SHIPIT_API_PROXY=http://127.0.0.1:3061 and
VITE_DATA_MODE=production. Open http://localhost:3061/_fixture/session. The synthetic
previous-day report has one booking, ₹134 gross, ₹60 collections and ₹74 debt;
one due date and one custody source are unknown. Open its saved evidence, export
CSV, reload its link, preview without sending, create a disabled monthly schedule
and edit it to weekly/Wednesday. Check required-field validation and keyboard focus;
at 390px the document must not overflow horizontally. Stop the disposable fixture
through /_fixture/stop. No live recipient or provider credentials are required.

On 18 October 2026 this browser journey passed against real local Fastify/PostgreSQL,
including the 390px layout, saved-link reload and CSV success state. Final focused
owner database rerun: 7/7 passed (192.830s); UI: 4/4 passed; all workspace typechecks
and lint passed. The planning inventory required the four new report-test declarations
and CSV object-URL cleanup to be reviewed and registered before the full gate.
Browser-discovered UTC timestamp formatting and
fieldset minimum-width defects were repaired before these final focused results.
Meta acceptance is exercised through the existing real HTTP adapter with synthetic
responses; no live template approval, customer message or provider delivery is claimed.

Broad verification also exposed an existing #148 capture/URL-reload race: the
duplicate reload could replace a subsequent metric drill-through and detach its
focused evidence heading. A successful capture now publishes its returned page
without a second reload; request generations reject stale reads and focus runs
after the committed render. The existing daily-dashboard regression additionally
requires the exact metric heading and rejects the redundant unfiltered reload.
The combined daily/owner focused UI run passed seven cases. Failed aggregate logs
are retained separately; verification must distinguish those failures from final
affected-gate reruns and the remaining database/build gates.

Migration 55 also advances current-history expectations in the existing upgrade
tests (54 assertions across 48 files); fixed historical prefix counts and no-op
assertions remain unchanged. Two synthetic forward-repair filenames now sort after
the new migration. The first broad schema run exposed those missed expectations
and a separate two-database pool test failure. That original pool case passed alone
in 19.631s and with a pricing fixture in 10.594s against its unchanged 25s limit;
the broad reporter did not retain its original assertion detail, so timeout/load
remains an inference. The isolation case now installs only its required infrastructure
schema while retaining every role, cross-database, cleanup and readiness assertion;
complete fresh/populated domain upgrades remain mandatory in the schema group.

Final local gate evidence (18 October 2026, pinned Node 22.23.2/pnpm 10.34.5/
Python 3.12.14 and disposable native PostgreSQL 18.6): tooling 41/41, testkit
22/22, DB unit 12/12, API 767/767, web 369/369 and real S3-compatible object
contract 3/3 passed. Final lint and all workspace typechecks passed after the
migration expectation edits. Full schema integration passed 91 cases across all
42 files in 398.147s, with zero failures/skips/cancellations/TODOs. Five focused
historical/owner upgrade, forward-repair and isolation cases passed in 39.925s.

The complete 81-file Windows API database group exceeded its unchanged 1,800s
aggregate budget while still advancing through final-mile/financial workflow files.
It is incomplete, not a passing aggregate, and the production build did not run
inside that failed chain. Full API database qualification therefore uses the four
existing CI shards on the exact PR head; neither the local timeout nor earlier
aggregate failures are hidden or relabelled as passes. A separate `pnpm build`
passed (API type build and Vite production bundle; web bundle 14.02s). Current-head
CI results must be recorded before merge. Existing web tests emit
React act/router warnings; the S3 negative-stream case emits an expected SDK warning.

## Accountant register (#150)

The [generic accountant bundle and API contract](accountant-exports.md) adds a private,
versioned register over existing financial owners, with independent controls and
saved-source drill-through. The [GnuCash candidate](accountant-target-proposal.md)
is not qualified; actual import and genuine accountant review remain separate gates.
