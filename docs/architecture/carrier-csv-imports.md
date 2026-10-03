# Carrier CSV imports

Issue [#55](https://github.com/ShippingCo/ShipIT/issues/55) extends
[manual carriers](manual-carriers.md) and the [v1 contract](carrier-contract.md).
[Design and research](../adr/0040-csv-carrier-imports.md),
[verification](issue-55-verification.md).

## Workflow

A franchise admin selects a registered local carrier installation, uploads a small CSV,
maps its columns and reviews numbered row results. They commit only chosen valid rows.
After a failed request they reload the saved run and retry the same selection/key;
already applied rows stay applied. This release provides the authenticated API workflow,
not an operator screen or live carrier connection.

Shipment rows link **existing** ShipIT parcels to carrier dockets. They never create a
booking. Existing references require the explicit manual correction workflow; importing
cannot overwrite them. Tracking rows save carrier claims as `pending_review`; even
`delivered_claim` cannot deliver a parcel, collect money, change prices or send WhatsApp.
#58 owns reconciliation and guarded application, #59 rates and #147 actual costs.

[#58's review service](carrier-reconciliation.md) now consumes accepted tracking
observations, deduplicates shared external source IDs across file/poll channels and
records guarded human decisions. CSV validation and row outcomes remain unchanged.

Local installation listings now enable `tracking_import` for this generic CSV service.
The manual adapter itself still supports only manual observations. Its network/rate/
booking capabilities remain false; this does not qualify a carrier-specific file dialect.
Both local paths use the same installation, immutable references and ingestion boundary.

#59 now enables separate reviewed [selling-rate and purchase-estimate file imports](carrier-rates.md)
on the local installation. Live rate APIs and external booking remain unavailable.

## Permissions and API

All routes use authenticated session cookies, `organization_id` and `franchise_id` query
selectors. POST requires ordinary CSRF and `Idempotency-Key`. W26 limits create/commit
to the selected franchise's **franchise_admin**. R19 permits status reads by its admin,
operator, dispatcher, read-only staff or explicitly scoped organization admin. Delivery
agents cannot browse multi-parcel imports; accountants cannot read them. Membership and
active write scope are checked again for every row and retry. Unknown/foreign resources
give the same 404. No role or nested ID expands the current scope.

| Method/path | Contract |
| --- | --- |
| POST `/api/v1/carriers/installations/:id/imports` | Create saved dry-run preview; 201 summary |
| GET `/api/v1/carriers/imports/:id` | Reload current summary and numbered row outcomes; 200 |
| POST `/api/v1/carriers/imports/:id/commit` | `{ "rows": [2, 4] }`; at most 20 distinct valid row numbers; 200 current summary |

Create body:

```json
{
  "kind": "tracking",
  "content_base64": "<base64 of the original UTF-8 CSV bytes>",
  "columns": {
    "docket": "ShipIT docket",
    "external_docket": "Carrier docket",
    "source_id": "Event ID",
    "status_code": "Status",
    "occurred_at": "Time"
  },
  "status_mapping": [
    { "source_code": "MOVE", "status": "in_transit_claim" },
    { "source_code": "DONE", "status": "delivered_claim" }
  ]
}
```

`columns` maps canonical field names to exact headers. Shipment fields are `docket`,
`external_docket`, `service_code`, `origin_code`, `destination_code`; use
`kind:"shipments"` and `status_mapping:[]`. Tracking fields are shown above. Headers must
be unique, contain simple ASCII letters/numbers/spaces/underscores/hyphens, and have no
extra columns. Remove addresses, names and other unnecessary fields before uploading.
Header names need not equal canonical field names. Unknown body keys are rejected.

CSV is comma-separated UTF-8, with optional BOM and LF/CRLF. Doubled quotes and quoted
newlines follow RFC 4180. Limit: **65,536 bytes, 200 data records, 16 columns, 256 characters
per cell**. Header is row 1; rows mean CSV records, not physical lines inside quoted cells.
Base64 allows fatal UTF-8 validation through the existing bounded JSON/CSRF transport.
The enclosing JSON request retains its existing 256 KiB limit. No multipart parser,
filename, spreadsheet macros, scripts, compression or arbitrary dialect detection.

Operational codes follow #54's exact case-sensitive code rules. Cells are always inert
strings; a formula-like docket/status/source ID is invalid code, never evaluated. No raw
CSV download or re-export exists. Future exports must perform spreadsheet-safe escaping
at their output boundary; CSV quoting alone does not prevent formula interpretation.

Tracking `source_id` must be the stable carrier record/event ID within this installation.
Do not generate a different ID each retry. Source timestamps require an explicit timezone,
valid calendar date and time. They normalize to UTC. A future timestamp, one before booking,
or one older than the latest saved observation for that reference is flagged `STALE_STATE`.
Cancelled bookings and parcels already delivered or in RTO also require manual review;
CSV cannot add new effects to those terminal workflows. Existing duplicate results still replay.
No source-time guessing or replacement with receipt time. Status mapping is explicit,
bounded to 32 entries, with the eight #54 claim values. Unknown codes are rejected.
Service/location mappings may remain explicitly unmapped as in #54; their snapshot is pinned.

## Counts, errors and recovery

Summary includes run ID, installation, kind, immutable file SHA256, `state`, `counts`,
and at most 200 rows. Counts are disjoint: `total = valid + rejected + conflicted + applied
+ duplicate`. `valid` means eligible and not yet processed. State is `ready` while any
valid row remains and `completed` otherwise; completed may include errors. `applied`
means evidence/reference saved, not a parcel lifecycle transition. Rejected source values
are omitted; rows return only error/field codes. Valid candidates contain operational codes,
not customer snapshots. Keep the opaque run ID for reload; no browser persistence is added.

| Code | Operator action |
| --- | --- |
| `UTF8_REQUIRED`, `TEXT_CSV_REQUIRED`, `INVALID_BASE64` | Export plain UTF-8 CSV and encode original bytes |
| `FILE_TOO_LARGE`, `TOO_MANY_ROWS`, `TOO_MANY_COLUMNS`, `CELL_TOO_LONG` | Split the file or remove unsupported fields |
| `INVALID_CSV`, `EMPTY_FILE`, `INVALID_HEADERS`, `COLUMN_MAPPING` | Repair quoting/header mapping; upload a new preview |
| `COLUMN_COUNT`, `INVALID_CODE`, `INVALID_TIMESTAMP` | Correct the indicated row/field; upload a new preview |
| `UNMAPPED_STATUS` | Review the status translation and create a new preview |
| `REFERENCE_NOT_FOUND` | Check own-franchise ShipIT docket and current carrier reference; no foreign details disclosed |
| `SOURCE_CONFLICT` | Review occupied docket or conflicting source ID; do not silently rename a duplicate event |
| `STALE_STATE` | Review newer reference/mapping/parcel/time evidence; create a new preview when appropriate |

File validation returns 422 with safe code, record number when available and limits;
oversized enclosing JSON returns 413. Row errors remain in a 201 preview. Selecting rejected
or missing rows, repeating a row number, or selecting more than 20 rows returns 422 before
any selected row is applied. Already applied or duplicate outcomes can be retried safely.
Malformed JSON is 400; CSRF/session/permission errors retain existing envelopes.

Create keys identify one upload intent. A changed valid body with the same key returns
409 `IDEMPOTENCY_CONFLICT`. Retrying the original returns the same run ID with its **current**
summary. Commit keys bind the run and sorted selection. Retrying the same selection resumes
it; a changed selection requires a new key. Stable run+row outcomes and an installation-scoped
source identity prevent duplicated effects across actors, keys, files and concurrent runs.
Shipment identity is the external docket; tracking identity is the source ID. Changed
normalized contents under an applied identity conflict. Cross-channel semantic equivalence
with manual/live evidence remains #58's responsibility.

Each row rechecks scope, parcel version, current reference, source time and (for shipment
rows) reviewed dimensions. A conflict is terminal for that preview row. A database outage
or lost response returns controlled 503 `TEMPORARILY_UNAVAILABLE`; earlier rows may have
committed, but each individual row is all-or-nothing. Reload then retry the same key/body.
No automatic network retries or background worker are added. The franchise admin owns recovery.

## Storage, rollout and privacy

Apply additive migration `1791997200000-carrier-csv-imports.cjs` before this API build.
It adds immutable runs, commit intents and row outcomes, a unique applied-source index,
composite ownership keys, evidence-completeness checks and safe audit projections.
The existing carrier command check also accepts file provenance linked to an import outcome.
Existing manual records need no backfill. Release migrations are unchanged. Compatible code
rollback is supported; repair schema with forward migrations. No new configuration or flag.

Using the deployment's existing role-management process, grant its runtime role:

```sql
GRANT SELECT, INSERT ON shipit.carrier_import_runs, shipit.carrier_import_commits,
  shipit.carrier_import_outcomes TO your_existing_runtime_role;
```

Existing carrier, Parcel, Booking and audit privileges remain required. Tests use only
disposable databases. Raw uploads have **zero persistent retention**: bytes are decoded and
discarded in request memory, never stored in object storage, logs, audit or returned for
download. Only normalized safe candidates, digests and immutable outcomes persist under the
existing evidence retention policy. There is no antivirus claim: strict bounded text parsing,
no execution/serving path and rejection of binary/control content form this CSV-only policy.
Audit records actors, scope, run/action/result and request correlation, never raw cells.

## Reproduce with fictional data

Use pinned Node/pnpm/Python and Docker from [quality setup](../QUALITY_CHECKS.md):

```sh
pnpm --filter @shippingco/api test test/integration/carrier-csv.test.ts test/integration/carriers.test.ts test/integration/carrier-contract.test.ts
pnpm check:migrations
pnpm db:local quality
```

[The real API fixture](../../apps/api/test/database/carrier-imports.test.ts) creates a
fictional booking and local installation, uploads shipment/tracking rows, applies selected
records, reloads through a fresh pool, and checks duplicate/race/crash recovery. It also
demonstrates malformed and foreign rows, explicit mapping, safe errors, and unchanged
delivery/payment/event state. Dates use a controlled clock and no customer/provider sends.
This is Fastify API injection with real sessions/CSRF/PostgreSQL, not a browser or live-carrier test.
