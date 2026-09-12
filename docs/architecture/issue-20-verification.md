# Issue #20 verification

Starting main: `f06f72e406070b0debf71dba7a0c6609eb2f4738`, fetched and pulled with a clean
working tree on 2026-09-12. Prerequisites #8/#10/#15/#16 are CLOSED; PRs #91/#93/#98/#99
are merged ancestors. Main CI run 34698767282 passed. Existing #2–#19 contracts,
implementation and completion evidence were inspected; #21/#22/#33/#48/#59/#66 remain
open downstream work. Branch: `issue-20-versioned-rate-rules`. Only #20 execution labels
advanced blocked → ready → in-progress after readiness checks.

[Pricing contract](pricing.md) owns the precise behavior. Current merged R21 denies
read_only; W27 grants only own-franchise franchise_admin. The issue's “manager” wording
is superseded by the seven-role contract. W43 explicitly adds privileged freight override
approval to franchise_admin, with 21 synthetic role/scope matrix cases and runtime tests.
No service exists for tax, Booking persistence or production booking UI in this change.

## Acceptance criteria

| # | Acceptance criterion | Evidence |
| --- | --- | --- |
| 1 | Boundary weights match exactly one published rule or explicit no-rate | Pure boundary cases 1/999/1000/1001/1999/2000/2001/2999/3000/3001/MAX_SAFE_INTEGER; real persisted slab/gap HTTP results; exclusive maximum and null final maximum |
| 2 | Precedence and rounding produce deterministic identical quotes | Exact tenant/version/key/service/slab matching; rule-order-independent byte-identical calculation at fixed identity/time; flat integer paise, checked BigInt sums, no hidden pricing rounding |
| 3 | Zero/negative/nonfinite weight and unsupported service rejected | Strict domain schemas and actual HTTP cases; original JSON number token inspection rejects rounded fractional/underflow bypasses; nonfinite JSON 400 |
| 4 | Future rate does not change historical charges | Persisted v1 evidence and synthetic snapshot remain identical after v2 publication; exact version-bound expiry and stale validation. #22 will persist this on confirmed Booking; no fabricated booking table |
| 5 | Above-variance operator override requires authorized role and reason | Inclusive 500-paise fixture tolerance; 501 denied to operator, approved by franchise_admin with structured reason and actor evidence; live revocation prevents replay |
| 6 | Client totals cannot bypass calculation | Actual API unknown-field rejection for freight_total, packing_total, calculated_total, rate, price, managerApproved and body ownership; server calculates all components |
| 7 | Conflicting overlapping rules cannot publish | Draft overlap rejected; concurrent HTTP publication one winner; direct independent runtime sessions both observed blocked on card row, only one commit; trigger independently rejects overlap/backdating/published INSERT |
| 8 | Authorized result survives reload/restart with synthetic fixture | New API service/runtime pool returns identical persisted version, quote receipt and validation result; explicit fixture and walkthrough below |
| 9 | Foreign sibling B/unrelated C/nested/count isolation | Valid foreign version/rule ownership probes and mixed composite parents; hidden object GET/PUT/publish 404; selected scopes cannot widen membership; scoped rows/counts and no side effects |
| 10 | Malformed/stale/dependency failure controlled without partial mutation | Exact JSON/errors, expected-version race, quote expiry/tamper, idempotency conflict, database outage; failures after version/rule/audit/receipt insertion roll everything back; lost COMMIT reply safely replays |
| 11 | Logs/audit/responses exclude prohibited data | Closed reference/reason audit DTOs and identity-only denials; log assertions for session tokens, query scopes, commercial input; strict safe error envelope, no customer PII input or provider/OTP secret |

## Commands and observed results

Observed on 2026-09-12 against the reviewed implementation, before commit. These local
results do not imply remote CI, independent approval or merge. No failures are waived.
The full `pnpm db:local quality` exited 0 and removed its disposable PostgreSQL container.
It invokes the exact unit/API/web/typecheck/lint/build commands listed below.

| Check | Actual result |
| --- | --- |
| Pinned toolchain | Node 22.23.2 / pnpm 10.34.5 / Python 3.12.14 PASS |
| `pnpm check:migrations` | PASS; all eight released migrations unchanged |
| `pnpm test:quality` | 18 tooling/security regression tests PASS, including actual unscoped pricing CLI rejection |
| `pnpm check:planning` | PASS; 77 matrix rows and 21 new W43 role/scope cases |
| `pnpm test:unit` | 22 testkit + 12 DB harness tests PASS |
| `pnpm test:api` | 195 tests / 11 files PASS, including 40 pure pricing cases |
| Focused pricing Vitest command below | 40 tests / 1 file PASS |
| `pnpm test:web` | 86 tests / 4 files PASS; existing prototype React act warnings remain visible |
| `pnpm typecheck` | All five workspaces PASS |
| `pnpm lint` | PASS, zero warnings; tenant-query AST gate PASS |
| `pnpm test:db` inside guarded quality | 39 DB + 84 API = 123 PostgreSQL tests PASS; zero failed/skipped/cancelled/todo |
| `pnpm build` | API compile + web production build PASS; 61 web modules |
| `git diff --check` | PASS |

