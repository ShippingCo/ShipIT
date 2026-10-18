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
- Today: Pure server ReceiptDto renderer and explicit print action; fictional demo pages use a separate demo adapter. No print-time ETA, arbitrary logo URL or false Total paid label.
- Target: Preserve optional print/layout/escaping using an authorized immutable issued snapshot.
- Required evidence: No automatic print; reprint content stable after settings/time changes; denied foreign receipt.
- Retirement: Owning implementation has passing API, scope, failure and browser evidence; all production callers use the approved boundary. Retain fictional tests only in demo.
- Authority: [domain-contract.md](domain-contract.md), [authorization-contract.md](authorization-contract.md).

### attachments

- Decision: **replace**. Owners: #31, #33, #42, #72.
- Today: Fictional demo picker/logo use demo-image data URLs. Production attachment adapter/uploader retain server metadata and ephemeral Blob previews; image.ts returns a Blob.
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
| apps/web/src/utils/demo-receipt.ts | receipts |

## Existing regression declarations

Parameterized cases are preserved in full in JSON. Tests remain unchanged during this planning issue. A replacement means adding future server evidence, not deleting the current demo test now.

| File and test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/agent-settlement-workspace.test.tsx: keeps source-owned cash, seller liability and fees separate and rejects mismatched source frames or totals | preserve | reports |
| apps/web/src/test/agent-settlement-workspace.test.tsx: captures first, separately submits exact evidence and recovers a lost submission without a new key | preserve | reports |
| apps/web/src/test/agent-settlement-workspace.test.tsx: shows immutable sources before different-admin review and records only an explicit decision | preserve | reports |
| apps/web/src/test/agent-settlement-workspace.test.tsx: preserves departed-agent correction identity and clears private evidence on scope loss | preserve | reports |
| apps/web/src/test/agent-settlement-workspace.test.tsx: keeps accountant evidence read-only and prevents a submitting administrator from approving their revision | preserve | reports |
| apps/web/src/test/agent-statements.test.ts: projects paged private headers and rejects impossible cutoffs, duplicate IDs and broken revision links | preserve | reports |
| apps/web/src/test/agent-statements.test.ts: retains exact immutable intent and key after a lost response and refuses a new derived revision or actor | preserve | reports |
| apps/web/src/test/agent-statements.test.ts: binds review outcome to the exact selected submission, reviewer, version and saved reason | preserve | reports |
| apps/web/src/test/app.test.tsx: store seeds itself before first render even with empty localStorage | demo_only | demo |
| apps/web/src/test/app.test.tsx: heals corrupted persisted state | demo_only | demo |
| apps/web/src/test/app.test.tsx: renders both entry cards | demo_only | demo |
| apps/web/src/test/app.test.tsx: awaits native hash navigation, including repeated destinations and return to launcher | preserve | presentation |
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

## Issue #25 reviewed inventory change

The fictional PackagesPage bulk toast reports only state, removing its notification claim.
BulkParcelPanel subscribes to the production scope-owned controller with useSyncExternalStore;
the explicit browser test fixture uses a synthetic delayed transport. No store authority or
prototype safety disposition changes. Added regression declarations:

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/parcel-bulk.test.tsx: retains only unsuccessful selection, refreshes before retry, sends B/C only and preserves A success | preserve | seam |
| apps/web/src/test/parcel-bulk.test.tsx: network loss preserves exact immutable body, outer/item keys, versions and acting scope | preserve | seam |
| apps/web/src/test/parcel-bulk.test.tsx: scope switch aborts/discards late results and purges selection/private results, including repeated scope generations | preserve | seam |
| apps/web/src/test/parcel-bulk.test.tsx: keyboard-reachable selection/action/retry, disabled pending state and live textual partial results | preserve | seam |
| apps/web/src/test/parcel-bulk.test.tsx: malformed/partial/foreign success DTO cannot fabricate completion or expose extra fields | preserve | seam |
| apps/web/src/test/parcel-bulk.test.tsx: refresher cannot reinsert successful A and unavailable failures remain represented when omitted | preserve | seam |
| apps/web/src/test/parcel-bulk.test.tsx: explicit demo composition refuses the production bulk adapter without contacting any endpoint | preserve | seam |
| apps/web/src/test/parcel-bulk.test.tsx: same outer adapter intent is a frozen snapshot and 503 retains command identity | preserve | seam |
| apps/web/src/test/parcel-bulk.test.tsx: refresh authentication denial purges the prior private selection and result | preserve | seam |

## Issue #26 lot authority disposition

Production createLot/deleteLot/assignToLot behavior is replaced by the [lot API](lots.md),
not imported from store.ts. The fictional LotsPage remains behind demo composition; #34 owns
its complete cutover. Its optional incompatible-destination selection is intentionally
rejected by production with LOT_DESTINATION_MISMATCH; destructive prototype deletion is
intentionally archive in production. Message lot remains fictional/deferred, with no provider
call or new frontend test disposition. Existing hooks exceptions and prototype tests remain.

## Issue #27 production Route replacement evidence

The routes group now has server authority for metadata, typed Route/Lot and direct Parcel associations, immutable deduplicated manifests, archive/finalize, Lot guards and authoritative T03. [Routes](routes.md) replaces browser bookingIds/lotIds authority with physical Parcel snapshots and exact provenance. Carrier code remains inert. RoutesPage/store/postRouteEvent tests remain fictional and unchanged; #28 owns operational events/ETA, #34 owns screen cutover and #35/#41 own downstream processing. No browser import or fallback was introduced.

## Issue #30 reviewed receipt boundary

The production renderer no longer transitively imports the demo store. Demo receipt callers
explicitly import demo-receipt.ts; only that adapter reads browser bookings/business. The
reviewed inventory removes the print cleanup timer and historical moving ETA. No unrelated
prototype business behavior changes.

