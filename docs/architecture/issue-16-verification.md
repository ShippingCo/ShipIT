# Issue #16 verification

Starting main: `4d606da563348b042a2d76d9c0a186904a3b187c`, freshly pulled on
2026-09-11 before creating `issue-16-append-only-audit`. The local tree was clean;
no unrelated work was discarded. The full live Issue #16 body was read and no open
PRs existed. Main Engineering checks run **34488951572** and all seven checks succeeded
on that SHA; the legacy commit-status endpoint had no statuses (it is not the Actions gate).

| Prerequisite | Verified merged PR | Contract present on starting main |
| --- | --- | --- |
| #4 CLOSED | #87, `308f247566dae99a9f116121f244b1fc8a90cbfb` | API, event, idempotency, ADR 0007 |
| #11 CLOSED | #94, `f3130f9c9dd1ee5298211081e323c10f4304667a` | Fastify configuration, errors, logging and composition |
| #14 CLOSED | #97, `a9daf42988c73cc02762d7e1c02ca8d95634c2e7` | Membership/invitation authorization, transaction and final-admin policy |
| #15 CLOSED | #98, starting main SHA | TenantAccess/scopedQuery, AST gate, composite audit ownership, ADR 0013 |

Issue #16's stale blocked label was not changed. Delivery requires an open PR against
main with `Closes #16`, exact-head CI and independent review. No merge, auto-merge,
manual issue closure, branch deletion or downstream label/status change is authorized.

## Design and release boundary

The [audit contract](audit-contract.md) owns the exact schema, field/redaction policy,
append privileges, authorization matrix, filter/cursor API, compatibility, correlation,
denial behavior and rollout rules. It is linked from the architecture/API/DB guides.

One forward-only migration adds canonical storage for tenancy and denials plus a canonical
read-only compatibility projection over the original membership/auth stores. Namespaced
IDs prevent cross-store collisions; no historical backfill, row rewriting, copying, double
writing or duplicate logical facts. Legacy inserts still work and appear once. Nullable
correlation columns are additive; old facts use their own UUID, not invented request history.
Historical membership scope ownership and finite timestamps are validated, failing upgrade
rather than modifying invalid data. Code rollback retains this additive schema; old tenancy
code must remain disabled because its post-commit gap is not a compatible production writer.

Mandatory tenancy success insertion shares the transaction. The optional validation/test
observer runs only after insertion, before commit, and cannot bypass it. Membership writes
use the canonical module seam while retaining the existing transactional source table and
complete-grant behavior. Identity success facts remain identity-only. Denied HTTP security
actions append separately after rollback (or pre-handler rejection) with no target lookup,
tenant claim, private owner, arbitrary payload or existence detail. Database outage during
denial recording leaves the operation denied and emits a safe recording-failure signal.

R28 org_admin sees only own-Organization administrative facts; franchise_admin sees complete
own-Franchise snapshots, not partial multi-Franchise grants or organization-only actions.
Accountant financial-only permission is reserved: there are no financial producers here,
so administrative/general retrieval is denied, as it is for operator, dispatcher,
delivery_agent and read_only. No eighth role, global administrator, raw export, UI, reporting
platform, ORM, RLS/session-variable tenancy or general outbox is introduced.

Runtime can SELECT the canonical view and EXECUTE two narrow, fixed-SQL append functions,
with no direct INSERT privilege on the new table. Legacy sources retain INSERT-only
privileges. UPDATE, DELETE, TRUNCATE, DDL, function replacement and ownership/role changes
are denied. SECURITY DEFINER functions fix their search_path and fully qualify tables.
This follows ADR 0013: scoped application authorization, not RLS protection against an
attacker possessing the runtime SQL credential. No raw-query audit-module exemption exists.

## Acceptance and test evidence

| Requirement | Executed evidence |
| --- | --- |
| Sensitive tenancy success commits with audit | Existing tenancy lifecycle/profile/bootstrap/concurrency tests plus new mandatory-insert test; no-op adds zero facts |
| Rollback after audit insertion | Real runtime connection throws after the real audit INSERT/function finishes; state and success history both remain absent; tenancy and membership tested |
| Failure before audit | Stale version and second bootstrap insertion failure leave no false success fact |
| Lost COMMIT response | Existing fault injection strengthened: API 503, committed state and exactly one durable fact agree |
| Append-only runtime | New DB privilege test uses actual `current_user`, denies raw INSERT, UPDATE, DELETE, TRUNCATE, DDL/ownership/function alterations and migration-role escalation |
| Sibling B / unrelated C isolation | Synthetic X/A/B/Y/C history with 5 A, 30 B, 7 C equal-time rows; A has 5 rows in exactly 3 pages; X sees 35, excluding C |
| Equal-time pagination precision | Timestamp `2026-09-11T01:00:00.123456Z` and unique namespaced IDs; exact deterministic reverse ordering, no duplicates |
| Cursor integrity and reauthorization | Unit encryption/tamper/expiry/key tests; real API rejects other actor/Organization, changed scope/revision/filters/limit; revoked reader denied first |
| Foreign/unknown filters | Actual B/C and unknown selectors give uniform 404; no target existence queries, counts or private error fields |
| Minimum DTO / redaction | Synthetic real login code/verifier/token, invitation token, provider reference and full-address-like profile value absent from canonical rows, logs and audit responses |
| Durable safe denial | Actual denied membership command has persisted correlation/actor/category only, null tenant/target/change fields, and unchanged target; recording outage never grants operation |
| Low-cardinality counters | 1,000 injected requests create one label set; extra secret/phone fields dropped, invalid action rejected; recording failures have scalar count |
| Membership semantics retained | All prior invitation/expiry/acceptance/revoke/update/self-change/final-admin/conflict/concurrency tests retained; new source/view fact count is 7/7, with no new-table duplicate |
| Identity behavior | All prior auth tests retained; new HTTP login correlation and identity-only view checks; tenant endpoint never exposes identity events |
| HTTP conventions | Existing auth/CSRF/error hooks, normal route registration, GET without CSRF, server request IDs ignore hostile header |
| Restart | Audit rows and authorized cursor continue through replacement pool/service with same key; existing process/API lifecycle restart tests retained |
| Database outage | Retrieval gives controlled 503, returns after recovery; mutation outage tests retain no partial state or false success |
| Migration | Fresh six-migration install, five-migration released-main upgrade with representative legacy rows, repeated no-op, compatible old inserts, invalid historical owner failure |
| Static gate | Positive and intentionally unscoped audit queries, empty action list, forbidden issuer/authority imports, and exact request.query data/call distinction |
| Read capability cannot append | Real-PG test rejects explicit append and side-effecting SELECT under audit.read or expired capability before execution |

