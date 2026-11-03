# ShippingCo product context

ShippingCo supports courier counter work for Indian small and medium businesses. Use simple English for owners and counter staff. This is a minimal record of approved product facts, not a replacement roadmap or a claim that every proposed feature is delivered.

## Booking task

The booking counter uses the first ShipIT prototype’s single page. Staff choose or create the customer, select a destination and service, then add each parcel with its own paper docket number, receiver and delivery address. Packed weight is recorded in kg and liquid volume in litres. Staff confirm billing details, review the calculated price and save or print. The system assigns the booking reference.

Bookings are domestic India only and limited to supported tax jurisdictions. The current server tax admission boundary is a states-only pilot; it excludes Union Territories. This is not a claim that unsupported cases are exempt or that all Indian destinations are admitted.

Named services support flat or weight-based prices backed by published rates and tax policy. The server owns prices, tax, authorization and booking persistence in PostgreSQL. Browser selections and illustrative preview values are not authoritative business records.

Selected files remain queued locally until the booking has saved. Upload and mandatory scanning follow; only ready, clean attachments are available. An upload failure does not undo the booking or justify creating another booking.

A payment choice does not record money received. After a confirmed booking, actual receipt entry separately records the amount, receiving account and applicable receipt details. Printing loads the issued booking receipt and can be retried without making a new booking.

## Access and recovery

Actions remain subject to organization and branch scope and server authorization. In-flow service setup uses the existing `pricing.publish` administration capability; this document does not create a new staff role or permission. Preserve pending and uncertain command recovery, retained requests, stale-price checks and draft-loss protection.

## Communication and design commitments

Use familiar task labels and short, actionable errors. Preserve the established white and neutral gray interface with restrained blue, compact flat sections and visible keyboard focus. The approved booking composition is a centered desktop modal, full-screen on mobile, with persistent step actions. Broader historical design proposals are not permission to replace the current system.

Apply the booking flow's focus across work areas: separate dependent decisions into steps, reveal optional settings when needed, and use real named records where the server provides them. Keep short tasks direct and retain deliberate review before consequential actions. Do not invent lookup names, hide uncertain outcomes, or imply that a selection saves or publishes a record.

Evidence: `apps/web/src/booking/NewBooking.tsx`, `BookingServiceSetup.tsx`, `BookingAttachments.tsx`, `BookingPayment.tsx`, and `apps/api/src/modules/tax/validation.ts`. The isolated preview and its brief remain historical approval evidence, not production authority for rates, persistence or tax coverage.
