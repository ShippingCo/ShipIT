# Issue #14 verification

## Implemented surface

- Seven closed-list roles with Organization and exact Franchise membership scopes.
- Identity-bound, 256-bit, digest-only, seven-day, single-use invitations.
- Safe list, invite, accept, invitation revoke, membership update and membership revoke APIs.
- Live per-request membership authorization, no role cache or client tenant claim.
- Self-change and final-administrator protection with transactional concurrency control.
- Transactional redacted membership audit rows and least-privilege runtime grants.

## Required evidence

The final local verification must pass API typechecking, lint, all Vitest suites, all real
PostgreSQL migration/API suites, build, migration-history checks and repository quality
gates. Database tests cover two Organizations and three Franchises, every HTTP endpoint,
foreign/unknown equivalence, wrong identity, expiry, reuse, concurrent acceptance,
concurrent administrator removal, stale versions, restart persistence, immediate
revocation, CSRF and token/log/audit redaction.

## Final local results

| Check | Result |
| --- | --- |
| Full `pnpm db:local quality` | Passed in one clean disposable PostgreSQL run |
| API Vitest | 97 passed, 0 failed |
| Testkit and DB unit tests | 33 passed, 0 failed |
| Web regression tests | 24 passed, 0 failed |
| Real PostgreSQL migration tests | 26 passed, 0 failed/skipped/cancelled/todo |
| Real PostgreSQL API tests | 23 passed, 0 failed/skipped/cancelled/todo |
| Repository quality protocol tests | 10 passed, 0 failed |
| Toolchain, typecheck, lint and production build | Passed |
| Planning contracts and migration-history guard | Passed; three released migrations unchanged and the Issue #14 migration is forward-only |

Every disposable database container was removed by the guarded runner after its test.
