# Money, tax, delivery proof and privacy contract

[Architecture](README.md) · [ADR 0009](../adr/0009-money-tax-proof-and-privacy-policy.md) · [Sources](policy-sources.md) · [Verification](issue-8-verification.md) · [Fixtures](fixtures/money-tax-proof-privacy.json)

Version: Issue #8 / v1. Documentary policy accepted through reviewed PR merge; no legal
certification or production implementation. [Domain](domain-contract.md),
[authorization](authorization-contract.md), [lifecycle](parcel-lifecycle.md),
[security](security-threat-model.md), and [API/retry](idempotency-contract.md) remain authority.
Prototype store/types/tests are evidence only. This contract adds no database, tax service,
payment gateway, OTP provider, WhatsApp send, government filing or deletion job.

## Money and reconciliation

All charges, tax components, adjustments, goods values and payments are INR integer paise.
Parse decimal user input exactly; reject excess unsupported precision or invalid amounts.
Rates are dimensionless nonnegative integer numerator/positive integer denominator pairs.
Intermediate products and fractional paise use exact integer/rational arithmetic, never
binary floating-point money. #21 must choose checked integer bounds/overflow handling and
#4-compatible wire encoding; a JavaScript number must not silently exceed safe integer range.

For this nonnegative confirmed Booking, all child commercial lines form **one** customer
payable boundary; never round each Parcel or collection installment to rupees.

| Field | Meaning / reconciliation |
| --- | --- |
| `pre_tax_paise` | Sum of approved commercial lines after explicit pricing discounts/surcharges; no tax or final adjustment |
| `taxable_basis_paise` per tax group | The approved subset/basis subject to its rule; exemptions/non-taxable lines are explicit, not an unknown-state substitute |
| `exact_tax` per component | Sum of exact basis × configured rate rational values, grouped under the same booking, policy, jurisdiction and rate rules |
| `tax_components_paise` | Deterministically allocated integer component amounts; sum equals `tax_total_paise` |
| `unrounded_payable_paise` | `pre_tax_paise + tax_total_paise` before whole-rupee customer rounding |
| `rounding_adjustment_paise` | `final_payable_paise - unrounded_payable_paise`; a signed separate field, not hidden in base or tax |
| `final_payable_paise` | `((unrounded_payable_paise + 50) // 100) * 100`, applied exactly once on confirmation |

Tax quantization to paise is distinct from the **single final whole-rupee** adjustment.
For each approved tax group, sum exact component values, round that sum to the nearest
paise (half a paise upward), floor each component to paise, then distribute the remaining
paise by descending fractional remainder. Ties use the policy's stable component identifier
ascending (ASCII), never input order. Preserve exact values and the allocation rule version.
Sum the group totals; do not re-quantize totals or independently round each equal component.
For multiple lines with the same group, sum exact values before allocation. #21 must validate
legally required grouping before production; unsupported combinations block confirmation.
This largest-remainder rule is ShippingCo engineering policy, **not Indian tax law**;
[S01/S02 and sign-off requirements](policy-sources.md) govern statutory validation.

Synthetic arithmetic (TEST rates only, **not legally applicable GST rates**):

| Case | Basis / pre-tax paise | Exact tax components in paise | Allocated components | Tax | Before adjustment | Adjustment | Final |
| --- | --- | --- | --- | --- | --- | --- | --- |
| M01 known intra-state, TEST total 10% | 10101 (₹101.01) | TEST_CGST=10101/20; TEST_SGST=10101/20 | 505 + 505 | 1010 | 11111 | -11 | 11100 |
| M02 odd-paise intra-state, TEST total 5% | 10101 | TEST_CGST=10101/40; TEST_SGST=10101/40 | 253 + 252 | 505 | 10606 | -6 | 10600 |
| M03 known inter-state, TEST total 5% | 10101 | TEST_IGST=10101/20 | 505 | 505 | 10606 | -6 | 10600 |
| M04 approved zero-tax | 10101 | none; explicit TEST_ZERO exemption/config evidence | none | 0 | 10101 | -1 | 10100 |
| M05 unknown jurisdiction, even with zero tax | 10101 | unresolved | no booked snapshot | — | — | — | confirmation blocked |
| M06 whole-rupee boundary | 12549 / 12550 / 12551 | zero tax | none | 0 | same as basis | -49 / +50 / +49 | 12500 / 12600 / 12600 |

M02 rounds total 505.05 paise to 505 paise. Both floors are 252; the one residual paise
goes to TEST_CGST by stable identifier. M01 and M03 also check ordinary classifications.
No production default rate, reverse-charge regime or exemption is inferred from these fixtures.

