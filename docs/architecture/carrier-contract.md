# Carrier adapter contract v1

Issue [#53](https://github.com/ShippingCo/ShipIT/issues/53), 2026-10-03.
[Decision and research](../adr/0038-carrier-capability-contract.md) ·
[Verification](issue-53-verification.md) · [Typed contract](../../apps/api/src/modules/carriers/contract.ts) ·
[Fictional examples](../../apps/api/test/carrier-fixtures.ts).

## Purpose and implementation boundary

A shop can book a parcel even if its courier has no API. Later it can record the courier's
reference manually, import a file, or use a separately verified API. All three paths supply
evidence in the same form. They cannot independently declare a ShipIT parcel delivered or paid.

#53 provides a compiled server-only port, pure contract helpers, executable synthetic adapters
and this guide. It does not register adapters, save installations, accept files, call carriers,
reconcile observations, publish rates, provide screens or produce financial reports.
No LLM is involved; the existing Groq integration is untouched.

The subsequent [#54 manual workflow](manual-carriers.md) implements scoped persistence,
manual adaptation and authorized API commands on this contract. Later import/reconciliation
and network capabilities remain separate.

## Milestone sequence

| Issue | User outcome and dependency |
| --- | --- |
| #53 | Common evidence/capability vocabulary; requires merged #2/#3/#4 |
| #54 | Authorized manual references and observations; uses #53 plus scoped parcel/audit services |
| #55 | Validated, resumable CSV imports; builds on #54 and durable jobs |
| #56/#57 | Dated Akash Ganga/Maruti access research; uses #53 and security contracts |
| #58 | Deduplicate and reconcile manual/file/API observations; uses #54/#55 and parcel commands |
| #59 | Review and publish normalized rates; uses #53/#55 and Pricing |
| #60 | Demonstrate one supported manual, file or live path with recovery; waits for research and ingestion/rates |

M4 enables private customer self-service. M5 supplies better external carrier evidence to
the existing authoritative services. M5 does not require M4 completion to start research.
Lack of an API can be a completed research outcome with a manual fallback. It does not waive
scope, proof, payment, consent or audit rules. Finance additions to #53/#59 preserve source
identity; #137/#141/#147 and reporting issues own their later financial behavior.

## Capabilities, inputs and outputs

An installation is organization-owned with explicit permitted franchise IDs, a stable courier
ID, contract version and monotonic configuration revision. Capabilities are independent;
each true value includes a reviewed evidence ID and verification timestamp. False means
unavailable/unverified, not temporary health. Mode is recorded on each observation; one
installation may support multiple modes. Manual-only is a legitimate final configuration.

| Port | Capability | Output |
| --- | --- | --- |
| `observe` manual | `manual_observations` | Sourced observation claims |
| `observe` file | `tracking_import` | Sourced observations from a private import ID |
| `observe` poll / verified receipt | `tracking_api` / `webhooks` | Sourced observations; webhook verification precedes this port |
| `rates` selling file / API | `selling_rate_import` / `selling_rate_api` | Customer-selling candidate, not published prices |
| `rates` purchase file / API | `purchase_estimate_import` / `purchase_estimate_api` | Estimated supplier cost candidate, never actual cost |
| `submitBooking` | `booking_api` | Scoped external reference, separate from the local Booking |
| `health` | No fabricated network requirement | Manual/file `not_applicable`; API `unknown`, `healthy`, `degraded`, `auth_failed` |

Absent capabilities return `{ok:false,error:{kind:'unsupported',capability:...}}` without
network access, credentials or an exception containing a raw provider message. Every adapter
must check its current declared capability before effects. The fixtures demonstrate that
contract; production gating remains with later adapter composition. An accepted external
booking reference does not mean physical delivery or payment. A response must match the
requested installation, franchise, courier and immutable booking snapshot before retention.

The context carries organization/franchise/installation scope, stable operation ID, request fingerprint, installation revision, deadline
and cancellation signal. It contains no database executor, delivery service, payment service
or secret. Private file IDs and verified callback receipts are resolved by authorized server
composition; arbitrary caller-supplied IDs are not proof of access.
Only shipment-specific inputs/outputs carry an external docket. Rate retrieval and a new
external booking do not require an external reference before the carrier has assigned one.

## Identity, mappings and time

- Keep ShipIT dockets distinct from external dockets. External uniqueness is installation plus
  exact external docket; operational references also carry organization and franchise. A
  shared installation must not map the same external docket to multiple franchises. #54
  must enforce this unique constraint and ownership joins; `referenceKey` is a scope-qualified
  in-memory key, not a substitute for the database uniqueness rule.
- Courier/service/location IDs are opaque internal IDs, stable across renames. Carrier labels,
  route `carrier_code`, postal codes and free-text destinations are source values, not identity.
  Preserve case/punctuation of external codes unless dated carrier evidence approves a versioned
  normalization. Never infer a mapping from a display-name match.
- Mapped values include mapping-version ID; unknown service/location/status has an explicit
  `unmapped` value. Corrections create new versions with actor/reason and retain old references.
  Observed statuses use `_claim` names; they are not `ParcelStatus` or writable canonical state.
- Known times use RFC3339 instants with an explicit UTC offset, canonicalized to UTC. Unknown
  timezone, missing or invalid source time stays unknown; never substitute receive time as
  occurrence time. Receive time is server assigned. Stale/future/conflicting evidence requires
  #58 review; receiving a newer message does not prove a newer physical event.
- Manual provenance includes authenticated actor and command ID. File provenance includes
  immutable SHA256, import ID and positive physical row number (header is row 1). API provenance
  includes durable receipt ID, poll/webhook channel and provider event ID when available.
  A source record ID is mandatory; it is not a promise of cross-channel deduplication.

Validate UUIDs/registered IDs, closed enums, bounded lengths, timestamps, digest formats,
positive row numbers, ownership and response-size limits at downstream untrusted boundaries.
The typed port does not parse raw JSON, CSV or network input and is not a runtime validator.
Only minimal normalized codes belong here, never raw addresses, transcripts or provider bodies.

## Authorization and database ownership

Reuse [the authorization matrix](authorization-contract.md), [scoped queries](tenant-query-isolation.md)
and [domain ownership](domain-contract.md). R19 governs safe observation/reference reads;
W26 permits reviewed manual reference/import commands only to own-franchise `franchise_admin`.
Older #54 prose mentioning dispatcher does not expand W26. Dispatcher lifecycle W09 and
read permission do not authorize an import/configuration write. `read_only` cannot mutate.
W27 governs publication of local pricing, not adapter receipt of a candidate.

| Example | Required outcome |
| --- | --- |
| org_admin reads authorized Org A evidence | R19 within own organization; installation and selected franchise still match explicit scope |
| franchise A staff reads A evidence | R19 role/projection plus current membership and installation grant |
| A staff selects installation assigned only to B | Uniform not-found; no private rows/counts/errors |
| A installation selected for B with own-org read scope but no installation grant | Denied; org-wide visibility cannot invent an installation grant |
| B explicitly granted installation and caller has B scope | Selection can match; command action checks still required |
| Org C selects Org A installation | Denied regardless of matching carrier or docket |
| org_admin or read_only attempts W26 | Denied; organization visibility is not a local command role |

`matchesInstallation` checks both sets of scope as a pure contract predicate. It accepts
trusted inputs only and must not be exposed as an authorization endpoint. #54 must derive
current scope from the existing membership boundary, reauthorize retries, check nested parcel
IDs, and resolve installations with parameterized scoped queries. Existing grants do not
imply a new right to create org-wide installations: organization configuration W35 is denied.
Organization-wide configuration needs a reviewed matrix change before any such endpoint.
No additional action or role is introduced here.

Current routes persist `carrier_code`; bookings persist immutable customer/pricing/tax
snapshots; parcels own globally unique ShipIT dockets and guarded state; payments own ledger
entries and deliveries own proof. Those tables and their scope/uniqueness/immutability controls
are reused. No installation or mapping table exists yet. #53 makes no schema or data-access
change, so no backfill/migration is appropriate. #54/#58 must persist mappings/observations
and atomic audit/outbox effects without copying customer directories or silently reinterpreting
legacy route strings. Old bookings retain historical snapshots when later mappings/rates change.

## Finance provenance

`RateCandidate.purpose` must distinguish `customer_selling` from `courier_purchase_estimate`.
Both retain courier/service/origin/destination, source record/version, effective dates, scope
and provenance. INR paise and grams are exact safe integers; no float currency conversion.
`validRateUnits` rejects unsupported currency, negative/fractional/unsafe amounts and nonpositive
weights. #59 owns bounded file schemas, slabs/lanes, overlap checks, reviewed mapping and pricing
publication. A rate candidate is not a price override or a write to a customer negotiation (#141).

Actual cost has a separate read-only evidence union: `unknown` or a versioned #147 owning-service
reference. Adapters cannot create it through `rates`. Missing cost is not zero and an imported
estimate is not actual expense. #147 will ratify and implement actual-cost persistence; this
contract only reserves its ownership/source reference and does not claim that service exists.

Fictional source-to-total example in the tests: two saved booking snapshots for the same
courier/service/destination total **30,003 paise**. One has an estimated purchase cost of
6,500 paise but **unknown actual cost**. The second references actual-cost evidence of
12,001 paise. Known actual total is 12,001 with one missing cost; full profit is unknown.
Publishing a new 7,000-paise estimate does not change either saved selling snapshot.
No report, ledger or estimated-profit feature is implemented by this example.

## Failure, retry and concurrency contract

| Outcome | Recovery |
| --- | --- |
| `unsupported` | Keep local workflow usable; show supported manual/file path |
| `retryable`, explicitly `not_accepted` | Bounded worker retry using same identity; respect validated retry-after and jitter |
| `permanent` | Reject/quarantine malformed input/response or conflict; no automatic retry |
| `auth` | Authorized owner repairs credentials/configuration; never retry endlessly |
| `uncertain` | Retain operation ID, reconcile external acceptance; never blindly resubmit booking |

Timeout after possible external acceptance is uncertain, not proof of failure. Before effects,
composition rechecks installation revision/capabilities/grants; stale revision rejects without
I/O. Abort/deadline expiry stops waiting but cannot prove provider cancellation. #60 must set
positive bounded connection/total timeouts, response limits, maximum read attempts and jitter
from verified provider behavior and worker lease budgets. No invented carrier SLA/default is
introduced in #53. One layer owns retries; provider SDK retries must not multiply worker attempts.

Use [existing idempotency rules](idempotency-contract.md): scope plus operation ID plus immutable
fingerprint; same intent replays, changed reuse conflicts. #54 manual command receipts, #55
file digest/row progress and #58 provider identities preserve durable outcomes across restart.
Cross-channel fallback must reconcile semantic observations, not manufacture new transition or
message identities. Lock/check expected canonical versions; persist state/audit/outbox atomically.
Keep uncertain/stale/unmapped/conflicting evidence reviewable. Retention follows owning privacy
policy; no duplicate raw bodies, secrets or new retention schedule here.

## Credentials, network and health

Only a future network capability receives `NetworkPolicy` from trusted server composition.
`credentialRef` is an opaque secret-store reference resolved for that installation, never a
token, client field or shared/browser export. Rotation preserves installation identity and
audit; resolve current authorized version at dispatch. Manual/file need no fake credential.

`endpointProfileId` selects a reviewed HTTPS origin/path allowlist. No arbitrary URLs from
customer, file, callback or provider redirect are allowed. Future transport must reject embedded
credentials, disable redirects, validate/pin resolved public addresses including IPv6 and DNS
rebinding cases, block loopback/private/link-local/metadata targets, bound response size, and
apply egress controls. A hostname syntax check alone is insufficient. #53 opens no sockets.

Health records source/freshness without secrets. Manual/file show last successful observation
or import in their later workflows, not a green API badge. API `unknown` is not healthy;
auth failure requires repair. Health must not veto local booking, pricing or delivery services.
Persisted health/alerts/runbooks belong to #60. Logs use controlled codes, operation/correlation
references and duration; never serialize credentials, full requests/responses or raw exceptions.

## Run the contract demonstration

Use Node 22.23.2, pnpm 10.34.5 and Python 3.12.14 as documented in
[quality checks](../QUALITY_CHECKS.md). No credentials or running API are needed for fixtures.

```sh
pnpm --filter @shippingco/api test test/integration/carrier-contract.test.ts
pnpm typecheck
pnpm check:planning
pnpm lint
pnpm db:local quality
pnpm check:migrations
```

On this Windows checkout the existing `node_modules/.cache/issue35/run.ps1` wrapper selects
the pinned toolchain; pass the same arguments after the script path. Test adapters are synthetic;
live access, persistence, browser flows, import recovery and provider security need the later
owning issue's tests. No new setup keys, migration, deployment or frontend changes are needed.
