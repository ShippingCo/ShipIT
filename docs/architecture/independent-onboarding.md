# Independent onboarding and operator context

Issue #17 connects the existing verified operator identity to its initial workspace.
It follows [ADR 0006](../adr/0006-domain-ownership-and-authorization.md),
[ADR 0007](../adr/0007-api-event-idempotency-contracts.md),
[ADR 0011](../adr/0011-operator-otp-authentication.md),
[ADR 0012](../adr/0012-membership-invitations-and-rbac.md),
[tenant isolation](tenant-query-isolation.md), and the [audit contract](audit-contract.md).

## Eligibility and roles

An operator signs in using the existing browser-bound email challenge and HttpOnly
session cookie. Identity must already have a verified contact provisioned through the
trusted #13 enrollment seam. There is no unauthenticated account-creation endpoint or
unverified email ownership claim. Operators without an enrolled contact receive guidance
to contact their administrator; open public enrollment/recovery remains an explicitly
unapproved policy under ADR 0011. National-company accounts and carrier credentials are
not required.

A current authenticated identity with no membership history may create its first
independent Organization and Franchise. Active, revoked or disabled-access staff cannot
use bootstrap to replace their existing access. Membership history prevents re-enrollment
from bypassing revocation. The initial membership is exactly `org_admin`, organization
scope with no explicit Franchise action grants, using #14's bootstrap seam. It can read
the approved organization/franchise profiles and manage other memberships under W42.
It does not inherit `franchise_admin`, booking, pricing, export or operational permissions.
No new role or self-escalation path is introduced.

## API

All routes require the current authenticated cookie. Mutations also require the existing
Origin, SameSite/browser binding and X-CSRF-Token checks. GET `/auth/bootstrap` obtains
CSRF proof; it never supplies business authorization. Responses use `Cache-Control:
no-store`, natural success DTOs and the established safe error envelope.

`POST /api/v1/onboarding` requires exactly one `Idempotency-Key` header and this body:

```json
{
  "display_name": "Synthetic independent shop",
  "franchise": {
    "display_name": "Synthetic Pune counter",
    "franchise_code": "MAIN"
  }
}
```

Names are 1–120 Unicode characters, without surrounding spaces, control characters or
lone surrogates. Code matches `[A-Z][A-Z0-9_]{0,31}` and is permanent. Strings are not
silently normalized. Unknown fields, client ownership, role, membership and scope claims
are rejected with 422. No address, phone, provider credentials or subscription fields.

201 returns `command_id`, `organization: {id, display_name}`, `franchise: {id,
display_name}`, and `role: "org_admin"`. It does not return a session token, membership
record or replay fingerprint. The client subsequently reloads current context.

`GET /api/v1/operator-context` returns `user_id`, `state`, `franchises`, and
`active_franchise_id`. State is `ready`, `onboarding_required`, or `scope_unavailable`.
Each Franchise contains only `id`, `display_name`, `organization: {id, display_name}`,
and the current applicable role names. Organization discovery uses live self-memberships;
R02 permissions enter the existing SQL predicate before profiles are returned. Disabled
organizations/franchises are excluded from usable shell contexts. This does not change
#12's administrative disabled-profile read contract. Delivery-agent assignment-only
projections are not widened into franchise browsing.

`GET /api/v1/operator-context/franchises/:franchiseId` selects an already permitted,
active scope and returns the same context shape. A valid sibling or foreign ID has the
same 404 as an unknown ID. Neither route accepts query fields. A selector is a narrowing
request, not a persisted grant. The default is the first permitted result in stable
Organization-ID then Franchise creation/ID order; no browser state is needed on reload.

Invitation acceptance uses the unchanged `POST /api/v1/membership-invitations/accept`
service and `{token}` body. Successful acceptance reloads permitted context. Wrong
identity, expiry, revocation and reuse retain the existing controlled rejection. An
uncertain acceptance is reconciled through context; the UI does not silently re-accept,
reactivate an old membership, or persist the invitation secret.

## Atomicity, replay and concurrency

The coordinator runs inside the existing membership transaction helper over
`withTransaction`. It takes the identity lock before locking the session for bootstrap,
then revalidates the session. Concurrent requests from different sessions or keys share
that identity lock. Existing grants, invitation acceptance, account disable and revocation
continue to use the existing transactional authority model.

The owning tenancy seam inserts the roots and appends organization/franchise bootstrap
facts through #16. The owning membership seam inserts/audits the initial administrator.
The immutable onboarding command/result is inserted before the same commit. Any failure
rolls back all roots, membership, success audit and replay evidence. No provider I/O,
parallel transaction implementation or new outbox event catalog is introduced.

