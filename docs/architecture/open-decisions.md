# Open architecture decisions

[Architecture index](README.md) · [ADR index](../adr/README.md)

The following questions remain explicitly unresolved. Owners are responsible issue/domain
roles, not invented assignees. Each owner must record a reviewed decision and link its
evidence before the named gate. The Blocks column describes decision gates, not edits to
GitHub's dependency graph. Closing #2 alone does not make every listed issue ready.

Existing repository choices and #2's proposed architecture constrain answers; none of these
rows silently accepts a local planning-pack vendor, policy value or legal assumption.
Within this PR, there is no previously accepted numbered ADR to cite as a final default.
ADRs 0001–0005 become the architectural constraints on merge; implementation details below
still require their own decisions. All rows have status **OPEN**.

| ID | Precise question | Current evidence / constraint | Owner | Must resolve before | Blocks issue(s) | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D01 | What are canonical entity/state terms, Booking–Parcel cardinality, docket uniqueness and permitted transitions? | Prototype conflates records; #3 suggests one parcel per booking. Preserve separate conceptual identities, terminal delivered/RTO and ownership distinct from custody | #3 / domain architecture | M0 #3 acceptance, before affected schema design | #4, #12, #19, #22, #24, #79 | OPEN |
| D02 | Which role can perform each list/detail/export/mutate/job/configuration/destructive action and cross-franchise operation? | #3 names seven roles; #14 implements grants. Unspecified grants denied, read_only cannot mutate, unrelated organizations always isolated | #3 / tenancy and #14 / memberships | M0 #3 acceptance, before permission/schema implementation | #6, #12, #14, #15, #17, #42 | OPEN |
| D03 | How are customers normalized/deduplicated and merged within permitted ownership? | Browser phone directory is not production identity; no implicit global or sibling directory. #19 owns normalized scoped records | #3 / ownership and #19 / customers | Ownership rule in #3; matching/merge contract before #19 implementation | #19, #22, #46, #49 | OPEN |
| D04 | What are exact API/error/pagination schemas, event catalog, compatibility rules, stale/gap policy, idempotency fingerprint/scope/retention and expired-key semantics? | ADR 0004 fixes architecture, not final wire fields; #4 owns catalog and ordering | #4 / API and events | M0 #4 acceptance, before contract consumers | #9, #10, #11, #16, #22, #24, #28, #35, #37, #40, #53 | OPEN |
| D05 | What lease duration, retry/backoff bounds, fairness, poison/redrive and consumer deduplication mechanics satisfy durability? | PG outbox required; no broker/library selected. Uncertain provider acceptance must not be blindly resent | #35 / outbox with #39 / messaging | #4 defines invariants; #35 design before worker implementation, #39 before outbound queue | #35, #39, #40, #41, #45 | OPEN |
| D06 | What money rounding, tax jurisdiction/rate authority, collection/reversal and e-way/retention policies are approved? | #8 owns evidence; INR minor units, immutable booking/receipt facts, gross ledger reconciliation; no unknown-city tax fallback or legal-rate endorsement | #8 / money and compliance with #21 / tax and #29 / payments | M0 #8 acceptance; policy verification before domain implementation | #20, #21, #22, #29, #30, #32, #62, #63, #67 | OPEN |
| D07 | What challenge lifetime, attempts, cooldown, resend replacement and exceptional-proof eligibility/evidence are permitted? | #42 requires keyed verifier, encrypted short-lived resend payload, atomic completion; no staff reveal, no reset-by-resend | #8 / proof policy and #42 / deliveries | Policy in #8; detailed security design before #42 implementation | #24, #42, #43, #45 | OPEN |
| D08 | What identity/session mechanism, secret lifecycle, CSRF/proxy boundaries and data retention/deletion rules meet threats? | #6 owns environment/threat control matrix; #13 auth; #8/#72 privacy. No auth library or statutory retention value accepted here | #6 / security, #13 / auth, #8 and #72 / privacy | Threat decisions in #6; retention policy in #8; mechanics before relevant implementation | #9, #11, #13, #31, #36, #51, #68, #69, #72, #73 | OPEN |
| D09 | What private storage provider/access revocation, quarantine validation, file size/type/malware limits and retention are required? | #31 private upload boundary; no S3 or other vendor commitment; temporary URLs alone do not prove immediate revocation | #31 / attachments with #6 / security | Security requirements in #6; file design before #31 implementation | #31, #42, #69, #72 | OPEN |
| D10 | Which messaging installation/templates/consent rules and actual carrier capabilities/access are verified? | #36/#38 own provider policy; #53 manual/file/API contract; #56/#57 dated carrier access research. Unsupported/uncertain stays explicit | #36/#38 / messaging; #53/#56/#57 / carriers | Before #36/#38 provider behavior; #53 contract before research/adapters; evidence before #60 | #36, #37, #38, #39, #53, #54, #55, #56, #57, #58, #59, #60 | OPEN |
| D11 | What maximum route affected set, lock ordering and contention limit support atomic operational delay application? | #28 allows explicit atomic/resumable contract; this baseline chooses bounded atomic operations plus separately resumable notifications | #28 / routes and #74 / qualification | Bound before #28 implementation; demonstrated load before #74 acceptance | #28, #41, #74 | OPEN |
| D12 | What report date boundaries, issued-snapshot semantics, reconciliation and allowed organization projections are canonical? | #3 uses UTC storage/Asia-Kolkata reporting; #30 immutable receipts; #61–#67 must reconcile source facts and exports | #61 / reporting with #30 / receipts and #66 / settings | Receipt snapshot contract before #30; query definitions before #61–#67 implementation | #30, #61, #62, #63, #64, #65, #66, #67 | OPEN |
| D13 | What hosting region/budget, process sizing, DB/runtime versions, backup recovery and capacity targets are approved? | #5 owns Node/pnpm alignment; #10 DB dependency review; #68/#69/#74 operational targets. Local vendor/capacity suggestions are proposals only | #5 / tooling, #10 / DB, #68/#69/#74 / operations | Toolchain at #5; DB versions before #10; targets before provisioning/qualification | #5, #10, #68, #69, #70, #74, #76 | OPEN |
| D14 | What plans, usage, billing, adoption, support-access, enterprise identity/domain and service commitments are commercially approved? | #77–#83 are M8; pilot has no subscription dependency. Exact business/provider values not accepted here | #77–#83 / commercial owners | #76 pilot gate first; each M8 contract before its own implementation | #77, #78, #79, #80, #81, #82, #83 | OPEN |

## Resolving a row

The owner links the decision, evidence and affected contracts from its issue/PR. Update
this register's status and link when resolved, or split a row if separate gates become
necessary. Do not close a row because a developer selected an undocumented constant.
Changes to accepted architecture need a superseding ADR; policy details within the existing
boundary belong to their owning issue. Implementation prerequisites still follow the
[issue index](../ISSUE_INDEX.md), including #3 before #4 and #6, and #53/#6 before #56/#57.
