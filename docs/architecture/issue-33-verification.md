# Issue #33 verification

Delivery is a reviewable PR against `main`; the human reviewer owns merge. Issue #33
remains OPEN. No production deployment or provider messaging claim is made.

## Baseline and scope

Starting main: `38e4b9daacf694f4db5020c1fecc5ce4f91ae21d` (PR #116, Issue #32).
Branch: `issue-33-production-booking-ui`. Initial checkout was clean; current origin/main
was fetched before switching to main, pulling and creating the issue branch. Live Issues
#2–#32 were all CLOSED, including direct prerequisites #18/#19/#20/#21/#22/#23/#29/#30/#31.
Issue #34 was read separately and remains blocked pending #33's merge. Main Engineering
checks [run 35499220977](https://github.com/ShippingCo/ShipIT/actions/runs/35499220977)
was successful. Strict required `Planning and prototype checks`, admin enforcement and
resolved conversations remain unchanged. No newly blocking accepted decision was found.
Issue #33 progressed blocked → ready → in-progress after this audit; review follows delivery.

The architecture, migration map, authorization/idempotency/testing contracts and accepted
ADRs (especially tenant capabilities, money/privacy, payment ledger, issued receipts and
private attachment storage) govern this work. Their business rules were consumed unchanged.
**No schema migration, backend business rule, public endpoint, role or dependency was added.**
The only API-side additions are guarded synthetic verification fixtures/tests.

## Implemented flow and wire contracts

Production enables `/business/new-booking` and `/business/receipts` in the existing Material 3
shell and responsive navigation. Workspace/Settings remain available. No operational demo
page is exposed as production. Small adapters validate unknown JSON and retain only the
fields a screen consumes, including nested receipt evidence. Malformed successes become
safe protocol failures; malformed mutation success remains uncertain, not unsaved.

| Stage | Existing endpoint / authority |
| --- | --- |
| Customer lookup/create | GET/POST `/api/v1/organizations/:org/franchises/:franchise/customers`; `search_by=name|phone`, `q`, `limit`, opaque `cursor` |
| Customer refresh/edit | GET/PATCH the same root `/:customer_id`; expected version and separate stable command key |
| Quote | POST `/api/v1/pricing/quote?organization_id&franchise_id`; destination key, server service enum, integer grams, optional structured override |
| Tax intent/calculation | POST `/api/v1/tax/intents` then `/api/v1/tax/calculations`, same required tenant selectors and a key for each logical intent |
| Booking | POST `/api/v1/bookings` with scoped query, customer/version, tax calculation/intent and parcel weight/docket/recipient only |
| Collection/current balance | POST/GET `/api/v1/bookings/:booking_id/payments` with tenant selectors; real ledger amount/context/method/reference |
| Booking/collection receipt | GET `/api/v1/bookings/:booking_id/receipt`, nested `/payments/:payment_id/receipt`; adapter also supports GET `/api/v1/receipts/:receipt_id` |
| Receipt discovery | GET `/api/v1/parcels` scoped, bounded cursor pagination and optional exact docket; only receipt references projected |
| Private evidence | Existing #31 booking-scoped list/initiate/content/finalize/cancel/download-grant boundary through `AttachmentUploader` and its client |

The selected Customer supplies the sender snapshot; parcel recipient contact is entered
separately. Selecting a repeat customer fills only empty inputs. Deliberate operator edits
survive selection/refresh and require an explicit customer update or explicit use of latest
values. Phone uses the server's international normalized contact format. Search is async,
cancellable, franchise-private and fenced by the actual scope ticket, not DOM visibility.

React displays integer-paise quote and `TaxCalculationDto` values with the existing BigInt
INR formatter. It never sends displayed totals or calculates a GST percentage. Service labels
map to `standard`, `express`, `same_city`. Overrides use only `customer_agreement`,
`service_recovery`, `commercial_exception`; the server decides tolerance and permission.
Tax inputs collect actual service-recipient reference, registration/state/GSTIN, handover
state and evidence reference. Missing/unsupported facts cannot silently become zero tax.
Cases requiring privileged jurisdiction resolution are stopped with administrator guidance;
this UI does not grant that authority or fabricate evidence.

Blank docket is **omitted**, the actual API's allocation contract (explicit null is invalid).
Manual docket conflicts are handled at the server and focus the docket input. No docket
inventory is downloaded. The counter submits one parcel; no backend cardinality changed.

## Commands, recovery and partial success

Each command freezes operation, method/path, exact body JSON, scoped ticket and key.
A synchronous busy/intent latch makes rapid duplicate events share one logical operation.
A timeout/disconnect/500/503/malformed success or in-progress result retains that exact
intent and freezes editing. Explicit retry reconciles it. Abort never implies rollback.
Confirmed safe rejection releases the intent so a deliberately corrected request gets a new
key. Stale price/tax removes the preview, keeps values and requires refresh plus review before
saving; customer version conflict requires authorized refresh and deliberate continuation.
Idempotency fingerprint conflicts remain blocked for reconciliation. Errors never render raw
backend details. 401 clears private scope and requests sign-in; 403/404 have safe feature states.

Session storage retains only opaque operation/key/optional Booking reference under the
original user/org/franchise. It never contains addresses, command bodies, files, credentials
or tax facts. On a full reload/navigation that loses an uncertain body, new booking creation
is blocked in that scope and the operator is directed to Receipts/authorized support. The
existing [booking reconciliation contract](bookings.md) supplies the owner process; no public
key lookup exists. Support must inspect retained scoped commercial records before deciding
whether replacement is safe. This is intentionally not automatic draft restoration. Do not
clear the marker or use another tab as a substitute for reconciliation. Retained backend
command records currently have no expiry-based reuse; this UI never starts a fresh key
because a retry took too long.

To Pay records no collection and displays the server obligation outstanding at confirmation.
Paid now requires an explicit cash/UPI choice, first confirms/reconciles the Booking, then
uses its authoritative outstanding paise with `paid_counter`, its own stable key and UUID
collection reference. A collection requires the existing franchise-admin grant in addition
to booking's operator grant. Denial/uncertainty cannot undo the saved booking. Only payment
is retried; replay's historic projection is followed by a current balance read. No settled
boolean or browser collection is written. Reconciliation after a balance/reference conflict
remains with the authorized payment workflow; #34 owns operational To-Pay views.

Receipts have independent idle/loading/ready/error/retry states. They load immutable issued
DTOs and pass them through `receiptView` and explicit `printReceipt(dto)` only. No automatic
print, browser recomputation or mutable franchise-setting substitution occurs. Receipt
failure says the booking is saved. Receipt discovery is bounded and deduplicates Booking IDs;
it introduces no package actions. Collection acknowledgements are offered after confirmed
Paid now; historical payment-entry browsing remains with its owning operational workflow.

Attachments start only after the real Booking ID is confirmed. The existing uploader owns
file preparation, private upload intents, clean-scan confirmation, independent retries and
Blob URL cleanup. Booking survives upload failure. The client is now bound to its creation
scope so an old Booking client cannot silently target another franchise.

Every private request uses runtime scope, never editable tenant inputs. Scope changes,
logout, membership invalidation and cross-tab invalidation abort/reset private states;
late transport completion cannot paint. Old-scope mutation completion also cannot remove
its unresolved recovery marker. Focus/visibility revalidation preserves drafts when context
is identical and invalidates/remounts them when access changes. Transient focus revalidation failure announces a notice and preserves the draft; it grants no local authorization. Explicit navigation/refresh
still reauthorizes. Drafts are ephemeral, not an offline database.

## Intentional prototype differences and #34 boundary

No production `addBooking`, `bookingsByPhone`, `suggestFreight`, `taxOn`, `gstRate`,
`placeOfSupply`, `peekDocket`, `findByDocket`, AppContext mutation or demo receipt dependency.
No WhatsApp-sent/customer-notified toast or hidden browser message side effect. No packing
input that contradicts the rate contract. No lot assignment, e-way capture or goods-value
control is folded into this counter slice. Private uploads replace browser base64; immutable
receipts replace demo lookup; ledger collections replace settled flags. The demo remains
explicitly fictional and unchanged.

**#33 proves persistence through the production read contract. #34 owns the full Packages
screen migration.** Packages/Lots/Routes/Dashboard/E-way, bulk/lifecycle/lot membership,
operational To-Pay and reporting UI are not migrated by this PR.

## Reproducible synthetic walkthrough

Pinned tools: Node 22.23.2, pnpm 10.34.5, Python 3.12.14; Docker running. No private/customer
production data is used. The ordinary full gate discovers `test/database/counter-workflow.test.ts`.
It composes HTTP customer creation/repeat lookup → structured within-tolerance quote override → tax → booking → collection → receipt → fresh Parcel read
against disposable PostgreSQL. It injects a pre-commit dependency failure and lost COMMIT
acknowledgement, replays concurrently through a new server/pool, checks original DTOs/counts,
then denies sibling B/unrelated C/forged nested references. It checks log/audit and public
response exclusions for fixture credentials, CSRF, raw keys, contact narratives and bytes.

For an interactive real-API browser walkthrough, run these in separate terminals:

```sh
pnpm db:local exec node --experimental-strip-types apps/api/test/counter-demo.ts
SHIPIT_API_PROXY=http://127.0.0.1:3033 pnpm dev
```

Open `http://localhost:3033/_fixture/session`. This loopback-only test entry issues an
in-memory synthetic session, never prints credentials, refuses non-test databases and
cleans up on SIGINT/SIGTERM. Franchise Alpha-1 has an approved synthetic rate/tax policy;
Alpha-2 is available for scope-race checks. Search `Synthetic` for fixture customers, or
create `Synthetic Browser Sender`, `+1 202-555-0100`, `19 Synthetic Lane`. Enter separate
recipient `Synthetic Browser Recipient`, `+1 202-555-0101`, `21 Fictional Street`.
Use destination `SYN_DEST`, Standard, 999 grams, unregistered service recipient, handover
Maharashtra, references `SYN_BUYER` and `SYN_HANDOVER`. These constants exist only in fixtures.
The server returns freight 12551, packing 249, CGST/SGST 320 each, rounding -40 and total
13400 paise. Choose To Pay or Paid now plus cash/UPI. Save, explicitly retrieve receipt,
optionally print, attach a synthetic PNG and open Receipts. Reload, find the issued docket
and load the same receipt. Customer searches in A wait 2.5 seconds: immediately switch to B
and verify no A contact appears. Repeat at 375×812 and desktop dimensions.

Manual browser evidence on this branch: native Enter on invalid Save focused `counter-name`
with aria-invalid and associated error; real customer/quote/tax/booking/UPI collection showed
₹134.00 booked and ₹0.00 outstanding; receipt RCT-0000000000000000001 was explicitly loaded
and rediscovered via docket SIT-0000000000000000002 after reload; a synthetic PNG reached
“Saved securely” after clean validation. At 375px, document width was 365px (no horizontal
overflow), and late A lookup left B name/phone/address empty. The desktop late-response check also left B contact inputs empty; the browser reported no console warnings/errors. Temporary viewport override
was reset after verification. The fixture storage/scanner are synthetic; real S3-compatible
storage behavior is covered by the existing three provider contract tests in the full gate.

## Acceptance evidence map

Each row is an executed assertion/test or an explicit delivery check, not an assumption.

| Criterion | Evidence |
| --- | --- |
| Double-click/timeout gives one Booking/receipt | `counter.test.tsx` exact path/body/key retry; `counter-workflow.test.ts` lost COMMIT + concurrent replay + one booking/parcel increment/one issued receipt |
| Forged browser price rejected and explained | DOM total manipulation + QUOTE_STALE UI; PostgreSQL rejects unknown total and mismatched quote input with unchanged mutation counts |
| Previous-franchise customer never fills form | production App delayed A response at 1280/375; actual ticket aborted; manual 375px real-API delayed search |
| API outage preserves draft/no success | production App network/503 tests, no localStorage writes, no fabricated receipt |
| Fresh Parcel read contains booking | new HTTP server/runtime pool GET exact docket after lost acknowledgement |
| Printing optional/immutable | no print before click; receipt reload; `receipt.test.tsx` exact paise/escaping/cleanup; DB issuer edit leaves snapshot unchanged |
| Keyboard first invalid field | form submit test plus native browser Enter focus/aria-invalid/description |
| Accessible async outcome | live status/alert checks for booking/payment/receipt and existing uploader tests |
| Demo only through adapter | existing 26 demo app regressions; actual production bundle isolation gate; separate demo build |
| Authorized journey survives reload/restart | fresh server/pool composed test and browser receipt reload |
| Reproducible synthetic fixture | guarded `counter-demo.ts` commands above and default DB suite |
| Sibling B / unrelated C denied | composed DB customer, parcel, booking, receipt, attachment checks for each scope |
| Nested IDs cannot widen ownership | wrong-parent payment receipt and attachment finalize return 404 |
| Malformed input controlled | DB unknown total 422; malformed success runtime validators + uncertainty; field validation |
| Stale state controlled | quote refresh/new key; version conflict; docket focus; DB version/quote mismatch |
| Dependency failure no partial mutation | injected parcel write failure leaves booking/parcel/obligation/audit/event counts unchanged |
| No credentials/OTP/private extra fields | response/audit/log exclusion assertions; allowlist DTO projection tests; browser secret/demo bundle gate |
| Logs/audit inspected | composed scenario scans actual captured Fastify logs and audit_history using synthetic secrets/contacts/bytes |
| Tests/typecheck/lint/build/full PostgreSQL gate | exact results below |
| Documentation updated | this document, README, migration map, data access/index and reviewed inventory |
| PR targets current main, Closes #33, CI/head, mergeability | final PR delivery evidence in PR description and final report |
| PR not merged / issue not manually closed | final live GitHub state checked after CI; human merge only |

## Commands and results

Results are finalized after all source edits; GitHub head-SHA evidence is recorded in the
PR description/final report to avoid a self-referential commit hash here.

Final `pnpm db:local quality`: **PASS, exit 0** on the delivery source. It ran:

| Command/layer | Exact result |
| --- | --- |
| `pnpm check:toolchain` | Node 22.23.2 / pnpm 10.34.5 / Python 3.12.14, PASS |
| `pnpm test:quality` | 26 passed, 0 failed |
| `pnpm check:planning` | PASS, including 100 inventoried web test declarations and 17 migration negative controls |
| `pnpm lint` | PASS, tenant AST gate + ESLint with zero lint warnings |
| `pnpm typecheck` | All five workspace packages PASS |
| `pnpm test:unit` | testkit 22 + DB-unit 12 = 34 passed, 0 failed |
| `pnpm test:api` | 419 passed in 22 files, 0 failed |
| `pnpm test:web` | 140 passed in 8 files, 0 failed (24 counter, 14 attachment, 21 operator, 26 demo, other existing suites) |
| `pnpm test:attachments` | Real S3-compatible provider contract: 3 passed, 0 failed |
| `pnpm test:db` | 58 DB + 234 API = 292 passed, 0 failed/skipped/cancelled/todo |
| `pnpm build` | API type build + production Vite bundle PASS; rendered demo/server/secret isolation gate PASS |

The full gate totals **914 tests passed, 0 failed** (planning contract assertions are separate).
Additional `pnpm check:migrations` passed: all 21 released migrations unchanged.
`VITE_DATA_MODE=demo pnpm --filter @shippingco/web exec vite build --outDir /tmp/shipit33-demo-dist`
passed independently. `git diff --check` passed. No forbidden demo/store imports were found
in the new production modules. The focused composed PostgreSQL scenario also passed separately.

During development, new source/test inventory initially failed the planning gate until the
changed graph and regression dispositions were reviewed and recorded. Initial UI tests caught
unsupported signal composition in jsdom (replaced by explicit AbortController fan-in) and
label-selector mistakes; those were corrected before delivery. Final results above are green.
Three existing fictional `AppProvider` act warnings match the prior #32 run; the expected
negative S3 streaming tests emit three non-retryable-stream diagnostics. Neither is a failed
test or lint warning. The separate demo output directory produces Vite's standard outside-root
notice. Browser console inspection had zero warning/error entries.

The optional `pnpm db:local verify:gates` duplicate clean-install/failure-drill run was not
performed: no gate implementation changed. The 26 quality tests, actual production isolation
build, migration check and full PostgreSQL quality gate were executed. No skipped command is
represented as passing.

## Rollout, rollback and limits

Deploy the compatible production web bundle against merged #18–#32 APIs in synthetic staging
first; configure actual approved rate/tax policy and operator/admin grants through their
owning workflows. No migration or browser-data import is required. Roll back the web build or
disable this surface; keep committed records and server APIs. Never switch production to demo
as recovery. Reconcile any uncertain commands before replacing them.

One-parcel counter entry, ordinary supported domestic tax cases, explicit reference inputs
and manual cash/UPI recording are intentional bounds. No provider payment transfer, messaging,
policy administration, privileged tax resolution editor, historic payment-entry browser or
full operational screen is implied. Full reload during uncertainty requires authorized owner
reconciliation because storing raw drafts is prohibited and no public key-lookup endpoint is
approved. Browser layout checks are manual; deterministic App tests run in jsdom and do not
pretend to measure layout. Node's experimental type-stripping and the negative S3 streaming
case may emit their documented warnings. No final gate failure remains.
