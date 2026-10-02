# Issue #48 verification

Local branch: `issue-48-customer-quotes`, based on merged main `368edb0`.
All data/provider responses below are synthetic. No commit, push, published PR,
production modification or deployment is authorized or performed.

## Acceptance evidence

The focused suite is `apps/api/test/database/customer-quotes.test.ts`, with pure rules
in `apps/api/test/integration/customer-quotes.test.ts`. All eleven criteria below are
verified locally in synthetic tests. This is not live-provider or GitHub CI evidence.

| Criterion | Implementation and test evidence |
| --- | --- |
| Deterministic amount | Existing Pricing calculation; repeated identical inputs return INR 102.50 from the same version. |
| Missing dimensions | Dialogue stays on the dimension prompt; no quote exists before valid completion. |
| Inclusive thresholds | Below/at/above weight and dimension assertions; exact thresholds produce durable referral without amount. |
| Unsupported lane/service | Explicit policy checks return reference, reason and contact-staff guidance. |
| Expired reference | Fake evaluation clock crosses expiry/new published interval; CONFIRM QUOTE produces new INR 200.00 evidence linked to old immutable quote and never books. |
| Cannot mutate rates | Signed customer fixture compares Pricing rows before/after; schema/API accepts no customer override. |
| Estimate and exclusions | Reply names non-binding estimate, freight/packing, actual-weight assumptions, expiry and excluded tax/rounding/pickup/insurance/special handling. |
| Restart and reproducibility | A fresh pool/worker resumes incomplete dialogue; duplicate signed source and concurrent workers create one effect. |
| B/C isolation | Valid quote references and published nested rate IDs from sibling B/unrelated C are denied; unknown/foreign quote responses match. |
| Controlled failure | Invalid weight/dimensions, STOP/HUMAN, policy changes and revoked dependency privileges have controlled outcomes; failing completion leaves no quote. |
| Privacy | Synthetic logs and turn evidence are inspected for channel/dimension leakage; no new browser surface or public rate directory exists. |

Additional coverage checks policy CSRF/role/version/idempotency, the persistent hourly
limit, opt-in configuration, immutable rows, and an upgrade of populated conversation
state from migration 31 to 32 with repeat no-op. The #46/#47 focused regressions cover
pending-consent deferral, lowercase selection and recorded delay relevance.

## Commands and results

Use Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and disposable PostgreSQL 18.6:

```sh
pnpm db:local exec node scripts/test-customer-quotes.mjs
pnpm db:local quality
pnpm check:migrations
```

Executed focused PostgreSQL verification: **33 passed**, zero failed/skipped/cancelled/
todo. This includes eight quote cases, twelve conversation cases, seven customer-access
cases and six migration cases. The final complete suite also includes the later
disabled-help-text and revoked-admin replay assertions.

The full quality run passed toolchain checks, 34 quality/tenant/frontend
gates, planning, lint, all five workspace typechecks, 22 testkit tests, 12 DB unit tests,
527 API unit/integration tests, 177 web tests, three private object-store contracts,
and 67 PostgreSQL schema/DB tests. Its API database group completed with four failing
files; it did **not** return a successful whole-pipeline exit code. All four affected
files subsequently passed through targeted reruns as described below. The unchanged
files were exercised by that complete group; no skipped case is accepted by the runner.
Final `pnpm test:quality` (34 tests), `pnpm lint`, all five workspace typechecks, and
`pnpm build` (API build validation and Vite production web build) passed with exit 0.
Separately, `pnpm check:migrations` passed with all 31
released migrations unchanged, and `git diff --check` passed.

The first complete API database run exceeded its 15-minute aggregate budget. Windows
now has a bounded 30-minute API-group budget and a 45-minute outer quality budget.
Three existing files repeatedly exceeded their 180-second aggregate file limit; the
Windows file envelope is now 300 seconds. Linux CI and individual test deadlines are
unchanged. The helper's synthetic
timeout adapter was updated to exercise both outer budgets. No case was skipped.

Initial runs exposed a past-effective-date test fixture, an unused test variable and
an incomplete synthetic provider type; these were corrected. One earlier focused run
ended with a conversation-file failure while other checks ran concurrently; the next
focused run passed all 33 tests without changing test deadlines or skipping work.
Existing web React `act` warnings and injected object-store streaming diagnostics
remain non-failing, as in #47. No real provider sends or customer data were used.

The four isolated regressions were Bookings, Deliveries, Messaging History and
Notification Automation. Bookings/Deliveries passed with the Windows file envelope.
The history fixture now inserts its unchanged 30,003 attempts in three bounded setup
statements; its 10,000-intent query-plan, tenant-index, bounded-output and query-count
assertions are unchanged, and the file passed. One notification case created four
complete fixtures under a single 30-second limit; its independent scenarios are now
separate tests with that same individual limit and assertions. Its complete final
file reported **22 passed, zero failed/skipped/cancelled/todo**. The final API test
inventory has three additional cases from that split. Every disposable container
used in these runs was removed, and temporary diagnostic adapters were removed.

Evidence is a complete regression run plus passing reruns of its affected files,
not a claim that the final tree obtained one uninterrupted green `pnpm quality` run.
GitHub CI remains unexecuted because commit/push/PR publication are not authorized.

## Limits and rollout

No new graphical interface is included: WhatsApp text and the authenticated staff
policy API use existing channels. The web regression suite remains required. Live Meta
delivery and production configuration are not established by synthetic tests. Configure
real approved lanes/rates/thresholds only during a separately authorized rollout.
Pickup requests (#49), actual staff cases (#50), language/AI (#51), outcome metrics (#52)
and retention/deletion (#72) remain outside this change.

See [contract](customer-quotes.md), [ADR and sources](../adr/0033-customer-shipment-estimates.md),
and [draft delivery details](issue-48-pr-draft.md).
