# Frontend experience redesign

## Softer blue palette follow-up

Primary action surfaces use light blue `#d7ebf8` (`#c5e2f2` on hover) with dark muted
blue `#355b70` text. Shared primary ink/focus uses `#426c83`; the Tailwind bridge,
booking step labels, service controls and workspace status/selection styling follow
the same palette. Sidebar category headings are gray `#525e70`; icons, including
selected links, folders, brand mark and profile, are gray `#778191`. Active surfaces
are pale `#e2eff8`, with softer blue connector lines and glow. The sidebar remains
`#f0f0f0` and the main surface stays white with its rounded corner.

Calculated contrast ratios: action text 5.94:1, hover 5.39:1, category heading on
selection 5.62:1, sidebar icons 3.46:1, and link text on white 5.67:1. The change is
CSS-only; no commands, routes or tests change. Production build and whitespace checks
pass. The real-browser profile/navigation check verifies computed category/icon/active
colors and actual sign-in button colors, plus the existing eight responsive/profile
captures and real logout; a ninth sign-in image records the light action treatment.

Palette artifact SHA256:
`7b4369a21a0a0c6db3d1f5e9d0e839b669aea2768bbf418c5e40b6deda9c77ca`.
Current evidence: `dist/ui-softblue-build-final.log`,
`dist/ui-softblue-browser-final.log`,
`dist/ui-softblue-browser/page-review-navigation.json` and
`dist/ui-softblue-browser/pages/light-blue-actions.png`. Earlier screenshots below
refer to their recorded preceding artifacts. No commit or push was made.

## Profile and main-surface follow-up

The routine Refresh workspace access and standalone Sign out footer are removed from
the ready workspace. A Profile disclosure now lives at the bottom of the sidebar,
below the franchise identity. It contains the verified account reference, the existing
invitation form and a separated Sign out action. Onboarding and recovery screens have
the same profile disclosure outside the workspace. Access failure still offers a
contextual Try again action, and No available workspace offers Check access; neither
is a persistent action on normal pages. Automatic authority revalidation is unchanged.

The panel exposes native disclosure semantics, closes on Escape or focus leaving it,
and restores focus to its summary on Escape. On mobile the first Escape closes Profile
and the next closes navigation. Private data removal, logout request handling,
invitation secret clearing, and settings/uncertain-command departure guards remain.
The main white surface and its sticky appbar share a 24px top-left corner against the
`#f0f0f0` shell, without clipping sticky content or adding an inner scroll container.

Verification: 394 frontend tests across 48 files pass; the 55 affected operator,
settings and report-navigation tests also passed separately. Operator tests were
repeated after the final onboarding copy cleanup. Frontend typecheck, lint/tenant AST,
planning (344 declarations/17 negative controls), production build and whitespace
checks pass. Existing settings regressions now test profile sign-out departure instead
of the removed footer reload, preserving rejected-departure drafts, zero rejected
logout writes, accepted private-state clearing, history/query and changed-authority
assertions. No tests were removed or skipped.

One real-API/disposable-PostgreSQL browser case passes with eight captures, covering
the desktop and phone profile, native Enter/Escape, panel viewport bounds, menu focus,
901px/900px/390px, reduced motion, 200% CSS zoom, exact sidebar background, both 24px
corner radii, absence of routine footer actions and successful real sign-out. No
overflow, runtime errors or server errors were recorded. Desktop/phone screenshots
were visually inspected; the disposable database container was removed.

Profile artifact SHA256 (before the palette follow-up):
`b3dbd7a7d4dc79b29a6dd7fb9532f81f118032dba1e7c5d28cff1d7c21b66d04`.
Current evidence: `dist/ui-profile-browser/page-review-navigation.json`,
`dist/ui-profile-browser-final.log`, `dist/ui-profile-web-final.log`,
`dist/ui-profile-focused-final.log`, `dist/ui-profile-operator-last.log`,
`dist/ui-profile-typecheck-final.log`, `dist/ui-profile-lint.log`,
`dist/ui-profile-planning.log`, `dist/ui-profile-build-final.log`.
This targeted review supersedes the sidebar evidence below; the broader prior
feature review remains evidence for its recorded preceding artifact. No backend,
database, commit or push changes are part of this follow-up.

