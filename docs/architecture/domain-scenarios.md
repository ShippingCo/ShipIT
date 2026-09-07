# Synthetic domain and authorization scenarios

[Architecture index](README.md) · [Authorization](authorization-contract.md) · [Lifecycle](parcel-lifecycle.md) · [Verification](domain-verification.md)

All data below and in the [machine-readable fixture](fixtures/domain-contract.json) is fictional.
UUIDs are guessed test identifiers; SYN-SHIPIT dockets are not a proposed production format.
These are documented expected decisions and a synthetic contract model, not HTTP/API tests.

## Two organizations, three franchises

| Entity | Synthetic UUID | Relationship |
| --- | --- | --- |
| Org A | `00000000-0000-4000-8000-000000000001` | Independent tenant |
| Org B | `00000000-0000-4000-8000-000000000002` | Independent tenant |
| Franchise A1 | `00000000-0000-4000-8000-000000000011` | Org A |
| Franchise A2 | `00000000-0000-4000-8000-000000000012` | Org A |
| Franchise B1 | `00000000-0000-4000-8000-000000000021` | Org B |

A1 Booking bk1 has two parcels p1/p2; p1 is currently in A2 custody and assigned to
agent2, while p2 stays at A1. B1 is independently enrolled within Org B. c1/c2 are
separate franchise-owned fictional customer relationships, even if the person were the
same. No actual names, phone numbers, delivery addresses or production records are needed.

| Resource | UUID | Owner / docket |
| --- | --- | --- |
| bk1 (booking) | `00000000-0000-4000-8000-000000000101` | A/A1 |
| bk2 (booking) | `00000000-0000-4000-8000-000000000102` | A/A2 |
| bkb (booking) | `00000000-0000-4000-8000-000000000103` | B/B1 |
| c1 (customer) | `00000000-0000-4000-8000-000000000201` | A/A1 |
| c2 (customer) | `00000000-0000-4000-8000-000000000202` | A/A2 |
| p1 (parcel) | `00000000-0000-4000-8000-000000000301` | A/A1 / `SYN-SHIPIT-000001` |
| p2 (parcel) | `00000000-0000-4000-8000-000000000302` | A/A1 / `SYN-SHIPIT-000002` |
| pb (parcel) | `00000000-0000-4000-8000-000000000303` | B/B1 / `SYN-SHIPIT-000003` |
| finance1 (finance) | `00000000-0000-4000-8000-000000000401` | A/A1 |

## Access decisions

Status 200 means the fixture expects a permitted command/projection after its other
preconditions; it is not a promise about final endpoint status codes. 401/403/404 preserve
the approved error contract. Denials expose no projection and create no business effect.

| Case | Request | Rule | Expected HTTP semantics / projection |
| --- | --- | --- | --- |
| C01 | A1 operator searches unrelated A2 booking | R06 | 404 / none |
| C02 | A1 operator guesses B1 booking UUID | R06 | 404 / none |
| C03 | Org A admin reads A1 booking | R06 | 200 / organization_audit |
| C04 | Org A admin reads A2 customer for verification | R05 | 200 / verification |
| C05 | Org A admin cancels visible A2 booking | W02 | 403 / none |
| C06 | A2 operator processes A1-owned parcel in custody | R07 | 200 / shipment |
| C07 | A2 tries A1 customer history via custodial parcel | R05 | 404 / none |
| C08 | Agent reads currently assigned parcel | R07 | 200 / delivery |
| C09 | Agent guesses unassigned parcel at same org | R07 | 404 / none |
| C10 | Accountant exports own GST report | E03 | 200 / finance |
| C11 | Accountant attempts customer export through known own franchise report endpoint | E02 | 403 / none |
| C12 | read_only edits visible own booking | W01 | 403 / none |
| C13 | Valid foreign globally unique docket does not grant access | R07 | 404 / none |
| C14 | Unauthenticated known docket lookup | R07 | 401 / none |
| C15 | Revoked membership cannot read own booking | R06 | 404 / none |
| C16 | Unknown UUID matches foreign denial | R06 | 404 / none |
| C17 | Agent attempts handover without grant | W16 | 403 / none |
| C18 | Agent attempts scoped handover with explicit grant | W16 | 200 / command |
| C19 | Org admin cannot export own-org booking records | E01 | 403 / none |
| C20 | Org admin cannot read B1 despite admin title | R06 | 404 / none |
| C21 | read_only reads own booking basic details | R06 | 200 / basic_booking |
| C22 | Custody of one child does not reveal other child | R07 | 404 / none |
| C23 | Custody does not unlock parent commercial booking | R06 | 404 / none |
| C24 | Franchise admin exports own operations | E01 | 200 / own_franchise |
| C25 | Accountant cannot dispatch parcel | W08 | 404 / none |
| C26 | Org admin edits visible sibling booking | W01 | 403 / none |
| C27 | Org admin customer browse without verification purpose | R05 | 404 / none |
| C28 | read_only views custodial parcel with basic operational projection | R07 | 200 / basic_shipment |