| Regression | Disposition | Group | Reason |
| --- | --- | --- | --- |
| apps/web/src/test/app.test.tsx: cancelled reprint preserves the saved booking, payments and outbox | demo_only | receipts | Issue #30: escaped issued DTO presentation, exact paise, entry-only semantics, explicit print and cancellation cleanup. Demo state remains fictional; #33 owns production screens. |
| apps/web/src/test/receipt.test.tsx: renders booked paise and saved rounding without settlement or a moving ETA | preserve | receipts | Issue #30: escaped issued DTO presentation, exact paise, entry-only semantics, explicit print and cancellation cleanup. Demo state remains fictional; #33 owns production screens. |
| apps/web/src/test/receipt.test.tsx: keeps partial collection and reversal entry labels separate from booked total and settlement | preserve | receipts | Issue #30: escaped issued DTO presentation, exact paise, entry-only semantics, explicit print and cancellation cleanup. Demo state remains fictional; #33 owns production screens. |
| apps/web/src/test/receipt.test.tsx: renders frozen receipt allocation evidence without a second cash inflow or private external reference | preserve | receipts | Issue #138: decode frozen source provenance, omit private references and label applied/released funds without recording another cash inflow. |
| apps/web/src/test/receipt.test.tsx: escapes every layout text context and ignores foreign download and executable logo URLs | preserve | receipts | Issue #30: escaped issued DTO presentation, exact paise, entry-only semantics, explicit print and cancellation cleanup. Demo state remains fictional; #33 owns production screens. |
| apps/web/src/test/receipt.test.tsx: prints only on explicit action; cancelled/no-op printing keeps source state and clears private DOM | preserve | receipts | Issue #30: escaped issued DTO presentation, exact paise, entry-only semantics, explicit print and cancellation cleanup. Demo state remains fictional; #33 owns production screens. |
| apps/web/src/test/receipt.test.tsx: cleans up private print markup even when browser print throws | preserve | receipts | Issue #30: escaped issued DTO presentation, exact paise, entry-only semantics, explicit print and cancellation cleanup. Demo state remains fictional; #33 owns production screens. |

## Issue #31 reviewed inventory change

Demo picker/logo imports now name the isolated demo-image helper; production image processing returns a Blob. No Store export, Store member, caller, route or existing regression was removed. New effects are abort listeners in bounded attachment transport/image preparation. New tests below protect the production seam; full screen migration remains #33. Fingerprints change only for these reviewed imports and image helper.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/attachments.test.tsx: selects, shows progress and pending scan, then retains only approved metadata | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: cancels in-flight bytes, revokes preview, and sends durable cancel | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: retries the same intent after network failure and announces unsafe responses without rendering bytes | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: purges and aborts previews on %s | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: validates selection and provides native keyboard buttons and associated async text | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: loads durable metadata and fetches bytes only on explicit preview | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: public metadata discards unsafe extra fields and rejects a forged ready result | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: XHR uses current CSRF/session, progress, abort and safe response projection | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: photo decoding errors and aborts revoke the temporary object URL | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: download adapter bounds bytes and rejects a foreign signed URL before sending credentials | preserve | attachments |
| apps/web/src/test/attachments.test.tsx: replacing the attachment client clears prior booking previews before the next list resolves | preserve | attachments |

## Issue #33 reviewed production composition

Production counter and receipt modules use the scope runtime and purpose-specific API adapters. No demo consumer or business authority moved into production. These added regressions cover real production App rendering with synthetic transport; the PostgreSQL walkthrough separately proves durable results.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/attachments.test.tsx: a booking attachment client cannot rebind to a newly selected franchise | preserve | attachments |
| apps/web/src/test/counter.test.tsx: creates approved wire commands, To Pay obligation, optional immutable printing and fresh receipt discovery | preserve | seam |
| apps/web/src/test/counter.test.tsx: double click and lost commit acknowledgement retain identical path/body/key with one displayed result | preserve | seam |
| apps/web/src/test/counter.test.tsx: network outage preserves draft and never fabricates a receipt or local booking | preserve | seam |
| apps/web/src/test/counter.test.tsx: rejects stale/forged commercial state, keeps edits and requires fresh reviewed evidence and new command identity | preserve | seam |
| apps/web/src/test/counter.test.tsx: discards late franchise A search at viewport %i through real scope generation | preserve | seam |
| apps/web/src/test/counter.test.tsx: repeat selection fills empty values while preserving deliberate edits | preserve | seam |
| apps/web/src/test/counter.test.tsx: Paid Now preserves the saved booking and directs actual collection to owned receipt evidence without a legacy write | preserve | seam |
| apps/web/src/test/counter.test.tsx: receipt outage has an independent retry and retains booking | preserve | seam |
| apps/web/src/test/counter.test.tsx: keyboard form submission focuses first invalid field and describes the error | preserve | seam |
| apps/web/src/test/counter.test.tsx: scope change cancels late %s and prevents private totals repaint | preserve | seam |
| apps/web/src/test/counter.test.tsx: scope change cancels late receipt and drops its private snapshot | preserve | seam |
| apps/web/src/test/counter.test.tsx: malformed successes fail safely and unknown private fields are projected out | preserve | seam |
| apps/web/src/test/counter.test.tsx: focus revalidation preserves draft for unchanged permissions; revocation purges actual generation | preserve | seam |
| apps/web/src/test/counter.test.tsx: handles safe %s without losing the draft or claiming success | preserve | seam |
| apps/web/src/test/counter.test.tsx: malformed committed response is uncertain and retry uses its original identity | preserve | seam |
| apps/web/src/test/counter.test.tsx: 401 purges private form and requires sign in without local fallback | preserve | seam |
| apps/web/src/test/counter.test.tsx: reload with an unresolved marker forbids fresh-key booking and contains no persisted body | preserve | seam |
| apps/web/src/test/counter.test.tsx: receipt discovery supports empty and safe denied/retry states | preserve | seam |

| Transitive test caller | Owners |
| --- | --- |
| apps/web/src/test/counter.test.tsx | seam |

| Additional regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/counter.test.tsx: scope switch during a dispatched booking retains opaque recovery and never replays under B | preserve | seam |

## Issue #34 production operational cutover

The production BusinessShell now routes Dashboard, Packages, Lots, Dispatch Routes and
E-way Bills to purpose-built API components. The prototype pages and browser Store remain
unchanged behind DemoBusinessShell. Production replaces local Package status/OTP actions
with guarded Parcel commands, Lot delete with archive, mutable payment flags with the
server ledger, local Route delay math with persisted Route events, and hard-coded e-way
assumptions with external observations plus server-evaluated states. Messaging claims,
delivery proof, Automation Feed and Reports remain demo-only/deferred. The newly inventoried
`useSyncExternalStore` effect is the existing bounded bulk controller subscribed from the
production Packages composition; it is disposed with the active component/scope.

