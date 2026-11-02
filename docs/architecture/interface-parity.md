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

This delivery is not full workflow parity. Do not close #193 on its basis.

| Surface | Current production implementation | Work still required |
| --- | --- | --- |
| Navigation/layout | Shared with demo; extra authorized tools retained | Compare future changes in both compositions. |
| Booking | Current step-by-step production flow retained | Demo still has its older fictional booking form. Bring preview coverage onto the retained flow without importing fictional state into production. |
| Dashboard | Shared reference layout; complete scoped parcel/booking totals, Monday chart, recent parcels, dispatch and verified payment report | Provider/assistant summaries identify their bounded pages; no invented reach/satisfaction numbers. |
| Global search | Real scoped task/tracking/customer lookup | Reference's combined lot/route search needs compatible API search contracts. |
| Packages | Current API search, detail, transitions and bulk commands | Reference chips/list/detail presentation; map booking-level payments and cancellation explicitly because a booking can contain multiple parcels. |
| Lots/routes | Current API eligibility, versioned membership and dispatch flows | Reference composition and action placement; retain server eligibility and finalized manifest restrictions. |
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
exact tracking lookup that returned the fixture's persisted parcel. No live
provider delivery was exercised.

Rollback is a code revert; this change adds no production schema migration,
changes no permission grant and does not change stored financial records.
