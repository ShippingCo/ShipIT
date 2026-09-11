# Role, action, resource and scope contract

[Architecture index](README.md) · [Domain and custody](domain-contract.md) · [State commands](parcel-lifecycle.md) · [Synthetic assertions](domain-scenarios.md)

Issue #3 / v1, amended by [ADR 0009](../adr/0009-money-tax-proof-and-privacy-policy.md) for Issue #8 W37–W40 and [ADR 0010](../adr/0010-organization-franchise-tenancy.md) for Issue #12 W41. Server-side authorization is authoritative; frontend filters are not
security. This is a closed permission contract, not production RBAC middleware. No role
inherits another role. All seven columns apply independently. Multiple roles require
explicit memberships; org_admin is not a superuser. Future additions require a reviewed
matrix change, not an ad hoc eighth role or a wildcard admin check.

## Reading the matrices

`-` = denied. Every non-dash cell requires current identity, membership, action permission,
resource scope, permitted projection **and** the command's state/preconditions. Scope codes:

| Code | Meaning |
| --- | --- |
| F | Own explicitly selected franchise and own-franchise record; never sibling ownership merely because organization matches |
| C | Same-org current custodial franchise, **only the relevant parcel/shipment projection**, never parent booking/customer traversal |
| A | Current explicit agent assignment to that parcel; unassigned parcels, other agents' assignments and historical assignment browsing denied |
| G | Assigned agent **plus** separately granted `parcel.custody.transfer` from current responsible franchise owner/admin; scoped destination limits apply |
| O | Explicitly declared own-organization cross-franchise read/audit; never unrelated organization |
| V | O with recorded verification purpose and minimum customer fields; no general customer-directory browse |
| S | Authenticated self only; no business scope implied |
| P | Receiving-org adoption-plan approval only; redacted plan, dual-approval process, no pre-migration source customer access |

`F,C` means either scope may apply, with the stricter C shipment projection when using
custody. `F,A` never lets an agent browse all F records: the cell in **their** column
must include A. C may contain required sender/recipient/address/phone/weight/service/
route/payment-for-collection fields but cannot expose directory history. A contains only
recipient name/phone/address/instructions, docket/parcel/status and required collection
amount/status. A never means a whole route/manifest or full customer profile.

An operating franchise owns its routes/lots; a related sibling-owned parcel under C can
appear in its validated manifest. That relationship does not make the sibling's whole
route, booking, customer or financial records visible. Route-level origin/destination
information for a relevant shipment remains within C; no global routing browse is granted.

## Private resource reads: list and detail

Each row explicitly grants **both scoped list and scoped detail/read**, with the same
projection restriction. List counts, search, docket lookup, nested references, aggregates,
attachments and pagination must enforce the same scope before returning results. A list
never loads all rows and relies on frontend filtering. No read permission implies export.
The rows cover every private concept in #2's module/data ownership table.

