# Issue #51 working record

## Context and implementation plan (steps 1–6)

- Clean main `da4fc09`, fast-forward pull confirmed, branch `issue-51-multilingual-intents`.
  All named prerequisites #6/#47/#48/#50 are closed and their merged work is in the base.
  #49 is included, not a named prerequisite. #51 is M4 (milestone 5), has no comments.
- Recovered final results from the #50 chat and Research Milestone 4. Earlier provider
  recommendations were proposals; this request selects Groq/Qwen explicitly.
- Existing signed inbox, scoped conversation, immutable turn receipts, quote/pickup
  drafts, support cases and encrypted outbound replies remain the owners of business work.
  Selection expires after 15 minutes. Locale must persist independently of selection.
- Add channel-scoped `en`/`hi` preference; explicit LANGUAGE EN/HI overrides script detection.
  Fixed Hindi templates preserve server identifiers, amounts and timestamps. Recognize
  common Hindi/Hinglish commands even without AI. No generated response wording.
- Official Groq SDK; one strict JSON classification (intent, docket placeholder, confidence),
  no tools/streaming, model `qwen/qwen3.8-27b`, reasoning_effort `none`. Unknown messages
  only; draft values, consent, deterministic commands and active handoff bypass inference.
  Quotes/pickups continue existing guided collection; no inferred booking/submit/cancel.
- Privacy minimization: only reviewed vocabulary and an opaque docket placeholder leave
  the server. Unknown tokens, names and contact/address details are omitted; sensitive or
  adversarial inputs are rejected. No history, real identifiers, facts or tenant data sent.
  An explicit deployment privacy/data-region policy reference gates external use.
- Durable per-inbox reservation and organization-wide budget serialize across replicas.
  Commit reservation before the external call; no open DB transaction/lock during inference.
  Completion rechecks source, consent, human ownership and shipment grants. Expired calls
  fall back without replaying uncertain requests. One request, no SDK/application retries.
- Limits: 512 input characters, 192 output tokens, 5-second total call deadline,
  10 calls/minute and 100/day per organization, conservative reserved cost ceiling.
  Store only model/schema version, duration, usage/cost estimate and closed result category.
- Configuration uses existing environment parser and explicit LLM_API_KEY injection;
  disabled/unconfigured AI preserves deterministic startup and customer service.

Acceptance mapping: interpretation → trusted tool DB tests; schema/injection/errors →
SDK transport tests; Hindi/exact facts → templates + signed inbox tests; budgets/timeouts →
concurrent/restart tests; privacy → payload/log assertions; locale/access → A/B/C scope tests;
state races → deferred fake provider; upgrade → populated migration; regressions → quality.
No staff UI changes: customers choose locale through signed WhatsApp commands.

