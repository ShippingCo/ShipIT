# Issue #150 implementation and qualification evidence

Started 19 October 2026 from freshly fetched/pulled main `f627710a681abf0bc4eddfd035a6528fab315533`
in a separate `issue-150-accountant-register-exports` worktree. Existing work is
preserved. All eight prerequisite issues are closed and their merged commits are
ancestors of this branch: #61/PR161, #62/PR162+181, #63/PR163+180, #139/PR169,
#140/PR170, #142/PR179, #144/PR173 and #146/PR178. #137/PR165 records product
policy approval, not accountant qualification.

The user selected GnuCash 5.17 on 19 October 2026 and explicitly kept genuine
accountant review pending. The official Arm 5.17-1 distribution checksum and executable
version/build were verified. Actual CSV import was not performed: desktop control
failed before the importer. The user requested the [manual import pack](../fixtures/accountant/gnucash-5.17-candidate-v1/README.md)
as the reproducible alternative. **Actual target import and accountant review remain
separate unmet requirements.** No compatibility claim or issue closure follows from CI.

## Coverage matrix

| Requirement | Implementation / evidence | Status |
| --- | --- | --- |
| AC1 monthly financial reconciliation | `accountant.test.ts` covers cash/UPI/card, allocations, advances, COD, handover, expenses, account statements and independent positions; producer integration adds actual refund correction and agent fee/advance | Focused PostgreSQL cases passed; final full-suite evidence below |
| AC2 actual fictional target import | Exact 5.17 version pinned; 20 initial transactions/44 splits, three corrections, accounts, settings, expected balances and result template | **Pending real manual import** |
| AC3 stable IDs and corrections | One sale despite two receipts, statements/revisions, cancellation and refund correction; saved captures remain unchanged | Focused PostgreSQL and unit cases passed |
| AC4 private export and CSV safety | Actor/tenant ownership, expiry, current grants; selected references, text formula defense, signed integer paise; bounded TAR | PostgreSQL/unit/UI cases passed |
| AC5 complete source bundle and qualification | All source families, position files, GST summary, manifest/dictionary; only generic v1 enabled | Generic implemented; **target/accountant gates pending** |
| AC6 denied scopes and roles | Sibling/unrelated scope, org-admin export denial, read_only/operator denial, actor isolation, revoked accountant | Focused PostgreSQL cases passed |
| AC7 malformed/concurrent/uncertain | Strict filters; same-key conflict/replay; rollback and lost COMMIT; serializable retry; concurrent quota enforcement | Focused PostgreSQL cases passed |
| AC8 independent totals | SQL source sums versus exported BigInt values; independent booking/advance/COD/agent equations; card gross 500000−fee 10000=net 490000; exact control drill-through | Focused PostgreSQL cases passed |
| AC9 reproducible handoff | [Runbook/API/equations](accountant-exports.md), versioned fixture generator, checksums, manual results and review template | Prepared; external evidence not supplied |
| Known document types and provenance | Booking/payment receipts, statement revisions, shipment/docket links and unqualified external links; no invented statutory invoice/credit-note number | Implemented; statement/receipt/adjustment tests |
| Capture/time and original evidence | Serializable MVCC, exact microsecond cutoff/expiry; opening/period occurrence distinctions; late changes appear only in new captures | Implemented; repeat/correction/expiry tests |
| Optional reconciliation | Disabled/unavailable states; recorded matches, source versions and batch gross/fee lineage retained even after disable | Focused PostgreSQL case passed |
| Limits | 31 days, 5000 combined rows, 8 MiB files/saved payload, 100-row pages, 20 captures, 24 hours; fail before partial save | Unit bounds, quota/expiry cases; maximum-row case included in full suite |
| UI | Current Reports navigation; API-backed capture/preview/download, exact retry, reload, source focus and permission-loss clearing | Six controlled React/jsdom/archive tests passed; real desktop/narrow-screen inspection pending unavailable desktop control |
| Persistence/grants | Existing JSON artifact schema; new consumer gets SELECT on refund evidence, no money write grant; no migration | Restricted-runtime PostgreSQL scenarios; all 55 released migration files unchanged |
| Rollout/rollback | Compatible API before UI; remove entry points on rollback; retain source history/artifacts; no qualified mapping enabled | Documented |
| Final CI/review/merge | Exact PR-head CI and independent review | Pending PR publication/checks; no merge authorized while required evidence missing |

## Reproducible checks and observations

Use the exact versions in `docs/QUALITY_CHECKS.md`. The branch's normal runners discover
all new API/database/web tests; no external bank/provider or customer messaging occurs.

- `pnpm check:toolchain`: passed Node 22.23.2, pnpm 10.34.5, Python 3.12.14.
- `pnpm install --frozen-lockfile --ignore-scripts`: passed; lockfile unchanged.
- Focused PostgreSQL run of accountant, agent-money-sources and financial-workflow:
  15/15 passed before the final quota/maximum-row additions. Subsequent accountant
  run passed all seven then-present cases, including quota and exact control drill-through.
- `pnpm --filter @shippingco/api exec vitest run test/integration/accountant.test.ts`:
  initial six unit cases passed; deterministic review-pack check subsequently added.
- `pnpm --filter @shippingco/web exec vitest run src/test/accountant.test.tsx`:
  six cases passed, including independent archive header/checksum/UTF-8 checks.
- `pnpm lint` and `pnpm typecheck`: passed on implementation iterations; full final
  run required below. `pnpm check:migrations`: passed, 55 released files unchanged.
- `node scripts/generate-accountant-review-pack.mjs --check`: exact fictional files,
  balanced integer splits, fixed source balances and checksums passed. **Not target evidence.**
- The initial full quality run stopped at prototype inventory drift. Six new test
  declarations were individually assigned to the existing reports contract; existing
  authority/routes/fingerprints remain unchanged. One bounded download cleanup timer
  was also classified. Planning then passed 326 declarations and 17 negative controls.
- A focused race exposed stale replay/quota reads under repeatable read; the new
  consumer now uses serializable capture and one same-key retry. The race/quota tests
  pass without altering ledger source balances or weakening constraints.

Final full quality/remote checks are recorded in the PR and appended here after they
finish. Logs remain ignored locally, not public fixture evidence. No later issue,
redesign, deployment, M7 or M8 work was started. #150 stays open.
