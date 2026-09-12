# Tenant query isolation

[ADR 0013](../adr/0013-tenant-scoped-query-capabilities.md) ·
[Verification](issue-15-verification.md) · [Authorization](authorization-contract.md)

## Authority and lifetime

A browser supplies resource selectors, never authority. Staff access follows the
server session → live user → active memberships → action policy → Organization and
permitted Franchise IDs → scoped repository → parameterized SQL chain. There are
still seven roles. Organization administrators have only approved own-organization
actions; export eligibility remains E01/E03, with no organization-admin export grant.

`ApprovedTenancyContext` remains the tenancy authorization contract. Its server-only
extension `PrivateContext` adds action-specific membership permissions, provenance,
organization-wide membership management and (only for acceptance) invitation identity.
It contains safe actor, ownership and correlation references, never session/token hashes,
OTP values, addresses or raw request/event bodies. The issuer explicitly copies an
allowlist of fields, freezes nested objects/arrays and registers an opaque capability.
A structural object, cloned capability or expired transaction fails before query execution.

`withStaffTenantScope` authenticates, locks the own Organization and re-reads live grants
inside the same transaction as its callback. Future private domains use this operation
boundary; they must extend the closed action policy before introducing a new permission.
The callback receives only `TenantAccess`, not a raw pool. Membership services similarly
hold authorization and mutations in one transaction, preserving final-admin serialization.
The existing server-injected tenancy authorizer remains an internal composition port;
its approvals are checked per service call and copied before repository access. Its
legacy `authorize()` interface returns a snapshot; do not cache/reuse approvals across
requests. New domain work should use the transaction-lifetime staff boundary.

## Repository contract

Production private repositories accept `TenantAccess`. The executor is inaccessible
from that public object. `scopedQuery(scope, [allowedAction], sql, parameters)` checks
capability provenance/lifetime and action before SQL. Read, list and export actions
cannot issue INSERT, UPDATE or DELETE. Missing ownership markers also fail before SQL.

The closed scope macros generate predicates and append **bound values**:

- `{{organization:organization_id}}` limits an organization-owned record. Tenant roots
  use their `id`. An insert uses the same guard against its ownership parameter.
- `{{franchise:organization_id:franchise_id}}` requires both Organization and the
  permitted Franchise set. Franchise roots use `id` for the franchise column.
- `{{membership:m}}` / `{{invitation:i}}` combine organization ownership and correlated
  scope predicates. Reads require overlap; mutations require the complete existing
  grant to be manageable. Acceptance additionally binds invitee and invitation identity.
- `{{franchises}}` and `{{organizationWide}}` bind trusted values for nested projection;
  they alone do not satisfy the required ownership predicate.

For example, a future operational projection keeps ownership before search/order/limit:

```ts
return scopedQuery(scope, ['franchise.profile.read'], `
  SELECT r.id, r.label FROM synthetic.private_records r
  WHERE {{franchise:r.organization_id:r.franchise_id}} AND r.label ILIKE $1
  ORDER BY r.id LIMIT 3`, [search]);
```

This is a **test-only synthetic projection**, not a new business endpoint or a grant to
read operational records with a profile permission. Real domains must declare their own
approved actions and safe fields. The fixture tests use the same seam for detail, search,
counts, pagination and E01-style export projections; export grants do not widen scope.
No customer, parcel, booking, product search or export tables/routes are introduced.

Existing selectors remaining in repository signatures are narrowing constraints only:
they are checked against the capability and cannot substitute for its ownership. Strict
DTO validation rejects ownership replacement. Ordinary UPDATE SQL cannot change owners,
and runtime column grants independently prohibit it.

## Nested records, counts and not-found behavior

