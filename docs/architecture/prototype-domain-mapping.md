# Prototype Booking → canonical domain mapping

[Architecture index](README.md) · [Domain](domain-contract.md) · [Lifecycle](parcel-lifecycle.md) · [Transition overview](../PROTOTYPE_TO_PRODUCTION.md)

Evidence inspected on main `256512a725c56c5c0e0fa180253add5ac20a69d0`:
[types.ts](../../apps/web/src/data/types.ts), [store.ts](../../apps/web/src/data/store.ts),
[prototype tests](../../apps/web/src/test/app.test.tsx). All current Booking fields are
accounted for below. These are dispositions for future work, not migrations or new shared
row types. #7 still owns exhaustive store-export/caller regression mapping.

## Complete Booking field disposition

| Prototype field/category | Canonical owner / responsibility | Disposition | Reason / boundary |
| --- | --- | --- | --- |
| id | Bookings identity + new separate Parcel identities | Split | One commercial Booking → one or more physical Parcels from day one; browser ID is not globally trusted |
| docket | Parcels globally unique docket | Change | One per physical parcel; separate Booking identity/reference; allocate safely across the entire system |
| name, phone | Customers franchise-owned relationship and shipment sender/recipient snapshots | Split | Current single customer/contact is ambiguous; do not infer sender equals recipient or authorize by phone; #19/#22 must collect/map parties explicitly |
| to | Parcel destination / shipment party snapshot | Keep meaning, split | Parcel-level routing destination; no unrelated customer directory grant |
| address | Parcel recipient delivery address | Split | Private shipment snapshot, not a global customer field accessible to siblings |
| weightKg | Parcels measured/declared physical attributes | Keep, validate | Each child has its own weight; #22 owns precision/units validation |
| serviceType | Booking commercial service selection + parcel service snapshot | Split | Preserve customer service intent and per-parcel operational requirements; #20/#22 resolve service compatibility |
| goodsValue | Parcel contents declaration and scoped E-way applicability | Change | INR minor units; no statutory threshold inferred from prototype; booking-wide allocation/aggregation reviewed by #8/#22/#32 |
| amount.packing, amount.freight | Bookings immutable charge snapshot, calculated by Pricing | Change | Integer paise; commercial total distinct from parcel lifecycle; #20/#22 own item allocation |
| tax.rate | Pricing/Tax policy reference/rate snapshot | Keep snapshot concept | Rate is not money; do not multiply rupees with browser floating-point authority; detailed law/policy #8/#21 |
| tax.taxable, tax.gst, tax.cgst, tax.sgst, tax.igst, tax.total | Bookings tax snapshot; Tax owner calculates; Receipts issues facts | Change | Minor units, preserved components, separate final rounding adjustment; no intermediate whole-rupee rounding |
| supply | Tax jurisdiction/evidence snapshot | Change | Approved jurisdiction inputs; unknown city cannot silently select intra-state tax |
| payment.mode | Payments obligation/collection instructions linked to Booking | Keep intent | Paid/To-Pay instruction is distinct from actual collection proof |
| payment.settled, payment.settledTs | Payments append-only ledger and derived settlement | Replace | No mutable boolean authority; collection/refund facts independent from delivered/RTO |
| status | Parcels guarded lifecycle | Split | Each child moves independently; no unrestricted updateStatus, add held_at_office |
| lotId | Lots validated Parcel membership | Change | Move child references; parent Booking cannot force every child onto one manifest |
| timeline[].ts, status, title, note | Parcels internal immutable events + customer-safe projection | Split | Typed facts drive behavior; sanitized progress text never OTP/internal payload; no title inference |
| createdAt | Bookings creation instant; separate Parcels creation/audit instants | Split | UTC server timestamps, explicit business-date projection in Asia/Kolkata |
| etaDays, etaTs | Parcels ETA with source/cause and Routes effects | Change | Per parcel; no invented unknown-city estimate; terminal delivered/RTO excluded; reporting date differs from instant |
| deliveredTs | Deliveries immutable completion fact and Parcels effective state | Change | Preserve original and correction history; not deleted on admin reversal; payment timestamp separate |
| otp, otpAttempts, otpUsed | Deliveries protected challenge/verifier and security attempt counters | Deprecate plaintext fields | No staff reveal, shared/public row, raw OTP log or retained used OTP; #8/#42 owns secure proof and TTL; physical attempts counted separately |
| failureReason | Deliveries/Parcels closed failure category + restricted evidence | Change | Map five existing reasons intentionally; free-form note/title cannot select state or public notification |
| attempts, firstFailedTs | Deliveries per-attempt records and Parcels recovery policy | Replace | Maximum two physical attempts; timestamps immutable; office clock starts at receipt, not first failure |
| eway.no, eway.vehicleNo, eway.distanceKm, eway.validUntil | E-way externally issued record/provenance with declared Booking/Parcel coverage | Split / change | #8/#32 owns coverage and official validity; no browser-derived distance timer claims government validity |
| ewayBillNo | E-way legacy reference only | Deprecated | Already deleted by prototype normalization; later explicit import preserves provenance, no silent browser migration |
| photo | Attachments reference classified to Booking/Parcel/proof purpose | Deprecated duplicate | Consolidate with attachments; never persist data URL as production authority |
| attachments[].kind, url, name, size | Attachments private metadata/bytes and scoped parent/category | Change | Validated/quarantined private storage; server authorization before download; no public inline data URL |

