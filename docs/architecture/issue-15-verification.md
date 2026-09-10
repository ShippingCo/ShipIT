# Issue #15 verification

Starting main: `a9daf42988c73cc02762d7e1c02ca8d95634c2e7` (pulled 2026-09-10).
Branch: `issue-15-tenant-scoped-query-security`.
Prerequisites #10/#12/#13/#14 verified CLOSED; implementations and PR #97 merge exist on
starting main. Main CI run 34437886174 succeeded. Issue #15 moved blocked → ready →
in-progress without altering unrelated labels. Delivery stops with an open PR; no merge,
auto-merge, manual issue closure, downstream status change or branch deletion is authorized.

## Acceptance matrix

| Criterion | Evidence | Result |
| --- | --- | --- |
| A cannot read/update/count/search/export B by valid ID | `tenant-isolation.test.ts`: A/B/C SQL matrix, bound SQL predicates and exact foreign search | PASS |
| X organization admin cannot access Y | Same matrix plus HTTP organization collection denial | PASS |
| Nested joins and pagination counts stay scoped | SQL nested projection, A=3/B=50/C=7 totals and two-page test; multi-franchise membership intersection | PASS |
| Missing context fails before SQL | `tenant-scope.test.ts`: missing/null/forged/cloned/raw executor, query count exactly zero | PASS |
| Transaction/pool reuse does not retain scope | Same backend PID A/C/A, rollback, expired capability, pool replacement | PASS |
| Jobs derive scope from trusted records | Trusted event/install port; hostile payload fields, unknown/revoked/mismatched record unit cases | PASS |
| Malicious ownership never stored | Existing tenancy strict DTO tests plus membership HTTP replacement and unchanged DB assertions | PASS |
| Actual runtime DB role exercised | Runtime `current_user`, privilege flags, DDL/ownership denial; all new application SQL uses runtime pool | PASS |
| CI rejects unscoped repository query | AST positive/negative tests, actual failing CLI fixture, disposable verify:gates injection | PASS |
| Happy path survives reload/restart | Committed synthetic mutation survives pool replacement; existing API process restart tests retained | PASS |
| Valid sibling B and unrelated C, nested references/counts denied | Matrix, HTTP 404 codes, nested invitation rejection, FK rollback, audit composite FK | PASS |
| Malformed/stale/dependency errors controlled; no partial mutation | HTTP 422/409/503, unchanged version/lifecycle, rollback and existing outage tests | PASS |
| Logs/audit/API contain no prohibited secrets or unnecessary PII | Safe projections, token/log/audit checks, explicit field allowlist; no new browser code | PASS |

The tests use the canonical testkit Alpha/Alpha-1/Alpha-2/Beta/Beta-1 fixture as X/A/B/Y/C.
Synthetic private_records is disposable test schema only. Export tests assert E01 ceilings;
there is no real product export/search endpoint. Job adapters are a tested port, not an
implemented durable worker or integration. These scope limits are intentional.

## Local results

| Command/layer | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS, pinned pnpm; unchanged lockfile |
| `pnpm check:migrations` | PASS; four released files unchanged, one forward addition |
| `pnpm db:local quality` | PASS |
| Testkit / DB unit | 22 + 12 = 34 passed |
| API Vitest, including scope/job unit cases | 101 passed |
| Web regressions | 24 passed; existing React act warnings remain |
| PostgreSQL DB / migration / privilege tests | 27 passed |
| PostgreSQL API / security tests | 37 passed |
| Quality/tooling protocol tests | 14 passed |
| Typecheck / lint / build / planning | PASS |
| `pnpm db:local verify:gates` | PASS, all 23 stages, including clean/restored quality and unscoped-query rejection |
| AST targeted controls after review hardening | 4 passed; raw/extracted/computed/namespace bypasses and unauthorized authority imports rejected |
| `git diff --check` | PASS |
| `pnpm audit --json` | Completed with findings (exit 1): four moderate, zero high/critical |

No passing suite was skipped, cancelled or unavailable. The initial API invocation inside
the filesystem sandbox could not bind loopback; it was rerun with required access and
passed. Disposable PostgreSQL containers were removed by the guarded runner.

The audit identifies Vitest 3.2.6 and @vitest/mocker 3.2.6 in both API and web dependency
paths under GHSA-82fw-gwwq-j7x9. The lockfile is byte-for-byte identical to starting main;
these are existing development-tool findings, not newly introduced dependencies. A
separate reviewed dependency upgrade remains necessary; no vulnerability-free claim is
made. The existing React act warnings also remain visible and are unrelated to this patch.

## PR #98 organization-wide conflict regression

Follow-up starts at PR head `28d057d31210c74747f2612ec973534a92215aa7` on the same
branch; fetched main remains `a9daf42988c73cc02762d7e1c02ca8d95634c2e7`. The starting
working tree was clean. Issue #14's active-membership and pending-invitation partial
unique indexes apply across the Organization, while Issue #15's ordinary record
visibility correctly applies within the actor's Franchise scope. Using visibility to
test occupancy missed sibling conflicts and exposed a generic database 503.

