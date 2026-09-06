# ADR 0005: External provider ports and adapters

Status: proposed for acceptance by the issue #2 reviewed PR. Date: 2026-09-06.

## Context

Messaging is simulated and neither named carrier's production access is verified here.
#53 requires independent manual/file/API capability declarations; #56/#57 investigate
Akash Ganga and Maruti. A provider SDK cannot become the core business model.

## Decision

Define application-owned, server-only ports. Messaging needs send, normalized acceptance/
delivery reconciliation and verified callback translation. Carrier ports expose only
verified tracking, rates, booking and webhook capabilities; manual and file workflows
remain independently useful when network capabilities are false. Concrete signatures,
normalization and fixtures are #36/#37/#39/#53, with provider evidence in #56/#57/#60.

Adapters translate application requests to provider contracts and map responses to these
application outcomes: accepted with opaque reference; retryable explicitly not accepted;
permanent failure; authentication/configuration failure; unsupported capability; uncertain
acceptance requiring reconciliation. Unknown carrier status stays explicitly unmapped.
Do not fabricate provider API access, booking success or a delivery timestamp.

Outbound side effects are invoked by worker/post-commit consumers. Credentials are resolved
inside the server adapter runtime for a registered authorized installation; installation A
cannot be selected for B from a caller's arbitrary ID. Validate callback signatures/source
before deriving scope, then durably record deduplicated evidence before acknowledgement.
Provider SDK types, tokens and raw errors stay inside the adapter boundary.

Carrier observations are input to reconciliation and authorized domain commands. They
cannot bypass delivery proof or mark an obligation paid. Messaging is communication
transport, never operational authority. A local booking can commit without a carrier API;
its carrier submission/reference state remains separately visible. Manual entry/file import
requires authorized provenance and audit, not an unauthenticated browser/provider bypass.

Ports accept stable logical operation references so verified provider idempotency can be
used. Acceptance uncertainty must survive into application state; retries are not blindly
hidden inside SDK wrappers. See [ADR 0004](0004-durable-events-and-transactional-outbox.md).

## Consequences, testing and revisiting

Fakes can model timeout before/after acceptance, unsupported capability, auth failure,
duplicated/out-of-order callbacks and unmapped tracking without live customer messages.
#53 fixtures include provenance, normalized identifiers and timestamps; #60 demonstrates
which capability is actually available. Contract tests and live-access evidence are distinct.

Adapter translation costs code but keeps provider churn out of courier services. Direct SDK
calls from domain services would spread failure semantics and credentials. Revisit port
shape only with verified capability evidence and backwards-compatible migration/contract
fixtures. No provider or infrastructure dependency is installed by this decision.
