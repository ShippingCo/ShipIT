# Versioned pricing — Issue #20

Pricing owns persisted freight/packing proposals. Tax (#21), confirmed Booking persistence
(#22), and production New Booking UI (#33) remain separate. Issue #20 establishes immutable
pricing evidence; Issue #22 persists that evidence on the confirmed Booking.

## Authority and scope

R21 permits org_admin within its own Organization and franchise_admin/operator/dispatcher/
accountant within explicitly granted Franchises. read_only and delivery_agent are denied.
Policy reads contain amounts and references only, satisfying accountant's finance projection.
Draft reads/creation/replacement/publication require W27, own-franchise franchise_admin.
There is one Organization-owned card per Franchise, with explicit composite ownership.
No organization-wide write, inherited admin power, carrier ownership or custody access.

W01 allows ordinary overrides for franchise_admin/operator/dispatcher. The reviewed #20
matrix extension W43 (`pricing.override.approve`) permits only own-franchise franchise_admin
to exceed the configured tolerance. W27 remains policy administration. The old issue's
“manager” example means this existing role; no eighth role is introduced.

All operations use live session/membership resolution in withStaffTenantScope, which locks
the Organization until transaction completion. TenantAccess and scopedQuery enforce
Organization AND Franchise predicates before matching, limits and replay. Selectors narrow
membership; they never grant scope. No raw SQL exception or RLS is introduced. Compromised
runtime credentials retain ADR 0013's documented cross-tenant SELECT limitation.

## Model and deterministic matching

One card has multiple numbered versions. Each draft has an optimistic revision separate
from its permanent version number. Replace the complete bounded rule set in one transaction.
Published versions, rules, ownership, timestamps and identifiers are immutable. Corrections
are new forward versions. All effective intervals are explicitly finite [from,to), with
millisecond precision. Publication cannot backdate or overlap another published interval,
or publish a lower version after a higher one. Closing an interval by editing it is absent:
choose its end before publication and publish the next interval separately. Gaps yield NO_RATE.
Publication requires opaque approval and source evidence references under Issue #8; these
are recorded attestations, not proof that ShipIT has provided compliance advice.

Pricing input `weight_grams` is an integer in 1..9007199254740991. This is a pricing-input
contract only; #22 still owns parcel measurement/persistence and chargeable-weight derivation.
No decimal kilograms, dimensional formula or floating-point slab comparison is accepted.
Each rule is [min_weight_grams,max_weight_grams), with null maximum meaning unbounded within
the supported safe-integer input range. Destination is an explicit uppercase ASCII key
[A-Z][A-Z0-9_]{0,31}; there is no city/distance inference, wildcard, hierarchy or alias fallback.
Services are `standard`, `express`, `same_city`. Carrier normalization remains #59.

Precedence is exact tenant → one effective published version → exact destination/service →
one weight interval. There are no priority tiers. Equal-key weight overlaps cannot publish;
all effective-version overlaps are rejected even when their rule coverage differs. This
small full-policy replacement model prevents hidden shadowing. Defensive matching fails
closed on ambiguity. Fixed rule freight and packing amounts are integer INR paise, bounded
by the safe JSON integer range. BigInt performs sums and variance, with checked conversion.
No pricing rounding occurs: flat amounts are already paise. Final whole-rupee payable
adjustment and taxes belong to #21/#22, never hidden in freight.

The publication trigger serializes against the persistent card row before checking interval
and rule invariants. Rule writes lock their parent version. Runtime cannot bypass published
immutability or publication checks with direct SQL, disable triggers, rewrite ownership,
reuse versions or delete historical evidence. No extension or production superuser needed.

## API and evidence

`POST /api/v1/pricing/quote?organization_id=...&franchise_id=...` retains the issue's path.
These required query selectors follow the existing scope selection convention and are
validated against current membership. Body: destination_key, service, weight_grams and
optional override {freight_paise,reason_code}. No client total, tenant body field, approval
boolean, rule selector or client timestamp is accepted. All input objects are strict.
Idempotency-Key is required: quotes persist finite evidence and overrides append audit.

Admin base: `/api/v1/organizations/:organization_id/franchises/:franchise_id/pricing/versions`.
POST creates a draft (and its card if absent); PUT /:version_id replaces a draft with
expected_version; POST /:version_id/publish takes expected_version; GET /:version_id returns
draft/published administration detail under W27. GET base returns the effective published
policy at server time, or NO_RATE. No unrestricted configuration directory/export.

Quotes retain an immutable original DTO with identity, version/rule IDs, interpreted input,
versioned policy interval/lifetime/tolerance and approval/source references,
matched interval, flat packing/freight components, requested override/absolute variance,
approval status and actor reference, subtotal, creation/expiry and SHA-256 calculation
fingerprint. Fingerprints are integrity/comparison evidence, never bearer credentials.
The server reloads stored evidence and the immutable rule to validate; browser totals never
become authoritative. Inputs contain no customer PII. Every quote is a proposal and explicitly
excludes tax and final payable rounding. Correlation remains the normal HTTP request header.

Versioned quote_validity_seconds (1..86400) is explicitly required configuration; no default
commercial duration. expires_at=min(created_at+lifetime,effective_to). At exact expiry the
proposal is invalid. Future publication cannot mutate old evidence. Validation checks actor,
current authority, exact business inputs, current effective version/rule, fingerprint,
recomputed components and expiry; conflicts require deliberate requote (QUOTE_STALE).
The exported transaction-bound validation seam is for #22's future coordinator; tests call
it directly, with no Booking table/endpoint. #22 must use the same authorized transaction
and hold these locks through its eventual snapshot insert.

Override absolute variance <= tolerance is ordinary; above tolerance requires W43 and a
structured reason. Every override requires one of `customer_agreement`, `service_recovery`,
`commercial_exception`; no free text. Operator-supplied approval claims cannot grant W43.
Approval is bound to the current actor and immutable quote. Revalidation rechecks privilege;
a revoked approver cannot preserve authorization by replaying old evidence.

## Transactions, errors, audit and rollout

Draft changes, publication, quote evidence, override audit and original-result receipts
commit together. Keys use the existing 1..255 ASCII format, SHA-256 canonical v1 intent,
actor/organization/franchise/operation namespace, and immutable receipts retained at least
24 hours (no deletion path here). Replay reauthorizes before returning the original DTO,
even when its proposal has since expired; replay never extends expiry. New keys do not
bypass draft revision or publication invariants. Unknown and foreign IDs share 404.

NO_RATE is controlled 409; RATE_CONFLICT and QUOTE_STALE are 409. Existing validation,
malformed JSON, stale version, idempotency, auth and dependency error envelopes remain.
Successful draft configuration changes, publication and ordinary/privileged overrides
append closed reference-only facts via the existing audit module, atomically. HTTP security
denials use #16's identity-only durable denial path, never guessed tenant/target data.
No entire request, rule object, secrets, addresses, tokens or narrative enter audit/logs.

Apply the new additive forward migration and explicit runtime grants before API deployment.
No backfill or browser import; no rate exists until deliberate approved publication.
Rollback disables/reverts compatible API code, retaining immutable schema/evidence; repairs
require another forward migration. Existing fictional demo suggestFreight remains untouched
and unreachable from production. No browser/keyboard change is introduced by #20.
