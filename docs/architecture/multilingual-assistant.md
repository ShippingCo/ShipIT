# Multilingual customer assistance — Issue #51

Send `LANGUAGE HI` (or `हिंदी`) for Hindi and `LANGUAGE EN` for English. Preference
belongs to the signed installation/channel, persists across restart and shipment-selection
expiry, and cannot name another customer or franchise. Until explicitly selected, a Hindi
message selects Hindi. Hinglish is understood; choose HI if Hindi replies are preferred.
Choosing a language preserves a quote/pickup draft and never resumes a staff-owned case.

Examples: `मेरा पार्सल कहाँ है`, `mera parcel kidhar hai`, `पार्सल कब आएगा`, `रसीद भेजो`,
`कोड दोबारा भेजो`, `भाड़ा बताओ`, `पिकअप चाहिए`, `कर्मचारी से बात करनी है`.
`STOP`/`UNSUBSCRIBE`, `संदेश बंद करो` and `संदेश चालू करो` are local consent controls.
Staff-written messages retain the staff member's wording; no automatic translation changes
them. OTP templates remain the existing separately qualified delivery service.

## Authority and limits

Signed message → consent/controls → fixed router → optional interpretation only for an
unknown request → schema validation → existing authorized service → fixed localized reply
→ encrypted outbound pipeline. Status, ETA, dockets, prices, receipts and codes never come
from a model. The sole extracted identifier slot is `D1`, mapped to the locally retained
customer-supplied docket. It conveys no authorization. Codes are never returned by chat.
Interpreted quote/pickup intent only starts the existing guided form. Weight, dimensions,
dates, addresses and confirmation/cancellation commands remain locally validated; the model
cannot supply them or submit a booking/pickup. Hindi text retains exact numeric/identifier
format, including INR amounts, ISO timestamps and machine location/service keys.

Fixed commands work with AI disabled, missing credentials, missing policy approval or an
outage. Unknown/invalid/low-confidence requests use clarification or the existing staff case
when support is enabled. Confidence >=0.85 is only a rejection threshold, not a calibrated
probability or authorization. There is no generated wording, tool loop or model clarification
call. Ambiguous multiple intents/dockets are never guessed by the fixed router.

External use is default-off. Only reviewed English/Hindi/Hinglish vocabulary and the opaque
docket marker reach Groq. Unknown tokens become `[omitted]`; numeric/private forms, URLs,
credential/code content and common injection patterns are rejected. This deliberately loses
some language coverage. No shipment facts, identity, address, history, keys or raw source
text are sent. Context and vocabulary changes require privacy and evaluation review.

Groq `groq-sdk` 1.6.0 is pinned (no runtime dependencies or install hooks). Node 22.23.2
is supported. Every request uses `qwen/qwen3.8-27b`, `reasoning_effort: "none"`, strict
JSON schema, no tool calling, no streaming, 192 output tokens and a five-second deadline.
SDK and application retries are zero. No fallback model/provider is permitted. Auth,
rate-limit, missing-model, unsupported-setting and timeout errors reveal only safe categories.
SDK logging is explicitly off, regardless of `GROQ_LOG`.

## Persistence, concurrency and cost

Migration 35 adds `locale`/`locale_explicit` to conversations, `conversation_inferences`
and organization-wide `conversation_inference_budgets`. Existing conversations default to
English with no explicit preference. No prompts, model text or extracted customer details
are persisted. Receipts retain model/schema/thinking settings, correlation, closed category,
latency, token usage and estimated USD micro-units when usage is available. Estimates use
the reviewed $0.80/$4.00 per million input/output tokens; they are not billing reconciliation.

The short reservation transaction commits before calling Groq. There are no DB locks or
transactions while waiting. One inbox can reserve at most once. The budget locks an
organization row, shared by its franchises: at most 10 calls per minute, 100 per UTC day
and 1,000,000 reserved USD micro-units/day ($1). Each request conservatively reserves 10,000
micro-units ($0.01), never refunded on failure; both text and output limits keep the reviewed
request below this ceiling. The provider account's own limits may be lower.

The current conversation scheduler remains ordered. Other replicas see an in-flight
reservation and do not call again; that turn can temporarily delay the scheduler for the
five-second request. An abandoned reservation expires after 15 seconds and falls back,
without repeating a possibly accepted request. Consent, staff ownership, source age and
shipment grants are rechecked after inference; dispatch checks them again. State changes
can discard a valid classification. Tool/reply rollback keeps the existing safe fallback.
Retention policy remains #72; do not remove request receipts while sources can replay.

## Setup and rollout

1. Apply `1791738000000-multilingual-intents.cjs` and the runtime grants below.
2. Deploy compatible workers before using locale commands. Existing conversation flags
   and prerequisites remain required. Language support itself needs no provider.
3. Optionally set server `LLM_ENABLED=true`, the existing `LLM_API_KEY`, and
   `LLM_PRIVACY_POLICY_REF` to the approved policy/version reference. Optional `LLM_MODEL`
   must equal `qwen/qwen3.8-27b`. No key rename or second secret is needed. The existing
   environment parser captures the key privately and passes it explicitly to Groq.
   `.env` is not automatically loaded by the API; supply environment through your existing
   local/hosted startup. Missing key/policy disables inference without breaking startup.
4. Before real customer use, the deployment owner must approve Groq's retention/data-region
   terms and account controls. A filled reference is an operator attestation, not automatic
   legal approval or verification of the account's settings. Synthetic smoke access does
   not approve production use. Groq documents US data retention and optional ZDR.
5. Disable `LLM_ENABLED` to stop new inference. Keep current workers for Hindi support.
   Drain in-flight calls before rolling back code; older workers ignore locale and may
   answer in English. Preserve schema/receipts; repair with forward migrations.

Substitute the already provisioned non-owner runtime role for `shipit_runtime`:

```sql
GRANT UPDATE(locale,locale_explicit) ON shipit.customer_conversations TO shipit_runtime;
GRANT SELECT,INSERT ON shipit.conversation_inferences,shipit.conversation_inference_budgets TO shipit_runtime;
GRANT UPDATE(state,latency_ms,input_tokens,output_tokens,estimated_micro_usd)
  ON shipit.conversation_inferences TO shipit_runtime;
GRANT UPDATE(day_start,minute_start,day_calls,minute_calls,reserved_micro_usd)
  ON shipit.conversation_inference_budgets TO shipit_runtime;
```

No new public endpoint, user role or staff UI is introduced. Scoped repositories accept
only trusted inbox service authority. Operations owners can inspect safe reservation state
and budget counters through their existing database operations access; no public telemetry
endpoint is added. `reserved` older than 15 seconds recovers on the next conversation tick;
repeated failures require checking account access/configuration, not blind retries.

## Verification

```sh
pnpm --filter @shippingco/api test test/integration/multilingual.test.ts
pnpm db:local exec node --experimental-strip-types scripts/test-multilingual.mjs
pnpm db:local quality
pnpm check:migrations
# Explicit opt-in only; existing local .env must be ignored and synthetic-use authorized:
pnpm exec node --experimental-strip-types --env-file=.env apps/api/test/smoke-language.ts
```

Automated tests use provider fakes. The live script sends at most four synthetic fixtures
and stops on a provider availability error. It prints only safe categories/usage; four
passing examples do not prove general Hindi quality. See the [working verification record](issue-51-verification.md)
for actual runs, limitations and acceptance mapping. [Research and design](../adr/0036-multilingual-intent-boundary.md).