| Issue #34 regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/operations.test.tsx: projects only safe delivery state and builds immutable proof commands without browser persistence | preserve | proof |
| apps/web/src/test/operations.test.tsx: projects parcel data, rejects malformed success and binds exact scoped command identity | preserve | parcels |
| apps/web/src/test/operations.test.tsx: builds versioned lot/route/e-way intents and accepts the restricted accountant e-way projection | preserve | eway |
| apps/web/src/test/operations.test.tsx: executes only the three exact canonical route-event identities and rejects a generic or mismatched operation | preserve | routes |
| apps/web/src/test/operations.test.tsx: shows assigned-only delivery work, submits recipient proof, clears it, and reloads canonical state | preserve | proof |
| apps/web/src/test/operations.test.tsx: round-trips Asia/Kolkata route inputs independently of the browser timezone and across a date boundary | preserve | routes |
| apps/web/src/test/operations.test.tsx: announces dashboard loading then renders bounded accessible cards and an honest empty result | preserve | seam |
| apps/web/src/test/operations.test.tsx: offers controlled dashboard retry after an API failure without local fallback | preserve | seam |
| apps/web/src/test/operations.test.tsx: uses guarded package actions and directs new money recording to receipt evidence without OTP or delivery bypasses | preserve | parcels |
| apps/web/src/test/operations.test.tsx: removes the exact lot membership with the keyboard-reachable action and confirms ungrouped from the server | preserve | lots |
| apps/web/src/test/operations.test.tsx: loads an authoritative active target lot and sends its server version in the move command | preserve | lots |
| apps/web/src/test/operations.test.tsx: refreshes source and target after a stale target conflict and requires a deliberate new submission | preserve | lots |
| apps/web/src/test/operations.test.tsx: keeps malformed and foreign target lots safely unavailable | preserve | lots |
| apps/web/src/test/operations.test.tsx: shows authoritative archived target details but prevents move submission | preserve | lots |
| apps/web/src/test/operations.test.tsx: shows a route instant as Kolkata wall time and preserves it when only metadata changes | preserve | routes |
| apps/web/src/test/operations.test.tsx: re-reads and displays the server ETA after a full route component remount without inferring parcel delivery | preserve | routes |
| apps/web/src/test/operations.test.tsx: separates official e-way validity and renders every immutable revision with a stable revision identity | preserve | eway |

## Issue #44 cutover evidence

Production Automation & Messages uses the [history projection](messaging-history.md), not
MiscPages or browser outbox/seen markers. The reviewed inventory refresh adds messaging adapter,
role, privacy, state, recovery, scope and accessibility regression declarations. It changes no
fictional Store export or caller ownership. The standalone messaging browser fixture contains
only fictional DTOs and is unreachable from production composition. There is no production
clear-history, reveal-OTP, local import or direct provider operation.

Issue #44 production projection joins provider-backed message/automation evidence; existing W44 redrive and W19 reminder commands remain authoritative. Demo queue/seen behavior remains fictional.

| Regression | Disposition | Owner |
| --- | --- | --- |
| apps/web/src/test/messaging.test.tsx: shows loading, truthful acceptance and immutable automation independently, then read after refresh | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: labels %s separately | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: shows empty/error/explicit retry without demo fallback | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: offers keyboard native filters and resets old cursors on filter changes | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: always redacts delivery verification content and strips unknown response fields before UI state | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: traps dialog focus, closes on Escape and restores trigger focus | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: operator cannot redrive even an erroneously offered recovery | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: refreshes version, requires uncertain warning, then preserves the exact W44 request after transport uncertainty | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: uses W19 for eligible route reminders, without redriving or modifying ETA | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: aborts old scope responses, rejects stale paint and purges on 401 | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: denies %s navigation and direct route | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: allows %s navigation | preserve | messaging |
| apps/web/src/test/messaging.test.tsx: rejects malformed successful status DTOs | preserve | messaging |

## Issue #49 reviewed production pickup regressions

These tests preserve server-owned pickup decisions, private detail loading, keyboard access and retry safety. Owner: #49 under the assistant group.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/pickups.test.tsx: loads private details only after selection; keyboard-accessible dialog restores focus | preserve | assistant |
| apps/web/src/test/pickups.test.tsx: shows empty and recoverable read errors | preserve | assistant |
| apps/web/src/test/pickups.test.tsx: retries the same uncertain decision and exposes saved state with failed messaging | preserve | assistant |
| apps/web/src/test/pickups.test.tsx: accepts only with a valid agreed window and explicit review, then shows the saved result | preserve | assistant |
| apps/web/src/test/pickups.test.tsx: shows a stale-version failure and read-only staff cannot act | preserve | assistant |

## Issue #50 support queue regression additions

These tests preserve scoped staff ownership, private notes, customer reply recovery and accessible case handling. Owner: #50 under the assistant group.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/support.test.tsx: loads private detail on selection and returns keyboard focus after close | preserve | assistant |
| apps/web/src/test/support.test.tsx: handles empty, loading and retriable read errors | preserve | assistant |
| apps/web/src/test/support.test.tsx: claims a case then shows owner reply and internal-note actions | preserve | assistant |
| apps/web/src/test/support.test.tsx: preserves an uncertain reply intent and exposes blocked delivery after retry | preserve | assistant |
| apps/web/src/test/support.test.tsx: keeps drafts after stale state and denies read-only staff mutation | preserve | assistant |
| apps/web/src/test/support.test.tsx: requires a reason to reopen a resolved case | preserve | assistant |
| apps/web/src/test/support.test.tsx: gives the support dialog an accessible name, handles Escape and restores keyboard focus | preserve | assistant |

## Issue #61 scoped report regression additions

Reports use the production scoped API and server snapshots. The new timer only revokes
a temporary download Blob URL; it schedules no financial or messaging effect.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/reports.test.tsx: keyboard form creates a snapshot and reloads its server totals with empty export | preserve | reports |
| apps/web/src/test/reports.test.tsx: reload keeps snapshot identity, denies export without grant and shows safe expiry errors | preserve | reports |
| apps/web/src/test/reports.test.tsx: an uncertain capture retries the same immutable request after editing the draft | preserve | reports |

## Issue #62 reviewed additions

Sales uses the scoped API seam. Its one-second object-URL cleanup timer holds only
export bytes, performs no network or storage write, and cannot change money.

| Test | Decision | Group |
| --- | --- | --- |
| apps/web/src/test/sales.test.tsx: creates through the labelled keyboard form, reloads saved filters, shows zero sales and requests the saved CSV | preserve | reports |
| apps/web/src/test/sales.test.tsx: retries the exact uncertain intent and denies exports for a read-only report grant | preserve | reports |

