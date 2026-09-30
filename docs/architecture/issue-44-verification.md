# Issue #44 verification

Branch: `issue-44-messaging-history`. Exact freshly pulled starting main:
`24cc2b8a9abca56d42e3371c903032952c702a94`.

## Live prerequisite inspection

Before branching, the full live #44/#45 issues and current implementations were read. #44
was open with stale `status: blocked`; no open PR or remote implementation branch existed.
Only remote main existed. No commits were newer than the supplied baseline. Main's exact-SHA
Engineering checks run **36043167952** succeeded in all seven jobs. A later fetch confirmed
main had not advanced. No issue labels/statuses were changed.

| Prerequisite | Merged PR | Actual implementation verified |
| --- | --- | --- |
| #18 | #101, `ee8baee84ac169ab0d38ef8b422b29f0289d5992` | API/data-mode composition, command-intent, scope generation/abort and demo graph isolation |
| #37 | #121, `4da7c8ffe6b10a62cd3c43ea00916410991a8968` | Signed encrypted inbox, normalized monotone observations, metadata-only staff reads |
| #39 | #123, `8d1ddeb2c9ec44f7f11a947c89932ffaf695cb47` | Logical outbound/attempt ownership, uncertain acceptance, rendering purge, versioned W44 |
| #40 | #124, `afbc06664ae9817edca322363ac54c592f20a868` | Activation cutover, immutable decisions, safe policy outcomes and database-only enqueue |
| #41 | #125, `ffd37c645a433e3ea36e0febc628529a473d2828` | Bounded root/item fanout and separate W19 reminder identity/cooldown |
| #43 | #127, starting main above | Failure/RTO/completion policies and send-time source-superseded suppression |

All six remain merged and their issues closed. Latest released migration is still
`1791133200000-secure-delivery-proof.cjs`; all 29 released files remain unchanged.

## Delivered boundaries

[Messaging history](messaging-history.md) ratifies four `/api/v1/whatsapp/history` list/detail
paths, safe DTOs and ownership. Messages contains each logical intent once; Automation retains
all decisions, including no-outbound outcomes, plus Route fanout roots. Provider callback evidence
is read directly with monotone progress and independent failures. Acceptance never claims delivery.

The existing four-role `whatsapp.consent.read` membership path implements R16/R17 without a new
role/action or R18 widening. No body, provider identity, contact, payload, challenge, verifier or
ciphertext is exposed. Inbound staff access remains unchanged and metadata-only. W44 and W19 stay
with their existing command owners, authorization, version/idempotency/cooldown and audit rules.

Time/ID cursors preserve PostgreSQL microseconds and bind actor, membership revision, selected
Organization/Franchise, view, filters and limit. The browser at `/business/automation` uses strict
DTO projection, current scope tickets, abort and generation purge. It has labeled native filters,
loading/empty/error states, focus-managed evidence dialogs and explicit uncertain-redrive risk.
No production storage/demo fallback, clear-history, composer or direct provider call exists.

No migration/backfill is required. Candidate pagination precedes expensive enrichment for
unfiltered pages; filtered pages apply current status predicates before limiting. Released
indexes supply tenant/time and attempt lookup paths. Representative query-plan measurements and
quality counts are recorded below.

## Reproducible fictional verification

Use the pinned Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and disposable PostgreSQL 18.6.
`pnpm db:local test:db` runs the scenarios with generated tenants and a synthetic provider.
No real customer or Meta traffic occurs.

1. `notification-automation.test.ts` creates an automated booking update, processes the
   existing consumer, then checks one decision and one logical message through history.
2. `messaging-history.test.ts` reserves/sends a fictional message; provider acceptance returns
   **accepted**, progress **none**, then a signed normalized sent observation remains accepted.
3. Inject delivered, failed, read, sent and failed observations. History reports delivered then
   read, never regressing. Reload through a new pool preserves the result.
4. Fail a message with a synthetic configuration failure. Inspect as operator (no W44), then as
   franchise_admin. Repair and use the offered W44 reason/version. Replay the exact key/body,
   reject changed intent, create uncertainty and confirm its distinct risk-aware reason.
5. Reload: the logical message ID is unchanged; newer attempts precede retained older attempts.
   Delivered, purged and expired messages have no recovery. More than 100 attempts are truncated.
6. `notification-automation.test.ts` creates a real synthetic Route delay and fanout. Inspect
   root counts/items and safe outbound references; W19 creates a different reminder event/root.
   The original message is not redriven, ETA/version remain unchanged and cooldown rejects replay
   with a new command key. Org-admin-only membership receives no reminder action.
7. `deliveries.test.ts` creates an actual delivery challenge/outbound and inspects history as
   all four permitted roles. The result is `delivery_otp` metadata only: code, verifier, encrypted
   secret, recipient, body and variables are absent even for org_admin. Agent feed access fails.
