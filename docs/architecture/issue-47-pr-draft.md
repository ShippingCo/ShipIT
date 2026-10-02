# Draft commit

`feat: add trusted customer conversation routing (#47)`

# Draft PR title

Add verified customer conversation tools and durable replies (#47)

# Draft PR description

Verified customers can now ask their franchise WhatsApp channel for current tracking,
ETA/delay, saved Booking charges, issued receipt summaries and secure delivery-code
resend. Previously #46 provided relationship verification and tracking grants without
a durable question router. Multiple shipments now require an exact docket before an
answer, and every turn/reply rechecks current relationship and tenant ownership.

The fixed router prioritizes STOP and HUMAN, calls only six server-owned tools and stores
minimal durable selection/turn receipts. Finance is restricted to the booking sender;
resend requires the independently retained delivery recipient and shares existing
challenge limits. Codes, grants and private source records never enter replies or logs.
Tool failures roll back partial work before a bounded retry response. Existing encrypted
outbound dispatch handles persistence, current-policy suppression and provider uncertainty.

Adds one forward migration, narrow runtime grants and default-disabled
`conversation_enabled` in the server-only catalog. No dependency, public tool endpoint,
staff role, AI provider or browser UI is added. Apply migration/grants before enabling;
disable the flag and drain/suppress conversation sources with compatible workers before
rolling code back. Receipt replies are already-issued summaries; automatic staff case
creation remains #50. Remove the new catalog key before starting older strict parsers.
Quotes/pickups/languages/outcome metrics remain #48–#52.

Validation: `pnpm db:local quality` passed: 34 quality gates, planning/lint/typecheck,
22 testkit + 12 DB unit + 522 API + 177 web + 3 private object-store tests,
67 schema/DB + 351 database-backed API tests, and API/web production builds.
The focused conversation/#46/migration runner passed 24 with zero failed/skipped/cancelled/todo.
Migration immutability and `git diff --check` passed; all 30 released migrations remain
unchanged. See [acceptance and executed results](issue-47-verification.md), including
real PostgreSQL signed-channel flow, tenant B/C denial, restart/dedup/concurrency,
frozen finance, recipient-only resend, revoked-contact suppression, timeout rollback
and forward upgrade. Earlier upgrade fixtures were updated only for the additive count
and synthetic repair timestamps; their rollback/replay checks passed on the final run.
Live Meta qualification and hosted deployment are outside this local verification.

Research and tradeoffs: [ADR 0032](../adr/0032-trusted-conversation-tools.md).

Closes #47 after review and merge.
