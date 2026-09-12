# Append-only audit and safe security telemetry

Issue #16. [Authorization R28](authorization-contract.md), [API pagination](api-contract.md),
[ADR 0004](../adr/0004-durable-events-and-transactional-outbox.md), and
[ADR 0013](../adr/0013-tenant-scoped-query-capabilities.md) remain the policy ceiling.
[Verification and synthetic demo](issue-16-verification.md).

## Canonical facts and compatibility

`shipit.audit_history` is the canonical, read-only projection. It combines three disjoint
sources with namespaced unique IDs (`audit:UUID`, `membership:UUID`, `identity:UUID`):

| Source | Write path | Ownership / projection |
| --- | --- | --- |
| New `audit_records` | Transactional `append_tenancy_audit` or separate `append_security_denial` function | Tenancy owns its actual Organization and optional Franchise; denials have identity context only |
| Existing `membership_audit_events` | Audit module's `appendMembership(TenantAccess, fact)` in the membership transaction | Original Organization and immutable snapshot of the complete Franchise grant |
| Existing `auth_security_events` | Auth repository's identity event seam in the identity transaction | No Organization/Franchise; never exposed by tenant retrieval |

No historical rows are copied, deleted, reassigned or rewritten. The compatibility view
projects original timestamps/IDs/actions and redacts by selecting explicit columns.
Old application inserts continue to appear exactly once. Two nullable correlation columns
are additive; legacy rows use their original fact UUID as a deterministic correlation
reference, **not a claim of a historical HTTP request ID**. New HTTP successes carry the
server-generated request UUID. Internal callers get generated correlation references;
trusted tenancy references that predate UUID correlation get a generated UUID. These
references correlate evidence and do not authorize anything.

The new migration validates existing membership Franchise snapshots against their own
Organization before enabling the view; invalid/null foreign IDs fail the entire migration.
A new insert trigger keeps that invariant for legacy-compatible writers. Existing composite
membership/invitation ownership FKs are retained. Legacy and new timestamps must be finite.
Organization/Franchise references use RESTRICT ownership FKs. All applied migrations remain
unchanged. Code rollback retains the additive schema, view and legacy stores. Do not roll
back to pre-#16 tenancy administration in production: that code still has the audit gap.
Schema repairs and any later conversion/backfill require another forward migration.

The new storage has no JSON, payload, narrative or arbitrary metadata field. Bounded,
closed action/resource/result/reason codes, actor reference (maximum 128 ASCII reference
characters), UUID resource/correlation references and UTC time identify the fact. Safe
change data is restricted to lifecycle before/after and positive committed version;
membership compatibility adds one of the seven roles and at most 100 Franchise UUIDs.
A successful bootstrap is one Organization-plus-initial-Franchise fact. Lifecycle no-ops
produce no change fact. Auth provision/disable/enable identify the trusted authentication
service and affected identity; self-auth actions identify the user.

No OTP, verifier, session or invitation token, provider secret, contact address/phone,
full postal address, business display name, request body, raw provider payload, arbitrary
error or stack is accepted into the audit schema/projection. UUID references are not
permission to drill through: the owning service must authorize every subsequent lookup.

## Transaction and denial durability

Tenancy always calls `appendTenancy` on a transaction-bound TenantAccess before commit.
The optional old `audit.record` argument now serves only as an in-transaction observer
for tests/validation **after mandatory storage insertion**; it cannot replace storage.
It must not perform external effects or claim commitment. Its failure aborts the transaction.
Both state and audit roll back when anything fails after insertion. A lost COMMIT response
returns controlled 503 while committed state and its fact remain together. There is no
post-commit success-audit callback, retry worker or general outbox here.

Membership mutation and the existing append share their original transaction. Complete-
grant authorization, identity-bound invitation acceptance, expiry, concurrency, final-admin,
self-change, uniqueness and optimistic-version semantics remain intact. The audit module
owns that append; it writes only the legacy source, not a second canonical copy. Identity
login/logout/link/revoke/provision facts keep their original atomic identity behavior.

The deployed authenticated Fastify boundary awaits a separate, autocommitted security
append before replying to controlled 401/403/404/429 exceptions. This runs after a rejected
business transaction has rolled back and also covers CSRF rejection before business work.
Denials contain action class, resource class, result/reason, server correlation and time.
A live valid session supplies the actor ID; otherwise actor is anonymous. **No denied path
looks up the guessed target, owner, scope, contact or existence.** Consequently the only
authorized context recorded is the caller's identity, with null tenant/target fields.
This intentionally keeps unknown and foreign attempts indistinguishable. Tenant readers
cannot browse identity-only denial history; restricted incident investigation uses the
privileged maintenance identity. There is no public global administrator or incident API.
Internal coordinators without HTTP must use the narrow denial adapter when they expose a
security action; this does not activate new coordinators/jobs or production tenancy routes.