Research: [model and thinking](https://console.groq.com/docs/model/qwen/qwen3.8-27b),
[strict structured output, incompatible with tool calling](https://console.groq.com/docs/structured-outputs),
[official SDK, retries/timeouts/logging](https://github.com/groq/groq-typescript),
[provider limits](https://console.groq.com/docs/rate-limits),
[data controls and US retention](https://console.groq.com/docs/your-data).
[Anthropic routing workflows](https://www.anthropic.com/engineering/building-effective-agents)
supports a simple classifier rather than an agent framework.
[AWS idempotency](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/)
supports durable request identity and bounded recovery. These sources inform the design;
chosen local limits and conservative vocabulary filtering are engineering decisions.

## Verification (steps 7–8)

### Acceptance evidence

| Issue requirement | Local evidence / boundary |
| --- | --- |
| Tracking, price and code requests use deterministic tools | Interpreter permits labels only; worker dispatches existing authorized services. Signed tracking and quote fixtures plus existing charges/receipt/resend regressions verify facts and side effects. |
| Reject invalid JSON, unsupported tools and injection | Strict schema/duplicate-key/tool-call tests; local injection and ambiguity rejection. |
| Known intents survive provider failure; uncertainty clarifies or hands off | Disabled/provider-error/low-confidence tests and existing support flow. |
| English/Hindi preserve exact amounts and dockets | Large-integer money, receipt/reference/timestamp and signed bilingual database assertions. |
| Tenant budgets and timeouts bound calls | Atomic competing budget reservations, minute/day exhaustion, SDK timeout with one attempt, expired reservation recovery and duplicate-source tests. |
| Exclude OTPs, secrets and unnecessary addresses | Closed vocabulary, local docket marker, numeric/private-form rejection, payload and safe-log assertions. No history or business records supplied. |
| Locale cannot select another tenant conversation | Signed channel ownership; A/B/C independent locale checks and foreign inference read/write denial. |
| Reproducible happy path survives restart | Fresh pool/worker reads saved locale after selection expiration; exact shipment assertions and documented commands. |
| Deny valid sibling/unrelated resource IDs | Real PostgreSQL B/C docket and inference-receipt access tests, plus existing scoped service regressions. |
| Stale state and dependency failure stay controlled | Consent revocation, active human case, revoked shipment grant during deferred inference, error categories and no outbound on paused/revoked paths. |
| No prohibited data in responses/logs | Provider-error sentinel and serialized configuration tests; safe inference receipt/log assertions; existing API/web privacy regressions. No new browser surface. |

Status: **all twelve issue acceptance checks verified locally** through the tests and review
above, including the complete PostgreSQL regression run below. General language quality has only the four-case live
sample below; production policy/account settings, live WhatsApp and remote CI are unverified.

Reuse pinned Windows `node_modules/.cache/issue35/run.ps1` (Node 22.23.2,
pnpm 10.34.5, Python 3.12.14) and disposable Docker PostgreSQL. Automated calls use fakes.

- Reviewed official npm metadata and SDK types: 1.6.0, no runtime dependencies or install
  hooks, `reasoning_effort: none` typed and supported. Installed exact version with scripts
  disabled; lockfile changes only add this package.
- Initial 54 focused API tests passed. After review added confidence/metadata validation,
  conflicting-intent rejection, SDK timeout and unfiltered-payload rejection. Final focused
  routing/interpreter/quote run: **62 passed**.
- API regression first passed **564** tests; later continued aggregate passed **567 API**,
  **188 web**, **22 testkit** and **12 DB unit** tests. No live provider calls in these runs.
- `pnpm quality` passed pinned toolchain, **34 tooling/security tests**, planning and lint;
  stopped at a new test literal type error. Corrected the fixture and all five workspace
  typechecks passed. Continued `pnpm test` reached private object-store verification.
- Docker initially could not start because Windows could not access stale IPC sockets.
  Normal restarts and individual file removal failed. Preserved both temporary socket
  directories under `.issue51-recovery`/`.issue51-recovery-2` names together, then restarted
  Docker successfully. Containers, images, volumes and settings were not reset.
- First object-store readiness attempt exited with Node's unsettled top-level await.
  Isolated rerun passed **3 storage contract tests** and cleaned its container. Removed
  the exact test container left by the early exit after confirming its test-owner label.
  No runner timeout or assertion was weakened; no harness change was necessary.
- Initial focused PostgreSQL run: five cases passed, three failed. Diagnosed test-fixture
  issues: the money regex captured English punctuation, a lock probe attempted a forbidden
  installation mutation, and foreign installation setup lacked its franchise administrator.
  Replaced the probe with independent `SELECT ... FOR UPDATE NOWAIT` and used the normal
  foreign-organization invitation flow. Second run passed seven cases; the isolated final
  foreign-channel case passed. All eight cases passed across these focused runs. No product
  authorization or assertion was weakened. Final typecheck also passed.
- Production API/web build passed; final lint, planning and migration-history checks passed.
  **34 released migrations remain unchanged**. Added migration 35 only.
- Final aggregate `pnpm db:local quality` passed toolchain, tooling/security, planning,
  lint, all typechecks, **567 API**, **188 web**, **22 testkit**, **12 DB unit** and
  **3 storage** tests. It then stopped in schema tests: older expected migration counts
  and the exact table inventory still described migration 34. Updated those assertions
  for migration 35 and moved two synthetic repair filenames after the new migration.
  No timeout or permission assertion changed. The subsequent complete
  `pnpm db:local test:db` passed **67 schema/DB + 384 API database tests**, with zero
  failed, skipped, cancelled or todo tests; its disposable PostgreSQL container was removed.
  This includes all eight new issue #51 database tests in one complete run.
- Final `pnpm build` passed API and web production builds. Final lint/planning passed after
  migration fixture updates. Web regression output contained React `act(...)` warnings;
  negative storage tests emitted expected non-retryable-stream warnings. Neither caused
  failures. Built web output contains no Groq SDK/model/key-name reference.
- Verification combines the broad aggregate through storage, the successful full database
  rerun, final static checks and builds. The failed aggregate itself is **not** reported as
  green. The final source matches these checks; subsequent edits only record this evidence.

### Separate live Groq smoke

Performed on 2026-10-03 using only four synthetic messages and the existing ignored
server `LLM_API_KEY`. Exact model and `reasoning_effort: none` supplied through the same
SDK factory as runtime. **4/4 passed**: English progress, Hindi ETA, Hinglish progress,
English new-shipping quote. Latencies 161–365 ms, 169–174 input tokens and 26 output
tokens per call. Reviewed-rate estimated total $0.000964; not invoice reconciliation.
This confirms tested account connectivity/model/format access, not sustained quota,
general language quality, production privacy approval or live WhatsApp qualification.
No raw provider output or credential was printed. No real customer data was sent.

No production changes, commit, push, PR publication or merge performed.
