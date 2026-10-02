# Issue #46 — Research, implementation and verification

Date: 2026-10-02. Local review branch: `issue-46-private-customer-tracking`.
No commit, push, PR publication, merge, production send or production data change is
authorized by this request or performed for this issue.

## Repository and recovered context

Started with a clean checkout of `main` at `352421f858d76c95de720f85d23f7d6dab58c7cd`.
Verified GitHub main via the connector, then `git pull --ff-only origin main` confirmed
it was current before creating the dedicated branch. Local stale feature branches are
preserved; none is used as an unmerged prerequisite. The live issue tracker confirms
#15/#23/#37/#38 are closed and main includes their implementation. #45 merged in PR #130.
There are no open PRs. No local work was discarded.

Read the engineering workflow, roadmap, complete issue index, architecture/authorization,
customer/contact, booking/timeline, route ETA, signed inbox and consent contracts and
their owning code/migrations/tests. Reviewed all live milestone summaries and available
issue states: M0/M1/M2 are closed; M3 has 11 closed issues but remains marked open;
M4 has seven open issues. Issues #2–#45 are closed; #46–#83 are open. Issue #46 belongs
to GitHub milestone 5, titled M4, and has zero comments. Its blocked label was not changed.
All seven M4 issue bodies were reviewed against their dependencies.

Recovered “Research Milestone 4” and the #37/#38/#39 chats. They explain trusted
ingress, durable processing, privacy, contact-generation changes and actual merge/CI
history. The earlier #35 chat pointed out that the original #27 implementation conversation
was missing. That original conversation is still not recovered here; the merged contracts,
code and #28/#45 evidence supply the relevant route facts. This missing historic discussion
does not block the current identity policy. No missing conversation was invented.

The M4 research recommended, but had not approved, booking customer plus separately
verified recipient access. The user explicitly approved that choice in this chat.
Pricing assumptions, business-hours behavior and the optional model recommendation remain
unapproved downstream proposals and are not implemented by #46.

## Design and database findings

Customer records belong to a franchise, not a global identity. Equal numbers can describe
different customer relationships. Consent evidence is not shipment authorization. Booking
and Parcel snapshots are immutable; customer phone edits rotate an existing contact UUID.
Signed inbox installation/sender already exists but cannot, by itself, resolve shared or
recycled numbers to a shipment. There was no production parcel-access binding/grant.

The local implementation adds explicit sender/recipient bindings and private tracking
grants. Independent local-admin attestation and its evidence reference are required.
W46 is a documented action-matrix amendment for review. [ADR 0031](../adr/0031-private-customer-tracking.md)
separates this engineering choice and its trust limitation from the user's approved
sender/recipient policy and source-backed practices.

The additive migration creates empty binding/command/grant tables, tenant-composite
references, contact lookup indexes, immutable command/grant evidence and a PUBLIC-revoked
scope selector. No contacts are automatically authorized. Runtime grants are documented
in the DB guide and exercised by real restricted test roles. A new safe constraint name
lets concurrent conflicting request-key reuse become a controlled 409 after rollback.
Existing upgrade tests adjust only their expected remaining migration count; all released
migration files remain unchanged.

Parcel locking serializes verification/rebind/revoke. Expected versions reject stale edits.
Tracking and signed selection take the organization lock before installation/parcel/binding locks, matching staff mutation
order to avoid a reader/rebind deadlock. Reads recheck current authority after acquiring it.
Commands and safe audit evidence commit with changes; replay rechecks permission. Old
recipient versions and old customer contact UUIDs cannot redeem grants. Grants deduplicate
by binding/version/inbox and cannot be extended by replay. No raw token is stored.

## Acceptance mapping

| Criterion | Implementation and evidence |
| --- | --- |
| Phone or docket is not authority | Missing/malformed bearer and unknown phone/query fields rejected; signed channel has no result before a parcel binding |
| Approved sender/recipient relation only | Independent admin-attested binding; current booking customer generation or explicit recipient proof; own-franchise W46 |
| Foreign and unknown replies uniform | Scoped exact lookup and same 404 code/message; request correlation differs intentionally |
| Shared phone/multiple parcels bounded | At most ten distinct permitted parcels, selection_required, has_more; exact docket narrowing for remaining choices |
| No invented ETA | Latest route effect; route-arrival kind; unavailable on absent ETA, arrival, last-mile/failed/held/terminal state or skipped latest effect |
| Safe projection | Explicit DTO contains docket/status/version/ETA and at most 20 allowlisted event codes/times, no payloads/contacts/proof/notes |
| Expired/altered grants denied | Stored hash, expiry, current binding version and roots checked on every read; synthetic expiry/tamper tests |
| Recipient phone change | Fresh signed source and independent authorized rebind; old grants rejected; immediate scoped revoke also supported |
| Reload/restart | Persisted grants; same-key derivation; real HTTP and replacement pool retain allowed tracking result |
| Sibling B and unrelated C denied | Real foreign bookings with same phone; valid foreign docket/object selectors denied; read-only binding denied |
| Bad input/stale/failure safe | Strict fields/versions; one concurrent rebind winner with an allowed-or-denied racing read; stale evidence rejected; controlled 503, no prototype fallback |
| Logs/audit privacy | Request logs redact headers/body; stored binding/command/grant inspection excludes plaintext token/contact/message; immutable evidence checked; response/log assertions exclude token and unnecessary contact data |