## Sidebar tree follow-up

The sidebar now uses five disclosure folders in workflow order: Overview (Workspace,
Reports); Booking & pickups (New Booking, Pickups, Receipts); Shipments (Packages,
Lots, Routes, Parcel custody, Deliveries, E-way); Finance (Money receipts, Expenses
and cashbook, Customer accounts, Agent settlements, Financial approvals,
Reconciliation); Administration (Automation & Messages, Human support, Settings).
Existing permission-filtered links are supplied unchanged; empty folders are omitted.

Overview and the current page's folder start open. Folders expand independently and
the current folder reopens when the route changes. Native buttons expose expanded
state and controlled lists, with ordinary navigation links and `aria-current` on the
selected page. Blue connector lines and a steady stronger glow identify the current
branch. Connector elbows now have a 7px corner radius, including the last branch's
curved termination, and the sidebar background is exactly `#f0f0f0`. There is no
continuous flashing. Mobile navigation focuses the visible
current page, or a visible link/folder when the current folder was collapsed. Escape
restores the menu control. Existing uncertain-command navigation guards remain intact.

Verification: all 394 frontend tests (48 files), frontend typecheck, lint/tenant AST,
planning (344 declarations, 17 negative controls), production build and diff whitespace
checks pass. The changed operator tests open their category before exercising existing
role and revocation assertions. One new regression checks supplied destinations,
independent expansion, omitted categories, callbacks and automatic active-folder opening.

One real-API/PostgreSQL browser case passes with six captures: default and expanded
desktop tree, 901px, 900px, 390px and 200% CSS zoom. Enter toggles folders, selected
links remain current, mobile opening focuses Receipts and Escape restores the toggle.
Reduced-motion transitions are effectively disabled by the existing global near-zero
duration. No overflow, browser runtime errors or server errors were recorded. Actual
desktop and phone screenshots were inspected. The disposable container was removed.

Rounded-sidebar artifact SHA256 (before the profile follow-up):
`1e7cb710eaa696c09e0213883b33923dd8ec159a95a30b55accfb3c1439fbbb6`.
The CSS-only radius/color follow-up was rebuilt and the real-browser case repeated:
all six captures pass, including mobile and zoom; the desktop result was visually
inspected. Evidence: `dist/ui-sidebar-rounded-build.log`,
`dist/ui-sidebar-rounded-browser.log`, `dist/ui-sidebar-browser-final.log`,
`dist/ui-sidebar-browser/page-review-navigation.json`,
`dist/ui-sidebar-web-final.log`, `dist/ui-sidebar-typecheck-final.log`,
`dist/ui-sidebar-lint.log`, `dist/ui-sidebar-planning-final.log`,
`dist/ui-sidebar-build.log`. The comprehensive review below and its 87 earlier capture
checks apply to the preceding redesign artifact; this targeted review supersedes its
sidebar evidence. Backend/database sources were not changed in this follow-up. No
commit or push was made.

## Scope and preservation

Improve every production operator screen and its nested workflows, plus entry/auth,
booking and receipts. Keep existing business capabilities, tenant controls, financial
evidence, feature flags, exact retry identities and navigation guards. No new backend
features or permissions are implied. Demo-only screens retain their existing behavior
and share improved base components where applicable.

The uncommitted #190 baseline (159 paths, HEAD `9a42bb3`) is preserved without a commit
under ignored `dist/ui-redesign-baseline/`: original file copies, hashes and tracked patch.
The earlier `6dde9d5` redesign checkpoint remains separate. No commit/push is authorized.

## Product understanding and evidence

The product serves courier counter operators, outlet owners, dispatchers/agents and
finance staff. The implemented workflows establish their tasks: identify a shipment,
book and dispatch it, record real money, reconcile evidence and recover uncertain writes.
Assume frequent interruptions, repeated lookup, mixed digital confidence and laptop/phone
use as design hypotheses. No field interviews, participant study or measured speedup is
claimed. The previous usability plan in `D:/ShipIT-UI-UX-Research/product/` remains useful
context; its old workflow instructions are not current authority.

