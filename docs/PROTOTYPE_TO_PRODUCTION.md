# Prototype v0 to production

**Prototype v0 — completed before production milestones.** Preserve useful UX and tested behavior; replace infrastructure progressively. This is a migration map, not authorization to rebuild the frontend.

| Existing evidence | Production owner / staged destination | Preserve or intentionally change |
| --- | --- | --- |
| `apps/web/src/data/types.ts` | M0 canonical model; M1 ownership; M2 domain tables | Resolve Booking/Parcel cardinality; keep public DTOs separate from secret/server records. |
| `apps/web/src/data/store.ts`, `AppContext.tsx` | M1 API/demo seam; per-domain M2–M6 API migration | No automatic browser JSON import, no localStorage fallback for production writes. |
| `NewBookingPage.tsx` | M2 customers, pricing, tax, booking transaction and counter UI migration | Retain repeat lookup, freight suggestion/variance, attachments and optional print. |
| `PackagesPage.tsx` | M2 lifecycle/search/bulk/payment APIs; M3 delivery service/UI | Preserve package management. Ban generic delivered write, staff OTP reveal and client-verified proof. |
| `LotsPage.tsx`, `RoutesPage.tsx` | M2 lots/manifests/typed route events | Preserve lot removal and batching; deduplicate affected parcels and delay ETA application. |
| `store.ts` payment/To-Pay helpers | M2 ledger; M6 ageing | Replace mutable settled boolean and tax-omitting collection sums with gross minor-unit ledger reconciliation. |
| `utils/receipt.ts` | M2 immutable receipt snapshot/API | Keep HTML escaping, existing layout and explicit user print action. |
| `utils/image.ts`, inline attachment URLs | M2 private uploads | Reuse input experience; private validated storage replaces base64 localStorage. |
| `EwayPage.tsx`, EwayRecord | M2 record tracking; M6 compliance verification | Keep separate navigation; distinguish estimates from externally issued official validity. |
| `data/messages.ts`, outbox and Automation Feed | M3 approved templates/provider/outbox/workers | Keep English/Hindi message intent; consent/window rules verified from current provider policy. |
| `CustomerWhatsApp.tsx`, `data/bot.ts` | M4 verified customer context and deterministic tools | Simulated arbitrary-phone persona stays demo-only. No public foreign-docket disclosure or raw OTP tool result. |
| `ReportsPage.tsx`, report helpers | M6 scoped snapshots/queries/exports | Preserve cards → detail/table/filter/export UX and reconcile tax/collections. |
| `MiscPages.tsx` settings/escalations | M4 staff handoff; M6 versioned settings | Replace hardcoded callback promises with actual staffing policy and audited configuration. |
| `test/app.test.tsx` | M0 regression map; per-domain security/integration/browser tests | Preserve useful regressions; deliberately replace unsafe prototype expectations. |

## Cutover discipline

1. Ratify owning domain, public contracts, tenancy and intentional business-rule changes.
2. Add compatible SQL/service/API with tests and transaction/idempotency guarantees.
3. Connect the domain UI through the API seam with loading/error/conflict/retry states.
4. Demonstrate persisted state after reload, allowed and denied tenant access, and timeout recovery.
5. Remove production calls to corresponding browser mutators; retain them only behind explicitly fictional demo adapter.
6. Observe cutover and roll back compatible code/configuration if required; never silently fork truth into browser storage.

No automatic production import of `shippingco_v1`, `setu_courier_v2` or existing phone personas. If a real migration is later required, give it a dedicated issue with authorization, dry run, validation, provenance, tenant ownership mapping, retention and reconciliation.

OTP plaintext, `otpUsed`, `revealOTP`, unrestricted `confirmDelivered`, unknown-city intra-state tax fallback and title-derived route state are prototype limitations, not invariants to preserve. The production backlog explicitly owns each replacement. Legal rates/thresholds/retention and current vendor messaging terms must be verified by the responsible implementation issue; historical design-note market claims are not production authority.
