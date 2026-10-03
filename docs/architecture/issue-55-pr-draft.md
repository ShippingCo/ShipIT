# Ready-to-use delivery text

## Commit message

`feat(carriers): add validated resumable CSV imports`

## PR title

Implement validated, resumable carrier CSV shipment and tracking imports

## PR description

Operators need a safe way to import carrier files without duplicating evidence or
bypassing ShipIT's delivery/payment rules. Add bounded UTF-8 CSV upload, explicit
column/status mapping, saved dry-run previews, selected row commits and reloadable
outcomes. Shipment rows link existing parcels; tracking rows remain pending claims.

Extend #54's scoped installation/reference/ingestion services and #53 file provenance.
Each row rechecks authorization and stale state, then atomically saves its effect and
outcome. Run/row identity, source fingerprints and database uniqueness make concurrent
re-upload and interrupted retries safe. Reject foreign mappings without disclosing
dockets, IDs or customer data. Raw uploads are never persisted or re-exported.

Service-only API workflow; no new screen, external provider, dependency, environment
variable or LLM change. #58 owns reconciliation/domain transitions; #59 owns rates.
The 64 KiB/200-row file and 20-row commit bounds keep execution synchronous and recoverable
without new queue infrastructure. Formula cells are inert data and invalid operational
codes; there is no raw export surface.

Apply `1791997200000-carrier-csv-imports.cjs` and the three SELECT/INSERT runtime grants
in [the guide](carrier-csv-imports.md) before this API build. No existing data backfill;
released migrations remain unchanged. Roll back compatible code; repair schema forward.
Older upgrade assertions increment only their expected remaining migration count.

Validation: 638 API, 189 web, 69 schema/DB and 399 API database tests passed, together
with tooling, testkit, DB unit, object-storage checks, lint, types and both production builds.
The original aggregate stopped on six stale schema fixtures; corrected them, passed all
14 tests in their four files, then reran the **complete database gate** successfully.
Builds ran separately. No fully passing aggregate rerun or new remote CI is claimed.
See [exact results and acceptance evidence](issue-55-verification.md).
Focused tests cover encoding/grammar/limits, source conflicts, tenant/role denial,
dry-run isolation, same-file and cross-run duplicates, races, mid-batch rollback,
lost COMMIT acknowledgement, fresh-pool reload, stale mappings/references/times,
audit/log privacy and populated-schema upgrade/rollback. Local results do not assert
remote CI, browser execution or live-provider qualification.

Closes #55

This file is a local draft. No commit, push or PR publication has been performed.
