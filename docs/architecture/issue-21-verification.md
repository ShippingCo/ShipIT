# Issue 21: tax proposals and confirmation contract

Implementation baseline: Issue 20, commit `2b5c511`. No production tax rates are seeded.

## What is implemented

The API accepts one existing whole-booking pricing quote, expected commercial inputs,
and explicit service-recipient facts. It stores an immutable preparation intent,
optionally accepts a franchise administrator's bound jurisdiction resolution, and
produces an immutable tax proposal. The recipient is not inferred from consignee,
destination, payer, COD, or customer phone.

Supported scope is ordinary domestic State-only courier supply with a recorded
regular PAN-based supplier GSTIN and an explicitly approved rule. Registration
structure validation is NOT a GSTIN checksum, active-registration lookup, or legal
approval. No government service is called. Unsupported special cases, UTGST
jurisdictions and unresolved facts fail closed. Published policy approval/source
references record an administrator's attestation; they do not independently prove
its legal correctness.

Each rule selects a single classification/group for freight and/or packing from the
validated quote. Independently classified groups, arbitrary charges, partial
exemptions and multiple quotes are not accepted by this interface. Nil-rated and
exempt treatments are explicit; unknown facts cannot become zero tax.

BigInt fractions, half-up paise quantization and deterministic largest-remainder
allocation implement the Issue 8 engineering contract. Stable ASCII IDs break ties.
The final whole-rupee adjustment is separate and signed. This engineering allocation
is not asserted to be prescribed by tax law. Production applicability still requires
the approval described in `money-tax-proof-privacy-contract.md` and `policy-sources.md`.

## API and authority

Policy routes follow pricing at
`/api/v1/organizations/:organization_id/franchises/:franchise_id/tax/versions`:

- GET collection: effective published projection under R21; no supplier GSTIN.
- GET `/:version_id`: local franchise administrator's draft/history projection.
- POST collection: create draft; PUT `/:version_id`: `{expected_version, policy}`.
- POST `/:version_id/publish`: `{expected_version}`; no backdating/overlap.

Operational routes take `organization_id` and `franchise_id` query parameters:

- POST `/api/v1/tax/intents`: `{quote_id, pricing_input, facts}`.
- GET `/api/v1/tax/intents/:id`: originating actor's safe preparation projection.
- GET `/api/v1/tax/intents/:id/resolution-context`: W37 administrator's minimum
  protected facts; this does not transfer ownership of the quote.
- POST `/api/v1/tax/jurisdiction-resolutions`: `{intent_id, policy_id, facts, evidence_ref}`.
- POST `/api/v1/tax/calculations`: `{intent_id, resolution_id?}`.
- GET `/api/v1/tax/calculations/:id`: originating actor's saved proposal.

All writes require CSRF/session protection and Idempotency-Key. Live authorization
is repeated before replay. Same-key, changed normalized command returns 409;
successful replay returns the original response and never extends its expiry.
No public response includes a supplier/recipient GSTIN except the separately
authorized resolution-context projection's necessary recipient evidence.

`withTaxTenantScope` authenticates, locks the organization authority, narrows the
franchise, and issues independent pricing/tax capabilities in one transaction.
Tax cannot create a capability or access a raw executor. Pricing W43 authority is
still required for excessive overrides. Queries enforce both ownership dimensions.
The existing organization lock serializes commands and membership changes; do not
weaken this without replacing its concurrency guarantees and tests.

## Persistence and audit

One additive migration creates cards, bounded JSON policy versions, intents,
resolutions, calculations, command receipts and reference-only audit events.
Composite foreign keys bind tenant/actor/dependencies. Published content, intents,
resolutions, calculations, receipts and audit history are immutable. SQL independently
checks intervals, rates, rule ambiguity, integer totals and reconciliation.

Implementation refinement from the proposal: the small bounded rule catalog is
stored atomically inside each version, not as independently editable child rows.
The version publication trigger validates its supported rule structure.

Another refinement: a security-definer trigger appends a reference-only audit event
when the command receipt is inserted. Thus state, response identity and audit commit
or roll back together. The event is exposed through the existing `audit_history`
projection and administrative audit service; runtime gets no direct audit-table write
grant. Denials use the existing safe security-audit mechanism.