If the database cannot durably append a denial, the operation remains denied. A fixed
`security_audit_unavailable` log with server correlation and a recording-failure counter
reports the observability outage; no false audit success is reported. This is not a promise
to persist evidence during a database outage, and it never falls back to localStorage.

## Runtime privileges

The migration owner owns the tables/view/functions. PUBLIC has no table/view/function
access. Deployment grants its separately resolved runtime identity only:

- SELECT on `shipit.audit_history`;
- EXECUTE on `shipit.append_tenancy_audit(uuid,uuid,text,text,text,text,uuid,text,uuid,timestamptz,text,text,integer)`;
- EXECUTE on `shipit.append_security_denial(text,text,text,text,text,uuid)`;
- existing INSERT-only privileges on the two legacy audit stores.

No runtime privilege on `audit_records` is needed, including direct INSERT. Append
functions are SECURITY DEFINER with fixed `search_path=pg_catalog`, schema-qualified
relations, fixed SQL, typed arguments and no dynamic SQL. The denial signature cannot
accept target, tenant or change data. Runtime cannot UPDATE/DELETE/TRUNCATE history,
replace the view/function, disable triggers, change ownership, acquire migration role or
create schema objects. Normal raw runtime SELECT remains cross-tenant at the credential
level, as explicitly accepted in ADR 0013; R28 is enforced by live authorization plus
scoped SQL, not RLS. Do not grant broad default privileges or use migration credentials
in the application. No retention/delete/privileged-maintenance workflow is introduced;
#72 owns the approved lifecycle policy.

`scopedQuery` treats the append functions as writes even though PostgreSQL invokes them
with SELECT, so read/list/export or nontransactional capabilities cannot invoke them.
The AST gate has no audit-module raw SQL exception. Its only new exception is the exact
Fastify `request.query` data property in audit/routes; calling that property remains denied.
Identity-only denial SQL stays in the already restricted identity repository.

## GET /api/v1/audit

Requires the current authenticated session; GET requires no mutation CSRF token. Uses
normal no-store/error/logging/request-ID conventions and only server-issued TenantAccess.

| Role | Effective projection |
| --- | --- |
| org_admin | Own-Organization administrative audit including its declared O cross-Franchise facts |
| franchise_admin | Facts whose nonempty complete Franchise snapshot is within the actor's authorized Franchises; no organization-only or partially foreign grants |
| accountant | No general administrative audit browser; R28 financial-only access stays reserved for financial producers, which do not exist in #16 |
| operator, dispatcher, delivery_agent, read_only | General audit browser denied |

`organization_id` is a required UUID selector, checked against live memberships, not
submitted authority. Optional `franchise_id`, `resource_type` (organization, franchise,
membership, invitation, identity, audit, request) and `resource_id` are exact filters;
resource ID requires resource type. No actor/contact/free-text filter. An exact resource
or Franchise selector with no visible facts returns uniform 404; this also applies to a
known authorized resource with no history. No existence probe is performed. Generic
collection queries with no rows return empty items. Unknown fields and duplicate/scalar
array query values are rejected.

`from` is inclusive and `to` exclusive. Dates must be real UTC RFC3339 instants with
seconds and optional 1–3 fractional digits; at least one bound is optional and both bounds
must form a positive interval. Filters are normalized before binding. `limit` defaults
to 50, ranges 1–100 and requires integer decimal notation. The only sort is
`sort=occurred_at_desc` (also the default). No offset, total count or export.

Ordering is `(occurred_at DESC, namespaced unique id COLLATE C DESC)`. PostgreSQL emits
six-digit microsecond time text so older auth timestamps do not lose precision in JavaScript.
SQL applies organization, complete Franchise scope and filters **before** boundary/limit+1.
Only the authorized extra row determines `has_more`. The DTO is exactly `items` and `page`,
with page containing `has_more` and `next_cursor` (null when finished). Items explicitly
select safe references and closed changes; no raw table dumps or nested domain joins.