The existing authority module now answers two organization-wide `EXISTS` questions.
It returns booleans only, derives Organization from the validated capability, and stays
import-restricted to the membership service. Creation, acceptance and role updates use
these facts. The DB error sanitizer permits only the two reviewed unique index names
with SQLSTATE 23505; the membership transaction maps them to existing conflicts after
successful rollback. No error-message parsing or broad unique-error mapping is used.

Ten new real PostgreSQL API tests in `membership-conflicts.test.ts` prove:

| Scenario | HTTP / domain result | Persisted result |
| --- | --- | --- |
| A admin invites a user with active operator membership at B | 409 `MEMBERSHIP_CONFLICT` | No invitation; every domain/audit row unchanged |
| A admin invites a user with pending operator invitation at B | 409 `INVITATION_CONFLICT` | No duplicate; every domain/audit row unchanged |
| B invitation expired but still pending | 409 `INVITATION_CONFLICT` for A admin | No mutation; an organization admin can subsequently expire/audit/replace it with 201 |
| Role appears at B after A invitation creation and before acceptance | 409 `MEMBERSHIP_CONFLICT` | Invitation remains pending; no duplicate, audit or scope mutation; sibling membership unchanged |
| A role update conflicts with B | 409 `MEMBERSHIP_CONFLICT` | No mutation; same-role update still succeeds using the authorized exclusion |
| Same role in another Organization or different role in X | 201 for authorized A invitation | Neither unrelated slot blocks creation; direct foreign-organization request is denied 403 |
| Missing/forged/cloned/expired/read-only/wrong-invitee capability | `ACTION_FORBIDDEN` before occupancy SQL | Zero occupancy queries |
| Pending-role uniqueness violation after negative occupancy check | 409 `INVITATION_CONFLICT` | Real index name and SQLSTATE asserted; transaction rolled back |
| Active-role uniqueness violation during acceptance after negative occupancy check | 409 `MEMBERSHIP_CONFLICT` | Real index name and SQLSTATE asserted; invitation and all domain rows unchanged |
| Unrelated unique constraint fails during audit insertion | 503 `TEMPORARILY_UNAVAILABLE` | Earlier invitation/scope writes rolled back; unknown constraint name not retained |

ADR 0012 permits management only over the complete grant. Expiration invalidates the
token but does not transition stored state or remove the pending index entry. The existing
scoped expiration helper is preserved: only a manager of the old grant can supersede it.
The inaccessible expired case exposes the same generic conflict as a live pending grant,
without granting A the ability to load or revoke B. Authorized replacement and its audit
remain atomic; no expiration worker or new product lifecycle is introduced.

The deterministic fallback tests execute real SQL on the leased runtime connection
between the real negative occupancy check and attempted insert. The unique index then
raises the actual PostgreSQL violation. This proves error translation without falsifying
query results or relying on scheduling; it is fault injection, not a claim of two concurrent
commits. Ordinary service requests remain serialized by the Organization lock. A separate
test-only audit trigger produces an unrelated real unique violation after partial work to
prove narrow translation and rollback. No trigger or fixture is shipped in migrations.

Responses have only the existing generic error fields. Tests inspect both response/log
redaction and boolean-only occupancy results; no conflicting IDs, scopes, counts, dates
or tokens cross the authority boundary. All SQL inputs are bound. Existing isolation,
same-connection A/C/A, runtime privilege, capability and intentionally failing AST tests
are retained unchanged. New AST controls explicitly reject authority imports/re-exports
from arbitrary services/repositories; the checker and exception list did not change.

The full quality run genuinely started disposable PostgreSQL 18.6 and executed **27 DB
and 37 API tests, zero failed/skipped/cancelled/todo**. No standalone formatter is configured;
formatting validation uses the repository lint rules and `git diff --check`. This follow-up
changes no migration, runtime privilege, dependency, lockfile, capability issuer or predicate.

## Security review and migration

[ADR 0013](../adr/0013-tenant-scoped-query-capabilities.md) documents the non-RLS decision
and its actual limits. No session scope variables, ORM, global administrator or eighth
role. Membership SQL selection/projection replaces post-query filtering; target lookup
never discovers an arbitrary foreign organization. Acceptance retains hash, expiry,
single-use and authenticated identity checks. No secret-bearing logs were introduced.

One new forward migration adds missing audit composite ownership FKs and indexes.
Applied migrations edited: **NO**. Fresh install, upgrade from four #14 migrations with
existing valid audit data, repeated no-op and cross-owner rejection are automated.
Existing malformed audit ownership fails upgrade rather than being silently accepted.
Runtime privileges remain separate from migration ownership. Rollback retains the
additive schema and disables/reverts compatible application code.

## Reproduce

Use Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and running Docker:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local quality
pnpm db:local verify:gates
pnpm audit --json
git diff --check
```

`db:local verify:gates` invokes `pnpm verify:gates` with guarded disposable PostgreSQL
configuration and a fresh dependency store. Each run generates credentials and removes
its own container/resources. No real people, provider sends or external installations.
See `apps/api/test/database/tenant-isolation.test.ts` for the reproducible A/B/C sequence.

Remote CI, exact PR head, mergeability and review-thread state must be checked after
pushing; local results alone do not establish them. Independent approval is intentionally
left to the user; this PR must remain open.
