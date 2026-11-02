# Mockup and production interface parity

Tracking: [#193](https://github.com/ShippingCo/ShipIT/issues/193).

On 2026-11-02 the user selected the fictional console at commit `2c6611e`
(`/#/business`, originally served on port 5173) as the presentation reference.
They explicitly retained the newer **From → To → Parcel and Billing → Review
and print** booking flow from PR #192, inside that reference layout.

## Verified cause

`App.tsx` deliberately selects `DemoApp` or `OperatorApp` at build time.
`DemoBusinessShell` previously implemented its own drawer, app bar and routes;
`BusinessShell` implemented a separate navigation and screen composition.
Changing `VITE_DATA_MODE` therefore selected a different interface, not merely
a different data source. PRs #191/#192 subsequently changed the operator
presentation while leaving the original demo screens in place.

Keep the authentication/data separation and production bundle isolation.
Do not point production at `AppContext`, `data/store`, local sample records or
the fictional WhatsApp conversation. Those are not production services.

## First delivery: shared shell

Both compositions now render `ConsoleFrame`, `ConsoleNavigation` and the same
primary task definitions. The reference's white drawer, direct navigation,
app bar, back-to-dashboard action, search entry and responsive drawer are
shared source code. Production adds its real organization/franchise selector,
profile and permission-filtered additional tools. Changing a franchise still
unmounts the private scope and discards old requests.

All existing production destinations remain reachable. Additional finance,
custody, delivery and administration workflows are under **More tools** and
in task search. Links are filtered by the existing role matrix before the
shared presentation receives them. Navigation does not grant authority.
`/business/booking` and `/business/new-booking`, and `/business/feed` and
`/business/automation`, remain compatible entry points.

Production search supports permitted task names, exact tracking numbers,
customer names and complete phone numbers through existing scoped APIs.
It never downloads a global customer/parcel store. Search failures remain
failures, old queries are cancelled, and stale-scope responses are rejected.
Lot/route record lookup is still reached through those work areas, not a
new global search API. The UI states that limitation.

## Remaining parity work

These deliveries are not full workflow parity. Keep the tracking issue open until the remaining surfaces are verified.

| Surface | Current production implementation | Work still required |
| --- | --- | --- |
| Navigation/layout | Shared with demo; extra authorized tools retained | Compare future changes in both compositions. |
| Booking | Current step-by-step production flow retained | Demo still has its older fictional booking form. Bring preview coverage onto the retained flow without importing fictional state into production. |
| Dashboard | Shared reference layout; complete scoped parcel/booking totals, Monday chart, recent parcels, dispatch and verified payment report | Provider/assistant summaries identify their bounded pages; no invented reach/satisfaction numbers. |
| Global search | Real scoped task/tracking/customer lookup | Reference's combined lot/route search needs compatible API search contracts. |
| Packages | Reference chips, customer/destination columns, server ordering and detail dialog; existing transitions/bulk commands retained | Free-text/global and financial filters remain limited to authorized API contracts; no first-page totals or per-parcel payment guesses. |
| Lots/routes | Shared reference cards, create/plan dialogs and focused detail actions | Route planning state is distinct from movement events; delivery/progress and arbitrary broadcasts are not invented from membership counts. |
| Automation | Real durable feed, conversations and provider states | Reference feed presentation, without fictional send success or staff OTP exposure. Live provider verification remains in #186. |
| Receipts/reports | Issued receipts and saved scoped reports | Reference discovery/filters/layout while retaining exact money, correction history and report snapshots. |
| E-way/settings | Current versioned API workflows | Reference presentation while retaining official-vs-estimated evidence, administrative permissions and draft protection. |
| Temporary agents/cash | Existing custody, handovers, statements, review, cashbook and close | Keep accessible; no duplicate attendance/payroll or financial ledger. |

## Dashboard delivery

`DashboardView` is the shared presentation for both adapters. Production uses
`GET /api/v1/parcels/summary?organization_id=…&franchise_id=…` for complete
counts, using the existing `parcels.list` permission, rate limit and scoped SQL.
One statement counts bookings separately from parcels, all current parcel
stages, and distinct parcels with persisted delivery proof today. It never
collects payment or changes parcel state. No migration or permission expansion
is needed.

Business days use **Asia/Kolkata** and weeks start **Monday**. The chart contains
Monday through Sunday, including zero-count days. Custom booking trends and the
existing daily sales report remain available below the reference dashboard.

“Money to collect” reuses the saved ageing report with outstanding balances on
bookings containing delivered parcels. This is booking-level debt, counted once
with existing corrections; it must not be multiplied by parcel count. The
existing accounting age buckets (0–30, 31–60, 61+ days, unknown/future) replace the
fictional mockup's 3/7-day delivery buckets. The UI explains the booking-date
anchor and capture time. Only financial-report roles request it. A capture
creates a report artifact, not a financial posting; an uncertain retry retains
the same idempotency intent. Errors display unavailable amounts, never paid/zero.

Recent bookings lists the latest six **parcels** across dates with tracking and
actual status; no payment state is guessed from parcel state. Booked today opens
today's packages; stage links apply their status to the package query. Today's
dispatch uses the existing bounded route list and explicitly says when further
routes may exist. Customer activity uses only authorized message/support APIs:
provider acceptance is not recipient delivery. No reach or satisfaction metric
is invented from message counts.

## Packages, lots and routes delivery

Both adapters use the same lot and route card frames. Production creates lots and
plans routes through explicit dialogs, retaining drafts when dismissed and preserving
uncertain commands until the original request is retried. Initial keyboard focus
lands in the first field; closing detail returns focus and the saved list position.
Creation retries clear completed drafts just like first-attempt success. Package
status chips and ordering use the existing scoped server query, preserving customer
and date filters; chip counts are omitted because a list page is not a total.

The package list shows actual sender and destination fields. The detail dialog keeps
lot membership, timeline, guarded transitions, delivery assignment, whole-booking
cancellation guidance and permission-filtered accounting together. Delivery-start
uncertain outcomes now expose the existing same-intent retry instead of permitting
another creation request. Pending/uncertain detail commands block dialog dismissal.

The reference includes fictional shortcuts that cannot become production authority:
per-parcel payment amounts cannot replace whole-booking receipt balances, “finalized”
is not “departed/arrived”, and generic lot/route broadcast buttons cannot promise
provider delivery. The existing receipt, route-event and automation/support flows
remain the authoritative paths. Production preserves eligibility, expected versions,
manifest locks, audit and current role ceilings; this delivery changes no API grants
or SQL. These are intentional business-rule differences, not sample data to copy.

## Verification and local preview

Use the pinned toolchain and normal `pnpm db:local quality` gate. Tests cover
shared primary navigation order, missing permissions, additional destinations,
mobile drawer keyboard behavior, retained booking navigation guards, scoped
search, invalid input, cancellation and late responses. The production bundle
is still checked for demo modules and secret markers.

For an isolated real-API preview, leave the original demo on 5173 and run:

```sh
SHIPIT_COUNTER_PREVIEW_ORIGIN=http://localhost:5174 pnpm db:local exec node --experimental-strip-types apps/api/test/counter-demo.ts
VITE_DATA_MODE=production SHIPIT_API_PROXY=http://127.0.0.1:3033 pnpm --filter @shippingco/web dev --host 127.0.0.1 --port 5174 --strictPort
```

Open `http://localhost:3033/_fixture/session`; it redirects to the preview.
The fixture only runs against the guarded disposable test database and accepts
only a loopback preview origin. It does not use the developer's `.env.database.local`.
The wrapper terminates after 30 minutes and removes its own disposable container.
Never use that fixture session route in a deployed application.

Browser verification on this delivery used the real API fixture: the retained
booking dialog and shared navigation at 1440×900, the drawer at 390×844, and an
exact tracking lookup that returned the fixture's persisted parcel. The package, lot and route delivery was also checked at desktop and mobile sizes,
including persisted synthetic lot/route creation and parcel-detail focus return.
No live provider delivery was exercised.

Rollback is a code revert; this change adds no production schema migration,
changes no permission grant and does not change stored financial records.
