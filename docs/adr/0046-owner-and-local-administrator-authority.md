# ADR 0046: Owner and local administrator business authority

Status: product decision approved in issue #190; implemented and locally verified; independent security review and release qualification pending.

## Decision

The existing `org_admin` role is presented as **Owner**. It may perform implemented,
enabled business administration and operational actions in franchises owned by its current
organization. `franchise_admin` receives the same local business actions only in its explicit
current franchise grants. Neither role inherits staff identity or creates another membership.
The other five roles retain their existing action and projection permissions.

Amend the seven-role matrix in `architecture/authorization-contract.md` and its synthetic
fixtures before changing enforcement. An explicit browser-safe action catalogue expresses
administrative permissions; server membership resolution and scoped SQL remain authoritative.
Unknown actions fail closed. Organization settings and owner grants remain owner-only.

## Actor-bound exceptions

Delivery completion, failed-delivery recording, challenge resend/replacement and exceptional
proof requests require the real assigned delivery agent. Custody acknowledgement/release
requires the actual participating agent. Cash-handover acknowledgement requires its named
recipient; administrative access does not acknowledge for somebody else. A separate actual
staff assignment may satisfy these rules, but no administrative role fabricates it.
Owners/admins may dispatch, assign/retry deliveries, authorize custody transfers and approve
eligible exceptional proof requests. Requester/approver independence, existing cash-close
sole-admin policy, customer consent, enabled-feature checks, immutable money/proof evidence,
quarantine, versions and idempotency remain mandatory.

## Implementation and verification

Resolve owner scope from live membership plus organization-owned franchises; resolve local
administrator scope from live explicit grants. Keep original actor IDs and membership revision
in audit/retry context. Recheck at execution/download boundaries. Preserve organization locks
used to serialize protected work with revocation. Extend database predicates through a new
forward-only migration; never rewrite released migrations or backfill duplicate roles.

Table-driven policy tests, real PostgreSQL allow/deny/upgrade/revocation and financial/proof
tests, and actual UI journeys must cover A/A1/A2 versus B/B1 and restricted/mixed roles.
Independent review, final-head CI, #71 authorization qualification and #76 deployed-artifact
evidence remain required release gates; local implementation does not approve deployment.

## Research and tradeoffs

Adapt [AWS tenant-isolation guidance](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-api-access-authorization/introduction.html):
an allowed action still needs a tenant boundary. Retain existing scoped SQL rather than add a
policy server. This adds a typed catalogue and tests, without a network dependency.
Retain [PostgreSQL row locking](https://www.postgresql.org/docs/18/explicit-locking.html)
in the existing transaction order for revocation safety; do not cache login-time role claims.
Use a [security-invoker view](https://www.postgresql.org/docs/18/sql-createview.html) so the new business-scope projection retains underlying runtime grants instead of acquiring view-owner privileges. It stores no new grants or staff identities.
Reuse the prior [membership research](../architecture/membership-authorization-research.md).

## Rollout and rollback

Deploy additive database changes before the compatible API/UI pair. Existing memberships
gain the amended actions without data conversion. All feature flags retain their previous
defaults. Roll back the API/UI pair to restore the previous permission ceiling; keep additive
schema and all committed business history. Repair schema only through a forward migration.
Do not deploy while #190 remains open or required review/qualification is incomplete.
