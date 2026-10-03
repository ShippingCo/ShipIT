# Assistant outcome contract — issue #52

M4 now records what the assistant actually did. It does not estimate calls saved.
M6 #65 owns reporting screens; #76 owns pilot release approval.

## Definitions (version 1)

The immutable `customer_conversation_turns` row is the turn event. Its identity is
the signed inbox UUID, unique across webhook and worker retries. Organization,
franchise, conversation and tool provenance remain in the existing record; the
four new metric columns contain only bounded categories, reason, locale and latency.
State, turn evidence and any reply reservation commit in the same transaction.

| Category | Meaning |
| --- | --- |
| success | Authorized tool produced the requested facts, estimate or saved pickup operation. Not proof the customer received a reply or resolved their overall problem. |
| clarification | Shipment selection or guided quote/pickup input is needed. |
| failure | Authorization, missing data, dependency, interpretation, malformed input or stale-source failure. Missing ETA/delay and failed resend are failures even when a safe reply was generated. |
| queued | Delivery-code resend was requested, not confirmed sent. |
| handoff | Customer turn requested human help; may reuse an existing case. |
| paused | Existing human case prevented competing automation. |
| consent / control | Consent command, language preference or resume; not a resolved shipment need. |
| thanks | Exact English/Hindi gratitude only; no inferred satisfaction or call avoidance. |
| unmeasured | Historical records or old workers lacking these definitions. Never backfilled as success. |

Turn latency is server receipt-to-record elapsed milliseconds (including queue and
inference waiting), clamped to 0–900,000. It is not provider delivery latency.
Locale is saved for evaluation, not exposed as a cohort filter.

`case_opened`, `case_resolved` and `case_reopened` derive from immutable support
event UUIDs and existing case/conversation ownership. Actor and controlled reason
remain traceable through the authorized support history. No text is copied.

`abandonment` is an **observed clarification timeout**, not inferred customer intent:
one event at turn time +15 minutes when no next recorded turn in that conversation
arrived by that deadline. Identity is `(inbox UUID, clarification_expired)`.
Another clarification resets the interval; a return after expiry does not erase it.
Any follow-up within the interval, including STOP or HUMAN, prevents that timeout.
It uses the existing selection/draft lifetime; it does not cancel business work.
Events are a deterministic SQL projection of committed sources, so there is no new
timer job, duplicate queue or counter repair process. A processing outage can cause
an observed timeout; the measure does not prove that the customer chose to leave.

`reply_failed`/`reply_pending` are separate current outbound-state measures for
turns in the selected week. Failed/suppressed are failures; queued/retry/dispatching/
uncertain remain pending. Accepted/delivered/read are excluded. They can change as
delivery recovers; do not subtract them from turn success to claim resolutions.
Interpretation failures and interpretation-provider/budget failures are separately
counted from the existing inference receipts. No new Groq client or settings.
An unfinished inference reservation is `interpretation_pending`, never a provider
failure or a success. Operational recovery remains with the existing worker.

## Read API and privacy

`GET /api/v1/assistant/metrics?organization_id=<uuid>&franchise_id=<uuid>&week=2026-09-21`

Uses session authentication and existing R22 `support.read`: scoped operator and
franchise administrator; organization administrator selects one owned franchise.
Read-only/dispatcher roles are denied. Scope is checked before counts. Unknown and
foreign scopes receive the existing controlled 404; invalid parameters receive 422.
No customer, docket, conversation, language, free-form group, export or raw-event
endpoint is exposed. Unknown parameters are rejected. API access is safely logged.

Only complete UTC Monday-to-Monday weeks within 53 weeks are accepted, with a
15-minute closing grace. Each fixed category is present; nonzero groups from fewer
than **five distinct conversations** have `events:null`, `latency_ms:null` and
`suppressed:true`. Zero groups show zero. There are no totals or complementary
subtotals that reveal hidden counts; the parent failure count is also suppressed if
any of its reason groups is suppressed. This is conservative disclosure minimization,
not differential privacy or a claim that conversations represent unique people.
Missing database dependencies return the standard safe service error.

Internal `metricRows` requires an issued `support.read` capability and returns only
bounded aggregates. #65 must preserve these definitions and privacy limits.
Historical turn records are immutable, so measurement backfill is intentionally
absent. Retention stays with the source domains; no transcript/PII copy is created.

## Rollout and verification

Apply additive migration 36 before compatible workers/API. No new secret or flag.
Existing SELECT/INSERT grants on turns cover new columns; preserve SELECT on
support cases/events, inference receipts and outbound rows for the existing runtime
role. Do not grant UPDATE/DELETE on turn evidence. Old workers remain compatible
and create `unmeasured` rows. Code rollback leaves the additive columns/index in place;
schema repair is forward-only. No production migration is performed by this work.

Using the pinned toolchain and disposable development database:

```sh
pnpm --filter @shippingco/api test
pnpm test:web
pnpm db:local quality
pnpm check:migrations
```

The normal suites include `assistant-outcomes.test.ts` and the bilingual corpus
`apps/api/test/assistant-evaluation.ts`. Real PostgreSQL fixtures use signed fake
WhatsApp messages, actual scope checks and fake providers. Existing pickup/support
component tests exercise staff actions, focus, loading, error and retry states.
For a manual synthetic flow: track a permitted parcel; ask ETA with none saved;
send thanks; replay the signed webhook; request HUMAN; claim/resolve/reopen in Human
support. Inspect turn evidence and support events: one turn per source, missing ETA
is failure, gratitude is separate, one active case. Query a closed week as staff;
small cohorts are suppressed. A sibling-franchise session must receive no counts.

Research and engineering decisions: [ADR 0037](../adr/0037-assistant-outcome-evidence.md).
Actual checks and limitations: [verification](issue-52-verification.md).
