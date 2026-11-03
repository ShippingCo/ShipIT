# ShippingCo interface study

The primary user is an Indian courier counter operator. At the counter, a useful screen answers three questions quickly: which customer or parcel is this, what does it need, and what can I do next?

## Reference study and design decisions

Vibrant is a curated gallery of other designers’ work. ShippingCo uses original components and artwork. The references below informed composition and interaction.

| Reference family | What we took from it | How it appears in ShippingCo |
| --- | --- | --- |
| [Login and signup](https://vibrant.design/sections/login-and-signup), including Clerk | Each screen makes the current authentication task prominent. | One form for the email or code. Photographic courier scenes identify the product on wide screens. Mobile gives the space to the form. |
| [Documentation](https://vibrant.design/sections/docs), including [Linear](https://linear.app/docs) and [Stripe](https://docs.stripe.com/) | Group destinations by intent and show readers where they are on a long page. | The sidebar groups counter, dispatch and business tasks. Settings has its own section index. Permissions determine which destinations appear. |
| [How it works](https://vibrant.design/sections/how-it-works), including Cofounder | Show the sequence without making the reader remember it. | The booking worksheet has numbered sections and a separate receipt summary. Each parcel keeps its own docket and receiver. |
| [Stats](https://vibrant.design/sections/stats), including Cloudflare and Mintlify, and [Features](https://vibrant.design/sections/features), including Stripe’s bento grid | Give the main number or comparison more space than supporting facts. | The dashboard pairs a booking trend with actionable work. A currency amount leads a payment review, with its allocations immediately below. |
| [Pricing](https://vibrant.design/sections/pricing), including Stripe | Put comparable amounts in a predictable reading order. | Payment review distinguishes money received, money applied and advance remaining. The server supplies all amounts. |
| [Changelogs](https://vibrant.design/sections/changelog) and [FAQs](https://vibrant.design/sections/faq) | Let readers scan events in order and expand supporting information. | Tracking foregrounds the most recent event. Less frequent settings and explanations expand where they are used. |

We also reviewed the hero, CTA, integrations, testimonials, logo cloud, careers, blog, footer and 404 sections. Their promotional patterns have little bearing on a counter operator recording a payment or confirming a delivery.

## Review sequence

1. Compare the previous production render with the revised access, workspace, booking, finance and reporting screens.
2. Inspect real populated and empty states. Keep zero amounts distinct from unavailable data. Link queue counts only to work the current role can open.
3. At phone widths, check for clipped labels, off-screen actions and page overflow. Inspect long dockets and multi-parcel bookings.
4. Exercise keyboard navigation, scoped searches, conditional settings, payment confirmation and recovery after interrupted requests.
5. Capture the release candidate from built HTML and check the expected screen heading before accepting each image.

## Public inventory and feature coverage

On 3 November 2026, Vibrant’s [sitemap index](https://vibrant.design/sitemap.xml) exposed two lists. The [project list](https://vibrant.design/sitemaps/projects-1.xml) contained 686 project pages (515 design feed, 148 website, 23 social preview), each accompanied by a CDN preview asset. The [page list](https://vibrant.design/sitemaps/pages.xml) contained 43 additional pages, including style and section indexes. The inventory counts project pages separately from their media. The visual studies used selected relevant examples rather than treating every video as a product workflow. The public moodboards URL led to a dashboard and provided no public board to inspect.

| Feature | Staff task | Design decision |
| --- | --- | --- |
| Sign-in, code and shop setup | Open the correct workspace | One form at a time, a single pasteable code field, and a photographic desktop panel that gives way to the form on mobile. |
| Dashboard | Choose the next task | Compare daily counts, the weekly booking chart and the actionable queue. |
| New booking | Book several parcels at one counter | Keep an editable worksheet, independent dockets, and a receipt summary beside it. |
| Bookings and parcel tracking | Find a parcel or cancel an eligible booking | Search by docket, show the latest movement and contacts, and confirm the scope of cancellation. |
| Customers | Start the next booking for a regular customer | Book directly from the search result, or inspect contact details first. Show booking actions according to permissions. |
| Delivery work and deliveries | Check due work and complete delivery | Put the active parcel, proof deadline and confirmation together. |
| Pickups | Agree a collection time | Allow staff to reuse the requested time window, with capacity and handling confirmation kept explicit. |
| Lots | Group parcels for dispatch | Lead with the destination and actual membership count. |
| Dispatch routes | Decide which route needs attention | Show the latest movement and ETA before planning controls. |
| Custody | Verify who holds the parcel or money | Lead with the custody state and expand technical evidence on request. |
| E-way records | Check validity and act on reminders | Distinguish official validity from the app’s estimate. |
| Support | Understand a customer case and follow up | Lead with reason, ownership and state. Separate customer activity, staff history and staff-only notes. |
| Automation and messaging | Investigate a notification | Lead with the recorded outcome. Put provider attempts on a timestamped activity list and IDs inside a disclosure. |
| Money hub | Find a daily or review task | Group links by counter work, balances and review. |
| Money receipts and booking receipts | Record an amount or print an existing receipt | Keep receipt search and print distinct from recording money. Show received, allocated and advance amounts together. |
| Cashbook | Review a request or expense | Show amount, payee, method and source before internal references. |
| Customer accounts | Understand credit and terms | Lead with the credit position and organize account terms and revisions separately. |
| Agent settlements | Compare amounts held and counted | Show cash variance, seller balance and unpaid fees before supporting transactions. |
| Reconciliation | Match an imported statement | Choose the receiving account first. Expose the live difference alongside the amounts being matched. |
| Financial approvals | Evaluate a proposed change | Find the booking by tracking number and compare the original and proposed amounts. |
| Reports | Read the right result for a business question | Separate sales and GST, booking snapshots, outstanding balances, delivery performance, messaging effectiveness, shipment costs, owner summaries and the accountant register. Use the saved snapshot as the source for each view. |
| Settings, rate cards and tax policies | Find an applicable setting and review edits | Use a section index and show how many preferences are set in each group. Keep the effective period, saved draft and publish confirmation visible at the relevant point. |
| Profile, invitations and sign-out | Manage an account session | Keep session actions in the profile and gate access by the active workspace. |

Additional component references selected from the complete public index include the [Northwind CRM activity interface](https://vibrant.design/feed/20axp2a-northwind-crm-activity-interface), [minimal history timeline](https://vibrant.design/feed/bltzezw-minimal-history-timeline-explorer), [invoice date picker](https://vibrant.design/feed/lxl9m9c-invoice-date-picker-interaction), and [Google Calendar empty state](https://vibrant.design/feed/yrgjhi7-google-calendar-empty-state). A recorded support event is shown as a vertical list item so a phone can display its full date and description. The app retains native date entry and accessible controls.

## Access motion

The desktop access panel is a series of original, AI-generated photographic scenes for booking, dispatch and delivery. Staff choose a chapter. Lenis moves the photography panel and GSAP draws the current step icon. The form stays stationary. At narrow widths a compact route mark replaces the poster. Reduced-motion mode renders the marks immediately and switches chapters without interpolation. The references were Vibrant’s [paper plane send interaction](https://vibrant.design/feed/qg6c7om-paper-plane-send-animation) and [Clerk sign-up page](https://vibrant.design/website/j03et94-clerk-s-sign-up-page).

The first-shop entry verifies an enabled business email. After verification the server determines whether to open shop setup or an existing workspace. Resending uses the existing bound challenge and the server-provided cooldown.
