# Issue #190 working evidence

Base: current main `9a42bb3`; branch `issue-190-admin-access`. The redesign checkpoint
`6dde9d5` remains on its separate branch. The implementation evidence below was recorded
before publication approval. The user subsequently authorized committing, pushing,
creating a PR and merging the complete work. Production mutation and deployment remain
outside this authorization. The separately requested production UI redesign shares this
branch; its scope, visual evidence and execution limits are recorded in
[frontend experience redesign](frontend-experience-redesign.md) and must be explicit in
the PR rather than presented as part of #190's original non-goals.

## Requirements and decisions

Actual issue: **[Deployment blocker] Implement full owner and franchise-admin access with
enforced tenant boundaries**. GitHub milestone 8 is M7. No issue comments at inspection.
#3 and #14 are closed, with merged implementations `d039a48` and `a9daf42` in this base.
#71 and #76 remain open release gates, not prerequisites to implementing this change.
Recovered decisions from the chat “Test WhatsApp functionality” (`01a17b85-99aa-79f1-80c8-d1a88fdcafc4`) explicitly request all owner features and all local franchise-admin features; these agree with #190.

[ADR 0046](../adr/0046-owner-and-local-administrator-authority.md), the amended
[seven-role matrix](authorization-contract.md) and `fixtures/administrative-policy.json`
define policy v2. Original #3 scenarios remain labelled historical v1; the validator checks
the current matrix separately and retains restricted-role drift checks.

`packages/shared/src/admin-actions.ts` declares administrative actions and the Owner label.
Server coordinators resolve real current membership and organization-owned franchises.
No membership, agent identity or assignment is synthesized. Customer/booking/pricing/tax,
operations/custody/proof oversight, files/e-way/carriers, finance/accounts/closing/refunds,
reports/exports, messaging/support/pickups and settings use the amended policy.
Actor-bound delivery/custody/handover rules, approval independence, flags, immutable evidence,
quarantine, version and idempotency checks remain mandatory. Navigation/direct-route denial
and action controls agree; dispatcher booking creation remains denied.

Migration 56 adds a security-invoker view of real memberships and their business franchise
scope. It replaces narrow financial/custody/settings predicates while retaining original
function ACLs. All 55 released migrations remain unchanged. No role backfill is needed.

## Verification ledger

- Pinned Node 24.22.1, pnpm 10.34.5 and Python 3.12.14: passed. Select the bundled
  Python through `PYTHON`; the default Windows Python 3.12.6 correctly fails the pin.
- Tooling: 44 passed. Planning: passed, including 126 matrix scenarios, 338 test
  declarations and 17 negative controls. Lint and all-workspace TypeScript: passed.
- Complete application aggregate: 22 testkit, 12 database-unit, 780 API and 388 web
  tests passed, plus all 3 real S3-compatible private-object contracts.
- Complete PostgreSQL 18.6 schema group: 92 passed across 42 files, with zero failed,
  skipped, cancelled or todo cases. This includes populated migration 55 to 56,
  unchanged original memberships, scoped owner expansion, revocation and repeat apply.
- Focused changed owner/finance scenarios: 12 passed, zero skipped. Real owner-only
  onboarding and local-admin-only counter flows cover booking, immutable receipt,
  receiving money, real custodian/expense identity, dispatch, service replay and login.
  Independent approvals, capacity/version guards and cross-tenant denial remain checked.
- Complete PostgreSQL API group: 618 passed across all 84 files. Combined with the
  schema group, all 710 PostgreSQL tests passed with zero failed/skipped/cancelled/todo.
- `pnpm db:local quality`: passed on the final authorization/database implementation;
  complete log: ignored `dist/issue-190-quality-final-2.log`. Source stayed frozen during
  that run. Its PostgreSQL API group finished within the existing deadline (1,607,218ms).
- After removing one obsolete Settings explanation about owner restrictions, lint,
  all-workspace TypeScript, all 388 web tests and an explicit `NODE_ENV=production`
  build passed again. No database or authorization logic changed after the full gate.
  The database wrapper's test environment build is not the final browser artifact.
- Migration history and final diff checks: passed, all 55 released files unchanged.
  Compared all 27 replaced functions with their latest released definitions: only
  membership-scope/administrative-role predicates changed, preserving evidence guards.