| apps/web/src/test/ageing.test.tsx: uses explicit age and status filters, restores saved evidence and exports the saved ID | preserve | reports |
| apps/web/src/test/ageing.test.tsx: keeps uncertain intent after edits and recovers expired reads without granting export | preserve | reports |

## Issue #64 reviewed delivery-performance additions

Delivery performance uses scoped server snapshots. Its one-second object-URL cleanup
only releases temporary export bytes and creates no operational side effects.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/performance.test.tsx: keyboard submit saves identity, reloads, displays empty denominator and exports matching selection | preserve | reports |
| apps/web/src/test/performance.test.tsx: reload errors expose retry, denied export remains disabled and uncertain capture reuses exact intent | preserve | reports |

## Issue #65 reviewed messaging/assistant additions

Production reporting captures bounded server aggregates, preserves unknown delivery
and suppression, and reloads saved identity with exact uncertain retries. No browser
counter or transcript becomes operational evidence.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/messaging-effectiveness.test.tsx: keyboard capture reloads identity and drills through aggregates while separating unknown delivery, thanks and queue policy | preserve | reports |
| apps/web/src/test/messaging-effectiveness.test.tsx: retries saved failures and reuses the exact uncertain capture while keeping filters disabled | preserve | reports |

## Issue #138 reviewed receipt workflow additions

Counter and package entry points now direct actual money recording to named receipt
evidence. Legacy server APIs and historical identities remain compatible. UI tests
use controlled transport fixtures; separate native tests prove financial persistence.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/money-receipts.test.tsx: retains the exact advance intent after a lost response and blocks replacement/navigation until same-key reconciliation | preserve | receipts |
| apps/web/src/test/money-receipts.test.tsx: records one receipt across two current bill versions and displays the residual advance | preserve | receipts |
| apps/web/src/test/money-receipts.test.tsx: applies an existing advance without recording another inflow | preserve | receipts |
| apps/web/src/test/money-receipts.test.tsx: uses the original allocation history for an admin release and keeps private finance evidence role-scoped | preserve | receipts |
| apps/web/src/test/money-receipts.test.tsx: configures a named other receiving method through an append-only administrator account revision | preserve | receipts |

## Issue #139 reviewed financial workflow additions

Production components use scoped server financial requests, current policy/source
versions and retained uncertain intent. Navigation guards and the audit download
cleanup timer hold UI state only; no local financial persistence is introduced.
Controlled transport UI tests complement real PostgreSQL service verification.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/financial-audit.test.ts: preserves exact uncertain capture intent and stops replay after scope changes | preserve | reports |
| apps/web/src/test/financial-audit.test.ts: projects only safe fields and rejects foreign scope, false control counts and broken source lineage | preserve | reports |
| apps/web/src/test/financial-audit.test.ts: binds saved detail and export to the requested snapshot and source row | preserve | reports |
| apps/web/src/test/financial-audit.test.ts: retains capture uncertainty and uses the saved snapshot for focused detail and matching CSV | preserve | reports |
| apps/web/src/test/financial-audit.test.ts: refuses a capture response for filters other than the retained command | preserve | reports |
| apps/web/src/test/financial-workflow.test.tsx: validates component reductions and retains an uncertain request across blocked navigation and same-key retry | preserve | reports |
| apps/web/src/test/financial-workflow.test.tsx: reviews server preview and reloads the original request after decision and application IDs | preserve | reports |
| apps/web/src/test/financial-workflow.test.tsx: records private actual refund evidence only for the approved refund and current source account revision | preserve | reports |
| apps/web/src/test/financial-workflow.test.tsx: keeps org admins and accountants read-only and treats disabled writes as controlled conflicts | preserve | reports |
| apps/web/src/test/financial-workflow.test.tsx: amends only the creator pending request with freshly loaded versions and retained source document links | preserve | reports |
| apps/web/src/test/financial-workflow.test.tsx: saves the explicit approved policy with exact uncertain replay without replacing the open financial request | preserve | reports |
| apps/web/src/test/financial-workflow.test.tsx: rejects foreign booking context and another creators own request instead of painting their fields | preserve | reports |


## Issue #140 reviewed cashbook and expense evidence additions

Cashbook uses current scoped services for requests, exact different-admin review,
application, corrections, custody and captured reports. Its external-store hook
and navigation listeners retain pending/uncertain intent; the source download
timer releases a private browser URL. These effects hold UI state only and do
not persist financial authority or silently import browser records. Thirty new
test declarations preserve these boundaries and private expense lifecycle recovery.
Existing callers, routes, exports, storage operations and fingerprints are unchanged.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cashbook.test.tsx: rejects mismatched approvals, self approval and application linked to rejected evidence | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: checks integer position conservation, reservations and uncertainty without converting totals to floats | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: requires paired acceptance legs and conserves the whole handover even when history is paged | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: rejects source totals and cutoff mismatches and strips private extra report fields | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: rejects wrong returned request intent and clears stale scope before transport | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: retains the exact uncertain expense and blocks navigation until same-key replay | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: requires another admin to review and applies the original request instead of the returned decision id | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: allows the current receiving custodian to accept part of the reservation with captured versions | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: keeps every paise in a recording correction and retains the original occurrence evidence | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: submits category/method/employee filters with an exclusive Kolkata time boundary and current scope | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: uses real expense proof adapters and retains byte upload identity across an uncertain acknowledgement with navigation blocked | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: keeps receiver rejection available without active custody selectors or cross-custodian reads | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: gives finance readers permitted custody history without acknowledgement or reservation forms | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: keeps finance readers free of expense and custody mutation forms | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: uses the server default occurrence order when a capture omits optional filters | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: captures filtered evidence, pages and opens original source detail while retaining complete cutoff controls | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: retains capture identity after an uncertain response and rejects a mismatching CSV snapshot | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: downloads matching captured CSV in StrictMode and discards a late export after scope invalidation | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: shows current export permission and never gives an operator access to captured financial sources | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: uses the current actual receiving account revision and freezes the account/custodian of existing cash locations | preserve | reports |
| apps/web/src/test/expense-attachments.test.tsx: rejects booking evidence and parent fields while projecting only expense metadata | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: uses only the expense parent route and rejects mismatched parent/command identities as uncertain | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: rejects booking grant URLs and wrong-parent/foreign URLs before sending credentials | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: uses exact expense binary content path, current CSRF and parent-projected upload result | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: aborts expense transport on scope change and refuses a new franchise rebind | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: bounds bytes and rejects an empty response or a late response after current scope loss | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: retains uncertain initiation and cancellation identities until durable cleanup is confirmed | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: reconciles ready evidence after an uncertain cancellation without replacing the original cancellation key | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: allows finance proof read without upload, retry or cancel and never locks review on another creator’s unsettled metadata | preserve | proof |
| apps/web/src/test/expense-attachments.test.tsx: freezes new evidence after review and purges previews on scope loss | preserve | proof |

