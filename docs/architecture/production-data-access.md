# Production browser data access — Issue #18

[Frontend migration contract](frontend-migration-contract.md), [API v1](api-contract.md),
[idempotency](idempotency-contract.md), [authentication](operator-authentication.md),
[onboarding](independent-onboarding.md) and ADRs 0002/0003/0007/0008/0011/0013 remain authoritative.
[Verification](issue-18-verification.md) records execution evidence.

## Composition and public configuration

Vite validates the public configuration once per startup/build and defines the literal
composition switch. `App.tsx` conditionally imports the chosen application; tree shaking
removes the other application's dependency graph. API failure, browser storage, query
parameters and runtime user input cannot select demo. Unknown `VITE_` names fail startup
with a fixed error that does not echo configuration values. Server environment objects
are never serialized into the frontend.

| Public setting | Accepted values |
| --- | --- |
| `VITE_DATA_MODE` | omitted → production; exactly `production` or `demo` |
| `VITE_API_BASE_URL` | omitted/empty → same-origin `/auth` and `/api/v1`; otherwise canonical HTTPS origin, or HTTP localhost/127.0.0.1/[::1] for local development |
| `VITE_APP_VERSION` | optional 1–64 character public version label, ASCII letters/digits and `._+-` |

API base has no userinfo, path, query, fragment, trailing slash or noncanonical spelling.
It is a public origin, never authentication or an endpoint containing a secret. Demo
rejects a nonempty API base. Use the current development proxy (`SHIPIT_API_PROXY`, a
server-side dev-tool setting) or a same-origin hosted reverse proxy. A configured distinct
API origin must remain on the same schemeful site for the existing Strict cookies;
the API's exact allowed Origin/CORS and deployment network policy still apply. URL syntax
validation does not prove DNS ownership or authorize a deployment. #68 owns hosted
identity, origin and network isolation. No public-suffix guessing or new cookie policy.

## One HTTP client and purpose-specific data sources

`data-access/api-client.ts` evolves the former `operator/api.ts` helper. All current
production UI uses `operator/data-source.ts`, whose async operations are context retrieval,
franchise selection, onboarding, invitation acceptance, sign-in and logout. It exposes no
Database, generic save, arbitrary status setter or fictional reset. Existing shared response
DTOs remain unchanged; the onboarding request type also lives in shared. `context-dto.ts` checks/project-maps returned context before display.
Unknown optional response fields are discarded; malformed context enters controlled recovery.

The client supports GET/POST/PUT/PATCH/DELETE, JSON, `credentials: include`, no-store,
AbortSignal and optional Idempotency-Key. Mutation requests obtain the existing CSRF
bootstrap first; the CSRF value exists only in the request's memory. Redirects fail instead
of forwarding a private request. Paths belong to adapters and must stay under `/api/v1/`
or `/auth/`; absolute URLs, traversal and encoded separators are rejected. There is no
second fetch stack, automatic request replay, body logging or provider client.

`ApiFailure` carries only safe code, kind, status, optional UUID correlation, optional
Retry-After seconds, dispatched evidence and declared validation field/code pairs. Only
422 VALIDATION_FAILED may project details, and only fields explicitly declared by the
owning adapter are retained. Messages, raw bodies, submitted values, stacks and unknown
codes are discarded. HTTP 401/403/404 stay authoritative even when a proxy returns HTML.
A successful non-JSON response is a protocol error, not a fabricated saved result.

| Failure | Recovery |
| --- | --- |
| 401 | Purge private scope/cache/views; require sign-in, never replay automatically |
| 403/404 | Same unavailable UX; no foreign existence hint or demo lookup |
| 422 validation | Keep safe current-session input and show validation guidance |
| stale version/cursor | Authoritatively refresh before a new deliberate intent |
| 409 idempotency conflict | Reconcile; never change key to evade the conflict |
| 409 in progress | Explicit pending/same-intent retry; no internal loop |
| 429 | Expose safe retry delay to owner; retain command identity |
| read network/timeout/500/503 | Error plus explicit refresh; no invented data |
| dispatched mutation timeout/network/500/503/protocol/abort | Uncertain; retain exact intent, never claim rollback |
| abort before dispatch | Cancelled; mutation was not sent by this attempt |

## Command intent and reconciliation

`createCommandIntent` snapshots the validated body as immutable JSON with method, versioned
operation, path, key, optional expected version, and the current scope ticket. If expected
version is supplied it must equal the body's expected_version. `executeIntent` checks the
same live ticket before sending and before publishing the result. A retry reuses exactly
the same key/body/path/version. There are no automatic retries or mutation queues.
Cancellation does not cancel a transaction already accepted by the server.

