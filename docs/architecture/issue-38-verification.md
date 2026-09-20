# Issue #38 verification

Branch: `issue-38-scoped-messaging-consent`, from clean, freshly pulled main `4da7c8f`.
#37 was verified merged as PR #121, with an identical implementation tree and seven
successful remote checks. #36 PR #120 and the complete available #37 task were read.
Implementation and local verification completed before publication. The maintainer
subsequently authorized committing, pushing and merging after remote checks.
Production data changes remain outside this work.

## Acceptance mapping

| Requirement | Evidence |
| --- | --- |
| Unknown is not opt-in | Pure policy matrix and empty real-database customer |
| STOP after queue suppresses dispatch | Queued eligible observation, pending STOP denial, committed revocation denial |
| START has affirmative context and precedence | Closed parser and same-contact disclosure reference checks |
| Same phone isolated by franchise | A/B fixtures, private owner joins and keyed installation-specific contact identity |
| Phone edits do not transfer consent | Change phone and restore old number; contact generation remains invalid |
| Source/policy evidence persists | Immutable source receipts, audit projection and fresh-pool history |
| Expired window requires template | Fake-clock exact 24-hour and 15-minute boundaries, current category/credential/variables |
| Operational exceptions reviewed | Delivery OTP explicitly denied until #42/authentication-template integration |
| Duplicate callback has one effect | Source inbox uniqueness, independent receipt and concurrent worker tests |
| Invalid/foreign data controlled | Real sibling/unrelated scopes, read_only and unknown IDs, malformed policy |
| Minimal private data | History omits phone/text/ciphertext/provider identity; restricted runtime privileges |
| Migration compatibility | Additive schema, updated historical inventories and populated upgrade tests |

## Executed checks

Executed on 2026-09-20 with Node 22.23.2, pnpm 10.34.5, Python 3.12.14 and
disposable PostgreSQL 18.6:

| Check | Result |
| --- | --- |
| Full `pnpm db:local quality` | Passed on corrected rerun; test services removed |
| Toolchain, planning, domain/security contracts and tenant-query gate | Passed |
| Tooling tests | 29/29 passed |
| Testkit/database-runner unit tests | 22/22 and 12/12 passed |
| Full API suite | 469/469 passed |
| Full web suite | 155/155 passed; existing React act warnings remain |
| Full PostgreSQL suite | 63 DB + 257 database-backed API passed; zero failed/skipped/cancelled/todo |
| Object-store contracts | 3/3 passed; expected fault-injection streaming warnings remain |
| API and production web builds | Passed |
| Migration history | Passed; all 24 released migration files unchanged |
| Final focused PostgreSQL rerun | 15/15 passed: eight consent scenarios, six migration cases and the populated #37 upgrade |
| Final lint, all-package typecheck, planning and whitespace checks | Passed |
| Remote CI / independent PR review / verify:gates | Not run; publication is not authorized |

Initial focused runs passed 21 policy API tests and four PostgreSQL scenarios.
The first sandboxed Docker attempt could not start/clean up the environment; the
approved escalated disposable runner succeeded. The first full quality run failed
the expected table inventory, which omitted the three new consent tables. An expanded
13-case diagnostic run also loaded the old expectation: 12 passed and that inventory
case failed. The fixture was corrected, the full quality rerun passed, and the final
15-case diagnostic verified the correction. No failure is represented as a pass.

Final review aligned organization/franchise/installation/customer lock ordering,
separated SQL into the consent repository, included unsupported inbound quarantine
in suppression, and used the preexisting updated_at as the conservative upgrade
contact boundary. The full suite and final focused results are distinct: the latter
ran against the final source, including that upgrade refinement. Final lint and
typechecking passed; production builds passed at the end of the full quality run.

Local commands use the preexisting `node_modules/.cache/issue35/run.ps1` to select
the pinned tools. Focused PostgreSQL runs use the adjacent `focused.mjs` through
`pnpm db:local node --experimental-strip-types`, with the repository preflight,
unique resource registry and registered cleanup. The final three files were
`apps/api/test/database/whatsapp-consent.test.ts`,
`packages/db/test/integration/migrations.test.ts` and
`packages/db/test/integration/whatsapp-consent.test.ts`. The maintained full quality
command discovers these files independently of that local diagnostic helper.
No test timeout, production-data guard, discovery rule or existing assertion was weakened.

## Limits

The API was started on a real loopback HTTP listener against the disposable database;
signed callback delivery, a fresh application/pool, persisted history and current
suppression were exercised. No real customer message or live Meta callback was sent.
#39 owns the actual outbound
queue and delivery-backed disclosure recording; its future send path must call this
policy again. Fixtures insert fictional disclosure evidence with the migration role.
No operator override or public consent-write path exists. Full retention/recovery UI,
natural-language consent interpretation and shipment-scoped customer tools remain
with their owning issues. The fictional demo is unchanged and never imported.

[Design/research](../adr/0026-scoped-messaging-consent.md) · [Runbook](messaging-consent.md)
