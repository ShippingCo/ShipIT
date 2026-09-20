# Messaging consent operations

[Decision and research](../adr/0026-scoped-messaging-consent.md)

Apply migration `1790787600000-scoped-messaging-consent.cjs` before deploying the
consumer. It adds contact identity, disclosure records, consent state and immutable
consumption receipts. Existing customer data receives an identity, never opt-in.
The existing webhook configuration enables the consumer alongside the inbox worker.
Both run bounded batches of twenty with transaction deadlines and graceful draining.
No external send occurs. Generating distinct contact UUIDs for existing customers
requires a table rewrite and migration lock; schedule a maintenance window sized from
a staging copy before production rollout. This migration is transactional: contention
or failure must be resolved and retried, never bypassed by editing the migration ledger.

In addition to #36/#37 and customer read grants, grant the restricted runtime role:

```sql
GRANT SELECT ON shipit.whatsapp_consent_state, shipit.whatsapp_consent_receipts
  TO shipit_api_runtime;
GRANT EXECUTE ON FUNCTION shipit.whatsapp_consent_next(),
  shipit.whatsapp_consent_apply(uuid,uuid,uuid,text,text,text,text,text)
  TO shipit_api_runtime;
```

Do not grant direct consent DML, disclosure insertion, ownership, DELETE or TRUNCATE.
The HMAC uses the stable #37 fingerprint key with separate domain/installation inputs.
Retain the original encryption key version until its inbox is consumed. A mismatched
key generates `key_unavailable`, keeps consent closed and requires reviewed repair;
it does not make another attempt silently grant consent. Database outages roll back
the entire transaction, leaving source work eligible for a later poll. Monitor safe
`whatsapp_consent_quarantined` / `whatsapp_inbox_failed` signals. Recovery owner is the
deployment operator; no terminal reset endpoint is provided.

## HTTP read contract

All paths use `/api/v1/whatsapp/consent/customers/:id` with explicit
`organization_id` and `franchise_id` query selectors and a live operator session.

- GET returns up to 100 newest safe evidence rows, `has_more`, and current optional
  update eligibility. Evidence includes source, policy, purpose, channel, timestamps,
  command and outcome, but no phone, text, ciphertext or provider message ID.
- POST `/policy` is a read-only evaluation with browser origin/CSRF enforcement.
  Body: `purpose` (`updates`, `requested_assistance`, `delivery_otp`, `marketing`),
  `format` (`text`, `template`), optional `template_name`, `template_language`,
  `variables` and `requested_inbox_id`. Template mode requires exact name/language.
  There is no idempotency key requirement because no effect is committed.

R16 permits selected-franchise administrators, operators and dispatchers, plus scoped
organization administrators. read_only/accountant/general delivery-agent directory
access is denied. Foreign and unknown customer IDs both return RESOURCE_NOT_FOUND.
Unknown fields and malformed input fail validation. API errors follow the existing
controlled error boundary; infrastructure failures never return eligible.

Eligibility returns `allowed`, `reason`, `policy_version`. Reasons include
`consent_processing_pending`, `contact_unconfirmed`, `consent_unknown`,
`consent_revoked`, `requested_context_expired`, `approved_template_required`,
`operational_exception_unapproved`, `purpose_unsupported`, installation unavailable,
and #36's template reasons. The result is current observation only, not permission
that may be cached for a future send.

## Integration and rollout

#39 must call `checkCurrentConsent` at enqueue and again immediately before dispatch,
under trusted job scope, and persist the outcome on its own intent/attempt. It must
also validate the intended recipient against the current contact identity and owning
shipment; this policy service does not grant shipment access. Never expose that
internal function as a phone-based public API. The #39 reservation/dispatch protocol
must define its linearization point: a network send already in flight cannot be
retracted by a later STOP. All known unconsumed inbound work, including unsupported
quarantined inbound content, blocks eligibility. The evaluator shares the consumer's
installation lock and locks the current customer contact for a consistent decision.

An affirmative disclosure record contains owner, customer/contact identity, purpose,
policy version, immutable content hash, actual provider message reference and validity.
#39 owns creating that record after the corresponding disclosure delivery is verified.
No operator can manufacture one through this issue's API. For synthetic verification,
the fixture's privileged migration identity inserts fictional evidence; it does not
represent a live provider send. A missing disclosure, stale policy, expired reference,
foreign contact or pre-STOP disclosure leaves START unconfirmed. This intentionally
keeps live grant collection disabled until the outbound integration exists.

Deploy schema/grants first, then compatible code; verify a synthetic signed callback
and safe history in development/staging. Roll back compatible code/configuration and
preserve evidence; repair schema forward. Existing #37 completion records are consumed
without rewriting them. Old consent timestamps before a customer's current phone
change cannot attach to the new contact identity. No production database is used by
the verification suite.

Run `pnpm test:api -- test/integration/whatsapp-consent.test.ts`,
`pnpm check:migrations` and `pnpm db:local quality` with the pinned toolchain.
The dedicated database tests are in `apps/api/test/database/whatsapp-consent.test.ts`.
Live provider onboarding, outbound dispatch and disclosure delivery are not certified
by synthetic local tests. #39/#42/#46/#47 retain their independent responsibilities.
