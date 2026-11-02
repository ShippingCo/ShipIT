---
version: 1
slug: "apps-web-src-booking-newbooking-tsx"
primary_target: "apps/web/src/booking/NewBooking.tsx"
related_targets: ["apps/web/src/booking/workflow.ts","apps/web/src/booking/BookingServiceSetup.tsx","apps/web/src/booking/BookingAttachments.tsx","apps/web/src/booking/BookingPayment.tsx","apps/web/src/booking/booking-modal.css"]
---

# Production booking modal

Mode: Operate. Ordinary extension of the incumbent ShippingCo application, implementing the user-approved `previews/booking-modal/preview.html` composition. The preview BRIEF remains untouched historical approval evidence. This contract applies to production `NewBooking.tsx` and the related workflow, service setup, attachments, payment and modal CSS.

Audience and task: Indian SME courier counter staff using simple English; search/create a real customer, enter one domestic receiver, add multiple parcels and billing facts, review the real quote, save and print. Scope is limited to supported tax jurisdictions (the server's states-only pilot excludes Union Territories). Published service rates and tax policy remain authoritative; no illustrative preview rates enter production.

Success includes a confirmed persisted booking, generated references, retryable issued-receipt printing, deferred attachment upload with mandatory scanning, and separate actual money-receipt entry. Service setup preserves the draft and uses the existing administration capability. Selecting a payment method records no receipt. Preserve scope, draft-loss and uncertain-command guards. Finish verification is reported by the implementation/review pass; this document records source evidence, not a deployment claim.

## Direction contract

THESIS: Four compact booking steps keep customer, receiver, parcel/billing and final review understandable at a working courier counter.

OWN-WORLD: Inherit white surfaces, neutral gray text and borders, restrained blue actions, existing inputs and buttons, and flat section grouping; do not replace the application identity.

STORY: Find or create the sender, identify the receiver, check packed kg and separate liquid litres, obtain the server price, review and save. Printing, files and received money retain their distinct outcomes.

FIRST VIEWPORT: Centered desktop dialog with 22px title, branch context, numbered steps and customer lookup; 19px task heading and persistent footer with Continue. Mobile is full-screen with one field column. The signature interaction is entering service setup and returning to the preserved booking.

FORM: User-pinned four-step modal, selected through the approved preview; ordered list and concept seed not applicable to this ordinary extension. Seed key: not applicable (user-approved existing composition, code-led).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

Finish interpretation: this ordinary extension preserves the incumbent design system. No DESIGN.md or sidecar existed at this boundary; their absence is pre-existing and does not authorize a replacement system. No new raster assets are required. The production brief is captured during the finish documentation pass from the approved preview and implemented source, not represented as a pre-implementation artifact.
