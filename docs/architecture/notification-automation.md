# Event-to-notification automation — Issue #40

[ADR 0028](../adr/0028-event-notification-automation.md)

Issue #40 connects the durable #35 event consumer to the database-only #39 enqueue
capability. It does not send provider requests, create another queue, or reinterpret
domain state. The stable consumer ID is `customer-notifications`; policy versions are
independent of that identity so upgrades do not fork consumer history.

## Policy registry and configuration

The closed v1 registry consumes strict schema-version-1 envelopes for:

| Policy | Event | Affected identity | Result kind |
| --- | --- | --- | --- |
| `booking-confirmation:1` | `booking.created` | Booking | `booking_confirmation` |
| `parcel-checked-in:1` | `parcel.checked_in` | Parcel | `parcel_checked_in` |
| `parcel-dispatched:1` | `parcel.dispatched` | Parcel | `parcel_dispatched` |
| `parcel-route-overlap:1` | `parcel.in_transit` | Parcel | `route_departed` suppression |
| `route-departed:1` | `route.departed` | each immutable route effect Parcel | `route_departed` |
| `route-arrived:1` | `route.arrived` | each immutable route effect Parcel | `route_arrived` |

`WHATSAPP_CONFIG_REF` may contain the server-only `automation.policies` array. Each
entry binds one exact policy/version to one exact approved-template name, language and
ordered allowlisted variable list. No language, template or variable is guessed from
the event. Missing bindings are durable `blocked` decisions. Invalid or unknown policy
bindings fail runtime composition.

Every configured organization/franchise owner receives an immutable activation row
before the production consumer starts. The first activation timestamp is never advanced
by an identical restart. Its `binding_hash` is a domain-separated per-policy digest of the
closed code-owned semantics and exact template name, language and ordered variables. A
missing binding is an explicit null component; the non-notifying `parcel-route-overlap`
policy therefore has a deterministic code-owned identity without a fake template. A
different hash for an existing policy/version raises the controlled
`NOTIFICATION_POLICY_VERSION_CONFLICT` startup failure before the consumer is constructed.
Changing a template, language, ordered variables or versioned code semantics requires a new
policy version. Unrelated policy changes do not alter another policy's hash. Events older
than the original cutover become durable
`historical_cutover` skips, preventing an installation enabled later from replaying old
customer notifications. A new policy version has a separate activation.

## Resolution and overlap

Booking and Parcel recipients come from the authoritative Booking-to-current-Customer
relationship. A changed snapshot/current phone relationship fails closed without
returning either phone. Parcel lifecycle policies require the event revision and current
state to remain relevant.

Route fanout reads only `route_parcel_effects`; it never reconstructs membership from
mutable Routes or Lots. Persisted terminal, inactive-booking and ineligible outcomes are
skipped with their controlled reason. A route-created `parcel.in_transit` event resolves
its `movement_evidence_ref` through `route_parcel_effects.parcel_event_id`. That correlated
Parcel event is suppressed as `overlapping_route_cause`; the Route event is the canonical
cause. Both therefore derive the same tenant/affected/customer/kind semantic key regardless
of worker order.

The consumer proves aggregate gaps from the immutable domain-event sequence. Out-of-order
delivery is safe: current-state checks and stale handling still append a decision, while
the #35 receipt advances the stream once the transaction commits.

## Persistence and enqueue boundary

`notification_automation_decisions` is append-only and records source event, policy/version,
affected Booking/Parcel, customer reference, semantic key, outcome, safe reason, optional
outbound intent and correlation. Outcomes are `queued`, `blocked`, `suppressed` or `skipped`.
No phone, event payload, rendered message or template variables are stored there.

Eligible work calls #39 `enqueueMessage` inside the same #35 effect transaction. The
outbound logical identity now includes `affected_entity_id`, allowing one Route source
event to create one intent per Parcel even when a customer owns several affected Parcels.
Consent and template policy remain #38/#39 authority. Provider I/O remains in the later
outbound worker after commit.

## Read authorization

`GET /api/v1/whatsapp/automation` and
`GET /api/v1/whatsapp/automation/:id` expose only the safe decision projection through
signed, actor/revision-bound pagination. They reuse R16 `whatsapp.consent.read`: org admin,
franchise admin, operator and dispatcher are permitted for the selected franchise;
`read_only`, sibling and foreign tenant access fail closed.

Route delay remains #41. Delivery challenges remain #42. Attempt, RTO and completion
notifications remain #43, and the browser automation feed remains #44.
