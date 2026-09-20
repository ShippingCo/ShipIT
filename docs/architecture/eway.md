# External e-way records and reminders

[ADR 0022](../adr/0022-external-eway-records.md) · [API](api-contract.md) ·
[Authorization](authorization-contract.md) · [Policy authority](money-tax-proof-privacy-contract.md)

## Ratified v1 API

All endpoints require a live session and `organization_id`/`franchise_id` query selectors
narrowing current R15/W23 membership. Ownership never comes from the body. All writes
require CSRF/Origin and one Idempotency-Key using the canonical 1–255 ASCII grammar.

| Method/path | Action | Body/result |
| --- | --- | --- |
| POST /api/v1/bookings/:booking_id/eway | eway.write / W23 | Optional declaration, external, vehicle_number, distance_km; creates version 1; 201 command result |
| PATCH /api/v1/bookings/:booking_id/eway | eway.write / W23 | expected_version, reason_code, reason_ref and at least one editable field; 200 command result |
| POST /api/v1/bookings/:booking_id/eway/estimate | eway.write / W23 | expected_version, reason_ref, starts_at; explicit calculation from saved distance and effective policy; 200 command result |
| GET /api/v1/bookings/:booking_id/eway | eway.read / R15 | Current explicit record plus evaluated states; missing aggregate is a 200 missing state for an authorized Booking |
| GET /api/v1/bookings/:booking_id/eway/history | eway.read / R15 | Immutable revision items/page; limit/cursor |
| GET /api/v1/eway/reminders | eway.read / R15 | Booking check-state items/page; limit/cursor; no total or sends |

POST defaults omitted fields to null; it requires at least one non-null capture.
PATCH omission preserves a field; explicit null clears that field with history. `external`
is an atomic replacement object, never a partial merge of evidence from different sources.
Declaration is `{value_paise,source_ref}` or null; exact integer 0..9007199254740991.
External is `{issuer,reference,source_ref,issued_at,official_valid_until,validity_evidence_ref}`;
last four fields default null. Official until requires validity_evidence_ref and source_ref;
until must be after issued_at when both exist. No automatic verification. Issuer is a
bounded source-system identifier, not a portal credential. No fixed 12-digit assumption.

Reference strings trim ASCII space/tab only and otherwise preserve case; allowed ASCII
letters/digits plus `.`, `:`, `_`, `/`, `-`, maximum 128, first character alphanumeric.
Issuer maximum 64. Vehicle trims ASCII space/tab and uppercases ASCII, allows letters,
digits, internal spaces/hyphens, maximum 32. No Unicode folding/lookalikes, controls, lone
surrogates, URLs/query strings, arbitrary notes or raw documents. Evidence values are
operator-entered external reference labels, not internal attachment IDs or access grants.
Distance is null or integer 1..100000 km. Timestamps accept real RFC3339 instants with
seconds and at most milliseconds, explicit Z/offset; canonical output UTC. No date-only
input. Unknown fields, user actor/time/verification/policy/owner fields are rejected.
Expected version is 1..2147483646. Correction reasons: `metadata_correction`,
`source_extension`, `declaration_correction`; reason_ref required and bounded as above.
Server reasons `initial_capture` and `estimate_recalculation` cannot be passed as corrections.

Mutation result is exactly `{booking_id,record_id,version}`. Its durable receipt contains
only these identities plus canonical fingerprint, key digest, actor/scope/operation and
commit/retention times. Original result replays even after later corrections. Same key with
changed normalized intent gives IDEMPOTENCY_CONFLICT; current authority is rechecked first.
Concurrent writes serialize under existing Organization locks; bounded lock timeouts give
IDEMPOTENCY_IN_PROGRESS. Uncertain COMMIT gives TEMPORARILY_UNAVAILABLE: retry exact key/body,
never a fresh correction. Receipts retain at least 24 hours with no pruning in this release.

GET record includes identity/version, declaration, external provenance, estimate, captured_at and
evaluated state. Operational projection additionally includes vehicle, distance, captured actor and
reason. Accountant gets the minimum statutory reference/value/validity projection, never
Booking/customer snapshots or vehicle/distance/actor/reason. History uses the same projection
and retains original capture times; it does not pretend a historical observation is current.

Closed state vocabulary:

