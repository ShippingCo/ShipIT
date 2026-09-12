# Prototype behavior and regression inventory

[Migration contract](frontend-migration-contract.md) · [Machine-readable evidence](fixtures/prototype-migration.json)

Baseline: main `36ce6d3` (Issue #6 merged by PR #89). Prototype v0 is complete.
This inventory describes existing code and future responsibilities, not implemented APIs.

## Behavior decisions

### demo

- Decision: **demo_only**. Owners: #18, #75.
- Today: Global mutable browser database, seed/reset/load, local counters and persona selection.
- Target: Fictional adapter only; production cannot import it or expose reset; separate storage and environment.
- Required evidence: Production entry graph excludes demo mutations; reset has zero production I/O; no automatic legacy import.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [frontend-migration-contract.md](frontend-migration-contract.md).

### seam

- Decision: **replace**. Owners: #13, #17, #18.
- Today: AppProvider subscribes to the complete mutable database and the shell exposes prototype screens.
- Target: Domain-specific async interfaces, scope-keyed caches and separate production/demo composition; unavailable workflows stay unavailable.
- Required evidence: Production graph has no demo initializer; logout/scope generation discards late responses and recovery cannot cross users.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [frontend-migration-contract.md](frontend-migration-contract.md), [authorization-contract.md](authorization-contract.md).

### presentation

- Decision: **preserve**. Owners: #18, #33, #34.
- Today: Money/phone/date labels, escaping and display constants are mixed with the store.
- Target: Extract only browser-safe presentation helpers when a consumer migrates; preserve accessible layout and escaping; UTC instants use approved Kolkata display.
- Required evidence: User-visible formatting/escaping and keyboard/print regressions; pure helpers cannot import mutable store.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [frontend-migration-contract.md](frontend-migration-contract.md).

### customers

- Decision: **replace**. Owners: #19, #23, #33.
- Today: Phone lookup scans all browser bookings; customer identities and shipment parties are conflated.
- Target: Own-franchise customer query and explicit sender/recipient snapshots; phone/docket is a selector, never identity.
- Required evidence: Own-franchise lookup permitted; sibling directory and unrelated organization denied; preserve optional repeat-fill without overwriting entered fields.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [domain-contract.md](domain-contract.md), [authorization-contract.md](authorization-contract.md).

### booking

- Decision: **replace**. Owners: #22, #23, #30, #33.
- Today: One browser record combines Booking/Parcel and local docket allocation; synchronous save reports message sent.
- Target: One Booking with one or more Parcels, globally allocated child dockets, atomic server facts and optional issued receipt retrieval; messaging outcome separate.
- Required evidence: One booking/all children after timeout retry and reload; no partial commit; no automatic print; notification outage leaves saved booking intact.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [domain-contract.md](domain-contract.md), [idempotency-contract.md](idempotency-contract.md).

### pricing

- Decision: **replace**. Owners: #8, #20, #21, #33.
- Today: City heuristics, floating-point tax, default GST mode and unknown-city intra-state fallback.
- Target: Server-approved rate/jurisdiction snapshots, paise and one final rounding adjustment; unresolved tax and unknown ETA stay explicit.
- Required evidence: Unknown jurisdiction cannot silently produce a tax decision; preserve suggestion/variance UX; approved snapshot totals reconcile.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [domain-contract.md](domain-contract.md).

### parcels

- Decision: **replace**. Owners: #23, #24, #25, #34.
- Today: Arbitrary status changes, simple STATUS_FLOW and browser timeline.
- Target: Typed authorized commands and current versions; canonical lifecycle, ownership/custody and safe projections.
- Required evidence: No booked-to-dispatched shortcut; wrong actor/scope/stale revision denied; query/replay cannot reveal foreign data.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [parcel-lifecycle.md](parcel-lifecycle.md), [authorization-contract.md](authorization-contract.md), [idempotency-contract.md](idempotency-contract.md).

### proof

- Decision: **replace**. Owners: #8, #42, #43.
- Today: Browser OTP generation/verification/reveal and unrestricted delivered confirmation.
- Target: Deliveries performs atomic verify-and-complete for assigned agent; no public OTP/verifier/reveal; policy values remain #8/#42.
- Required evidence: Wrong/expired/replayed proof and concurrent completion; no plaintext proof in DTO/cache/log; delivery does not settle payment.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [parcel-lifecycle.md](parcel-lifecycle.md), [authorization-contract.md](authorization-contract.md).

### recovery

- Decision: **replace**. Owners: #8, #24, #42, #66.
- Today: Three-attempt and 72-hour browser recovery assumptions.
- Target: Two physical attempts maximum; two approved business dates for office collection; admin-approved RTO; immutable reversal history.
- Required evidence: Fake-clock deadline boundaries, missing calendar blocked, no retry resets, no automatic RTO approval.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [parcel-lifecycle.md](parcel-lifecycle.md).

### lots

- Decision: **replace**. Owners: #26, #27, #34.
- Today: Lot membership refers to bookings; deletion automatically clears memberships and route references.
- Target: Parcel membership; preserve safe removal workflow under W04/W06; empty/unexecuted and no blocking history; archival details owned by #26/#27.
- Required evidence: Authorized removal of eligible membership; denied non-admin destruction and active/referenced deletion; no lost parcel or route history.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [authorization-contract.md](authorization-contract.md), [domain-contract.md](domain-contract.md).

### routes

- Decision: **replace**. Owners: #27, #28, #34, #41.
- Today: Union of direct/lot bookings deduplicated; title-derived state and repeated additive ETA effects.
- Target: Typed events with frozen unique eligible Parcel set, bounded atomic ETA/state effects; notification fanout after commit.
- Required evidence: Direct-plus-lot overlap affects once; repeated command changes ETA once; delivered/RTO excluded; reminder never shifts ETA.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [parcel-lifecycle.md](parcel-lifecycle.md), [idempotency-contract.md](idempotency-contract.md).

### payments

- Decision: **replace**. Owners: #8, #29, #33, #34, #63.
- Today: Mutable paid/settled booleans and browser To-Pay summaries.
- Target: Independent append-only payment facts and derived settlement in paise; no delivery-driven collection.
- Required evidence: Concurrent/retried collection singular; original receipt/ledger facts retained; gross collectible totals reconcile.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [domain-contract.md](domain-contract.md), [idempotency-contract.md](idempotency-contract.md).

### messaging

- Decision: **replace**. Owners: #35, #36, #37, #38, #39, #40, #41, #44.
- Today: Browser queueMsg and read/seen markers simulate outbound transport.
- Target: Committed outbox, worker/provider outcomes, consent at send time and honest pending/accepted/delivered/uncertain states; no client send authority.
- Required evidence: Outage after booking, replay fanout, revoked consent, duplicate callbacks; one logical intent does not claim exactly-once external delivery.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [idempotency-contract.md](idempotency-contract.md), [event-contract.md](event-contract.md).

### assistant

- Decision: **replace**. Owners: #46, #47, #48, #49, #50, #51, #52.
- Today: Phone persona, direct chat/consent mutations and deterministic bot replies from the global store.
- Target: Verified customer context and scoped deterministic tools; demo persona remains fictional; language interpretation has no operational authority.
- Required evidence: Foreign docket denied; consent checked; no invented ETA/price/confirmed pickup; escalation reflects actual acceptance.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [authorization-contract.md](authorization-contract.md), [0003-server-authority-and-tenant-enforcement.md](../adr/0003-server-authority-and-tenant-enforcement.md).

### settings

- Decision: **replace**. Owners: #17, #66.
- Today: One Business object accepts arbitrary patch and drives historical output.
- Target: Scoped versioned settings with allowed admin commands; issued receipts/prices remain immutable.
- Required evidence: Unauthorized changes denied; old receipt unchanged after branding/tax setting edit; cache purged on scope change.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [authorization-contract.md](authorization-contract.md), [domain-contract.md](domain-contract.md).

### reports

- Decision: **replace**. Owners: #61, #62, #63, #64, #65, #67.
- Today: Browser totals, full-row exports and inclusive/browser-local date boundaries.
- Target: Scoped server queries and safe exports using Kolkata half-open ranges and ledger/snapshot reconciliation.
- Required evidence: Filtered totals and CSV agree; formula-safe export; read_only export denial follows matrix; boundary and foreign-scope tests.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [domain-contract.md](domain-contract.md), [authorization-contract.md](authorization-contract.md).

### eway

- Decision: **replace**. Owners: #8, #32, #34, #67.
- Today: Browser threshold/distance timer presented as e-way validity.
- Target: Externally issued record with provenance; estimates distinguished from official validity; law/coverage owned by #8/#32.
- Required evidence: Preserve separate navigation and vehicle entry; no browser timer asserted as government validity; unknown policy blocked.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [domain-contract.md](domain-contract.md).

### receipts

- Decision: **replace**. Owners: #30, #33.
- Today: Receipt reads mutable booking/business and recomputes ETA at print time.
- Target: Preserve optional print/layout/escaping using an authorized immutable issued snapshot.
- Required evidence: No automatic print; reprint content stable after settings/time changes; denied foreign receipt.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [domain-contract.md](domain-contract.md), [authorization-contract.md](authorization-contract.md).

### attachments

- Decision: **replace**. Owners: #31, #33, #42, #72.
- Today: Image helper and picker create inline browser data URLs.
- Target: Private validated/quarantined storage with scoped attachment references and approved retention; input UX retained.
- Required evidence: Foreign download denied; rejected upload cannot become usable attachment; logout drops object URLs and previews.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [security-threat-model.md](security-threat-model.md), [authorization-contract.md](authorization-contract.md).

## Every store export and Store member

`load` is reachable through `Store` even though it is not a named export. Constants and public helpers are included. A group decision covers its listed symbols; no export is implicitly approved for production.

| Symbol | Decision group |
| --- | --- |
| CITIES | presentation |
| DEFAULT_BUSINESS | demo |
| EWAY_KM_PER_DAY | eway |
| EWAY_THRESHOLD | eway |
| EXCEPTION_STATUSES | parcels |
| FAILURE_REASONS | parcels |
| GST_MODES | pricing |
| MAX_ATTEMPTS | recovery |
| OTP_MAX_ATTEMPTS | proof |
| RTO_WINDOW_HOURS | recovery |
| STATE_OF_CITY | pricing |
| STATUS_FLOW | parcels |
| STATUS_LABEL | presentation |
| Store | demo |
| activeDelayFor | routes |
| addBooking | booking |
| allCustomers | customers |
| assignToLot | lots |
| attachToRoute | routes |
| bookingsByPhone | customers |
| bookingsOfLot | lots |
| bookingsOfRoute | routes |
| confirmDelivered | proof |
| createLot | lots |
| createRoute | routes |
| db | demo |
| deleteLot | lots |
| esc | presentation |
| estimateEtaDays | pricing |
| ewayList | eway |
| ewayState | eway |
| ewayValidDays | eway |
| financialYear | reports |
| findBooking | booking |
| findByDocket | booking |
| fmtDT | presentation |
| fmtMoney | presentation |
| getSnapshot | demo |
| grossOf | payments |
| gstRate | pricing |
| load | demo |
| logBotTurn | assistant |
| lotById | lots |
| markAllBizSeen | messaging |
| markFailedAttempt | parcels |
| markRTO | parcels |
| nextDocket | demo |
| normPhone | presentation |
| openEscalations | assistant |
| peekDocket | demo |
| pendingDestinations | lots |
| placeOfSupply | pricing |
| postRouteEvent | routes |
| prettyPhone | presentation |
| queueMsg | messaging |
| reachSummary | messaging |
| recordPayment | payments |
| recoveryQueue | recovery |
| replyWindow | messaging |
| reportFor | reports |
| resendDelayAlert | messaging |
| resendDeliveryOTP | proof |
| resetDemo | demo |
| resolveEscalation | assistant |
| revealOTP | proof |
| routeById | routes |
| routeOfLot | routes |
| save | demo |
| setEwayBill | eway |
| stateOfCity | pricing |
| subscribe | demo |
| suggestFreight | pricing |
| taxOn | pricing |
| toPaySummary | payments |
| uid | demo |
| ungroupedParcels | lots |
| updateBusiness | settings |
| updateStatus | parcels |
| verifyDeliveryOTP | proof |
| waFmt | presentation |

## Direct and transitive callers

The JSON evidence also records resolved import declarations. Full-file fingerprints catch changed alias mutations and callback bodies. Review changed files before updating evidence; the scanner does not prove arbitrary data-flow safety.

| File | Decision groups |
| --- | --- |
| apps/web/src/App.tsx | seam |
| apps/web/src/components/CommandPalette.tsx | presentation |
| apps/web/src/components/m3/Journey.tsx | presentation |
| apps/web/src/context/AppContext.tsx | seam |
| apps/web/src/data/bot.ts | assistant, messaging, demo |
| apps/web/src/data/store.ts | demo, seam, presentation, customers, booking, pricing, parcels, proof, recovery, lots, routes, payments, messaging, assistant, settings, reports, eway, receipts, attachments |
| apps/web/src/main.tsx | seam |
| apps/web/src/pages/CustomerWhatsApp.tsx | assistant, messaging, demo |
| apps/web/src/pages/Launcher.tsx | demo |
| apps/web/src/pages/business/DemoBusinessShell.tsx | demo, seam |
| apps/web/src/pages/business/Dashboard.tsx | reports, routes, payments, recovery |
| apps/web/src/pages/business/EwayPage.tsx | eway |
| apps/web/src/pages/business/LotsPage.tsx | lots, messaging |
| apps/web/src/pages/business/MiscPages.tsx | settings, receipts, messaging, assistant |
| apps/web/src/pages/business/NewBookingPage.tsx | booking, customers, pricing, attachments, receipts |
| apps/web/src/pages/business/PackagesPage.tsx | parcels, proof, payments, lots, recovery |
| apps/web/src/pages/business/ReportsPage.tsx | reports |
| apps/web/src/pages/business/RoutesPage.tsx | routes, messaging |
| apps/web/src/test/app.test.tsx | demo, booking, proof, routes, reports, eway |
| apps/web/src/test/setup.ts | demo, booking, proof, routes, reports, eway |
| apps/web/src/utils/receipt.ts | receipts |

## Existing regression declarations

Parameterized cases are preserved in full in JSON. Tests remain unchanged during this planning issue. A replacement means adding future server evidence, not deleting the current demo test now.

| File and test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/app.test.tsx: store seeds itself before first render even with empty localStorage | demo_only | demo |
| apps/web/src/test/app.test.tsx: heals corrupted persisted state | demo_only | demo |
| apps/web/src/test/app.test.tsx: renders both entry cards | demo_only | demo |
| apps/web/src/test/app.test.tsx: renders the three headline numbers, dispatch board and ledger | replace | reports |
| apps/web/src/test/app.test.tsx: route %s renders | preserve | presentation |
| apps/web/src/test/app.test.tsx: creates a booking; packages list updates live | replace | booking |
| apps/web/src/test/app.test.tsx: advances status reactively inside open dialog; verifies delivery OTP | replace | proof |
| apps/web/src/test/app.test.tsx: creates a lot via dialog | replace | lots |
| apps/web/src/test/app.test.tsx: reports delay from UI; affected customers notified | replace | routes |
| apps/web/src/test/app.test.tsx: depart event cascades parcel statuses + notifications | replace | routes |
| apps/web/src/test/app.test.tsx: lists queued outbound messages | replace | messaging |
| apps/web/src/test/app.test.tsx: persona auto-selected, bot replies, proactive outbox lands in chat | replace | assistant |
| apps/web/src/test/app.test.tsx: splits CGST + SGST intra-state and charges IGST inter-state | replace | pricing |
| apps/web/src/test/app.test.tsx: e-way record stores Part-B vehicle and validity by distance | replace | eway |
| apps/web/src/test/lint-regressions.test.tsx: can change between empty and populated series without changing hook order | preserve | presentation |

## Required synthetic walkthroughs

These are reviewable expected outcomes, not executable API or database tests.

### S01

- Given: Fictional authorized A1 operator and one customer with two parcel inputs.
- Action: Submit booking, lose response, retry same key/body, reload.
- Expected: One Booking and two child dockets; server result recovered, optional print only; never a local booking.
- Owner and governing rule: booking group above.

### S02

- Given: A1 customer shares phone text with A2 customer.
- Action: A1 operator requests repeat lookup.
- Expected: Only A1 relationship suggested; B1 and sibling directory requests denied; phone is not identity.
- Owner and governing rule: customers group above.

### S03

- Given: Issued receipt and explicit print choice.
- Action: Advance clock and change current settings, then reprint.
- Expected: Original issued facts retained; no auto-print on create or retry; no foreign receipt access.
- Owner and governing rule: receipts group above.

### S04

- Given: Empty/unexecuted lot with no blocking references and separate active lot.
- Action: Authorized admin removes eligible lot; operator attempts destruction of active lot.
- Expected: Eligible removal succeeds safely; active/non-admin destruction denied; W04 membership removal distinct from W06.
- Owner and governing rule: lots group above.

### S05

- Given: Parcel P appears directly and through a lot; Q is delivered and R is RTO; P ETA at fake instant t.
- Action: Submit one four-hour delay twice with same command identity.
- Expected: P ETA t+4h once; Q/R unchanged; one logical notification intent; new reminder does not shift ETA.
- Owner and governing rule: routes group above.

### S06

- Given: Production API unreachable and booking form populated.
- Action: Submit or reload with uncertain prior submission.
- Expected: No local success, seeding or fallback; same intent reconciled; unresolved result blocks new automatic command.
- Owner and governing rule: booking group above.

### S07

- Given: Assigned delivery agent with active fictional challenge reference.
- Action: Submit proof and concurrently replay, without storing plaintext fixture proof.
- Expected: One server completion; no OTP/verifier in public DTO/cache/log and no payment side effect.
- Owner and governing rule: proof group above.

### S08

- Given: Unknown destination jurisdiction and incomplete approved policy.
- Action: Request final quote.
- Expected: Explicit validation/policy blocker, never silent intra-state/default freight or invented ETA.
- Owner and governing rule: pricing group above.

### S09

- Given: Production dependency graph and separately isolated demo.
- Action: Attempt reset or legacy browser import in production.
- Expected: No production reset capability or automatic import; demo reset only changes fictional state.
- Owner and governing rule: demo group above.

### S10

- Given: Request for A1 outstanding when actor switches to A2 or logs out.
- Action: Old response arrives after cache purge.
- Expected: Old response discarded using scope generation; old lists, receipt previews and object URLs stay cleared.
- Owner and governing rule: customers group above.

### S11

- Given: Booking committed with outbox fact; provider unavailable or acceptance uncertain.
- Action: Process notification and retry/reconcile.
- Expected: Booking remains saved; message pending/failed/uncertain shown truthfully; no blind uncertain resend.
- Owner and governing rule: messaging group above.

### S12

- Given: Org A administrator, franchise staff, read_only, and unrelated B1; fake Kolkata boundary instants.
- Action: Read permitted projections and request exports.
- Expected: Only explicitly allowed own-org/own-franchise projections; export roles enforced; half-open totals reconcile without mutations.
- Owner and governing rule: reports group above.


## Issue #17 production cutover evidence

The original shell is preserved in DemoBusinessShell and AppProvider is mounted only
by DemoApp. App chooses production unless an explicit demo build is selected. The
static inventory follows the lazy demo import conservatively; that reachability does
not mean the production branch initializes it. New production tests intentionally
seed hostile browser storage to prove it is ignored. Session storage holds only a
pending onboarding request key/body; it is never a fallback workspace or session.

| Caller | Groups |
| --- | --- |
| apps/web/src/DemoApp.tsx | demo, seam |
| apps/web/src/test/operator.test.tsx | seam |

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/operator.test.tsx: completes onboarding, sends only approved fields and reloads server context without browser authority | preserve | seam |
| apps/web/src/test/operator.test.tsx: associates required validation with focusable inputs and completes a form submit | preserve | seam |
| apps/web/src/test/operator.test.tsx: lists only server scopes and clears the old shell immediately while switching | preserve | seam |
| apps/web/src/test/operator.test.tsx: late A response cannot paint after B, even when transport ignores cancellation | preserve | seam |
| apps/web/src/test/operator.test.tsx: protected navigation after revocation removes cached data and offers controlled recovery | preserve | seam |
| apps/web/src/test/operator.test.tsx: a denied scoped action clears context and a late previous request cannot restore it | preserve | seam |
| apps/web/src/test/operator.test.tsx: uncertain onboarding preserves the exact request key and body over remount | preserve | seam |
| apps/web/src/test/operator.test.tsx: committed onboarding followed by context failure recovers from server state without a second create | preserve | seam |
| apps/web/src/test/operator.test.tsx: accepts through the existing invitation API and never stores the secret | preserve | seam |
| apps/web/src/test/operator.test.tsx: failed invitation acceptance preserves controlled recovery | preserve | seam |
| apps/web/src/test/operator.test.tsx: authenticates through existing challenge routes and safely signs out | preserve | seam |
| apps/web/src/test/operator.test.tsx: does not fall back to localStorage on an API outage | preserve | seam |
| apps/web/src/test/operator.test.tsx: an invitation response after navigation refreshes the current route instead of stranding loading | preserve | seam |


## Issue 18 reviewed boundary evidence

The active fictional namespace is now explicit; historical JSON stays untouched and is not imported.
Shared test setup no longer imports or seeds demo state. The original fictional regressions
remain, while production composition and generalized client/cache/command tests are separate.
The build checks rendered module paths and forbidden markers before single-file assembly.
See [production data access](production-data-access.md) and [verification](issue-18-verification.md).

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/app.test.tsx: resets fictional data with zero API, auth or provider traffic and leaves legacy data untouched | demo_only | demo |
| apps/web/src/test/data-access.test.ts: defaults to production and accepts only explicit demo or safe canonical API origins | preserve | seam |
| apps/web/src/test/data-access.test.ts: rejects unsafe or noncanonical API base %s without echoing it | preserve | seam |
| apps/web/src/test/data-access.test.ts: rejects unknown public settings, invalid mode/version and configured demo API | preserve | seam |
| apps/web/src/test/data-access.test.ts: uses configured routing, credentials, no-store, no redirects, CSRF and exact mutation key | preserve | seam |
| apps/web/src/test/data-access.test.ts: reads without bootstrap and supports approved future methods and 204 | preserve | seam |
| apps/web/src/test/data-access.test.ts: projects only known code, server correlation and declared validation fields | preserve | seam |
| apps/web/src/test/data-access.test.ts: handles non-JSON HTTP %s without raw response leakage | preserve | seam |
| apps/web/src/test/data-access.test.ts: classifies mutation HTTP %s %s as %s without replay | preserve | seam |
| apps/web/src/test/data-access.test.ts: sanitizes network exceptions and malformed successes without manufacturing committed results | preserve | seam |
| apps/web/src/test/data-access.test.ts: cancellation during ignored bootstrap prevents sending the mutation; after dispatch remains uncertain | preserve | seam |
| apps/web/src/test/data-access.test.ts: never sends to an arbitrary destination or continues after invalid bootstrap | preserve | seam |
| apps/web/src/test/data-access.test.ts: purges cache/cleanup before B and revisited A; rejects ignored cancellation and stale same-query results | preserve | seam |
| apps/web/src/test/data-access.test.ts: isolates identity/permission changes and rejects late errors from an old scope | preserve | seam |
| apps/web/src/test/data-access.test.ts: retries exact intent after uncertainty but refuses replay after identity/scope generation changes | preserve | seam |
| apps/web/src/test/data-access.test.ts: never publishes a command result after scope changes and enforces expected-version consistency | preserve | seam |
| apps/web/src/test/data-access.test.ts: broadcasts only payload-free invalidation and closes its channel; missing channel needs no storage fallback | preserve | seam |
| apps/web/src/test/operator.test.tsx: production startup ignores URL/storage demo flags and never initializes fictional state | preserve | seam |
| apps/web/src/test/operator.test.tsx: 401 during a mutation purges workspace and requires sign-in without replay or request loops | preserve | seam |
| apps/web/src/test/operator.test.tsx: 401 on private cached work erases cache/context and late work cannot restore it | preserve | seam |
| apps/web/src/test/operator.test.tsx: logout hides private data immediately and late context cannot repaint | preserve | seam |
| apps/web/src/test/operator.test.tsx: revisiting A from B shows loading until fresh authorized retrieval | preserve | seam |
| apps/web/src/test/operator.test.tsx: cross-tab invalidation immediately removes old context and revalidates without echo loops | preserve | seam |
| apps/web/src/test/operator.test.tsx: sign-in works under Strict Mode effect replay | preserve | seam |
| apps/web/src/test/operator.test.tsx: malformed successful context becomes controlled recovery without private fields | preserve | seam |
