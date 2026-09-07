# Parcel command and state-transition contract

[Architecture index](README.md) · [Domain](domain-contract.md) · [Role matrix](authorization-contract.md) · [Scenarios](domain-scenarios.md)

Issue #3 / v1. Every state is **parcel-level**. Booking has commercial active/cancelled
eligibility, not a shared child shipment status. This table is the closed set of allowed
status edges; all other edges and generic status setters are denied. It refines the
role placeholders in #2 while preserving server/Deliveries authority and transactions.

## State meanings

| State | Meaning | Terminal meaning |
| --- | --- | --- |
| booked | Commercially created, awaiting initial physical intake | Non-terminal; cancellation eligibility also depends on all children/history |
| checked_in | Initial authorized office/hub intake recorded | Non-terminal; no operational movement yet |
| dispatched | Physical release to authorized movement/manifest recorded | Non-terminal; movement permanently recorded |
| in_transit | Journey underway, including intermediate hub receipt/legs | Non-terminal; subsequent handovers are custody events, not status rewinds |
| out_for_delivery | Current agent assigned for an active physical delivery attempt | Non-terminal; one active attempt only |
| failed_attempt | Current physical delivery attempt ended unsuccessfully with closed reason | Non-terminal; retry, office receipt or approved RTO only |
| held_at_office | Parcel physically received at accountable office for customer collection | Non-terminal; two business-day collection window |
| delivered | Deliveries has accepted proof of doorstep delivery or office collection | Terminal for ordinary forward operations, ETA propagation and active assignment; controlled T13 is the sole exception |
| rto | Approved return-to-origin workflow initiated | Terminal for forward-delivery attempts/ETA, **not proof of physical return completion**; retains return custody; no outgoing status edge in v1 |

Delivered/RTO never means paid. RTO logistics completion/recall and post-movement parcel
cancellation need a separately reviewed #24 contract; no invented returned/cancelled states.

## Common command guarantees

Every row requires authenticated current role **and** scope, valid owning parent, active
Booking, expected parcel/version/custody/attempt state and server-side authorization.
Scope `F` is own-franchise ownership; `C` is current same-org custodial operational scope;
`A` is current assigned agent. Visibility alone does not authorize state changes.
Franchise_admin's local control does not inherit operator/dispatcher/agent-only transitions;
multiple explicitly granted roles may be used, never implicit role inheritance.

For **every** T01–T13: use one stable scoped command key/fingerprint, reauthorize even a
replay, return the committed result for the same intent, reject changed-body/stale-version
conflicts (409), and serialize concurrent commands. Repeat requests do not increment an
attempt, restart a clock, append duplicate audit/outbox facts or collect money again.
State + required custody/assignment/attempt/proof + immutable audit + result + outbox
commit atomically through owning services (ADR 0004). Invalid input/state produces no
successful transition. #4 defines wire/key retention; #24/#42 implement actual DB checks.