The existing tenancy tests that specifically asserted post-commit observer behavior were
updated to assert durable database state at the same commit/failure boundaries. They were
not removed or weakened. All other prior security tests remain. No frontend changes were
made; existing prototype regressions still run. Test data is fictional and guarded
PostgreSQL resources/credentials are generated and cleaned by the existing runner.

## Local validation

Pinned tools: Node **22.23.2**, pnpm **10.34.5**, Python **3.12.14** and pinned disposable
PostgreSQL **18.6**. The host default Node/Python differed; the required versions were
selected explicitly on PATH/PYTHON without changing repository pins or dependencies.

| Command / layer | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS; lockfile unchanged |
| `pnpm check:migrations` | PASS; five released migration files unchanged |
| `pnpm db:local quality` | PASS, complete run including all layers below |
| `pnpm check:planning` | PASS, including updated documentation/link checks |
| `pnpm lint` | PASS, including tenant-query AST gate |
| `pnpm typecheck` | PASS, all five workspace packages |
| `pnpm test` | PASS: testkit 22 + DB unit 12 + API Vitest 105 + web 24 |
| `pnpm test:quality` | PASS: 15 tooling/scanner tests |
| `pnpm test:db` via guarded disposable helper | PASS: 31 DB + 47 API, zero failed/skipped/cancelled/todo |
| `pnpm build` | PASS: API TypeScript and Vite production build |
| `pnpm db:local verify:gates` | PASS: all 23 stages, including clean/restored quality and expected negative controls |
| `git diff --check` | PASS |

During development, typechecking caught a recursive factory type and a fixture union;
a process-start regression caught unsupported TypeScript parameter-property syntax;
a migration-count assertion and legacy observer assertions were adapted to the new
contract. Those failures were fixed and the full suites rerun successfully. No passing
suite was silently skipped or cancelled. Final security review also rejected empty cursors/year-zero dates and kept internal
correlation generation per operation. The complete quality run passed again after those
changes. The failure-drill snapshot passed all 23 stages, including clean and restored
quality. No source files are changed by those drills.

No dependencies were added and `pnpm-lock.yaml` remains byte-for-byte identical to starting
main. No dependency audit was run and no clean audit claim is made. Starting main's
Issue #15 verification documents four moderate development-tool findings for Vitest /
@vitest/mocker under GHSA-82fw-gwwq-j7x9; this patch does not remediate or reassess them.
Existing React `act` test warnings remain. No real provider messages or customer data.

## Reproduce the synthetic demo

From the dedicated branch with pinned tools and Docker running:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm check:planning
pnpm db:local quality
pnpm db:local verify:gates
git diff --check
```

The helper invokes `pnpm test:db` with guarded ephemeral configuration. It starts, registers
and removes only its own PostgreSQL container, databases and roles. It never uses a
production URL. `apps/api/test/audit-support.ts` composes real identity, membership and
Fastify services around the canonical Alpha/Alpha-1/Alpha-2/Beta/Beta-1 testkit roots.
`apps/api/test/database/audit.test.ts` reproduces these steps:

1. Provision fictional identities, bootstrap Alpha's administrator, invite/accept an
   Alpha-1 Franchise administrator and additional staff.
2. Add equal-time audit facts to Alpha-1, Alpha-2 and Beta-1. GET the audit endpoint as
   Alpha-1; receive only five authorized facts over three pages of limit two.
3. Reuse a cursor under changed scope or filters; receive controlled rejection.
4. Attempt to revoke a valid hidden membership and an unknown one; both return 404 and
   leave only safe identity-context denial records plus category counters.
5. Fail immediately after a real audit insert; confirm both the business mutation and
   success fact rolled back. Run normally, restart the pool/service, and read the fact.
6. Run the synthetic authentication/provider/address redaction checks and actual-runtime
   UPDATE/DELETE/DDL rejection in the DB audit suite.

There is no production browser migration, audit UI, financial audit feed or general
incident-investigation endpoint. Authorization for drill-through remains with each owning
service. Monitoring adapters/dashboards (#70), retention/maintenance (#72), general
idempotent coordinators/jobs/outbox (#17/#35), and financial producers stay out of scope.

Final pre-push fetch confirmed main remains the starting SHA and no conflicting open
PR exists. Remote CI must pass on the exact final PR head, with mergeability and unresolved review
threads checked after push. Independent reviewer approval is intentionally outstanding;
this delivery must leave the PR open and the branch intact.
