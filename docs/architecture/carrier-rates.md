# Reviewed carrier rate files

Issue #59 extends [Pricing](pricing.md), [CSV ingestion](carrier-csv-imports.md)
and [carrier identity](carrier-contract.md). [Design/research](../adr/0042-reviewed-carrier-rates.md)
and [verification](issue-59-verification.md) record decisions and evidence.

## User workflow and authority

A franchise admin registers a local installation and maps its exact service/location
codes using the existing carrier mapping API. They upload a rate sheet, review the
saved preview, and approve it. For example, a 100.01-rupee freight row plus 2.49
packing becomes exactly 10,250 paise. A purchase-cost sheet remains an estimate;
it cannot change this customer charge or claim an actual expense.

This is an authenticated API workflow, not a new operator screen or a live carrier
connection. It uses W26 plus W27 (current **franchise_admin** for the selected
franchise). All full-sheet reads also require those grants: R19 alone cannot expose
private rate sheets. Organization-admin visibility is not local publication authority.
Every retry checks current membership and active organization/franchise state.
Sibling and foreign installations, mappings and candidates return uniform 404.

## API

All requests use the existing session cookie and required `organization_id` and
`franchise_id` query selectors. POST also requires CSRF and `Idempotency-Key`.

| Method / path | Result |
| --- | --- |
| POST `/api/v1/carriers/installations/:id/rates` | 201 immutable preview |
| GET `/api/v1/carriers/rates/:id` | 200 saved preview plus current approval |
| POST `/api/v1/carriers/rates/:id/approve` | `{ "expected_version": 1 }`; 200 approved version |

Upload body (replace IDs with those returned by this installation's mapping API):

```json
{
  "purpose": "customer_selling",
  "origin_mapping_id": "<origin mapping UUID>",
  "services": [{"mapping_id":"<STD mapping UUID>","target":"standard"}],
  "locations": [{"mapping_id":"<DEST mapping UUID>","target":"SYN_DEST"}],
  "expected_lanes": [{"destination_key":"SYN_DEST","service":"standard"}],
  "weight_unit": "kg",
  "amount_unit": "rupees",
  "policy": {
    "effective_from": "2099-01-03T00:00:00Z",
    "effective_to": "2099-01-04T00:00:00Z",
    "quote_validity_seconds": 600,
    "override_tolerance_paise": 0,
    "approval_ref": "SYN_APPROVED"
  },
  "content_base64": "<UTF-8 CSV encoded as base64>"
}
```

Exact CSV headers and fictional row:

```csv
service_code,origin_code,destination_code,min_weight,max_weight,weight_unit,freight,packing,currency,amount_unit
STD,ORG,DEST,0.001,2,kg,100.01,2.49,INR,rupees
```

Only UTF-8 CSV, 65,536 bytes, 100 rate rows, 256 characters/cell. Reuses #55's
RFC4180 grammar, LF/CRLF, BOM, fatal UTF-8 and base64 validation. Fixed headers
keep unnecessary customer data out. Formulas, exponents, signed/whitespace numbers,
unsafe integers and precision needing rounding are rejected. Kg allows three decimal
places, rupees two; grams/paise require integers. All rows must match the declared
unit convention and INR. Empty maximum means unbounded; slabs are [min,max).
No external rate formulas, spreadsheet evaluation or raw-file download/export.

`purpose` is exactly `customer_selling` or `courier_purchase_estimate`. Purpose is
part of candidate identity. No actual-cost or customer-agreement import exists.
Canonical courier/location/service UUIDs come from retained #54 mapping versions;
explicit targets bridge them to Pricing's enum/key. Exact codes are case-sensitive.
Each identity has one meaning within a normalization snapshot. Selling policy
assumes the explicitly selected origin serves this franchise; no automatic origin
inference or multi-origin quote matching is added.

## Preview, approval and recovery

Preview returns `id`, `version`, `state`, purpose, installation/courier IDs,
file SHA256, normalization hash, effective policy, expected lanes, numbered rows,
controlled issues, weight gaps, approval and `source_ref`. Each valid row retains
canonical IDs and mapping-version IDs. Invalid numeric/code cells are not echoed.
Unknown mapped lanes are explicit `UNMAPPED_LANE`; wrong units are `UNIT_MISMATCH`.
Overlapping slabs, missing/unexpected lanes, past effective dates and conflicting
published selling intervals block approval. Weight gaps are visible; they preserve
Pricing's intentional `NO_RATE`, rather than inventing a price.

State: `ready` or `rejected` at version 1; approved becomes version 2. No partial-row
approval: correct rejected files/mappings and submit a new candidate. Content plus
configuration/mapping snapshot determines identity within the installation; a new
key for identical input still returns the same candidate. Explicitly changed mapping,
purpose, dates or approval configuration creates a separate review candidate.
Same key with changed body conflicts. POST preview returns current saved status on
replay; it does not promise a frozen pre-approval representation.

Approval checks current mapping versions, date, expected version and overlap again.
Selling publication and import approval/receipt/audit commit together. A lost response
can be retried with the same key. A new key cannot approve twice. `VERSION_CONFLICT`
requires reloading/review; `RATE_CONFLICT` requires correcting the policy. Malformed
files return safe 422 diagnostics, ownership 404, permissions 403, unavailable DB 503.
Dependency failure rolls back; no partial published policy or browser fallback.

Quotes retain the existing `policy.source_ref` (`carrier-rate:<candidate UUID>`),
immutable Pricing version/rule IDs and fingerprint. Admins resolve the reference
through GET above. Historical Booking, Tax and Receipt snapshots never change.
No purchase amount enters quote/override input. Approved purchase versions have
`pricing_version_id: null` and `actual_cost: {"state":"unknown"}`; they retain lane,
source and interval evidence for #147. A second overlapping purchase policy for the
same installation is rejected. Neither zero actual cost nor profit is inferred.

General rates never overwrite #141's future negotiated customer agreement. That
owning resolver must prefer an applicable approved customer agreement over a general
rate; it is not implemented here. #60 still owns first carrier qualification/health.

## Database and rollout

Apply `1792170000000-carrier-rates.cjs` after the 39 released migrations. It adds
immutable candidate, command and approval tables with scoped composite foreign keys,
unique identities, purpose/publication constraints and reference-only audit projection.
No backfill or rewrite of existing prices, mappings or bookings. Runtime requires:

```sql
GRANT SELECT, INSERT ON shipit.carrier_rate_imports,
  shipit.carrier_rate_commands, shipit.carrier_rate_approvals TO <runtime_role>;
```

Retain existing Pricing/Carrier grants. Deploy schema/grants before API code. No new
environment keys, services or dependencies. Rollback compatible API code while retaining
evidence; repair schema forward. Organization serialization handles application races;
unique constraints and approval checks protect stored identity. Purchase overlap checks
serialize by installation. No distributed throughput guarantee is claimed.

## Reproduce locally

Use the pinned toolchain and disposable PostgreSQL from [quality setup](../QUALITY_CHECKS.md).
`pnpm --filter @shippingco/api test test/integration/carrier-rates.test.ts` tests parsing.
`pnpm db:local quality` runs the required complete gate; `pnpm check:migrations`
verifies released migration history. Database scenarios are in
`apps/api/test/database/carrier-rates.test.ts` and
`packages/db/test/integration/carrier-rates.test.ts`.
They register real installations/mappings, create a booking/receipt, import and approve
a future policy, advance the clock, quote exact paise, compare old financial snapshots,
retry concurrently, deny foreign IDs, restart the pool and inject transaction failures.
All carrier inputs are fictional; no live-provider qualification is claimed.