## Effective configuration and frozen booking

W27 permits **franchise_admin in the owning franchise only** to publish an approved local
pricing/tax version. Approval requires a compliance validation reference, effective interval,
source references and allowed classification/rate catalog; it is not arbitrary tax editing.
The compliance function is accountable for advice/sign-off, not a new application staff role.
org_admin has declared R21 organization reads, without W27 mutation; accountant reads its
minimum finance projection. Custody at a sibling franchise grants no commercial configuration
rights. Overlaps, gaps, unapproved versions or missing evidence block affected confirmations.

Configuration contains `policy_id`, immutable `version`, trusted organization/franchise,
`effective_from_utc` inclusive / `effective_to_utc` exclusive, approval actor/reference/time,
source evidence/version, pricing version, supply-date selection rule, service classification,
recipient registration treatment, jurisdiction/place-of-supply rules, component rate IDs and
exact ratios, exemption/reverse-charge treatment, allocation rule and component tie order.
A confirmation selects the version for the approved tax-point rule, not blindly today's UI
settings; #21 validates time-of-supply law. Pilot unsupported/backdated/change-of-rate cases
remain blocked until that selection policy is approved. Publication is append-only; closing
an interval cannot rewrite a version's historical content. Never edit an old rate in place.

The server authorizes W01 and atomically validates/snapshots at confirmation:

- Booking identity and owning scope; confirmation time and approved supply/tax-point facts.
- Pricing and tax policy IDs/versions, effective interval and source/approval references.
- Resolved supplier and place-of-supply jurisdiction codes, classification (`intra`, `inter`,
  or explicitly supported special class), recipient registration category and rule/evidence
  references. Keep required private facts in protected snapshots, never general audit.
- Commercial lines, tax groups and taxable bases; configured component rate IDs and exact
  ratios; exact tax results, allocation version and allocated components.
- Pre-tax, total tax, unrounded payable, explicit rounding adjustment and final booked amount.

Retries use #4 scoped idempotency and expected versions: identical intent returns the same
committed snapshot after reauthorization. A stale quote/config version requires safe 409
conflict and deliberate requote; no silent price acceptance. Failure commits no confirmed
Booking, tax snapshot, receipt, payment or notification. Correcting issued facts requires a
linked amendment/credit flow, never editing historical snapshots. #22/#30 implement persistence.

M07: confirm fictional `TEST_BOOKING_A` under TEST_A (M02). Publish TEST_B effective tomorrow
with total TEST 10% (M01). New eligible bookings use B; A's entire snapshot remains byte-for-byte
unchanged (505 tax, -6 adjustment, 10600 final). Reports/reprints use A, even if B is later
withdrawn. Cancellation, partial delivery and settings edits never recompute A.

## Unknown jurisdiction and authorized resolution

No city lookup, browser flag, AI inference, missing registration or zero-rate selection may
silently become intra-state. Resolve the relevant **supply** facts under approved rules;
shipping destination alone is not place of supply. Unresolved/unsupported facts yield the
existing safe `VALIDATION_FAILED` 422 envelope with detail
`field=tax.jurisdiction`, `code=REQUIRED` and a controlled resolution-required message; keep an unconfirmed draft, no commercial side effects.
The UI says “Tax jurisdiction needs authorized resolution before confirmation.”

W37 is a narrow amendment: owning franchise_admin may deliberately resolve a draft's missing
facts against an approved rule/evidence reference. It cannot choose an arbitrary tax class,
change another franchise's config or override a law. Record actor, scope, draft/version,
reason code `jurisdiction_evidence_confirmed`, previous unresolved/result references, UTC time,
policy version and safe evidence ID. Private evidence is stored separately. Missing evidence
or unsupported classification remains blocked. Revalidate at confirmation and on retry.

## Delivery challenge policy for Issue 42

A challenge is secret recipient proof, scoped to organization, recipient reference, parcel, physical attempt (or
explicit office-collection session), assigned agent and a versioned lineage. Five wrong entries
are **not five physical attempts**. ADR 0006's maximum two doorstep attempts is unchanged.

