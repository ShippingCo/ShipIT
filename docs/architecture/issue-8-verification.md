# Issue 8 verification

[Contract](money-tax-proof-privacy-contract.md) · [ADR 0009](../adr/0009-money-tax-proof-and-privacy-policy.md) · [Sources](policy-sources.md) · [Fixture](fixtures/money-tax-proof-privacy.json)

## Baseline, readiness and scope

Starting main: `d4f036b5ca6d09946003aef59f3f6152faa8f194`, after `git status --short --branch`,
`git checkout main` and `git pull origin main` on 2026-09-08. The supplied workspace parent
was not itself a Git checkout; work is in `ShippingCo/ShipIT`. The checkout was clean on an
older issue branch; no unrelated edits were stashed, discarded or modified. Dedicated branch:
`issue-8-money-tax-proof-privacy-policy`. ADRs 0001–0008 existed; 0009 was the next unused number.

`gh issue view 8 --repo ShippingCo/ShipIT --json title,body,state,labels,url` read the full issue
before mutation. `gh issue view 3`, `6`, `5`, `7` with state/closedAt/url verified CLOSED;
`gh pr list --state merged --limit 10 --json number,title,mergeCommit,mergedAt` verified
PRs #86/#89/#88/#90 and their contracts on main. Main run **34190878355** passed. Only execution
labels changed: blocked → ready after dependency verification, then in-progress after branching.
The required check is `Planning and prototype checks`, strict/up-to-date; protection enforces
admins and conversation resolution, with zero required approving reviews at baseline. Recheck
current head, policy and conversations before merge; no protection weakening is authorized.

Inspected current workflow/AGENTS, ADR 0006/0008 and indexes, domain/authorization/lifecycle,
security/configuration, open decisions, prototype transition guide and #7 migration contract,
inventory/fixture/verification, #5 quality verification, current store/types/app tests. In
particular current `placeOfSupply`, `taxOn`, `addBooking`, `resendDeliveryOTP`, `revealOTP`,
`verifyDeliveryOTP`, `setEwayBill` and `EwayRecord` remain prototype-only evidence.

## Every Issue 8 acceptance checkbox

| Acceptance criterion | Specific evidence | Exact reproducible verification |
| --- | --- | --- |
| Unknown tax jurisdiction blocks or requires authorized resolution | Contract unknown-jurisdiction section; W27/W37; M05 even at zero rate; 168 scope cases | `pnpm check:planning`; inspect M05 and W37 matrix row |
| Odd-paise, zero-tax and changed settings fixtures | M01–M07: ₹101.01, exact fractions, 253+252, known intra/inter, zero, .49/.50/.51; preserved A after B effective boundary | `python3 scripts/validate_money_tax_proof_privacy.py`; `pnpm check:planning` |
| OTP bans staff retrieval and plaintext logs | Challenge policy; ADR 0008 prohibited data; W38 is request-only; no actual secret values in new fixtures | `pnpm check:planning`; manual review of contract/fixture and prototype differences below |
| Exceptional delivery privileged/audited with reason and evidence | W39/W40 narrow amendment; X01–X05; absent recipient, self-approval and missing evidence denied; W11 remains completion | `pnpm check:planning`; inspect exceptional-proof result and scope table |
| Expired/superseded challenges cannot complete | C01–C05 fake clock: 599/600 seconds, replay, lockout, replacement and old-version rejection; budgets do not reset | `python3 scripts/validate_money_tax_proof_privacy.py` |
| Retention validators and recheck cadence identified | Eight classes; P01–P03; compliance/project owner, qualified Indian advice, before production/every six months/material change; next review by 2027-03-08 | `pnpm check:planning`; manual S01–S08 applicability review |
| E-way estimates labelled, not official validity | E01/E02 distinct provenance/fields, contract e-way section; source S03 | `pnpm check:planning`; estimate-as-official negative control |
| Decisions, evidence, remaining blockers without implementation claims | ADR 0009, source uncertainties, contract owner table, D06/D07/D08, this verification | `git diff --stat`; `pnpm check:planning`; review scope |
| Paths/commands use current main and agreed workflow | Fresh SHA/dependencies above; existing planning entry point, current quality scripts and prototype source inspection | `pnpm quality`; `git diff --check`; current-head GitHub checks before merge |

## Fixture interpretation and tabletop

The existing Python planning runner invokes the new stdlib validator. No alternate test
framework, runtime imports, migrations, application tests, live messaging, provider callbacks
or production data were added. Existing domain matrix validator now expects 74 rows (four
reviewed additions), preserving all seven roles and read_only/org_admin denial checks.

