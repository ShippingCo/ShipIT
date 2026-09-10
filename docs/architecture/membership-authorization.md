# Membership and invitation API

Authentication proves identity; these endpoints add Organization and Franchise authority.
They are registered only when authentication is configured and use the same session,
Origin and CSRF boundary as the authentication API.

## Roles

`org_admin`, `franchise_admin`, `operator`, `dispatcher`, `delivery_agent`, `accountant`,
and `read_only` are the only accepted roles. A non-`org_admin` membership requires at least
one Franchise ID. An `org_admin` may have an empty scope for organization management and
may carry explicit Franchise IDs only for actions such as W41 that require a target grant.

## Endpoints

| Method and path | Purpose | Success |
| --- | --- | --- |
| `GET /api/v1/organizations/{organization_id}/memberships` | Safe visible membership roster | 200 list |
| `GET /api/v1/organizations/{organization_id}/invitations` | Safe visible invitation roster | 200 list |
| `POST /api/v1/membership-invitations` | Create a seven-day identity-bound invitation | 201 invitation plus one-time `acceptance_token` |
| `POST /api/v1/membership-invitations/accept` | Accept as the named user | 201 membership |
| `POST /api/v1/membership-invitations/{invitation_id}/revoke` | Revoke a pending invitation | 200 `{ "ok": true }` |
| `PATCH /api/v1/memberships/{membership_id}` | Replace role and exact Franchise scope | 200 membership |
| `POST /api/v1/memberships/{membership_id}/revoke` | Revoke access | 200 `{ "ok": true }` |

Create input is `{organization_id, invitee_user_id, role, franchise_ids}`. Acceptance input
is `{token}`. Update input is `{role, franchise_ids, expected_version}`; revoke input is
`{expected_version}`. All objects are strict and reject unknown fields. IDs are lowercase
UUID strings. The acceptance token appears only in the successful create response.

Mutation responses use the shared 401/403/404/409/422/503 envelope. `MEMBERSHIP_CONFLICT`
and `INVITATION_CONFLICT` are 409 errors. `VERSION_CONFLICT` protects stale changes.
Foreign and unknown object IDs return the same 404. Expired, reused, revoked or
wrong-identity invitation tokens return the same 403.

## Operations

Apply migrations using the migration identity. The runtime needs SELECT/INSERT on the four
membership/invitation tables, controlled role/lifecycle/version/timestamp UPDATE columns,
DELETE only on membership scope rows, and INSERT only on `membership_audit_events`. It
receives no audit UPDATE or DELETE. Rollback disables the routes while retaining the
additive schema; do not reverse an applied migration.
