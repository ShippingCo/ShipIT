# ADR 0022: External e-way observations and prospective check reminders

Status: application decision recorded before implementation for Issue #32; acceptance
requires independent PR review and merge. Date: 2026-09-20. Starting main:
`fef48be89041fe7d491782c47770799e85786709`.

ADRs 0006/0007/0009/0013 remain authoritative. Dependencies #8/#15/#16/#22 are
closed and their merged PRs #91/#98/#99/#105 are ancestors of main; main CI passed.

## Decision

One optional e-way tracking aggregate belongs to a Booking and its immutable owner
chain. It covers the declared contents of the entire Booking, across all its Parcels;
it does not assert legal consignment aggregation. No Parcel selector is accepted.
The aggregate may exist before an external reference is available.

The production goods-value gap is resolved by a dedicated applicability declaration:
nullable `declared_goods_value_paise`, INR safe integer paise, plus a bounded declaration
source reference. This is an operator-captured declared total for the physical goods,
not freight, taxable basis, invoice total or payable. Unknown is null; zero is an explicit
declaration. No backfill or Booking commercial-schema change. W23 captures/corrects this
input for e-way review. #33/#34 can collect it through this same command boundary.

Current state has positive version; every committed version is also an immutable revision,
including initial observation, actor, reason code/reference and captured time. Corrections
require expected_version. Previous versions are never replaced. A database trigger writes
revision evidence and its safe canonical audit projection atomically; runtime cannot edit
history or bypass the trigger. Commands have immutable scoped receipts linked to revisions.

External issuer/reference and optional source-issued/official-until instants are manually
captured facts. Official validity requires an explicit source evidence reference; this means
source-supported operator observation, NOT government verification. `verification_state`
remains `unverified_external`, verification time null. This release has no verifier.
Replacing source validity is an explicit correction; changing distance/vehicle alone
preserves saved official validity and any saved estimate exactly.

Estimates require a separate explicit recalculation command, approved scoped policy, distance
and user-supplied commencement instant. A versioned engineering rule `distance_blocks_v1`
uses ceil(distance_km / block_km) * block_seconds from that instant. No default constants or
legal formula are approved. Store result, policy ID/version, exact inputs and calculation
instant separately; return “ShippingCo estimate — verify on the government portal”.
Recalculation never updates external source validity or verification. Absent approved rule
returns a controlled conflict. Existing estimates retain their original policy after changes.

Policies are immutable, scoped, effective-dated maintenance configuration. Only the migration/
maintenance identity inserts versions after recorded compliance/project-owner approval; there
is no staff policy endpoint or invented role. The database stamps recorded_at and rejects
backdating before that instant. Version/effective instant must increase; future
versions can explicitly disable approval. A read selects latest effective_from <= server now,
then uses it only if approved. Changes apply to subsequent evaluations of ALL existing
Bookings, including old declarations; they never rewrite records/history. A policy is a
check-reminder policy, not a determination of statutory applicability. No approved production
preset is seeded. Official NIC FAQ retrieval on 2026-09-20 returned 403; current applicable
amendments/exemptions were not established. Legal applicability therefore remains unknown.

R15 reads: org_admin own organization (explicit franchise selector), franchise_admin,
operator, dispatcher own franchise; accountant minimum statutory references/value/validity
only, excluding vehicle/distance/actor/reason narratives. W23 writes: franchise_admin and
operator only. Private actions are `eway.read` and `eway.write`; reminders/history share
R15. A dedicated live membership coordinator narrows one franchise, holds authorization
locks and issues opaque TenantAccess. No raw query or issuer exception.

Lists are bounded encrypted keysets, 50 default/100 maximum, owner predicates before limit.
Reminders enumerate Booking check states (including missing records), not outbound sends.
Expiry is now >= saved until; warning boundary inclusive. UTC throughout, date display
handoff Asia/Kolkata. No public event is needed: no consumer currently owns an e-way effect.

[Exact API and DTO contract](../architecture/eway.md). #34 owns production E-way Bills UI;
#67 owns report reconciliation. Demo stays untouched. No filing, portal automation, provider
send, financial mutation or compliance certification. Apply one forward migration and narrow
grants before API; rollback compatible code, preserve evidence and repair schema forward.