| Control | Pilot v1 policy |
| --- | --- |
| Validity | 10 minutes from server issuance; valid only while `now < expires_at`; provider latency never extends it |
| Failure budget | Maximum 5 failed verifications across all versions for one physical delivery attempt; fifth wrong entry locks lineage; no further verification succeeds |
| Resend | W38 assigned-agent request, 60-second cooldown from initial send reservation or latest resend reservation; at most 3 resend messages while active |
| Ordinary resend | Same active challenge/version; no change to expiry, failed count, physical count or original challenge material |
| Replacement | Only for expired challenge or recorded compromise; new version with fresh validity; atomically supersede/invalidate old version, preserve failed count and lineage lock |
| Conservative anti-abuse refinement | Cooldown and 3-resend budget also survive replacement within the same physical attempt; replacement sends consume that budget, so replacing cannot evade it |
| Terminal rejection | Superseded, expired, locked, consumed, foreign, unassigned or wrong-attempt challenges can never complete delivery |
| Consumption | Verify and commit one proof/completion with lifecycle/custody guards atomically; concurrent success/exception/failure permits only one valid outcome |

Issue #42 already requires keyed verifier and encrypted short-lived resend payload; it owns
cryptographic generation, comparison, storage and rate limits. No employee can see/retrieve a
stored plaintext OTP/challenge or verifier. They must never enter staff DTOs, browser state,
logs, general audit, events, timeline, diagnostics or retained support records. Recipient
submission must use the #42 approved secret-handling channel; no browser-persisted challenge
and no staff retrieval endpoint. Any transient transport handling is tightly scoped and redacted.
Only opaque challenge/proof references and approved safe outcomes leave the proof boundary.

Retries reserve one logical message slot atomically and use existing #4/#39 idempotency;
an uncertain provider outcome consumes the reserved slot until reconciliation, never permits
blind extra sends. A transport retry of the same intent is not a new resend. Provider work
checks current challenge state/expiry before sending; stale messages confer no validity.
Foreign/unauthorized requests fail before counter mutation. Reassignment or a recipient change invalidates active
versions; replacement requires current assignment and keeps attempt-lineage budgets. No
replacement after consumption, attempt closure or lockout. Staff cannot reset failures.

Office collection uses T10 and its specifically assigned agent, actual recipient handover and
unexpired collection deadline; apply the same proof controls to its collection session. It
creates no third doorstep attempt. A locked collection lineage needs independent exception
review; a new assignment cannot reset it. #42 must test collection/reversal races. #66 still
owns approved calendar values; absent calendar prevents automatic collection expiry/RTO.

## Exceptional delivery proof

This is a separate privileged proof path, never OTP reveal or a verified flag from a client.
W39 lets the currently assigned delivery_agent request it; W40 lets only the **current
responsible franchise_admin** approve within same-org F/C parcel scope and actual custody.
The approver must be a different actor from the requesting/completing agent even if the agent
holds an admin membership. An owning admin cannot approve remote A2 custody merely via F.
Approval alone does not mark delivered: W11's agent performs T06/T10 against the approved,
unconsumed, version-bound decision and actual handover, atomically recording exceptional proof.

Allowed reason codes: `recipient_channel_unavailable`, `provider_unavailable`,
`challenge_locked_reviewed`. All require actual recipient presence, deliberate independent
review of alternate receipt evidence and confirmed handover. “Customer unavailable” means
no handover: deny exception, use T07 with its physical failure reason or T09 as applicable.
No unattended drop or employee assertion alone is sufficient. Alternate evidence requires a
protected recipient acknowledgement or independently corroborated handover reference; no
unnecessary government ID copies. #31/#42 validate exact attachment category and verification
mechanism before enabling this path. Unavailable approval/evidence means no completion.

The immutable safe result requires proof ID, `proof_method=exceptional`, reason code,
requester/approving actor and approval reference, parcel/attempt (or collection session) ID,
UTC approval/completion timestamps, trusted owning/acting scope, versions and safe evidence ID.
Evidence bytes, full addresses and free-text sensitive narratives stay outside audit/events.
Normal proof records `proof_method=otp_verified`; the distinction is permanent in retained
canonical proof/audit, including after reversals and after permitted evidence-byte deletion.
No raw OTP or verifier accompanies either result. Evidence ID may become a tombstone with
class/reason/deletion time when deletion is lawful; never rewrite exceptional as OTP proof.

Reauthorize and check custody/assignment/attempt versions again at completion. Reassignment,
attempt end, reversal, collection deadline or changed evidence invalidates approval; never
reuse on another parcel/session. Replay returns the same safe result, not a second proof.
A concurrent ordinary completion invalidates the unused exception and vice versa.
Exceptional delivery **does not settle To-Pay, COD or any payment obligation**. W20/#29 must
separately record payment settlement; delivery reversal preserves payment history and creates
an explicit reconciliation obligation. Approval cannot collect cash or issue a refund.

## Field and class retention