The pre-tenant identity namespace is the explicit #17 refinement of #4: `(user,
authenticated_user_id, null, null, api.v1.onboarding.create, request_key)`. The organization
cannot exist or be selected by the caller before bootstrap. Once created, the evidence
references the resulting Organization, Franchise and membership through FKs. The unique
`user_id` primary key also prohibits duplicate initial workspaces across different keys.
There is no global raw-key lookup or cross-user replay.

Fingerprint v1 is SHA-256 of the recursively sorted, validated canonical object containing
`body`, normalized `content_type`, `operation_id`, empty `query` and empty `resource_ids`.
The operation has no omitted defaults. Correlation, session and request-key transport
are excluded. Same key/body returns the original 201 DTO without new audit or mutations;
same key/different body returns 409 `IDEMPOTENCY_CONFLICT`. A different key after completed
bootstrap returns 403 and the client reconciles through context. Replay first checks
current active scope and org-admin authority, including disabled roots. It never discloses
conflicting fingerprints or an inaccessible original result.

The row records normalization version, command ID, original DTO and retention at least
24 hours from commit. No cleanup deletes this initial-bootstrap evidence: it also owns
the permanent first-workspace uniqueness invariant. Retention maintenance remains #72.
Bounded identity-lock contention returns 409 `IDEMPOTENCY_IN_PROGRESS`; other database
failures produce controlled 503; a timeout or lost COMMIT acknowledgement
does not prove rollback. Retain the same request key/body and retry or GET context.

## Browser authority and recovery

Production is the default composition. `AppProvider`, the original Launcher, prototype
Settings, customer persona, browser Business and all operational mock screens are mounted
only in `DemoApp`/`DemoBusinessShell` with `VITE_DATA_MODE=demo`. Production reuses the M3
components, typography, cards, navigation and shell styles. Services belonging to later
issues stay unavailable; #17 does not turn demo customer/booking data into production.
Issue #18 retains the broader per-domain adapter migration.

The small operator data-access seam is cookie/CSRF based, same-origin and `no-store`.
It does not import the demo store. Each scope load synchronously clears the current
context, aborts old requests and advances a generation. All scoped work publishes only
when its captured generation still matches. Correctness does not depend on transport
honoring AbortSignal. A route mismatch hides old data even before React effects run.
The shell subtree is keyed by Franchise. Navigation, focus/resume and explicit refresh
revalidate server authority; failed/denied requests clear context and show safe recovery.
Revocation is effective on the next protected operation, not an unimplemented push event.

Session storage retains only an uncertain onboarding request key and minimum business
body, keyed to the authenticated identity, to replay the exact command across reload.
It is untrusted input, revalidated by the server, and never used to reconstruct a workspace,
membership, role or session. A committed GET context clears it. Storage unavailability
still cannot create duplicates because the server enforces identity uniqueness. Session,
OTP and invitation secrets are never stored there. An uncertain form locks its fields
and offers same-request retry; confirmed validation failure permits correction. API
failure never activates a localStorage fallback.

## Migration and rollout

Apply new forward-only migration `1789232400000-independent-onboarding.cjs` first. No
released migration is edited and no existing root/membership rows are duplicated or
backfilled. Old application versions remain compatible. The runtime needs SELECT and
INSERT on `shipit.onboarding_commands` and its existing #12–#16 grants; UPDATE, DELETE,
TRUNCATE and DDL remain denied. Configure same-origin `/auth` and `/api` proxying to the
API and approved frontend Origin before enabling the production web bundle. Vite's local
proxy defaults to port 3000; `SHIPIT_API_PROXY` changes only its development target.
Rollback uses compatible application code with the new schema retained; never reverse
an applied migration or restore browser-authoritative production writes.

## Verification and synthetic browser fixture

Use Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and Docker:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local quality
```

For the real-PostgreSQL browser fixture, use two terminals:

```sh
pnpm db:local demo:onboarding
SHIPIT_API_PROXY=http://127.0.0.1:3017 pnpm dev
```

Open `http://localhost:3017/_fixture/session`. The test-only server creates a generated
synthetic verified identity/session without printing credentials. Complete the three
fields, reload, and verify the same server workspace. Use Tab and Enter at 375×812 and
1280×900. `http://localhost:3017/_fixture/disable` disables that
synthetic account and redirects to protected navigation; no old workspace remains.
Ctrl-C removes the registered disposable database/roles and container. Fixture routes
exist only in the guarded test executable, never in production server composition.
Port 3017 avoids interfering with an existing local API on port 3000.

The DB tests use the canonical Alpha/A1/A2/Beta/B1 fixtures and actual runtime credentials.
They assert persisted owners and grants, rollback after each real SQL write, concurrent
keys, lost COMMIT, restart, foreign IDs, revoked/disabled scope and invitation rules.
The web suite retains the 24 demo regressions and adds production onboarding, validation,
retry, reload, scope-generation race, revocation, invitation and authentication tests.
See [Issue #17 evidence](issue-17-verification.md) for executed results and limitations.
