# Issue #47 verification

Local review draft, 2026-10-02. Branch `issue-47-trusted-conversation-routing`, based on
merged #46 at `545dfa6`. No commit, push, PR publication or production change authorized.

## Research and history

Recovered the accessible complete issue-46 and Milestone-4 research chats. Verified
PR #131's actual merge and fast-forwarded the clean local main before implementation.
Read repository workflow, roadmap, all milestone/issue listings and relevant ownership,
schema, tests and service implementations. #47 is open in M4 (tracker milestone number 5);
its six prerequisites #23/#28/#30/#38/#42/#46 are closed. Its blocked label is stale.
No #47 comments exist. #48–#52 remain separate open follow-ups. The base merge contains
the #46 implementation with no intervening implementation change. See
[ADR 0032](../adr/0032-trusted-conversation-tools.md) for primary research and explicit
distinction between approved tracking identities and new least-privilege finance judgment.

## Acceptance mapping

| Requirement | Implementation and executable evidence | Status |
| --- | --- | --- |
| Consent/human priority | Pure router tests; signed STOP mixed with tracking, paused tools, RESUME, post-STOP resend denial | Verified locally |
| Saved charges and receipts | Payments/Receipts projections; changed tax policy preserves booked answer, immutable issued receipt number; tracking recipient finance denied | Verified locally |
| Current tracking/ETA/delay or unavailable | Same-transaction #46 projection, strict result schema; unavailable ETA; #46 real Route/event/last-mile regression cases | Verified locally |
| Multiple shipments need selection | Signed multi-Parcel pending charges, exact docket resumption and denied explicit docket clears prior choice | Verified locally |
| Foreign docket privacy | Real bookings/bindings in franchise B and independent organization C; identical foreign/unknown denial; no foreign provenance | Verified locally |
| No arbitrary endpoint/SQL/role | Closed router schemas, injection tests, tenant AST gate, missing public tool endpoint, read-only binding denial | Verified locally |
| Timeout/retry/handoff | Held real Parcel lock, rolled-back tracking grant, generic retry once; missing SELECT dependency fallback; truthful manual human handoff | Verified locally |
| Secure resend policy | Actual recipient-only challenge reservation, sender denial, cooldown, same protected code send, completed Parcel rejection, tracking rebind denial; shared #42 resend regressions | Verified locally |
| Durable state and dedup | Signed duplicate message, closed/reopened runtime pool, concurrent workers, one receipt, bounded 20-turn history | Verified locally |
| Malformed/stale/dependency safe | Expired source, unavailable issued receipt, wrong encryption key, unavailable dependency, disabled flag and uncertain provider outcome | Verified locally |
| Logs/API/audit exclude secrets | Strict allowlisted outputs, no transcript/phone/grant/code in turn receipts and captured logs; protected delivery command result; existing #46 projection tests | Verified locally |
| Real provider qualification | Synthetic provider port and signatures only; no live Meta send or production rollout | Not executed; deployment qualification remains required |

## Executed checks

The test composition starts
Fastify against disposable PostgreSQL 18.6 and fictional tenants; protected provider calls
use the existing synthetic port. No production data or real customer messages are used.

Toolchain: Node 22.23.2, pnpm 10.34.5, Python 3.12.14, PostgreSQL 18.6.
Executed `pnpm db:local quality`: **passed, exit 0**. Toolchain, 34 quality/tenant/frontend gates, planning,
lint, all five workspace type checks, 22 testkit tests, 12 DB unit tests, 522 API unit/
integration tests, 177 web tests, three private object-store contracts and 67 PostgreSQL
schema/DB tests, **351 database-backed API tests** and API/web production builds all passed.
The PostgreSQL groups report zero failed/skipped/cancelled/todo. Both disposable
PostgreSQL and object-store containers were removed. The final run includes all prior
upgrade-fixture fixes and the final conversation indexes/receipt checks.

Executed `pnpm db:local exec node scripts/test-conversations.mjs` after the final scheduler
indexes and immutable-receipt checks: **24 passed, zero failed/skipped/cancelled/todo**.
This includes all 11 new database conversation cases, seven #46 cases and six migration
cases. Its disposable PostgreSQL container was removed. Final `pnpm typecheck` and
`pnpm lint` also passed. Final planning, migration immutability and diff checks passed.

Executed `pnpm check:migrations`: all 30 released migrations unchanged; additive forward
migration allowed. Executed `git diff --check`: no whitespace errors. Focused diagnostics
verified new finance collection, multi-shipment resend, timeout rollback and repaired
old Booking/Delivery/e-way upgrade fixtures. Initial full DB run caught the three
upgrade-fixture failures; repair timestamps/count were corrected and the affected tests
passed. The next complete run found one additional Lots API upgrade-count fixture;
its count was corrected from 16 to 17 and its populated upgrade/replay test passed.
The final complete rerun passed after those fixes. No failure was suppressed or skipped.

Unchanged web tests emit React `act` diagnostics, and injected object-store failures emit
SDK streaming diagnostics; those suites finish successfully. No browser UI was changed.

All twelve issue acceptance criteria are verified in the documented local synthetic
environment. GitHub Definition of Done remains pending the explicitly unauthorized
commit/push/PR publication, current-head CI, independent review and merge. No production
data, real customer sends or deployment was used. Live provider qualification is not
claimed by these tests.

## Review and limits

The forward migration adds two owned conversation tables and narrowly extends durable
outbound/delivery identities. All 30 released migrations remain unchanged. Setup/grants,
flag dependencies and compatible rollback are in [operations](conversations.md). No new
runtime dependency, public endpoint, staff role or browser UI is added.

Receipt assistance returns an already issued summary; issuing or downloading a document
is not authorized through this channel. Human handoff truthfully requests direct contact;
automatic staff cases remain #50. Quotes, pickups, languages/AI and outcome metrics remain
#48–#52. Final evidence retention/deletion remains #72. Live provider behavior, hosted
secrets, CI and production deployment are not claimed verified by local tests.
