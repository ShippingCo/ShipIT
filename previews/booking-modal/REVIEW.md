# Booking modal preview review

This is the approved standalone four-step preview described in BRIEF.md. It extends ShippingCo's established visual world for Indian SME courier counter staff. It does not change the production application or integrate with a backend. Root PRODUCT.md and DESIGN.md were absent before this task; this local record does not establish new global design authority or repair unrelated drift.

The incumbent evidence in `docs/architecture/frontend-experience-redesign.md` identifies restrained blue actions (#2868c7), a gray sidebar (#f0f0f0), white content, open form sections and explicit keyboard focus. The preview preserves these colors with Segoe UI/system text, light dividers, labeled fields and a compact centered native dialog. Below 700px, the dialog fills the screen and form columns stack.

Implemented interactions, checked against index.html, style.css and app.js:

- **From:** search three sample customers by name or phone, select a result, or use the query to enter a new customer inline. Customer details remain editable. Search results support arrow-key navigation.
- **To:** enter one receiver for all parcels, with India as the only destination country. Four example PIN codes supply editable city/state suggestions. Required fields and phone/PIN formats are validated.
- **Parcel and Billing:** add/remove parcels; enter packed kg separately from liquid quantity in L or ml; choose a service; configure a service through Details, Pricing and Review inside the same dialog, then return to the preserved booking. Liquid compatibility is checked. Select payer, payment timing and method, enter money received, and view the running sample total and balance.
- **Attachments:** select up to five non-empty PDF/JPG/PNG files, up to 10 MB each; preview via local object URLs, categorize or remove them. No upload occurs.
- **Review and print:** edit completed sections, create a sample booking with an automatic PREVIEW reference, print a clearly marked sample receipt, reprint, or start another booking. Creation is briefly guarded against repeated clicks.
- **Navigation and recovery:** completed steps are revisitable; validation blocks advancement; native modal behavior contains focus. Close/Escape on changed input offers Keep editing or Discard booking. Setup, confirmation and success replace the body; step navigation is hidden in these states. Action controls stay outside the scrollable body.

All customers, service prices, GST arithmetic and booking references are local examples. Standard delivery starts at ₹80 plus ₹30 per additional rounded-up kg; Express starts at ₹140 plus ₹50. The sample tax is 18%. Custom service prices and flat charges are session-only. New customer entry belongs to the current sample booking, not a persistent customer directory. No live rates, tax verification, eligibility check, payment processing, durable drafts, database writes or backend integration are provided. Reloading loses session state.

The actual Impeccable plugin engine (0.1.5) context/detector pass was performed during implementation. Its recorded detector output is `dist/booking-preview-impeccable.json`: two sidebar contrast warnings and a colored-shadow warning from the earlier state. Independent review led to material fixes in the final CSS: an explicit hidden-step rule prevents the flex layout from exposing navigation during replacement states; sidebar secondary text and other muted labels/placeholders were darkened; disabled step text retains full opacity; the modal shadow is neutral. That JSON is the earlier detector record, not proof of a clean final detector run or a complete accessibility certification.

This documentation pass inspected source consistency only. It made no app edits and did not open a fresh visual review cycle.
