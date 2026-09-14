# ADR 0014: Guarded Parcel lifecycle commands

- Status: proposed through Issue #24
- Date: 2026-09-14
- Refines: ADR 0006, ADR 0007, ADR 0013

## Context

Parcel creation persists `booked` version 1, while later operational work needs mutable
state without exposing a generic status setter. A transition must serialize concurrent
operators, preserve retry safety after a lost response, append audit/timeline facts with
the aggregate, and keep tenant/custody authority separate from a guessed resource ID.
Delivery start/completion, OTP proof, retry scheduling and physical return completion have
separate owners and cannot be fabricated by this implementation.

## Decision

Expose five typed v1 commands: check-in, dispatch, transit, failed-attempt and RTO approval.
Every request carries a scoped `Idempotency-Key`, exact positive `expected_version` and
operation-specific UUID evidence references. Unknown fields and narrative reasons are
rejected. Lifecycle state is never writable through PATCH or a generic command.

The membership coordinator locks the Organization, resolves the live role and selected
Franchise, then issues transaction-lifetime capabilities for exactly one command and its
event. Repository SQL constrains Organization and Franchise before Parcel identity. F is
implemented now. C/A authority is used only where durable evidence exists: failed-attempt
requires the authenticated delivery agent to match the stored active assignment/attempt.
No membership-only approximation grants cross-Franchise custody access.

PostgreSQL locks the Parcel row before checking the expected version. One transaction
reserves a command receipt, changes the aggregate by one version, appends one transition,
one domain event and any failure/RTO evidence, then commits the original response. A
deferred constraint trigger verifies that every committed receipt exactly matches those
facts. Same operation/key/intent returns that response; changed intent conflicts.

Failure reasons are closed codes. `other_controlled` additionally requires one closed
subreason (`weather_disruption`, `vehicle_breakdown`, `route_access_restricted`, or
`device_or_network_failure`). A failed attempt must match the active attempt and assigned
agent and increments exactly once. Ordinary RTO requires exactly two failures and an
eligible retry-path last reason. A Franchise administrator may approve earlier RTO only
after a real failed attempt, with closed override reason, approval, eligibility evidence
and return-plan references. Neither RTO nor `delivered` is an ordinary reassignment state.

## Consequences

- Concurrent same-version commands have one winner and a controlled conflict loser.
- Aggregate, transition, event, failure/RTO evidence and replay receipt commit or roll back
  together and survive process restart.
- Direct runtime aggregate/history writes remain constrained by column grants and triggers.
- Delivery start/completion, retry start, office collection/expiry, automatic timer RTO,
  OTP/proof and physical return completion remain unavailable until their owning issues.
- Cross-Franchise custody commands remain fail-closed until an accountable custody schema
  can prove C authority; this ADR does not treat a route label or membership as custody.

## Alternatives rejected

- A generic status PATCH: bypasses edge-specific authority and evidence.
- Read-then-write without a row lock/version predicate: permits double transitions.
- In-memory deduplication: loses correctness on restart and across processes.
- Automatic RTO after time alone: invents calendar/eligibility policy.
- Free-text operational reasons: creates validation, privacy and reporting ambiguity.