- reference_state: `missing`, `recorded`.
- official_validity_state: `unknown`, `source_supported`, `expired`.
- estimate_state: `absent`, `estimated`, `expired`.
- verification_state: `not_recorded`, `unverified_external`; verified_at always null.
- applicability_state: `unknown` (no legal determination in this release).
- value_check_state: `unknown`, `below_threshold`, `threshold_met`.
- reminder_reasons: `policy_verification_required`, `declared_value_unknown`,
  `value_threshold_met`, `external_reference_missing`, `official_validity_unknown`,
  `official_expiring`, `official_expired`, `estimate_expiring`, `estimate_expired`.

Saved estimate includes estimated_valid_until, estimate_policy_id/version, estimate_inputs
(distance_km, starts_at, block_km, block_seconds), estimate_calculated_at,
provenance=shippingco_estimate and the exact label in ADR 0022. It never substitutes for
null official validity. Distance corrections leave those saved inputs unchanged; UI can
compare them and explicitly request recalculation. Official expiry never depends on distance.

Reminders return only booking_id, record_id/version, external reference, state and policy
provenance; no vehicle/customer/actor. All Bookings appear in the paginated check projection,
including those with empty reminder_reasons. Default absent policy produces verification
required, not a false compliant state. Policy result includes selected ID/version, effective
instant, source/approval references and approved/no-approved status; time is server-derived.
Latest policy is selected anew for each page; cursor binds policy identity, scope, actor,
membership revisions, projection, query and limit. A policy boundary requires a fresh query.
Lists use ascending Booking UUID or ascending revision, encrypted 15-minute cursor, no offsets.

Expiry is `now >= until`; expiring means `now < until <= now + warning_seconds` with
an approved configured window. Both boundaries use injected clocks in tests. Reminder reads
never save estimates, amend external facts, queue messages or claim authorization to move.

Errors use existing safe envelopes: 422 validation/cursor, 404 foreign/unknown parent,
403 denied role, 409 VERSION_CONFLICT (including create when already present),
EWAY_ESTIMATE_UNAVAILABLE for missing approved estimate rule/distance, existing idempotency
and disabled-root errors; 503 dependency/uncertain commit. No input values are echoed.

Malformed JSON, duplicate keys and nonfinite literals return 400 MALFORMED_REQUEST;
unsupported content type returns 415. Safe integer validation runs before JSON number
precision loss. HEAD is deliberately absent. Private responses use the existing no-store
and safe route-template logging boundary.

## Policy maintenance and rollout

Apply migration `1790442000000-external-eway-records.cjs` and the narrow
[runtime grants](../../packages/db/README.md#issue-32-external-e-way-records) before deploying
the authenticated API. There is no separate public feature flag or default policy. Existing
Bookings need no rewrite: absent tracking remains missing with unknown declared value.

The deployment migration/maintenance identity inserts a reviewed policy row in a transaction,
using a fresh UUID, the actual owning organization/franchise, increasing positive version,
future effective_from, approved flag and bounded source_ref/approval_ref. The approval_ref
points to the project/compliance owner's recorded approval outside the public record; no
staff role is granted maintenance credentials. recorded_at is stamped by PostgreSQL and
effective_from cannot precede it. A policy is append-only: repair or withdraw with a higher
version and later effective instant, never UPDATE/DELETE. Runtime has SELECT only.

threshold_paise is null or INR integer paise 0..9007199254740991; warning_seconds is null or
0..2592000. The optional estimate_rule is `distance_blocks_v1` with block_km 1..100000 and
block_seconds 1..2592000; all three are null together when estimates are disabled. These
engineering bounds are not legal defaults. Test policies use arbitrary synthetic values.
No policy is seeded, and approval of a check policy does not change applicability_state
from unknown or verify an external record. Production presets require current, applicable
source validation and approval; the failed S03 retrieval is recorded in the source register.

Roll back compatible API code/configuration to disable access while retaining all records,
revisions and receipts. Use a new forward migration for schema repair; never run a destructive
down migration, truncate evidence, fabricate historical declarations or import demo JSON.
Retention/pruning is deliberately absent pending #72's reviewed class/hold authority.
No public event is added because no current consumer owns an e-way side effect. Audit uses
the immutable revisions' reference-only projection; R28 administration restrictions remain
unchanged, while accountants use R15's reduced history projection. No direct audit write grant.

#33/#34 collect declared goods value through these commands; #34 owns all production E-way
screen, loading/retry/accessibility and Asia/Kolkata display integration. #67 owns broader
statutory reconciliation and applicability validation. The existing fictional screen and its
530 km / three-day example remain demo-only. This backend change creates no new UI surface,
so new browser accessibility tests are inapplicable; existing web regressions still run.