No global delete duration. Each future retention entry identifies purpose, exact fields,
owner/scope, legal basis/source, effective policy, trigger, minimum/maximum period, holds,
approver and scheduled review. “Eligible” means all relevant purposes/mandatory periods ended
and no valid hold; it is not immediate deletion of an entire customer graph. A pseudonymous
record remains protected if reidentification is possible. See [current source evidence and
uncertainty](policy-sources.md); numerical statutory rules must be applicability-validated.

| Class | Minimum necessary data / eligibility | Possible narrow hold / retained subset | Implementation |
| --- | --- | --- | --- |
| Customer profile/contact | Remove unused preferences/marketing notes, directory contact/address and profile links when purpose/consent ends and applicable class obligations permit; suppress optional messaging immediately on withdrawal | Active service/dues may need a protected minimum contact channel; statutory records may separately retain required identity. Neither authorizes all profile fields forever | #19/#38/#72 |
| Booking/shipment operational snapshots | Preserve active parcel handover/routing and immutable commercial linkage; minimize/anonymize unnecessary party fields after completion, claims window and applicable periods | Active shipment, unresolved dues/claim or relevant transporter record obligation; retain only necessary shipment facts | #22/#23/#24/#72 |
| Finance/tax/receipts | Preserve issued amounts, tax versions/components, adjustments and required invoice identity until applicable legal period ends; then approved archival destruction/anonymization | Applicable S01 retention, proceedings/investigation, unresolved dues and reconciliation; retain required records, not unrelated profile notes | #21/#29/#30/#62/#72 |
| Delivery proof/evidence | Keep safe proof method, decision/evidence references and handover facts with canonical history; protected evidence bytes eligible when proof/dispute/legal purposes expire | Specific delivery dispute/fraud or applicable processing-record obligation; preserve distinction between exceptional and OTP proof for lifetime of canonical history | #31/#42/#72 |
| OTP/challenge material | Shortest-lived class: no retained plaintext. Destroy verifier and encrypted resend material when consumed, expired, superseded, locked or attempt/session ends; remove resend material earlier once send budget is exhausted if no transport work needs it | Routine support/legal holds preserve safe decision metadata, never extend challenge validity or retain reusable secrets; specific legal conflict escalates before production under ADR amendment rule | #42/#39/#72 |
| Audit/security metadata | Opaque actor/resource/scope IDs, timestamps and safe outcomes; expire under approved security schedule, no unbounded “audit forever” PII | S07 applicability and effective S05 duties; active investigation preserves necessary metadata with a review date | #16/#68/#72/#73 |
| Messaging/provider records | Consent evidence, template/version, safe outcome and provider reference; minimize thread bodies and delivery buffers as purpose ends, subject to applicable record duties | Delivery uncertainty, consent dispute, processor/legal obligation; no raw payload/OTP support archive and no universal provider duration inferred | #36/#38/#39/#44/#72 |
| Attachments | Classify each object by purpose; delete bytes/thumbnails/caches/access links when all legitimate parent purposes and relevant periods end; retain safe tombstone if needed | Proof/finance attachment inherits that specific justified hold; unrelated uploads do not inherit a whole-customer hold | #31/#69/#72 |

Challenge cleanup must cover queues, encrypted buffers and caches as well as primary storage;
terminal validity is immediate even if asynchronous erasure is pending. #42/#72 must specify
and test bounded cleanup completion, backup exclusion or crypto-erasure, and alerts for failures
before production. Safe non-secret attempt/result metadata may outlive secret material. No
hard-coded one-year retention of verifiers is authorized. The compliance owner must validate
ephemeral-secret treatment against S05 before release; unresolved conflict disables that path.

A lawful/operational hold is a versioned case with trusted scope, authorized approving function,
legal/operational basis, specific field/class/resource set, safe reason, created time, expiry or
next-review date and release evidence. Holds cannot be self-granted by an arbitrary employee;
#72 must add reviewed application actions before implementing creation/release/deletion. W34
currently denies staff customer destruction, including franchise_admin and org_admin. The
compliance/project owner is an accountable function, not a hidden permission bypass.

