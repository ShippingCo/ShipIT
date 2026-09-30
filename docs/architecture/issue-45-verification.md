# Issue #45 — messaging durability and recovery qualification

## Starting state

Branch: `issue-45-e2e-messaging-recovery`. Clean checkout, main checkout and pull completed
before implementation. Starting main: `8382fffa5c1fa1b288b02676bb3f777de9e59a2a`.
No unrelated local changes existed. GitHub had no open PRs or overlapping #45 branch.

| Prerequisite | Closed / merged evidence checked in main |
| --- | --- |
| #34 | PR #118, `d0f8670aa1a0053a908cf2f6f437a6d243b981e3` |
| #41 | PR #125, `ffd37c645a433e3ea36e0febc628529a473d2828` |
| #42 | PR #126, `3932078a0e901701aca218e505cc51ca1959b1ff`; expired-secret cleanup/replacement regression retained |
| #43 | PR #127, `24cc2b8a9abca56d42e3371c903032952c702a94`; send-time `source_superseded` suppression retained |
| #44 | PR #128, `ee84238f63428d9f8c1294f7393170806a7d9fe7` |
| #129 clock follow-up | PR #129, starting main above; committed queue-ready timestamps round **up** to milliseconds |

Every listed merge is an ancestor of starting main. Exact-main Engineering checks
[36667394599](https://github.com/ShippingCo/ShipIT/actions/runs/36667394599) completed
successfully: PostgreSQL integration, Quality tests/types/planning/lint/build, and the final
Planning and prototype checks gate. No labels, prerequisite metadata or CI rules were changed.

## Reproduction and fixture

Use repository-pinned Node **22.23.2**, pnpm **10.34.5**, Python **3.12.14**, Docker and the
existing disposable PostgreSQL **18.6** wrapper. No production database or Meta credential.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:toolchain
pnpm check:migrations
pnpm check:planning
pnpm lint
pnpm typecheck
pnpm db:local exec node scripts/test-messaging-recovery.mjs
pnpm test:quality
pnpm test:unit
pnpm test:api
pnpm test:web
pnpm db:local test:db
pnpm db:local quality
pnpm db:local verify:gates
pnpm build
git diff --check
```

The convenience script selects nine existing/new database files, reusing the guarded
preflight, two-file concurrency, strict nonempty/non-skipped reporter and exact registered
resource cleanup. It adds no root package command. The normal required database runner
still discovers all tests, including `messaging-recovery.test.ts`; no CI opt-in is needed.
Raw assertions/provider data are not emitted by the qualification reporter.

Fixture **Q45** reuses `automation-support.ts`, extracted from #40/#41's test setup without
removing existing assertions. It creates Organization Alpha / Franchise Alpha-1 (**A**),
Alpha-2 (**B**) and unrelated Organization Beta / Beta-1 (**C**), generated actors/IDs,
fictional contacts, real pricing/tax/booking services, the production booking HTTP route,
approved synthetic template metadata and the existing seeded optional-consent evidence.
STOP revocation itself uses signed HTTP ingress → inbox → consent worker, with no direct
consent-table mutation. Existing outbound tests additionally prove disclosure delivery →
START grants consent and that provider acceptance alone cannot grant it.

**Q45-route** adds 45 Parcels, a Lot/direct overlap, finalizes a manifest, dispatches,
departs and commits an absolute 120-minute delay. Only immutable source effects feed fanout.
**Q45-proof** uses the existing secure-delivery fixture and generated secret material.
Opaque Booking, Parcel, source, message and attempt references are discovered from committed
rows and compared across restarts; no secret or customer value is printed as evidence.

The fake commercial/delivery clock uses the existing fixed 2099 fixture policy window.
Scheduling advancement reads the **committed** `available_at`, `lease_until` or outbox lease,
uses SQL `ceil(extract(epoch ...)*1000)`, and never moves a clock backwards. OTP tests use
stored `expires_at`, exactly at expiry and one millisecond before it. STOP's provider time
comes from PostgreSQL rounded to seconds, independently of the commercial policy clock.
There are no new sleeps, guessed enqueue offsets, scheduler resets or unbounded retries.
The #129 outbound regression explicitly starts the app clock behind PostgreSQL and asserts
queue eligibility at committed availability; its Retry-After replay test preserves backoff.

## Failure / crash matrix and observed evidence

All rows run with the focused command above and with `pnpm db:local test:db`. Test names
below are exact identifying prefixes in `apps/api/test/database/`. “Restart” means the
Fastify instance and original runtime pool are **closed**, then a new pool, API and worker
are constructed. Exceptions at SQL/provider boundaries model process loss; this is not an
OS-kill, PostgreSQL-server-crash, hosted failover or load benchmark.

| Boundary / scenario | Fixture and injection / command | Expected state and recovery | Observed persisted evidence | Automated test |
| --- | --- | --- | --- | --- |
| A. Before booking COMMIT | Q45-proof's booking prerequisites; `paymentFault(COMMIT,before)` in production HTTP composition | Safe 503; no booking, event or outbound; retry same key | All six business/event/audit counters equal pre-request values; outbound count 0; fresh API same-key request creates 1 booking, 1 parcel, 1 obligation, 1 command, 1 audit, 2 events | `messaging-recovery`: `qualification: booking rollback before COMMIT` |
| B. Business committed, consumer absent | Q45; close API/pool before first outbox tick | Booking/event survive; consumer resumes | Same booking counters, one correlated decision and one logical booking intent; provider calls 0 before worker | `qualification: committed booking and decision survive separate restarts` |
| C. Decision committed, outbound absent | Q45; restart after decision commit | One decision/intent, unchanged source | Same message/source identities; no duplicate decision after worker replay | Same test |
| C2. Effect committed, job ack lost | Q45; real relay/claim/effect, omit acknowledge, close pool; advance to stored lease | Reclaim durable receipt, do not repeat effect | 1 decision, 1 receipt, same intent, completed job; eventual provider calls 1 | `qualification: decision COMMIT followed by missing job acknowledgement` |
| D. Reservation not committed | Q45; SQL failure before reservation COMMIT | Queued, no HTTP; normal restart retries | Queued after rollback, calls 0; restart accepted, calls 1; same booking/intent | `qualification: before reservation commit` |
| E. Reservation committed, acknowledgement lost before HTTP | Q45; SQL wrapper throws after COMMIT | Dispatching lease evidence, calls 0; expiry becomes uncertain | 1 retained attempt, uncertain, calls 0 through repeated restart/ticks; history offers risk-aware investigation | `qualification: lost reservation commit acknowledgement` |
| F1. Confirmed temporary rejection | Q45; synthetic `retryable_not_accepted`, Retry-After 120 | Booking independent; respect retry deadline | retry_wait, calls 1; immediate restarted tick null; stored availability advancement → accepted → signed delivered, calls/attempts 2, one intent | `qualification: committed booking and decision survive separate restarts` |
| F2. Unavailable dependency | Q45; synthetic `unavailable` | Failed/actionable, no automatic retry; W44 repair | Booking unchanged, `failed/provider_rejected`; local admin `dependency_repaired` restores same intent; delivered after callback, calls/attempts 2 | `qualification: unavailable provider preserves booking` |
| F3. Permanent/bounded rejection | Existing outbound fixture; 5 confirmed rejections then credential failure | Exhaust cycle; admin repair only | Exactly 5 calls before exhaustion, no extra automatic call; explicit redrive preserves ID/total attempt evidence | `whatsapp-outbound`: `five confirmed rejections dead-letter` |
| G. Provider accepted, result persistence lost | Q45; fail attempt INSERT after synthetic acceptance | Dispatching → uncertain at persisted lease; no resend | Calls 1, attempt 1, same intent, history uncertain; further ticks/reconstruction make no new call | `qualification: lost accepted response persistence` |
| G2. Explicit uncertain redrive | Q45; synthetic uncertain; revoke current local admin | Current authority before command/replay; explicit duplicate risk | Wrong reason/stale 409, malformed 422, role 403, foreign/revoked 404; replacement admin exact-key replay returns original result, changed intent 409; 1 redrive audit and 2 provider calls total | `qualification: uncertain recovery reauthorizes revoked membership` |
| H. Signed callback before/after restart | Q45; commit delivered ingress then close pool before processing | Inbox durable before acknowledgement; acceptance is not delivery | HTTP 200 with 1 pending status row; accepted progress none until normalized callback; restarted worker/history delivered | Booking recovery test |
| H2. Callback duplication and reordering | Q45; read → duplicate read → delivered → sent → failed; restart each stage | Monotone read, independent failure evidence | 4 distinct status inbox rows, 1 observation, 1 attempt/call; history stays read with failure_observed true | `qualification: signed callback rollback` |
| I. Callback projection COMMIT fails | Q45; fail inbox worker COMMIT before commit | Original inbox persists; effect rolls back | Observations 0 before restart; normal restarted worker projects read once | Same test |
| Signature failure | Q45; incorrect synthetic HMAC | Reject before mutation | 403; inbox count unchanged | Same test |
| Fanout partial commit/concurrency | Q45-route; exception after item 7, close pool, resume 20, race 2 workers for 18 | Cursor resumes only unfinished work | 1 completed root, 45 items/intents, 45 completed/attempted items; first 7 item/intent pairs unchanged; 45 accepted intents each with 1 attempt/call | `qualification: 45-Parcel Lot/direct fanout` |
| Route command/source replay | Q45-route; original command key/body, repeated source before/after restart | ETA/version and identities unchanged | Same delay result, absolute delay/base ETA/version snapshot, 1 root and 45 intents; no later send | Same test |
| Consent revoked after queue | Q45; signed STOP, inbox/consent processing before reservation | Suppressed, no provider/attempt | 1 revoked consent receipt; `suppressed/consent_revoked`, 0 attempts/calls, sealed payload null after restart | `qualification: signed STOP after automation queue` |
| Proof just before expiry | Q45-proof; stored expiry minus 1 ms, complete, close pool, new-key consumed replay | One atomic completion only | Delivered version 6, exactly 1 proof and 1 completion event; consumed replay rejected after restart | `deliveries`: `qualification: proof at expiry minus one millisecond` |
| Wrong/exact-expiry/cleaned replacement | Q45-proof; generated different code, stored expiry, cleanup, restart, replacement | No partial completion; preserve lineage and reject old challenge | Wrong result remaining 4; expiry rejected; version 5/out_for_delivery, proofs/events 0; secrets null; replacement version 2, failures 1, resend_count 1, remaining resends 2; old challenge rejected | `qualification: exact expiry rejects proof` |

Provider `unavailable`/permanent rejection and confirmed 429 have intentionally different
recovery. A transport timeout or lost acceptance evidence does **not** prove rejection.
Unmapped uncertainty cannot be matched by guessing contact/time/body. The conservative E
case remains uncertain even though this controlled fixture knows HTTP was not called.

## Acceptance manifest

The table covers every live #45 acceptance checkbox. Command **Q** is the focused script;
**W** is `pnpm test:web`; **G** is `pnpm db:local quality`. All fixtures are synthetic.

| # / Acceptance | Command / fixture | Expected | Observed / exact evidence |
| --- | --- | --- | --- |
| 1 Booking persists/provider recovers | Q/G, Q45 outage and retry | No business rollback or duplicate notification | Matrix B/F1/F2: unchanged booking counters, same intent, 2 transport attempts, callback-confirmed delivered |
| 2 Delay replay/one eligible message | Q/G, Q45-route | ETA once, one root/item/intent per eligible Parcel | Matrix fanout/replay: 7 + 20 + 18 committed items; 45 sends, no second send after restart/source replay |
| 3 Queued consent revoked | Q/G, Q45 STOP | Suppressed, zero provider calls | Matrix consent: durable revoked receipt, purged payload and 0 attempts/calls |
| 4 Wrong/expired/replayed proof | Q/G, Q45-proof | No delivery from invalid proof | Exact expiry and consumed restart tests above; existing `wrong proofs serialize at five`, `cooldown, same-code resend, expiry replacement` and `expiry cleanup destroys old challenge` retain lock, supersession and three-resend limits |
| 5 Foreign history/recipient isolation | Q/G, A/B/C | Unknown-equivalent reads; foreign inputs cannot redirect jobs | `whatsapp-outbound`: `foreign IDs, roles, nested sources and contacts are denied`; `final-mile-notifications`: `valid sibling/foreign sources and a foreign proof reference`; Q45 asserts actual provider binding and trusted Customer recipient; deliveries separately prove private Parcel recipient differs from sender |
| 6 Visible uncertain reconciliation | Q/G, Q45 uncertain | Visible, no blind resend | Matrix E/G/G2: explicit uncertain DTO and `retry_uncertain_confirmed`, preserved ID and attempt/audit evidence |
| 7 Authorized recovery | Q/G, Q45 membership changes | Live W44 local authority on original and replay | Revoked/new membership, sibling/unrelated scope, org_admin/operator/read_only denial; same-key body replay, stale/changed conflict; accepted after authorized recovery |
| 8 Reproducible evidence | Q/G, named synthetic fixtures | Command + fixture + expected + observed | Failure matrix and this manifest; strict safe count reporter; no secrets in artifacts |
| 9 Happy path survives restart | Q/G, Q45 + existing receipt fixture | Same booking/message/proof/receipt identities | API/pool/worker reconstruction throughout; `receipts`: `receipt concurrent first retrieval, repeat reads and pool restart`; payment-independent delivery and frozen receipt tests remain in Q |
| 10 Valid B/C references/counts | Q/G, canonical A/B/C | No foreign rows, counts or nested references | Q45 foreign source lists empty/has_more false, detail unknown-equivalent, redrive 404; `messaging-history`: `history microsecond time/id pages` includes B/C rows and attempts without changing A pages; `notification-automation`: W19 and root/item denials; delivery nested references denied |
| 11 Malformed/stale/dependency | Q/G, Q45 + domain fixtures | Controlled errors, no partial unauthorized writes | Matrix A/F/G2; existing webhook malformed/quarantine, booking stale tax/version, route stale/null ETA and history cursor filter/revision checks; no raw error payload |
| 12 Logs/audit/API/browser privacy | Q/W/G, safe log sinks/DTOs | No credentials, OTP, provider payload or unnecessary PII | Q45 scans logs/canonical audit/history/error receipts for private markers; delivery suite checks generated proof/verifier/key and secret destruction; existing browser `messaging.test.tsx`, data-access and operations tests enforce allowlist, status labels, scope invalidation and no code reveal |

The existing final-mile tests still prove `source_superseded` before reservation has **zero
provider calls**, while a later lifecycle commit preserves an already reserved send. Completion
wording is proof-safe and has no paid/settled claim; To-Pay outstanding is unchanged and no
`payment.settled` event is invented. Receipt issuance and money collection remain their own
services, not effects of delivery or callback processing.

## Operator runbook review and remaining boundaries

No missing application recovery rule required a production change. The owning runbooks cover
all exercised transitions:

- [Outbound recovery](whatsapp-outbound.md#operator-api-and-recovery-whatsapp-outbound-v1):
  inspect evidence, repair rejected dependencies, current local franchise-admin W44, expected
  version/idempotency, explicit uncertain duplicate risk; never reset rows to queued by SQL.
- [Inbox recovery](whatsapp-webhooks.md#runbook-whatsapp-inbox-v1): replay original signed
  input after ingress 503; retain quarantine/conflict evidence. There is no general terminal
  inbox reset API. A reviewed forward repair remains required for exhausted terminal inboxes.
- [Fanout recovery](route-delay-notifications.md#recovery-runbook): restart from cursor;
  repair configuration under its owner; use outbound recovery for queued/uncertain intents.
  W19 reminders retain separate identity/cooldown and do not edit ETA or impersonate redrive.
- [History semantics](messaging-history.md#provider-semantics-and-recovery): accepted is not
  delivered, callback progress is monotone, read-model eligibility does not replace authorization.
- [Delivery policy](deliveries.md#challenge-and-attempt-policy): expired ciphertext is not a
  prerequisite for authorized replacement; failures/resends survive replacement and restart.

Synthetic provider outcomes/signed callbacks do not certify live Meta approval, actual network
acceptance guarantees, production credentials or traffic. No load/SLA campaign, hosted monitoring,
OS-level crash campaign, PostgreSQL failover or cross-host operational drill is claimed. #70/#74/
#76 retain those release/hosting responsibilities. Initial consent is the established test fixture;
no new conversation/consent orchestration is introduced. No UI/domain redesign, runtime grant,
provider adapter, production crash hook, dependency or schema change. **No migration.**

## Execution record

- Locked installation (scripts disabled) and exact toolchain check passed.
- Migration check: **29 released files unchanged**. Planning, tenant-query gate, lint,
  all five workspace typechecks and `git diff --check` passed.
- Focused nine-file qualification: **126 passed**, zero failed/skipped/cancelled/todo.
- `pnpm db:local quality` passed: **32 quality**, **22 testkit**, **12 DB unit**,
  **492 API**, **177 web**, **3 object-store**, **67 DB + 333 API PostgreSQL** tests.
  Required PostgreSQL execution reported zero failed/skipped/cancelled/todo; owned containers
  were removed. The database API suite increased from 320 to 333 cases.
- Standalone `pnpm build` passed in production mode, including the actual browser isolation
  gate (530.10 kB / 147.28 kB gzip). No fixture or demo authority entered production.
- Existing React `act(...)` and intentional S3 streaming-failure warnings remain visible.
  Expected negative-protocol diagnostics in quality tests are not failed required tests.

- Separate `pnpm db:local test:db`: **67 DB + 333 API PostgreSQL passed**, zero
  failed/skipped/cancelled/todo; disposable PostgreSQL removed.
- `pnpm db:local verify:gates`: **all 24 stages passed**, including clean and restored
  full quality (same counts above), all expected failure drills and final-CI rejection cases.
  The disposable snapshot and PostgreSQL container were removed.
- A final fetch confirmed main remained at the starting SHA. Exact-head GitHub CI and final
  PR review/mergeability are recorded in the PR after publication; no merge is authorized.
Early development runs rejected incorrect test DTO field names, a future-dated STOP and reused
synthetic provider IDs; these fixture errors were corrected without changing production behavior
or weakening required gates. Self-review also found fixed wrong-code literals in existing
delivery tests could randomly equal a generated challenge. They now derive a guaranteed
different code; the five-failure and changed-intent assertions are unchanged. The intermediate 3-file run passed 45 tests with zero failed/skipped/
cancelled/todo, including the two new proof-boundary cases.
