# ADR 0017: Dispatch routes and immutable Parcel manifests

Status: proposed through Issue #27 for independent PR review. Date: 2026-09-14.
Refines ADRs 0006, 0007, 0013 and 0016; no accepted decision is overwritten.

Routes are owned by one Organization/Franchise. The initial-dispatch lifecycle is
`planning → finalized`, or `planning → archived`. Finalization seals dispatch authority;
it is neither physical departure nor a Parcel transition. W05 permits creation, metadata,
typed source attach/detach and finalization. W06 permits franchise-admin archival of a
planning route. R09 reads select one permitted franchise, including org-admin reads.
Assignment-only agent projection and cross-franchise custody remain fail-closed.

Every non-archive command creates an immutable manifest at its committed route revision,
including an empty initial snapshot. Separate historical Route/Lot and Route/direct-Parcel
relationships contribute normalized provenance and one snapshot row per physical Parcel.
Planning snapshots accept only booked/checked_in Parcels with active Bookings; finalization
requires a nonempty set of checked_in Parcels. An ineligible source rejects the entire
command with PARCEL_STATE_CONFLICT. This deliberately bounds the first implementation
to initial forward dispatch. Later legs need their owning lifecycle contract.

Active planning associations prevent Lot archive and grouping changes for all roles.
Detach, Route archive or finalization releases that guard. Lot rename remains safe.
Finalized/historical manifests never expand current Lot membership again. Source history
and snapshots cannot be edited/deleted. A Parcel can have only one finalized initial-dispatch
manifest, independently constrained in PostgreSQL. T03 requires that exact finalized
snapshot membership in its own transaction. A separate immutable dispatch binding marks
new authoritative references; pre-migration opaque receipts/events remain unchanged and
their authorized exact retries remain valid. New opaque dispatches are rejected by SQL too.

Commands use existing live membership capabilities, Organization/Franchise serialization,
route expected versions, canonical hashed idempotency, atomic result/audit/domain_events
and deferred completeness checks. Snapshot work is bounded to 100 attached sources and
1000 unique Parcels; exceeding either rejects atomically. These are request safety bounds,
not #28 delay capacity qualification. Public lists use bounded encrypted keysets.

Metadata is origin/destination labels, road/rail/air/sea mode, optional inert carrier code,
and a required explicit scheduled instant. No human route-code allocator is needed:
server UUID is identity. Accepted millisecond instants normalize to UTC before hashing.

Rejected: JSON ID arrays; resolving history from live Lots; frozen membership without
provenance; arbitrary T03 UUIDs; silently skipping terminal members; generic status/event
endpoints; treating carrier metadata as an installation; physical deletion. #28 retains
departure/arrival/delay and coordinated lifecycle/ETA effects. #34 retains screen cutover.
Rollout requires additive migration and grants before API deployment. Old dispatch writers
are intentionally incompatible; rollback disables those writes and preserves all evidence.