AES-256-GCM opaque cursors expire after 15 minutes and use a purpose-separated key derived
from the environment's existing browser key. Cursors contain no plaintext private values.
Their binding includes actor, current membership IDs/versions/roles/grants, effective
Organization/Franchise scope, normalized filters, limit, query version and sort. Every
page reauthorizes; role revocation denies first, changed scope/query yields generic 422
`CURSOR_INVALID`. Malformed filters give 422 `VALIDATION_FAILED`. All SQL values are bound.
Rotation invalidates old cursors; restarting with the same key preserves them within TTL.
This remains a live keyset query, not snapshot reporting. Refresh for concurrently added
newer facts. Organization/time/id and Franchise/time/id indexes support new facts; legacy
organization/time and ownership indexes remain, with a new GIN scope-snapshot index.

## Operational counters and rollout

`SecurityTelemetry` is an internal adapter seam. The default `createSecurityCounters()`
keeps one process-local count per closed `(action, resource_type, reason_code, denied)`
combination and a scalar recording-failure count. Unknown labels are rejected, extra
properties are dropped, counts saturate safely, and snapshots copy values. IDs, phones,
dockets, addresses, durations and exception text never become metric labels. Standard
safe request logs retain duration and request correlation separately. #70 can attach
monitoring using this interface; no dependency, external product, dashboard or persistence
claim for in-process counters is introduced. Counts reset on process restart; audit does not.

Apply additive schema first, then explicit runtime grants, then deploy compatible code.
The audit route shares the existing AUTH_SECRET_REF activation; it is absent without auth.
Test the synthetic example below before enabling production administration. The browser
prototype remains fictional: mutable local JSON and plaintext-code timelines are not
imported, exposed or treated as production audit. No audit UI, exports, general outbox,
financial domain, privacy lifecycle or onboarding work is included.

## Issue #17 coordinator

Public independent onboarding composes three facts in one transaction: Organization
bootstrap, initial Franchise bootstrap, and initial administrator membership. Both tenancy
facts retain `organization.bootstrap` with the respective resource reference, and use the
verified user UUID as the internal coordinator actor reference. The membership fact retains
`bootstrap_admin` and its affected user reference. They share the HTTP correlation UUID.
Replay adds no success facts. The older internal #12 bootstrap continues its combined
Organization-plus-Franchise fact; no historical facts are rewritten or doubled.

## Customer producer — Issue #19

The additive Customer migration adds `customer_audit_events` and
`appendCustomer(TenantAccess, franchiseId, customerId, committedVersion)` using only
customer.create/customer.update capabilities. `append_customer_audit(uuid,uuid,uuid,uuid,text,integer,uuid)`
is SECURITY DEFINER, fixed search_path=pg_catalog, with typed references and closed actions;
it verifies the scoped current customer version. The canonical view adds namespaced
`customer:UUID` facts with `resource_type=customer`, `reason_code=contact_change`, null
lifecycle fields and positive committed version. No historical source is rewritten.
R28 retains its existing scope/role policy; safe customer audit references grant no R05
directory access. Cursor decoding accepts this additional namespaced source.

Runtime receives only EXECUTE on the new append function, no base-table privileges.
The scoped executor treats the function as a write, including side-effecting SELECT.
Customer mutation, its fact and original-result receipt share the authorized transaction.
Closed denial/resource/counter sets now include customer.read/list/create/update and
customer; guessed targets and tenant fields remain null. No contact fields, queries or
idempotency keys enter success/denial facts. [Exact contract and rollout](customers.md).

## Pricing producer — Issue #20

Pricing configuration and proposal override facts use the additive pricing_audit_events
source and appendPricing in this module. The typed SECURITY DEFINER append function has
fixed search_path=pg_catalog, no dynamic SQL, reference/closed-action/reason fields only,
current version validation and matching quote/actor/reason validation for overrides.
Runtime has EXECUTE only on the append function; no base audit table privileges. The
existing canonical view keeps its identity, previous sources and grants, adding namespaced
pricing:UUID records. No history is rewritten. resource_type=pricing selects configuration
or proposal references under the existing administrative R28 policy; this is not a booked
financial ledger/audit projection. Accountant R21 effective rates/quotes remain available.

Draft creation/replacement and publication append one success fact with the same transaction
as state and its command receipt. Every override appends a quote-linked fact; excessive
variance uses pricing.override.approve. Replay adds no fact. The shared denial adapter records
pricing.read/draft/publish/quote categories with identity-only scope after a rejected request.
No destination, weight, amount, request/key, approval/source text, address or credential enters
logs/audit; authorized policy/quote DTOs alone expose the needed commercial information.
