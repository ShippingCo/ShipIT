# PR draft

Title: Add verified customer parcel access and private tracking

## Description

Customers currently have no production parcel-access boundary; matching a phone or
typing a docket must not expose shipment data. Add explicit, independently verified
booking-customer/recipient bindings in the owning franchise and short-lived hashed grants
for a minimal tracking result. Foreign and unknown dockets receive the same safe response.

Local franchise administrators can verify, rebind or revoke a parcel relationship with
independent evidence, CSRF, request keys and expected versions. Sender phone changes and
recipient rebinds invalidate old access. Signed installation/sender scope provides bounded
multi-parcel selection for #47. Tracking returns trusted status, limited timeline and
route-arrival ETA or explicit unavailable, excluding addresses, notes, money and proof codes.

Add a forward-only migration with no access backfill, narrow runtime privileges, safe audit
evidence and disabled-by-default `customer_access_enabled` configuration. Record the W46
action amendment, proof trust limits, API contracts and reproducible fictional fixtures.
Earlier upgrade tests update their remaining migration count; released SQL is untouched.
Preload the lazy operator module in the test setup to keep cold Vite compilation outside
existing flow assertion deadlines; product behavior and assertions remain unchanged.

Closes #46 after acceptance, review, CI and merge.

## Validation

`pnpm db:local quality` passed: 33 quality, 22 testkit, 12 DB unit, 497 API,
177 web, 3 real object-store and 67 DB + 340 API PostgreSQL tests, plus planning,
lint, typecheck and production builds. The focused suite passed 13 cases; all 29
released migrations remain unchanged. Detailed acceptance mapping, earlier failed runs
and final results are recorded in [Issue #46 verification](issue-46-verification.md).
Commands:

```sh
pnpm check:migrations
pnpm db:local exec node scripts/test-customer-access.mjs
pnpm db:local quality
```

## Rollout and limits

Apply additive migration and documented runtime grants before enabling the server-only
flag; disable the flag for rollback and retain evidence. No production data, live messages
or schema were changed during verification. Manual verification requires real independent
staff evidence; matching a phone and supplying a UUID do not establish that relationship.
Unknown number recycling inside the bounded session window remains a channel limitation.
The API limiter is per process. Routing/reply delivery and other assistant tools remain
#47–#52; final retention/deletion remains #72. No customer UI or external identity provider
is added. Live Meta qualification and production rollout remain unexecuted.

The large API/database test group has a bounded 15-minute aggregate budget for repeated
schema installs, with all individual deadlines, assertions and cleanup retained.

This is a local draft for user review; it has not been published.
