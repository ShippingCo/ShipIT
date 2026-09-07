# Open architecture decisions

[Architecture index](README.md) · [ADR index](../adr/README.md)

This register distinguishes resolved contracts from remaining implementation decisions. Owners are responsible issue/domain
roles, not invented assignees. Each owner must record a reviewed decision and link its
evidence before the named gate. The Blocks column describes decision gates, not edits to
GitHub's dependency graph. Closing #2 alone does not make every listed issue ready.

ADRs 0001–0005 are the merged #2 constraints (PR #85). The project owner's approved
#3 execution requirements are recorded in [ADR 0006](../adr/0006-domain-ownership-and-authorization.md).
RESOLVED below means a documented #3 contract, effective on that PR's acceptance/merge;
it does not mean downstream implementation is complete. Other rows remain OPEN unless
explicitly marked PARTIAL. No vendor, statutory policy or runtime behavior is inferred.

| ID | Precise question | Current evidence / constraint | Owner | Must resolve before | Blocks issue(s) | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | Canonical entities, cardinality, docket scope and permitted transitions | [Domain](domain-contract.md), [complete lifecycle](parcel-lifecycle.md), [ADR 0006](../adr/0006-domain-ownership-and-authorization.md): multi-parcel from day one, global parcel dockets, custody distinct from ownership; all approved states/roles/guards | #3 / domain architecture | #3 PR acceptance; implementation gates remain with owners below | #4, #12, #19, #22, #24, #79 | RESOLVED contract |
| D02 | Complete role/action/resource/scope policy | [70-row matrix](authorization-contract.md) and [synthetic denials](domain-scenarios.md); seven roles, explicit exports, grantable agent transfer, declared org reads; unapproved actions denied | #3 / tenancy; #14 implements memberships/grants | #3 PR acceptance; #14 permission mechanics before implementation | #6, #12, #14, #15, #17, #42 | RESOLVED policy; implementation outstanding |
| D03 | Franchise customer ownership versus normalization/matching/merge mechanics | [Customer isolation](domain-contract.md#customer-isolation-and-field-boundaries) resolved: no implicit sibling/global directory; custody is shipment-only. Matching keys, ambiguous matches, merge/retention mechanics remain unapproved | #3 / ownership; #19 / customers with #72 / privacy | Ownership at #3 acceptance; matching/merge before #19 implementation | #19, #22, #46, #49 | PARTIAL: ownership resolved, matching/merge OPEN |
| D04 | What are exact API/error/pagination schemas, event catalog, compatibility rules, stale/gap policy, idempotency fingerprint/scope/retention and expired-key semantics? | [#3 domain](domain-contract.md) fixes docket scope/UTC semantics; ADR 0004 fixes architecture, not final wire fields; #4 owns catalog and ordering | #4 / API and events | M0 #4 acceptance, before contract consumers | #9, #10, #11, #16, #22, #24, #28, #35, #37, #40, #53 | OPEN |
| D05 | What lease duration, retry/backoff bounds, fairness, poison/redrive and consumer deduplication mechanics satisfy durability? | PG outbox required; no broker/library selected. Uncertain provider acceptance must not be blindly resent | #35 / outbox with #39 / messaging | #4 defines invariants; #35 design before worker implementation, #39 before outbound queue | #35, #39, #40, #41, #45 | OPEN |
| D06 | What money rounding, tax jurisdiction/rate authority, collection/reversal and e-way/retention policies are approved? | [#3 money contract](domain-contract.md#money-docket-and-time-invariants) resolves integer paise and final rupee rounding (.50 up), separate adjustment; #8/#21/#29 still own tax precision/allocation, partial collections, credits and reversal reconciliation | #8 / money and compliance with #21 / tax and #29 / payments | M0 #8 acceptance; policy verification before domain implementation | #20, #21, #22, #29, #30, #32, #62, #63, #67 | PARTIAL: #3 money boundary resolved; remaining policy OPEN |
| D07 | What challenge lifetime, attempts, cooldown, resend replacement and exceptional-proof eligibility/evidence are permitted? | [#3 lifecycle](parcel-lifecycle.md) fixes two physical attempts, hold/RTO/reversal role boundaries; #42 requires keyed verifier, encrypted short-lived resend payload, atomic completion; no staff reveal, no reset-by-resend | #8 / proof policy and #42 / deliveries | Policy in #8; detailed security design before #42 implementation | #24, #42, #43, #45 | OPEN |
| D08 | What identity/session mechanism, secret lifecycle, CSRF/proxy boundaries and data retention/deletion rules meet threats? | #6 owns environment/threat control matrix; #13 auth; #8/#72 privacy. No auth library or statutory retention value accepted here | #6 / security, #13 / auth, #8 and #72 / privacy | Threat decisions in #6; retention policy in #8; mechanics before relevant implementation | #9, #11, #13, #31, #36, #51, #68, #69, #72, #73 | OPEN |
| D09 | What private storage provider/access revocation, quarantine validation, file size/type/malware limits and retention are required? | #31 private upload boundary; no S3 or other vendor commitment; temporary URLs alone do not prove immediate revocation | #31 / attachments with #6 / security | Security requirements in #6; file design before #31 implementation | #31, #42, #69, #72 | OPEN |
| D10 | Which messaging installation/templates/consent rules and actual carrier capabilities/access are verified? | #36/#38 own provider policy; #53 manual/file/API contract; #56/#57 dated carrier access research. Unsupported/uncertain stays explicit | #36/#38 / messaging; #53/#56/#57 / carriers | Before #36/#38 provider behavior; #53 contract before research/adapters; evidence before #60 | #36, #37, #38, #39, #53, #54, #55, #56, #57, #58, #59, #60 | OPEN |
| D11 | What maximum route affected set, lock ordering and contention limit support atomic operational delay application? | #28 allows explicit atomic/resumable contract; this baseline chooses bounded atomic operations plus separately resumable notifications | #28 / routes and #74 / qualification | Bound before #28 implementation; demonstrated load before #74 acceptance | #28, #41, #74 | OPEN |
| D12 | What report date boundaries, issued-snapshot semantics, reconciliation and allowed organization projections are canonical? | [#3](domain-contract.md#money-docket-and-time-invariants) fixes UTC/Asia-Kolkata half-open reporting dates; [hold clock](parcel-lifecycle.md#two-business-day-collection-clock) requires #8/#66 approved operating weekdays/holidays before implementation; #30 immutable receipts; #61–#67 must reconcile source facts and exports | #61 / reporting with #30 / receipts and #66 / settings | Receipt snapshot contract before #30; query definitions before #61–#67 implementation | #30, #61, #62, #63, #64, #65, #66, #67 | OPEN |
| D13 | What hosting region/budget, process sizing, DB/runtime versions, backup recovery and capacity targets are approved? | #5 owns Node/pnpm alignment; #10 DB dependency review; #68/#69/#74 operational targets. Local vendor/capacity suggestions are proposals only | #5 / tooling, #10 / DB, #68/#69/#74 / operations | Toolchain at #5; DB versions before #10; targets before provisioning/qualification | #5, #10, #68, #69, #70, #74, #76 | OPEN |
| D14 | What plans, usage, billing, adoption, support-access, enterprise identity/domain and service commitments are commercially approved? | #77–#83 are M8; pilot has no subscription dependency. [#3 adoption](domain-contract.md#controlled-parent-adoption) resolves dual approval/conflict gates only; execution/history/active-custody migration and other commercial values remain OPEN | #77–#83 / commercial owners | #76 pilot gate first; each M8 contract before its own implementation | #77, #78, #79, #80, #81, #82, #83 | OPEN |

## Explicit downstream gates from Issue #3

- #4/#12/#22: docket wire normalization/global allocator, entity persistence, version/idempotency schemas; no per-tenant docket uniqueness fallback.
- #8/#21/#29/#30: detailed tax precision/allocation, one final collection boundary for multi-parcel/partial collection, negative credit rounding, reversal/receipt reconciliation.
- #8/#42: office-collection proof, resend/exception rules and challenge limits; two physical attempts are not OTP attempt limits.
- #8/#66: approved business weekdays/holidays and calendar ownership before hold expiry; no production Mon–Fri assumption.
- #24: controlled failure subreasons, unapproved post-movement cancellation, expired-hold exceptions, return completion/recall; all denied until reviewed.
- #14/#19/#23/#31/#72: grant mechanics, matching/merge, exact field/attachment projections and privacy controls.
- #79: ownership closure/history, in-flight custody strategy, migration/recovery execution after pilot; dual approval is not data movement.
- Cross-organization custody remains denied under ADR 0003; any future proposal needs a reviewed contract before #24/#53 expose it.

These are downstream implementation/policy gates, not additional prerequisites preventing
the #3 documentary contract. Missing lint (#5) is unavailable, not passed; see [verification](domain-verification.md) for merge-policy limits.

## Resolving a row

The owner links the decision, evidence and affected contracts from its issue/PR. Update
this register's status and link when resolved, or split a row if separate gates become
necessary. Do not close a row because a developer selected an undocumented constant.
Changes to accepted architecture need a superseding ADR; policy details within the existing
boundary belong to their owning issue. Implementation prerequisites still follow the
[issue index](../ISSUE_INDEX.md), including #3 before #4 and #6, and #53/#6 before #56/#57.