| ID | Resource / list and detail projection | org_admin | franchise_admin | operator | dispatcher | delivery_agent | accountant | read_only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | Organization safe business profile | O | F | F | F | - | F | F |
| R02 | Franchise/location safe profile | O | F | F | F | A | F | F |
| R03 | User/session safe self view; no secrets/session tokens | S | S | S | S | S | S | S |
| R04 | Membership/invitation safe roster and grant audit | O | F | - | - | - | - | - |
| R05 | Customer profile/directory and owned relationship history | V | F | F | - | - | - | - |
| R06 | Booking commercial detail, necessary customer snapshot | O | F | F | F | - | - | F |
| R07 | Parcel lifecycle, ETA, safe timeline, shipment parties | O | F,C | F,C | F,C | A | - | F,C |
| R08 | Lot and parcel membership; agent only their parcel's lot label | O | F | F | F | A | - | F |
| R09 | Route/manifest/events/delay; agent only assigned stop/route snippet | O | F | F | F | A | - | F |
| R10 | Delivery assignment/attempt and safe proof outcome | O | F,C | F,C | F,C | A | - | F,C |
| R11 | Payment obligation/ledger reconciliation projection | O | F | - | - | - | F | - |
| R12 | Shipment collection amount/status only when collection needed | O | F,C | F,C | F,C | A | F | - |
| R13 | Issued receipt; minimal finance artifact, no unrelated history | O | F | F | - | - | F | - |
| R14 | Shipment operational attachment/proof metadata and approved bytes | O | F,C | F,C | F,C | A | - | - |
| R15 | E-way record/provenance; finance gets required statutory subset | O | F | F | F | - | F | - |
| R16 | Notification/consent safe status; required shipment context only for C/A | O | F,C | F,C | F,C | A | - | - |
| R17 | Provider attempt/callback normalized outcome; no raw payload | O | F | F | F | - | - | - |
| R18 | Outbox/job sanitized operational health/audit, no raw event bodies | O | F | - | - | - | - | - |
| R19 | Carrier observation/reference/import provenance | O | F,C | F,C | F,C | A | - | F,C |
| R20 | Settings safe effective business preferences | O | F | F | F | - | F | F |
| R21 | Pricing/tax effective quote or approved policy view | O | F | F | F | - | F | - |
| R22 | Pickup/escalation/conversation minimum service context | O | F | F | - | - | - | - |
| R23 | Operations/booking reports with permitted booking fields | O | F | F | F | - | - | F |
| R24 | Customer/contact report (directory permission required) | V | F | F | - | - | - | - |
| R25 | Financial/GST report and reconciliation artifact | O | F | - | - | - | F | - |
| R26 | Delivery/route report; own assignments only for agent | O | F | F | F | A | - | F |
| R27 | Messaging/assistant safe aggregate report | O | F | - | - | - | - | - |
| R28 | Immutable audit, sanitized references and authorized drill-through | O | F | - | - | - | F | - |
| R29 | Private installations/credential configuration safe metadata only | O | F | - | - | - | - | - |
| R30 | Adoption plan / conflict summary | P | F | - | - | - | - | - |

Projection qualifiers are mandatory:

- org_admin has declared organization reads/audit in these rows only. Customer details
  require verification purpose (V); audit does not dump raw conversations, proof bytes,
  secret configuration or unnecessary PII. R14 grants metadata/review outcome only for
  org_admin; sensitive attachment byte review requires a later explicit #6/#31 permission.
- Accountant R01/R02/R13/R15/R20/R21/R25/R28 is **finance-only/minimum-data**: invoicing
  identity/GST identifiers, amounts and reconciliation references. Phone/address is denied
  unless a specific financial artifact genuinely requires the minimum value. R28 permits
  financial audit facts only. No unrestricted customer, operational or delivery history.
- read_only R06/R07 sees basic customer details necessary to understand that booking or
  shipment, not an unrestricted directory or financial/GST totals. C access still means
  only the custodial shipment. Ordinary price/collection/financial fields are suppressed.
- R14 bytes require an independently authorized attachment purpose/category, current scope
  and passed validation/quarantine. Agent gets required assigned delivery instructions/proof
  workflow only. A booking attachment not classified for that purpose remains denied.
- No role reads OTPs, verifiers, tokens, installation secrets, raw sensitive provider events
  or other users' sessions. Safe metadata rows do not grant underlying secrets.

## Private exports

Export is a separate permission covering bulk files, report downloads and background export
jobs. Authorization is rechecked at scheduling, execution and download; creating a job or
knowing a URL cannot preserve revoked scope. No C/A grant permits exporting sibling data.
Authorized retrieval of one existing receipt/attachment under its own read rule is distinct
from a bulk export, and cannot be looped through an unscoped directory.

| ID | Export category | org_admin | franchise_admin | operator | dispatcher | delivery_agent | accountant | read_only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| E01 | Operations / booking export | - | F | - | - | - | - | - |
| E02 | Customer / contact export | - | F | - | - | - | - | - |
| E03 | Financial / GST export | - | F | - | - | - | F | - |
| E04 | Delivery / route export | - | F | - | - | - | - | - |

All other private resource exports (raw audit/outbox/messages/provider payload/credentials,
configuration, staff lists, imports) are denied unless an approved category explicitly
includes a safe own-franchise projection. No cross-franchise org_admin export privilege.

## Commands, transitions, jobs and configuration

These are action ceilings: allowed cells still require the owning domain's reviewed
policy. Sensitive actions with unresolved proof/finance/import policy stay disabled until
that policy exists. No blanket local-administrator permission bypasses the lifecycle.

