# Draft delivery details — issue #49

Commit message: `feat(pickups): add scoped customer requests and staff decisions`

PR title: **Add pickup requests, staff acceptance and recoverable notifications**

## Description

Customers previously had no persisted pickup request. They can now use an owned
quote to submit a private pickup address and requested window through the verified
WhatsApp conversation. Explicit confirmation keys prevent duplicate submissions.
Customers can check their own requests and cancel before staff decide.

The production Pickups page gives permitted staff a scoped queue. Acceptance records
the responsible staff member and an agreed window after capacity/manual review.
Expected versions and row locks settle competing accept/cancel commands. Decisions,
audit events, retry results and encrypted message jobs commit together; notification
failure keeps the decision visible and recoverable through existing messaging tools.
No shipment booking, payment, carrier booking, AI or capacity promise is introduced.

Apply additive migration 33 and narrow runtime grants first; then enable the
default-off `pickup_enabled` flag with the existing #48 configuration. Compatible
workers must remain during rollback to suppress queued pickup messages and clean
expired address drafts. Repair schema forward.

Validation: 67 PostgreSQL schema tests, 369 API database tests, 531 API unit/integration
tests, 182 web tests, unit/object-store/tooling checks, lint/typechecks/planning and
explicit production build passed locally. Mobile headless Chrome passed using
fictional API responses. These are completed stages plus corrected reruns, not an
uninterrupted green aggregate command; the [verification record](issue-49-verification.md)
records the migration-count fixes and wrapper timeout during the build. Live Meta
and new-branch GitHub CI are not claimed. Reviewed against merged #48; wider M4 work
remains separate.

Closes #49.

Publication is not authorized. This is ready-to-copy text, not a published PR.
