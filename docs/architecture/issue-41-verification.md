# Issue #41 verification

This evidence uses fictional tenants, customers, Routes and a fake provider. It performs no
live Meta request. Run with the pinned toolchain:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:migrations
pnpm db:local quality
pnpm db:local verify:gates
git diff --check
```

The focused PostgreSQL fixture is
`apps/api/test/database/notification-automation.test.ts`; migration upgrade/failure evidence
is `packages/db/test/integration/route-delay-fanout.test.ts`.

## Reproducible fanout fixture

The test creates a fictional 45-Parcel Booking, checks in and dispatches all Parcels against
one finalized Route, commits departure and a 120-minute absolute delay, and consumes its
exact frozen effects. It forces a process exception after seven committed items. A fresh
pool resumes exactly 20 on its first pass; two concurrent workers finish the remaining 18.
Persisted final evidence is 45 distinct items: 44 queued and one current terminal skip, no
duplicates, with the Route version/base ETA/absolute delay/revised effect ETA unchanged.

Separate fixtures cover null ETA (`unavailable`), STOP before enqueue, STOP after enqueue
before provider dispatch, Lot/direct overlap, delivered and RTO source effects, newer-delay
supersession, historical cutover, source replay, policy/configuration blocks and the #40/#39
regressions.

## Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| 1. Lot/direct overlap once | Overlap fixture asserts one manifest effect, item and outbound intent. |
| 2. Partial retry only unfinished | Forced item-7 crash, fresh pool and 20-item next pass; 45 unique final items. |
| 3. terminal/unaffected excluded | Delivered/RTO source and terminal-after-event fixtures produce only safe skips. |
| 4. current ETA or unavailable | Decrypted fictional rendering asserts authoritative revised ETA; null baseline asserts `unavailable`; newer delay supersedes old. |
| 5. STOP before send | Signed STOP before enqueue produces suppressed items; STOP after enqueue makes #39 purge/suppress without provider call. |
| 6. reminder cannot modify/impersonate | Separate event/source UUID and purpose; Route/ETA snapshot is byte-equivalent after reminders. |
| 7. bounded progress/counts | Batch constant 20; safe root read exposes total, processed, queued, skipped and blocked counts. |
| 8. restart | New runtime pool resumes the persisted root. |
| 9. reproducible fixture | Commands and the 45-item scenario are documented above. |
| 10. sibling/unrelated denied | API/read tests cover Franchise B and Organization C with controlled not-found. |
| 11. nested/count isolation | Reminder source/Route and root detail are tenant-bound; foreign reads reveal no rows/counts. |
| 12. malformed controlled | Invalid UUID/body returns the standard validation envelope. |
| 13. stale controlled | Newer delay, arrival/not-departed and historical activation use safe skips/conflicts. |
| 14. dependency failure controlled | Missing binding/template/installation produces blocked/failed state without Route rollback. |
| 15. no unauthorized partial mutation | W19 role/CSRF/tenant denials leave command/event/root counts unchanged. |
| 16. no sensitive error | Standard error envelopes contain only code, controlled message and correlation ID. |
| 17. no prohibited data | Safe-read and log assertions exclude phones, addresses, ciphertext, rendered text, credentials and OTPs. |

W19 tests permit franchise_admin/operator/dispatcher; deny org_admin, read_only, accountant
and delivery_agent; prove same-key replay, changed-intent conflict, concurrent duplicate
convergence, new-key cooldown resistance, restart persistence and safe foreign/unknown
behavior. The existing #28 1,000-Parcel fixture retains the source-domain maximum; #41's
45-item fixture proves multiple bounded worker passes rather than an SLA. Throughput
qualification remains #74.