Execution status is recorded below; the mapping is not a substitute for an executed test.
All twelve criteria are covered by the local automated fixtures; live provider and human
proof qualification are separate limits, not verified by fictional fixtures.

## Executed checks

Initial development runs caught and fixed an incorrect auth table reference, the
recipient snapshot field name, fixture event kind, missing async error capture,
test-role setup, stale migration expectations, fixture invitation authority, an audit
inspection SQL alias and fixture typing. These were local development failures, not reported
as passing. The earliest direct focused invocation lacked the standard resource registry;
the replacement uses the existing guarded runner/cleanup.

`pnpm check:migrations` passed: all 29 released migrations are unchanged. The new migration
is a forward addition. `pnpm db:local exec node scripts/test-customer-access.mjs` passed
13 tests with zero failed/skipped/cancelled/todo, including seven tracking/upgrade cases
and six migrator cases. The final rerun includes stored-audit inspection, read/rebind racing,
key-rotation replay denial and real last-mile delivery/arrival ETA suppression.

Earlier full runs stopped at existing frontend cold-start timeouts (first 172 passed/five
failed, then 176 passed/one failed). Running unchanged frontend tests alone reproduced
the timeout; one worker still reproduced a first-flow timeout. The first lazy operator
module compilation was being counted inside Testing Library's one-second UI wait.
A small `beforeAll` in the shared test setup loads that module before flow assertions.
App still controls lazy rendering, loading, authentication and requests; no product UI,
test assertion, deadline or test selection changed. This is a required verification
prerequisite fix. The corrected frontend run passed all 177 tests.

The full database runner later reached its aggregate deadline. Its large API group now
has a bounded 15-minute aggregate budget and a safe progress line after the DB group.
Individual 20/30/60-second test deadlines, the 180-second file limit, two-file concurrency,
failure/sensitive-output guards and cleanup remain unchanged. The final complete
`pnpm db:local quality` invocation exited zero:

| Check | Actual result |
| --- | --- |
| Exact toolchain | Node 22.23.2, pnpm 10.34.5, Python 3.12.14; PostgreSQL 18.6 |
| Quality/tenant-isolation gate tests | 33 passed |
| Planning, AST tenant gate, lint and all five workspace typechecks | Passed |
| Testkit and DB unit tests | 22 + 12 passed |
| API integration | 497 passed in 30 files |
| Frontend regression | 177 passed in 10 files |
| Real S3-compatible object contract | 3 passed; disposable service removed |
| Real PostgreSQL integration | 67 DB + 340 API passed; zero failed/skipped/cancelled/todo |
| API and production browser builds | Passed, including browser production-isolation gate |
| Disposable PostgreSQL cleanup | Completed |

After the broader run, the final organization-first selection lock and racing-selection
assertion were verified again: `check:migrations`, `check:planning`, `lint` and `typecheck`
all passed, followed by the focused **13 passed, zero failed/skipped/cancelled/todo** suite.
React `act(...)` warnings remain in existing frontend tests. S3 negative streaming cases
emit expected non-retryable-stream warnings. Both suites passed; these messages are not
silently reported as absent. No production credentials, sends or production UI flow were
used. CI and review have not run for this uncommitted local branch.

All twelve acceptance criteria are **verified in the documented synthetic API/database
environment**. Human relationship evidence and live provider/production qualification
remain operational limits below. Overall GitHub Definition of Done remains pending
commit/publication, CI, review and merge under the user's approval boundary.

## Milestone fit and limits

#47 can use the signed-scope selection and deterministic tracking seam. No router,
WhatsApp reply delivery, receipts/charges/resend tools, quotes, pickups, human queue,
language/AI interpretation or metrics are added. No customer browser surface changes;
browser checks belong to the later routed/customer UI. Production remains disabled unless
the explicit server-only flag is enabled after migration/role setup.

Manual attestation depends on real independent staff evidence; a UUID alone does not
verify a person. Unknown number recycling inside a live binding window cannot be detected
from the channel number alone. Staff can revoke immediately for a known change. The rate
budget is per process, not fleet-wide; #71/#74 must qualify abuse/capacity. Final retention
and privacy deletion remain #72. Live Meta credentials, customer sends and production
rollout are not verified or attempted. CI, independent review and merge remain future steps.

## Draft delivery

Commit: `feat: add verified parcel access and private customer tracking`

See [ready-to-use PR draft](issue-46-pr-draft.md) and [operating contract](customer-access.md).
