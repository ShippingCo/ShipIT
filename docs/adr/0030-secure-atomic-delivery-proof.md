# ADR 0030: Secure and atomic delivery proof

- Status: proposed for Issue #42 independent review
- Date: 2026-09-23
- Owners: Deliveries (#42), Parcel lifecycle (#24), attachments (#31), WhatsApp outbound (#39)

## Context

The prototype revealed an OTP and split verification from Parcel mutation. Accepted #8
policy instead requires recipient proof or independent exceptional proof to be the only
authority for T06, while preserving tenant/assignment isolation, two physical attempts,
payment independence and durable provider uncertainty.

## Decision

Create a Deliveries domain with versioned attempt-scoped challenges, purpose-separated
HMAC/AES-GCM keys, six-digit cryptographic codes, ten-minute strict expiry, five lineage
failures, 60-second resend cooldown and three resend/replacement reservations. Replacement
supersedes and destroys the old secret without resetting lineage budgets.
Proof-sensitive idempotency uses a separate HMAC domain before canonical fingerprinting so
no unkeyed digest of the low-entropy proof is retained.

At first handover Deliveries copies the immutable Parcel recipient phone into a private,
immutable delivery-recipient generation. That reference, not the booking sender/customer,
is bound into the challenge cryptography and durable outbound source; retry reuses it.

T05/T08/T06 are restricted internal Parcel seams. Proof consumption, immutable proof,
Parcel T06, timeline, audit, `delivery.completed` and both receipts share one transaction.
T07 closes the current attempt/challenge in its Parcel transaction. Row locks and unique
constraints serialize OTP, exception and failure races.

Exceptional proof is a separate immutable method using the three #8 reason codes, current
recipient presence, private Parcel evidence, assigned-agent request, a distinct local
franchise-admin approval, and assigned-agent completion. Approval alone never delivers.

WhatsApp gains only `delivery_otp` from a delivery-owned send reservation into #39's durable
outbound ledger. Optional update consent is neither required nor broadened. Only the exact
reviewed one-code authentication/copy-code template shape is eligible; live provider
qualification remains fail-closed deployment work.

## Consequences

The database owns restart-safe authority and can prove no partial completion. Delivery agents
gain a narrow assigned-work UI, not Parcel-directory access. Dispatchers gain a minimal
eligible-agent projection. To-Pay remains outstanding until Payments records collection.
The extra persisted lineage/history and key configuration are necessary security costs.

Office calendar/reversal commands, delivered-customer notifications, general messaging
history, reports, hosting qualification and final privacy retention remain outside #42.
