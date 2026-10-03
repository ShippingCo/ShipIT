# Issue #54 verification and working record

## Recovered context and base

Read the `Implement issue #53` Codex chat, its final decisions and verified evidence, the
`Review milestone 4 finance gaps` chat's final planning results, #53's owning guide/ADR,
Milestone 5 description and its eight issue summaries. The current issue has zero comments.
No inaccessible conversation was used as evidence of an approved decision.

Local working tree was clean at start. Switched to main and pulled with fast-forward only,
then created `issue-54-manual-carriers` from `07c667cc761aa28e33793c4c99134888351f8d52`.
That is merged [PR #153](https://github.com/ShippingCo/ShipIT/pull/153), containing #53's
`d494e8b`. No subsequent code changes existed. All seven #53 CI checks reported success.
Prerequisites #15/#16/#23/#24/#53 are closed; their implementations/contracts are present.
Historical blocked labels were not treated as current dependency evidence or changed remotely.

#53 supplies types/fixtures, not persistence or an adapter. Its W26 decision, unknown-value
semantics, scoped identity, exact financial provenance and domain separation are preserved.
Network qualification, CSV import, reconciliation, rates and actual costs are later work;
none blocks the authorized manual API path. The approved Groq integration is untouched.

## Acceptance and implementation map

| Requirement | Implementation / evidence | Status |
| --- | --- | --- |
| Local booking with no live capability | Existing real booking service + manual capability manifest | Focused verified |
| Same external docket at two installations | Database installation+docket key; same courier ID can be reused | Focused verified |
| Unknown service/location reviewable | Explicit unmapped source codes; immutable mapping review API | Focused verified |
| No delivery-proof or money bypass | Pending claims only; assert unchanged Parcel, obligations and domain event counts | Focused verified |
| Stable duplicate observation | Scoped immutable receipt, fingerprint; concurrent duplicate and fresh pool replay | Focused verified |
| Reference correction preserves prior audit | Append-only reference history, audit projection, pinned old observation | Focused verified |
| Foreign parcel/mapping rejected | B/C real IDs, nested installation/reference/target checks; no row/count effects | Focused verified |
| Reload/restart persistence | Real API write then fresh pool/service read and replay | Focused verified |
| Roles and disabled scopes | W26/R19 role matrix, agent denial without assignment, revoked replay, disabled franchise | Focused verified |
| Invalid/stale/dependency failure | Validation, stale versions, rollback and lost COMMIT acknowledgement | Focused verified |
| Privacy | Safe audit projection and logs inspected for fixture contact/body values; strict input allowlists | Focused verified |
| Migration compatibility | Populated 36-migration database; failure rollback, successful/repeated upgrade and unchanged prior records | Focused verified |

## Environment and execution record

Pinned Windows wrapper `node_modules/.cache/issue35/run.ps1`: Node 22.23.2, pnpm 10.34.5,
Python 3.12.14. Reused established Docker fixture and database registry/cleanup harness.
No shared mutable database suites run concurrently. No timeouts/assertions weakened.

- `check:toolchain` passed.
- Focused Vitest: 34 tests (23 #53 contract + 11 #54 boundary) passed.
- Workspace typechecks passed; lint/tenant-query gate passed before final test additions.
- First direct Node database attempt lacked required resource registry and ran no valid fixture;
  reran through the existing focused harness. First valid run passed core persistence/race
  scenarios; corrected test assumptions to standard 422 validation/cursor status and used the
  guarded membership revocation service. These were fixture defects, not waived cases.
- Final focused PostgreSQL rerun: 5 carrier API scenarios + 1 populated migration scenario
  passed, zero failed/skipped/cancelled/TODO. This includes the final audit-page,
  courier-reuse and disabled-franchise assertions. Disposable container cleanup succeeded.
- Migration-history check: all 36 released migrations unchanged; one forward addition.
- `pnpm db:local quality` passed toolchain, **35 tooling/security**, planning, lint,
  all workspace typechecks, **22 testkit**, **12 DB unit**, **624 API**, **189 web**,
  **3 object-store** and **68 schema/DB** tests. The API database group returned failure
  in eight existing upgrade cases. **The aggregate command exited 1, not success.**
- Targeted diagnostics reproduced all eight failures: each was an expected applied-migration
  count one lower than the actual count. These assertions in the API test directory had been
  missed when updating the schema-test directory. Corrected only those eight integer counts:
  assistant-outcomes 1→2, conversations 6→7, customer-access 7→8, customer-quotes 5→6,
  lots 22→23, multilingual 2→3, pickups 4→5 and support 3→4. No preservation assertion,
  runtime code, migration, timeout or test scenario changed.
- Reran **all eight affected upgrade scenarios** through the guarded focused harness using
  an explicit test-name filter across those eight files. **8 passed, 0 failed/skipped/
  cancelled/TODO**, including every assertion following the migration-count checks.
  These targeted tests supplement the broad run; they are not a new complete API DB suite.
  The aggregate reporter lists only failed locations on failure, so no inferred full API DB
  passing count is reported. No other failure location was reported in that group.
- Separate `pnpm build` passed for API and production web after the aggregate stopped.
  Final API typecheck and ESLint on all eight changed API test files passed. Final planning,
  migration-history and whitespace checks passed. Existing React act warnings and expected
  negative streaming-request warnings were visible, not suppressed. Disposable services
  and database resources were cleaned up by their harnesses.
- Final evidence therefore combines **one broad run, eight corrected targeted reruns,
  separate builds and final affected static checks**. There was no full aggregate rerun;
  the original failed command is not relabelled as passing. No unresolved test failure
  remains in the exercised cases.

Source SHA256 before the broad run, confirmed unchanged at delivery:

| File | SHA256 |
| --- | --- |
| `apps/api/src/modules/carriers/service.ts` | `4bdd16e536df3dd04aeb0da963533d0e8e5ef9c029e9e618418168a9bdd637a2` |
| `packages/db/migrations/1791910800000-manual-carriers.cjs` | `f6ffafa902c4484786d159c97a77510f4e541a494394ade4c36052f07893246a` |
| `apps/api/test/database/carriers.test.ts` | `08f35c8c008a9486738e8eedf872920cbb0b2b487c41cd2c41baec18daf2cc82` |

Logs are ignored local files under `node_modules/.cache/`: `issue54-quality.log`,
`issue54-db-final.log`, `issue54-upgrade-diagnostic.log`, `issue54-upgrades-final.log`,
`issue54-build.log`, `issue54-types-final.log`, `issue54-lint-final.log` and
`issue54-planning-final.log`. No remote CI for this uncommitted change, live provider,
browser journey, commit, push, PR publication or deployment is claimed.

## Limits and handoff

This is service-only delivery under the issue's explicit allowance. API injection is a running
Fastify application with real sessions, CSRF and PostgreSQL; it is not a browser UI test.
No network capability requires provider mocks or live credentials. The shared persistence
contract is ready for #55/#58; their file parsing, cross-channel deduplication, reconciliation
and guarded domain transitions remain unimplemented. Source-time conflicts stay pending review.
No rates, actual expenses or financial reports are produced. Runtime grants and setup are in
[the guide](manual-carriers.md); [ADR](../adr/0039-manual-carrier-evidence.md) records research.