Membership and invitation scope joins include both parent identity and organization.
Franchise administrators receive only their permitted nested franchise IDs, aggregated
inside SQL. There is no JavaScript filtering of unauthorized roster rows or scope IDs.
A multi-franchise grant can be read through its authorized intersection, but cannot be
mutated by an administrator lacking any attached scope. Foreign/unknown IDs have the same
404 code and envelope; non-managers also get 404 for inaccessible object mutations.
An own-organization collection/action denial is 403. Random request IDs differ normally;
no claim of constant wall-clock timing is made.

The same ownership predicate precedes count/search/order/keyset/LIMIT computation. The
synthetic A=3, B=50, C=7 regression proves A's total and final-page has_more do not include
foreign rows. Future public cursors must also bind scope/query/expiry under #23.

Migrations from #12/#14 already supply composite Franchise and membership/invitation
ownership keys and FKs. Migration `1789059600000-tenant-audit-ownership.cjs` adds missing
`(organization_id, membership_id)` and `(organization_id, invitation_id)` audit FKs plus
supporting indexes. Existing inconsistent audit data would fail migration validation;
repair requires a reviewed forward data correction, never deletion or relaxed constraints.
Issue #16 adds [R28 audit retrieval](audit-contract.md) through a scoped canonical
compatibility view. Legacy audit writes remain INSERT-only; new facts use append-only
functions, with no direct runtime access to the new storage table.

## Trusted jobs

`withTrustedJobScope` accepts event/installation identity and an injected server resolver.
The resolver must load authoritative, active persisted records in the supplied transaction,
verify installation/event ownership and current consumer permission, and return minimal
safe facts. The boundary checks identity, revocation and action, and constructs scope from
those facts. Extra queue fields such as organization_id and franchise_id have no authority.
Unknown/revoked/mismatched records fail closed. A callback receives only the capability,
which expires with the transaction. Currently the port permits only safe franchise-profile
reads/listing; future consumers must add reviewed action mappings and adapters. It creates
no outbox, provider installation schema, production carrier worker or messaging send.
Auth OTP delivery remains a separate identity-infrastructure worker.

## Database and pool defense in depth

No RLS or tenant session variables are used. Every operation binds its own scope. A pool
cannot retain a tenant claim; transaction capability validity ends before commit/rollback.
Real tests assert the same `pg_backend_pid()` for A/C/A, rolled-back mutations, missing and
expired scope, and committed persistence after pool replacement. Existing infrastructure
tests retain damaged-connection, rollback/commit uncertainty and process restart coverage.

Migration and runtime roles remain separate. Runtime tests assert actual `current_user`,
NOSUPERUSER/NOBYPASSRLS, DDL/ownership-update denial and composite constraints. The runtime
role can still select rows with raw SQL: the capability and CI boundary protect application
code, not stolen database credentials. That is an explicit limitation of the non-RLS model.

## CI and approved exceptions

`pnpm check:tenant-queries` traverses the TypeScript AST of all API production source,
including newly added modules. It rejects raw/extracted/computed query calls, repository
DB imports, unauthorized issuer imports, pre-tenant authority imports and scoped query
calls without literal ownership markers/action allowlists. It runs inside `pnpm lint`,
therefore both `pnpm quality` and the required CI lint job. Tooling tests prove positive
and negative cases and run the actual CLI against a disposable insecure repository.
`verify:gates` also injects an unscoped production file and requires a nonzero result.
Tests/migrations are outside the application-source scan; the insecure fixture is never
production executable code. This is deterministic AST enforcement, not just text grep,
but SQL semantics and exception changes still require independent review.

Only these exact production files can issue raw application SQL:

| File | Narrow reason |
| --- | --- |
| `auth/repository.ts` | Identity/session/challenge storage, preceding tenant authorization |
| `auth/worker.ts` | Identity-bound OTP delivery/expiry, not tenant business operations |
| `memberships/authority.ts` | Live actor membership discovery, own-organization serialization and minimal franchise IDs; invite resolution requires authenticated invitee plus hash; authorized organization-wide role/invitation occupancy returns booleans only |
| `security/scope.ts` | The checked low-level capability executor itself |

