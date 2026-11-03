# Frontend experience redesign

## Blue studio design refinement — 1 November 2026

The follow-up proposal adds a more distinct blue identity and deeper interactive
examples. It remains a design prototype, not a production rollout. Simple English,
white content, the #f0f0f0 sidebar and open form sections remain the baseline.

Research consulted in this pass:

- [Atlassian chart colour guidance](https://atlassian.design/foundations/color/data-visualization-color): one main chart colour, neutral text/grid and additional colours only when they communicate a difference.
- [Shopify empty-state guidance](https://shopify.dev/docs/api/app-home-ui-extension/latest/web-components/feedback-and-status-indicators/empty-state): explain why results are absent and provide an appropriate recovery action.
- [GOV.UK check-answers pattern](https://design-system.service.gov.uk/patterns/check-answers/): review entered information and provide specific edit actions before submitting.

Mobbin's public entry page was checked, but its screen library was not exposed to the
available web reader. No claim is made to have reviewed gated Mobbin screens.

Product decisions made concrete in the new preview:

| Decision | Result |
| --- | --- |
| Blue with clearer hierarchy | #2868c7 primary, #2059ad hover, #edf4ff supporting surfaces; optional Ocean #176fa0 comparison via design controls |
| Charts answer a business question | Seven daily bars for bookings or billed rupees, zero baseline, labelled dates/units, exact daily table; no invented percentage uplift or decorative donut |
| Separate time periods | Today metrics are labelled separately from the 26 Oct–1 Nov sample trend; received money remains separate from billed amount |
| Actionable home | Ready-to-send parcels, delivery follow-up and customer dues lead to relevant areas; recent bookings offer explicit View actions |
| Complete example booking path | Saved sample customer, receiver, parcel/service, editable review, illustrative charge, example confirmation, receipt view and payment follow-on |
| Complete example receipt path | Payer/amount/method/account/receiver/evidence, review, edit and simulated confirmation; method changes update the example receiving account |
| Mobile tables | Booking rows reflow to show tracking/customer, destination, status, charge and View without hiding actions beyond horizontal scrolling |
| Working list controls | Sample status/date/search filters, invalid date-range feedback, result count, no-match state and reset; applied filter state persists across detail navigation |
| Sign in | Standalone email/code composition, sample invalid-code recovery and example entry; no email delivery or real authentication |

The prototype explicitly labels its fixed ₹236 example charge as illustrative. It
does not calculate rates or tax from entered fields. The three-step booking example
assumes a saved billing profile; new-customer billing setup and multi-parcel editing
remain outstanding. Advanced delivery, report and finance tools are task entry points
with clear unimplemented-workflow messages. No production data or writes are involved.

Verification uses `dist/check-blue-studio.cjs`. It exercises chart totals, booking
validation/back/review/confirmation, receipt review/edit/confirmation, search/status/
date filters, empty recovery, sample OTP error/success and seven destinations at
1024/736/390/320px. A 320px overflow discovered in the first run was corrected and
the full prototype checks rerun. Desktop, mobile, review and sign-in screenshots are
local ignored evidence. These checks validate the prototype only, not backend
integration, production accessibility conformance or representative-user usability.

## Simpler business workspace proposal — 1 November 2026

Status: researched, clickable design proposal; not a completed application migration.
The user selected **simple English only**. This proposal responds to the current
interface feeling complicated, and supersedes the earlier tree-navigation direction
as a design proposal. The earlier implementation and verification records below remain
historical evidence. No new production feature, database change, commit or push is
included in this design pass.

### Product direction

Design for owners and counter staff who know courier work but may be unfamiliar with
software terminology. Reading ability, device use and accounting responsibilities
vary; do not treat Indian SMEs as one uniform persona. Prioritise familiar tasks,
recognisable labels and recovery from mistakes over decorative effects.

The reviewed evidence includes current route/component code, ROADMAP, ISSUE_INDEX,
booking and finance architecture, and GitHub issues #190, #22, #138 and #148. This is
not a claim to have reread every issue. Current issue permissions take precedence
over historical operator-only booking descriptions in older documents.

Research basis: [NN/g's lower-literacy usability research](https://www.nngroup.com/articles/writing-for-lower-literacy-users/)
supports short language, prioritised content, a main reading column and simpler
navigation. [Microsoft Research's field studies](https://www.microsoft.com/en-us/research/project/uis-low-literate-users/)
also discuss difficulty with hierarchical navigation and the value of iterative
evaluation. These are general research inputs, not validation with ShippingCo's own
customers. English-only remains the user's explicit choice; voice, Hindi and other
localisation are not silently introduced.

### Complete feature map

Keep the route contracts and permissions while regrouping destinations around work.
The owner preview shows the broadest menu; actual staff see only permitted tasks.
The navigation does not grant access and must never replace server authorisation.

| Primary area | Main job | Existing features retained underneath |
| --- | --- | --- |
| Home | Start work and see what needs attention | Operations dashboard, authorised daily sales snapshot, links to relevant queues |
| Bookings | Book or find a parcel | New booking, multi-parcel booking, packages/search/detail, saved booking receipts, attachments |
| Delivery | Move parcels and resolve problems | Pickups, lots, routes, custody and handovers, deliveries, recovery/returns, e-way records |
| Money | Record payments and manage dues | Money receipts, advances/allocations, customer account bills, expenses/cashbook, day close, agent settlements, bank matching, financial approvals/refunds/corrections |
| Customers | Reuse customer information | Existing customer lookup/create/update, linked bookings and permitted account/bill/payment details; unified landing page still requires implementation |
| Reports (secondary) | Answer a business question | Existing sales, finance, operational and saved-source reporting/export capabilities |
| Settings & help (secondary) | Set up the business or get help | Business/branch settings, staff/access, rates, payment accounts, preferences, messaging/consent/automation and human support |

Keep sign out inside Profile. Sign-in preview is a prototype switch, not a proposed
signed-in navigation destination. The branch identity stays visible. Switching branch
must retain current private-data clearing and uncertain-command departure guards.
The main sidebar action is Book a parcel; a secondary Create menu can expose permitted
pickup and receipt actions without forcing users to choose a module first.

### Flow decisions

**Sign in:** email, send code, enter the existing eight-digit code, then choose a branch
only when necessary. Preserve generic account-eligibility responses, resend cooldown,
expired/incorrect code recovery, paste support, current security and session handling.
Do not simulate a sent code in production. The preview only demonstrates the email
screen and explicitly says it sends nothing.

**Home:** three frequent actions: book, find, record payment. Show bookings, billed
amount and receipts as separate figures with a clear date/cutoff. Attention rows link
to actionable work. Use the existing daily snapshot service rather than calculating
shop totals from the first page of parcels. Its explicit capture, expiry and source
semantics still apply; automatic live totals are not assumed. First-use, no-work-due,
failed-to-load and access-unavailable are different states.

**Booking:** People → Parcel → Check & save is the proposed common path. Ask one
group of related questions at a time. Sender and parcel receiver remain different
records. Regular customers are explicitly selected from authorised search results;
typing a phone number is not proof of identity. Put name and phone before optional
address, show optional markers and avoid repeating instructions on every field.

Parcel details use kg in the interface and exact integer grams at the boundary.
Destination choices must come from permitted published rates, not an unrestricted
city guess or an assumption that a PIN code equals a destination key. Keep service
labels consistent. Require the docket on each parcel label and retain leading zeros. Multi-parcel bookings retain
the existing 1–50 limit, individual receiver/weight/docket details and shared
destination/service. Add another parcel should open one editable row at a time;
completed parcels become readable summaries, editable without losing the others.
The present preview demonstrates one parcel; the multi-parcel editor is still to build.

Review shows editable people/parcel summaries, the actual server quote, tax, final
charge, bill-to arrangement and what happens next. Required missing billing facts
open a focused correction section; no silent GST state, registration, service-recipient
or evidence-reference defaults. Sender, parcel receiver, service recipient and debtor
must remain distinct where the contract requires them. Three steps are not a reason
to omit legally/business-required information. The preview deliberately blocks Save
when those facts are unavailable; it is not a working three-step booking integration.

After confirmed save, show tracking numbers and charge, then Print receipt, Record
payment and Book another. Selecting a payment method is not a receipt. A request with
an uncertain result must recover/retry the retained command, never start a replacement
booking automatically. Preserve quote invalidation, idempotency and draft-loss guards.

**Find a parcel:** one labelled search, readable status, sender and destination, then
View. Keep rare filters behind a labelled Filters button with applied-count summary,
Apply and Clear actions. Detail leads with current status and the permitted next
action; charges, receipt history, documents and audit details follow. Search must not
promise fuzzy or combined name/phone capabilities before supported by the data layer.

**Delivery:** task pages for Send parcels, Check deliveries, Resolve a problem and
Arrange a pickup. Use visible selection counts and a review before handover. Preserve
agent/route eligibility, authoritative parcel states, evidence and delivery-proof
requirements. A simple action name must not turn multiple independent transitions
into an unreviewed bulk command.

**Money:** choose payer, enter rupees, select method/receiving account, record receiver
and applicable evidence, review allocations/advance, confirm. Keep received,
bank-verified, allocated, refunded and outstanding amounts distinct. Account, receiver
and evidence fields are conditional on actual contract requirements, not hidden to
make a shorter screenshot. Corrections and refunds retain existing independent
approvals, immutable evidence, scopes and uncertain-command recovery. Day close
explains counted cash and difference before submission.

**Customers:** search, select a recognisable customer summary, then choose Book a
parcel, Bookings or permitted Bills & payments. Existing name/phone search uses a
search_by parameter. A combined field needs explicit query interpretation or API
composition, including paging and ambiguity handling. Do not expose account details
to staff who only have customer lookup permission.

**Reports/settings:** use business questions for report entry points; preserve source
rows, definitions, period/cutoff, snapshots and exports. Settings remain discoverable
but outside routine task forms. Use a readable summary before changing a sensitive
setting and show confirmed outcome or actionable failure.

### Shared component specification

| Component | Design and behaviour |
| --- | --- |
| Surfaces | White content, #f0f0f0 sidebar, 24px main corner; headings/dividers/space group forms without nested bordered cards |
| Type and spacing | 15–16px body/input, 14px labels, 13px help, 20px section titles, 26–29px page title; 4px spacing scale, 18–24px field gaps, max ~610px reading/form column |
| Actions | Pale blue #d7ebf8, #355b70 text, #c5e2f2 hover; one main next action per task, labelled secondary actions, explicit pending/disabled states |
| Icons | Existing consistent icon set in production; grey decorative icons always paired with action text; no essential icon-only actions |
| Search | Visible label, useful example, submit/Enter, clear, pending, result count and recoverable no-match state; preserve applied versus draft filters |
| Filters | Few frequent shortcuts; optional panel for advanced fields; Apply/Clear and applied summary; no misleading client filtering of a partial server page |
| Date range | Readable day/month/year and IST meaning; Today/This week shortcuts, start/end validation, keyboard entry and mobile support; native picker baseline, custom calendar only with equivalent accessibility |
| Dropdown | Native selection for short lists or tested Radix equivalent; searchable authorised choices for long lists; distinct loading/no-options/failure/selection states; keyboard, Escape and focus restoration |
| Tables | Quiet separators, sentence-case headers, tabular right-aligned money, meaningful primary/secondary text, explicit View action, paging and applied-filter context; narrow screens prioritise essential columns |
| Empty state | Distinguish new business, no matches, no work due and no access; short explanation plus the appropriate permitted action; failure is never presented as zero data |
| Validation | Short field-specific error, linked with aria-describedby/aria-invalid, focus first invalid field, keep entered values; server rejection remains authoritative |
| Feedback | Loading preserves layout; confirmed success supplies next action; retryable failure explains recovery; uncertain writes use their own state and original request |
| Mobile | Compact Menu disclosure, active location, large labelled controls; no full navigation wall above the form; no hidden essential action or page overflow |

### Implementation dependencies and sequence

1. **Foundation and navigation:** finalise task labels/feature map, shared control
   states, responsive shell and role matrix. Retain all existing reachable routes;
   verify direct access, branch switch, keyboard navigation and Profile/sign out.
2. **Booking:** connect customer selection, authorised destinations and supported
   services; introduce exact kg/gram adapters; complete multi-parcel editing and
   conditional billing facts; integrate quote/review/save/recovery with current
   workflow rather than replacing transaction logic.
3. **Home and finding work:** compose existing daily snapshot and operational sources
   without representing loaded-page counts as shop totals. Implement meaningful
   attention links, server search/filters, first-use and failure states.
4. **Delivery:** migrate pickups, parcel groups, routes, custody, deliveries and e-way
   tasks using the shared list/detail/review pattern and current proof/transition gates.
5. **Money and customers:** migrate receipts, allocations/advances, dues, cashbook,
   close, settlements, bank matching and approvals; add the unified customer landing
   page without expanding staff permissions. Use exact rupee/paise conversions.
6. **Reports/settings/sign-in:** simplify task entry and progressive detail; retain
   source evidence, settings safety, OTP behaviour and account/session security.
7. **Qualification:** per-feature component and integration checks, full required
   suites in a working DB/object-store environment, browser interaction/state review,
   and representative owner/counter-staff usability sessions before calling it done.

The API already supports customer lookup, booking commands and daily report
snapshots. Reuse these capabilities. New destination options, saved billing-fact
selection, consolidated attention queues and customer context require a contract audit
before deciding whether an endpoint change is needed. Do not claim the entire backend
must be rebuilt, or that a visual-only change can supply missing facts.

### Design-pass verification and limits

The local preview covers Home, first-use Home, Bookings/search/detail, Delivery task
entry, Money task entry/receipt layout, Customers, Reports, Settings/help, sign-in and
single-parcel booking. Examples are fictional. No code is sent, booking saved or money
recorded. Detailed delivery/finance/settings commands, live search/date filtering,
multi-parcel editing, a complete OTP flow and real quote/save still need design and
implementation. Task buttons explicitly disclose unimplemented detail screens.

`dist/check-simple-workspace.cjs` checks script syntax, seven navigation destinations,
booking validation and error association, next/back value retention, empty-search
recovery, sample status filtering and matching parcel detail, sign-in simulation,
mobile menu and widths 1024/736/390/320, with no page runtime errors. Desktop home,
desktop booking and mobile booking screenshots were visually inspected. A first-pass
search failure in the sandbox was fixed and the browser checks rerun successfully;
mobile navigation was then compacted and checked again.

This does not replace the existing application test suite or validate real-world
usability. The preceding implementation's 398 passing frontend tests and unavailable
Docker/database checks remain separately recorded below, not attributed to this new
prototype. Keep current changes uncommitted until the user approves.

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

## Booking experience implementation (November 2026)

The guided booking view presents Sender, Parcels & service, Billing & tax, and Review on a white surface without nested form cards. All sections remains available for experienced counter staff. Draft fields remain mounted across steps, and existing server validation, pricing, tax, payment and uncertain-request behavior remain authoritative. Validation failures reveal the full form before focusing the invalid field. Each parcel shows a required docket field. Price overrides stay collapsed until needed.

Shared controls include a permission-filtered Create disclosure built with Radix DropdownMenu, a finite-choice Radix Select, and a controlled search field whose clear action neither submits nor discards applied server filters. Existing native date inputs retain platform keyboard and mobile behavior. This is not yet a custom calendar rollout. The shared form, filter, empty-state and dashboard styles retain white content, a #f0f0f0 sidebar, restrained blue actions and explicit keyboard focus.

Research references: [Shopify empty search results](https://shopify.dev/docs/apps/build/app-home/migrate-from-polaris-react/empty-search-result) distinguish completed empty queries from first-use states; [WAI combobox guidance](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/) informs keyboard and focus behavior. These references inform interaction patterns, not copies of another product's visual identity.

Browser verification uses the actual production bundle with fictional counter fixtures, not the earlier HTML mockup. The Create menu, custom search-method choice, booking step navigation and 390px viewport were exercised. Screenshots are local ignored evidence under dist/booking-guided-desktop.png, dist/booking-guided-mobile.png and dist/booking-create-menu.png. Remaining work includes broader page-by-page visual review and deciding whether a custom calendar adds value over native date entry.

Validation for this rollout: 398 frontend tests across 49 files pass on the final source. Frontend production build, TypeScript, lint/tenant-query gate and planning checks pass. Browser review also exercised package date shortcuts and empty-result recovery. The aggregate quality run exposed a dashboard link-count assertion, which was corrected to verify the newly added booking action; the final full frontend rerun passes. Full quality is not green: attachment contract infrastructure cannot start because Docker Desktop Linux engine is unavailable, and the database runner reports DB_TEST_CONFIG_INVALID. No backend code, migrations, commit, push or deployment is included.

## Blue Studio application rollout (November 2026)

This rollout implements the approved HTML design in the production React application. It supersedes the four-step booking description above: the booking flow now has three stages, People, Parcels & service, and Review & save. All sections remains available for experienced staff. The scope is the authenticated business application and sign-in, rather than the fictional WhatsApp demo.

The shared visual system uses white content, a #f0f0f0 sidebar, cornflower blue #2868c7 actions, #edf4ff selection surfaces, open sections and consistent field labels, help, focus, loading and recovery states. White text on the primary action has 5.39:1 contrast. Input boundaries and small sidebar category text were strengthened after review. Native date inputs retain platform keyboard/mobile behavior; finite-choice custom dropdowns and the Create menu use Radix focus and keyboard handling.

Navigation is shallow and task based: Overview, Bookings, Delivery, Money, Customers, Reports and Settings & help. Delivery and Money have permission-filtered task landing pages; contextual tools preserve access to all existing routes. The Create menu includes only permitted booking, pickup and receipt tasks. Mobile Create focus remains in the expanded navigation while its portaled menu is open, and Escape returns focus in two stages.

The customer directory searches the existing scoped API, explains exact name-prefix matching, supports pagination and links a selected customer into booking or their parcel search. It never treats a phone number or browser query as identity. Booking uses currently published destination/service choices, exact kilogram-to-gram and rupee-to-paise adapters, explicit billing/tax facts, editable review, and the existing server quote, save and uncertain-request behavior. Saved tax profiles are not present in the current customer contract; required tax facts remain explicit rather than being invented.

The overview separates operational loaded-page counts from financial snapshot totals. Daily reports initially show three primary measures with other figures available on demand. The seven-day chart reads every page of one saved booking report, verifies snapshot consistency, unique rows, IST dates, complete count and exact billed totals, and only then draws bars. It retains same-snapshot retries for transient page errors and offers fresh capture for expired/inconsistent evidence. An uncertain capture retains its exact command identity. Billed money uses exact integer arithmetic and is not presented as money received.

Operational worklists use compact search, disclosed filters, explicit no-match/first-use/retry states and labelled stacked rows on mobile where the table is narrow enough. Wider financial evidence remains horizontally scrollable. Custody places everyday handover work before agent administration. Finance includes a payment review before confirmation, exact bill allocations, an edit path with focus return, and explicit account configuration actions. Settings groups are collapsible while active drafts and errors remain visible. Report selection presents business questions and puts technical scope detail behind a disclosure.

Review fixes include disclosure padding, visible field boundaries, mobile navigation focus, receipt edit focus, terminal weekly-report recovery, mobile agent access tables, clearer empty payment-method prompts and removal of irrelevant empty approval forms. Existing server permissions, evidence, money, booking/payment separation and exact uncertain retries remain authoritative. No backend endpoint or migration is introduced by this UI rollout.

Shared RecordTable markup supplies explicit table, row-group, row, column-header and cell roles to preserve semantics when mobile rows are stacked. The Chromium browser check waits for the loaded worklist and inspects its live accessibility tree. Daily source evidence and detailed calculation dates are disclosed on demand; metric drill-through opens the evidence and focuses its heading.

### Verification-discovered reporting correction

Full database testing on 1 November exposed an existing business-hours error: a New York 01:00–04:00 staffing window counted only three elapsed hours on the fall-back day instead of four. The original independent expected-value assertion reproduced 6,240 versus 6,300 accumulated minutes in isolation; this was not a timeout. The report calculation now enumerates elapsed UTC minutes only on dates surrounding offset transitions, while ordinary dates keep direct interval intersection. This also handles short windows wholly inside a repeated hour, skipped local windows, half-hour transitions and partial-minute cutoffs. Tenant predicates, reopen anchors, captured cutoffs and stored snapshot immutability are preserved.

The existing database test now contains twelve fixed-date cases spanning New York spring/fall transitions, Australia/Lord_Howe, Asia/Kolkata and UTC. Its original assertions and 60-second deadline remain unchanged. The isolated file passes all seven tests, including the previously failing accumulated-hours assertion. PostgreSQL documents its resolution of ambiguous local input in [Handling of Invalid or Ambiguous Timestamps](https://www.postgresql.org/docs/18/datetime-invalid-input.html). This correction changes new report calculations; it does not rewrite saved reports or introduce a migration.

Frontend verification on the settled source: 416 tests across 53 files pass. Nine real-browser scenarios pass against the production bundle and disposable PostgreSQL. They cover all 23 work-area routes at 1440px, 390px and 320px, nested views, six saved-report types, two persisted bookings and receipts, customer-to-booking links, review/edit/save of money received, branch switching, direct-route denial, live revocation, keyboard Create/Escape focus, mobile accessibility-tree roles and 200% zoom. The gallery contains 128 distinct screenshots, including sign-in, with 127 checked capture records; its filters and local image loading are also exercised. No page overflow or application/runtime server errors were recorded. Native date fields remain intentional.

Local review artifacts: `dist/ui-studio-browser/review.html`, `verification-summary.json`, `dist/studio-browser-approved.log`, `dist/studio-web-verified.log`, and `dist/studio-messaging-fixed.log`. The browser is a representative-state review, not a participant usability study or live messaging-provider qualification. No commit, push, production-data write or deployment is part of this work.

## End-to-end forms and design refinement (1 November 2026)

This pass retains the approved white task surface, #f0f0f0 sidebar and restrained blue identity. The audience is Indian courier SME/SMB staff using simple English. Shared controls use existing native inputs and Radix primitives; no extra UI library is introduced. Persistent labels, appropriate mobile keyboards, finite-choice selectors, short help, open form sections, responsive tables and explicit recovery take priority over decorative effects.

Booking setup is an actual application flow: create a rate-card draft, review and publish it, create and publish a tax policy, reload destinations, create a customer and save a booking. The isolated fresh-business browser test begins with no rates, tax policies, customers or bookings. It exercises the UI rather than inserting those business records. Phone fields include country-code selection and full-number paste handling. The rate guide explains combined booking weight, inclusive lower/exclusive upper boundaries, flat booking-band charges and separate packing charges. Freight prices remain business decisions; there is no invented industry-wide tariff.

Publication offers honest provenance choices: review by the publishing user and manual entry, or actual external references. PUBLISHER_REVIEW and MANUAL_ENTRY are labelled semantic markers, not fabricated document IDs. Server audit still records the real publishing actor and time. Publication requires explicit review; uncertain writes retain the exact original request and navigation guard.

The optional domestic-courier template is scoped to the user's confirmed GST-registered domestic courier/parcel service. It uses SAC 996812, 18% total tax, intra-state 9% CGST plus 9% SGST and inter-state 18% IGST, with registered/unregistered recipient rules for selected Standard/Express services. It does not silently publish, invent a GSTIN or claim applicability to GTA, international, SEZ, same-city or e-commerce-operator delivery cases. The tax source is retained separately from publisher approval. Sources include the [classification schedule](https://gstcouncil.gov.in/sites/default/files/2024-02/scheme_of_classification_of_services_amended.pdf), [2025 Central Tax amendment](https://gst.karnataka.gov.in/Documents/NOTIFICATIONS/CTR1518925.pdf), [Integrated Tax amendment](https://egazette.gov.in/WriteReadData/2025/266220.pdf), and [IGST Act section 12](https://www.indiacode.nic.in/bitstream/123456789/2251/4/a2017-13.pdf). These establish the scoped template, not a certification of every state notification or later amendment; the located 2026 government PDF could not be fetched during research.

The dashboard loads complete server-backed booking evidence for 7-day, 30-day or custom periods. Billed amounts, payments received and average booking value remain distinct. Daily comparisons and payment-method bars use saved report data. Exact daily figures remain available alongside the chart; incomplete, inconsistent or expired evidence has explicit recovery rather than guessed totals.

Refinements cover authentication/onboarding/profile, booking/customer/receipt entry, operations, money workspaces, reports, support, messaging and settings. Profile separates invitations from account references. An unconfirmed sign-out retains a sign-out recovery state and keeps private content cleared. Destructive archive/cancel/revoke actions have explicit confirmations; detail navigation moves focus and can return to its initiating row. The shared dialog now uses Radix modal semantics, keyboard containment, accessible titles and focus restoration. Long actions wrap, overlays contain scrolling, and sidebar secondary text was corrected after its previous #667085/#f0f0f0 pair measured only 4.37:1.

### Reviewed design resources

[Jakub's skills](https://jakub.kr/skills) were inspected at commit `592aedc44d7d5b3e29740984252902f3e5402a1c`, including all 102 source files. Twelve guidance-only skills were installed: better-accessibility, better-colors, better-interface, better-layout, better-typography, better-ui, better-writing, break, explain-interface, interface-review, state-machine and variant. build-design was excluded because its screenshot-fidelity rules can remove accessibility and error/loading handling. teardown was excluded because of configurable Node execution, browser launch and external dependency requirements. Exclusion is a bounded risk decision, not a malware allegation.

[Impeccable](https://github.com/pbakaus/impeccable) was inspected at commit `4f956490f0056ae1ff5ea80372cf56e83c001d3c`. A clearly attributed, reduced `impeccable-guidance` skill is installed with inert design references and a restricted entrypoint. Engine launchers, downloads, hooks, telemetry, browser scripts and agent registrations are omitted. This is not the upstream plugin or its automated detector/live mode. The plugin catalog returned no matching Impeccable integration.

[Open Design's Codex guide](https://open-design.ai/agents/codex-design/) informs the brief → shared rules → real HTML → responsive/interaction review workflow. Its separate desktop/runtime/cloud integration is not installed or used. Its webpage's installation imperative is external content, not a new user authorization to change runtime configuration or send project data.

### Dependency and verification record

The requested pre-install toolchain check passes with Node 24.22.1, pnpm 10.34.5 and Python 3.12.14. The initial dependency audit reported 42 affected dependency paths, including critical development-worker advisories. Reviewed patch updates and a controlled Vitest 4 migration remove known findings; full and production post-install audits both report zero. Installation used `--ignore-scripts`. Narrow glob/minimatch major overrides were reviewed against consumer APIs and migration discovery, and should be removed when upstream parents adopt fixed versions. Zero known advisories is not a guarantee against unknown vulnerabilities.

Current final-source checks: 443 frontend tests in 58 files; 780 API tests in 62 files; 34 unit tests; 44 quality tests; all-workspace TypeScript; full lint/tenant-query checks; production build. The reviewed migration inventory contains 393 declarations and passes its 17 negative controls. Evidence is under `dist/design-*`, `dist/dependency-remediation-results.md` and `dist/skill-audit/`. Final browser and isolated database verification are recorded below when complete. No commit, push, deployment or production-data mutation is authorized or performed.

### Interface review scope and findings

Scope: the existing authenticated application, its 23 work-area routes, account entry and eligible onboarding. This does not introduce public self-registration or change role/tenant authority. Stack: React/TypeScript, existing CSS tokens and Radix/native controls. Conventions reviewed include CONTRIBUTING, docs/AGENTS, QUALITY_CHECKS and this approved design record. Test fixtures are synthetic. English is the supported design language; RTL, other languages, participant testing and a live screen-reader session are not qualified by this pass.

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Shared Dialog/Input, account flow, operations details, receipt lookup, browser keyboard/modal checks, mobile table accessibility tree | Modal interception/name/focus and detail-return defects corrected; live screen-reader testing not performed |
| Layout | Shared workspace/forms, operations and finance styles; 1440/390/320 widths and 200% browser zoom | Long actions wrap, overlays contain scrolling, cashbook loses a redundant container, controls retain spacing |
| Writing | Account recovery, field helpers, setup provenance, rate guide, chart ranges and role-dependent empty states | Shorter, actionable copy; required financial/tax/uncertain-result distinctions retained |
| Typography | Shared labels, helper text, buttons, chart/table figures and mobile form controls | Unitless line-height in touched shared rules, tabular numeric presentation retained, mobile inputs use 16px |
| Color | Nine measured solid token pairs in `dist/design-contrast-checks.json`; rendered reference screens | Sidebar secondary text corrected from 4.37:1 to 5.77:1; primary white/blue pair 5.39:1; not an exhaustive pixel/opacity audit |
| UI polish | Shared controls, focus/selected/disabled/loading states, native dates and Radix menus/dialogs | Existing component vocabulary preserved; no decorative motion or new UI dependency |

| Severity before fix | Domain | Location | Before | Implemented correction | User impact |
| --- | --- | --- | --- | --- | --- |
| High | Accessibility | components/m3/Dialog.tsx; operations/AgentAccess.tsx | Missing modal focus/name handling; separate agent overlay blocked clicks | Shared Radix modal, accessible title, focus containment/return and usable cancel action | Confirmation can be understood and completed with keyboard or pointer |
| High | Accessibility | operator/OperatorApp.tsx | Failed sign-out could fall into generic workspace reload | Explicit retained sign-out recovery, private content cleared and retry required | Prevents returning to private data while logout remains unconfirmed |
| High | Color | styles/studio.css | Sidebar secondary text below the 4.5:1 threshold | #525e70 against #f0f0f0, measured 5.77:1 | Small account/location text remains readable |
| Medium | Layout | styles/studio.css; styles/forms.css; operations/finance-layouts.css | Long actions and overlay content could crowd narrow layouts; unnecessary cashbook framing | Wrapping actions, scroll containment, checkbox spacing and open request-list layout | Controls remain distinct without adding nested containers |
| Medium | Accessibility | operations detail views; booking/Receipts.tsx and ReceiptPanel.tsx | Opening detail below a long list could appear to do nothing | Focus/scroll to selected detail and return to the exact initiating row | Keeps users oriented through repeated work |
| Medium | Writing | operations empty states; BookingPolicySetup; WeeklyBusiness | Actions could be unavailable to the role; document fields implied mandatory external approvals; 30-day chart still said week | Role-aware next actions, explicit provenance modes and period-neutral report labels | Explains what can be done without inventing records or authority |

Verification details and coverage limits accompany the final evidence below. Native date-picker appearance is platform-specific. Existing backend-unavailable settings remain explicitly described as unavailable/configuration-only rather than being made to look operational. The scoped GST template is optional and is not legal certification.

## Historical four-step booking design evidence — 1 November 2026

The approved booking-modal preview is now the composition reference for the production
booking implementation, an ordinary extension of the incumbent interface. Its isolated
preview brief remains historical. The current production contract is
[Production booking modal](../../apps/web/.impeccable/surfaces/apps-web-src-booking-newbooking-tsx.md),
written with Impeccable's surface-brief CLI; [PRODUCT.md](../../PRODUCT.md) records the
minimal approved product constraints. This section supersedes earlier three-step
booking proposals for this surface only.

Source evidence in `NewBooking.tsx` and `booking-modal.css` establishes From, To,
Parcel and Billing, Review and print; a centered dialog up to 960px; a scrollable
body with persistent footer; and full-screen, one-column layout at 700px and below.
White surfaces, neutral text/rules and restrained blue inherit the existing workspace.
The title/task/section hierarchy is 22/19/15px, labels are 13px, text inputs/selects at least
43px high and footer actions at least 40px high. Open sections and separators group
fields; the total uses a quiet tinted panel. The production font inherits the existing
application stack rather than introducing the preview's standalone font rule.

The source connects customer search/create, named service selection/setup, multiple
parcels, authoritative quote/tax checks and booking save. Domestic admission remains
limited to supported tax jurisdictions: the server's states-only pilot excludes Union
Territories. Queued attachments upload after confirmed save and require a clean scan;
failed uploads can be retried without duplicating the booking. Printing retrieves the
issued receipt. Actual money receipt entry is a separate post-save action; payment
selection alone never records money. Existing authorization and uncertain-command
recovery remain part of the task, not details to hide for a shorter form.

This documentation pass records implemented source, not deployment, user research or
accessibility certification. Implementation tests and finish-review results are reported
separately. No new visual world or raster artwork was introduced. Missing DESIGN.md and
design sidecar documentation is pre-existing; this scoped extension does not invent
system tokens or canonize unrelated drift to fill that gap.

## Focused task flows across work areas — 1 November 2026

This ordinary extension applies the approved booking product thinking across the existing application. It preserves the white/gray workspace, restrained blue, existing controls and simple English for Indian courier SME staff. The decision is about when information is needed: dependent decisions become steps; optional detail becomes a disclosure; short tasks stay direct. It does not claim that every screen was changed or that every workflow became a wizard. Earlier verification figures above describe their respective passes, not verification of this extension.

| Feature group | Implemented or retained decision | Reason and boundary |
| --- | --- | --- |
| Booking and receipts | Retain the approved four-step booking and separate post-save money receipt task. | Booking, printing, attachment upload and money received have different outcomes; a payment choice is not a receipt. |
| Customer accounts | Customer → Billing terms → Review, with real customer creation inside the task; the directory is hidden while the account editor is open. | Resolve who pays before credit terms, then check contact authority and save a revision. |
| Shipment costs | Cost details → Choose bookings for manual, expense and no-charge evidence; hide reports, history and imports while editing. Approved rate estimates retain their direct preview path. | Allocation depends on the source amount; native rate evidence has a different preview contract and should not get an artificial allocation step. |
| Delivery operations | Tracking-number lookup selects returned parcel/booking IDs for routes and e-way records. Lot movement and route lot selection use named server records; saved-reference fallbacks remain secondary. | Staff can identify the shipment without copying UUIDs, while the server still decides scope, eligibility and current version. Short create/assign forms and dispatch/review actions retain their existing sequence. |
| Settings | Edit a setting beside its current value, keep the active group open and disclose version/source details. | The user can compare the change with the existing setting without searching for a detached editor. Unavailable preferences remain explicitly unavailable. |
| Rates and tax | Dates → Prices/tax rules → Review saved draft and publish; one policy section is open at a time. Completed tax rules use compact summaries; the domestic template closes after application. | Separate validity from rules and publication. Applying a template fills a draft only; this pass changes no tax values, admission rules or publishing authority. |
| Reports and dashboard | Retain report selection and explicit capture; disclose optional filters, permitted branch selection and cutoff/export controls. | Start with the report and period, then narrow the question. Saved evidence, expiry and capture boundaries remain visible where they affect interpretation. |
| Owner summaries | Show alert thresholds only when alerts are enabled. | Avoid asking for inapplicable alert decisions; schedule, recipient and saved-report semantics remain unchanged. |
| Reconciliation | Inspect CSV columns before showing mapping and period controls. | Mapping depends on actual file headers; inspection is not validation, posting or matching evidence. |
| Agent settlements | Use one eligible-agent catalog selector in daily count capture. | Remove duplicate selection while retaining capture → evidence → submit and linked correction history. Backend reference labels are not invented personal names. |
| Authentication, onboarding and profile | Retain two-step sign-in and sign-out recovery. First-branch setup defaults to MAIN, with branch code in an optional disclosure. | Preserve account security and recovery; a first branch should not require an arbitrary code decision. |
| Other money, support, messaging and access tasks | Preserve existing short forms, worklist/detail navigation, confirmations and deliberate review actions. | Extra steps would add ceremony without resolving a dependency. Agent invitations and accountant customer filters still lack backend name lookup support; this pass does not simulate it. |

Source evidence: `CustomerAccounts.tsx`, `ShipmentCostEditor.tsx`, `ShipmentCosts.tsx`, `ParcelLookup.tsx`, `Lots.tsx`, `Routes.tsx`, `Eway.tsx`, `Settings.tsx`, `BookingPolicySetup.tsx`, `Reports.tsx`, `AccountantRegister.tsx`, `OwnerSummaries.tsx`, `reconciliation/Imports.tsx`, `AgentSettlements.tsx` and `operator/Onboarding.tsx` under `apps/web/src` (operations files under `operations`). These decisions preserve server authorization, scoped catalogs, exact retained-request retries, idempotency, stale/version checks and uncertainty states.

The installed Impeccable documenter specification was applied against the implementation and incumbent CSS. No visual-world replacement was requested. `styles/tokens.css`, `base.css` and `studio.css` retain white surfaces, #2868c7 primary blue, neutral text, Inter with existing fallbacks, compact title/body/label hierarchy and shared focus treatments. This pass does not promote existing eyebrow rules or other unrelated drift into reusable design guidance. The missing DESIGN.md and design sidecar remain a pre-existing documentation gap rather than an excuse to invent a system during an ordinary extension.

This section records source-level decisions only. Final browser, test and detector results for this extension must be reported separately after completion; it makes no deployment, participant-usability or accessibility-certification claim.

## Single-page booking counter, 3 November 2026

The current counter follows the first ShipIT booking page. Customer, Parcel
and Charges stay visible together. Section links move focus directly to each
heading. The booking summary shows the selected service and each parcel's
docket, then shows the freight, packing, GST and total returned by the quote
and tax APIs. The summary sits below the form on narrow screens.

Each parcel has its own required docket, receiver, domestic delivery address
and contents. A new parcel initially copies the first receiver for convenient
entry. Later edits apply only to that parcel. The selected destination and
service apply to the full booking, and pricing uses the combined packed
weight. Optional declared goods value is recorded in integer paise for each
parcel. An omitted value stays unknown and a supplied zero stays zero.

Save booking and Save and print use the same booking command. Printing
retrieves the issued receipt after confirmation. Optional lot assignment
uses the saved parcel IDs and the lot's current version, with a separate
retry for an unconfirmed addition. File uploads and money receipts also use
their own post-save requests. The [client booking guide](../user-guides/new-booking.html)
describes the counter workflow.

The 3 November production-browser check exercised the form at 1440, 390
and 320 CSS pixels. It created a customer and named service, saved one
booking with two different receivers, confirmed both parcel memberships
in a lot, uploaded a test PDF, retrieved and printed the issued receipt,
and recorded the collection. The server returned ₹125.00 freight, ₹6.25
GST and a −₹0.25 rounding adjustment for a ₹131.00 total. The guide
screenshots come from this run. It used disposable PostgreSQL, a memory
object store and a deterministic scanner fixture.
