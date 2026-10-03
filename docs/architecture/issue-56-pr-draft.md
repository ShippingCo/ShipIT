# PR draft — issue #56

Title: `Research Akash Ganga access and recommend a manual pilot path`

## Description

ShipIT needs a supported carrier path without assuming Akash Ganga exposes an API.
Add dated primary-source evidence, six independent capability findings, access/commercial
unknowns with owners, format/reconciliation limits and an explicit decision:
`api_unverified`, live API NO-GO / NOT CURRENTLY VERIFIED, pilot mode `manual`.

The requested deeper lookup adds AfterShip and Shipway intermediary tracking leads,
AfterShip's carrier-list discrepancy and conflicting TrackingMore support claims.
Separate documented provider APIs from unverified direct carrier access; qualify neither
as a working Akash Ganga integration without account-specific evidence and testing.

Reuse the merged #53 contract and #54 manual workflow; distinguish #55's generic CSV
implementation from verified carrier exports. Document a usable missing/refused-access
fallback and all four research outcomes. After evidence review this satisfies #56's
research prerequisite for #60 without waiting for credentials; #57/#58/#59 and #60's
qualification remain required. Future authorized access is a separate revisit condition.

Apply existing AWS intent-key/atomic-receipt and Microsoft translation-boundary practices
to the recommended path; no new service or network retry machinery. Extend existing
Markdown checks to integration reports. No runtime, schema, config, provider, UI or LLM
change; no account application, contact, tracking lookup or portal scraping.

Validation: the full local `pnpm db:local quality` passed: 35 tooling/security, 22 testkit,
12 DB unit, 638 API, 189 web, three storage, 69 schema/DB and 399 API database tests;
planning, lint, all five workspace typechecks and both production builds passed.
Disposable services cleaned up. Also passed 48 focused carrier tests, 38-file migration
history and final documentation checks. Broken-link/unclosed-fence probes were rejected
as expected. Existing React `act(...)` warnings remain visible. See
[exact acceptance and results](issue-56-verification.md).
Carrier sources were read through public research; indexed partner evidence and failed
legacy retrieval are clearly bounded. No live access, carrier payload fixture, authorized
export or real pilot is claimed. No new remote CI or independent approval is claimed.
The follow-up changes documentation only; planning and whitespace checks were rerun.

No setup/rollback migration is required. Preserve existing #54/#55 rollout and permissions.

Closes #56 after review and the authorized GitHub workflow.

Commit message: `docs(carriers): research Akash Ganga access and manual fallback`
