# Issue #34 verification — production operational UI

Date: 20 September 2026. All identifiers and names below are synthetic.

## Baseline and readiness

- Starting `main`: `4cd341962c1a851c1fea175702744e9e573574ce` (PR #117 / Issue #33).
- Branch: `issue-34-production-operational-ui`.
- The checkout was clean after `git pull origin main`; no unrelated work was overwritten.
- GitHub reported #18, #23, #24, #25, #26, #27, #28, #29, #32 and #33 closed.
  Their merge commits (`ee8baee`, `e33ce9f`, `336486c`, `0c126e3`, `623babb`,
  `54bb8eb`, `9d6b273`, `32beb6b`, `38e4b9d`, `4cd3419`) are all ancestors of the
  starting main. The stale `status: blocked` label was therefore replaced with the existing
  `status: in-progress` label before implementation.

## Architecture and production routes

`BusinessShell.tsx` now exposes `/business`, `/business/packages`, `/business/lots`,
`/business/routes`, `/business/eway`, `/business/new-booking` (and the old `/business/booking`
alias), `/business/receipts` and `/business/settings`. Navigation is role-aware; direct API
authorization remains authoritative. Reports, Automation Feed, WhatsApp and delivery proof
are not activated.

The new path is component → operations workflow/hook → purpose-specific adapter →
`scopedApi` → the existing API client. `parcels.ts`, `lots.ts`, `routes.ts` and `eway.ts`
decode unknown JSON into closed projections, discard extra fields, correlate mutation results
to path/body identity and propagate expected versions into immutable command intents. No
second fetch client, cache framework, dependency, backend endpoint or schema migration exists.

The screens consume the ratified endpoints from #23–#29/#32:

- Parcel list/detail/timeline, five guarded lifecycle commands and bounded bulk.
- Lot list/detail/archive and exact add/move/remove membership.
- Route list/detail/update/archive/finalize, Lot/direct-Parcel sources, current/historical
  manifests and typed departure/delay/arrival events.
- Booking payment projection and manual To-Pay collection.
- E-way current/history/reminders, capture/correction and explicit estimate.

## Scope, cache and mutation recovery

Every adapter is created from the active `ScopeController`. `scopedApi` captures a scope
ticket and combines its abort signal with feature AbortControllers. A shell remount on scope
generation change disposes local hooks and the bulk controller; late reads fail `SCOPE_CHANGED`
and cannot paint. A → B → A therefore performs fresh reads instead of showing the first A
payload. Cross-tab invalidation continues to clear the controller before reauthorization.

Reads have explicit loading/empty/error/retry states. Confirmed writes refetch relevant
server projections. Lot removal performs a current-membership GET before claiming ungrouped.
Payment collection performs a fresh ledger GET before the updated projection is shown. Route
detail and every remount read the latest persisted event/ETA. Bulk success is removed while
failed items remain selected; deliberate retry first reads current Parcel versions. Network,
abort or malformed dispatched mutation results retain the exact path/body/key/scope for an
explicit same-intent retry. Conflict changes require refresh and a new deliberate intent.

## Authorization, privacy and accessibility

Role gates mirror the published ceiling but never replace server checks. Representative
read-only/write denial, sibling franchise B, unrelated organization C, nested foreign IDs,
stale versions and rollback are already covered by the real PostgreSQL domain suites listed
below. The operational UI does not persist private payloads, compute authorization from
client claims or log request bodies. DTOs omit database/audit/provider fields. Accountant
e-way rendering accepts the redacted projection without vehicle/distance/actor/reason.

Production contains no OTP value/reveal/resend/browser comparison and no generic “delivered”
button. Route arrival does not alter delivery status. E-way external observations remain
“unverified external”; applicability remains server-reported unknown and the exact estimate
label is preserved. Asia/Kolkata is used for operational display while wire instants remain UTC.

Forms use native labelled controls/buttons, visible `:focus-visible`, textual state plus icons,
disabled pending controls, status/error live regions, keyboard-operable Lot removal and bulk
retry. Responsive layout collapses forms/row actions at narrow widths; reduced-motion CSS
removes meaningful animation duration.

## Intentional prototype differences

| Prototype | Production #34 |
| --- | --- |
| AppContext/browser Store is operational authority | ShipIT APIs/PostgreSQL are authority |
| Lot delete and local membership arrays | Archive plus exact membership/version commands |
| Generic status setter, OTP reveal, local delivery confirmation | Guarded explicit commands; delivery completion waits for trusted proof |
| Mutable paid/settled flag | Append-only ledger plus freshly read current projection |
| Browser ETA/delay arithmetic | Route event with absolute total delay and server ETA |
| Fixed threshold/reference/one-day-per-distance assumptions | External observation plus server policy/reminder state and labelled estimate |
| Fictional queue and “customer notified” claims | No provider send or delivery claim |

The demo pages and fictional Store are unchanged behind explicit demo composition.

## Acceptance evidence

| Guarantee | Evidence |
| --- | --- |
| ETA survives reload and arrival is not delivery | `operations.test.tsx` remounts Routes, observes a second event GET and changed absolute server ETA; route-event DB tests cover restart persistence |
| Removal becomes authoritative ungrouped | Lots waits for `GET /parcels/:id/lot-membership === null`; component test exercises the keyboard button |
| Bulk partial retry | Existing `parcel-bulk.test.tsx` covers retained failures, refreshed versions, exact uncertain retry and scope disposal |
| No foreign cache after scope switch | Existing operator/data-access/bulk scope-race tests cover A → B → late A → fresh A |
| Ledger refresh | Packages component test records collection and requires at least two payment GETs before `settled` |
| Controlled offline/stale/malformed behavior | API client/command tests plus PostgreSQL version/conflict suites; no optimistic local mutation exists |
| No OTP/delivered bypass | Packages and Routes component assertions plus production import/marker build gate |
| Accessible honest Dashboard | Component test covers announced loading, empty state, numeric navigation cards; labels state bounded pages |
| Tenancy and role denial | Existing database tests for parcels/lots/routes/payments/e-way exercise B/C, nested IDs and all-role matrices |
| E-way semantics | Adapter/component tests cover redacted response, short reference, unverified language, distinct official/estimate states and exact label |
| Production/demo isolation | Planning inventory and `scripts/web-isolation.test.mjs`; explicit demo build below |

## Reproducible synthetic scenario

The guarded `apps/api/test/counter-demo.ts` fixture now prepares the Lots, Routes, Payments,
Receipts and E-way runtime grants and gives one fictional actor operator access to A/B plus
franchise-admin and dispatcher grants in A, enough to perform the UI path.
It refuses to run unless `NODE_ENV=test` and `TEST_DATABASE_IDENTITY=db_test`, prints no token,
and delays A customer search by 2.5 seconds for the scope-race check.

```bash
pnpm db:local exec node --experimental-strip-types apps/api/test/counter-demo.ts
pnpm --filter @shippingco/web dev
# open http://localhost:3033/_fixture/session
```

In A, create at least two fictional bookings/parcels, create a Lot, add one Parcel, create a
Route, attach the Lot and the other Parcel, inspect the deduplicated manifest, finalize,
depart as dispatcher, record an absolute delay and note the returned ETA. Reload/remount and
confirm the same server ETA. In a separate pre-dispatch Lot, remove an eligible Parcel and
wait for the server-confirmed ungrouped message. Use two sessions to provoke a stale version;
run a bulk check-in with one stale item, refresh and deliberately retry it. Record To-Pay and
wait for the fresh outstanding projection. Capture a fictional external e-way reference such
as `AB-7` and confirm it remains unverified. During the delayed A request switch to B, then
back to A; no old A payload may appear. Use existing DB cases for unrelated C, foreign nested
IDs and read-only writes. Inspect browser/API/log output for tokens, OTPs, raw addresses and
request bodies.

This branch automates the adapter/component assertions and the backend suites automate the
durable/tenant portions. A manual localhost smoke pass authenticated through this fixture and
verified the complete production navigation plus the Workspace bounded summaries, Packages
server row, Lots and Routes empty states, and E-way reminder projection. The longer mutation,
conflict and cross-tenant paths above remain reproducible manual aids and automated evidence;
this document does not claim that every browser step was manually executed.

## Verification results

Pinned tools are Node 22.23.2, pnpm 10.34.5 and Python 3.12.14. Final result counts are
recorded after the branch's final verification run.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS; lockfile current, no install changes |
| `pnpm check:migrations` | PASS; 21 released migrations unchanged |
| `pnpm db:local quality` | PASS: 26 quality tests, 22 testkit, 12 DB unit, 419 API, 148 web, 3 object-store, and 58 DB + 234 DB/API PostgreSQL tests (922 total), zero failed/skipped/cancelled/todo; production build 101 modules. |
| `VITE_DATA_MODE=demo pnpm --filter @shippingco/web exec vite build --outDir /tmp/shipit34-demo-dist` | PASS; 1,929 modules, isolated output |
| `git diff --check` | PASS |

Warnings were non-failing and identified: unchanged fictional-demo tests emit React `act()`
notices; the S3 SDK prints a non-retryable stream message during intentional corrupt/aborted
upload cases; Vite notes that the explicit temporary demo output is outside the project root.

`pnpm db:local verify:gates` is intentionally not required: #34 changes neither the gate
implementation nor production/demo isolation enforcement. The normal production isolation
test still runs inside quality.

## Rollout, rollback and limits

Deploy the compatible web artifact after the existing migrations/runtime grants from the
owning domains and current API are healthy. No migration is added. Roll back by deploying the
prior API-backed web artifact; never switch production to demo or import browser JSON.

Delivery completion/proof, messaging/automation, Reports, provider verification and legal
e-way policy approval remain their owning downstream work. Dashboard APIs do not expose
global totals, so cards intentionally show bounded loaded-page values. Historical/current
manifest lists remain cursor-bounded.