C11 targets a known own-franchise export endpoint, hence 403. Guessing an inaccessible
customer object instead would return 404. C25 similarly returns 404 because the accountant
cannot know the operational parcel projection. C17/C18 differ only by the explicit grant;
the actual transfer also needs destination/receipt/version guards. C06 and C22/C23 together
prove that custody of one parcel does not reveal siblings or the parent commercial record.

## State, money and date tabletop checks

| Case | Input / operation | Expected evidence |
| --- | --- | --- |
| B01 | Booking children booked + checked_in, never moved | Own permitted role can cancel atomically; no parcel deletion/state invention |
| B02 | One child booked, another in_transit | Whole-booking cancellation rejected; travelling parcel unchanged |
| B03 | Corrected current state appears checked_in but history moved | Cancellation rejected using historical movement, not current-state shortcut |
| L01 | Walk T01/T02/T03/T04/T05/T07, then T08/T07 | Two started/two failed attempts; duplicate failure command cannot increment; no third attempt |
| L02 | One failure customer_requests_pickup, authorized receipt T09 | held_at_office; window starts on office receipt, counts preserved |
| L03 | Two failures, collection-path reason | T11 denied; T09 window then approved T12, or T10 collection before deadline |
| L04 | Two retry-path failures, admin absent | RTO eligible but not approved; no automatic transition |
| L05 | Office collection after two failed attempts | T10 requires assigned agent/proof; does not create third doorstep attempt |
| L06 | Delivered correction without office recovery evidence | T13 rejected; original delivery/proof/payment history retained |
| L07 | Valid T13 with recovered parcel and admin reason | Append correction + reconciliation reference, hold state; retain original delivered event and ledger |
| L08 | Provider outage after successful delivery commit | Delivery stays committed; notification retry never changes payment or parcel |
| H01 | Friday intake, synthetic Mon–Fri/no-holiday calendar | Deadline 2026-09-15T18:30:00Z; one second before: collection eligible; at deadline: only RTO eligibility, still needs admin |
| H02 | Same intake, synthetic Monday holiday | Deadline 2026-09-16T18:30:00Z; no unapproved production calendar assumption |
| H03 | Missing approved calendar | Automatic expiry/RTO eligibility blocked, not an assumed weekend rule |
| INR | 12549 / 12550 / 12551 paise | 12500 / 12600 / 12600 final; −49 / +50 / +49 adjustments; tax components untouched |
| TZ | 2026-09-07 IST reporting day | UTC half-open [2026-09-06T18:30:00Z, 2026-09-07T18:30:00Z); midnight belongs to next day |

L01–L08 are manual contract walkthroughs against the complete transition guards, not
a claim of runtime transition/idempotency tests. The validator checks the closed edges,
approved actor sets, fixture matrix decisions, money/date, cancellation and migration
predicates. Later production tests must prove persistence/concurrency and exact projections.

## Parent adoption tabletop

B1 proposes joining Org A. Inspect imported alias `LEGACY-EXAMPLE-17` duplicated in an
import, and a separate customer ownership conflict; do not fabricate native docket
collisions. Receiving reviewers get only the redacted conflict report before adoption.

| Case | Evidence | Expected |
| --- | --- | --- |
| M01 | B1 approval only | Block; Org A approval also required |
| M02 | Both approve, unresolved imported docket alias | Block; document source/alias resolution before approving execution |
| M03 | Both approve, unresolved customer ownership conflict | Block; no automatic merge/directory share |
| M04 | Both approved old plan, inventory changes | Block; re-scan and renew both approvals |
| M05 | Both approve same reviewed conflict-free plan | Eligible for #79 controlled migration, not proof data has moved |

Future executor verifies complete ownership closure, snapshots, membership revocation,
active custody, consent/retention and reconciliation; abort/recover through its reviewed
plan on mismatch. Commercial data movement remains entirely outside #3.

## Fictional audit example

```json
{
  "actor_id": "00000000-0000-4000-8000-000000000518",
  "action": "parcel.custody.transferred",
  "resource_id": "00000000-0000-4000-8000-000000000301",
  "recorded_at_utc": "2026-09-07T10:00:00Z",
  "owning_scope": "A/A1",
  "acting_scope": "A/A2",
  "previous_custody_ref": "synthetic-agent2",
  "new_custody_ref": "synthetic-A2-office",
  "reason_code": "customer_requests_pickup",
  "permission_evidence_ref": "synthetic-grant-v1",
  "receipt_evidence_ref": "synthetic-handover-1",
  "command_ref": "synthetic-command-1",
  "previous_version": 7,
  "new_version": 8
}
```

Cancellation, RTO and reversal use the same required actor/resource/UTC/scope fields,
with their reason, prior/new state and evidence references; reversal additionally links
the preserved delivery fact and reconciliation obligation. Adoption records both approvers,
old/new scopes, plan version and each conflict resolution. No raw PII, proof or secrets.