GitHub head-specific checks and merge evidence belong to the implementation PR and
post-merge report. The root unit count excludes the pure pricing cases counted under API.

The focused real pricing suites use the same guarded runtime-role fixtures as the full
PostgreSQL runner. They add four schema/migration and thirteen service/HTTP tests. The static
pricing regression invokes the actual AST gate against intentionally unscoped SQL in a
disposable directory. No production bypass or temporary debug code is committed.

## Synthetic walkthrough and reproduction

Use the repository pins: Node 22.23.2, pnpm 10.34.5, Python 3.12.14, Docker and the pinned
PostgreSQL 18.6 container. On this host the pre-existing pinned tools are selected with:

```sh
export PATH=/tmp/shipit-issue8-tools/node-v22.23.2-darwin-arm64/bin:$PATH
export PYTHON=/tmp/shipit-issue8-tools/python/bin/python3.12
pnpm check:migrations
pnpm test:unit
pnpm test:api
pnpm test:web
pnpm typecheck
pnpm lint
pnpm build
pnpm db:local quality
git diff --check
```

For focused pure cases: `pnpm --filter @shippingco/api exec vitest run test/integration/pricing.test.ts`.
For the full guarded synthetic DB/HTTP walkthrough: `pnpm db:local test:db`.
The shared fixture is `apps/api/test/pricing-support.ts`, consumed by both new real suites.
It uses canonical Alpha/A1/A2 and Beta/B1 roots, fictional verified users/live memberships,
a trusted injected fake pricing clock, and no real messages or customer records.

1. As A1 franchise_admin, POST a draft version with effective_from 2099-01-01T00:00:00Z,
   effective_to 2099-01-02T00:00:00Z, validity 600 seconds, tolerance 500 paise and opaque
   SYN_APPROVAL_1/SYN_SOURCE_1 evidence references. No production rate defaults exist.
2. Publish with expected_version=1 and a fresh Idempotency-Key. SYN_DEST/standard rules
   are [1,1000) → freight 12551; [1000,2000) → 20001; [3000,null) → 30001; packing 249.
   The server records version 1/revision 2 and immutable matched-rule identities.
3. Advance the injected clock to the start. POST quotes at 999/1000/1001 grams; expect
   12551/20001/20001 freight paise. At 2000/2999 return NO_RATE. No ₹10 rounding or ETA.
4. Request 13051 freight as operator: variance 500, accepted/audited. At 13052: variance
   501, 403. The local admin with commercial_exception reason receives privileged evidence.
5. Publish a new version effective next day with each freight amount increased by 111.
   Stored v1 JSON and the synthetic copied snapshot stay unchanged. At expiry, direct
   pricing validation returns QUOTE_STALE. At the version boundary a fresh quote uses v2.
6. Replay the original key/body after reconstructing the service/pool: original DTO, no
   new quote/audit, no extended expiry. Change intent with the same key: 409 conflict.
7. Repeat with sibling/unrelated IDs, read_only, forged ownership/totals and stale revisions;
   inspect controlled envelopes and unchanged rows. Failure injection checks rollback and
   uncertain COMMIT. The direct SQL race observes two waiting publishers and one winner.

Admin base is `/api/v1/organizations/:organization_id/franchises/:franchise_id/pricing/versions`;
quote path is `/api/v1/pricing/quote?organization_id=...&franchise_id=...`. Use real authorized
sessions and CSRF/Origin headers for a deployed manual reproduction, with deliberately
chosen future dates and approved local policy. No test clock is exposed as an HTTP input.

## Review, migration and limits

The additive migration is `1789405200000-versioned-pricing.cjs`. Fresh/repeated migration
and upgrade from eight released migrations preserve old roots/customer data; legacy upgrade
and audit compatibility suites remain active. Runtime grants are explicit in the DB guide.
No extension, ORM, default broad grants, edited released migration or row-level-security
claim. Database credentials remain outside the application capability threat boundary.

Only W43 extends the matrix. Explicit destination keys and integer grams are pricing input
contracts, not tax jurisdiction, address validation, carrier normalization or chargeable-weight
measurement. Configured flat slab prices replace the demo formula. Version intervals are
finite and non-overlapping; no close-in-place path or implicit effective-end mutation.
Approval/source references are required attestations, not independent compliance certification.

#21 implements taxes and final reconciliation. #22 authorizes/persists Booking and copies
validated pricing evidence in its same transaction. #33 connects the full production booking
UI. #48/#59/#66 consume this pricing boundary later. No downstream issue metadata changes,
Booking endpoint/table, tax formula, new browser storage, provider message or demo fallback.
No new UI flow means new browser/keyboard tests are inapplicable; all existing web regressions
and the production isolation build remain mandatory. Rollback retains evidence and schema,
disables compatible API paths and repairs forward, never imports browser state.
