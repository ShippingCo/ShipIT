# PR title

Add English/Hindi customer replies and bounded Groq intent interpretation

## Summary

Customers can choose English or Hindi and ask common Hindi/Hinglish questions while
shipment answers continue to come from authorized services. Unknown requests may use
one constrained Groq classification; provider failure still permits deterministic commands.

## Linked Issue

Closes #51. Named prerequisites #6/#47/#48/#50 are merged; #49 is also in the base.

## What Changed and Why

- Persistent signed-channel locale and fixed localized status, money, receipt, quote,
  pickup and handoff replies. Exact identifiers/amounts/timestamps are preserved.
- Official `groq-sdk` 1.6.0, exact `qwen/qwen3.8-27b`, `reasoning_effort: "none"`,
  explicit existing `LLM_API_KEY`; default-off feature and privacy-policy gate.
- Strict intent/docket-placeholder/confidence validation. Reviewed vocabulary only,
  no raw personal data/history/business records in prompts and no generated replies.
- One durable reservation per inbox, organization budgets and five-second deadline.
  No database locks during inference; consent/handoff/access rechecked afterward.
  Zero retries, safe failure metadata and deterministic clarification/handoff.
- Migration 35 and scoped runtime grants; no public API, role or staff UI added.

## Scope Confirmation

- [x] Implements #51 only; no general chatbot, operational booking or staff UI expansion.
- [x] Acceptance mapping and actual run results are linked below.
- [x] No unrelated product or prototype redesign.

## Testing Performed

See [actual run record and acceptance mapping](issue-51-verification.md).
`pnpm db:local quality` passed toolchain, 34 tooling/security tests, planning, lint,
typecheck, 567 API tests, 188 web tests, 22 testkit tests, 12 DB unit tests and 3 storage
tests, then caught stale migration-count/table-list assertions. After updating those
fixtures, the complete `pnpm db:local test:db` passed **67 schema + 384 API database tests**
with no skips or failures. Final lint, typecheck, planning, migration-history checks and
production builds pass. This is combined verification, not a claim that the failed
aggregate passed. React act warnings and expected negative storage warnings are recorded.
Automated provider tests are independent of Groq. A separate four-request synthetic live
smoke passed English/Hindi/Hinglish classification with the required request settings.
That small sample does not establish general language quality or production privacy approval.

## Automated Checks

- [x] Tests pass across the recorded broad run and complete database rerun.
- [x] Typecheck passes.
- [x] Lint passes.
- [x] Production API/web builds pass.
- [ ] Required remote CI has not run: work intentionally remains local and uncommitted.

## Security / Privacy Review

The fixed router handles consent before interpretation. Only reviewed words and an opaque
docket marker leave the server; no history, raw identifiers, numeric forms, OTPs or business
records are sent. Strict output validation permits an intent and the same marker only.
Existing services enforce prices, permissions and mutations. Provider logging is off;
receipts contain safe categories, settings and usage estimates. Signed inbox identity,
one durable reservation, zero retries and existing outbound idempotency prevent replay.
Real-customer provider usage still needs deployment privacy/data-region approval.

## Tenant Isolation Review

Locale belongs to the signed installation/contact channel. Inference receipts use the
existing organization/franchise inbox authority; the shared organization budget cannot be
multiplied by sibling franchises. Tests cover foreign receipt reads/writes, sibling and
unrelated docket access, independently saved language and revoked access during inference.
No customer-supplied tenant scope or frontend-only permission check is introduced.

## Screenshots / Demo

Non-visual server and WhatsApp behavior; no staff screen changed. Send `LANGUAGE HI`,
then `मेरा पार्सल कहाँ है`, `शुल्क` or `रसीद भेजो` for a verified shipment. Switch back
with `LANGUAGE EN`. With AI disabled, these deterministic commands still work; unknown
requests clarify or enter the established support flow. See the setup guide for synthetic
automated scenarios and the separately authorized live smoke command.

## Migration Notes

Apply migration/grants first, deploy workers, then optionally enable `LLM_ENABLED` with
the existing key and an approved `LLM_PRIVACY_POLICY_REF`. A configured `LLM_MODEL`
must match the fixed model. Missing key/policy preserves deterministic service. Migration
35 is additive: existing conversations default to English; runtime grants are documented.
All released migrations are unchanged. No localStorage or production data was imported.

## Rollback / Failure Considerations

Disable inference to roll back provider usage; retain schema/receipts. Old workers do not
localize replies. Calls time out after five seconds; abandoned reservations fall back after
15 seconds without replay. Authentication/rate-limit/provider/schema failures use the
existing clarification or handoff path. No production deployment or customer sends occurred.

[Setup, synthetic commands and recovery](multilingual-assistant.md) ·
[Design and primary sources](../adr/0036-multilingual-intent-boundary.md)

## Commit message

`feat(assistant): add guarded Groq interpretation and English/Hindi replies`

This is a local PR draft. Commit, push, PR publication, CI and merge require later authorization.

## Definition of Done

Local scope, automated evidence, security/tenant checks and reproducible demo are recorded
in the verification document. Work began from newly pulled main on a dedicated issue branch.
Push, PR publication, current-head CI, review, merge and post-merge cleanup remain deliberately
unperformed under the user's approval boundary.
