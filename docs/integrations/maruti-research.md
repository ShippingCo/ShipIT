# Maruti integration access research

Issue [#57](https://github.com/ShippingCo/ShipIT/issues/57), researched **2026-10-03 (IST)**.
Status: local research decision for review; no carrier integration implemented by this issue.
[Acceptance and checks](../architecture/issue-57-verification.md) ·
[PR draft](../architecture/issue-57-pr-draft.md).

## Decision

| Field | Result |
| --- | --- |
| Precise carrier/service | Shree Maruti Integrated Logistics Limited (SMILe), domestic courier; separately assess its Innofulfill ECOMM product |
| Research outcome | `api_unverified` — public API offering/documentation found, but ShipIT-authorized, testable access and branch-docket coverage not verified |
| Live API decision | **NO-GO / NOT CURRENTLY VERIFIED** for this pilot; this does not mean Maruti has no API |
| Selected pilot mode | `manual` |
| Selected capabilities | `manual_operations=true`; `tracking_api=false`, `booking_api=false`, `rate_api=false`, `webhooks=false`, carrier-qualified `file_import=false` |
| Operational owner | Pilot franchise admin for branch handover, exact references and source checks; #60 owner for qualification, freshness and recovery |
| Access/commercial owner | ShipIT maintainer, with explicit user authorization before outreach/application |
| Revisit condition | Written permission and account/product coverage, legitimate isolated test access, verified contracts and bounded capability tests; file mode separately needs an authorized repeatable source and sanitized sample |

An admin can book locally in ShipIT, arrange carrier handover through their authorized
branch, record the external docket and record a sourced observation. That path remains
usable if machine access is refused. This is a supported **ShipIT workflow recommendation**,
not a completed real carrier pilot or permission to use any branch account.

Unlike #56's Akash Ganga findings, Maruti explicitly advertises Innofulfill REST APIs.
Public developer documentation is positive evidence of a product interface. It does not
prove that an ordinary courier franchise account can access it, that existing branch-issued
dockets belong to its tenant, or that ShipIT has permission to process customer data there.
Do not copy #56's carrier findings or convert public API documentation into live GO.

## Evidence method and identity

All sources below were accessed **2026-10-03 (IST)**. `confirmed` means the stated public
fact was observed, not live-tested. `not verified` means a lead/description lacks sufficient
pilot evidence. `unknown` means the necessary detail was not established. `unavailable`
requires affirmative evidence of denial/absence, or explicitly identifies a retrieval
failure rather than asserting interface absence. Confidence applies to the bounded finding.
Owners are responsible roles for later authorized work, not claimed accepted assignments.

The carrier's footer and carriage terms identify **Shree Maruti Integrated Logistics
Limited**, CIN **U64120GJ1987PLC010124**. Innofulfill's footer names the same company.
This identifies the published business; incorporation status and the shop's contracting
entity/entitlement still require agreement review. Do not merge unrelated Maruti brands,
Maruti Suzuki developer APIs, or similarly named parcel operators into one courier identity.
The carrier site itself flags `shreemarutilogistics.com` as unaffiliated. Use the reviewed
company/product identity and scoped courier UUID, never brand-name matching.

Read public informational pages and public developer documentation only. No tracking
lookup, account creation, OTP request, wallet recharge, contact, portal automation,
authenticated access, endpoint guessing or reverse engineering occurred. Following the
public homepage's Developers API link reached a 401 at its root; no business API was called.

| ID / primary source | Dated bounded finding / retrieval | Classification, confidence / unresolved owner |
| --- | --- | --- |
| C1 [Carrier home](https://shreemaruti.com/) | Read company/CIN, domestic courier services and human tracking/branch-locator links; no tracking link followed | `confirmed`, high: published identity and human interface; maintainer verifies local agreement |
| C2 [Carriage conditions](https://shreemaruti.com/conditions-of-carriage/) | Read named contracting business and operational carriage conditions | `confirmed`, high: public conditions; maintainer verifies product-specific contract, not API permission |
| C3 [Contact](https://shreemaruti.com/contact-us/) | Read general email `info@shreemaruti.com`, phone +91 9712666666 and branch contact route | `confirmed`, high: contact route, not developer approval; maintainer seeks proper integration contact only after authorization |
| C4 [Channel-partner form](https://shreemaruti.com/channel-partner-form-2026/) | Non-exclusive inquiry requests email/mobile verification and business details; read only | `confirmed`, high: inquiry route; API entitlement `unknown`; maintainer does not submit without authorization |
| C5 [Official Innofulfill product page](https://shreemaruti.com/innofulfill/) | Advertises API integration/custom REST APIs, manual order entry and sales contact; lists wallet onboarding and customer notifications | `confirmed`, high: product offering; integration owner verifies franchise/product coverage |
| C6 [Innofulfill home](https://innofulfill.com/) | Browser-rendered page identifies SMILe, KYC/wallet onboarding and links Developers API to `apis.innofulfill.com`; linked root returned 401 | `confirmed`, high: published developer route; root unavailable anonymously, not evidence API unavailable; maintainer verifies commercial scope |
| C7 [Public v2 developer guide](https://docs.innofulfill.com/api-docs) | Web text extraction was empty; browser-rendered public documentation read successfully. Advertises sandbox/production and auth, serviceability, booking, pricing, tracking, webhook sections | `confirmed`, high: documentation content on product domain; authorized/testable access `not verified`; integration owner confirms current supported version |
| C8 [Tracking section](https://docs.innofulfill.com/api-docs?api=get-tracking-awb) | Read tenant-bound AWB lookup, statuses, millisecond event time and 403 foreign-AWB behavior | `confirmed`, high: documented product behavior; legacy dockets/live semantics `not verified`; integration owner |
| C9 [Booking section](https://docs.innofulfill.com/api-docs?api=post-booking-ecomm) | Read references, shipment AWBs, product/carrier fields and asynchronous processing | `confirmed`, high: published example, not idempotency proof; integration owner |
| C10 [Rates section](https://docs.innofulfill.com/api-docs?api=post-rate-calculation-ecomm) | Read pincode/product/mode-based quote with component amounts; public example needs semantic review | `confirmed`, high: product quote documentation, not an approved franchise rate card; #59 owner |
| C11 [Webhook section](https://docs.innofulfill.com/api-docs?api=delivery-webhook) | Read signature header/raw-body requirement, delivery ID, UTC time, v1/v2 formats and out-of-order/retry warning | `confirmed`, high: documented webhook offering; signing algorithm/key lifecycle/retry budget `unknown`; integration owner |
| C12 [Login section](https://docs.innofulfill.com/api-docs?api=post-auth-login) | Read token/tenant context and expiration; guide also describes portal-issued API key alternative | `confirmed`, high: published authentication contract; actual account scopes/credentials `not verified`; integration owner |
| C13 [Privacy policy](https://shreemaruti.com/privacy-policy/) | Read public data-processing policy; it is not a third-party integration agreement or consent grant | `confirmed`, high: public policy; maintainer verifies appropriate processing/retention rights |

C8/C9 were navigated by their visible sidebar labels; links above are the resulting URLs.
Reviewers can always open C7 and select **Track Shipment by AWB** / **Create ECOMM Order**.
No carrier payload fixture or customer example is copied. The developer host belongs to
the Innofulfill domain and its content matches the official product offering; the site's
explicit developer link points to the API host rather than directly to this docs host.
Obtain carrier confirmation of the current supported docs/version before implementation.

## Partner and intermediary leads

These providers are primary sources for **their own integration claims**, not proof of
carrier authorization or universal branch coverage. Checked on the same access date.

| Source | Finding and limit | Owner / disposition |
| --- | --- | --- |
| [Unicommerce integration guide](https://support.unicommerce.com/index.php/knowledge-base/integration-with-shree-maruti/) | Search-index text says API username/password come from the Maruti team; direct retrieval failed. Historical/current account coverage not established | Integration owner: `not verified`, medium; obtain current official carrier contract before any direct integration |
| [ILS support guide](https://support.ilsportal.io/shree-maruti) | Read provider's account/credential configuration and test/production distinction; no endpoint/auth schema or permission to reuse it in ShipIT | Integration owner: `confirmed` provider guide, high; `not verified` usable direct access |
| [AfterShip offering](https://www.aftership.com/carriers/shree-maruti/api) | Provider search-index text advertises normalized tracking API/webhooks; no account test or data-source rights verified | Maintainer: `not verified`, medium; separately assess fees, coverage, processing rights and notification controls if selected |

Innofulfill's official product/API evidence is the strongest machine-interface lead.
An intermediary adds fees, secrets and another dependency. None is selected or installed
here. Generic provider webhooks are not evidence of legacy carrier-native webhooks.

## Capability and access findings

Availability and pilot enablement are deliberately separate. The public Innofulfill
offering is confirmed; **every live capability remains unqualified for this installation**.

| Required capability | Verified availability / remaining limit | Selected pilot / #53 port |
| --- | --- | --- |
| `tracking_api` | C7/C8 documents Innofulfill tracking; own-account access and legacy branch AWB coverage `not verified` | Disabled: `tracking_api=false` |
| `booking_api` | C5/C9 documents product booking; franchise entitlement, duplicate prevention and uncertain acceptance `not verified` | Disabled: `booking_api=false`; local Booking continues |
| `rate_api` | C10 documents calculated product charges, not negotiated franchise rates or actual cost | Disabled: `selling_rate_api=false`, `purchase_estimate_api=false` |
| `webhooks` | C11 documents product callbacks/signatures; signing details and actual subscription access not fully verified | Disabled: `webhooks=false` |
| `file_import` | Bulk/manual order entry and downloadable labels/invoices do not prove an authorized tracking/rate CSV or SFTP feed; no reliable export sample obtained | Carrier-qualified file mode not selected; #55's generic `tracking_import` remains separate |
| `manual_operations` | C1–C6 describe branch/contact/manual-order routes; real shop agreement/handover not exercised | Selected: `manual_observations=true`; own authorized franchise only |

The existing local installation response advertises generic CSV capability after #55.
This report changes no runtime flags or installations. The proposed manual adapter uses
`manualCapabilities`; no new per-carrier file qualification switch is claimed implemented.

| Access/commercial question | Answer / next action | Owner and revisit trigger |
| --- | --- | --- |
| Authentication | C7/C12 describes bearer token plus tenant context or API key. Endpoint examples differ in tenant-header casing; confirm accepted header names rather than relying on that claim | Integration owner: confirm current contract and account scopes before live GO |
| Contact/access | C3/C5 publish general/sales routes; franchise relationship is not API entitlement | Maintainer: after explicit outreach approval request current docs, product coverage and written integration rights |
| Sandbox | Public sandbox is documented, but no provisioned ShipIT test tenant or credentials | Integration owner: obtain isolated test access through authorized process; no requirement for research closure |
| Limits/SLA | 429 is documented; numerical quotas, polling cadence, batch limits and availability guarantees `unknown` | Integration owner: get limits and bounded request budgets before network work |
| Fees/KYC | Public onboarding mentions KYC/wallet and shipping-only/no-extra-charge marketing; no contracted API price or franchise eligibility verified | Maintainer: confirm written quote, minimums, wallet terms, termination and support; no recharge/application now |
| Permitted use/retention | Public carriage/privacy terms exist; third-party export, redistribution, processing and retention rights `unknown` | Maintainer: review actual agreement and minimum necessary data before API/file selection |
| Booking retries | `referenceId` exists but uniqueness, deduplication, cancellation races and retention guarantees `unknown` | Integration owner: require stable operation reconciliation; never blindly retry uncertain creates |
| Webhook security/retries | Signature and raw body documented; algorithm, encoding, signed components, rotation, replay window and retry budget `unknown` | Integration owner: obtain exact verification/test vectors and replay policy before enabling callbacks |
| Legacy identity coverage | Product tenant AWBs documented; branch AWB namespace/reuse/checksum and account migration `unknown` | Franchise admin + integration owner: verify actual branch references and ownership without importing by name |
| Locations/services | Product/mode and pincode fields documented; complete branch IDs, service dictionary and lane validity `unknown` | #59 owner: qualify effective-dated source dictionaries and units before rate mapping |
| Quote units/meaning | Booking examples specify INR, KG/CM; the rate response does not independently establish money units, rounding or whether charges are purchase estimates versus selling rates | #59 owner: obtain explicit quote currency/units/effective-date semantics before converting to paise or publishing |
| File interface | No authorized repeatable tracking/rate export or sanitized file sample established | Maintainer + integration owner: qualify source rights, schema, units, times and provenance before file mode |

These are conditional follow-ups with owners, not demands to acquire access before #57
can close. No affirmative API denial was obtained. `api_unverified` means pilot access
unverified here, even though the Innofulfill product API is publicly documented.

## Formats and reconciliation

No live response or authorized export was acquired. Public examples describe product
formats; they do not prove access. No new executable carrier fixture is warranted.
The following is a **sanitized field projection from C8**, with placeholders substituted
and private sender/receiver/address/POD data omitted; it is not a full response/schema or
an executable ShipIT `Observation`:

```text
orderInformation.trackingId / cAwbNumber -> exact external reference (coverage to verify)
orderInformation.partnerId / partnerCode -> source identity (namespace to verify)
statuses[].status / provider_status -> original source claim (dictionary to review)
statuses[].statusTimestamp -> documented Unix milliseconds (validate before UTC conversion)
statuses[].source -> polling or webhook provenance (not a trust grant)
```

Review C11's delivery ID separately from event-type routing: an event name is not a unique
delivery identity. Scope receipts by installation/source/version. Webhook IDs may dedupe
replays; poll/webhook cross-channel matching, corrections and stale conflicts remain #58.
Public tracking examples do not establish a stable poll event ID. Obtain repeat/correction
semantics before inventing a hash-based equivalence rule. Keep event and receipt times
separate; unknown manual timezone stays unknown. Do not overwrite evidence with the last
received status or treat an out-of-order delivered claim as accepted delivery proof.

C9 distinguishes reference, order and shipment AWB identities; none substitutes for a
ShipIT UUID. Source service and location strings require explicit mappings. Public sample
carrier IDs are examples to qualify, not installation identities to hard-code. Product
quotes do not publish customer prices or establish actual expense. C10's example has tax
classification/state values needing review; ShipIT must retain its own money/tax authority.
Preserve customer selling rates, purchase estimates and actual costs as separate facts.

Reuse [#53's port](../architecture/carrier-contract.md),
[#54's manual API](../architecture/manual-carriers.md) and
[#55's CSV specification](../architecture/carrier-csv-imports.md). Existing tables include
`carrier_installations`, immutable mappings/references, reserved `carrier_dockets`,
`carrier_observations` and durable command receipts. Composite foreign keys preserve
organization/franchise/parcel ownership; docket uniqueness is per installation. Indexed
owner/parcel access and organization transaction locks support scoped reads and safe replay.
Same intent key/body replays; changed intent conflicts; evidence/audit/receipt commit together.
Reference correction retains history and reservations. Unknown mappings stay explicit.
No new table, backfill, index, raw payload store or retention change is justified here.

Manual codes use bounded ASCII without spaces. If real references/status text do not fit,
do not truncate or rewrite them: obtain a separately reviewed compatibility decision before
pilot use. Missing facts remain unmapped; never invent carrier codes. R19 reads/W26 writes
apply; only the selected franchise admin writes. Claims remain `pending_review` and cannot
deliver, collect payment, authorize POD access or trigger messages. #58 owns reconciliation;
#59 owns normalized rate review; #60 owns operational qualification. Groq is unaffected.

## Research-to-decision and complexity review

Assume one small courier shop, one explicitly scoped franchise installation, the existing
Node 22.23.2/Fastify 5.12.3/raw pg/PostgreSQL 18.6 services, and no measured volume claim.
Sources below were reread on the evidence date. Recommendations are engineering judgment,
not assertions about Maruti's internal systems.

| Concrete problem / source | Decision, benefit and added complexity | How to verify |
| --- | --- | --- |
| Lost acknowledgement can duplicate entry: [AWS safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | **Adopt existing** scoped intent key/atomic receipt in #54/#55. No new coordinator. For future remote booking, `referenceId` alone is insufficient; uncertain create needs reconciliation despite generic guide advice to retry 5xx | Existing contract and real-DB replay/race/lost-ack tests; future remote semantics require legitimate tests |
| External status could bypass proof/money: [Microsoft translation boundary](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) | **Adapt existing** in-process #53 port and immutable reviewed mappings. Adds mapping work, preserves authority without a separate service | Delivered-claim tests leave lifecycle/payment/events unchanged; old mapping meaning persists |
| Wrong tenant/docket attachment: [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) | **Adopt existing** composite owner FKs and scoped uniqueness. Fits current transactions; no speculative schema | Real-DB sibling/foreign identity and collision tests |
| Untrusted callbacks, duplicates and reversed arrival: C11 | **Defer enabling**, retain documented raw-body verification, scoped delivery receipts and stale-state review as future requirements. Adds secret/receiver operations only if qualified | Legitimate signature vectors, tampering/replay/out-of-order tests before #60 live GO; no synthetic existence claim |

| Path | Feasibility / cost / risk | Recommendation |
| --- | --- | --- |
| Manual | Existing APIs, no carrier credentials; admin effort and stale/mistyped entries; actual branch authorization still needed | **Adopt** current pilot recommendation; #60 measures acceptable cadence/capacity |
| File | Existing bounded #55 ingestion (64 KiB, 200 rows, 20-row transactions); useful only with reliable permitted source | **Defer selection**; operator-built CSV is not a verified carrier export |
| Innofulfill live | Best official lead; needs product/account qualification, terms, signing/retry details and controlled tests | **NO-GO now**; if authorized, begin with own-tenant read-only tracking before booking/rates/webhooks |
| Partner/intermediary | Advertised integration leads; extra secrets, cost, source rights and provider dependence | **Defer** separate assessment; do not substitute another provider silently |
| Portal scraping/guessed APIs | Prohibited, fragile and unsupported | **Reject** |

Do not add a polling fleet, service, queue or circuit breaker to a documentation issue.
Existing local operations must survive carrier access failure. Manual health is
`not_applicable`, not a fabricated green network check. #60 must establish review cadence,
stale-source display, pending-case escalation and owner against actual shop volume.

## Usable fallback and future slice

1. Book through ShipIT; separately arrange real carrier booking/handover with the authorized
   branch. ShipIT local booking does not submit an Innofulfill order.
2. Franchise admin creates an own-franchise installation via
   `POST /api/v1/carriers/installations`, with code label `Shree-Maruti`; label is not identity.
   Reuse a reviewed scoped courier UUID when appropriate.
3. Link the exact branch docket via `POST /api/v1/parcels/:id/carriers/references`, current
   expected version and original service/location codes; leave unreviewed dimensions unmapped.
4. Record a sourced observation via `POST /api/v1/parcels/:id/carriers/observations` with
   original bounded status code, reviewed claim or null and known/unknown source time.
   Server supplies actor/receipt time; the claim remains pending review.
5. Reload evidence; retry lost responses with the same key/body. New correction uses a new
   key/current version and keeps history. Do not create another installation to evade collisions.
6. If branch contact or API access fails, retain last-known evidence/time, continue local
   operations and escalate to the franchise admin. Do not infer delivery or a new ETA.

All routes need authenticated scope selectors; POST needs CSRF/`Idempotency-Key`.
W26 denies operator/dispatcher/read-only writes. Foreign nested IDs are uniform 404;
stale versions/docket conflicts are 409; invalid inputs 422; temporary dependencies 503.
Read pagination/cursors follow the existing manual guide. No credentials/customer payloads
belong in codes, logs or the report. Existing service-only APIs require no new UI for #57.

After #58/#59 and reviewed research, #60 can qualify one authorized carrier slice with
fictional records and a recovery runbook. If live access is later verified, translate a
minimal own-tenant tracking slice outside local booking transactions; verify ownership,
timestamps and statuses before enabling it. Booking, rate feeds and callbacks each need
separate capability evidence. Confirm suppression/consent for carrier-generated SMS/email
before any account test; avoid duplicate customer communications. Later access is a new
scoped decision, not an obligation to invalidate a completed manual pilot.

## Four-outcome review

These are conditional decision cases, not four simultaneous carrier findings.

| Evidence | Complete research outcome / pilot | Gate |
| --- | --- | --- |
| Supported authorized API and legitimate tested bounded capability | `live_api` / `live_api`, with fallback | GO only for verified slice; documentation alone insufficient |
| No usable API; reliable authorized file demonstrated | `file` / `file`, with manual fallback | Record sample/provenance/format/permission; no API acquisition required |
| Authoritative denial of supported machine interfaces | `manual` / `manual` | Record denial and usable human route; all network/file capabilities can be false |
| Documented/private API but ShipIT-authorized testable access cannot be verified (**current**) | `api_unverified` / `manual`; file only if separately verified | Live NO-GO; owners/revisit conditions complete research after evidence review; no credentials/sandbox requirement for closure |

An unavailable or private-unverified API can each yield completed research. The stronger
absence conclusion needs affirmative evidence; it is inappropriate here given C5–C12.
Reviewed #57 releases only its research prerequisite for #60. #58/#59/#60 and their
milestone exit evidence remain required; no tracker closure or future capability is claimed.
