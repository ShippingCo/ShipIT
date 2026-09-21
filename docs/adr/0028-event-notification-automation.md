# ADR 0028: Event-to-notification automation policies

Status: implemented for Issue #40 review. Date: 2026-09-21.

## Decision

Register one stable #35 consumer, `customer-notifications`. Policy versions belong to a
closed code registry and never enter the consumer ID, so a policy upgrade does not fork
the outbox receipt stream. Version 1 subscribes only to `booking.created`,
`parcel.checked_in`, `parcel.dispatched`, `parcel.in_transit`, `route.departed` and
`route.arrived`, all with exact schema-version-1 payload validation. `parcel.in_transit`
is a suppression policy: when its committed movement evidence links to a Route effect,
the Route event is the canonical notification cause. `route.delayed` stays with #41.

Route fanout reads immutable `route_parcel_effects`, not current Lot or Route membership.
The Route and correlated Parcel causes derive the same tenant, affected Parcel, customer,
notification kind and canonical Route event semantic key. Only the Route policy can
enqueue; the Parcel policy records `overlapping_route_cause`. The outbound logical key
also includes the affected entity, allowing one Route event to create one intent per
Parcel without collapsing multiple Parcels for one customer.

Recipients are resolved from tenant-owned Booking/Parcel facts to the authoritative
Customer. No event or client phone is accepted. A changed Booking snapshot/current contact
relationship fails closed. Template name, language and ordered variables are exact
server-only bindings for one policy/version; they are never guessed. Missing recipient or
obsolete state is `skipped`, overlap or consent denial is `suppressed`, missing binding or
installation/template dependency is `blocked`, and an eligible #39 intent is `queued`.
Only controlled reason codes and references are retained.

Each configured tenant owner receives an immutable policy activation before the consumer
starts. Each policy/version has an independent, domain-separated SHA-256 identity over its
closed code definition (ID, version, event, aggregate, notification kind, affected type,
allowed variables and notify flag) plus its exact template name, language and ordered
variables. Missing bindings are represented explicitly; the suppression-only
`parcel-route-overlap` identity uses its code definition and a null binding, never a fake
template. The first activation timestamp is insert-once. An identical restart is a no-op,
while a different identity for the same version fails startup before consumer construction.
Changing a template, language, ordered variables or versioned code semantics therefore
requires a new policy version. Because identities are per policy, changing another policy
does not invalidate an unchanged version. An event older than the activation records a
`historical_cutover` skip, including events discovered later by #35; enabling configuration
therefore cannot message the historical backlog.

`notification_automation_decisions` is append-only and stores source event, policy/version,
affected Booking/Parcel, customer reference, semantic key, outcome, reason, correlation and
optional outbound intent—never phone, payload, rendering or template variables. The #39
database-only enqueue and the #35 consumer receipt commit in the same transaction. Provider
I/O remains a later #39 worker action. Current-state relevance, explicit stale decisions and
immutable-event gap proof handle reordering without manufacturing state.

Runtime composition resolves the existing WhatsApp catalog, validates bindings, activates
cutovers, then constructs the consumer and Meta adapter. Constructing the adapter performs
no network call. Missing required automation/webhook configuration fails worker startup.
Tenant SQL always carries organization/franchise predicates. Safe decision reads reuse R16:
org_admin, scoped franchise_admin, operator and dispatcher may inspect references; read_only
and foreign tenants are denied. No broker or workflow engine is added because PostgreSQL
outbox jobs, receipts, effects and unique keys already provide the required atomic boundary.

## Failure, recovery and consequences

Configuration errors and immutable-version conflicts fail startup with controlled codes.
The activation function inserts or locks and compares each identity atomically, making
identical and conflicting concurrent starts safe without exposing configuration or database
details. Durable blocked/suppressed/skipped decisions expose
business-policy outcomes without retry loops; transient database failures roll back both
decision/enqueue and #35 receipt for normal retry. Provider outage occurs after commit and
leaves #39's durable intent recoverable. Activation and decision evidence cannot be updated
or deleted, PUBLIC has no access, and deployment grants only the documented reads, decision
insert and activation function execution.

The prototype's in-memory automation feed, arbitrary personas and simulated messages are
not production authority. #41 owns delay fanout, #42 owns delivery challenge/completion,
#43 owns attempt/RTO/completion notifications, and #44 owns the provider-backed UI feed.
No behavior from those issues is implemented here. See the
[operations guide](../architecture/notification-automation.md) and
[verification](../architecture/issue-40-verification.md).
