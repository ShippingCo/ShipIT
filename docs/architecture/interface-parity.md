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
| Dashboard | Existing API operational summary, saved-report trend and daily sales | Restore reference attention queue, parcel journey, recent bookings and daily dispatch presentation with real authorized projections. First-page counts cannot become claimed totals. |
| Global search | Real scoped task/tracking/customer lookup | Reference's combined lot/route search needs compatible API search contracts. |
| Packages | Current API search, detail, transitions and bulk commands | Reference chips/list/detail presentation; map booking-level payments and cancellation explicitly because a booking can contain multiple parcels. |
| Lots/routes | Current API eligibility, versioned membership and dispatch flows | Reference composition and action placement; retain server eligibility and finalized manifest restrictions. |
| Automation | Real durable feed, conversations and provider states | Reference feed presentation, without fictional send success or staff OTP exposure. Live provider verification remains in #186. |
| Receipts/reports | Issued receipts and saved scoped reports | Reference discovery/filters/layout while retaining exact money, correction history and report snapshots. |
| E-way/settings | Current versioned API workflows | Reference presentation while retaining official-vs-estimated evidence, administrative permissions and draft protection. |
| Temporary agents/cash | Existing custody, handovers, statements, review, cashbook and close | Keep accessible; no duplicate attendance/payroll or financial ledger. |

The latest production trend defaults to a rolling seven-day range; the selected
reference and earlier feedback use a Monday-start business week. Resolve that
in the dashboard delivery using `operations/business-dates.ts`, retaining custom
ranges. Do not label rolling seven days as “This week.”

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