| ID | Action / resource / action class | org_admin | franchise_admin | operator | dispatcher | delivery_agent | accountant | read_only |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W01 | Booking + initial parcels create, ordinary pre-movement input edit | - | F | F | F | - | - | - |
| W02 | Whole Booking cancel with all-child historical movement guard | - | F | F | F | - | - | - |
| W03 | Customer create/edit own relationship; never merge across scope | - | F | F | - | - | - | - |
| W04 | Lot create/edit and parcel membership assignment/removal | - | F | F | F | - | - | - |
| W05 | Route create/edit and validated lot/parcel assignment | - | F | F | F | - | - | - |
| W06 | Lot/route destructive removal | - | F | - | - | - | - | - |
| W07 | Parcel initial check-in T02 | - | - | F | - | - | - | - |
| W08 | Parcel dispatch T03 | - | F,C | F,C | F,C | - | - | - |
| W09 | Parcel transit T04 | - | - | - | F,C | - | - | - |
| W10 | Start/retry delivery T05/T08; assign delivery or office-collection agent | - | - | - | F,C | - | - | - |
| W11 | Complete delivery/office collection T06/T10 | - | - | - | - | A | - | - |
| W12 | Failed delivery with reason T07 | - | - | - | - | A | - | - |
| W13 | Office collection intake T09 | - | - | F,C | - | - | - | - |
| W14 | Approve RTO T11/T12 | - | F,C | - | - | - | - | - |
| W15 | Delivered reversal T13 | - | F | - | - | - | - | - |
| W16 | Independent custody transfer | - | C | - | - | G | - | - |
| W17 | Grant/revoke agent custody-transfer capability | - | F | - | - | - | - | - |
| W18 | Typed route event/delay and coordinated ETA command | - | F | F | F | - | - | - |
| W19 | Authorized route-delay reminder job | - | F | F | F | - | - | - |
| W20 | Payment collection command; approved finance contract required | - | F | - | - | - | - | - |
| W21 | Financial reversal/adjustment command; approved finance contract required | - | F | - | - | - | - | - |
| W22 | Shipment attachment upload/metadata edit with validation | - | F,C | F,C | - | A | - | - |
| W23 | E-way externally issued record create/edit with provenance | - | F | F | - | - | - | - |
| W24 | Safe local messaging preferences/configuration | - | F | - | - | - | - | - |
| W25 | Controlled notification retry/reconciliation job | - | F | - | - | - | - | - |
| W26 | Carrier manual reference/import job; reviewed mapping only | - | F | - | - | - | - | - |
| W27 | Effective local pricing/tax configuration with approved policy | - | F | - | - | - | - | - |
| W28 | Pickup acceptance / escalation handling / authorized service reply | - | F | F | - | - | - | - |
| W29 | Franchise profile and local settings configuration | - | F | - | - | - | - | - |
| W30 | Local memberships/invites/grants create/revoke | - | F | - | - | - | - | - |
| W31 | Self profile/session revoke | S | S | S | S | S | S | - |
| W32 | Adoption franchise-side approval / conflict resolution proposal | - | F | - | - | - | - | - |
| W33 | Receiving-organization adoption approval only | P | - | - | - | - | - | - |
| W34 | Customer delete/merge, consent override, raw ledger/receipt/audit edit, arbitrary outbox redrive, direct org ownership edit | - | - | - | - | - | - | - |
| W35 | Organization configuration or org-wide membership escalation | - | - | - | - | - | - | - |
| W36 | Export generation job | - | F | - | - | - | F | - |
| W37 | Resolve draft tax jurisdiction using approved rule/evidence | - | F | - | - | - | - | - |
| W38 | Delivery challenge resend/replacement request under proof policy | - | - | - | - | A | - | - |
| W39 | Exceptional delivery proof request with evidence | - | - | - | - | A | - | - |
| W40 | Independently approve exceptional proof; current responsible custody required | - | F,C | - | - | - | - | - |
| W41 | Franchise lifecycle disable/reactivate with explicit target grant | F | F | - | - | - | - | - |
| W42 | Organization memberships/invites/grants create/revoke with no-self and final-admin guards | O | - | - | - | - | - | - |

