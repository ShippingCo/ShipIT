# Open architecture decisions

Issue #13 update (2026-09-09): the owner selected own email/WhatsApp OTP authentication and deferred live delivery setup to M3. [ADR 0011](../adr/0011-operator-otp-authentication.md) and [API contract](operator-authentication.md) refine the authentication portion of D08 for review. This does not resolve privacy retention, high-assurance step-up or downstream authorization/deployment gates.

[Architecture index](README.md) · [ADR index](../adr/README.md)

This register distinguishes resolved contracts from remaining implementation decisions. Owners are responsible issue/domain
roles, not invented assignees. Each owner must record a reviewed decision and link its
evidence before the named gate. The Blocks column describes decision gates, not edits to
GitHub's dependency graph. Closing #2 alone does not make every listed issue ready.

ADRs 0001–0005 are the merged #2 constraints (PR #85). The project owner's approved
#3 execution requirements are recorded in [ADR 0006](../adr/0006-domain-ownership-and-authorization.md).
PR #86 has now merged #3. RESOLVED below means an accepted contractual decision;
it does not mean downstream implementation is complete. Other rows remain OPEN unless
explicitly marked PARTIAL. No vendor, statutory policy or runtime behavior is inferred.

| ID | Precise question | Current evidence / constraint | Owner | Must resolve before | Blocks issue(s) | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | Canonical entities, cardinality, docket scope and permitted transitions | [Domain](domain-contract.md), [complete lifecycle](parcel-lifecycle.md), [ADR 0006](../adr/0006-domain-ownership-and-authorization.md): multi-parcel from day one, global parcel dockets, custody distinct from ownership; all approved states/roles/guards | #3 / domain architecture | #3 PR acceptance; implementation gates remain with owners below | #4, #12, #19, #22, #24, #79 | RESOLVED contract |
| D02 | Complete role/action/resource/scope policy | [75-row matrix](authorization-contract.md) and [synthetic denials](domain-scenarios.md); seven roles, explicit exports, grantable agent transfer, declared org reads; [Issue #12 W41 amendment](../adr/0010-organization-franchise-tenancy.md) submitted for review; unapproved actions denied | #3 / tenancy; #12 / bounded lifecycle amendment; #14 implements memberships/grants | #3 policy accepted; W41 requires #12 reviewed merge; #14 permission mechanics before production exposure | #6, #12, #14, #15, #17, #42 | RESOLVED baseline policy; W41 pending #12 acceptance; implementation outstanding |
| D03 | Franchise customer ownership versus normalization/matching/merge mechanics | [Customer isolation](domain-contract.md#customer-isolation-and-field-boundaries) resolved: no implicit sibling/global directory; custody is shipment-only. Matching keys, ambiguous matches, merge/retention mechanics remain unapproved | #3 / ownership; #19 / customers with #72 / privacy | Ownership at #3 acceptance; matching/merge before #19 implementation | #19, #22, #46, #49 | PARTIAL: ownership resolved, matching/merge OPEN |
| D04 | Exact API/error/pagination schemas, event catalog/compatibility/stale/gap policy, idempotency scope/fingerprint/retention/expiry | [ADR 0007](../adr/0007-api-event-idempotency-contracts.md), [API](api-contract.md), [events](event-contract.md), [idempotency](idempotency-contract.md), [synthetic evidence](api-event-verification.md); #4 merged in PR #87; endpoint implementation remains downstream | #4 / API and events | Contract resolved; before consumers | #9, #10, #11, #16, #22, #24, #28, #35, #37, #40, #53 | RESOLVED contract; implementation outstanding |
| D05 | Concrete lease duration, retry/backoff, concurrency/polling, fairness, poison/redrive and consumer deduplication persistence mechanics | [#4 invariants](event-contract.md) define logical identity, quarantine/uncertainty and atomic source/outbox; no operational constants, queue or implementation selected | #35 / outbox; #39 / messaging; #40 / consumer dedupe | #35 worker design, #39 processing, #40 persistence before respective implementations | #35, #39, #40, #41, #45 | OPEN |
| D06 | Money/tax snapshots, jurisdiction, reconciliation, e-way and retention | [Issue #8 contract](money-tax-proof-privacy-contract.md) and [ADR 0009](../adr/0009-money-tax-proof-and-privacy-policy.md): exact paise, deterministic components, one final adjustment, W27 local policy, blocked unknown jurisdiction, immutable booking and separate e-way provenance | #8 policy; #21 tax, #29 payments, #30 receipts, #32/#67 e-way | #8 acceptance; current tax validation and finance mechanics before production | #20, #21, #22, #29, #30, #32, #62, #63, #67 | PARTIAL: #8 policy resolved on acceptance; partial collections, negative credits, statutory output validation and implementation remain gated |
| D07 | Challenge lifetime, failures, resend/replacement and exceptional proof | [Issue #8 proof policy](money-tax-proof-privacy-contract.md#delivery-challenge-policy-for-issue-42): 10 minutes, 5 lineage failures, 60 seconds, 3 resends, no reset/reveal; W39 request/W40 independent responsible franchise_admin approval, W11 completion; office collection uses same controls | #8 policy; #42 deliveries | #8 acceptance; #42 security/attachment/cleanup tests before production | #24, #42, #43, #45 | RESOLVED policy on #8 acceptance; production implementation outstanding |
| D08 | What identity/session mechanism, secret lifecycle, CSRF/proxy boundaries and data retention/deletion rules meet threats? | [ADR 0008](../adr/0008-environment-secrets-and-security-baseline.md), [configuration](configuration-contract.md), and [threat model](security-threat-model.md) resolve the baseline and gates. #13 still selects auth mechanics; [Issue #8](money-tax-proof-privacy-contract.md#field-and-class-retention) specifies retention classes/holds and accountable validation; #72 still validates applicable periods and implements privacy | #6 / security, #13 / auth, #8 and #72 / privacy | #6 contract acceptance; auth/privacy mechanics before relevant implementation | #9, #11, #13, #31, #36, #51, #68, #69, #72, #73 | PARTIAL: security baseline specified; privacy classes/governance resolved on #8 acceptance; auth mechanics and privacy applicability/execution OPEN |
| D09 | What private storage provider/access revocation, quarantine validation, file size/type/malware limits and retention are required? | [T09](security-threat-model.md#required-threat-controls) requires private objects, authorized references, validation/quarantine, short-lived access, deletion and revocation tests. #31 selects limits/provider; no vendor is committed | #31 / attachments with #6 / security | #6 baseline; file design before #31 implementation | #31, #42, #69, #72 | PARTIAL: security gates specified; provider and limits OPEN |
| D10 | Which messaging installation/templates/consent rules and actual carrier capabilities/access are verified? | #36/#38 own provider policy; #53 manual/file/API contract; #56/#57 dated carrier access research. Unsupported/uncertain stays explicit | #36/#38 / messaging; #53/#56/#57 / carriers | Before #36/#38 provider behavior; #53 contract before research/adapters; evidence before #60 | #36, #37, #38, #39, #53, #54, #55, #56, #57, #58, #59, #60 | OPEN |
| D11 | What maximum route affected set, lock ordering and contention limit support atomic operational delay application? | #28 allows explicit atomic/resumable contract; this baseline chooses bounded atomic operations plus separately resumable notifications | #28 / routes and #74 / qualification | Bound before #28 implementation; demonstrated load before #74 acceptance | #28, #41, #74 | OPEN |
| D12 | What report date boundaries, issued-snapshot semantics, reconciliation and allowed organization projections are canonical? | [#3](domain-contract.md#money-docket-and-time-invariants) fixes UTC/Asia-Kolkata half-open reporting dates; [hold clock](parcel-lifecycle.md#two-business-day-collection-clock) requires #8/#66 approved operating weekdays/holidays before implementation; #30 immutable receipts; #61–#67 must reconcile source facts and exports | #61 / reporting with #30 / receipts and #66 / settings | Receipt snapshot contract before #30; query definitions before #61–#67 implementation | #30, #61, #62, #63, #64, #65, #66, #67 | OPEN |
| D13 | What hosting region/budget, process sizing, DB/runtime versions, backup recovery and capacity targets are approved? | #5 owns Node/pnpm alignment; #10 DB dependency review; #68/#69/#74 operational targets. Local vendor/capacity suggestions are proposals only | #5 / tooling, #10 / DB, #68/#69/#74 / operations | Toolchain at #5; DB versions before #10; targets before provisioning/qualification | #5, #10, #68, #69, #70, #74, #76 | OPEN |
| D14 | What plans, usage, billing, adoption, support-access, enterprise identity/domain and service commitments are commercially approved? | #77–#83 are M8; pilot has no subscription dependency. [#3 adoption](domain-contract.md#controlled-parent-adoption) resolves dual approval/conflict gates only; execution/history/active-custody migration and other commercial values remain OPEN | #77–#83 / commercial owners | #76 pilot gate first; each M8 contract before its own implementation | #77, #78, #79, #80, #81, #82, #83 | OPEN |

## Explicit downstream gates from Issue #3

- #4/#12/#22: docket wire normalization/global allocator, entity persistence, version/idempotency schemas; no per-tenant docket uniqueness fallback.
- #21/#29/#30: implement #8 exact tax allocation and fixed Booking payable; validate statutory outputs, partial collection allocation, negative credits and reversal/receipt reconciliation before production.
- #42: implement #8 office-collection proof, resend/exception rules and lineage limits; two physical attempts are not OTP attempt limits.
- #66: operating calendar values remain unapproved after #8; versioned local settings use W29; no production Mon–Fri assumption or automatic hold expiry without an approved calendar.
- #24: controlled failure subreasons, unapproved post-movement cancellation, expired-hold exceptions, return completion/recall; all denied until reviewed.
- #14/#19/#23/#31/#72: grant mechanics, matching/merge, exact field/attachment projections and privacy controls.
- #79: ownership closure/history, in-flight custody strategy, migration/recovery execution after pilot; dual approval is not data movement.
- Cross-organization custody remains denied under ADR 0003; any future proposal needs a reviewed contract before #24/#53 expose it.

These are downstream implementation/policy gates, not additional prerequisites preventing
the #3 documentary contract. Missing lint (#5) is unavailable, not passed; see [verification](domain-verification.md) for merge-policy limits.

## Issue #4 acceptance and remaining gates

D04 is fully specified for review; it becomes RESOLVED contract only when the #4 PR is
accepted/merged. [Verification](api-event-verification.md) maps all nine acceptance criteria.
This does not close D05 or claim endpoint/worker implementation. #9/#23 own cursor integrity
encoding/lifetime and detailed projections; #22/#24/#28/#29 own expired-command reconciliation
queries, full feature DTOs and longer sensitive replay retention where needed. #12/#22 own
global docket allocation/layout; #4 fixes scalar normalization only. Business policies
already deferred to #8/#21/#29/#42/#66/#72 stay open. Lint baseline remains #5.

## Resolving a row

The owner links the decision, evidence and affected contracts from its issue/PR. Update
this register's status and link when resolved, or split a row if separate gates become
necessary. Do not close a row because a developer selected an undocumented constant.
Changes to accepted architecture need a superseding ADR; policy details within the existing
boundary belong to their owning issue. Implementation prerequisites still follow the
[issue index](../ISSUE_INDEX.md), including #3 before #4 and #6, and #53/#6 before #56/#57.

## Issue 8 acceptance boundary

[Verification](issue-8-verification.md) maps every acceptance criterion. ADR 0009 adds four
reviewed actions to the closed matrix without changing seven roles. D06/D07 and only the
privacy portion of D08 advance on accepted merge. The [source register](policy-sources.md)
records current evidence and qualified validation gates; no statutory rate, blanket retention
period, authentication/session mechanism or production implementation is certified.

## Issue 12 tenancy amendment boundary

[ADR 0010](../adr/0010-organization-franchise-tenancy.md) records the minimal `active` /
`disabled` root lifecycle and W41's explicit target-franchise lifecycle authority. It
adds no generic Organization member action and leaves W29, W34 and W35 restrictions
intact. The persistence/locking/privilege implementation does not resolve #13 identity,
#14 membership/grants, #15 product-wide tenant-context enforcement, #16 durable audit,
#17 authenticated onboarding or #79 adoption. W41 is submitted for external review;
neither this document nor the open PR satisfies a downstream merged prerequisite.
