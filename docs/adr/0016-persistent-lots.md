# ADR 0016: Persistent lots and versioned membership history

Status: proposed for review through Issue #26. Date: 2026-09-14.
Refines ADR 0006/0007/0013 without replacing their ownership, role or transaction boundaries.

Lots receives a separate active/archived aggregate and revision stream. Parcel grouping is
persistent historical association, not lifecycle/custody state. Scoped counters allocate
human-readable codes; composite FKs and a partial unique active-membership index enforce
ownership and one-lot occupancy independently of application checks. Moves advance both
lots atomically, emitting one fact per affected aggregate. Archive ends current grouping
and preserves all history. The existing domain_events table gains lot ownership and command
references while retaining old producer invariants. Canonical audit adds one immutable
lot source, with narrow append rights. Full details and state-dependent W04 narrowing are
in [lots](../architecture/lots.md).

Using frozen Booking pricing destination keys avoids inventing an address parser or global
city directory. Destination/code remain immutable. Current W04 roles can manage pre-dispatch
lots; explicit dispatcher authority is required for post-dispatch membership corrections
and archive. Neither role inheritance nor grouping authorizes physical movement.

Rejected: mutable parcel.lotId with no history; destructive deletion; split remove/add
transactions; second event universe; new parcel states; route implementation in #26;
production UI fallback to the demo. #27 owns routes/frozen manifests and #34 owns screen
cutover. Additive rollout preserves compatible old writers and all committed history.
