# Membership authorization research for Issue #14

## Question

How do mature technology platforms manage staff roles and invitations without letting a
user cross company or location boundaries, keep old access after removal, or take over the
last administrator account?

## What mature platforms do

GitHub separates organization membership from the user account, uses named roles, and
recommends least privilege. It also recommends at least two organization owners so loss of
one owner does not strand the organization. GitHub owners cannot change their own role.
Its organization audit log records who acted, what they did and when. These are strong
signals that identity, membership, administrator continuity and audit should be separate
concepts rather than fields copied into a login token.[^1][^2][^3]

Stripe uses predefined team roles and tells administrators to grant the lowest permission
needed. It distinguishes organization-level roles from account-level roles, which mirrors
ShippingCo's Organization and Franchise boundary. Stripe invitations expire rather than
remaining permanent bearer links.[^4][^5]

WorkOS represents organization membership as its own resource connected to a user and an
organization. Roles and permissions are evaluated through that membership. Its invitations
expire after seven days and an administrator can revoke a member immediately.[^6][^7][^8]

Auth0 requires the invited person to authenticate with the invited email identity and
supports an explicit invitation lifetime. Microsoft Entra documents the same important
idea: invitation redemption is bound to the intended identity, not merely possession of a
link.[^9][^10][^11]

Google Cloud IAM and OWASP both recommend least privilege, deny-by-default policy and an
authorization check on every request. OWASP's token guidance also supports random,
single-use, expiring secrets stored safely instead of reusable plaintext invitation
links.[^12][^13][^14]

## Applied design

ShippingCo therefore uses these simple rules:

1. A login proves who the person is. A membership separately says what they may do.
2. Every membership belongs to one Organization and has one fixed role.
3. Local roles list exact Franchise IDs. A submitted tenant ID is never proof of access.
4. The server reads current membership state on each protected request, so revocation is
   effective on the next request.
5. An invitation names the intended user, role, Organization and Franchise scope. It lasts
   seven days and works once.
6. Only a digest of the 256-bit invitation secret is stored. Logs and audit rows never hold
   the secret or contact address.
7. A Franchise administrator cannot grant Organization administrator access or access to a
   sibling Franchise.
8. Administrators cannot edit or revoke themselves, and the final active Organization
   administrator cannot be removed.
9. Competing accepts and administrator changes are serialized in PostgreSQL and use record
   versions, so only one valid result commits.
10. Unknown and foreign object IDs look identical to callers who cannot see them.

## Why not a large policy product now?

The approved ShippingCo matrix is small and fixed. A separate policy service would add a
network dependency, synchronization problem and new failure mode without improving this
milestone. Keeping the rules in a typed server policy and PostgreSQL makes revocation and
transaction behavior easy to verify. If future requirements add customer-defined roles or
complex relationship graphs, that should be a new reviewed decision rather than a silent
expansion of this implementation.

## Sources

[^1]: [GitHub, Roles in an organization](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/roles-in-an-organization)
[^2]: [GitHub, Maintaining ownership continuity](https://docs.github.com/en/organizations/managing-peoples-access-to-your-organization-with-roles/maintaining-ownership-continuity-for-your-organization)
[^3]: [GitHub, Reviewing the organization audit log](https://docs.github.com/en/organizations/keeping-your-organization-secure/managing-security-settings-for-your-organization/reviewing-the-audit-log-for-your-organization)
[^4]: [Stripe, Manage team members](https://docs.stripe.com/get-started/account/teams)
[^5]: [Stripe, Organization and account roles](https://docs.stripe.com/get-started/account/orgs/team)
[^6]: [WorkOS, Organization memberships API](https://workos.com/docs/reference/authkit/organization-membership)
[^7]: [WorkOS, RBAC integration](https://workos.com/docs/rbac/integration)
[^8]: [WorkOS, Members and roles](https://workos.com/docs/dashboard/members-and-roles)
[^9]: [Auth0, Invite organization members](https://auth0.com/docs/manage-users/organizations/configure-organizations/invite-members)
[^10]: [Auth0 Management API, Create invitations](https://auth0.com/docs/api/management/v2/organizations/post-invitations)
[^11]: [Microsoft Entra, Invitation redemption](https://learn.microsoft.com/en-us/entra/external-id/redemption-experience)
[^12]: [Google Cloud IAM, Use IAM securely](https://docs.cloud.google.com/iam/docs/using-iam-securely)
[^13]: [OWASP, Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
[^14]: [OWASP, Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
