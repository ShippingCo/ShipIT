# Issue #26 verification — persistent lots and safe parcel membership

## Baseline and dependency audit

Started on 2026-09-14 from clean checkout after status/branch/fetch, checkout main and pull.
Starting main: `0c126e3e5c59247d6da0aff9ce640798416e6fd8` (merged PR #108).
Branch: `issue-26-persistent-lots`. No implementation on main or unrelated changes discarded.
Current-main [CI run 34849983768](https://github.com/ShippingCo/ShipIT/actions/runs/34849983768)
was successful; no competing open PR or newly unresolved lot contract was found at audit.

| Prerequisite | Closed/merged evidence present in starting main |
| --- | --- |
| #15 tenant-scoped queries | PR #98, `4d606da563348b042a2d76d9c0a186904a3b187c` |
| #16 append-only audit | PR #99, `3cefe534b6ca23fc8ffdd5a77f2bb57f5517a361` |
| #23 booking/parcel retrieval | PR #106, `e33ce9f127e39a5cebeb1196b99e5152843b48ec` |
| #24 guarded lifecycle | PR #107, `336486c97c8f1c99b99f8813f08d47c4028172bc` |
| #25 bounded bulk | PR #108, starting main above |

GitHub issue/dependency bodies and merged PR #108 were re-read, with downstream #27/#34,
current authoritative contracts/ADRs, prerequisite verification and production implementations.
Issue #26 moved blocked → ready only after dependency/CI review, then in-progress on branch.
GitHub remains execution-status authority. Review status is reserved for pushed, CI-current PR.

[Domain contract](lots.md) and [ADR 0016](../adr/0016-persistent-lots.md) resolve ownership,
canonical frozen pricing destination, server codes, separate lot version, state-dependent
W04, retained association, archive, events/audit and downstream boundaries before final API.
There is no production route relationship on this baseline; #27 owns frozen route/manifests
and its active-route guard. #26 preserves the existing dispatch/timeline evidence and IDs.

## Acceptance evidence

All fixtures use disposable PostgreSQL 18.6, separate migration/runtime identities, generated
test credentials and fictional tenants/contacts. No production customer data or credentials.
API assertions below run against Fastify + actual PostgreSQL, not in-memory state.
`DB API` means [apps/api/test/database/lots.test.ts](../../apps/api/test/database/lots.test.ts).
`DB migration` means [packages/db/test/integration/lots.test.ts](../../packages/db/test/integration/lots.test.ts).
`Contract` means [apps/api/test/integration/lots.test.ts](../../apps/api/test/integration/lots.test.ts).
Test-name prefixes below uniquely locate their executable assertions.

| Issue checkbox | Concrete test/evidence and expected result |
| --- | --- |
| Remove to ungrouped before dispatch | DB API `add, atomic move, remove to ungrouped…`: add A → move B → remove; two persisted memberships ended moved/removed, zero active, current membership JSON null. Parcel remains booked/awaiting_intake/version 1. Across two creates + add + move + remove: five commands, six audits/events; replay changes none. |
| Concurrent two-lot assignment | DB API `concurrent two-lot assignment…`: simultaneous Fastify commands produce 200/409 LOT_MEMBERSHIP_CONFLICT; one active/member, three commands/audits/events including two creates. Concurrent stale rename has one VERSION_CONFLICT. `database independent active-membership uniqueness…` uses two real transactions; confirms contender waits on PostgreSQL Lock then 23505 on one-active index, loser rolled back. |
| Foreign lot/parcel rejected API + constraints | DB API `A/B/C real resources…`: valid sibling B/unrelated C read/add/move/current/history paths and reverse scope denied; same unknown/foreign safe 404, no metadata/counts or mutations. Disposable owner suspends only command guard to test composite FKs independently: foreign lot and foreign parcel fail 23503. |
| Delivered/RTO entry forbidden | DB API `terminal delivered…` and `terminal rto…` test all three W04 roles; 409 PARCEL_STATE_CONFLICT; counts/versions/membership/audit/event unchanged. Trusted future-domain state fixtures suspend only lifecycle guard; #26 does not add delivery/proof/return APIs. Contract tests cover all nine existing states. |
| Archive dispatched lot retains route/timeline history | DB API `dispatcher-only post-dispatch correction…`: existing check-in/T03 dispatch, dispatcher move/archive; lot remains archived version 3, all historical membership retained/closed; parcel transitions, manifest_id dispatch envelope and retrieved timeline unchanged. Ordinary operator/franchise_admin correction/archive denied. #27 active-route guard is explicitly deferred because no route relation exists; no invented route test/table. All new FKs are RESTRICT. |
| Duplicate add/remove stable, no duplicate events | DB API `add, atomic move, remove…`: exact add/move/remove replays deep-equal original results and six total per-lot facts, not repeated increments. `actual unique violation…` proves controlled fallback after rollback and simultaneous same-key replay produces one membership/fact. Create/archive replay tested independently. |
| Destination mismatch gives correction | DB API `destination mismatch…`: exact fixed LOT_DESTINATION_MISMATCH guidance; original association stays open, target empty, source/target versions and all command/audit/event counts unchanged. Source is Booking tax_intent.pricing_input.destination_key, not addresses or browser labels. #34 focus/selection/retry contract in lots.md. |
| Reload/restart happy path reproducible | DB API `lots create/read/update/archive persist…` recreates pool/service and reads identical authoritative archived DTO; `committed lost response…` executes COMMIT then throws, recreates pool/service and recovers original membership without second version/fact. |
| Real B/C scopes, nested references/count denial | DB API `A/B/C real resources…` independently creates published pricing/tax/customer/booking/parcel/lot fixtures in B and C; denied foreign selectors and IDs, scoped A list excludes B/C, reverse foreign read denied, before/after effects unchanged. |
| Malformed/stale/dependency outcomes | Contract closed fields/versions/name/destination/fingerprint tests; DB API role/malformed, stale update, archived target, race and mismatch assertions. `injected failures at every move boundary…` throws after reservation/end/start/version/audit/event/completion: original rows and versions restored. Omitting audit/event/completion is rejected by deferred constraints. Lost COMMIT returns safe 503 with no rollback claim; exact retry recovers. |
| Privacy inspection | DB API `committed lost response…` inspects DTO/logs/canonical audit/event envelopes against synthetic recipient/contact/address/phone/session/CSRF/raw key. Responses use explicit DTO projections; errors fixed codes/messages, no SQL/constraints/stacks. Audit/event metadata contain IDs, closed action, version, actor/correlation/time only. No browser code/adapter added; existing browser isolation suite remains required. |

Additional DB API cases: R08/W04 all seven roles, revoked replay, disabled Organization and
Franchise, bounded opaque scope/filter/expiry cursors, scoped audit source and runtime denial
of lot/membership DELETE, TRUNCATE, DDL, ownership edits, counter/audit access, blind writes;
audit owner UPDATE rejected. Unknown/foreign membership identity is resolved under scope
before state/version disclosure. DB code uniqueness is independent of server generation.

Migration test upgrades fourteen released migrations, injects failure after schema creation,
proves transaction rollback (no lots table; migration ledger still fourteen), retries the
real migration, then proves no-op. Full migration suite proves fresh installation. New FKs
are RESTRICT and partial indexes inspected exactly. DB API `upgrade preserves existing…`
creates real pre-upgrade booking/check-in/dispatch events and audit, applies #26, compares
old envelopes and audit byte-for-byte, creates a lot and runs the existing booking producer
again. No released migration was edited; existing migration-count assertions advance one.

## Reproducible verification commands

Version files pin Node 22.23.2, pnpm 10.34.5, Python 3.12.14. Docker must be available.
Use only generated disposable DB credentials; the launcher removes the container afterward.

```sh
pnpm check:migrations
pnpm db:local quality
pnpm db:local verify:gates
git diff --check
```

`quality` runs check:toolchain, test:quality, check:planning, lint (including tenant AST),
typecheck, test:unit, test:api, test:web, test:db and build. Focused runnable commands are
`pnpm test:api` and `pnpm db:local test:db`; all lot scenarios above are included. The
synthetic setup seeds authoritative pricing/tax and booking, then exercises the API using
real session/CSRF and grants. No manual fixture import, browser JSON, real provider or UI
cutover is needed. Browser/provider/worker-specific new tests are inapplicable to this
service-only change; existing suites remain intact.

Executed local results (2026-09-14):

| Command | Result |
| --- | --- |
| pnpm check:migrations | PASS; fourteen released files unchanged |
| pnpm db:local quality | PASS, including every component below |
| pnpm test:quality | 21 passed |
| pnpm test:unit | 22 testkit + 12 DB unit passed |
| pnpm test:api | 289 passed in 16 files, including 17 lot contract cases |
| pnpm test:web | 95 passed in five files |
| pnpm test:db (inside db:local quality) | 48 DB + 153 API/PostgreSQL passed, including 16 lot API/PG cases and one lot migration case |
| pnpm typecheck | PASS; all five packages |
| pnpm lint | PASS, including tenant-query AST enforcement |
| pnpm build | PASS; API and production web bundle |
| pnpm check:planning | PASS; domain/API/security/prototype/planning contracts |
| pnpm db:local verify:gates | PASS; all 24 stages, including clean/restored quality and intended failure controls |
| git diff --check | PASS |

The final candidate quality pass includes the explicit other-domain/evidence-only capability
rejection regression (zero SQL); the preceding gate drill verifies unchanged gate mechanics.
Final documentation-only evidence is planning-checked again before commit. Exact final-head
GitHub run/check conclusions are recorded in the PR; no local result substitutes for them.

One earlier overlapping local full run reported a terminal-fixture failure. Its sanitized
runner output contained only file/line, so a root cause was not established. The detailed
16-case PostgreSQL rerun and subsequent clean/restored/standalone full suites did not
reproduce it. No assertion, runtime timeout, required suite or gate was relaxed.

No skipped/todo/cancelled test is accepted. Existing React act and build-size warnings stay
visible. Controlled-failure verification must report intended failures rather than masking
or weakening them. The tenant AST gate adds lot table owner predicates and an exact route
request.query data exception; regression tests still reject query execution/capability minting.

## Security and rollout review

New SQL is parameterized and enters through scopedQuery with both owners on first resource
lookup, including nested/current membership/history/count paths. Issuance stays in the
membership coordinator. Command actor/owners/IDs/time/evidence are server-issued. Root lock,
UUID-ordered lot locks, Parcel lock and permanent active uniqueness prevent concurrent split
membership. Lifecycle status/version/custody is never updated by the lot module. No generic
manage action, inherited administrator transition, unscoped foreign lookup or destructive API.

The entire final diff, gate output and prohibited-pattern search were reviewed before commit.
[Runtime grants](../../packages/db/README.md#issue-26-persistent-lots) are explicit minimum
column rights and audit EXECUTE; immutable history/counter functions remain protected. No
broad grant, RLS, ORM, new dependency, demo import, storage fallback, provider call or worker.

Rollout: apply additive migration → minimum runtime grants → old producer compatibility →
deploy API → synthetic authorized A/B/C move/remove/dispatch/archive/replay → #34 later UI.
Rollback reverts compatible API only, retains schema and all history, repairs with another
forward migration. No history deletion, down migration or browser fallback/import.

## Definition of Done and review boundary

Acceptance, implementation scope, tests, docs, isolation and privacy evidence are above.
Required local gates, pushed branch, PR link/Closes #26, exact-head CI and clean mergeability
are pre-review delivery checks; publication evidence belongs in the PR with its final SHA.
Independent maintainer approval remains outstanding. #27 route/manifests/active-route guard,
#34 full operational UI and #35 consumers remain downstream work. No existing prototype
screen/hook exception is changed. Incompatible destination selection and destructive demo
removal are intentional production differences documented in the migration inventory.

Delivery stops with the PR OPEN. Do not merge, enable auto-merge, manually close #26, delete
the branch or claim post-merge main pull/cleanup. Those DoD items require later maintainer
review/merge; issue closure must occur automatically from Closes #26 then.
