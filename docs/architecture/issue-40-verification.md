# Issue #40 verification

Implementation branch: `issue-40-notification-automation`, based on refreshed main
`8d1ddeb2c9ec44f7f11a947c89932ffaf695cb47`. Prerequisites #4, #24, #28, #35, #38 and
#39 were rechecked as closed before Issue #40 moved from `status: blocked` to
`status: ready`.

## Acceptance evidence

| Requirement | Executable or structural evidence |
| --- | --- |
| Explicit versioned policies | Closed registry, exact v1 envelope validators and configuration parser rejection cases |
| Durable cutover and version identity | Per-policy code-and-binding hashes; identical, conflicting, new-version, suppression-only and concurrent activation tests; historical-event test |
| Correct authoritative resolution | Booking/Parcel joins; Route fanout solely through immutable `route_parcel_effects` |
| No duplicate Route/transit notification | Shared semantic key plus durable `overlapping_route_cause` suppression test |
| One intent per affected Parcel | Outbound uniqueness includes `affected_entity_id`; Route integration test |
| Consent/template failures visible | #39 state/reason returned to durable blocked/suppressed automation outcomes |
| No provider call in effect | Consumer depends only on SQL resolution and database-only `enqueueMessage`; send remains #39 worker-owned |
| Stale/gap/order safety | Evidence-based sequence reconciliation, `applyStale`, state relevance and transaction-bound #35 receipt |
| Tenant isolation and R16 | Scoped repositories; admin/operator/dispatcher allow, read-only and wrong-franchise denial tests |
| Privacy | Read DTO allowlist excludes payload, phone, rendering, variables, contact key and ciphertext |
| Migration and immutability | Forward migration inventory, append-only triggers, populated outbound identity upgrade and repeat migration gates |

All fixtures use fictional contacts, fake provider adapters and disposable PostgreSQL.
No live Meta request or customer notification is made.

The activation regression suite proves that an exact restart preserves the original row and
timestamp; template, language, variable-set and variable-order changes fail with only
`NOTIFICATION_POLICY_VERSION_CONFLICT`; a new version coexists with the old identity; and
concurrent identical callers converge while different hashes admit only one winner. Hashes
are independent per policy, so a Route binding change leaves the Booking identity valid.
The suppression-only policy activates deterministically without a template. A pending domain
event remains unprocessed when activation rejects, matching runtime composition order:
activation completes before production consumer construction and polling.

## Verification run

The first `pnpm db:local quality` attempt stopped at `check:toolchain` because the host's
default Python was 3.14.5. No later stage ran in that attempt. Python 3.12.14 was then
selected explicitly and the complete gate was rerun with the repository's pinned
toolchain.

| Command | Result |
| --- | --- |
| `node --version` | `v22.23.2` |
| `pnpm --version` | `10.34.5` |
| `python3 --version` | `Python 3.12.14` |
| `pnpm check:toolchain` | Passed with Node 22.23.2, pnpm 10.34.5 and Python 3.12.14 |
| `pnpm install --frozen-lockfile --ignore-scripts` | Passed; lockfile current and no dependency changes |
| `pnpm check:migrations` | Passed; 26 released migrations unchanged and the forward addition allowed |
| `pnpm db:local quality` | Passed against disposable PostgreSQL 18.6, including lint, typecheck, tests and builds |

While expanding the required scenarios, the first focused run exposed three fixture
assumptions: an organization administrator was incorrectly expected to be denied a sibling
Franchise, the arrival request reused a Route-event result as a Route DTO, and missing
consent correctly failed earlier as `contact_unconfirmed`. The tests were corrected without
changing authorization or policy behavior and then passed 7/7. The first #40 failure-
injection fixture also reused an already loaded migration module, so the synthetic error did
not execute; using a fresh copied migration directory then proved rollback and retry.

During the original implementation, two later full-quality attempts reached an unchanged web onboarding test and timed out while
it remained at `Checking workspace access…`; the standalone web suite immediately passed
155/155. No web code or timeout was changed. That original complete quality run bounded
Vitest worker concurrency to one, executed every unchanged check, and passed.

The immutable-version follow-up ran the normal unbounded `pnpm db:local quality` command
successfully; no concurrency override was needed. It reported 29 quality-contract tests,
22 testkit tests, 12 database unit tests, 477 API tests, 155 web tests, 3 object-store
contract tests, and the final PostgreSQL matrix of 64 database plus 279 API tests. All
reported zero failures, skips, cancellations and todos where the runner exposes those
categories, and both production builds passed. The final planning, diff and remote CI
results are recorded after the last documentation-only edit and PR publication.
