# New Booking redesign: audit and decisions

Scope: the production counter at `#/business/new-booking` (`apps/web/src/booking/`). Presentation and
interaction only; booking, pricing, tax, permissions and API contracts are unchanged. Measurements were read
from the running screen (disposable `pnpm preview:workflow` fixture) at 1440x900, 1280x720, 768x1024 and
375x812.

## Audit of the previous screen

| # | Severity | Finding (verified in the browser) | Fix |
|---|----------|-----------------------------------|-----|
| 1 | High | Below 1080px the summary and Save dropped under the form: Save sat at y=3255 of 3603px on a tablet and y=4494 of 4959px on a phone, with no total visible while typing. | Total and Save hold the bottom edge on narrow screens. |
| 2 | High | No field validated until Save. A malformed docket or a half-entered parcel size showed nothing beside the field; the only signal was an unexplained pill in the summary. | A filled field reports its problem when the operator leaves it; empty fields stay quiet. |
| 3 | High | Fields were 56px tall with a 14px value under a 15px semibold label (label outweighed the value, value below the 15px floor in `tokens.css`). The empty form was 1800px on a 900px viewport. | 46px fields, 15px values, 12px radius, all from tokens. Empty form 1560px; three sections above the fold. |
| 4 | High | Destination city sat in Parcel and Delivery address in Customer, so the two fields that say where the parcel goes were in different sections. | A Delivery section holds both. |
| 5 | Medium | The price card and the Copy button showed a question-mark glyph: `radio_button_checked` and `content_copy` are not in the bundled icon subset, and `Msym` falls back to `help_outline`. | The radio mark is drawn in CSS; Copy carries no glyph until it confirms with a tick. |
| 6 | Medium | The StepTrack strip took ~100px, was not interactive, and marked Customer done with the delivery address empty. | Removed; each section has its own heading and the summary lists what is missing. |
| 7 | Medium | The empty form's most prominent control was a filled "Save as draft". | The filled button is kept for a real booking; a draft uses the outlined style. |
| 8 | Medium | The "what is missing" list was a bordered box inside the summary card with 44px pills, one per row; the rail (870px) was taller than the viewport and its lower part was unreachable while stuck. | A plain list of compact chips; the rail scrolls within the viewport if it ever overflows. |
| 9 | Medium | Focus landed on the heading; "Discard draft" was the first tab stop and Save was 20+ stops away with no shortcut. | Cursor starts in the WhatsApp number field; Ctrl/Cmd+Enter saves from any field. |
| 10 | Medium | "Add package" sat between destination and weight; the parcel it created appeared ~900px lower. | The button ends the Parcel section and new parcels appear directly above it. |
| 11 | Low | "PROOF OF PARCEL" and "PAYMENT" were the only tracked-out capitals on the page; summary amounts were set in a monospace face. | Sentence-case legends; amounts in Inter with tabular figures, monospace kept for the docket. |
| 12 | Low | Helper text was indented 16px from its field; the kg/g toggle floated out of line with the weight box. | Helpers align with the field edge; the toggle matches the field height. |
| 13 | Low | Amounts flipped to a dash while a price was being fetched. | The total reads "Calculating…" while a price is pending. |
| 14 | Low | Saved view: three alignments (centred column, loose text, wider card), an empty "Attachments" heading, and "Booking saved." repeated under the actions. | One 560px column; the empty block and the repeated line are gone. |
| 15 | Low | Packing was listed before freight in the form and the summary. | Freight first. |

Earlier defects fixed on the same branch: every draft was refused by the server; the delivery address was
optional on screen but required by the server; refused bookings were silently turned into drafts; the only
available service still had to be clicked; a city outside the rate card was accepted without comment.

## Decisions

- **One page, four sections, a summary beside it.** A wizard was rejected: operators book dozens of parcels a
  day and every field is needed on almost every booking, so steps only add presses. Sections follow the
  counter conversation: Customer, Delivery, Parcel, Charges.
- **The summary is the receipt in progress**: facts, charges, one total, who pays and when, one action.
- **The design system is applied, not extended.** Every colour, size, radius and duration comes from
  `styles/tokens.css` (15px floor, 44px touch minimum, one accent, 1px hairlines). All new rules live in
  `booking/booking-form.css`, scoped to `.booking-counter-page`, so shared classes keep their meaning on other
  screens, including the fictional demo form.
- **21st.dev** was used for pattern reference only (sectioned forms, radio cards, order-summary rails, sticky
  action bars). Its tool server was not connected in the session, and the repo's own primitives covered every
  need, so no component was installed and no dependency was added.
- **No new business capability.** `RateChoices` now hands its destination field, service field and price
  options to the page as separate parts so they can sit in the right sections; its data loading and rules are
  untouched.

## Deliberate deviations and follow-ups

- The usual service is pre-selected where the destination has published prices. The earlier rule was that
  nothing is chosen until the operator chooses (see the comment in `PriceOptions.tsx`); the summary previously
  claimed "Standard" before anything was selected, and a single option still required a press.
- Tax lines before saving remain a client-side preview of the branch GST treatment; the authoritative figures
  are calculated by the server on Save, as before.
- "Save booking and collect ₹X" still does not record the money; the receipt is recorded on the saved screen.
  Recording it in one step needs a product decision and server work.
- Parcel/package wording is mixed in labels ("Add package", "Parcel 2"). Unifying it touches user guides and
  many tests and was left out of this change.
- Destination remains a text field with native suggestions. A full combobox is a reasonable next step.
- User-guide screenshots under `docs/user-guides/images/` still show the previous layout; the guide text for
  this screen was updated.