Research reviewed 29 October 2026:

- [Linear's March 2026 refresh](https://linear.app/now/behind-the-latest-design-refresh):
  consistent action placement and quieter navigation in information-dense software.
- [Carbon tables, updated September 2026](https://www.carbondesignsystem.com/building-blocks/core/components/data-table/guidelines):
  coherent toolbar, legible rows and explicit actions.
- [Carbon empty states, updated August 2026](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states):
  distinguish first use, no results, completion, permission and configuration problems.
- [W3C tables](https://www.w3.org/WAI/tutorials/tables/) and
  [forms](https://www.w3.org/WAI/tutorials/forms/): semantic headers/captions, persistent
  labels, related input grouping and understandable feedback.
- [Recognition over recall](https://www.nngroup.com/articles/recognition-and-recall/):
  keep identities, choices and consequences visible instead of requiring memorized IDs.

Modern patterns are selected for these tasks, not added as decorative trends. No glass,
decorative gradients, fake AI controls, fabricated metrics or unsupported global search.

## Alternatives and chosen design

Three agents audited logistics, finance and service/reporting screens independently.
They reviewed three alternatives before implementation:

| Alternative | Assessment |
| --- | --- |
| Repeated stacked cards | Too much vertical scanning; forms compete with daily queues. |
| Table-first workbench | Selected: predictable orientation, comparable records, explicit evidence. |
| Permanent three-column console | Too cramped on laptops; comparison layout reserved for reconciliation. |

[Reviewable wireframes](../design/frontend-wireframes.html) show the chosen worklist,
booking, finance, matching, reporting, configuration and empty-state variants. Their sample
values are fictional design content, never application data.

White main workspace; neutral gray grouped sidebar; blue selection/actions. Compact
page header, restrained 1px borders, 8–12px radii, 4/8px spacing, tabular money, meaningful
status text and visible focus. One principal task at a time. Desktop tables retain full
identity/state/amount; narrow screens scroll within named table regions and stack forms.

Page archetypes:

1. Worklist: title/purpose → supported filters → records → real pagination → selected
   facts/actions/evidence. Details stay mounted for retained commands and focus return.
2. Counter: numbered customer/packages/tax sections with desktop review rail; mobile
   stacks the same mounted form. Quote and confirmation remain server-owned.
3. Financial workflow: compact workflow selector, evidence queue, exact supplied summary,
   explicit independent decision/actual-money form. Approval is not payment.
4. Reconciliation: statement evidence beside recorded source, then an explicit decision.
5. Report: filters, captured/as-of/scope context, exact server totals, evidence ledger/export.
6. Settings: grouped configuration rows, source/inheritance and existing guarded editor.

## Feature implementation map

| Feature group | Screens and nested workflows | Owner |
| --- | --- | --- |
| Foundation | Tokens, navigation, page headers, forms, tables, status, loading/error/empty, auth/access | Parent |
| Logistics | Packages/bulk/detail, deliveries/proof, lots/candidates, routes/manifests/events, custody/access/transfers, e-way/history | Logistics agent |
| Counter | Customer/account lookup, package/service, tax, quote/review, issued receipts, private attachments | Parent |
| Finance | Cashbook/closing/locations/handovers/sources, proposals/audit/refunds, receipts/allocations, agent money/statements, customer accounts/credit, reconciliation | Finance agent |
| Insight and service | Dashboard/daily captures, reports and nested reports, messaging/recovery, support, pickups, settings/preferences/editor | Service agent |

Record tables are presentation-only. They never locally sum financial truth, imply a
globally sorted/filtered result from a cursor page, fetch private details for decorative
columns, or invent pagination. Prototype DataTable retains explicitly local behavior.
Support/pickups have no server search/filter producer, so receive no fake search toolbar.
Parcel rows have no destination/carrier/ETA fields, so those columns are not invented.
Operational dashboard counts remain qualified as loaded-page counts; financial captures
remain separately authoritative. Unknown/expired/disabled data is explicit.

## Implementation and verification

Plan: shared primitives and shell first; parallel feature JSX slices with disjoint file
ownership; integrate responsive CSS; review populated, empty, error and uncertain states;
run meaningful component/route tests and complete required checks; real Chromium review
at desktop, laptop and phone widths, keyboard and 200% zoom. Fix findings and repeat
affected checks. No source mutation while a test is exercising it.

Implemented the shared workbench, single responsive navigation, persistent field labels,
semantic record tables, explicit status/loading/empty/error/recovery states and all feature
groups above. Booking uses the same mounted form in the desktop review-rail and stacked
phone layouts. Account/invitation controls remain available in an explicit disclosure.
The current view stays visible inside scrolling workflow navigation without moving the
page or taking focus. Settings retain all 14 configuration keys and their guarded editor.

Prototype DataTable remains explicitly local: chronological ISO date sorting, named
filters, visible zero totals and the exact exported view. Server RecordTable preserves
the producer's supplied order and cursor semantics. No application dependency was added.

Regression changes adapt old concatenated-button assertions to named tables, rows and
cells. Financial tests retain exact amounts, partial reservations, captured positions,
audit before/proposed evidence, revision and allocation-release lineage. Account controls
are explicitly opened and awaited during reauthorization. Five added test declarations
cover field associations, supplied row order/action identity, local table behavior,
navigation focus/Escape/dismissal and truthful submitted receipt searches. The reviewed
inventory contains 343 declarations; all existing scenarios remain represented.

Independent agent visual review found and prompted fixes for the cashbook's implicit
grid minimum expanding the phone page, cramped e-way actions/identifiers, hidden active
workflow buttons, and account-action spacing. A real 900px keyboard check additionally
exposed lazy-loaded legacy drawer CSS hiding an explicitly open sidebar; the open-state
selector now wins that cascade. Visual inspection at 200% CSS zoom caught breadcrumb
text painting beneath the franchise selector despite no document overflow; constrained
ellipsis now preserves the complete accessible title and full page heading. Earlier
screenshots that showed loading were replaced with captures waiting for terminal read
states. Final refinements keep default empty-table text visible in the initial mobile
scrollport and explain an empty reconciliation allocation selection. Wireframe review covers
seven variants and a phone layout without runtime errors or page overflow.

Final real Chromium qualification passed all eight cases with 87 capture checks and
zero failed/skipped/cancelled cases. It covers all 20 top-level routes at 1440px and 390px,
all eight report views, six cashbook views, three enabled reconciliation sections at
desktop/phone sizes, 1024/901/900/390px navigation, focus/Escape and 200% CSS zoom.
Two bookings are persisted under the actual owner and local-admin principals; scope
switching, sibling denial, direct-route denial and live revocation are checked against
real Fastify and disposable PostgreSQL. No API mocks are used.

Saved report output includes populated accountant and ageing tables, an effectiveness
matrix, financial captures, the performance saved-zero-cohort state and settled owner
configuration/history. Empty queue, disabled configuration, unavailable attachment,
access-loss and exact command recovery states are also covered by browser/component
checks. This is representative state coverage, not every possible business-data
combination; populated imports/matches/handovers rely on their existing focused tests
and database contracts in addition to source review.

Local browser evidence: `dist/ui-redesign-browser/verification-summary.json`, per-family
JSON manifests and PNGs; final run `dist/ui-redesign-browser-complete.log`. The offline
`dist/ui-redesign-browser/review.html` gallery selects among 86 distinct screenshots
without a running backend; image loading and feature/viewport selection were checked.
Read-only checkpoint comparison found 127 unchanged non-JSX command/workflow function
bodies across 58 changed feature files, with no unmatched bodies in that comparison.
Event wiring and presentation were reviewed and tested separately; this comparison is
not a substitute for transaction or authorization tests. All 119 checkpoint API, DB and
shared files remain byte-for-byte unchanged by this redesign.

Reviewed production HTML SHA-256:
`79f904740b086182d536a5f2460e2fb80c7d4e9fc291aab4b6c89d7492ddd409`.
Production build: 1,234.23 kB HTML, 334.80 kB gzip. Every final screenshot manifest
matches this artifact; PNG dimensions/signatures and gallery navigation were checked.

Final completed checks:

| Check | Result |
| --- | --- |
| Toolchain | Node 24.22.1, pnpm 10.34.5, Python 3.12.14 |
| Tooling / testkit / DB unit | 44 / 22 / 12 passed |
| API unit/contract suite | 780 passed across 62 files |
| Frontend, repeated after final refinements | 393 passed across 47 files |
| Private S3-compatible contract | 3 passed |
| PostgreSQL schema/DB | 92 passed across 42 files |
| PostgreSQL API, four existing CI shards | 184 + 163 + 149 + 122 = 618 passed across all 84 files |
| PostgreSQL total | 710 passed; zero failed/skipped/cancelled/todo in completed suites |
| Real Chromium, repeated after final refinements | 8 passed, 87 capture checks, zero runtime/server errors or page overflow |
| Planning / lint / all five workspace typechecks / production build | Passed |
| Released migration history | All 55 released files unchanged; forward migration allowed |

Final frontend logs: `dist/ui-redesign-web-final.log`, `ui-redesign-typecheck-last.log`,
`ui-redesign-lint-last.log`, `ui-redesign-planning-last.log`,
`ui-redesign-production-build.log`, `ui-redesign-migrations-final.log`. Existing React
`act(...)` warnings and intentional negative-control/streaming diagnostics remain
visible; no tests are disabled and no assertions are relaxed.

First aggregate attempt (`dist/ui-redesign-quality-final.log`): tooling 44 passed;
planning, lint and all five workspace typechecks passed; testkit 22 and DB-unit 12
passed; API 780/62 files, web 393/47 files and private S3 contract 3 passed; PostgreSQL
schema/DB 92/42 files passed. The monolithic API/PostgreSQL group hit its existing
30-minute Windows aggregate limit; this attempt is not a passing aggregate gate.

The first Windows API shard and an isolated reproduction identified a 60-second timeout
in the unchanged 1,670-receipt boundary test. RAM-backed disposable storage alone was
insufficient. The exact test passed in 39.2 seconds with Node 24.22.1 Linux beside the
same PostgreSQL 18.6 engine, retaining every write and assertion. This establishes a
working execution environment; it does not isolate network, filesystem and OS costs
as separate causes.

All four existing CI API shards then completed in that runtime. Current source bytes
and installed dependency versions were copied unchanged, with Windows dependency
junctions restored as native Linux links. Each job verifies 1,276 source-file hashes;
719 relevant backend, test, runner and manifest files also match the current workspace.
The 84 API files are partitioned exactly once. Linux's original 180-second file and
900-second group limits apply, with individual test deadlines unchanged. No tracked
test infrastructure is modified. At most two isolated Node/PostgreSQL pairs ran together
after CPU/memory headroom was measured. All owned containers were removed.

Evidence: `dist/ui-redesign-database-verification.json`, `ui-redesign-db-shard-plan.json`,
`ui-redesign-linux-api-1.log` through `ui-redesign-linux-api-4.log`, and
`ui-redesign-linux-capture-check.log`. The local launchers/snapshot remain ignored test
artifacts. The successful result is the completed CI-equivalent check matrix above,
not a claim that the monolithic Windows command passed.

Pinned Linux Node image:
`node@sha256:e1582112fb9f152ed38eefcd712efc93fee1becb519fdfa57574d5e07eaa5e7d`.
Pinned PostgreSQL image:
`postgres:18.6-bookworm@sha256:1c59e2c3c818eaa0f0628f695b36e7c9e362d6b219b36a54a32df645cbd7e1af`.

Real participant usability qualification, live messaging provider qualification and
private attachment upload qualification remain unperformed by this UI review. Browser
fixtures use synthetic users, a provider that cannot send and disposable PostgreSQL;
no real customer sends or production data are involved. The independent security/release
and remote CI qualifications documented for #190 are not replaced by UI visual review.