8. Repeat with sibling Franchise and unrelated Organization identities: detail is indistinguishable
   from unknown, lists are empty and foreign source filters contribute no records. Cursor actor,
   scope, revision, filter and limit changes fail closed.
9. `pnpm test:web` exercises status labeling, allowlist decoding, role navigation, scope invalidation,
   exact transport retry, reminder identity and dialog focus. `pnpm build` checks the real production
   dependency graph; `pnpm test:quality` includes the actual-checker unscoped-history negative fixture.

For a visual-only fictional demo, run `pnpm --filter @shippingco/web dev` and open
`/src/test/fixtures/messaging.html`. This fixture intercepts its own API requests, imports the
production component and displays accepted/delivered/read/suppressed/failed/uncertain plus a safe
verification label. Inspect the uncertain row to exercise its warning without any external send.
The fixture is not imported into either app composition and is absent from the production build.

## Browser verification

The standalone fixture was inspected in a real browser at desktop and 390×844. Native filtering
selected Uncertain and left one row. The dialog had x=12, width=366 inside the 390-pixel viewport;
page/document widths showed no horizontal overflow. Escape closed it and restored the originating
Inspect button. The duplicate-delivery warning was visible before any retry confirmation, and keyboard focus
moved to its explicit risk-confirmation button.
Automated DOM tests separately exercise focus trapping, labels, async states and no OTP content.
Temporary viewport override was reset.

## Query-plan evidence

Real `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` wraps the actual repository SQL in PostgreSQL tests.
No planner flags, timeout changes, or alternate test-only query are used. With 10,001 outbound
intents and 30,003 attempts/observations, first/second 25-row message pages took **2.416 / 1.822 ms**
in the focused run and used `whatsapp_outbound_history` plus the attempt lookup index. With 2,001
policy decisions (including decision-only blocked/suppressed/skipped), a fanout root and four
items/messages, first/second automation pages took **7.231 / 6.594 ms** and used
`notification_decisions_history`; the 100-row blocked filter took **76.594 ms**. These are local
synthetic measurements, not production latency promises. Tests assert bounded rows, a single
history query per page, no page overlap, and the actual tenant/time index paths. They do not
assert fragile millisecond thresholds. Existing indexes suffice; no new migration is justified.

The final tests additionally seed 50 sibling-Franchise and 50 unrelated-Organization messages
and foreign attempts. These do not alter local rows, attempt detail, `has_more` or keyset boundaries;
foreign source/correlation filters and message/decision detail remain empty/not-found.

## Quality execution

- Locked installation with scripts disabled and exact toolchain check passed.
- Migration integrity: **29 unchanged released files**. Planning, tenant-query AST gate,
  lint (zero warnings), all five workspace typechecks and `git diff --check` passed.
- Quality-gate unit/negative tests: **32/32**.
- Testkit: **22/22**; DB unit: **12/12**; API integration/unit: **492/492**;
  browser: **177/177** (including 20 messaging cases); S3 contracts: **3/3**.
- Focused final history/automation/outbound PostgreSQL: **39/39**, zero failed/skipped/
  cancelled/todo.
- Full `pnpm db:local quality`, including `pnpm test:db`: **67 DB + 320 API PostgreSQL**
  tests passed, **zero failed/skipped/cancelled/todo**, along with every preceding suite
  and API/browser builds. The disposable PostgreSQL container was removed.
- Separate `pnpm build` passed in production mode and enforced the real Rollup isolation
  gate; browser artifact **530.10 kB / 147.28 kB gzip**. No fixture/demo authority is in it.
- Existing React `act(...)` warnings and the intentional S3 streaming-failure warning remain
  visible; they are not skipped tests or suppressed failures.
- `pnpm db:local verify:gates` runs in an isolated copy: clean/restored full quality plus
  actual tenant-query, demo-import, lockfile, lint, promise, async-handler, type, test,
  missing/unavailable/empty/skipped PostgreSQL and failed/cancelled/skipped/missing final-gate
  rejection drills. The PR validation report records its completed outcome and exact-head CI.
- Final focus regression: all **20 messaging browser tests** pass, including restoring the
  current Inspect button after a confirmed command replaces list DOM, with Refresh as fallback.

## Limitations and downstream boundary

This is provenance/status history, not a retained conversation transcript. Callback observation
time is not a per-stage delivery timeline; filters are live, not a cross-page snapshot. Detail uses
existing bounded fanout items (maximum 1,000) and newest 100 attempts. Synthetic tests do not certify
live Meta templates or traffic. No arbitrary send, role expansion, customer conversation router,
provider adapter, new queue, retention store, hosted monitoring or #45 qualification was added.
The PR must remain open for independent review; no merge or auto-merge is authorized.
