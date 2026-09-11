# ADR 0010: Organization and Franchise persistence and lifecycle authority

Status: submitted for external review through Issue #12; effective on approved merge.
Date: 2026-09-08 (UTC). Owner: #12 / tenancy.

[Domain contract](../architecture/domain-contract.md#organization-and-franchise-persistence--issue-12) · [Authorization](../architecture/authorization-contract.md#issue-12-tenancy-administration-amendment) · [API](../architecture/api-contract.md)

## Context and authority

Issues #3, #10 and #11 are merged. Issue #12 starts on post-#11 main
`f3130f9c9dd1ee5298211081e323c10f4304667a`. ADRs 0003/0006 establish one Organization
owning one or more Franchises, private current scope and closed staff actions. They
do not define root lifecycle states or a franchise disable/reactivate action. The
project owner's explicit Issue #12 instructions authorize the smallest reviewed
amendment for those missing contracts, while preserving W35's denial of broad
organization administration. This ADR amends only those boundaries and the necessary
stable API error additions; all unrelated ADR 0006/0007 policies remain in force.

## Decision

Organization and Franchise persist as the two canonical tenancy roots. A standalone
shop is one of each; a larger business has additional Franchises under the same
Organization. There is no carrier enrollment requirement, tenant-type discriminator,
edition or subscription state. Each root has server-generated UUID identity, a minimal
business display name, `active`/`disabled` lifecycle, positive PostgreSQL integer version and
UTC creation/update/lifecycle timestamps. Franchise adds immutable Organization
ownership and a stable code already matching `[A-Z][A-Z0-9_]{0,31}`, without normalization.
Codes are unique within an Organization and may repeat across unrelated organizations.
The stored version ceiling is 2147483647; commands accept expected versions through
2147483646 to prevent increment overflow. Exhausted roots remain readable but reject
further mutation/no-op requests until a reviewed forward schema widening.

PostgreSQL enforces the parent FK, `(organization_id, id)` ownership candidate key and
scoped code uniqueness. The runtime identity receives SELECT/INSERT and mutable-column
UPDATE privileges only; identity, ownership, code and creation time stay immutable and
runtime hard-delete/truncate/DDL remain denied. Migrations remain forward-only. The
Organization-leading code, ownership and `(created_at, id)` indexes cover the implemented
lookup/list paths. No downstream business tables or adoption mechanism are added.

The only new staff action is W41 `franchise.lifecycle.manage`: org_admin needs an
explicit target-franchise F grant within its own Organization, and franchise_admin
needs its own F scope. W41 permits only `active` → `disabled` and `disabled` → `active`,
with expected version and the respective controlled `administrative_disable` /
`administrative_reactivate` reason. The narrow org_admin grant supports delegated
organization control over stopping/recovering a location; franchise_admin authority
supports the independent shop. O reads do not imply this F action. W41 confers no
operations, customer/payment access, exports, membership escalation, organization
configuration, creation, adoption/reparenting or cross-organization permission.
W29 remains franchise_admin F for display-name profile correction on an active Franchise
and active parent; W34/W35 stay denied. W41 recovery is available while either root is
disabled, but an Organization must itself be active before operational work can resume.

Organization/bootstrap and Organization profile/lifecycle services use explicit internal
service authority, not a new staff role. Bootstrap can atomically create Organization +
initial Franchise without creating identity or membership. The trusted authorization
seam supplies current approved staff actions/scopes for read, list, profile and franchise
lifecycle services. No private tenancy route is registered in normal production HTTP
composition before #13/#14. Later #17 combines onboarding identity, membership and replay.

Disabled roots retain ownership/history and currently authorized safe reads. The active
write guard checks both root states/relationship and retains transaction row locks until
the guarded operational write commits; organization-before-franchise lock ordering is
shared with lifecycle administration. Disable linearizes at commit: an earlier serialized
write may finish first, while subsequent new guarded writes fail closed. Recovery does
not revive revoked access. Versions prevent lost updates; same-state intent with a
current accepted version is a no-op without a false change fact. The safe typed audit
port notifies after committed administrative changes. Adapter failure can return 503
after commit, and a crash can lose the notification; no delivery/retry or durable audit
guarantee is claimed. #16 must implement durable transactional audit before private route
activation; ADR 0004's audit/outbox obligation remains intact.

ADR 0007 gains only 409 `FRANCHISE_CODE_CONFLICT`, `FRANCHISE_DISABLED` and
`ORGANIZATION_DISABLED`, disclosed after approved visibility/action scope. Internal
keyset pagination applies permitted SQL scope before count/page computation; public
opaque cursor and replay infrastructure stay with their existing owners.

## Consequences, review and downstream gates

The migration and real PostgreSQL tests prove tenancy roots, ownership combinations,
privileges, bounded scope, persistence, optimistic races and disable/write ordering.
They do not implement authentication, membership/RBAC, product-wide #15 tenant context,
durable audit, future business writes or public onboarding. Safe synthetic service/API
tests cannot be presented as those missing controls.

Before production private routes activate, #13/#14 must supply live identity, grants and
revocation; route owners must implement cursor integrity and applicable idempotency;
#16 must supply durable transactional audit integration. #79 owns any adoption workflow
with separately reviewed ownership-history, grant migration and recovery costs. The new
W41 policy and lifecycle enum become accepted only when this Issue #12 PR is externally
reviewed and merged. The PR must remain open for that review; an open PR does not satisfy
downstream prerequisites.


## Issue #16 implementation amendment

Issue #16 replaces the historical post-commit notification described above with mandatory
transactional durable insertion; the optional observer now runs before commit and cannot
replace storage. This satisfies ADR 0004 without creating an outbox or activating new
administrative routes. [The audit contract](../architecture/audit-contract.md) defines the
compatible schema, runtime privileges, R28 projection and denial boundary; its PR remains
subject to independent review. Earlier limitations above describe the released #12 state.
