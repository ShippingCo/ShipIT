# Pilot gates and commercial boundaries

[Architecture index](README.md) · [Roadmap](../ROADMAP.md) · [Issue index](../ISSUE_INDEX.md)

M0–M7 are the first-franchise pilot path. M8 is commercial expansion after the pilot gate.
This separates delivery gates; it does not remove M8 from the long-term commercial goal.
All gates below are requirements, not claims of completed functionality. The nine live
milestone descriptions and issues were read at the baseline recorded in the architecture index.

## Pilot required

| Milestone / issues | Architectural gate required to exit |
| --- | --- |
| M0 · #2–#9 | Reviewed architecture, canonical ownership/roles/states, API/event/idempotency contracts, threat/policy decisions and prototype migration map; reproducible test/type/build **and actual lint** baseline. #2 alone is not M0 completion |
| M1 · #10–#18 | Real migrations/transactions, scoped organizations/franchises, revocable sessions and membership permissions, safe audit/onboarding and separate demo/API adapters. Fresh/upgrade and two-org/three-franchise negative tests must pass |
| M2 · #19–#34 | Durable customers/pricing/tax/bookings, parcel lifecycle, lots/routes/atomic delay, separate payment ledger, immutable receipts/private files/e-way provenance and connected operator UI. Concurrent retries reconcile; production delivery completion remains disabled until M3 proof gate |
| M3 · #35–#45 | Transactional outbox and durable worker, verified provider/templates/callbacks, consent at send time, deduplicated notification fanout, secure atomic delivery proof and truthful messaging UI. Crash/replay/STOP/uncertain-send and no-OTP-reveal checks pass |
| M4 · #46–#52 | Verified customer context; deterministic fact/quote/pickup tools and staff handoff, English/Hindi behavior, safe optional interpretation and meaningful outcomes. Foreign-shipment and fabricated-fact attempts fail |
| M5 · #53–#60 | Capability-based carrier ports, working manual/file paths, dated research for both named carriers, provenance-preserving tracking/rate reconciliation and first verified connection/runbook. A manual/file-only outcome is explicitly labelled; unavailable APIs never prevent local booking |
| M6 · #61–#67 | Scoped sales/tax/ledger/performance/messaging queries reconcile to source/issued facts; exports match filters and neutralize spreadsheet formulas. Versioned settings cannot rewrite old receipts. E-way/government responsibilities remain external |
| M7 · #68–#76 | Isolated environments, proved DB/object restore and alerts, security/privacy/dependency/load gates and operator runbooks; accountable go/no-go for the exact release and franchise configuration. #76 requires its dependency closure and unresolved high-risk defects block release |

Issue dependencies determine safe parallel work, not milestone numbering. #2 directly
blocks #3/#4/#6/#7/#10/#53/#56/#57, but those issues may have additional prerequisites.
Do not relabel them ready merely because this architecture PR exists or is merged.

The provider architecture does not promise an API that research cannot verify. M5's
actual exit criterion allows the first verified live **or explicitly labelled manual/file**
path with fallback. The full commercial goal may demand additional capability later;
that is not evidence that a live integration already exists.

## Commercial / post-pilot

The pilot/MVP explicitly excludes **subscriptions, white labeling and expanded corporate
analytics** as required by #2. Ordinary pilot franchise reporting (#61–#67) remains required.

| M8 issue | Excluded from pilot; retained for commercial phase |
| --- | --- |
| #77 | Commercial plans, entitlements and billable usage metering |
| #78 | SaaS subscriptions, billing webhooks and trial lifecycle |
| #79 | Controlled franchise adoption into larger organizations |
| #80 | Time-limited approved/audited ShippingCo support access |
| #81 | Enterprise SSO and identity provisioning |
| #82 | White-label branding and verified domain mapping |
| #83 | Enterprise service-level reporting and operational commitments |

Expanded corporate analytics is an explicit scope exclusion in #2, not an invented
additional M8 issue or synonym for all existing reports. Its detailed scope, if required,
must be addressed through D14's commercial decisions. Pilot staff login, scoped owner
reporting and courier collections cannot depend on subscription activation. M8 billing
is separate from a parcel's To-Pay ledger and cannot repurpose delivery/provider retries
as billable usage. Later commercial changes require their own tests and release review;
M7 acceptance does not pre-approve unimplemented M8 features.
