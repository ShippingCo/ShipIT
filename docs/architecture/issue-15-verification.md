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
| Testkit / DB unit | 22 + 11 = 33 passed |
| API Vitest, including scope/job unit cases | 101 passed |
| Web regressions | 24 passed; existing React act warnings remain |
| PostgreSQL DB / migration / privilege tests | 27 passed |
| PostgreSQL API / security tests | 27 passed |
| Quality/tooling protocol tests | 13 passed |
| Typecheck / lint / build / planning | PASS |
| `pnpm db:local verify:gates` | PASS, all 23 stages, including clean/restored quality and unscoped-query rejection |
| AST targeted controls after review hardening | 3 passed; raw/extracted/computed/namespace bypasses rejected |
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