W36 is only scheduling an E01–E04-authorized export; accountant is limited to E03. W06
requires empty/unexecuted entities and immutable history preservation; physical movement
or referenced records block deletion; #26/#27 finalize archival mechanics. W18 permits
route event recording but any parcel state effect must meet W08/W09/W10 and lifecycle
actor restrictions in the same command; reporting a departure is not a transit bypass.
W17/W30 cannot self-escalate into org scope or grant absent permissions. W42 is the narrow
org_admin administration exception to broad W35 denial: it changes only memberships and
invitations, never Organization configuration; it cannot alter the actor's own membership
or remove the final active org_admin. W31 intentionally
gives read_only no mutation API in this private-domain matrix; authentication sign-out
and mandatory session expiry remain #13's identity behavior, not operational write grants.

W10 also permits a dispatcher to create/revoke a current office-collection assignment
without changing held_at_office or starting a doorstep attempt; the agent still needs T10
proof and deadline eligibility. Assignment cannot forge physical receipt or extend a hold.

W20/W21 do not silently settle payment from delivery. Accountant and agent **visibility**
of collection facts is not an unapproved collection-command grant. #8/#29 must explicitly
review any additional cashier/agent collection permissions before implementation. W22's
agent scope allows only their assigned proof upload, never booking-wide attachment edit.
W24 cannot override customer consent or reveal secrets; W25 cannot blindly resend uncertain
provider acceptance; W26 cannot import a foreign tenant or assert delivered/paid state.
W28 cannot cancel/dispatch indirectly; service tools must authorize the underlying command.

## Complete action classification and denied defaults

For **every R01–R30 resource**, action classes are: list; detail/read; export; create;
mutate/edit; cancel/destructive; state transition; operational job; custody transfer;
configuration. Reads are exhaustively R01–R30, exports E01–E04, and permitted staff commands
W01–W42. **Every other resource/action/role combination is explicitly denied.** Thus no
missing mutation column implies a future permission. This includes private reports (read
sources, never mutate them), issued receipts (no direct create/edit; owning transaction),
audit/outbox/proof internals (owner-service append only), and organization-wide config
(no org_admin implicit write). Exact new command permissions must amend this matrix.

