# Private customer shipment access — Issue #46

Customers can view a small tracking result for an explicitly permitted parcel. A phone
number, typed docket, consent record or staff session alone cannot retrieve this result.
See [ADR 0031](../adr/0031-private-customer-tracking.md) for proof, trust limits and policy.

## Staff verification and API

The local `franchise_admin` checks the booking customer or recipient relationship using
independent evidence. They then bind a fresh, completed signed WhatsApp inbox record from
the registered installation to that specific parcel. Only the evidence UUID is stored;
do not put proof contents, addresses, OTPs or customer messages into the command or logs.

`POST /api/v1/customer-access/parcels/:id/bind?organization_id=...&franchise_id=...`
uses the existing staff session, Origin/CSRF and `Idempotency-Key`. Its exact body is:

```json
{"relation":"sender","inbox_id":"<uuid>","evidence_ref":"<uuid>","expected_version":0}
```

Relation is `sender` or `recipient`. Version zero means no binding; subsequent verification
requires the current version. The response is `{id,version,expires_at}`. Sender control
must match the booking customer's current canonical contact. Initial recipient control
must match the parcel's recorded canonical recipient. These matches guard mistakes;
they do not replace the independent relationship proof. Unknown fields are rejected.

A recipient tracking contact change uses `relation: "recipient"`,
`recipient_rebind: true`, current `expected_version`, a fresh signed message from the
replacement number and new independent evidence. Every old recipient grant stops working.
This changes tracking access only, not delivery challenges or immutable booking snapshots.
To remove access immediately, use the matching staff
`POST /api/v1/customer-access/parcels/:id/revoke` endpoint with the same selectors,
CSRF and request key, and `{relation, expected_version, evidence_ref}`. Revocation
advances the binding version and expires it without transferring authority. It is
repeat-safe, recorded with the original signed source and new revocation evidence,
and has the same local administrator restriction. Later verification uses the new
version and independent evidence; an old revoke replay cannot revoke a new binding.
The same key/body returns the original result; conflicting reuse gives
`IDEMPOTENCY_CONFLICT`. A stale binding version gives `VERSION_CONFLICT`. Live permission
checks precede replay. A foreign parcel, installation/inbox, or unknown reference returns
`RESOURCE_NOT_FOUND`. Only own-franchise administrators may bind; other locally visible
staff roles receive `ACTION_FORBIDDEN`.

## Trusted channel selection and tracking

#47 calls `createCustomerAccessService(...).select(scope, inbox_id, docket?)` in a trusted
signed-inbox transaction. There is deliberately no public endpoint accepting an inbox ID
as customer authentication. Installation and sender come from the authenticated encrypted
inbox, never client-supplied organization/phone fields. The scope capability expires with
the transaction. Source messages must already be completed and remain within 15 minutes.

Selection returns at most ten distinct permitted parcels, each with docket, scoped grant
and expiry, plus `selection_required` and `has_more`. An exact docket narrows only the
permitted set; it never searches other franchises. If more than ten match, ask for a
docket and use exact selection. Unknown and foreign dockets both produce the same empty
selection. Issuing the same grant again neither creates another row nor resets expiry.
No total count or customer directory is exposed.

`GET /api/v1/customer-tracking?docket=<optional-docket>` accepts
`Authorization: Bearer <grant>` and no staff session. Docket can only narrow that grant's
single parcel. Grants in URLs, query strings or phone-only requests are rejected. Responses
are not cached and carry `Referrer-Policy: no-referrer`. Do not persist grants in browser
localStorage, logs, analytics or referrer-bearing links. A later customer UI must handle
grant expiry and use a deliberate secure delivery flow under #47.

```json
{"docket":"SYN46","status":"booked","version":1,
 "eta":{"state":"unavailable","at":null},
 "timeline":[{"event":"parcel.booked","at":"2026-10-02T00:00:00.000Z"}]}
```

Available ETA has `state: "available"`, an exact stored instant, and
`kind: "route_arrival"`. No base time is guessed from the current clock. Route arrival,
terminal states and last-mile/failed/held work suppress the old route ETA. A skipped latest
route effect clears the earlier estimate rather than carrying it forward. Timeline includes at most 20 allowlisted
events and their times, never raw event payloads. Privacy projection excludes all contact
details, internal references, addresses, proof codes and notes.

Missing, expired, altered, revoked-version and inaccessible grants/dockets share the same
404 code/message; correlation IDs remain request-specific. Storage/key failures return
safe 503. Every failed attempt counts toward the additional 30 requests/minute/IP/process
limit; 429 carries Retry-After. The global 120/minute limit remains active. Fleet-wide
abuse budgets require a shared limiter in the deployment/security work; this is not a
claim of protection across independently running processes.

## Setup, upgrade and recovery

Apply `1791306000000-private-customer-tracking.cjs`, preserving all released migrations.
It adds three empty tables and a private scope-selection function; no old contact or
consent is granted access. Use the runtime grants in [the database guide](../../packages/db/README.md).
Then enable `customer_access_enabled: true` in the server-only `WHATSAPP_CONFIG_REF`
catalog, which must contain validated webhook keys. Leave it absent/false to disable both
HTTP surfaces. No new provider, Redis, AI model, production service or dependency is added.

Bindings last 24 hours, grants at most 15 minutes, and sender phone changes invalidate
the existing contact generation immediately. Known shared/recycled-number changes require
new independent verification. Unknown recycling inside a live binding window cannot be
detected from a provider sender number alone. Staff must not attest solely from phone or
docket knowledge. Final retention/deletion policy remains with #72. Audit commands retain safe evidence,
actor, binding version/result and request correlation without message contents or tokens.

Rollback disables the flag or deploys compatible old code, retaining additive records.
Repair applied schema forward. Never fall back to demo/localStorage after a production
error. Signed key unavailability fails closed; grant restart replay needs the same browser
key. Replaying an existing inbox with a changed key returns a controlled unavailable
outcome instead of issuing an unusable token. Rotating keys alone does not instantly
revoke already-issued bearer tokens.

## Reproducible fictional verification

Use repository-pinned Node/pnpm/Python and running Docker:

```sh
pnpm check:migrations
pnpm db:local exec node scripts/test-customer-access.mjs
pnpm db:local quality
```

The focused selection uses the standard guarded runner and cleans generated databases,
roles and the PostgreSQL container. Fixtures create their own staff grants, bookings and
signed provider callbacks; no real customer receives a message. Cases cover sender/recipient
proof, shared phones, bounded selection, valid foreign dockets, expected-version races,
expiry/tampering, current route ETA/arrival, privacy, live HTTP and pool restart. See
[verification results](issue-46-verification.md) for executed checks and limitations.
