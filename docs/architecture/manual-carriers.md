# Manual carrier workflow

Issue [#54](https://github.com/ShippingCo/ShipIT/issues/54), extending the
[v1 carrier contract](carrier-contract.md). [Decision](../adr/0039-manual-carrier-evidence.md)
and [verification](issue-54-verification.md).

[#58 reconciliation](carrier-reconciliation.md) now projects saved observations into
a scoped review queue. The original evidence remains immutable; any approved state
effect is a separate decision through the Parcel service.

## What it does

A shop can book normally without a carrier connection. Its franchise admin can then
register a manual carrier, link the carrier docket to a ShipIT parcel, and record what
the carrier reported. A `delivered_claim` remains a manual claim pending review: the
parcel does not become delivered and no payment is collected. There are no provider
credentials, network calls, additional packages, LLM calls or background sends.

The [#55 CSV service](carrier-csv-imports.md) now adds reviewed file imports to these
installations. Listings advertise `tracking_import`; the manual adapter stays manual-only.

This is an API/service workflow, with no new operator screen. The issue permits
service-only delivery; the reproducible API fixture below exercises the real routes,
sessions, CSRF, owning services and PostgreSQL. It is not a browser or live-carrier demo.

## Permissions and scope

W26 allows **franchise_admin** writes in their selected franchise. Organization admins,
operators, dispatchers, accountants, delivery agents and read-only staff cannot write.
The existing matrix and #53 supersede the issue's historical dispatcher wording.
Manual setup is part of the local W26 workflow, not organization-wide W35 configuration.

R19 permits organization admins within their organization and franchise admin/operator/
dispatcher/read-only within their franchise. Accountants are denied. Delivery agents
may read evidence only for their currently assigned parcel; they cannot browse installation
configuration. Reads and retries resolve current membership. Foreign nested IDs return the
same 404 as unknown IDs; no rows/counts are returned. No cross-franchise custody grant is
invented; broader C relationships retain the existing shipment-service limitations.

An installation is organization-owned with exactly one explicit franchise grant in this
release. Creating shared grants is deferred. Courier IDs are stable UUIDs: setup generates
one, or reuses an existing courier ID visible in the same franchise. Labels never establish
identity. The same exact external docket is valid at two installations, even for the same
courier. It cannot identify two parcels at one installation.

## API contract

All routes require `organization_id` and `franchise_id` query selectors, authenticated
session and ordinary API error envelopes. POST also requires CSRF and one `Idempotency-Key`.
Bodies reject unknown keys; callers cannot provide actor, ownership, receive time or proof.

| Method and path | Body / result |
| --- | --- |
| POST `/api/v1/carriers/installations` | `{label, courier_id?}`; courier ID omitted/null creates an identity |
| GET `/api/v1/carriers/installations` | Scoped manual installations, independent capabilities; every network capability false |
| POST `/api/v1/carriers/installations/:id/mappings` | `{kind, source_code, normalized_id, expected_version, reason_code}` |
| GET `/api/v1/carriers/installations/:id/mappings` | Immutable service/location mapping versions |
| POST `/api/v1/parcels/:id/carriers/references` | `{installation_id, external_docket, service_code, origin_code, destination_code, expected_version, reason_code}` |
| GET `/api/v1/parcels/:id/carriers/references` | All saved reference versions and pinned mapped/unmapped dimensions |
| POST `/api/v1/parcels/:id/carriers/observations` | `{reference_id, expected_parcel_version, status_code, status, occurred_at}` |
| GET `/api/v1/parcels/:id/carriers/observations` | Immutable evidence, original status code and `pending_review` state |

POST returns 201 `{id,version}`, including identical retries. GET returns `{items,page}`;
`page` has `has_more` and `next_cursor`. Pass `limit` (1–100, default 50) and returned `cursor`.
Cursors expire after 15 minutes and bind actor, membership revision, scope, parent, kind and
page size. Lists order by opaque ID; reference/mapping `version` identifies their history.
They do not promise snapshot pagination across concurrent inserts. Audit is available through
the existing `/api/v1/audit` with `resource_type=carrier`, including cursor pagination.

Codes/labels contain 1–128 ASCII code characters: letters, digits, `.`, `_`, `:`, `/`, `-`;
they start with a letter/digit. Case and punctuation remain exact. Spaces, URLs, contact
text, query strings and arbitrary notes are rejected. These are operational codes, not
places to paste addresses, credentials or provider payloads.

Mapping `kind` is `service` or `location`. On first review use `expected_version:0`,
`reason_code:initial_mapping`, `normalized_id:null` to create a stable internal identity.
Another source code may reference that identity. A non-null identity must already exist in
the same installation and kind. Correction uses the current version and `mapping_correction`;
null creates a replacement identity. Old mappings stay immutable. No name-based guessing.

Reference creation uses version 0 / `initial_mapping`; correction uses the current version /
`reference_correction`. The result is a new ID and next version. Unknown dimension codes
remain `{state:'unmapped',sourceCode}`. Later mapping reviews do not rewrite saved references;
explicitly correct the reference to capture newer mapping versions. Historical dockets remain
reserved to their original parcel, including corrected typos. Reassigning them is deliberately
unsupported so old evidence cannot be redirected silently.

Observation `status` is null (unmapped), or one of `booked_claim`, `collected_claim`,
`in_transit_claim`, `out_for_delivery_claim`, `failed_attempt_claim`, `held_claim`,
`delivered_claim`, `returned_claim`. The admin reviews this translation per observation;
its immutable ID is the status mapping version. `status_code` always retains the original code.
`occurred_at` is `{state:'known',at:'2026-10-03T06:00:00Z'}` or
`{state:'unknown',reason:'missing'|'unknown_timezone'|'invalid'}`. Known instants require
an explicit offset and are normalized to UTC. Server receipt time never replaces unknown time.
Old/future/contradictory claims remain pending review, with no domain effects.

## State, failures and downstream boundary

Every command uses the existing membership transaction and organization lock, then validates
nested ownership before reading its durable receipt. Same actor/scope/operation/key/body
replays the saved result; changed intent returns `IDEMPOTENCY_CONFLICT`. Other commands
must use new keys. Receipt, evidence and audit commit together. A lost commit acknowledgement
returns a controlled temporary error: retry the **same key and body**, not a new command.

Invalid data is 422 (`VALIDATION_FAILED`); malformed/duplicate JSON is 400. Unknown/foreign
resources are 404, forbidden actions 403. Stale mapping/reference/parcel versions or occupied
dockets return 409 `VERSION_CONFLICT`. Reload before making a new, deliberate correction.
Disabled organizations/franchises reject writes, including replays. Dependency failure is 503
`TEMPORARILY_UNAVAILABLE` with no internal SQL or payload. Cursor mismatch is 422 `CURSOR_INVALID`.

The manual adapter supplies #53 `Observation` to the shared `ingest` persistence boundary.
It receives no delivery/payment executor. Observations never emit lifecycle events or trigger
WhatsApp. #58 owns reconciliation, conflict review and guarded domain-command application;
there is intentionally no “apply status” endpoint here. #55 builds validated file ingestion
on these scoped identities and evidence tables. #59 owns rate import/publication; #147 owns
actual cost. No estimate, actual cost, profit or price changes are invented here.

## Migration and setup

Apply forward migration `1791910800000-manual-carriers.cjs` using the existing migrator
before enabling this API build. It adds installations, mappings, docket reservations,
reference versions, observations and command receipts. Composite foreign keys retain the
owner chain; unique constraints isolate docket namespaces and versions. Evidence is
append-only, and deferred command checks require the matching saved effect and actor.
The audit view adds safe command metadata only; it excludes codes, raw bodies and contact data.

No backfill is required: existing route `carrier_code` strings do not imply installation
identity and existing bookings remain untouched. No new environment variables or feature
flag. Existing server composition controls API availability. Existing code remains compatible
with the additive schema; roll back code if needed, repair schema through a new migration.
Command/evidence retention follows the owning privacy policy; no automatic deletion or
shorter retention is introduced. Runtime grants are SELECT/INSERT only on the six new tables:

```sql
GRANT SELECT, INSERT ON shipit.carrier_installations, shipit.carrier_mappings,
  shipit.carrier_dockets, shipit.carrier_references, shipit.carrier_observations,
  shipit.carrier_commands TO your_existing_runtime_role;
```

Use the deployment's existing role-management process; do not run test grants against
production. The test harness `prepareCarriers()` applies these grants to disposable roles.
Existing scoped Parcel/Booking read/lock privileges and the audit view remain required.

## Reproduce locally

Use the pinned Node/pnpm/Python versions in [quality setup](../QUALITY_CHECKS.md), with Docker.

```sh
pnpm --filter @shippingco/api test test/integration/carriers.test.ts test/integration/carrier-contract.test.ts
pnpm check:migrations
pnpm db:local quality
```

The real API fixture is [carrier-support.ts](../../apps/api/test/carrier-support.ts), exercised by
[database scenarios](../../apps/api/test/database/carriers.test.ts). It creates fictional
tenants and a real local booking, registers a manual installation, maps `STD`, links docket
`SYN-54`, records a transit/delivery claim, corrects the docket, reloads through a fresh pool,
and verifies foreign denial, race/retry safety and unchanged money/proof. All test resources
are disposable; no live provider or production data is involved.