Onboarding #17 is an authenticated, idempotent coordinator creating Organization/Franchise/
owner membership after validating signup; no pre-existing role grants itself arbitrary
organization access. Likewise producer-owned internal audit/outbox/receipt/challenge
writes and verified callbacks use narrowly declared service authority, not a fictitious
staff role. Background workers process trusted source scopes and cannot promote a denied
staff intent. #4/#16/#35 define those internal interfaces; no new job infrastructure here.
Issue #12 supplies the internal Organization/initial-Franchise bootstrap and bounded
Organization administration described below. Ordinary member Organization creation,
destruction or administration, and privacy deletion/merge (#19/#72), still require their
own reviewed command policies. Internal capabilities are not additional staff grants.

## Scope and error decisions

| Situation | Expected server behavior |
| --- | --- |
| Missing/invalid authentication | 401; no private result |
| Authenticated, absent/revoked organization/franchise membership | Fail closed; object request uniform 404 if existence is not authorized; private collection/action endpoint 403 |
| Own-franchise allowed role/action/resource | Permit only declared projection and preconditions |
| Sibling-franchise ID/docket without explicit O/V/C/A grant | Uniform 404, indistinguishable from unknown ID; scoped list excludes rows/counts |
| org_admin of A reads A1/A2 | Only declared O/V rows; 403 for a denied action on visible record |
| Any role of A requests B1 or its globally unique docket | Uniform 404; same carrier, phone, supplied tenant ID or route destination does not grant access |
| Custodial A2 reads A1 parcel | R07 C operational projection; full parent booking/customer/history remain 404 |
| Delivery agent requests assigned parcel | R07 A minimum delivery projection; reassignment revokes access |
| Agent requests unassigned parcel | Uniform 404 even if another agent at same franchise has it |
| Visible resource, denied command/export (e.g. read_only mutation) | 403; no successful audit/outbox/state effect |
| Authorized action, stale version/invalid state or reused key with changed body | 409 per ADR 0004; no partial business effect |

Object visibility and field visibility are independent. A known booking does not reveal
all child IDs; a known parcel does not authorize its customer's ID. Unknown and foreign
objects share response shape/status; #6/#15 verify timing/search/count/cache leakage too.
Reauthorize nested resources, export execution/download, attachments, retries and jobs.

## Issue 8 policy refinements

[Money/tax/proof/privacy contract](money-tax-proof-privacy-contract.md) governs W27 and W37–W40.
W37 resolves only own-franchise draft facts against approved tax evidence, never arbitrary
rate overrides. W38 preserves expiry, lineage failure and resend budgets; no secret retrieval.
W39 does not complete delivery. W40 requires current responsible franchise/custody, independent
approver identity, evidence and unchanged assignment/attempt versions; an owning franchise
without current responsibility cannot approve remote custody. W11 still owns agent completion
under T06/T10. None of these actions settles payment. W34 remains denied: #72 must review
privacy deletion/hold actions before implementing them. Safe reads never expose secret material.

## Issue 12 tenancy administration amendment

W41 is the exact `franchise.lifecycle.manage` action. Its F cell means an explicitly
approved target franchise within the actor's own organization, resolved by the trusted
authorization seam. An org_admin needs a current, explicit W41 grant for that franchise;
the O read scope or the role name alone does not grant lifecycle administration. A
franchise_admin is limited to their own approved F. Neither cell grants sibling access
to ordinary franchise staff or any access to another organization. Grant storage,
membership revalidation and revocation remain #14; Issue #12 tests inject trusted
synthetic approvals and do not implement those mechanisms.

The two permitted transitions are `active` → `disabled` and `disabled` → `active`.
Each requires the current `expected_version`, the exact action grant and respectively
`administrative_disable` or `administrative_reactivate` as a controlled reason code.
The audit seam receives actor/reference, trusted ownership, old/new state,
expected/committed version, reason, UTC time and correlation reference as evidence.
No free-form request body, business name or personal information belongs in the fact.
A same-state request with a current, accepted `expected_version` is a no-op: it changes
no version or timestamp and produces no successful lifecycle-change fact. A stale
accepted version conflicts even for a same-state request. The Issue #12 storage ceiling
and accepted version range are documented in the domain/API contracts. Reactivation restores lifecycle eligibility only; it
does not restore revoked grants, create memberships or authorize operational commands.

The org_admin grant lets the organization explicitly delegate stopping/recovering a
location without granting operations. The franchise_admin grant lets a standalone
shop stop/recover its own location. W41 grants no booking operations, customer or
payment access, exports, membership escalation, organization configuration, franchise
creation, adoption/reparenting or cross-organization access. W34 and W35 remain entirely
denied. W29 remains franchise_admin F only: Issue #12 implements an explicit
`franchise.profile.update` display-name command with `expected_version` and the safe
audit reason `profile_correction`; both its target Franchise and parent Organization
must be active. W29 cannot mutate lifecycle, ownership or the stable franchise code,
and it does not activate downstream settings configuration. W41 recovery can operate
while either root is disabled; reactivating a Franchise under a disabled Organization
still leaves operational writes blocked until approved internal Organization recovery.

The read seam actions are `organization.profile.read` (R01),
`franchise.profile.read` and `franchise.profile.list` (R02). Their existing role/scope
and projection restrictions remain mandatory, including finance-minimum and assigned
location limits. Approved list scope is server-owned and enters the SQL predicate;
client `organization_id`, franchise sets and role claims cannot widen it. Disabled
roots remain readable under current approved scope, with the same safe DTO projection.

Organization creation, atomic Organization + initial Franchise bootstrap, additional
Franchise creation, and bounded Organization profile/lifecycle administration are
internal domain capabilities for future coordinators. They require explicitly injected
service authority with an actor reference, never a staff role or browser claim. They
create no identity/membership and expose no generic public onboarding. W35 grants none
of these. Normal production HTTP composition registers no private tenancy routes before
#13/#14; #17 owns authenticated onboarding and its idempotent membership transaction.
Issue #16 replaces the Issue #12 post-commit notification with mandatory durable
audit insertion in the business transaction. Its [audit contract](audit-contract.md)
defines the R28 administrative projection without adding financial permissions, roles,
exports or global identity browsing. No post-commit success-audit gap remains.
