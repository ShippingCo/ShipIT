# Issue #56 acceptance and verification

Date: 2026-10-03 (IST). Branch: `issue-56-akash-ganga-research`.
[Report](../integrations/akash-ganga-research.md) · [PR draft](issue-56-pr-draft.md).

## Context and base

Read the full #56 issue (no comments) and M5 milestone 6/associated #53–#60 issues.
Actual prerequisites are #2/#6/#53, all closed with merged contracts; #55 is a reusable
completed path, not an inferred prerequisite. #56 remains a research issue and blocks
only #60's path-selection research gate. Its tracker label was still `status: blocked`
at inspection; no tracker status change is made by local work.

Recovered reasoning and final verification from Codex chats **Implement issue #53**,
**Implement issue #54**, and **Implement issue #55**, including the M5 sequence,
manual W26 restriction, pending claims, immutable mappings, scoped replay, generic CSV
limits and corrected migration-test runs. No separate M5 planning chat was identifiable
in the available conversation listing; #53's planning discussion, current milestone and
approved finance plan provide the relevant decisions. No missing context blocks research.

Working tree was clean. Checked out main, pulled it with fast-forward only and branched
from `b0061166a5bb92e848a237dab870405d23a947ed`, merged [PR #155](https://github.com/ShippingCo/ShipIT/pull/155)
for #55. No commits follow that merge in the selected base. #53/#54 merges are ancestors.
At start the base had five successful quality jobs; PostgreSQL integration was in progress.
Subsequent inspection confirmed **all seven base checks passed**, including PostgreSQL
integration and `Planning and prototype checks`. This is base-commit CI only, not CI for
uncommitted #56. Merge ancestry was also checked for #2 (`256512a`), #6 (`36ce6d3`),
#53 (`07c667c`) and #54 (`cefdc1a`). Historical #55 results remain context, not local
verification for this branch.

## Nine-step record

1. History: authoritative tracker plus repository instructions and recovered #53–#55
   decisions; dedicated branch from newly pulled merged #55.
2. Database: reviewed carrier schema, composite FKs, unique docket/receipt/source keys,
   indexes, scoped services and import access. Research needs no migration or data write.
3. Acceptance: dated access evidence, independent capabilities, explicit unknowns,
   no-go decision, usable fallback, outcomes and #60 completion boundaries.
4. Research: read public carrier informational sources; record inaccessible legacy
   hostname and index-only partner evidence. Reuse/check AWS, Microsoft and DB practices.
5. Challenge: no public docs cannot prove no private API; generic CSV is not a carrier
   export; public terms do not authorize machine use; source claims cannot become proof.
6. Approach: one evidence report, linked acceptance/PR notes and existing planning checks
   covering the new integration-document directory. Manual recommendation; no runtime change.
7. Delivery: report and concise links; no carrier fixture, invented endpoint, SDK, UI,
   secret/configuration change, outreach or production operation.
8. Verification: source review, contract comparison, four-outcome review, documented
   missing-access walkthrough and repository checks recorded below.
9. Review package: report, limitations, setup/test guidance and ready-to-use PR text;
   commit/push/PR/merge remain outside current authorization.

## Acceptance mapping

| Criteria | Evidence / state |
| --- | --- |
| Precise carrier; dated primary evidence, confidence and classification | Report identity and C1–C11; locally verified within explicit retrieval limits |
| Authentication/contact/sandbox/limits/fees/rights | Report access table; unknowns explicitly owned with conditional next actions |
| Tracking/booking/rates/webhooks/file/manual independent | Capability table; separates carrier evidence, chosen pilot and generic runtime flags |
| Formats, service/location IDs and reconciliation limits | No carrier sample invented; exact-code/unknown-time/reference rules compared to existing contract and services |
| Compare cost/risk and explicit GO/NO-GO | Alternatives and research-to-decision tables; live NO-GO, outcome `api_unverified`, pilot `manual` |
| Usable missing/refused-access fallback | Six-step manual workflow; existing authenticated routes/persistence, not a live carrier demonstration |
| Four outcomes; unknown access does not prevent research closure | Conditional outcome table covers live/file/manual/api_unverified; review complete locally |
| All network/file false manual path can satisfy research prerequisite | Manual adapter contract supports it; generic CSV listing distinction explicit. #60 still needs its other prerequisites/review |
| Future access is revisit condition | Separate future scope; no automatic reopening or claim of API acquisition |
| Security/privacy and permissions | No credentials/customer payloads or carrier lookups; W26/R19/foreign-ID boundaries preserved and regression-tested |

Local acceptance review is complete in the report; independent reviewer acceptance and
GitHub lifecycle remain pending. No real carrier permission, booking, export, API call,
POD, webhook or performance qualification is claimed. Source links can change after this
date; C5 is indexed evidence and C11 a retrieval failure, not successful page checks.

## Checks and reproducible review

Follow-up deep lookup on 2026-10-03 adds provider-owned evidence D1–D5: AfterShip and
Shipway tracking leads, the missing AfterShip carrier-table match, historical Shipway
API/version limits and conflicting TrackingMore claims. Direct carrier access remains
unverified. No API calls, accounts, outreach or tracking-page scraping occurred. Only
the report and delivery notes changed; final planning/local-link and whitespace checks
were rerun. The full aggregate below predates this documentation-only follow-up; runtime
and checker code are unchanged, so no new full aggregate is claimed.

Completed early checks: pinned toolchain, planning/local links, migration history
(38 released files unchanged), clean whitespace diff and **48 focused carrier tests**
(23 contract, 11 manual-boundary, 14 CSV). Fault checks inserted a temporary document in
the new directory: both a broken local link and an unclosed fence returned the expected
nonzero diagnostic; the probe was removed and positive planning passed again. The first
probe wrapper matched slash separators on Windows and needed a platform-neutral match;
the validator correctly rejected the broken link throughout. No gate was weakened.

The full **`pnpm db:local quality` passed (exit 0)** on the uncommitted #56 diff over
the base above. Runtime code, fixtures, migrations and the validation script stayed
unchanged throughout. Evidence-only delivery notes were finalized afterwards and the
positive planning/local-link check and whitespace review rerun on those final files.

| Stage | Actual local result |
| --- | --- |
| Toolchain | Node 22.23.2, pnpm 10.34.5, Python 3.12.14 passed |
| Tooling/security tests | 35 passed, zero failures |
| Planning, tenant query gate, ESLint | Passed |
| Typechecks | All five workspace packages passed |
| Testkit / DB unit | 22 / 12 passed |
| API / web | 638 / 189 passed |
| Private object storage | Three passed; disposable container removed |
| PostgreSQL schema/DB / API database | 69 / 399 passed, zero failed/skipped/cancelled/TODO |
| API and web production builds | Both passed; 168 web modules, single-file build |
| Outer quality command / cleanup | Exit 0; disposable PostgreSQL container removed |
| Separate migration history | 38 released files unchanged |
| Focused carrier tests / negative doc probes | 48 passed; both expected checker rejections verified |

Logs use ignored `node_modules/.cache/issue56-*.log`; no secrets or live shipment data
are included. Existing React `act(...)` warnings remained visible in the passing web
suite; no assertions, timeouts or gates were weakened. This is a successful full local
aggregate, plus early focused checks and final documentation checks, not new branch CI.
Unrelated untracked `artifacts/penpot-design/` files appeared during the run and were
left untouched. Only the five intended #56 files belong in a later commit.

Supported Windows runtime: reuse `node_modules/.cache/issue35/run.ps1`, with Node
22.23.2/pnpm 10.34.5/Python 3.12.14 and existing Docker test wrappers. Linux/other hosts
use the ordinary pinned-toolchain commands:

```sh
pnpm --filter @shippingco/api test test/integration/carrier-contract.test.ts test/integration/carriers.test.ts test/integration/carrier-csv.test.ts
pnpm check:planning
pnpm check:migrations
pnpm db:local quality
```

For self-review, read the decision and evidence table, open C1–C10 informational URLs
without submitting forms or tracking requests, and note C5/C11 limitations. Compare each
selected flag with the v1 port and existing manual adapter. Walk through the current
private-API-unverified row: no credentials → live NO-GO → local manual reference and
pending claim → research eligible after review. The existing fictional carrier tests
exercise those ShipIT operations; none substantiates an Akash Ganga API.

No new contract fixtures justify carrier-specific schema tests. Existing unit/API and
real PostgreSQL regressions verify the reused behavior. No changed UI requires browser
or accessibility tests. No live-provider tests or outreach are authorized/required for
this no-go research outcome. Full local checks do not constitute new CI or external review.

## Setup and boundaries

No migration, dependency, configuration, credentials, installation creation or deployment
is required for #56. Reusing #54/#55 later requires their already documented migrations
and grants; this report neither applies them to production nor changes their rollout.
The only tooling change extends existing Markdown fence/local-link checks to
`docs/integrations`. Research documents are now checked alongside architecture/ADRs.

Deferred: #57 Maruti research, #58 reconciliation/transition review, #59 rate imports,
#60 actual supported-path demonstration/health/runbook and authorized commercial access.
No later issue, milestone or external-review gate is marked complete.
