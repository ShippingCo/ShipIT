# Issue 7 verification

[Migration contract](frontend-migration-contract.md) · [Inventory](prototype-migration-inventory.md) · [Fixture](fixtures/prototype-migration.json)

## Baseline and scope

Started from freshly pulled main `36ce6d3` after PR #89 merged Issue #6. Prerequisite
Issues #2/#3 were merged in PRs #85/#86; #4/#5 in #87/#88. Branch:
`issues/7-prototype-api-migration`. Acceptance of this local change remains subject to review
and CI on its eventual PR. No endpoint, adapter, schema, product test or UI is implemented.

## Acceptance evidence

| Issue 7 criterion | Evidence |
| --- | --- |
| Every business screen has a migration owner | Contract screen table; all 16 Route declarations captured; 21 transitive consumers assigned |
| Receipt opt-in, repeat lookup, lot removal and route deduplication preserved safely | Inventory receipts/customers/lots/routes groups; S01–S05; W04/W06 permission and history restrictions |
| OTP reveal, arbitrary status and unknown tax default intentionally changed | proof/parcels/pricing groups and unsafe-preservation negative controls |
| Prototype v0 marked complete | Contract and transition guide |
| Reload/outage never creates a second authority | Failure table and reconciliation gates; S06/S10/S11 |
| Existing tests have dispositions | 15 declarations including the 10-case route table; unchanged demo tests remain demo evidence |
| Demo reset impossible against production | Separate capability/build/environment contract; S09; runtime proof assigned to #18 |
| Decisions, evidence and remaining blockers explicit | Governing contracts, groups/owners, rollout gates and limitations |
| Current repository paths and commands checked | Compiler-resolved imports and planning link validation; current pnpm scripts |

The 79 named exports and 67 Store members overlap; `Store.load` adds one member not
available as a named export, making 80 unique symbol dispositions. Routes include nested
and fallback declarations; they are not 16 distinct business screens. The 15 declarations
expand to 24 existing tests (including one lint regression), not 15 runtime cases.

## Reproducible checks

Use the pinned toolchain documented in [quality checks](../QUALITY_CHECKS.md).

```sh
pnpm check:planning
pnpm quality
```

The new scanner uses the existing TypeScript compiler API, without executing prototype
initializers. It records source imports, routes, tests, storage/timer sites and coupled-file
fingerprints. The validator checks decisions, owners, rule links and drift, then deliberately
removes exports/callers/tests, changes safety declarations and simulates source changes.
Those negative controls must fail. Document tables must agree with the reviewed fixture.

No automatic fixture refresh command is provided: compare changes with the previous
inventory, review the new behavior and owners, then intentionally update evidence. Do not
regenerate unchanged policy blindly. Fingerprints normalize CRLF/LF for Windows/Linux.

## Remaining implementation gates

- #18 implements isolation, async interfaces, cache generation and reload recovery.
- Each workflow owner supplies real API/PostgreSQL/browser authorization, concurrency and
  failure evidence; JSON declarations and source fingerprints cannot prove those controls.
- #8/#21/#29/#42/#66/#72 retain unresolved tax, proof, refunds, calendar and privacy policies.
- CI on a pushed PR, review, merge and post-merge cleanup have not happened in this local work.

## Local validation results

- `pnpm quality` passed locally on 2026-09-08 with Node 22.23.2, pnpm 10.34.5
  and Python 3.12.14.
- All five quality-gate tests, earlier planning/domain/API/security checks, and the new
  migration inventory check passed, including its 17 deliberately broken controls.
- Lint, all four workspace type checks, all 24 existing application tests and the
  production build passed. The unchanged application tests emitted three React `act(...)`
  warnings; these are recorded, not counted as production migration evidence.
- `git diff --check` passed. No application source, dependency or schema was changed.
- Nothing is staged, committed or pushed. Remote CI and PR review remain pending.

These results validate the planning deliverable and existing prototype baseline. They do
not prove future API adapters or production security behavior.
