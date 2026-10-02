# PR title

Add a human support queue with safe staff replies and durable bot pause

# PR description

Customers asking for a person or an unrecognized service need now reach one durable,
franchise-scoped case. Previously HUMAN only paused the bot temporarily and explicitly
created no staff case. Repeated requests now join existing work; staff can claim,
assign, reply, add private notes, resolve and reopen from the production Human support
page. Active cases keep the bot paused across restart, RESUME and selection expiry.

Expected revisions and atomic request receipts protect competing claims and retries.
Case state, private history and encrypted outbound reservation commit together. Staff
replies use the existing consent-aware worker and verified channel. Expired service
windows visibly block delivery; changed ownership invalidates older unsent replies.
Configured franchise hours describe availability without a fixed callback promise.

Closes #50 after review and merge. Builds on merged #16/#38/#39/#46/#47. #49 is already
in main but is not a named prerequisite. Languages, metrics, telephony and unrelated
milestone work remain out of scope. No new dependencies or test timeouts.

## Validation

See [acceptance mapping and complete run record](issue-50-verification.md). Focused
rules, staff UI, real PostgreSQL concurrency/isolation/recovery and populated migration
tests pass. Real-browser staff flow used fictional API responses. The initial aggregate
passed non-DB stages but stopped on historical migration counts; corrected focused
checks and final DB/build/static continuation provide the final evidence recorded there:
**67 schema/DB + 376 API database tests passed**, with zero failures, skips,
cancellations or TODOs. Earlier broad stages passed **22 testkit + 12 DB unit +
535 API + 188 web + 3 object-store tests** and **34 tooling/security tests**.
Final lint, five package typechecks, planning checks and production build also passed.
This is combined verification, not one uninterrupted green quality invocation.
No new-branch CI or live Meta qualification is claimed.

## Rollout and recovery

Apply additive migration 34 and documented narrow runtime grants before deploying
compatible workers. Enable `support_enabled` in the server-only WhatsApp catalog and
optionally configure actual `support_hours`. The default remains off. Existing active
cases still pause the bot when new creation is disabled; resolve/reconcile before a
pre-#50 rollback. Repair applied schema forward. Do not blindly repeat uncertain sends;
franchise administrators use existing messaging recovery.

[Operations/API/setup](support.md) · [Design and research](../adr/0035-human-support-handoff.md)

# Suggested commit

`feat(support): add human handoff queue and policy-aware staff replies`
