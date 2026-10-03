# Akash Ganga integration access research

Issue [#56](https://github.com/ShippingCo/ShipIT/issues/56), researched **2026-10-03 (IST)**.
Status: local research decision for review; no carrier integration is implemented here.
[Acceptance and checks](../architecture/issue-56-verification.md) ·
[PR draft](../architecture/issue-56-pr-draft.md).

## Decision

| Field | Result |
| --- | --- |
| Research outcome | `api_unverified` |
| Live API decision | **NO-GO / NOT CURRENTLY VERIFIED** for this pilot |
| Selected pilot mode | `manual` |
| Selected capabilities | `manual_operations=true`; `tracking_api=false`, `booking_api=false`, `rate_api=false`, `webhooks=false`, carrier-qualified `file_import=false` |
| Operational owner | Pilot franchise admin for entries and source checks; #60 implementation owner for qualification, freshness and recovery |
| Access/commercial owner | ShipIT maintainer, subject to explicit user authorization for any contact/application |
| Revisit condition | Official written integration permission, documented capability contract and legitimate test access; or an authorized, repeatable file source with a sanitized sample and known semantics |

A shop can continue booking in ShipIT, hand the parcel to its authorized carrier branch,
and have its franchise admin record the carrier docket and observations. This does not
require an API account, portal automation or an export. Public carrier material supports
human branch operations; it does **not** establish supported machine access. This is a
recommendation for #60's qualification, not evidence that a real pilot has already run.

The current API advertises generic `tracking_import=true` on local installations after
#55. That describes ShipIT's CSV implementation, **not** Akash Ganga export availability
or a carrier-qualified file mode. The selected manual adapter uses `manualCapabilities`
and no file/network operations. #56 changes no manifest, installation or endpoint.
There is no existing per-carrier file qualification toggle to claim we switched off.
Keep the generic CSV service separate from the selected pilot path; #60 must report this
distinction instead of interpreting a generic capability flag as carrier evidence.

API acquisition is not a completion gate. After evidence review, this result satisfies
#56's research prerequisite for #60. #57, #58, #59 and #60's own acceptance gates remain.
Future access warrants a separately scoped adapter review; it does not silently reopen
this research or invalidate a completed manual pilot.

## Identity, evidence and method

Target: **Akash Ganga Courier Limited**, the Indian courier/cargo operator identifying
itself on the AGC website, with its Loonkaransar origin and Express/OLT/cargo services
[C1–C3 below]. It is not Akash Kargo, the Aakashganga publishing platform or an unrelated
AGC organization. The evidence identifies the carrier's published name and services;
it does not independently verify a corporate registry entry, CIN/GST registration or
the contracting entity of the eventual local franchise. The maintainer must confirm
those on the branch agreement before commercial onboarding.

All entries below were inspected or attempted on **2026-10-03**. Access dates are the
research date, not a claim about a page's publication date or current service uptime.
No accounts, credentials, applications, shipment lookups, carrier calls, tracking-page
scraping, portal automation or endpoint discovery were used. Public informational
pages and targeted public search were sufficient to make the current no-go decision.

### Dated primary-source evidence matrix

| ID / source URL | Retrieval and finding | Classification / confidence | Unresolved owner / next action |
| --- | --- | --- | --- |
| C1 [AGC home](https://agcgroup.in/) | Read public text. Names the carrier; describes branch pickup and online tracking; links service/contact/policy pages. Uses an `@akashganga.info` contact. A consumer interface is not an API specification. | `confirmed` published operational route; high for page contents, moderate for actual availability | Maintainer: confirm branch identity/authorization before real operations |
| C2 [About](https://agcgroup.in/about-us/) | Read public text. Identifies Akash Ganga Courier Limited and its courier/cargo business and Loonkaransar history. | `confirmed` self-identification; high for contents | Maintainer: confirm legal contracting entity from agreement, not a label |
| C3 [Services](https://agcgroup.in/service/) | Read public text. Express, Air/Surface Cargo, OLT Regular/Premium/ODA and tracking are advertised. No machine service/status/location dictionary appears here. | `confirmed` advertised services; `not verified` machine identifiers, high for distinction | Integration owner: require a documented code dictionary before mappings |
| C4 [Contact](https://agcgroup.in/contact/) | Read public text. Lists `delhi@akashganga.info`, 9555755992, 9953138719 and 011-41078560. These are general contacts, not a verified developer-support channel. | `confirmed` published contact route; high | Maintainer: after user authorizes contact, request official technical/commercial contact |
| C5 [Partner onboarding](https://agcgroup.in/become-a-partner/) | Official-domain search-index text describes application review, emailed login details and a booking/tracking/report panel. Direct page fetch returned cache miss twice. Indexed description establishes an advertised process only; panel access/export/API not tested. | `not verified` present access/technical behavior; moderate for indexed description | Maintainer: authorized review of actual current process; do not submit form now |
| C6 [Franchise](https://agcgroup.in/franchise/) | Read public text. Provides franchise application fields and a KYC-form link. No form submitted or KYC document downloaded. | `confirmed` advertised application route; high | Maintainer: review current agreement/eligibility only if onboarding is authorized |
| C7 [Terms](https://agcgroup.in/terms/) | Read after slash URL succeeded (initial non-slash fetch failed). Carriage, claims and POD terms are present. No supported API licence, quota, sandbox or integration fee schedule found in this page. | `confirmed` carriage terms; `unknown` integration commercial terms, high | Maintainer: obtain explicit machine-use rights and fee/limit schedule before live work |
| C8 [Privacy](https://agcgroup.in/privacy-policy/) | Read public text. Describes handling shipment/customer data; gives no numerical integration retention schedule or processor agreement. | `confirmed` published policy; `unknown` integration-specific data terms, high | Maintainer: request permitted fields, retention, subprocessors and incident obligations for any machine interface |
| C9 [Shipment policy](https://agcgroup.in/shipment/) | Read public text. Describes documentation, dimensional charging and insurance responsibility. This is not a rate API, a negotiated rate card or a service-code schema. | `confirmed` operational policy; `not verified` machine pricing, high | Pricing/access owner: confirm applicable negotiated tariff; #59 owns reviewed rate normalization |
| C10 [Linked app listing](https://play.google.com/store/apps/details?id=com.infosoftsolutions.akashgangacourier&pli=1) | Followed website's Play link. Publisher listing describes AGC products/online tracking. App internals not inspected; an app is not a supported integration contract. | `confirmed` linked listing; `not verified` integration rights, moderate | No app reverse engineering; maintainer obtains carrier documentation if needed |
| C11 [Legacy hostname](https://www.akashganga.info/) | HTTPS www/non-www and HTTP entry attempts were inaccessible through the research tool. AGC pages still use that email domain. No redirect or replacement-domain relationship was verified. | `unavailable` **to this research tool**, high; carrier/API status `unknown` | Maintainer: verify domain ownership through authorized official contact if needed; do not infer outage or no API |

Evidence terms: `confirmed` means the cited source directly supports the bounded finding;
`unavailable` means an observed access failure or explicit denial, with its scope stated;
`not verified` means a possible capability lacks supported/authorized/testable evidence;
`unknown` means a required parameter has no reliable value. Confidence refers to the
finding, not to a guessed API's existence. No carrier has explicitly denied API access.

Search boundary: searches for Akash Ganga official integration and domain-restricted
API/CSV/export/SFTP/sandbox/webhook documentation returned no usable carrier specification.
Third-party tracking aggregators appeared as leads; none was used to prove an official
carrier API, obtain endpoints or justify a new provider. Search absence is not proof that
a private API does not exist. Failed legacy retrieval and indexed partner text limit the
investigation but do not prevent the conservative manual decision.

### Follow-up deep lookup: intermediary APIs

The user requested a deeper lookup on **2026-10-03**. Searches covered both carrier
domains, spelling variants, public developer/API/web-service/Swagger/Postman/SDK material,
partner access and exports, then provider-owned integration pages and API documentation.
No usable carrier-published integration contract emerged. This establishes a research
limit, not absence of a private API. Unrelated pharmaceutical APIs, corporate-directory
APIs and similarly named software vendors were excluded.

The deeper search found **credible intermediary tracking leads**. Provider documentation
is primary evidence about that provider, not about Akash Ganga's own supported interface.
No account, API request, tracking lookup, signup, notification or outreach was performed.
Indexed tracking-page descriptions were leads only; no tracking pages were scraped.

| ID / primary source | Retrieval and bounded finding | Classification / next qualification |
| --- | --- | --- |
| D1 [AfterShip integration](https://www.aftership.com/integrations/carriers/akashganga) | Official provider search-index text advertises Akash Ganga integration and requires active AfterShip and carrier accounts. Direct retrieval failed. | `confirmed` indexed advertised offering; `not verified` present account access, coverage or functioning |
| D2 AfterShip [authentication](https://www.aftership.com/docs/tracking/quickstart/authentication), [quick start](https://www.aftership.com/docs/tracking/quickstart/api-quick-start), [supported couriers](https://www.aftership.com/docs/tracking/others/supported-couriers) | Read generic API-key authentication, tracking retrieval and webhooks. The retrieved supported-courier table contained no match for Akash/Ganga, despite D1. | `confirmed` provider API documentation; `not verified` Akash Ganga support in that API. Require provider confirmation and authorized account-specific courier discovery; do not invent a slug |
| D3 [Shipway supported couriers](https://experience.shipway.com/courier-list) | Read provider list explicitly naming Akash Ganga. Did not open the carrier tracking link. | `confirmed` published listing; `not verified` current API coverage, source rights or freshness |
| D4 Shipway [API documentation](https://apidocs.shipway.com/) and [legacy client PDF](https://shipway.shipway.in/plugins/shipway-order-tracking-notify/Shipway_Docs_for_client_v_1.3.pdf) | Current docs returned no extractable text. Legacy PDF labels API version 3.1.2, has 2015 examples, username/licence-key auth, courier discovery and tracking registration/retrieval. It describes automatic customer emails/SMS. | `confirmed` historical provider API; `unknown` current contract. PDF filename version is not the API version. Do not implement from old examples or register customer shipments without reviewing notification controls |
| D5 TrackingMore [API landing](https://www.trackingmore.com/nl/agc-tracking-api?referral=agc) and [carrier description](https://www.trackingmore.com/sv/agc-tracking) | Provider's indexed API marketing claims conflict with its indexed carrier description explicitly saying Akash Ganga tracking is unsupported. No tracking page opened or queried. | `not verified`; conflicting provider evidence disqualifies the landing page as support proof |

Shipway is the clearest explicit carrier-list lead; AfterShip has stronger readable
developer documentation but a support-list discrepancy. Neither was tested. No Akash
Ganga-specific booking, rate feed, webhook event contract or export was verified through
these providers. Generic provider webhooks do not establish carrier-native webhooks.

A future intermediary assessment must obtain current written carrier coverage, account
eligibility, permitted data processing/source rights, pricing, freshness limits, stable
event identities, correction behavior and sanitized examples. Verify exact carrier IDs
through authorized account documentation/discovery, then test consented shipments with
customer notifications disabled and minimal data. Keep provider-normalized statuses as
reviewable claims under #58; they are not carrier codes or delivery proof. This is a
separate provider decision, with added credentials, cost and dependency. It does not
enable capabilities or change the current `api_unverified` / `manual` recommendation.

## Capability and access findings

| Required capability | Verified carrier availability | Pilot selection / ShipIT contract |
| --- | --- | --- |
| `tracking_api` | `not verified`: online tracking advertised, no supported endpoint/auth/schema/test access | Disabled: `tracking_api=false` |
| `booking_api` | `not verified`: branch operations and partner panel advertised, no supported booking API | Disabled: `booking_api=false`; local ShipIT booking continues |
| `rate_api` | `not verified`: service/charging information is not a rate feed | Disabled: `selling_rate_api=false`, `purchase_estimate_api=false` |
| `webhooks` | `not verified`: no signing, replay, event identity or delivery contract found | Disabled: `webhooks=false` |
| `file_import` | `not verified`: no carrier CSV/export/SFTP contract or legitimate sample obtained | Not selected; #55 generic `tracking_import` exists independently. Rate import is #59, not enabled by #55 |
| `manual_operations` | `confirmed` as a publicly described branch/contact workflow, not exercised live | Selected: `manual_observations=true` in the manual adapter; own authorized franchise only |

Technical next actions below are **conditional backlog**, not work required to acquire
access for #56 completion. Owners are responsibilities, not claims someone accepted an
assignment. The ShipIT maintainer assigns a person when the work is authorized.

| Required question | Current answer | Owner and next action / trigger |
| --- | --- | --- |
| API authentication / credentials / scopes / rotation | `unknown`; portal login is not API authentication | Integration owner: request official auth contract and installation scope if machine access is proposed |
| Contact/access requirements | General contact and franchise/application routes published (C4–C6); API approval requirements `unknown` | Maintainer: request developer contact and written rights after explicit outreach approval |
| Sandbox / production separation / test accounts | `unknown`; no legitimate test access | Integration owner: require isolated authorized test account and sanitized samples before live GO |
| Request/batch limits / polling frequency / pagination / SLA | `unknown`; no numerical defaults asserted | Integration owner: obtain documented limits and choose bounded budgets under #53/#60 |
| Fees / minimum volume / account eligibility / termination | `unknown` for integration; carriage terms alone insufficient | Maintainer: obtain written quote/agreement if pursuing machine access; no commitment now |
| Permitted use / exports / redistribution / retention | `unknown` for third-party processing; C8 is not integration permission | Maintainer: verify data-use rights for a proposed API/file before selecting it |
| Booking acceptance / cancellation / idempotency / duplicate detection | `unknown` | Integration owner: require reconciliation by stable operation/reference identity; never blindly retry uncertain bookings |
| Tracking status codes / event IDs / sequence / cursor / correction behavior | `unknown` | Integration owner: ask for dictionary, stable identities and correction/out-of-order examples before #58-specific mapping |
| Timezone / timestamp precision / clock skew | `unknown` | Integration owner: preserve unknown time; obtain explicit timezone instead of assuming IST from carrier geography |
| AWB/docket pattern / case / reuse / checksum | `unknown`; no universal pattern inferred | Franchise admin: use actual authorized branch reference; integration owner confirms namespace/reuse rules before automation |
| Location/branch codes / service IDs / lane coverage | Human service names verified (C3), machine identifiers `unknown` | Franchise admin: review exact source codes; #59 owner verifies service/location dictionary and effective dates |
| File dialect / encoding / units / provenance / frequency | `unknown`; no export permission or sample | Maintainer and integration owner: acquire authorized repeatable source, provenance and sanitized sample to reconsider file |
| Contracting entity / franchise entitlement | Published name identified, legal record and local entitlement `unknown` | Maintainer: inspect real agreement before pilot use; public research is not a commercial authorization |

## Formats, storage and reconciliation limits

No legitimate Akash Ganga API payload, rate card or export sample was available.
**No carrier payload fixtures are supplied.** Existing fictional #53–#55 fixtures test
ShipIT behavior only; their `STD`, `MOVE`, `DONE` and `SYN-*` values are not carrier codes.
Do not infer a status dictionary from web labels or map OLT names to guessed IDs.

Reuse the [v1 port](../architecture/carrier-contract.md),
[manual workflow](../architecture/manual-carriers.md) and
[CSV specification](../architecture/carrier-csv-imports.md). Exact dockets stay scoped
by organization/franchise/installation; stable courier UUIDs are not brand names.
Manual codes use the existing bounded ASCII grammar. An actual branch reference outside
that grammar needs a separately reviewed compatibility decision; do not strip characters
or truncate it to force acceptance. Unknown dimensions/status remain unmapped; unknown
timezone remains explicit. Source time and server receipt time have different meanings.

Existing persistence is sufficient: `carrier_installations`, immutable mappings and
references, reserved `carrier_dockets`, `carrier_observations`, and command receipts.
Composite ownership foreign keys prevent cross-franchise references; docket uniqueness
is installation-scoped. Indexed owner/parcel lookups and R19/W26 authorization remain.
Organization transaction locks serialize writes and receipt replay. Same key/body replays;
changed intent conflicts; mapping/reference corrections retain historical meaning.
#55 also persists digests, safe rows and outcomes, discards raw bytes, and resumes batches.
No new table, index, backfill, retention policy or raw customer storage is justified for
a public research report. Released migrations, secrets and Groq remain untouched.

Manual observations currently stay `pending_review`. A carrier delivery/POD statement
is not accepted ShipIT proof, a payment or an automatic message. #58 owns cross-channel
deduplication, stale/conflict review and permitted transitions through parcel services.
#59 owns rate candidates/publication; selling amounts, estimated purchase costs and actual
cost evidence remain separate (#147 owns actual costs). Neither the carrier's public
shipping policy nor its delivery terms replace ShipIT's proof, tax or money rules.

## Alternatives and engineering decisions

Assumptions: a small courier shop, one explicitly scoped franchise installation, Node
22.23.2/Fastify 5.12.3/raw pg/PostgreSQL 18.6, and the existing API/service workflow.
No throughput or staffing capacity has been measured; manual volume suitability must
be checked by #60. The following decisions are engineering judgment informed by sources,
not claims that those sources document Akash Ganga's systems. Sources checked 2026-10-03.

| Option | Fit, cost and risk | Decision |
| --- | --- | --- |
| Existing manual path | Smallest code/operating change; no carrier secrets/network. Admin entry takes time and can be stale or mistyped; retains source/history and review | **Adopt** for current pilot recommendation; #60 demonstrates real authorized workflow and recovery |
| Existing file path | Lower repetitive entry if a permitted repeatable source exists; requires verified columns, source IDs, times and mappings. Generic #55 is 64 KiB/200 rows, 20 rows/commit | **Defer selection** pending separate file evidence; do not call operator-made files an official export |
| Live adapter | Needs permission, authentication, tested semantics, failure/reconciliation rules and ongoing support. Cost unknown without commercial/access details | **NO-GO now**; reconsider only on explicit revisit evidence |
| Portal scraping/private endpoint discovery | No supported integration contract; fragile behavior and unverified rights | **Reject**; no automation or guessed endpoints |
| Documented intermediary tracking API | AfterShip/Shipway leads above; adds provider credentials, fees and dependency. Carrier-specific availability/rights/semantics remain unqualified | **Defer** to a separately authorized provider assessment; no new provider in #56 |

| Problem / primary engineering source | Adopt, adapt or defer; repository fit, benefit and complexity | Verification |
| --- | --- | --- |
| Retried commands could record twice: [AWS Builders' Library](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/) | **Adopt existing** scoped intent keys plus atomic receipt/effect from #54/#55. Fits PostgreSQL transactions; avoids duplicate evidence with no new coordinator. A future unknown external booking outcome still needs reconciliation | Existing contract uncertainty tests and real DB replay/race/lost-ack tests; no remote idempotency claim |
| External status could bypass proof/money: [Microsoft translation boundary](https://learn.microsoft.com/en-us/azure/architecture/patterns/anti-corruption-layer) | **Adapt existing** in-process carrier port, not a new service. Claims retain provenance and explicit unknowns; mappings add review work but preserve domain authority | Delivered-claim tests keep parcel/proof/payment/events unchanged; mapping-history tests preserve old meaning |
| Tenant/docket collision: [PostgreSQL 18 constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) | **Adopt existing** composite ownership FKs and installation uniqueness. Fits raw SQL and current small transactions; no new schema or global AWB assumption | Existing real DB foreign-ID/namespace/role tests, not just TypeScript predicates |
| Unknown live retry/health budgets | **Defer network implementation** to verified #60 capability. Keep #53's uncertainty and bounded-retry rules; do not invent carrier limits or healthy badges | Current manual adapter returns `not_applicable` health and unsupported network operations without credentials |

The reviewed risk is manual freshness and source accuracy, not a distributed transport
design. #60 must name a review cadence and escalation owner appropriate to observed shop
volume, show last recorded source/receipt time and pending cases, and prove recovery from
lost responses and unavailable carrier contact. A separate service, polling fleet or queue
would add operating cost without a verified interface and is not required here.

## Usable fallback and downstream implementation slice

No refused or missing API blocks this supported **local** workflow:

1. Book normally through the existing ShipIT booking service. Confirm actual carrier
   handover/booking via the shop's authorized branch arrangement; ShipIT does not submit it.
2. The selected franchise admin creates a scoped installation labelled `Akash-Ganga`
   using `POST /api/v1/carriers/installations` (permitted code label, not legal identity).
   Reuse a reviewed scoped courier UUID where appropriate; no brand-name identity merge.
3. Link the exact branch-issued docket to the existing parcel through
   `POST /api/v1/parcels/:id/carriers/references`, with current version and reviewed
   source dimensions. Codes not yet verified remain unmapped.
4. Record a sourced observation using
   `POST /api/v1/parcels/:id/carriers/observations`, with original code, selected claim
   or null, and known/unknown source time. The API supplies actor and receipt time.
5. Reload references/observations; same-intent retries use the same key. A correction
   uses a new command and expected version. Do not create a second installation or
   change docket spelling to evade a conflict. Ask the franchise admin to review it.
6. If carrier contact is unavailable, retain last-known evidence and its time, keep local
   operations usable, and escalate to the admin. Do not infer delivery or invent ETA.
   #60 supplies the operational freshness/recovery runbook; #58 supplies reconciliation.

All POSTs require an authenticated own-franchise admin, CSRF and `Idempotency-Key`;
R19 controls reads. Ordinary dispatcher/operator/read-only roles cannot write under
W26. Foreign IDs are indistinguishable from unknown IDs. No shared portal credentials
or cross-organization directory access is introduced. Existing service-only delivery
has no new operator UI; #56's reproducible artifact is the report, not a fabricated screen.

For #60, reuse these services, qualify one actual authorized manual carrier slice,
demonstrate it with fictional records and completed #58/#59 foundations, and record
its limits and operational owner. If exports later become available, validate rights,
units, exact identifiers and retry provenance before selecting file mode. If live access
later passes verification, adapt #53's port outside local booking transactions; enable
only proven capabilities with server-side credentials and reviewed network policy.
No later feature is implemented or dependency waived by this report.

## Review all four possible outcomes

These are conditional decision checks, **not additional carrier findings**:

| Evidence case | Complete research outcome / pilot | Completion and revisit rule |
| --- | --- | --- |
| Supported, authorized API and legitimate bounded test access verified | `live_api` / `live_api` for verified slice, with manual fallback | Record capability tests, terms and recovery before GO; no guessed capabilities |
| API unavailable/unusable, separately authorized reliable file demonstrated | `file` / `file`, with manual fallback | Record schema/source/permission and retry limits; no requirement to obtain an API |
| Authoritative evidence says no supported machine interface is available | `manual` / `manual` | Record the denial and usable human route; all network/file capabilities may be false |
| Private API may exist but supported authorized access cannot be verified (**current case**) | `api_unverified` / `manual` (file only if separately verified) | NO-GO live; unknown owners/revisit conditions are enough after evidence review; credentials/sandbox not required |

Unavailable/private-unverified cases both produce a complete decision. The former needs
affirmative evidence for its stronger claim; the latter does not pretend public search
proves a private API absent. Missing access is not a skipped acceptance test. Reviewed
research releases only #56's prerequisite, not #60's entire dependency chain.