Non-Booking concepts also change: `Business` splits Organization/Franchise/versioned
Settings; `DispatchRoute.bookingIds` and lot grouping become validated Parcel references;
`seq.docket` cannot generate production globally unique dockets; `chats[phone]` is not a
global directory/identity; provider/outbox records are server-owned, scoped and durable.
No existing browser JSON is imported, reclassified or deleted by this issue.

## Intentional differences checklist

1. Production separates Booking from Parcel.
2. Multiple child parcels per booking are supported from day one, overriding the original issue suggestion.
3. Custody is distinct from record ownership.
4. Customer records/directories are isolated per franchise, including siblings.
5. Custodial franchises receive only shipment-scoped operational information.
6. org_admin has declared own-org read/audit/verification; no operational-superuser inheritance.
7. Delivery agents see only current assigned parcels and minimum delivery information.
8. Agent custody transfer requires the separate explicit franchise-admin grant.
9. held_at_office is a canonical state in addition to existing statuses.
10. Two physical delivery attempts maximum replaces prototype MAX_ATTEMPTS = 3; two-business-day office collection replaces RTO_WINDOW_HOURS = 72.
11. Delivered reversal is owning-franchise-admin-only, reasoned, immutable and reconciled; payment history remains intact.
12. INR paise calculations/storage; round the final customer amount once to rupees, .50 upward, with separate adjustment.
13. Dockets are globally unique per Parcel, replacing local browser counters/user overrides.
14. Independent franchises enroll their own organization without a national parent.
15. Parent adoption is a dual-approved, conflict-reviewed ownership migration, not an ID edit.
16. Browser/localStorage/STATUS_FLOW, phone personas and frontend filters are not production authority.

## Regression disposition

Existing tests preserve rendering/startup, booking reactivity, lot membership, route-delay
UX, receipt/report/e-way screens and fictional messaging. The prototype OTP loop reads
plaintext and calls browser status mutators; it remains a **demo** test, not production
security evidence. Route tests may jump states; tax/e-way tests confirm current mechanics,
not accepted statutory policy. No product test is rewritten to pretend a future server
exists. #7/#18 isolate the demo; #22/#24/#42/#46 add meaningful production invariants at
implementation. The [synthetic contract checks](domain-verification.md) verify documents
and examples only, never actual server authorization or PostgreSQL behavior.
