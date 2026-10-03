# PR title

Add durable assistant outcome metrics and self-service regression evidence

## Description

The prototype's handled/thanks counters cannot distinguish a useful tool result from
a missing fact, queued send or human handoff. Issue #52 adds bounded, immutable
outcome evidence to the existing deduplicated conversation turns and reconciles it
with support, inference and outbound records. Missing ETA/delay and failed tools
are excluded from success; thanks remains a separate signal. No calls-saved claim.

Closes #52. Completes M4's measurement/qualification scope on the merged
#45/#47/#48/#49/#50/#51 base. Reporting dashboards remain #65; pilot approval remains
#76. Approved Groq model, SDK, disabled thinking and server-side LLM_API_KEY are unchanged.

The weekly read API reuses scoped support authorization, excludes raw references and
message bodies, rejects arbitrary filters and suppresses small cohorts (including
complementary failure totals). Clarification timeout is explicitly an observed gap,
not inferred customer abandonment. Staff resolve/reopen events remain traceable.

Validation: the full local quality gate passed: 67 schema + 390 database integration,
590 API, 189 web, 34 tooling/security, 22 testkit, 12 DB unit and 3 private-storage
tests. Planning, lint, workspace typechecks, migration history and production builds
passed. Two small classification refinements made during the broad run were then
verified by all 6 focused PostgreSQL cases, 23 unit/evaluation cases and final lint;
the production build ran after those edits. Containers cleaned up successfully.
This is combined broad and final targeted verification, with
[exact acceptance mapping and rerun history](issue-52-verification.md).

Support/pickup UI regressions and a 390px keyboard walkthrough passed. The browser
uses fictional API responses; database tests use real transactions with fake
providers. Remote CI and live-provider delivery have not been run for this change.

Apply additive migration 36 before new workers/API. No new secrets or dependencies;
existing runtime table grants cover the added columns. Historical/old-writer turns
remain unmeasured. Roll back compatible code, leave additive schema, repair forward.
All 35 released migrations are unchanged; upgrade assertions account for one new
migration. No production data or deployment is part of this PR.

Research, metric definitions and manual fixture instructions:
[ADR 0037](../adr/0037-assistant-outcome-evidence.md) and
[assistant outcome contract](assistant-outcomes.md).

Commit message: `feat(assistant): add durable outcome metrics and regression evidence`

This is a local draft only. No commit, push, PR publication or merge has been performed.