- Mixed dispatcher/agent read restrictions are preserved. A real membership regression
  verifies a remote franchise-admin grant cannot expand local agent reads; local
  owner/admin oversight still cannot complete another agent's delivery. Real owner and
  admin-only route departures and lot corrections pass without synthetic staff grants.

The first complete API database run failed on remaining historical migration counts,
obsolete owner-denial assertions and counts that omitted new owner writes. It also exposed
a missed carrier scope coordinator, which was fixed rather than changing positive tests.
All failures were diagnosed, repaired and included in the successful complete rerun.
No deadlines were increased or cases skipped. Web tests still emit React `act(...)`
warnings in async UI fixtures; these are not suppressed. Browser runtime errors are zero.

Historical migration tests pin old schemas while invoking current producer adapters.
Their test helper now creates an original-explicit-scope compatibility view only before
migration 56 exists. Migration 56 replaces it with the real owner projection. A missing
view after migration 56 fails loudly; no production fallback, duplicate memberships,
ledger entries or role grants are synthesized. Unbounded upgrade expectations advance
by one migration, and synthetic forward repair filenames sort after migration 56.

Actual Chromium review used the production bundle against real Fastify and disposable
PostgreSQL, without API mocks. Owner and local admin each saved a booking and loaded its
issued receipt; refresh, second-franchise selection, dispatcher direct-route denial,
sibling denial and revocation of a previously open admin tab passed. Desktop 1440px and
mobile 390px had no horizontal document overflow or runtime page errors. Reviewed all
six screenshots under ignored `dist/issue-190-browser/`; `evidence.json` records final
production bundle SHA-256 `8380e1fb73032f1374d3974c543a6764c1dd5d6d1dc36cea2efad086fc9b62bf`.
The final journey was repeated after the copy correction against this exact artifact and
final API source: 1 passed, zero failed/skipped/cancelled/todo. The saved bundle hash matches.
Private attachment routes were not configured in this browser fixture, so its attachment
unavailable state is not provider qualification; separate object-store and database tests
cover storage. Final production bundle: 1,163.83kB (318.58kB gzip).

An initial direct DB invocation failed `DB_TEST_REGISTRY_REQUIRED`; no product pass was
claimed. Subsequent runs use the existing registered executor and cleanup. Diagnostic
logs and intermediate results live under ignored `dist/issue-190-*`.

## Setup and qualification

Use disposable development/test PostgreSQL. Apply
`1793552400000-owner-business-authority.cjs` before the API/UI pair. Grant the runtime role
`SELECT ON shipit.business_membership_scopes`; its existing underlying membership/franchise
SELECT grants remain necessary. Do not grant writes on the view. Existing feature flags
retain their defaults. Roll back API/UI together to restore the prior permission ceiling;
retain additive schema/history and repair schema only with forward migrations.

Independently review the authorization diff; after user approval to commit/push, verify
exact final-head CI. #71 must requalify policy-v2 role/tenant/actor fixtures and #76 must bind
deployed artifact, migration and configuration evidence to the tested revision. Keep #190
release-blocking until review, merge and deployed-artifact verification are complete.

Manual journey: onboard a fictional owner, configure enabled pricing/tax, create a customer
and booking, issue a receipt and dispatch. Refresh/sign in again, switch to an owned second
franchise and repeat as local admin. Probe sibling/foreign direct URLs, nested IDs, exports,
files and revoked retries. Confirm agent-only actions and independent approvals still deny
the wrong identity. No real customer messages or live-provider qualification is implied.

## Prepared review text (not published)

Commit message: `Grant scoped owner and franchise-admin business access`

PR title: `Enable scoped owner and franchise-admin business access`

PR description: Owners can perform enabled business actions throughout their own
organization, while franchise administrators receive those actions only within their
explicit grants. Shared action policy, live server scopes, database predicates and UI
controls agree without fabricating staff roles. Migration 56 adds a security-invoker
business-scope view and preserves actor-bound proof, financial independence, tenant
boundaries and revocation. Apply the migration and runtime SELECT grant before API/UI.
Verification results are recorded above; independent review, final-head CI and #71/#76
release evidence remain required. Closes #190 after approved review and merge.
