# ADR 0013: Tenant-scoped repository capabilities

Status: proposed for independent review through Issue #15; effective on approved merge.
Date: 2026-09-10. Supersedes no role/action grant in ADR 0006, 0010 or 0012.

## Decision

Retain parameterized PostgreSQL queries and the existing ApprovedTenancyContext.
Repositories require a server-issued TenantAccess capability: an immutable context
plus an executor retained privately in a WeakMap. Copies, structural casts, missing
contexts and expired transactions cannot query. Each query declares its permitted
actions and includes a scope macro expanded into bound ownership predicates.
Read/list/export capabilities cannot execute writes. The issuer is available only
to explicitly checked server adapters; it is never a request validation API.

Membership authority comes from the authenticated live session/user and live grants.
Private object lookup searches only those organizations, with permitted franchise
predicates in selection and locking SQL. Read projections intersect grant scopes in
SQL; grant mutations require authority over every attached franchise. No global
membership/invitation ID-to-organization discovery remains. Secret invitation lookup
is separately constrained by authenticated invitee identity and the token hash.

Use compensating query restrictions rather than RLS for this iteration: immutable
server-derived context, scoped repository API and SQL ownership predicates, composite
ownership constraints, least-privilege runtime identity, AST CI gate and real runtime-role
regressions. No PostgreSQL session variable or persistent connection scope is introduced.
Capabilities tied to transactions expire at transaction end. Tests alternate A/C/A on
one backend and cover rollback, pool replacement and missing context.

## Alternatives and limits

RLS can provide a second independent row boundary but requires fully specified role,
policy, transaction and pooling context semantics. This change deliberately does not
introduce partially tested policies or SET LOCAL state. Runtime credentials still have
SELECT privilege across tenant rows: possession of those credentials or compromise of
a trusted issuer remains outside this application query guard. Do not describe this as
RLS-equivalent protection from arbitrary SQL execution.

The AST gate prevents accidental raw access and absent scope markers; it is not a SQL
proof engine or a defense against a malicious code author. Review SQL joins, predicate
placement, projections and new exceptions, and exercise each new domain with the shared
fixture. Revisit RLS with a separate ADR and pooling/runtime-policy matrix before adoption.

One forward migration adds missing composite ownership FKs for membership audit
references and indexes for those references and invitation scope lookup. No applied
migration is changed. Details, exceptions and downstream usage are in
[tenant query isolation](../architecture/tenant-query-isolation.md).
