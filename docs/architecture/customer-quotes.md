# Customer shipment estimates — Issue #48

Send `QUOTE` to the configured franchise WhatsApp channel, then answer origin key,
destination key, weight in whole grams, dimensions (`100 x 200 x 300`, millimetres),
and service (`standard`, `express`, `same_city`). Invalid values repeat the current
prompt. All dimensions are required. `QUOTE` restarts; STOP, HUMAN and RESUME retain
their existing priority. Other tools clear an unfinished quote. Progress expires after
15 minutes, survives process restart, and is scoped to the signed contact/installation.

An estimate is one package's freight plus packing using explicitly approved published
weight rates. Heavy weight and any large dimension trigger staff review at **or above**
the configured threshold. Unsupported origins/lanes, dimensional lanes, manual review,
disabled policies and missing current rates produce a reference/reason without a price.
No booking, payment or staff case is created. Customers cannot change tariff values.

`QUOTE <reference>` checks the original contact's estimate. A live current-policy
reference returns the same evidence. Expired/superseded evidence is recalculated and
linked to a new reference. `CONFIRM QUOTE <reference>` also checks/refreshes and says
booking is not confirmed. Staff must use the existing booking/pricing validation flow.

## Configuration and staff API

First apply migration `1791478800000-customer-shipment-quotes.cjs` and
[runtime grants](../../packages/db/README.md#issue-48-runtime-privileges).
Then enable `customer_quotes_enabled: true` in the server-only WhatsApp catalog with
existing conversation/customer-access/outbound/webhook prerequisites. Default is false.
No new environment variable, role or provider credential is introduced.

GET/POST `/api/v1/customer-quotes/policy?organization_id=<uuid>&franchise_id=<uuid>`
requires the existing franchise-admin W27 permission. POST requires the normal staff
session, Origin/CSRF and `Idempotency-Key`. Closed JSON body:

```json
{
  "expected_version": 0,
  "enabled": true,
  "origin_key": "AHMEDABAD",
  "rate_version_id": "<published same-franchise UUID>",
  "heavy_weight_grams": 20000,
  "large_dimension_mm": 1000,
  "manual_review": false,
  "lanes": [{"destination_key": "SURAT", "service": "standard", "weight_only": true}]
}
```

Values above are examples, not approved production thresholds. Every deployment needs
explicit franchise policy. Location keys must match the existing rate vocabulary.
Changing policy appends a version and audit entry; expected_version prevents lost
updates. Replay reauthorizes the staff member. Selecting another rate version needs
another explicit policy version. Future/inactive versions produce no current price.

## Persistence, privacy and recovery

`customer_quote_policies` and command receipts are immutable. `customer_quotes` retains
minimal shipment inputs and keyed contact, amount components, rate/rule/policy identity,
fixed assumptions/exclusions, expiry and referral reason. No phone, name, address,
transcript or raw card is added to quote evidence. Existing encrypted inbox/outbound
payloads carry customer text. Turn audit contains only a quote reference, not dimensions
or answer body. The policy audit contains safe identity/version provenance.

All queries carry tenant scope. The signed contact is sufficient for a new public
estimate; private Parcel/Booking data still requires #46 verification. A quote reference
does not grant access to shipment tracking. Dispatch rechecks the original contact,
current policy and expiry. At most 60 quote turns per contact/installation/hour are
processed; excess turns return a staff/try-later response without pricing effects.

Existing installation ordering and locks serialize duplicate/concurrent turns. A
dependency failure rolls back draft/quote effects before the generic fallback commits.
Disable the feature to stop quote creation and suppress queued quote replies. Before
running pre-#48 code, remove its strict configuration key and drain/suppress new intents
with compatible workers. Preserve additive evidence; schema repair is forward-only.

Run `pnpm db:local exec node scripts/test-customer-quotes.mjs` with the pinned toolchain
and Docker for synthetic signed-channel verification. Full `pnpm db:local quality`
also covers earlier modules. See [ADR](../adr/0033-customer-shipment-estimates.md) and
[acceptance evidence](issue-48-verification.md).