## Issue #143 reviewed custody additions

The production custody page and temporary-agent access panel retain exact pending requests
and clear private state on scope changes. New effects are navigation/scope guards and
short-lived CSV object-URL cleanup; no production localStorage or demo import is added.
All previous regression declarations, dependencies and fingerprints remain unchanged.
These web tests use synthetic transport; native and browser evidence is separate.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/agent-access.test.tsx: creates only this franchise agent grant, exposes one-time code in memory and revokes exact current membership version | preserve | seam |
| apps/web/src/test/agent-access.test.tsx: reconciles lost invitation by read and offers revocation, never replaying its unrecoverable token command | preserve | seam |
| apps/web/src/test/agent-access.test.tsx: rejects foreign tenant projections and never mutates a multiple-franchise grant through this screen | preserve | seam |
| apps/web/src/test/custody-actions.test.tsx: requires reassignment instruction and source-specific grant for mixed custody cohort | preserve | parcels |
| apps/web/src/test/custody-actions.test.tsx: records missing separately from actual office receipt using exact source version | preserve | parcels |
| apps/web/src/test/custody-actions.test.tsx: prevents replacement submission while locked and keeps giver actions separate from administration | preserve | parcels |
| apps/web/src/test/custody-data-access.test.ts: projects only source fields and rejects invented proof, wrong control totals and missing custody | preserve | reports |
| apps/web/src/test/custody-data-access.test.ts: rejects duplicate parcels and reused delivery or failure evidence across a full cohort | preserve | reports |
| apps/web/src/test/custody-data-access.test.ts: requires immutable snapshot count, same cutoff and exact expiry while dropping unknown private fields | preserve | reports |
| apps/web/src/test/custody-data-access.test.ts: does not accept partial acknowledgement or a proof masquerading as unknown physical custody | preserve | reports |
| apps/web/src/test/custody-data-access.test.ts: rejects mismatched capture manifest, export identity and sibling snapshot before display | preserve | reports |
| apps/web/src/test/custody-data-access.test.ts: never confirms another manifest or approval and rejects receipt claims from proposal-only actions | preserve | reports |
| apps/web/src/test/custody-data-access.test.ts: discards an in-flight captured snapshot and its retry intent when scope changes | preserve | reports |
| apps/web/src/test/custody-transfers.test.tsx: prepares and releases exact source evidence without manually entering approval, instruction or manifest references | preserve | parcels |
| apps/web/src/test/custody-transfers.test.tsx: rejects a mismatched named approval and does not offer giver controls to another account | preserve | parcels |
| apps/web/src/test/custody-transfers.test.tsx: rejects false preparation claims and office-grant destination/proof contradictions before display | preserve | parcels |
| apps/web/src/test/custody.test.tsx: retains exact acknowledgement after a lost response and blocks replacement navigation | preserve | recovery |
| apps/web/src/test/custody.test.tsx: does not offer acknowledgement for another agent or export to readers, and purges private evidence on scope loss | preserve | recovery |

## Issue #144 reviewed cashbook source corrections

Exactly two new controlled-transport declarations preserve owned advance and earned-fee references, actual payment method, gross earning and explicit replacement cash/advance amounts. All previous declarations, effects, dependencies, routes and fingerprints remain unchanged. These tests are separate from native monetary effects and the pending full settlement browser journey.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cashbook.test.tsx: retains the named agent and actual payment method through an advance recording correction and rejects missing payee evidence | preserve | reports |
| apps/web/src/test/cashbook.test.tsx: preserves gross earned fee and explicit advance source when correcting recorded cash, and rejects invalid fee responses | preserve | reports |

## Issue #144 reviewed seller remittance correction

One additional controlled-transport declaration verifies seller remittance source/reference preservation, explicit payment method and unchanged expense/fee classification. All existing declarations, dependency fingerprints, effects and routes remain unchanged.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cashbook.test.tsx: retains seller COD allocation and private payment reference through remittance recording correction without creating an expense | preserve | reports |

## Issue #144 reviewed COD reservation reversal correction

One additional controlled-transport declaration verifies COD reversal source preservation, absent payment evidence and zero cash legs. All existing declarations, dependency fingerprints, effects and routes remain unchanged.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cashbook.test.tsx: corrects a COD reservation without a payment method or seller payment reference | preserve | reports |

## Issue #144 reviewed handover receipt attribution

One additional controlled-transport declaration verifies captured receipt/component provenance, exact complete control totals and malformed ownership rejection. All existing declarations, dependency fingerprints, effects and routes remain unchanged.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cashbook.test.tsx: shows captured receipt components and complete attribution totals after partial acknowledgement, with malformed ownership rejected | preserve | reports |

## Issue #144 reviewed captured statement exports

Three distinct export regressions cover recovery, ownership/protocol bounds and the accountant workspace. Prototype authority, dependency fingerprints, imports and routes are unchanged. One owning setTimeout releases the CSV Blob URL after download; it cannot capture or mutate private data.

| Test | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/agent-settlement-workspace.test.tsx: captures and downloads a fixed accountant statement export, retaining the exact uncertain request and clearing it on scope loss | preserve | reports |
| apps/web/src/test/agent-statements.test.ts: recovers captured export with the exact original key and projects only owned immutable metadata | preserve | reports |
| apps/web/src/test/agent-statements.test.ts: downloads the captured CSV schema and refuses mismatched private scope, columns and byte bounds | preserve | reports |

| apps/web/src/test/agent-money.test.tsx: validates separate COD, direct cash/noncash and advance equations and bounded owned live pages | preserve | payments | Issue #144: exact owned source equations and noncash/direct fee split, minimum allowlists, immutable command recovery and owner-only configuration with read-only accountant sources. Controlled browser transport complements genuine PostgreSQL source/payment tests. |
| apps/web/src/test/agent-money.test.tsx: retains immutable finance command content and key through uncertainty and rejects stale scope and mismatched operations | preserve | payments | Issue #144: exact owned source equations and noncash/direct fee split, minimum allowlists, immutable command recovery and owner-only configuration with read-only accountant sources. Controlled browser transport complements genuine PostgreSQL source/payment tests. |
| apps/web/src/test/agent-money.test.tsx: owner workflow recovers the same seller revision while locking navigation and gives accountants source-only access | preserve | payments | Issue #144: exact owned source equations and noncash/direct fee split, minimum allowlists, immutable command recovery and owner-only configuration with read-only accountant sources. Controlled browser transport complements genuine PostgreSQL source/payment tests. |

