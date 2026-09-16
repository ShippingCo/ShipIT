# ADR 0020: Immutable issued receipt snapshots

Status: implementation decision for Issue #30 independent review; accepted on reviewed merge.
Date: 2026-09-16. Baseline: `32beb6b0a72484d464997926352d6b151629a03c`.

## Decision before implementation

Issues #21/#22/#23/#29 are merged; PR #112 and current main CI passed. ADRs 0006,
0007, 0009, 0013 and 0019 remain the authority. This resolves #30's bounded D06/D12
questions; statutory compliance, reports and retention remain with their owners.

1. Receipts owns one immutable UUID artifact, schema version 1. Kinds are
   `booking_charge`, `collection_acknowledgement`, `collection_reversal`.
   There is one Booking original and one artifact per immutable payment entry.
2. Retain the issue's GET retrieval proposal. First authorized GET materializes the
   durable representation in the owning transaction; this is an explicit, bounded
   exception to purely read-only GET persistence, not a staff financial command.
   R13 grants retrieval; the coordinator privately issues materialization authority.
   No caller supplies document contents or selects a new version. HEAD is not exposed.
   No prefetch, automatic printing or background document issuance is introduced.
3. PostgreSQL generates `RCT-` plus 19 decimal digits from one noncycling bigint
   sequence. Numbers are globally unique (stronger than organization/franchise scope),
   distinct from dockets, never recycled, and may have rollback gaps. UUIDs/numbers
   are references, never credentials. No receipt-number search or public URL exists.
4. A Booking artifact documents **Booked total**, not collection or settlement. It
   copies #22's frozen charges/tax/customer name, dockets/grams/service and confirmation
   time. No expiry validation, recalculation, second rounding or live Customer join.
   All R13 roles get the same minimal financial projection, with no phone/address,
   recipient history, operational state or current payment balance.
5. Issuer names/code are copied from authoritative Organization/Franchise profiles at
   first issuance. Supplier state comes from booked tax; GSTIN comes only from the
   immutable published policy version referenced by that booked evidence. This is
   historical evidence resolution, never latest-policy selection. No new profile fields,
   browser business data, logo, tagline, address, phone or inferred ETA are admitted.
6. Collection acknowledges only the referenced #29 entry amount, method, context,
   reference and time. The existing Payments repository supplies a narrow internal
   R13 entry port; no R11 ledger grant is conferred. Current balance/settlement is omitted,
   including for full collections, so later money cannot rewrite historical meaning.
7. A reversal document supplements its original collection acknowledgement with
   `correction_of` and the existing closed Payment reason. `version` equals the retained
   payment sequence; it strictly increases along this relationship and can have gaps.
   The original and its amounts remain intact. A new collection is its own acknowledgement.
   There is no free-text adjustment or editable Booking receipt. A future commercial
   amendment requires authoritative Booking correction policy before activation.
8. GET `/api/v1/bookings/:booking_id/receipt` and
   `/api/v1/bookings/:booking_id/payments/:payment_id/receipt` may materialize;
   GET `/api/v1/receipts/:receipt_id` only retrieves existing evidence.
   All require organization_id/franchise_id narrowing selectors and live R13 scope.
   Org admins explicitly select one own-organization franchise; no superuser inheritance.
   Authorized historical retrieval, including first materialization, works on disabled roots.
9. Existing membership/Organization serialization plus a same-owner obligation row lock,
   unique logical keys, immutable triggers and composite FKs converge concurrent first
   requests. Snapshot and reference-only issuance audit commit together. Retry after
   uncertain COMMIT returns the same artifact, including across service/pool restarts.
   GET needs no request key: immutable source identity permanently determines the artifact.
10. Migration is additive, with no backfill or false historical issuance. Issued time is
    first materialization time, never Booking confirmation. Runtime gets SELECT and only
    identity/link INSERT columns; a fixed-path definer trigger derives snapshots, number,
    links and audit. No direct UPDATE/DELETE, sequence or base-audit privilege. No new event,
    payment, message, provider or delivery effect occurs. Access telemetry uses safe route,
    correlation/status/duration; snapshot content never enters logs/audit.
11. JSON DTOs are explicit allowlisted projections; HTML is a pure escaped presentation.
    Printing is an explicit user action with cleanup even for no-op/cancelled dialogs;
    physical print success is not observable or a domain fact. No PDF infrastructure.
    Fictional demo uses a separate adapter to the reusable layout. #33 owns full screen
    migration, the authenticated client adapter and scope lifecycle integration.
12. Apply schema/grants before compatible API, verify synthetic old/new records, then
    enable authenticated routes. Rollback disables/reverts compatible code, retains all
    evidence and sequence watermark, and repairs schema forward. Never revert to browser
    financial truth or delete evidence. No pruning is introduced; #72 owns retention.

## Alternatives and consequences

Explicit issuance POST was considered, but the accepted matrix denies direct staff receipt
create/edit and the issue proposes retrieval. The selected owner-only materialization makes
that persistence behavior explicit and confines it to one canonical artifact. Number allocation
at Booking creation would change #22 and fabricate an issuance time for upgrades; it is rejected.
A snapshot of current PaymentProjection would mislabel historical collection evidence; the
minimal immutable entry acknowledgement avoids that ambiguity. SQL derives document content
from the retained sources, allowing runtime privileges to prohibit fabricated snapshots.

[Contract](../architecture/receipts.md) · [Evidence](../architecture/issue-30-verification.md).
