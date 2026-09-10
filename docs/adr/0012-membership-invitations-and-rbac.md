# ADR 0012: Membership invitations and scoped role authorization

Status: proposed for Issue #14 review.

## Decision

Keep identity separate from authorization. An authenticated user receives access only
through a current membership in an Organization. A membership has exactly one of the
seven approved roles and an explicit set of Franchise IDs where that role is local.
Authorization reads current PostgreSQL state on every protected request; submitted
organization/franchise claims grant nothing.

Use the fixed roles `org_admin`, `franchise_admin`, `operator`, `dispatcher`,
`delivery_agent`, `accountant`, and `read_only`. The existing authorization matrix remains
the permission ceiling. An `org_admin` can manage organization-wide memberships through
the narrow W42 action. A `franchise_admin` can manage non-organization-admin grants only
inside every Franchise they administer. Nobody may change or revoke their own membership,
and no operation may remove the final active `org_admin`.

An invitation names an already-provisioned active identity, Organization, role and exact
Franchise scope. It contains a random 256-bit one-time token, while PostgreSQL stores only
its SHA-256 digest. Invitations expire after seven days, are accepted only by the named
identity, and become unusable after acceptance or revocation. Organization-row locking and
optimistic versions serialize competing acceptance, role and administrator changes.

Membership and invitation writes append a small audit fact in the same transaction. The
fact contains controlled action names, internal identifiers, role and Franchise IDs. It
contains no contact address, raw token, HTTP body or SQL. Runtime privileges permit only
the required table operations; audit rows cannot be changed or deleted by the runtime.

## Enforcement

- Collection endpoints return 403 when the authenticated user lacks management authority.
- Object endpoints return the same 404 for an unknown ID and a foreign-Organization ID.
- Role and scope are closed allowlists; unknown fields and duplicate or foreign Franchise
  IDs are rejected.
- Revocation is effective on the next request because authorization is not cached in a
  browser claim or long-lived role token.
- Authentication, membership authorization and a protected write share the owning
  transaction.

## Consequences and boundaries

This adds one migration and one Fastify membership module without a new dependency or
external authorization service. It provides the live membership authorizer consumed by
the tenancy boundary, but Issue #15 still owns product-wide scoped SQL composition and
projection tests. Issue #16 owns the general durable audit system. Issue #17 owns public
onboarding and the atomic initial identity/Organization/admin workflow; Issue #14 exposes
only a trusted bootstrap seam for that coordinator.

## Evidence

The design follows least privilege and per-request authorization guidance from
[OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html),
[Google Cloud IAM](https://docs.cloud.google.com/iam/docs/using-iam-securely),
[GitHub organization roles](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization),
[Stripe team roles](https://docs.stripe.com/get-started/account/teams), and
[WorkOS RBAC](https://workos.com/docs/rbac/integration). Invitation identity binding and
short expiry align with [Auth0 Organizations](https://auth0.com/docs/manage-users/organizations/configure-organizations/invite-members)
and [WorkOS membership administration](https://workos.com/docs/dashboard/members-and-roles).