Generic intents are ephemeral: no localStorage/sessionStorage serialization. Feature
owners retain the intent while uncertainty is unresolved and design authorized reconciliation
before enabling reload recovery. Changing scope or identity makes the old intent ineligible;
even returning to the same franchise requires fresh authority and deliberate owner recovery.
Never retry under a different user or regenerate a key merely because transport failed.

#17's explicit exception remains: only its bounded business/location request body and key
are retained in per-identity sessionStorage, never session/OTP/invitation credentials or
workspace authority. Reload first obtains server context. A ready workspace clears that
pending intent; an eligible same identity may deliberately retry the exact request. The
server's immutable identity bootstrap guard also prevents duplication if storage disappears.
No general persistence permission for later private customer/booking bodies is implied.

## Scope, cache and private view lifetime

The existing `operator/scope.ts` controller owns `data-access/scope-runtime.ts`. Every load,
franchise change, protected navigation, logout and denial clears context synchronously,
advances a generation, aborts pending queries, drops the private cache and runs registered
private-view cleanup callbacks. The shell cannot render a previous route's context before
its effect runs. Current identity/org/franchise/role context comes only from the API.

The bounded 128-entry in-memory query cache keys include generation, user, organization,
acting franchise, permission projection, resource/query and sorted filter/cursor parameters.
It never survives a scope/session transition or reload. `bind` also invalidates an already
bound scope. Query results publish only for the original ticket and latest same-query request,
even when fetch ignores cancellation. Old errors also cannot invalidate a newer session.
Query failure enters controlled shell recovery; 401 reauthenticates. Revisited A does not
paint an earlier A payload while reauthorization is pending.

Future adapters use the controller's runtime query boundary for private reads and
`controller.command(() => executeIntent(...))` for mutation outcomes. Views subscribe to
controller state and register temporary print/preview/object-URL cleanup with `onInvalidate`.
The current shell has no operational print/attachment data. A cleanup callback failure cannot
block cache/generation invalidation or the remaining cleanup callbacks. Client lifetime
checks are defense in depth; every server request/replay still checks current membership.

## Cross-tab invalidation

A same-origin BroadcastChannel carries exactly the literal `invalidate`, with no identity,
resource IDs, customer payload, tokens, keys or credentials. Login, logout and successful
invitation acceptance publish the hint. Receipt immediately purges and retrieves fresh API
context; it never imports state from the other tab or echoes the signal. Channels close
on unmount. A 401 directly clears the receiving tab, without retry loops. Server-initiated
revocation is discovered on each protected action, navigation, focus or visible resume;
there is no push revocation service. If BroadcastChannel is unavailable or blocked by browser policy, the existing
focus/resume/navigation checks remain the fallback, with no storage messages or polling.

## Fictional data and reset

The separate demo keeps DemoApp, AppProvider, original operator pages and simulated
CustomerWhatsApp. A visible fictional-data notice applies across demo routes. Current
storage keys are `shipit_demo_database_v1` and `shipit_demo_persona_v1`. Old browser keys
are left untouched and are not copied, imported or interpreted as identity. This cutover
starts fresh fictional samples; preserving old demo drafts is not a production migration.
Reset reseeds only the fictional namespace and removes its persona. It makes zero fetch,
auth, API or provider requests. Production cannot import or invoke that capability.

The shared test setup has no demo imports or seed calls. Fictional tests opt into reset.
The production build gate examines actual rendered Rollup module paths (including aliases
and transitive dependencies) and forbidden demo/secret markers before single-file assembly.
A controlled failure drill adds a store import and requires a nonzero build. Helper tests
cover forbidden modules and markers; production and explicit demo builds are both verified.
This protects accidental dependency regressions, not arbitrary malicious obfuscation or
unprovisioned deployment network isolation.

## Extension, rollout and rollback

#33 owns customer/booking/receipt adapters; #34 owns parcel/lot/route/dashboard/e-way;
#44 owns provider-backed messaging history. Add small async query/command interfaces with
public DTOs, declared validation fields, explicit error/reconciliation handling and scope
lifetime tests. Reuse Fetch/AbortController and this seam; no new state framework is needed.
Do not activate fictional pages as production or invent endpoints before domain ownership.

Database migration: N/A — Issue #18 adds browser/data-access architecture only. No backend
role, authorization, audit, SQL whitelist, endpoint or migration changes. Roll out the
compatible production build against existing #17 APIs and synthetic staging first. Revert
to a compatible API-backed version or disable the affected workflow to roll back. Never
switch a production deployment to demo as outage recovery or automatically import browser JSON.