`R0` below means no generic reversal: only a named outgoing edge is allowed. `R1` means
only T13 may correct delivery with preserved evidence. Audit labels below are conceptual
facts; #4 owns the final event catalog. All facts include the common audit fields from
[the domain contract](domain-contract.md#immutable-audit-contract).

## Complete transition table

| ID | Command | From | To | Responsible roles | Scope / custody | Preconditions and required reason/evidence | Reversibility / custody result | Immutable audit fact | Customer-safe timeline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | create_booking_with_parcels | none | booked | operator, dispatcher, franchise_admin | F; same-owner Booking and children | Valid customer/commercial input, globally allocated dockets, one or more children; atomic creation | R0; awaiting_intake, no invented possession | parcel.booked with parent and snapshot references | Booking received |
| T02 | check_in | booked | checked_in | operator | F; initial intake office/hub | Physical receipt/scan evidence, intake location, no cancelled parent | R0; initial office/hub custody established | parcel.checked_in with receipt reference | Received at office |
| T03 | dispatch | checked_in | dispatched | operator, dispatcher, franchise_admin | F or C; responsible operating franchise | Physical dispatch evidence, validated route/lot/direct membership, no duplicate active manifest, no cancelled Booking | R0; route_dispatch custody in same responsible franchise; permanent movement fact | parcel.dispatched with manifest and prior custody | Dispatched |
| T04 | begin_transit | dispatched | in_transit | dispatcher | F or C; current authorized route_dispatch | Departure/movement evidence and route version | R0; route responsibility retained; sibling handovers require custody command | parcel.in_transit with cause reference | In transit |
| T05 | start_delivery | in_transit | out_for_delivery | dispatcher | F or C; accountable destination office receipt | Eligible parcel, active member agent accepts assignment/physical handover, no active attempt, attempts_started < 2; Deliveries creates protected challenge | R0; agent custody and assignment; start exactly one attempt | delivery.attempt_started with assignment/challenge references only | Out for delivery |
| T06 | complete_delivery | out_for_delivery | delivered | delivery_agent | A; current agent custody | Active attempt, valid recipient proof accepted by Deliveries in same transaction; record completion evidence; no frontend verified flag | R1; recipient custody, assignment closed, active challenge consumed | delivery.completed with safe proof reference and completed attempt | Delivered |
| T07 | fail_delivery | out_for_delivery | failed_attempt | delivery_agent | A; current agent custody | Active attempt; mandatory closed failure code, safe evidence/reference; end attempt once, increment failed count once | R0; agent remains accountable until handover, active challenge invalidated | delivery.attempt_failed with attempt/reason code | Delivery attempt unsuccessful; safe next step only |
| T08 | retry_delivery | failed_attempt | out_for_delivery | dispatcher | F or C; current responsible franchise | Exactly one completed failed attempt; retry-path reason, remediation/readiness confirmed; agent assignment and actual custody reconciled; no active attempt; fresh protected challenge | R0; second and final delivery attempt starts; preserve first evidence | delivery.retry_started linked to prior failure | Another delivery attempt arranged |
| T09 | receive_for_collection | failed_attempt | held_at_office | operator | C or F at receiving office; authorized physical return handover already recorded | Mandatory failure reason; collection-path reason **or** explicit customer collection request; office receipt evidence; transfer by admin/granted agent if needed | R0; office custody, agent assignment closed, create collection deadline once | parcel.held_at_office with receipt, calendar/version, deadline and cause | Available for collection with safe deadline |
| T10 | complete_office_collection | held_at_office | delivered | delivery_agent | A; specifically assigned collection at current office | Recipient actually collects; before collection deadline; Deliveries accepts approved collection proof; no prior RTO; closed/no competing delivery attempt | R1; recipient custody; assignment closed; collection is not a third doorstep attempt | delivery.collected with proof reference | Collected at office |
| T11 | approve_rto_after_attempts | failed_attempt | rto | franchise_admin | F or C; current responsible franchise | Exactly two failed physical attempts; retry-path reason, no pending collection request; mandatory admin reason/approval and accountable return custody plan | R0; retain current accountable holder until approved handover, invalidate challenges/forward assignments | parcel.rto_approved with both attempt references | Return to sender initiated |
| T12 | approve_rto_after_collection_window | held_at_office | rto | franchise_admin | F or C; current office custody | Collection deadline reached, no successful concurrent collection; mandatory admin reason/approval, hold evidence and return plan; may have fewer than two failures | R0; office/return custody persists, challenges/collection assignment closed | parcel.rto_approved with deadline evidence | Collection window ended; return initiated |
| T13 | reverse_delivered | delivered | held_at_office | franchise_admin | F; owning franchise admin, verified same-org receiving office | Mandatory correction reason, original delivery fact and safe evidence; physical parcel located/recovered into accountable office with receipt; no intervening incompatible operation; #8/#29 reconciliation reference | R0; office custody, fresh correction hold deadline, no attempt-count reset; previous proof stays historical/consumed | delivery.reversed linked to original event, actor, UTC time and reconciliation obligation | Delivery record corrected; available for collection |

All transitions use the common retry/audit guarantee and terminal meaning above. No
same-state call may be used to replay a new effect. Authorized ETA/delay, physical hub
receipt, route-leg change, assignment-only change, custody transfer and approved challenge
resend are **typed non-status commands**: they preserve lifecycle unless a named edge
applies, preserve attempt/hold counters, and append their own cause-linked audit facts.
No `in_transit → checked_in` rewind or `dispatched → delivered` shortcut. Local delivery
still records real intake/dispatch/movement before T05; it must not fabricate carrier legs.
RTO return logistics can record custody without re-entering forward status states.

## Failure reason and path contract

Closed canonical codes below replace prototype free-text inference. Store a safe category
and optional protected operational note/evidence; never place raw notes in customer messages.
A reason is required even on the second failure. OTP wrong-code/lockout is not automatically
a physical delivery failure; a real attempt and its outcome must be recorded separately.

| Code | Prototype mapping / meaning | Primary path after failure |
| --- | --- | --- |
| customer_unavailable | Customer not available; Shop/office closed | Retry after confirmed availability if only one failed attempt; after second, T11 eligible |
| customer_requests_pickup | New: explicit customer request for office collection | T09; no further doorstep attempt while that request stands |
| address_issue | Address not found | Retry only after validated correction/readiness; after second, T11 eligible |
| recipient_refusal | Customer refused delivery | Conservative collection/office review T09; no automatic immediate RTO |
| payment_not_collected | Cash not ready (To Pay) | Retry after collection readiness if one failed attempt; after second, T11 eligible; ledger remains unchanged |
| operational_issue | New: controlled operational impediment | Retry after remediation if one failed attempt; after second, T11 eligible |
| other_controlled | New: required controlled subreason/review evidence | Office review T09; no free-text-derived retry or immediate RTO; #24 reviews subreason catalog before implementation |

A later explicit pickup request moves a retry-path failure to T09; it does not reset
counts. A collection-path second failure goes through T09 and its complete collection
window, **not** T11. Collection may occur after two failed attempts and does not create a
third delivery attempt. v1 has no held_at_office → out_for_delivery edge; changing a
pickup request into a renewed doorstep service needs a reviewed #24 policy. A failed
attempt awaiting remediation remains failed_attempt; no automatic timer converts it to
RTO. Inability to contact/correct after only one failure needs #24's reviewed policy,
not an invented third path. These boundaries keep the approved paths deterministic.

`attempts_started` counts distinct T05/T08 physical delivery attempts (maximum 2).
`failed_attempt_count` counts those ended by T07. Delivery completion closes an attempt;
resend, wrong OTP, custody handover, office receipt/collection and reversal do not increment
or erase either count. A terminal correction cannot buy another delivery attempt.

## Two-business-day collection clock

T09 (or controlled T13 correction) records `held_at_utc`, responsible office, business
calendar/version and `collection_deadline_utc` once. Count the **next two open business
dates after the intake business date**, then expire at midnight immediately following
the second date in Asia/Kolkata. Collection is allowed while `now < deadline`; RTO
eligibility starts at `now >= deadline` and still requires franchise_admin approval.
This explicit conservative interpretation gives two complete business dates regardless
of intake hour; it is not a 48-hour or prototype 72-hour timeout.

#8/#66 must ratify operating weekdays, holidays and calendar ownership before the clock
is implemented. Missing approved calendar fails closed for automatic expiry/RTO
eligibility; do not assume Monday–Friday or browser timezone in production. Pin the
calendar version so edits/retries/transfers cannot shorten/reset an active hold window.
Extensions or a post-expiry collection override are unapproved and denied pending #24.
No production timer/queue is created here; elapsed time signals eligibility, never approval.

Synthetic example only: calendar open Monday–Friday, no holidays. Friday
2026-09-11T10:00:00Z intake has Monday 14 and Tuesday 15 as its two business dates;
deadline Wednesday 16 September 00:00 IST = `2026-09-15T18:30:00Z`. One second earlier
collection is allowed and RTO denied; exactly at deadline those eligibility results flip.
A synthetic Monday holiday shifts the deadline to `2026-09-16T18:30:00Z`.

## Delivered correction and reconciliation

T13 is a high-sensitivity correction of a false/invalid delivery record, not a generic
refund or consumer return policy. A valid historical delivery followed by a new commercial
return needs its own reviewed #24/#29 workflow. If physical custody cannot be established,
leave delivered evidence intact and escalate; no phantom office custody.

Only owning franchise_admin may approve/perform T13. Preserve original delivery time,
actor, proof reference and timeline. Append the correction, new effective state/time,
reason and immutable reconciliation obligation for Payments/Reports. Delivery reversal
**must not silently rewrite payment history**, reopen a settled balance or claim a refund.
#8/#29/#30/#61 define ledger adjustment/receipt/report consequences and reconciliation
resolution before production reversal is enabled. Agents cannot reuse the old consumed
proof. Office collection later requires a fresh, approved proof flow via Deliveries.

## Explicit decision ledger

| Decision | Evidence / rationale | Owner / remaining gate |
| --- | --- | --- |
| Office intake actor is operator | Approved checked_in → operator and receipt responsibility; least added authority for held_at_office | #3 conservative decision; no unrelated role gets broad state permission |
| Office completion actor remains delivery_agent | Approved delivered → delivery_agent; explicit office assignment preserves agent-only proof authority | #3 role; #8/#42 must approve collection-proof details before T10 can run |
| Reversal target is physically verified held_at_office | Approved reversal plus office state; avoids inventing a free rewind/phantom failed attempt | #3 decision; #8/#29 reconciliation semantics remain gated |
| Count two complete business dates after intake | Approved two-business-day window, UTC/IST boundary; conservative full collection opportunity | #3 interpretation; #8/#66 operating calendar remains unresolved |
| Reason-to-path mapping above | Preserve useful prototype reasons; implement both approved paths without automatic RTO | #3 conservative mapping; #24 controlled subreasons and exceptional changes require review |
| No extra financial/proof/job authority inferred | Role name or lifecycle label cannot approve unprovided sensitive policy | #8/#14/#24/#29/#42 own remaining implementation gates |

## Customer-safe projection

Internal events contain state, actor/scope, versions, evidence references and reason codes.
Customer timeline is an authorized projection of progress phrases in the transition table,
UTC occurrence time rendered in business timezone, approved location label/ETA and safe
next action. Never expose OTP values/attempt payloads, verification metadata, internal
permission/grant details, staff secrets, raw refusal/payment/address narratives, unrelated
PII or full addresses. A correction appends a visible correction; it never deletes the
previous delivered entry. Internal failure categories can map to the same safe phrase.
Messaging consumes committed safe facts; it cannot infer a new state from a title or LLM.