Synthetic evidence: five money cases plus three whole-rupee boundaries and A/B version
change; five fake-clock challenge traces; all seven roles × four scope contexts × six actions
(168 cases); five exceptional-proof cases; eight retention classes; three field-deletion
cases; two e-way provenance cases. Sixteen deliberately broken controls must be rejected.
Money inputs reject floating numbers, invalid ratios and negative credit flows; no actual
GST rate is tested. Counter/expiry models contain no OTP or verifier values.

Reproduce: M02 yields tax 505 paise, components 253+252, pre-round 10606, adjustment -6,
final 10600. Reversing component input order preserves the allocation. M07 confirms under
A, selects B for a later booking and checks a serialized A snapshot stays identical even
when the old in-memory settings object is mutated. C03 locks after five wrong entries while
physical_attempts stays one. C04 carries failures across replacement. X03 denies delivery
when the customer is unavailable: T07 records one physical failed attempt, without exposing
a code. X01 permits independent admin approval with protected evidence, then W11 completion
records `exceptional`; payment remains a separate obligation. P01 removes eligible optional
profile fields while retaining necessary active shipment, dues, invoice and held proof fields.
Foreign/sibling cases cannot execute configuration, proof or privacy destruction.

These are **planning model checks**, not proof of real authorization, transaction isolation,
concurrent delivery, cryptography, field erasure or provider behavior. #21/#29/#42/#66/#72 and
other listed owners must supply production tests. Attachment security remains #31; runtime
unavailability/failure blocks completion rather than relaxing proof or configuration policy.

## Intentional prototype differences

- `store.ts` currently uses rupee floats/hard-coded GST_MODES and city-based intra fallback;
  #21 implements exact approved tax configuration, resolution and booked snapshots.
- `app.test.tsx` “Package detail + OTP loop” reads browser `b.otp`; the store generates
  four-digit Math.random codes, stores plaintext and offers revealOTP. This remains fictional
  demo regression coverage, **not secure delivery evidence**. #42/#18 replace/isolate it.
- The existing tax test verifies the prototype split, not legal place of supply/rates.
- The e-way test expects 530 km → three prototype days; EwayRecord's government wording
  does not make `Date.now() + days` official. #32/#67 replace it with provenance and labels.
- No product source/test was edited, and no production feature is claimed secure here.

## Exact local verification results

Local validation date: 2026-09-08. Use repository-pinned Node 22.23.2, pnpm 10.34.5,
Python 3.12.14. Host defaults were Node 24.16.0/Python 3.14.5, so isolated tools were placed
under `/tmp/shipit-issue8-tools`, without changing repo pins or global installations. Node's
archive was checked against official SHASUMS256; Astral's standalone Python archive against
its published release SHA256. The local invocation prefix is:

```sh
export PATH="/tmp/shipit-issue8-tools/node-v22.23.2-darwin-arm64/bin:$PATH"
export PYTHON="/tmp/shipit-issue8-tools/python/bin/python3"
pnpm install --frozen-lockfile --ignore-scripts
pnpm quality
```

On a machine with the pinned tools already active, use `pnpm quality` directly.
For a focused local replay, use `$PYTHON scripts/validate_money_tax_proof_privacy.py`;
`python3 scripts/validate_money_tax_proof_privacy.py` assumes the pinned Python on PATH.

| Command | Actual result |
| --- | --- |
| `/tmp/shipit-issue8-tools/python/bin/python3 scripts/validate_money_tax_proof_privacy.py` | PASS, exit 0: complete bounded fixture suite and 16 negative controls |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS, exit 0; lockfile unchanged, no lifecycle scripts |
| `pnpm quality` | PASS, exit 0: exact toolchain; 5 quality tests; all planning validators; lint zero errors/warnings; all 4 workspace typechecks; 24 application tests in 2 files; production web build |
| `git diff --check` | PASS, exit 0; no whitespace errors |

Existing React `act(...)` warnings remain visible in the unchanged prototype tests.
Build output: 1925 transformed modules, `dist/index.html` 539.55 kB (156.30 kB gzip).
No lint waiver, package/lockfile or runtime dependency change. `pnpm verify:gates` was not
rerun: the existing five quality tests ran, and no workflow/gate implementation changed.

## Pre-merge and after-merge evidence

PR/head/CI/review/merge evidence is recorded in the PR once those actions occur, avoiding a
self-referential committed head SHA or claiming future results. Review complete local and
GitHub diffs, check required CI for the current head, conflicts and unresolved conversations.
Independent approval is the workflow target; current protection requires zero approvals.
Record the actual review limitation; never invent another engineer or bypass a required gate.
After actual merge only: checkout/pull main, verify Issue #8 CLOSED and merged SHA ancestry,
and clean this completed local/remote branch. This document does not pre-claim those actions.

No runtime rollback/data migration is needed for this documentary change. Accepted policy
changes later require reviewed versions/ADRs and downstream compatibility evidence. Current
tax applicability, privacy/processor periods and statutory validation are downstream release
gates; auth/session and calendars remain unresolved with their original owners.