## Issue 22 boundary — not a Booking implementation

`validateTaxSnapshot` is an internal transaction callback, not an HTTP endpoint.
It requires current commercial facts, live pricing/tax capabilities and trusted
time evidence. It recalculates the stored result, checks dependency freshness and
returns an independent copy. The caller must persist it before that same transaction
commits. Capabilities expire at transaction end.

The initial time selector only accepts contemporaneous trusted service/invoice
timestamps and no earlier payment. Missing, historical or changed-time evidence
returns `TAX_TIME_UNSUPPORTED`. Issue 22 must derive that evidence from authoritative
records; passing browser checkboxes/timestamps into this port is forbidden. No
production timing attestor, booking confirmation route, statutory invoice, tax return,
payment processing or receipt integration is provided here. Real enablement requires
reviewed classification, rate, basis, registration evidence and timing applicability.

Historical display uses saved evidence, not an expiry-sensitive confirmation call.

## Verification

Verified locally on 13 September 2026 with Node 22.23.2, pnpm 10.34.5,
Python 3.12.14 and real PostgreSQL 18.6:

- Fresh-checkout and restored-checkout full quality runs passed.
- 200 API unit/integration tests and 86 frontend tests passed.
- 41 PostgreSQL database tests and 91 database-backed API tests passed; no
  failed, skipped, cancelled or TODO database tests.
- All 24 isolated verification stages passed, including intentional failure drills.
- Migration-history check passed: all nine released migration files are unchanged.
- `git diff --check` passed. Changes remain local; no push or merge was performed.

Sanitized stage logs are retained in `node_modules/.cache/quality-verification/`.
The persistent local container additionally passed an actual restart/ledger check:
ten applied migrations and 32 application tables survived. Its statement-logging
settings match the privacy-conscious test configuration; credentials are ACL-restricted.

- `apps/api/test/integration/tax.test.ts`: M01–M06, odd paise, large integers,
  mixed eligible lines, stable allocation, unsupported/ambiguous input.
- `apps/api/test/database/tax.test.ts`: persisted HTTP flow, roles and ownership,
  unknown/resolution binding, concurrent replay, expiry, M07 future policy/new pool,
  revoked authority, trusted-time rejection, same-transaction consumer rollback,
  dependency outage, state/receipt faults and lost COMMIT acknowledgement.
- `packages/db/test/integration/tax.test.ts`: Issue 20 upgrade/repeat with preserved
  roots, least privileges, SQL constraints, immutable evidence and creator binding.
- `scripts/tenant-queries.test.mjs`: tax-specific ownership/issuer bypass rejection.

Run the pinned toolchain and `pnpm db:local quality`, `pnpm check:migrations`,
`pnpm db:local verify:gates`, and `git diff --check`. Existing web React `act` warnings
are unrelated prototype test debt, not suppressed by this issue.

## Rollout

Apply schema using the migration owner before deploying compatible API code.
Grant runtime SELECT/INSERT on `tax_cards`, `tax_versions`, `tax_intents`,
`tax_resolutions`, `tax_calculations`, `tax_commands`; UPDATE only
`policy,effective_from,effective_to,revision,state,published_by` on `tax_versions`.
Do not grant runtime audit-table access, DELETE, TRUNCATE, DDL or ownership privileges.
Existing scoped audit view grants remain in place. Test fixture grants are in
`prepareTax`; they are not an automatic production role provisioning script.

Keep rates unconfigured until reviewed. Do not run disposable test provisioning
against a live database. The local Docker engine was recovered by preserving its
failed socket directories. At the user's request, a new persistent container
`shipit-postgres-local` was created with volume `shipit-postgres-local-data`, database
`shipit_developer`, and loopback binding `127.0.0.1:5432`. All ten migrations applied;
repeating migration applied zero. The runtime account `db_developer` is distinct
from the migration owner and bootstrap account. Generated credentials are stored
only in Git-ignored `.env.database.local`, not this document or the repository.
No business records or tax rates were seeded. Stopping/restarting this container
preserves the named volume; never remove the volume as a troubleshooting step.