On verified deletion request, #72 inventories the scoped graph and produces a field/class
plan: delete, irreversibly anonymize, retain with basis/end condition, or defer under reviewed
hold. Reauthorize execution; recompute if shipments/dues/holds change. Return a safe explanation
of retained classes and review conditions, never another tenant's existence. Run resumably with
scoped operation identity, per-object checkpoints and audit tombstones; reconcile processors,
exports, replicas and backups (#69), suppress queued messages for an effectively deleted
recipient, and prevent restoration from reactivating deleted data.
These are implementation requirements only. No deletion SLA is invented as law here.

Fictional P01 deletion tabletop: TEST_CUSTOMER_A1 requests deletion with TEST_BOOKING_A1
unsettled and TEST_PARCEL_A1 active. Remove eligible marketing preferences and optional profile
notes; retain minimum operational contact in the active snapshot, unpaid obligation and required
invoice facts with recorded bases. Evidence for TEST_DISPUTE_A1 remains under its scoped hold;
unrelated attachment becomes eligible. Expired challenge secret material is destroyed, safe
proof/security metadata follows its own schedule. Other A2/B1 relationships are untouched and
undisclosed. Later dues settlement/hold release triggers eligibility review, not retroactive
rewriting of the invoice. P02 covers a fully eligible field with no holds; P03 an active hold.

## Scope cases and denied defaults

Fictional organization A has A1/A2; unrelated B has B1. These are contract fixtures, not real
server isolation tests. Frontend visibility is never authorization; every nested reference,
retry, proof attachment and deletion job rechecks current scope on the server.

| Actor / target | Configuration / resolution | Proof | Privacy |
| --- | --- | --- | --- |
| A1 franchise_admin on A1 | W27/W37 permitted only with approved policy/evidence | W40 only if currently responsible with custody, independent actor and evidence | Can read permitted own records; destructive execution denied by W34 pending #72 |
| A1 staff on A2 | No W27/W37, even if parcel is in A1 custody | No proof access without explicit C/A; A1 admin with actual A2-owned parcel custody may approve only that parcel | No sibling profile/deletion access or inference |
| A1 delivery_agent assigned parcel | No configuration | W38/W39 and W11 within assignment; never W40/self-approval or retrieval | No profile deletion or unassigned data |
| A org_admin on A1/A2 | R21 approved own-org view; no W27/W37 | R10 safe outcome and R28 audit only; no W38–W40 or bytes by implication | Declared O/V projections only; no deletion, hold override or cross-franchise customer directory |
| read_only | No mutation | No mutation | No mutation |
| Any A role on B1 | Uniform denied/unavailable | Uniform denied/unavailable | Uniform denied/unavailable; no change or foreign metadata |

## E-way provenance and estimates

#32 records externally issued evidence using W23; storing a reference is not government
filing or verification. External record contract: owning scope, linked shipment, issuing
system, external reference, source-issued/valid-until values where present, captured-at time,
capturing actor, source document/reference and verification status/time. A manually entered
record is `unverified_external`; no official expiry exists unless supported by the source.
Preserve correction/extension provenance and original observation; do not overwrite history.

ShippingCo estimates use separate `estimated_valid_until`, `estimate_policy_version`, inputs,
calculated-at and `provenance=shippingco_estimate`. Display **“ShippingCo estimate — verify
on the government portal”**. Never copy the estimate into `official_valid_until` or label it
“government-issued validity.” Unknown official status stays unknown; official amendments and
extensions require fresh evidence. Reminders may prompt checking, not authorize movement.
E01 fixture keeps an estimate and unknown official validity distinct; E02 models fictional
external evidence with a safe TEST reference, never a real government number. #67 reports
provenance explicitly. The prototype `Date.now() + days` remains demo-only under #7/#18.

## Remaining owners and rollout gates

| Owner | Decision handed off / remaining implementation or policy gate |
| --- | --- |
| #20/#21 | Exact pricing/tax engine, current evidence-backed rates/classifications, grouping, effective selection and statutory output reconciliation; no production rate selected here |
| #22/#30 | Atomic booking snapshots and immutable receipts, safe correction compatibility |
| #29 | Payment ledger/settlement, partial/multi-parcel collection allocation, negative credits/refunds and reversal reconciliation. Final Booking payable fixed here; no installment re-rounding. Unspecified credit/partial flows remain disabled |
| #42 | Secure challenges, lineage counters, fake-clock boundary/race tests, exceptional/office proof and cleanup; no provider/storage implementation here |
| #66 | W27/W29 settings and approved effective-dated operating weekdays/holidays; collection calendar stays unresolved, no Mon–Fri default |
| #72 | Legal applicability validation, field retention/holds permissions and execution, notices/deletion plans, processor/backup erasure with #69 |
| #31/#32/#36/#38/#39/#67/#73 | Evidence storage, external e-way provenance, provider constraints and safe metadata/security controls |

D06 narrows to remaining finance/production tax validation, D07 policy is resolved on acceptance
with #42 implementation gates, and D08 resolves privacy classification/governance only.
Authentication/session/CSRF mechanics remain with #13. No policy-resolved label is evidence
that a production feature is secure or implemented. Review amendments before changing accepted
rules; downstream implementations must demonstrate real tenant, persistence and concurrency tests.
