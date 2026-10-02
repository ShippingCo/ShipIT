# Issue #48 draft delivery details

These are local review drafts. No commit or PR has been created.

Commit message: `feat(quotes): add scoped customer estimates and repair conversation replies`

PR title: `Add customer shipment estimates and fix conversation reply regressions`

## Draft description

Customers can now send QUOTE to collect validated shipment details and receive a
non-binding estimate from an explicitly approved published weight-based rate, or a
clear staff referral. The existing conversation worker preserves progress and commits
the immutable expiring reference with its reply. Dimensions are required for review
thresholds; dimensional and unsupported shipments go to staff without an invented
price. CONFIRM QUOTE checks/refreshes the estimate and never creates a booking.

Franchise-admin policy configuration selects rates, lanes and inclusive thresholds.
Every reference is bound to its original tenant, installation and contact. Quote inputs
cannot override or enumerate rate cards. The change also fixes pending-consent reply
loss, lowercase docket selection and missing recorded delay minutes from #46/#47.

Apply migration 32 and narrow runtime grants, configure an approved policy, then enable
the default-off `customer_quotes_enabled` server flag. No new dependency, role, model,
provider credential or browser screen is added. Disable the flag and retain compatible
workers for queued-message suppression before code rollback; repair schema forward.

Validation: see the exact executed results and rerun history in
[verification](issue-48-verification.md). Tests cover signed
dialogue/restart, duplicate/concurrent workers, inclusive thresholds, expiry/new rates,
valid B/C references, CSRF/admin/version checks, dependency rollback, limits, migrations
and existing conversation regressions. Live Meta qualification is outside this change.
Final lint, all workspace typechecks, 34 runner/security gates and API/web builds passed.
The focused quote/access/conversation/migration suite passed 33 cases; the full run
also passed 527 API unit/integration, 177 web, 67 schema and three object-store tests.

The complete local pipeline reached the full database group but was not green in
one invocation. All four failing files subsequently passed after Windows aggregate
budget and fixture-only corrections; no individual test deadline or assertion was
weakened. Report this distinction when publishing, and run CI on the eventual PR head.

Closes #48.