| apps/web/src/test/agent-money-requests.test.tsx: fee expense keeps full gross recognition, separate noncash direct amount and original advance binding | preserve | payments | Issue #144: full fee entitlement with separate direct and original advance sources; exact COD reservation ownership and payment method; canonical timestamp recovery rejects changed instants and money. Controlled transport complements actual PostgreSQL and browser payment evidence. |
| apps/web/src/test/agent-money-requests.test.tsx: COD reversal binds the original receipt account/custodian, moves no cash and advance requests keep explicit payees | preserve | payments | Issue #144: full fee entitlement with separate direct and original advance sources; exact COD reservation ownership and payment method; canonical timestamp recovery rejects changed instants and money. Controlled transport complements actual PostgreSQL and browser payment evidence. |
| apps/web/src/test/agent-money-requests.test.tsx: cashbook recovery accepts canonical timestamp spelling but rejects changed instants and financial fields | preserve | payments | Issue #144: full fee entitlement with separate direct and original advance sources; exact COD reservation ownership and payment method; canonical timestamp recovery rejects changed instants and money. Controlled transport complements actual PostgreSQL and browser payment evidence. |

| apps/web/src/test/agent-cash-handovers.test.tsx: agent opens handover-only controls and recovers the same request while settlement navigation is locked | preserve | payments | Issue #144: handover-only agent entry preserves original uncertain requests and navigation locks; minimum own-custodian sources reject broken paging and handover recovery binds canonical identical instants and exact amounts. Genuine HTTP tests cover current authority and complete source pages. |
| apps/web/src/test/agent-cash-handovers.test.tsx: own-source adapter minimizes fields, rejects foreign or broken pages and handover recovery requires the identical instant and amount | preserve | payments | Issue #144: handover-only agent entry preserves original uncertain requests and navigation locks; minimum own-custodian sources reject broken paging and handover recovery binds canonical identical instants and exact amounts. Genuine HTTP tests cover current authority and complete source pages. |

## Issue #145 physical closing regression disposition

The production closing view uses current scoped API authority and retained server evidence.
Its before-unload/click/franchise-change listeners block navigation only during an unresolved
mutation; all listeners are removed on cleanup. The one-second object-URL timer releases
the completed CSV download. The synthetic test timer lets React settle its download state.
These effects add no persistent browser data or prototype write authority.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cash-close.test.tsx: validates exact arithmetic, source binding, coverage and denomination evidence before display | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: retains one exact uncertain submission, blocks navigation and displays complete count/source controls | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: requires labelled sole-admin acknowledgment and distinguishes the persisted review mode | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: prepares a real successor-open intent with version zero without the update-only guard | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: submits the actual successor opening form and shows the confirmed new session | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: allows the attached CSV download anchor through the command navigation guard | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: renders a current administrator ending count while retaining another active opening observer | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: finance readers inspect immutable counts without recording or approval forms | preserve | reports |

## Issue #145 derived checklist regression disposition

The derived checklist labels current server evidence, pending submission/review, retained
prior approval and stale reconciliation. It creates no additional persistent state or human
review attestation. These regressions preserve that distinction through submission and reopen.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cash-close.test.tsx: derives checklist capture, submission and stale states without claiming human source review | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: keeps prior approval separate from reopened checklist work and labels approved late evidence | preserve | reports |

## Issue #145 opening repair regression disposition

The two added forms have no new timers/listeners. Their controlled transport regressions
check exact opening identity, corrected actual amount/time, separate opening approval and
pending/stale checklist states without replacing prior approved evidence. The existing
recorder regression now represents normal cross-actor shifts rather than observer departure.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cash-close.test.tsx: saves actual initial amount and time correction with exact revision and shows pending opening despite retained approval | preserve | reports |
| apps/web/src/test/cash-close.test.tsx: approves only exact opening separately while preserving ending self-review restriction | preserve | reports |

The rejection selector uses its separate server-derived eligibility. Its regression verifies
an opening author can reject another counter while combined approval stays disabled and
opening approval remains pending. No timer/listener or human attestation is added.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/cash-close.test.tsx: permits an opening author to reject another counter without granting approval to that opening | preserve | reports |

## Issue #147 shipment cost and contribution regression disposition

The production Reports entry uses the scoped shipment-cost adapter, `ShipmentCostEditor`,
`ShipmentCosts` and `Contribution`. These files do not import the prototype store;
existing exports, transitive callers, imports, routes and dependency fingerprints are unchanged.
The before-unload/click/franchise-change listeners prevent replacing unresolved commands,
and the scope-abort listener clears private drafts and evidence. All listeners are removed
on cleanup. The one-second CSV object-URL timer releases the explicitly prepared download.
No persistent browser data, automatic import, purchase verification or payment authority is added.

