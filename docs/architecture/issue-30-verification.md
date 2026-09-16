# Issue #30 verification

Starting main: `32beb6b0a72484d464997926352d6b151629a03c`, clean checkout, pulled before
branch `issue-30-immutable-receipts`. Prerequisites #21/#22/#23/#29 closed and merged
through PRs #104/#105/#106/#112. PR #112 and main run
[35065405032](https://github.com/ShippingCo/ShipIT/actions/runs/35065405032) passed.
Only stale workflow status labels changed (blocked → ready → in-progress; review on PR).
No unrelated work was present or discarded. Main remains the recorded starting SHA.
[ADR 0020](../adr/0020-immutable-issued-receipts.md) was written before implementation.

## Acceptance evidence

Commands below use the pinned Node 22.23.2, pnpm 10.34.5 and Python 3.12.14 toolchain.
`D` means `pnpm db:local test:db` (guarded PostgreSQL 18.6, every DB/API database test).
`W` means `pnpm test:web`; `A` means `pnpm test:api`.
D is shown as a standalone reproduction command; it ran through `test:db` within
`pnpm db:local quality` and both isolated verifier quality runs.
All names below are literal test names or the indicated parameterized test variants.

| Issue #30 criterion | Exact executable evidence | Command | Result |
| --- | --- | --- | --- |
| Reprint after tax/business changes matches issued amounts/issuer | API DB `issued receipt freezes issuer, customer, pricing and tax across configuration changes`; actual old DTO and later collection issuer equal original after Organization/Franchise/customer edits and future policy publication | D | PASS |
| Components and total equal booked snapshot exactly | API DB `receipt exactly copies intra/inter/zero/odd frozen tax with no second rounding`; checks every paise total and exact component objects, including 10101-paise basis | D | PASS |
| Unauthorized/foreign IDs reveal no PII | API DB `R13 checks all canonical roles, mixed roles, revocation and disabled historical reads`; `A/B/C tenant isolation hides real foreign booking, payment, receipt and correction identifiers` | D | PASS |
| Repeated print/download creates no payment/message side effect | API DB `receipt concurrent first retrieval, repeat reads and pool restart preserve one immutable artifact`; `partial/full collection, reversal and recollection retain separate immutable entry-only documents`; counts receipts, receipt/Booking/payment audit, ledger, events and existing outbound auth jobs; web explicit-print tests assert no transport and unchanged source/demo outbox | D + W | PASS |
| Untrusted customer text escaped | API DB four tax variants persist HTML-like customer, then render the actual issued DTO; web `escapes every layout text context and ignores foreign download and executable logo URLs` covers script/img/svg, every layout value and ignored URL fields | D + W | PASS |
| User-initiated print; cancel cannot undo Booking | Web `prints only on explicit action; cancelled/no-op printing keeps source state and clears private DOM`; app regression `cancelled reprint preserves the saved booking, payments and outbox`; `cleans up private print markup even when browser print throws` | W | PASS |
| Paid/To-Pay/later collection without false settlement | API DB `partial/full collection, reversal and recollection retain separate immutable entry-only documents`; `delivered parcels with outstanding money cannot turn a booking receipt into settlement`; web `keeps partial collection and reversal entry labels separate from booked total and settlement` | D + W | PASS |
| Happy path survives reload/restart; synthetic reproduction | API DB `receipt concurrent first retrieval, repeat reads and pool restart preserve one immutable artifact` uses 12 concurrent requests and a fresh real runtime pool/service; uncertain COMMIT test recovers the committed identity | D | PASS |
| Valid sibling B/unrelated C IDs including nested references/counts denied | API DB `A/B/C tenant isolation hides real foreign booking, payment, receipt and correction identifiers`; creates real foreign Bookings/collections/corrections, compares 404 bodies without correlation, unchanged counts and direct mixed-owner SQL rejection; separately tests own-org-only org_admin | D | PASS |
| Malformed/stale/dependency failures controlled and atomic | API DB `receipt validation, authentication, private cache and method boundaries are controlled`; `receipt failure boundaries roll back issuance and audit, and uncertain COMMIT recovers across pool restart`; `reversal chain failure leaves no originals or audit; schema unavailability returns safe 503` | D | PASS |
| Logs/audit/API/browser omit secrets and unnecessary PII | API DB collection history/log checks and DTO denial checks; API `allowlists every nested booking/issuer/tax field instead of returning stored JSON` and `allowlists entry-only collection and linked reversal without stored balances`; web ignores foreign URLs/private fields | D + A + W | PASS |

API database evidence: [receipts.test.ts](../../apps/api/test/database/receipts.test.ts).
DTO/R13 unit evidence: [receipts.test.ts](../../apps/api/test/integration/receipts.test.ts).
Web evidence: [receipt.test.tsx](../../apps/web/src/test/receipt.test.tsx) and
[app.test.tsx](../../apps/web/src/test/app.test.tsx). Browser component tests use the
repository's Vitest/jsdom harness, not a new browser dependency. Production renderer
has no I/O or domain mutation dependency; #33 owns the production screen and fetch adapter.
No shipment messaging/outbox domain exists on main; the existing outbound auth queue is
counted and the fictional demo outbox is checked separately. No provider is invoked.

## Database and security evidence

[PostgreSQL receipt tests](../../packages/db/test/integration/receipts.test.ts):

- `populated pre-30 migration rolls back on failure, preserves source facts and never backfills issuance` — actual pre-#30 Booking and collection, failed migration rollback, apply/repeat, exact prerequisite state retained, zero backfill and legitimate first issuance.
- `runtime inserts derive contents; owner and runtime cannot edit/delete issued receipts or audit` — legitimate column-granted runtime insert, generated-field forgery rejection, immutable update/delete, no truncate/DDL/sequence/base-audit grants, duplicate logical original and invalid kinds/owner tuples.
- `receipt constraints enforce global number uniqueness and same-owner payment/correction links` — forced global number collision on another Booking, valid correction insert, invalid entry/type/base/correction, composite FK definitions. Test-only sequence manipulation is confined to the disposable fixture.

Fresh/repeated migrations and all prior upgrade tests include migration 19. Released
migration files are unchanged. The future synthetic repair filename moves past the new
migration; no assertion, timeout, CI rule or negative control is weakened.
The tenant-query AST gate has an additional receipt positive/negative control; runtime
capability forgery is tested before SQL. R13 is independent of R06 and R11. Minimal DTOs
omit phone/address, ownership, raw intent, keys, fingerprint, command/audit internals.
HTML contains only escaped text and fixed attributes; no logo/download URL is accepted.

Failure injection covers dependency read, before/after/omitted insert, after number
reservation, before commit, uncertain commit response, partial reversal-chain construction
and missing receipt schema. All visible artifacts/audit are atomic; sequence gaps are allowed.
Original collection documents remain immutable after reversal; no mutable current balance
is stored or settlement claimed. There is no editable receipt or stale-write endpoint.

## Reproduction

```sh
node --version
pnpm --version
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local quality
pnpm db:local verify:gates
```

The complete DB command provisions synthetic A/B/C tenants, publishes synthetic pricing/tax,
confirms Bookings and exercises authenticated Fastify routes against real PostgreSQL. It
removes disposable databases/roles/container on completion; no credentials enter artifacts.
The receipt tests are an executable fixture walkthrough, including owner/operator/accountant
reads, forbidden roles, collection/reversal chain, tax/issuer change, restart and fault recovery.

For the retained fictional UI only:

```sh
VITE_DATA_MODE=demo pnpm --filter @shippingco/web dev --host 127.0.0.1
```

Open `/#/business/receipts`, activate Reprint explicitly, cancel/no-op the dialog, then
reload. Receipt rows/Booking survive; print says Fictional demo receipt and Booked total.
Production uses authenticated JSON from the three routes in [receipts.md](receipts.md);
this demo is never evidence of production financial authority or an API fallback.
Manual in-app browser verification activated Reprint with Enter, retained keyboard focus,
observed five receipt rows, no residual print-root/printing class, and the same five dockets
after reload. The embedded browser returned without a physical print dialog. OS/printer
success is deliberately not asserted; automated tests explicitly stub canceled/no-op print.

## Quality results and review boundary

`pnpm db:local quality` — PASS, exit 0:

| Gate | Result |
| --- | --- |
| Toolchain | Node 22.23.2, pnpm 10.34.5, Python 3.12.14 |
| Tooling / gate tests | 24 passed |
| Planning / contract validators | PASS; prototype inventory 79 exports, 67 Store members, 22 callers, 16 routes, 68 test declarations, 17 negative controls |
| Tenant-query AST / ESLint | PASS; zero lint warnings/errors |
| Typecheck | All five workspace packages passed |
| Unit | 22 testkit + 12 DB passed |
| API | 354 passed, 20 files |
| Web | 101 passed, 6 files (including 25 app regressions) |
| Real PostgreSQL | 54 DB + 204 API passed; zero failed/skipped/cancelled/todo |
| Production builds | API TypeScript and isolated Vite web build passed |
| Released migration check | PASS: 18 released files unchanged, one forward addition |
| `git diff --check` | PASS |

`pnpm db:local verify:gates` — PASS, exit 0, all 24 stages: fresh empty-store install,
clean quality, all deliberate rejection/final-CI-gate drills and restored quality.
Both isolated quality runs reproduced 54 DB + 204 API PostgreSQL passes and all
service-free totals above. Sanitized local logs are under
`node_modules/.cache/quality-verification/` (ignored, not committed).
Existing React act warnings remain visible; no suppression or timeout/assertion weakening.
GitHub current-head CI and final mergeability are recorded on the linked PR after push.
Required branch protection was inspected: strict `Planning and prototype checks`, with
administrator enforcement; existing review/protection settings were retained.

Intentional differences: no browser authority, Total paid, dynamic ETA, arbitrary logo,
profile address/phone/tagline, government Tax Invoice claim, or automatic WhatsApp footer.
The printable layout remains compact with tabular amounts and escaped party/docket/tax
presentation. No runtime dependency or lockfile change. #33 owns production screens and
client adapter; #47/#62 consumers, #61/#63 reports, settings, messaging and #72 retention
remain deferred. Apply additive schema/grants before API; rollback compatible receipt code
and retain evidence/sequence, repairing schema only forward. No merge, issue closure,
auto-merge, branch deletion or downstream work is authorized by this verification.