The authority module can only be imported by the membership service. Issuance can only
be imported by membership service, tenancy service and the trusted-job adapter. Existing
`packages/db` pool/query/transaction/readiness/migration code remains infrastructure; API
repositories cannot import its executor primitives or driver. Bootstrap/root administration
remain explicit injected internal-service capabilities, with no HTTP route or extra role.
No other staff record-ID discovery, unrestricted audit reader, cache, signed attachment
or export exception exists. Future features must add their applicable security matrix.

### Organization-wide membership conflicts

Issue #14's partial unique indexes `memberships_one_active_role_idx` (active lifecycle)
and `invitations_one_pending_role_idx` (pending state) cover user, Organization and role,
independent of Franchise visibility. The membership service checks these slots through
two `EXISTS` operations in the existing authority exception. They require a live capability
for membership management or, for active-role occupancy only, authenticated invitation
acceptance. Organization comes from the capability; user and role come from validated,
authorized service input or the identity-bound invitation. Acceptance cannot query a
different user or exclude a membership. There is no public occupancy endpoint.

Only a boolean crosses this boundary: no conflicting record ID, scope, token, timestamp,
count or other metadata. Tenant-facing record queries and writes retain their existing
scope predicates. This preserves the existing generic 409 conflict contract without
granting access to the conflicting record. Membership role updates use the same check,
excluding only the already-authorized membership being changed.

Expiry makes an invitation unusable but does not change its stored `pending` state or
release the partial unique index. The existing expiration/replacement helper remains
scoped: a manager of the complete old grant may revoke it, append `invitation_expired`
and insert its replacement atomically. An inaccessible expired sibling grant returns
409 `INVITATION_CONFLICT` and remains unchanged, just like an inaccessible live pending
grant. An organization administrator can perform the existing replacement flow. This
retains ADR 0012's complete-grant management ceiling without exposing or automatically
revoking a sibling record through an A-only capability.

The database remains the final integrity boundary. Sanitized database errors retain
only those two reviewed index names for SQLSTATE 23505; arbitrary constraint names and
driver detail remain discarded. The membership transaction translates only those known
query failures to the existing 409 domain errors, and reports them only after successful
rollback. Other unique violations, unknown database errors, rollback failure and commit
uncertainty keep their normal 503 path. No schema, runtime grants or AST exemptions change.

## Compatibility and rollback

Public endpoint schemas and successful DTOs stay compatible. The intentional security
change is uniform 404 for inaccessible membership mutation, including a non-manager's
own membership. Frontend/demo files are untouched. Capability-required internal repository
signatures intentionally break unsafe raw-executor callers at compile time and runtime.
Disable affected routes or revert compatible application code if needed; retain the additive
migration and correct database issues forward. Do not roll back to browser authority.
#16 durable tenancy audit, #17 onboarding, #23 cursors/search, and future workers retain their
existing ownership; this foundation neither implements nor marks them ready.


Issue #16 adds the closed `audit.read` action, issued only by the existing membership
service after live session/grant resolution. The audit repository retains explicit
Organization predicates and complete historical Franchise-snapshot containment in SQL.
No new raw SQL issuer exception exists. The exact Fastify `request.query` data access in
`audit/routes.ts` is permitted; executor calls there remain rejected. The scoped executor
treats the two audit append functions as writes, preventing a read capability from invoking
a side-effecting SELECT. Positive/negative scanner tests include unscoped audit history.

## Issue #17 identity-to-workspace boundary

The existing membership authority exception also resolves immutable bootstrap evidence
by the freshly authenticated user's ID, tests whether that user has membership history,
and persists the first command after its roots/membership/audit are created in the same
transaction. Only the existing membership service can import these primitives; the AST
exception list and issuer restrictions are unchanged. There is no raw request-key lookup.
Permitted shell profiles use `usableFranchises` with R02 scope macros and active-root SQL
predicates. The [onboarding contract](independent-onboarding.md) documents the null-tenant
bootstrap namespace and live replay checks.