Fourteen controlled-transport regressions preserve exact source/allocation and report arithmetic,
native rate and expense selection (including corrected actual zero expense), immutable import
preview/apply, historical precision, private export, scope clearing, report-navigation response
invalidation and keyboard focus. These tests do not claim actual browser or PostgreSQL execution;
those separate results and the native datetime-entry qualification limit are recorded in
[Issue #147 verification](issue-147-verification.md).

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/shipment-cost.test.tsx: rejects malformed allocation arithmetic, source identity, coverage and contribution controls without rounding money | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: retains precise preview row errors without asserting success or fabricating native evidence | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: records manual costs with explicit whole-booking or parcel allocations and rejects over-allocation before dispatch | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: previews a genuine native rate selection before applying its exact immutable batch | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: retains exact uncertain report keys, blocks replacement/navigation and clears private evidence on scope invalidation | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: pages every retained booking, switches all dimension groups and exposes actual native source drill-through | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: revises full allocations under the current source version and keeps original effective precision when retained | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: keeps estimated and incomplete coverage honest without turning unknown costs into zero contribution | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: maps disabled and conflicting cost responses to authoritative failures without uncertain replacement | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: previews a manual CSV with exact bytes and rejects an oversized file before sending | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: uses the applied expense amount and exact occurrence instant without letting an attribution create another expense | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: discards a delayed old report page after saved-report navigation | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: downloads only the selected private snapshot through an attached anchor | preserve | reports |
| apps/web/src/test/shipment-cost.test.tsx: retains a corrected zero native expense as actual evidence with explicit zero allocations, never a manual free cost | preserve | reports |

## Issue #147 reviewed history-navigation recovery

The cost command owner now lives in an ephemeral WeakMap keyed by the exact authorized
scope ticket. Its one-shot abort listener clears the intent and result, and the workspace
subscribes with `useSyncExternalStore`. No local/session storage, private-body persistence,
prototype dependency, route declaration or existing fingerprint changes are introduced.
Record/revision, preview, apply and report capture share exact-key recovery. A result completed
while its view is unmounted remains available in the same live scope.

OperatorApp checks the complete current authorization context during pathname navigation;
only identical context retains the scope ticket. Changed actors, roles or permitted scopes,
authorization errors, explicit reload and scope loss still invalidate it. Pending navigation
responses cannot supersede newer loads. Existing operator lifecycle regressions remain intact.
The new controlled-router tests use the actual OperatorApp lifecycle for capture and import
Back/Forward, and distinguish that evidence from native browser qualification.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/shipment-cost-navigation.test.tsx: retains uncertain identity through actual OperatorApp history reauthorization and reconciles a response completed while away | preserve | reports |
| apps/web/src/test/shipment-cost-navigation.test.tsx: clears every retained shipment operation on real scope abort and never allows replacing an unresolved command | preserve | reports |
| apps/web/src/test/shipment-cost-navigation.test.tsx: preserves navigation scope only for identical complete context and discards late navigation or explicit refresh authority | preserve | reports |
| apps/web/src/test/shipment-cost-navigation.test.tsx: recovers the identical private import preview after actual OperatorApp Back and Forward without retaining a replacement file | preserve | reports |

## Issue #147 completed-result consumption

An acknowledged completed outcome is removed from the ephemeral command owner by identity,
so remounts cannot replay a previously displayed capture. Unobserved late results remain
recoverable. An explicitly selected different saved report keeps its selection and export;
a recovered completion is offered separately and its reference is cleared on scope abort.
No new effects, routes, prototype fingerprints or existing regression decisions change.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/shipment-cost-navigation.test.tsx: consumes an observed capture once so explicit report navigation and export stay on the requested snapshot after OperatorApp remount | preserve | reports |
| apps/web/src/test/shipment-cost-navigation.test.tsx: offers an unobserved late completion without overriding an explicit report and clears the recovered reference on authority loss | preserve | reports |

## Issue #147 report selection epoch

Dispatch and exact retry record the current monotonic navigation epoch. Every committed
router location change advances it, including Back/Forward returning to the same entry.
A completion after intervening navigation is offered for recovery and cannot replace the
selected report. With no navigation after dispatch/retry, ordinary result opening remains.
The actual OperatorApp controlled-router regression covers six capture/retry history,
round-trip and replacement scenarios, asserting both selected and exported snapshot identity.
Existing recovery/security declarations and effects/fingerprints are unchanged.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/shipment-cost-navigation.test.tsx: keeps same-path history and replacement selections authoritative across capture and retry epochs, including round trips | preserve | reports |

## Issue #66 typed settings and explicit consumer suggestions

The production Settings route now uses strict scoped DTO projection and typed controls,
with organization defaults, franchise overrides, explicit clear/inherit, immutable history
and reviewed compare-and-swap updates. Native financial selectors retain their owning
local-admin authority; they do not manufacture policies or move money. Calendar, language,
schedule and unresolved account-term availability remains explicit. The demo is unchanged.

The ephemeral settings session adds a one-shot scope-abort listener and Settings subscribes
with useSyncExternalStore. Accepted same-authority navigation retains a draft or exact
uncertain request; explicit reload and changed authority purge both. SettingsNavigationGuard
adds before-unload and franchise-change listeners with cleanup, and checks committed router
locations for Back/Forward/query warnings. Cancelling reload preserves selected scope.
BookingPreference subscribes to its existing booking workflow, with no new browser storage.
These are the five reviewed new effect entries; no existing effects are removed.

Identity is operator display only. New booking and report suggestions require explicit
acceptance and retain their source version in new requests; manual service/scope changes
remove it. Report options come from the authorized paginated API. Saved report filters and
E/K, previous quote facts, receipt issuer and the approved issue147 navigation epochs remain
unchanged. No exports, store members, prototype callers, routes, imports or dependency
fingerprints changed. All existing regression dispositions are retained.

The sixteen controlled-transport tests below cover these contracts, including actual
OperatorApp lifecycle, exact retry and current-role invalidation. They do not claim native
browser or database verification.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/settings.test.tsx: decodes absent, inherited, configured-empty and revoked scope without manufacturing values or leaking unknown properties | preserve | seam |
| apps/web/src/test/settings.test.tsx: rejects invalid clock/calendar/reference values without choosing a working week or policy | preserve | seam |
| apps/web/src/test/settings.test.tsx: checks exact owner on responses and authorized options, including pagination metadata | preserve | seam |
| apps/web/src/test/settings.test.tsx: saves typed organization configuration with expected version and shows immutable history and honest availability | preserve | seam |
| apps/web/src/test/settings.test.tsx: retains a conflicting draft, requires explicit rebasing, and clears an override with null rather than copied defaults | preserve | seam |
| apps/web/src/test/settings.test.tsx: preserves exact lost-response retry across actual OperatorApp Back/Forward and warns before departure | preserve | seam |
| apps/web/src/test/settings.test.tsx: declines history/query navigation and explicit footer reload without losing draft, then clears on accepted reload | preserve | seam |
| apps/web/src/test/settings.test.tsx: purges draft and uncertain intent on scope abort and ignores pending old-context completion | preserve | seam |
| apps/web/src/test/settings.test.tsx: operator display preference is separate from legal/franchise identity and operator role cannot write | preserve | seam |
| apps/web/src/test/settings.test.tsx: booking suggestion requires acceptance, preserves provenance in quote and tax requests, and manual service clears it | preserve | seam |
| apps/web/src/test/settings.test.tsx: does not substitute revoked configured report selection and requires explicit new-capture acceptance | preserve | seam |
| apps/web/src/test/settings.test.tsx: Sales and contribution capture accepted scope source only until manual changes, and saved report selection disables suggestion | preserve | seam |
| apps/web/src/test/settings.test.tsx: uses current authorized native receiving account choices and freezes the selected exact revision | preserve | seam |
| apps/web/src/test/settings.test.tsx: report options use authorized paginated API rather than all operator-context franchises | preserve | seam |
| apps/web/src/test/settings.test.tsx: delivery-agent-only cannot resolve settings or protected financial references | preserve | seam |
| apps/web/src/test/settings.test.tsx: retains the selected franchise when reload is declined and clears private draft when navigation reveals changed authority | preserve | seam |


## Issue #66 review repair: history and timezone recovery

Production now uses the installed React Router data-router API with the same hash URLs
and existing nested operator routes. Its blocker restores a cancelled native POP's index
and leaves PUSH/REPLACE entries untouched. Demo routing remains unchanged. The reviewed
App.tsx fingerprint changes for the router lifecycle; no prototype exports, Store members,
callers, import graph, route declarations or effect inventory change. Existing regression
dispositions remain unchanged. OperatorApp settings and shipment navigation harnesses now
use createMemoryRouter so their existing assertions exercise the production blocker contract.

New regression declarations cover both history directions, repeated cancellation and accepted
round trips, exact query/hash/key/state preservation, rejected PUSH/REPLACE, and native
createHashRouter history index restoration. The existing lost-response test additionally
cancels twice before navigating and recovering the exact request. Shared timezone parsing
now governs browser and API inputs. Each timezone editor rejects unsupported local input
without dispatch, accepts supported casing/aliases, and retains editable state after a
server catalog rejection; a correction creates a fresh command. Controlled transports and
jsdom history do not substitute for actual-browser or PostgreSQL verification.

| Regression | Disposition | Group |
| --- | --- | --- |
| apps/web/src/test/settings.test.tsx: preserves both saved report entries and settings identity through repeated cancelled POPs then accepted round trips | preserve | seam |
| apps/web/src/test/settings.test.tsx: cancelled PUSH and REPLACE neither create duplicates nor truncate the existing Forward destination | preserve | seam |
| apps/web/src/test/settings.test.tsx: hash router restores the native history index after cancelled Back and Forward without replacing keys or state | preserve | seam |
| apps/web/src/test/settings.test.tsx: timezone editor $key rejects unsupported input locally and saves accepted casing or aliases without uncertain recovery | preserve | seam |
| apps/web/src/test/settings.test.tsx: a server timezone validation rejection retains an editable draft and allows a corrected new command with a fresh key | preserve | seam |


## Issue #141 account regression ownership

| Test | Disposition | Group | Reason |
| --- | --- | --- | --- |
| apps/web/src/test/counter.test.tsx: shows source credit, retains an uncertain request identity and saves the exact approved debtor | preserve | seam | Issue #141 explicit debtor/contact attestation, exact-intent recovery, current private account scope and authoritative credit/pricing integration; no local financial writes. |
| apps/web/src/test/counter.test.tsx: invalidates approval after any shipment edit and gives a clear held-account denial | preserve | seam | Issue #141 explicit debtor/contact attestation, exact-intent recovery, current private account scope and authoritative credit/pricing integration; no local financial writes. |
| apps/web/src/test/customer-accounts.test.tsx: requires an explicit contact attestation, keeps an uncertain command and retries its exact body/key | preserve | seam | Issue #141 explicit debtor/contact attestation, exact-intent recovery, current private account scope and authoritative credit/pricing integration; no local financial writes. |
| apps/web/src/test/customer-accounts.test.tsx: reviews exact shipment evidence before approving and refreshes the pending queue | preserve | seam | Issue #141 explicit debtor/contact attestation, exact-intent recovery, current private account scope and authoritative credit/pricing integration; no local financial writes. |
| apps/web/src/test/customer-accounts.test.tsx: read-only cannot mount account directory reads or configuration | preserve | seam | Issue #141 explicit debtor/contact attestation, exact-intent recovery, current private account scope and authoritative credit/pricing integration; no local financial writes. |

| apps/web/src/test/reconciliation.test.tsx: shows disabled default and preserves the exact uncertain opt-in command across back navigation | preserve | seam | Issue #146 optional manual CSV reconciliation: explicit evidence review, private source projection, current grants and retained uncertain intent; no duplicate financial posting. |
| apps/web/src/test/reconciliation.test.tsx: requires explicit selection and reason before confirming an exact suggestion | preserve | seam | Issue #146 optional manual CSV reconciliation: explicit evidence review, private source projection, current grants and retained uncertain intent; no duplicate financial posting. |
| apps/web/src/test/reconciliation.test.tsx: captures controls and drills into verifier/source evidence; external references default out of CSV | preserve | seam | Issue #146 optional manual CSV reconciliation: explicit evidence review, private source projection, current grants and retained uncertain intent; no duplicate financial posting. |
| apps/web/src/test/reconciliation.test.tsx: read_only cannot mount private reconciliation requests | preserve | seam | Issue #146 optional manual CSV reconciliation: explicit evidence review, private source projection, current grants and retained uncertain intent; no duplicate financial posting. |

| apps/web/src/test/reconciliation.test.tsx: uploads a local CSV, publishes its selected mapping and preserves that version through preview and import | preserve | seam | Issue #146 optional manual CSV reconciliation: explicit evidence review, private source projection, current grants and retained uncertain intent; no duplicate financial posting. |

| apps/web/src/test/account-statements.test.tsx: shows independently checked balances, source debt, private history and exact uncertain issue recovery | preserve | seam | Issue #142: source-reconciled statements, explicit roles and exact retry identity. |
| apps/web/src/test/account-statements.test.tsx: allows accountant preview with no issuing action and rejects unreconciled DTO totals | preserve | seam | Issue #142: source-reconciled statements, explicit roles and exact retry identity. |
| apps/web/src/test/advance-refunds.test.tsx: requires independent review and actual evidence, retaining an uncertain return exactly; finance readers cannot write | preserve | seam | Issue #142 approved scope: unused-advance return evidence, exact retry identity and finance role controls. No consumers, effects or fingerprints change. |

| apps/web/src/test/ageing.test.tsx: shows separate advances even without matching debt and sends an explicit overdue filter | preserve | reports |

| apps/web/src/test/sales.test.tsx: decodes refund corrections and opens a monthly statement with its frozen balance | preserve | reports | Issue #62: browser transport decodes refund corrections and reconciled monthly statement revisions without inventing another transfer or sale. |
