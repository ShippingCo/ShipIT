# ADR 0032 — Deterministic customer conversation tools

Status: Local implementation decision for #47, subject to review.

## Evidence and prior decisions

On 2026-10-02, retrieved the complete accessible chats “Research Milestone 4”
and “Research milestone 4 and solve issue”. The latter contains the user's approval
of booking customer plus independently verified recipient tracking. Financial access
and an AI provider were not approved there. Quote recommendations remain #48.
Issue #47 has no comments; its actual milestone is GitHub milestone 5, named M4.
All six prerequisites are closed. PR #131 merged #46 as `545dfa6`; local main was
fast-forwarded from `352421f` before creating `issue-47-trusted-conversation-routing`.
The starting tree was clean. The merge adds no changes beyond the #46 implementation.

## Decision and boundaries

Use the existing signed inbox, consent receipts, #46 parcel bindings, raw SQL and
durable outbound worker. Add no LLM, queue service, provider or dependency. Priority is
STOP/START, explicit human request, known tool, then clarification. Never accept a tool
name, endpoint, SQL, owner or phone supplied by customer text as authority.

Selection is per installation and keyed channel, expires after 15 minutes, and is
rechecked on each turn. At most ten permitted dockets appear; an exact docket narrows
the same set. A docket-only response resumes the pending intent. No numeric choice
whose meaning could drift after a revoked binding. Tracking/ETA/delay reuse #46's
minimal current projection and never infer arrival from the wall clock.

Engineering judgment: only a verified booking-customer binding may read booked charges
and issued booking receipt summaries; recipient tracking authority grants no finance
access. Charges use the saved obligation and append-only ledger, never current rates
or tax. Receipt assistance reads an already issued immutable receipt and explicitly
reports unavailable when staff have not issued it. It does not impersonate staff to
materialize a receipt or expose a public artifact URL.

Delivery-code assistance requires a verified parcel binding AND the actual delivery
recipient channel. Deliveries owns the resend operation, shared cooldown/limit checks,
secret decryption and encrypted send reservation. No code crosses its public result.
A sender cannot redirect delivery codes, nor can a tracking recipient rebind change
the independently retained delivery recipient. Add a signed-inbox command principal
for this one operation instead of pretending a customer is an assigned staff agent.

Minimal durable turn receipts provide replay identity and safe provenance; conversation
history reads are bounded to 20 receipts and contain no raw text or result bodies.
One transaction commits selection, turn receipt, resend and encrypted reply. A savepoint
rolls tool failure back before a bounded retry response. Ordered installation consumption
and root/installation/parcel locks prevent simultaneous turns from racing selection.
Dispatch rechecks current bindings, consent, source age, installation and owner lifecycle.
Replies expire within the #46 source window. No bearer grant is sent in a URL or logged.

Human requests record `human_requested` and pause ordinary tool answers until an explicit
RESUME or selection expiry. The response truthfully asks the customer to contact staff;
no case, callback deadline or claim that a staff member was notified is invented. #50
owns the case queue. Quotes/pickups/languages/outcome metrics remain #48–#52.

## Alternatives and research

A general agent increases attack surface and contradicts #47's no-LLM scope. Direct
provider calls lose durable retry evidence. A second queue/database increases operating
cost without a demonstrated need. These comparisons are repository-specific judgments.

- [OWASP authorization](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html): deny by default and verify every resource request.
- [AWS safe retries](https://aws.amazon.com/builders-library/making-retries-safe-with-idempotent-APIs/): preserve request identity and atomically retain effects.
- [Stripe idempotency](https://stripe.com/blog/idempotency): bound retries and distinguish uncertain external effects.
- [PostgreSQL 18 SELECT](https://www.postgresql.org/docs/18/sql-select.html): SKIP LOCKED is suitable for queue consumers, not a general consistent read.

These lessons apply to the installed PostgreSQL 18.6/Fastify 5.12.3/pg stack without
adopting the companies' larger architectures. Meta's documentation fetch was unavailable;
no new provider policy is inferred. Reuse #38/#39's validated requested-assistance
window and #42's deployment-qualified authentication template constraints.

## Implementation and acceptance plan

1. Add forward migration, indexed conversation/receipt ownership, scheduler, channel
   reply identity and customer resend principal. No old record gains parcel access.
2. Add pure router/output validation, trusted worker, bounded state/history repository,
   #46 projection reuse, finance/receipt projections and Deliveries-owned resend seam.
3. Extend existing outbound reservation with a conversation source, encrypted rendering
   and dispatch-time reauthorization; default-disable via server-only configuration.
4. Unit tests prove priority, input/output schemas, injection handling and rendering.
   Real PostgreSQL signed fixtures prove multi-selection, current facts, restart,
   A/B/C isolation, revocation, duplicates, concurrency, safe failures and OTP policy.
5. Run migration immutability, planning, lint, typecheck, required tests/build and
   disposable database quality. Record all executed results and blocked checks.

Upgrade schema/grants before enabling the flag. Disable routing for rollback; drain or
suppress new-source intents with compatible code before deploying older workers.
Final retention/deletion is #72. Live Meta qualification and production rollout are
outside this local request. Commit/push/PR publication require explicit user approval.
