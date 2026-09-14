# Issue #23 verification — Parcel retrieval, search and timeline

Verified locally on 14 September 2026 from `main` at `b0d4791`, after reviewing the merged
Issue #5–#22 first-parent history and the ratified authorization, API, event, lifecycle,
customer, pricing, tax, tenant-query and booking contracts. The work remains uncommitted.

## Contract decisions

The newer ratified API contract names Parcel resources, so this implementation uses
`GET /api/v1/parcels`, `/parcels/{parcel_id}`, and `/parcels/{parcel_id}/timeline` instead of
the older issue-body `/bookings` retrieval sketch. Exact docket discovery is a list filter;
UUID is the detail selector. No aliases silently enlarge v1.

Authorization follows R06/R07: org_admin can read all active Franchise scopes in its
Organization; franchise_admin, operator, dispatcher and read_only can read their current
Franchise grants; accountant is denied. The delivery_agent condition depends on assignment or
custody data not yet modeled, so it is denied rather than approximated. Every lookup scopes by
Organization and Franchise before applying ID/filter conditions. Foreign-valid and unknown
IDs share one 404 envelope.

The list is keyset-paginated and has no total-count field. Closed filters and sorts prevent
SQL-shape input. The cursor is AES-256-GCM ciphertext with purpose-specific key derivation and
associated data; its payload binds actor, tenant, sorted current Franchise grants, membership
revision, exact normalized query and a 15-minute expiry. Live authority is rechecked on every
page. Timeline order is `(occurred_at, aggregate_sequence, event_id)` and the public mapper
rejects unratified internal event names rather than returning an event envelope.

## Primary-source design review

- Google AIP-158 requires opaque URL-safe page tokens, parameter consistency, bounded expiry
  and renewed authorization; it explicitly says a page token is not authorization:
  <https://google.aip.dev/158>.
- Google AIP-132 and AIP-160 provide bounded list, allowlisted ordering and filtering
  conventions: <https://google.aip.dev/132>, <https://google.aip.dev/160>.
- Google AIP-211 recommends authorization before resource validation to prevent existence
  disclosure: <https://google.aip.dev/211>.
- Google Tink's AEAD guidance explains confidentiality, authenticity and context binding via
  associated data: <https://developers.google.com/tink/aead>.
- Google's Zanzibar paper and AWS SaaS tenant-isolation guidance reinforce that authenticated
  identity alone is not resource isolation: <https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/>,
  <https://docs.aws.amazon.com/whitepapers/latest/saas-architecture-fundamentals/tenant-isolation.html>.
- GitHub's cursor pagination guidance supplies a current large-scale API comparison:
  <https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api>.
- Meta's Timeline design describes time-ordered storage for efficient history range reads:
  <https://engineering.fb.com/2012/01/05/web/building-timeline-scaling-up-to-hold-your-life-story/>.
- PostgreSQL's multicolumn and ORDER BY index documentation governs the concrete relational
  plan: <https://www.postgresql.org/docs/18/indexes-multicolumn.html>,
  <https://www.postgresql.org/docs/18/indexes-ordering.html>.

## Index and representative query plan

All B-tree indexes begin with authorization ownership columns before discovery/order fields:

| Query | Index | Expected bounded plan |
| --- | --- | --- |
| exact docket in current scope | `parcels_owner_docket_idx (organization_id, franchise_id, docket)` | owner+docket index scan, then at most one globally unique row |
| status/list join | `parcels_owner_status_booking_idx (organization_id, franchise_id, status, booking_id, id)` | scoped status/booking index scan joined on the same owner tuple |
| default created-time page | `bookings_owner_created_idx (organization_id, franchise_id, confirmed_at DESC, id DESC)` | owner/time keyset range with bounded `LIMIT + 1` |
| customer/time page | `bookings_owner_customer_created_idx (organization_id, franchise_id, customer_id, confirmed_at DESC, id DESC)` | owner/customer/time keyset range |
| Parcel timeline | `domain_events_parcel_timeline_idx (organization_id, franchise_id, parcel_id, occurred_at, aggregate_sequence, event_id)` | one-Parcel ordered index range |

The migration test asserts these exact catalog names after upgrade. Application database tests
execute representative docket, status, customer, date, created-time cursor and timeline shapes
on PostgreSQL. Release operations should capture `EXPLAIN (ANALYZE, BUFFERS)` on production-like
cardinalities before tuning; tests do not freeze cost estimates or planner node names.

## Executed evidence

- Repository-pinned Node 22.23.2 and pnpm 10.34.5 toolchain check passed.
- All five workspace TypeScript projects, the tenant-query AST gate and full ESLint passed.
- API integration: 227 passed, including 27 Booking/Parcel focused tests and the real
  lifecycle subprocess suite.
- Quality fixtures: 20 passed. Testkit/DB unit suites: 34 passed.
- Real PostgreSQL 18.6: 45 DB plus 122 API/database tests passed, zero failed, skipped,
  cancelled or todo. This covered fresh install, Issue #21 snapshot upgrade through #22/#23,
  failed-migration rollback/retry, runtime grants, malformed input, stable continuation across
  a later insert, cursor tamper/expiry/cross-scope/cross-filter rejection, role ceilings,
  identical unknown/foreign 404, timeline projection/order and service/pool restart.
- The supplied local `shipit_developer` database started with 10 migrations. The normal
  forward migrator applied #22 and #23 in order and reported two applied migrations.

The host's default Node is not the repository-pinned runtime, so the exact official Node
22.23.2 archive was downloaded, checked against the release SHA-256 list and used with
pnpm 10.34.5 for the final gates. CI must still repeat required checks before merge.
