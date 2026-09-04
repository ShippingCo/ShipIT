# ShippingCo — Product & Design Specification v1

**For:** the opencode agent working in `D:\ShippingCo`
**From:** product/design review of the full codebase (every screen, flow, component and button read)
**Design system:** Material Design 3 (m3.material.io) + modern-consumer-web component craft

Read this whole document before touching code. Execute in work-package order (WP0 → WP7).
Run `npx vitest run` after every work package — 18/18 pass today, keep them green.
Do not batch unrelated packages into one commit.

---

# 0. Product framing

## Who uses this

An owner-operator of a small Indian courier / transport company — think *Shree Balaji Courier Service, Ahmedabad, since 2011*, 5–50 staff. They book LRs at a counter, group parcels into lots, put lots on a flight/train/truck, and chase money. They are on a laptop at the counter and a phone in the godown.

## What the product actually sells

**ShippingCo's thesis is that customers stop calling.** Every business action silently fires a WhatsApp update, so the owner's phone stops ringing with "where is my parcel". That is the entire value proposition — and today the UI barely shows it. The Automation Feed is buried at nav position 6 and the dashboard never mentions it.

## The three questions the console must answer

1. **What is broken right now?** (delays, failed deliveries, unpaid To-Pay, pending OTPs)
2. **What is moving?** (today's dispatch, in-transit parcels)
3. **Where is docket SBC104201?** (the phone-call lookup)

Every design decision below traces back to one of those three.

## Non-negotiable constraints from the owner

1. Rename **Setu Courier OS → ShippingCo** everywhere user-facing.
2. **Delete the greeting.** No "Good day, {name}", no replacement greeting, ever.
3. **Few colors.** One accent hue. Semantic color only where it carries status meaning.
4. **No AI slop.** Banned outright: gradient headers, glassmorphism/blur panels, a colored circular icon chip on every list row, emoji as iconography, rainbow stat-card grids, decorative illustrations, sparkle/✨ flourishes, drop shadows on everything.
5. **Component craft bar = modern consumer web (Airbnb-tier).** Specified in §3.
6. Follow **Material Design 3** as the system. Don't invent a parallel one.

---

# 1. Audit — what is actually wrong today

I read every file. These are real, verified defects, ordered by severity. Fix them as you go through the work packages; each is tagged with the WP that owns it.

## Correctness bugs

| # | Issue | Location | WP |
|---|---|---|---|
| B1 | **"New Booking" in the appbar and the FAB are broken.** Both call `navigate('/booking')`. That absolute path doesn't match the nested `/business/*` routes, falls through to the `*` route in `App.jsx:18`, and redirects the user out to the Launcher. Two of the three primary CTAs in the app are dead. | `BusinessShell.jsx:102,119` | WP1 |
| B2 | **"Resend OTP" silently issues a *new* OTP.** It calls `updateStatus(id,'out_for_delivery')`, which regenerates `b.otp`, appends a duplicate timeline row, and fires a second WhatsApp message. The customer now holds two OTPs and the counter staff sees a changed code. | `PackagesPage.jsx:201` → `store.js:248-251` | WP5 |
| B3 | **A parcel can never be removed from a lot.** The "Move to lot" select has `onChange={(v) => { if (v) {...} }}` — picking "— None —" passes `''` and is swallowed. The option is rendered but does nothing. | `PackagesPage.jsx:176-183` | WP5 |
| B4 | **The delivery OTP is printed in plain text in the business console.** Staff can read the code off the screen and mark a parcel delivered without the customer ever receiving it. That defeats the entire anti-theft purpose the product advertises to the customer. | `PackagesPage.jsx:167` | WP5 |
| B5 | **Receipt printing is forced.** `printReceipt()` fires unconditionally inside `submit()`, so every booking slams a native print dialog in the user's face with no opt-out. It is also why the test suite emits `Error: Not implemented: window.print`. | `NewBookingPage.jsx:55` | WP4 |
| B6 | **"Booked revenue" is mislabeled.** It sums every booking ever created but the sub-line reads "{current year} total". | `Dashboard.jsx:25,104` | WP2 |
| B7 | **The attach-parcels list is silently truncated to 14** with no count, no search, and no indication anything is hidden. A shop with 60 open parcels can't attach #15. | `RoutesPage.jsx:217` | WP5 |
| B8 | **No OTP attempt limiting.** `verifyDeliveryOTP` can be brute-forced 10,000 times with no lockout and no audit trail. | `store.js:258` | WP5 |

## Product model gaps

| # | Gap | Why it matters to this audience | WP |
|---|---|---|---|
| G1 | **There is no payment model.** `amount: { packing, freight }` and nothing else — no paid/to-pay, no settlement. In Indian courier operations **To Pay vs Paid is the single most important field on the LR**, and outstanding To-Pay recovery is the owner's biggest daily anxiety. It is currently invisible in the product. | Blocks the most valuable dashboard metric | WP2 |
| G2 | **The status flow is happy-path only.** `STATUS_FLOW` runs booked → delivered with no `failed_attempt` and no `rto`. Real deliveries fail — customer not home, address wrong, refused — and the parcel comes back. There is no way to represent that. | Exceptions are half the job | WP5 |
| G3 | **No global search.** The owner's single most frequent interaction is a customer phoning to ask about a docket. Search exists only *inside* the Packages page, behind two clicks. | Highest-frequency task is slowest | WP3 |
| G4 | **The automation story is invisible.** `data.outbox` holds proof that the product is doing its job and nothing surfaces it except a buried log page. | The product's thesis is unstated | WP2 |

## Consistency and craft defects

- **Cards fight for attention.** Every card is `variant="elevated"` on a pure-white page (`--md-background` and `--md-surface` are both `#ffffff`), so each one needs a drop shadow to be visible at all. Reads heavy and dated.
- **Three accent families in decorative use** (primary blue, tertiary sky, secondary steel), plus two hardcoded off-token hexes at `tokens.css:94-95` and another at `PackagesPage.jsx:194` (`#f79009`).
- **Delay is signalled three times on one card** — red left border + red pill + red danger button (`RoutesPage.jsx:73,89,97`).
- **The "What happens after you save" card is a large solid blue block** with inline hardcoded colors (`NewBookingPage.jsx:134`). Prime AI-slop territory.
- **Two navigation idioms.** Most places use `navigate()`; `MiscPages.jsx:39,77` assign `location.hash` directly.
- **Two confirmation idioms.** Everywhere uses `ConfirmDialog`; `Launcher.jsx:66` uses native `window.confirm`.
- **Two broadcast flows that are the same feature** — "Message lot" (`LotsPage`) and "Broadcast" (`RoutesPage`) — with different button classes (`btn-wa` vs `btn-filled`) and different copy.
- **Inconsistent phone rendering.** `prettyPhone()` on Packages, raw `b.phone` on Dashboard.
- **Inconsistent table columns.** Packages shows Amount; the Dashboard's recent-bookings table doesn't.
- **Dead keyboard paths.** The dashboard stat tiles carry `role="button" tabIndex={0}` with no `onKeyDown` and no visible focus ring.
- **No loading or skeleton states anywhere.**
- **`avatar avatar-neutral` circles behind every list-row icon** (`Dashboard.jsx:119,142`) — the exact "AI dashboard" tell we're removing.

---

# 2. Design system

## 2a. Surfaces — tonal, not shadowed

The root problem: white cards on a white page have no separation, so shadow is doing work that tone should do. Follow M3's tone-based surface model — the page canvas is a tint and containers sit lighter on top of it.

In `src/styles/tokens.css`:

```
--md-background        #f6f7f9   /* page canvas — a tint, NOT white */
--md-surface           #ffffff   /* cards sit on the canvas */
--md-surface-low       #fbfbfc
--md-surface-c         #f3f4f6
--md-surface-high      #eceef1
--md-outline-variant   #e4e7ec   /* hairline — the primary separator */
```

Then make **outlined the default and only in-flow card**: `background: var(--md-surface)`, `border: 1px solid var(--md-outline-variant)`, `box-shadow: none`, `border-radius: var(--shape-lg)`. Replace every `variant="elevated"` across the app with the outlined default. Shadow (`--elev-2`, `--elev-3`) is reserved for genuinely floating surfaces only: dialogs, menus, snackbars, and the mobile FAB.

## 2b. Color — one accent

- **Primary blue `#2563eb` is the only brand hue.** It appears on exactly: the primary button, the active drawer item, focus rings, links, and selected states. That is the complete list.
- **Retire tertiary and secondary from decorative use.** Keep them only as status tokens.
- **Delete every hardcoded hex outside `tokens.css`** — `tokens.css:94-95`, `PackagesPage.jsx:194` (`#f79009`), and the inline `primary-container` block at `NewBookingPage.jsx:134`. Map `in_transit` onto `--md-primary-container` / `--md-on-primary-container`.
- **Semantic color is status-only.** Error = delayed / failed / RTO. Warning = out-for-delivery, OTP pending, To-Pay outstanding. Success = delivered, settled. Never decorative, and **never as a full card background** — a delayed row gets a pill, not a pink panel.
- **Signal each state once.** On the route card, keep the status pill and drop the red left border; the danger button already carries its own weight.

## 2c. Status pills

Rebuild `StatusPill`: `font: 500 11px/1`, `letter-spacing: .04em`, uppercase, `padding: 4px 8px`, `border-radius: var(--shape-xs)` (4px — small rectangles read as data labels; fully-round pills read as marketing tags), tonal background + `on-container` text from the status tokens, no border, one size. Drop the `<span className="dot" />`; the tonal fill already encodes state and the dot is redundant ink.

## 2d. Type

- Headings: weight 600, `-0.01em` to `-0.02em` tracking. Tight tracking is most of what makes type read as modern.
- Body: 14px/1.5 for console density. **Exactly two text colors** — `--md-on-surface` primary, `--md-on-surface-variant` secondary. Stop there.
- **`font-variant-numeric: tabular-nums` on every figure** — stat values, money, counts, dates, table columns. Non-aligning digits in a column is the single loudest tell of an unpolished dashboard.
- Dockets and carrier codes in the mono stack.
- Darken `--md-on-surface-variant` from `#667085` to about `#5a6474` — it currently fails 4.5:1 against `--md-surface-c`.

## 2e. Spacing and shape

8px grid, no exceptions. Card padding 20px desktop / 16px mobile. Section gap 24px. List row vertical padding 12px. Shape scale applied consistently: cards 16px, buttons and inputs 8px, pills and chips 4px, avatars and FAB full. A component never invents a radius.

---

# 3. Component craft

The bar is *"very perfect and modern, like Airbnb."* That's a finish standard on top of Material's structure, not a second design system.

**Borders over shadows.** A 1px `--md-outline-variant` hairline is the default separator everywhere — cards, table rows, list dividers, inputs. Crisper at every zoom level than a soft shadow, and it's what well-built modern products do.

**Four states on everything interactive.** Rest, `:hover` (background steps one surface level up), `:active` (steps down, `transform: scale(.995)` on cards), `:focus-visible` (`outline: 2px solid var(--md-primary); outline-offset: 2px`). No exceptions — every button, row, tile, chip and table row. Anything with `role="button"` also gets an `onKeyDown` handler for Enter and Space.

**Motion is short and purposeful.** `--dur-s: 120ms` for state changes, `--dur-m: 220ms` for entering elements, `var(--ease-emph)`. Never animate layout on hover — no rows that grow. Add a global `@media (prefers-reduced-motion: reduce)` guard that kills animation and transition.

**Every state is designed.** `EmptyState` gets a 20px outline icon in `on-surface-variant` (not a giant colored glyph), a one-line title, one sentence of guidance, one action. Add skeleton rows — a neutral shimmer on `--md-surface-c` — for tables and lists. Add error states for failed actions.

**Icons.** Material Symbols, outlined, weight 400, 20px in rows, 18px inline. One color: `--md-on-surface-variant`, stepping to `--md-on-surface` on hover. **Delete the `avatar avatar-neutral` circles from list rows.** Bare icon, aligned to the text baseline.

**Forms.** Inline validation on blur, not only on submit (`NewBookingPage` currently validates only at submit and dumps three errors at once). Error text sits under the field in `--md-error` with an `error` icon. Required fields marked. `autoComplete` on name/phone. The submit button shows a spinner and disables — `saving` state already exists but isn't wired to `loading`.

**Dialogs.** Trap focus, restore focus to the trigger on close, close on Escape and scrim click, and put the destructive action on the right in `btn-danger`. Long lists inside dialogs scroll in their own container with the action bar pinned.

**Tables.** Sticky header, 48px rows, hairline dividers only (no zebra striping), numeric columns right-aligned with tabular-nums, whole row clickable with a visible focus ring, and a column set that's consistent between Dashboard and Packages.

---

# 4. Screen-by-screen specification

## 4.1 Dashboard — full redesign

### Why the current one fails

It is a *stats poster*, not a console. An owner opening it at 9 AM learns "you have 5 parcels and ₹1,620 all-time revenue" — neither changes what they do next. The information that does is buried: **"Needs attention" is the third section, below the fold.** And "Booked revenue, all time" is a vanity number; the number that matters is **To-Pay outstanding**.

**Governing principle: the dashboard is a work queue, not a report.** Top answers "what is broken?", middle answers "what is moving?", bottom answers "what happened?".

### Structure, top to bottom

**① Context bar** — replaces the hero. No greeting.

A single quiet line, not a card. Left: `Monday, 22 August` in `on-surface` · `Dispatch cutoff 6:00 PM` in `on-surface-variant`. Right: one primary `New Booking` button and a text-button `Customer WhatsApp`. Height ≤ 44px. That is the entire header.

**② Action queue — "Needs attention"** *(promoted from third position to first)*

The `attention` array at `Dashboard.jsx:28-63` is genuinely good logic. Keep it, promote it, and give every item **an inline resolving action** instead of only a chevron — right now each row just navigates elsewhere, which makes it a table of contents rather than a queue.

| Trigger | Row reads | Inline action |
|---|---|---|
| Route status `delayed` | `RT-201: Ahmedabad → Delhi delayed · fog near Kota, ~6h` | `Notify 8 customers` |
| Booking `out_for_delivery` | `SBC104171 out for delivery — OTP pending` | `Verify OTP` |
| ≥2 bookings with no `lotId` | `4 parcels not in any lot` | `Group into lot` |
| Unsent `outbox` entries | `3 messages queued` | `View feed` |
| **NEW** — delivered but unsettled To-Pay | `₹12,400 pending from 6 delivered parcels` | `Record payment` |
| **NEW** — `out_for_delivery` past `etaTs` | `SBC104198 undelivered past ETA` | `Mark failed attempt` |

Sort by severity: error → warning → informational. Show 5, then `Show all (N)`. Zero state: a 20px `task_alt` in `--md-success`, the words `All clear`, one sentence. Nothing more.

**③ Metric strip** — four tiles, re-chosen

Drop "Total parcels (all time)" and "Booked revenue (all time)". Neither is actionable; lifetime revenue belongs on a Reports page.

| Tile | Value | Sub-line |
|---|---|---|
| **Out for delivery** | count | `N awaiting OTP` |
| **In transit** | count | `across N routes` |
| **Exceptions** | delayed + failed | `N customers notified` |
| **To-Pay pending** | `₹` amount | `from N delivered parcels` |

Tile: `--md-surface`, 1px hairline, 16px radius, 20px padding. Label in `label-medium` `on-surface-variant`, uppercase, `.04em`. Value in `display-small` (32px/600, tabular-nums, `on-surface`). Sub-line `body-small` `on-surface-variant`. **No icon, no colored background, no accent border** — except the Exceptions tile when its count > 0, which turns *only its value* `--md-error` and changes nothing else. The restraint is the point. All four clickable with real focus rings and Enter/Space handlers. 4-up desktop / 2-up tablet / 1-up mobile.

**④ Two-column band — Today's dispatch (2fr) + Comms pulse (1fr)**

*Today's dispatch.* The existing route list, upgraded to show readiness: mode icon, `Ahmedabad → Mumbai` in `title-small`, carrier code as a mono chip, `18 parcels · departs 6:40 PM`, a 3px linear progress bar of manifested-vs-booked, status pill, chevron. Filter to routes departing today. Footer link `View all routes →`.

*Comms pulse.* **This card doesn't exist yet and it is the product's whole thesis.** Show that customers aren't calling: a large tabular `142` over `updates sent this week`, a 7-bar column chart of the last seven days (bars in `--md-primary`, today at 100% and prior days at 40% opacity — one hue, no legend, no axis chrome), and beneath it `23 queued · 0 failed`. Source: `data.outbox`.

**⑤ Recent bookings table**

Last. Sticky header, 48px rows, hairline dividers, docket in mono/medium, customer name over `prettyPhone(b.phone)` in `body-small`, **Amount right-aligned with tabular-nums**, a **`Paid` / `To Pay` column** (fundamental to Indian courier billing and currently invisible), status pill, and relative time (`2h ago`) with the absolute datetime in a `title` attribute. 8 rows, then `View all packages →`.

### Responsive

12-column grid, 24px gutters, `max-width: 1280px`, centered. Under 1024px the two-column band stacks and metrics go 2-up. Under 600px everything is single column, card padding drops to 16px, and the recent-bookings table becomes stacked cards rather than scrolling horizontally.

## 4.2 App shell

- **Fix B1**: both `navigate('/booking')` calls become `navigate('/business/booking')`.
- **One primary action per screen.** Appbar button, FAB, and context-bar button are all "New Booking". Keep the context-bar button on desktop; show the FAB **only below 600px**; drop the appbar duplicate in favour of search.
- **Add global search to the appbar** (fixes G3). Placeholder `Search docket, phone, or customer`. Matches across `docket`, `phone`, `name`. `/` focuses it, `Esc` clears, arrow keys move through results, Enter opens. Results in a dropdown showing docket + name + status pill, deep-linking to the package detail. This is the highest-value single addition in the whole spec.
- Drawer: keep the structure, add a `Reports` slot placeholder, and move `Automation Feed` up — it's the proof the product works, not an afterthought.
- Appbar `TITLES` map: replace the `'Setu Courier OS'` fallback with `'ShippingCo'`.

## 4.3 New Booking

- **Fix B5**: stop auto-printing. Save, then show a snackbar `Docket SBC104211 saved · WhatsApp sent` with a **`Print receipt`** action. Alternatively a split submit — `Save` primary, `Save & print` secondary. Either way printing becomes a choice. This also clears the `window.print` noise from the test run.
- **Tone down the blue block** (`NewBookingPage.jsx:134`): make it an outlined card with a `title-small` heading and a plain ordered list. Same information, no solid-colour panel, no `auto_awesome` sparkle icon.
- Inline validation on blur. Wire the existing `saving` state to the button's `loading` prop.
- **Add the payment field** (G1): a `Paid / To Pay` segmented control, defaulting to `Paid`. It writes `payment.mode`. This is the highest-value field missing from the form.
- Show a live ETA estimate from `estimateEtaDays(to)` next to the destination field — the counter clerk is asked "when will it reach?" on every single booking.
- Total payable is currently `--md-primary` coloured; make it `on-surface` at `title-lg`. Money isn't a brand moment.

## 4.4 Packages

- **Fix B3**: allow un-assigning a lot — remove the truthiness guard so `''` clears `lotId`.
- **Fix B4**: mask the OTP in the console. Show `• • • •` with a `Reveal` affordance that requires an explicit click and writes a timeline entry (`OTP revealed by staff`). Keeps the supervisor override, kills the silent bypass.
- **Fix B2**: `Resend OTP` gets its own store action that reuses the existing `b.otp`, appends one timeline entry, and sends one message. Never route it through `updateStatus`.
- **Fix B8**: cap OTP attempts at 5, then require a supervisor reveal; log failures to the timeline.
- **Add failed attempt / RTO** (G2): extend `STATUS_FLOW` with `failed_attempt` and `rto`, add the matching status tokens, labels, WhatsApp copy, and a `Mark failed attempt` action in the detail dialog with a reason picker (customer unavailable / address wrong / refused / cash not ready).
- Add a `Payment` column and a `To Pay` filter to the segmented control.
- Add `Record payment` to the detail dialog for To-Pay parcels.
- Use `prettyPhone` consistently.

## 4.5 Lots & Routes

- **Unify the two broadcast flows.** "Message lot" and "Broadcast" are the same feature. Extract one `BroadcastDialog` used by both, with one button style (drop `btn-wa`), one copy pattern, a recipient count, and a message preview rendered in the WhatsApp bubble style so the owner sees what the customer sees.
- **Fix B7**: the attach dialog gets a search field, a real scroll container, and a `Showing 14 of 62` line — never silent truncation.
- Route card: drop the red left border (§2b — signal once). Collapse the five action buttons into one primary (`Mark Departed` / `Mark Arrived`, whichever the state calls for), `Report Delay` as outlined-danger, and the rest behind an overflow menu.
- Replace the `<details>` event history with a proper timeline component shared with the package detail dialog. Same data shape, same visual language — build it once.
- The delay dialog is the product's best moment: `Send delay alert to 8 customer(s)` on a single click. Give it the weight it deserves — show the affected customer names and a preview of the exact message before sending.

## 4.6 Automation Feed, Receipts, Settings, Launcher

- **Feed**: this is the proof the product works. Add a summary strip (`142 sent · 23 queued · 0 failed`), filters by type (booking / status / delay / broadcast / manual), and per-message delivery state. Replace the `avatar ic-accent` bot circle with a plain 20px icon.
- **Receipts**: add search and a date filter; add a Payment column. Replace `location.hash = ...` with `navigate()`.
- **Settings**: group into sections (Business profile / Branding / Data). Add a dirty-state guard so the Save button disables until something actually changes, and warn on navigating away with unsaved edits.
- **Launcher**: rename to ShippingCo, replace `window.confirm` with `ConfirmDialog`, drop the 💡 emoji line, and restyle the two entry cards as outlined rather than elevated.

---

# 4.7 Environment conventions on this machine

Learned the hard way during WP0 — follow these to avoid wasting tool calls:

- **The shell is Git Bash, not PowerShell.** `Select-String`, `ForEach-Object`, `Select-Object` and `$($...)` interpolation are all syntax errors here. Use `grep`, `head`, `tail`, `wc`, and your own Grep/Glob tools instead.
- **Use `npx.cmd`, not `npx`.** PowerShell's execution policy blocks `npx.ps1` on this machine. `npx.cmd vitest run` and `npx.cmd vite build` work.
- **This project does not use git, and must not.** Do not run `git init`, `git add`, `git commit`, or any other git command. Do not create a `.gitignore`. Do not suggest version control. Verify work with `npx.cmd vitest run` and `npx.cmd vite build` instead.

---

# 5. Work packages — execute in this order

Each package is independently shippable and independently testable. Do not start the next until the previous is green.

**WP0 — Rename to ShippingCo.**
`index.html:6`, `package.json:2,6`, `Launcher.jsx:13`, `BusinessShell.jsx:101`, `tokens.css:2`, any brand string in `bot.js`. Leave `prototype/**` alone — it's the dead HTML prototype. **Migrate localStorage rather than just renaming**: `store.js:7` `setu_courier_v2` → `shippingco_v1`, and `CustomerWhatsApp.jsx:28,37` `setu_current_phone` → `shippingco_current_phone`; on first read, if the new key is absent and the old key exists, copy it across so existing demo data survives. Update `app.test.jsx:20,37` to the new key and title.

**WP1 — Critical bug fixes.** B1 (broken nav — do this first, it's a two-character fix that unbreaks two of three primary CTAs), B5 (forced print), B6 (revenue label).

**WP2 — Design system foundation.** §2 in full: tonal surfaces, outlined-by-default cards, one accent, hardcoded hexes removed, status pills rebuilt, type and spacing scales, contrast fix. This is pure CSS + `Surface.jsx` and touches every screen at once.

**WP3 — Payment model.** G1: add `payment: { mode: 'paid' | 'topay', settled: boolean, settledTs: number | null }` to the booking shape, default `{ mode:'paid', settled:true }`, migrate existing records on load, add `recordPayment(id)`, surface it in the booking form, the Packages table and filters, the Receipts table, and the dashboard To-Pay tile.

**WP4 — Dashboard redesign.** §4.1 in full, including the new Comms pulse card. Depends on WP2 and WP3.

**WP5 — Packages, Lots, Routes.** B2, B3, B4, B7, B8, G2, plus the unified broadcast dialog and the shared timeline component.

**WP6 — Global search.** G3: appbar search with keyboard navigation. Ship it alone — it's self-contained and high value.

**WP7 — Craft pass.** §3 applied everywhere: focus states, keyboard handlers, skeletons, empty and error states, reduced-motion guard, dialog focus trapping, consistent `navigate()` and `ConfirmDialog` usage.

---

# 6. Definition of done

- `npx vitest run` — 18/18 passing, and the `window.print` stderr noise is gone.
- `npx vite build` — clean.
- No occurrence of "Setu" in any user-facing string.
- No greeting line anywhere in the app.
- Zero hardcoded hex values outside `tokens.css`.
- Every interactive element has a visible `:focus-visible` state and works from the keyboard.
- Every element with `role="button"` has a matching `onKeyDown`.
- The dashboard's action queue and metric strip both fit above the fold at 1440×900.
- Tabular numerals on every numeric column.

---

# Part 7 — Remaining pages: PM map (v2)

Each page below is stated as: **the job** → **what's wrong** → **what I'm building**.
The recurring test: *does this change what the owner does in the next hour?*

---

## 7.1 Packages — "find one parcel, or clear today's pile"

**The job.** Two completely different jobs share this screen. (a) The phone rings —
*"where is SBC104201?"* — and the answer must come in seconds. (b) Ten parcels arrived at
the hub and all need checking in.

**What's wrong.**
- Search is a floating-label form field parked top-right, not a search bar. It isn't
  focused, has no shortcut, and looks like data entry rather than lookup.
- The filter segmented control shows no counts, so the owner cannot see where work is
  piled up without clicking each filter in turn.
- **There are no bulk actions.** Checking in ten parcels means opening ten dialogs and
  clicking through each one. This is the single biggest time sink in the app.
- The table cannot be sorted.

**Building.**
- A real search bar at the top: full width, autofocused, `/` to focus, `Esc` to clear,
  matching docket / name / phone / city.
- Filter chips carrying live counts — `All 12 · Active 8 · Delayed 1 · To Pay 3 · Delivered 4`.
  The count *is* the information; the owner sees the pile before clicking.
- **Bulk select** with a checkbox column and a sticky action bar: *Check in at hub*,
  *Add to lot*, *Mark dispatched*. One action, many parcels, one WhatsApp each.
- Sortable Docket / Amount / Booked columns.

---

## 7.2 Lots — "group parcels travelling together"

**The job.** Put parcels that ride the same vehicle into one bag so a single message
updates every customer on it.

**What's wrong.**
- A lot's whole purpose is to be attached to a **route** — and the card never says
  whether it is. A lot with parcels and no route is invisible dead weight.
- The primary action (*Add parcels*) sits at the bottom in tonal styling, level with a
  text button.
- Delete is a bare icon in the corner with no grouping.

**Building.**
- Card states the link: **"On RT-102 → Mumbai, leaves 6:40 PM"**, or a warning
  **"Not on any route yet"** with a *Put on a route* action. This is the missing half of
  the feature.
- One primary action (*Add parcels*), one secondary (*Message*), delete moved into an
  overflow menu.
- Destination chips instead of a bare count, so the owner sees the lot is mixed.

---

## 7.3 Dispatch Routes — "one update tells everyone"

**The job.** Run today's dispatch, and when something changes, tell every affected
customer once.

**What's wrong.**
- Five buttons of equal visual weight on every card. Nothing says what to do next.
- Event history is hidden inside a `<details>` toggle.
- **The delay flow is the product's best moment** — one click alerts eighteen customers —
  and it looks exactly like everything else on the card.
- Routes aren't grouped, so finished ones compete with today's work.

**Building.**
- One primary action per state (*Mark Departed* → *Mark Arrived*), *Report Delay* as
  outlined-danger, everything else into an overflow menu.
- The affected-customer count stated on the card: **"18 customers get told"** — that is
  the reason to press the button.
- Group into **Today / Upcoming / Completed**, completed collapsed.
- Event history uses the same timeline component as the package detail, built once.

---

## 7.4 Receipts — "reprint a bill"

**The job.** A customer wants a duplicate receipt, usually days later.

**What's wrong.** No search and no date filter — the only way to find a receipt is to
scroll. Useless the moment there are 200 bookings.

**Building.** Search by docket/name/phone, a date-range filter (Today / This week /
This month / All), and the payment column already added.

---

## 7.5 Settings — "my shop's identity"

**The job.** Set what appears on receipts and in the customer's WhatsApp. Touched rarely,
so it must be obvious and safe.

**What's wrong.** One flat block of nine fields with no grouping. Save is always enabled
even with nothing changed, and navigating away loses edits silently.

**Building.** Three sections — **Shop details**, **Branding**, **Assistant** — plus the
existing danger zone. Save disabled until something actually changes, and a warning
before leaving with unsaved edits.

---

## Applies to every page

- One primary action per screen; secondary actions demoted or moved to overflow.
- Every list has a designed empty state with one action.
- One line per row: no sub-captions restating the title.
- White surfaces, 1px `--md-outline-variant` borders, tabular numerals on all figures.
- Entrance motion only, and only on real content.

---

# Part 8 — Market research and what it changed

Sources: eShipz (failed deliveries / NDR-RTO), CampaignHQ (delivery-exception playbook
for Indian D2C), 2Factor and Message Central (WhatsApp Business API rules in India),
WhatsBoost / wa.expert (vernacular messaging), Navata and AAJ Swift (PTL corridor
operations), Postmate (courier management software for Indian agents).

## Findings that changed the product

| Finding | Consequence in the app |
|---|---|
| Indian customers prefer WhatsApp to SMS by roughly **3:1**; India is WhatsApp's largest market at **535M MAU**. Any courier tool treating it as an afterthought is not built for this market. | Confirms the whole thesis. The assistant panel now states reach, answers and gratitude in the owner's own numbers. |
| **Hindi templates outperform English by 1.8–2.5x** on click-through for Tier 2/Tier 3 customers. | Every automated message is now bilingual (`src/data/messages.js`), with a **Message language** setting in Settings. |
| **40–50% of failed deliveries are recoverable** if the customer is contacted within hours. Carriers allow **~3 attempts across 24–72 hours** before returning to sender. | Failed delivery starts a visible clock. `recoveryQueue()` ranks failures by hours remaining; the dashboard shows *"2 deliveries failed — 1 returns to sender within 24h"*. The customer message asks for a decision (1 retry / 2 new address / 3 call me) rather than just informing. |
| **RTO is 15–25% prepaid but 25–40% for COD.** | To Pay parcels are structurally riskier, which is why To Pay ageing sits on the dashboard as its own number. |
| Meta's **24-hour rule**: a business may reply freely only within 24 hours of the customer's last message; after that only approved templates. | Each escalation now shows **"Free reply · 6h left"** or **"Needs a template"**, so the owner knows whether replying is free. |
| TRAI/Meta expect a visible **opt-out** on business-initiated messages. | Templates carry *"Reply STOP to turn these updates off"* (Hindi equivalent in Hindi mode); the bot already honours STOP. |
| Message cost is **₹0.15–0.30**, and rebooking/address-correction conversion is **4–6x SMS**. | Justifies routing recovery through WhatsApp rather than calls. |
| PTL corridor operations: booking → local consolidation hub → line haul → destination hub → last-mile. | Exactly the booking → lot → route → delivery model already built. |

## On the two improvement points raised

Both were already implemented before this research, and the research supports them:

1. **Route-level delay entry.** Reporting a delay on a route notifies every customer with
   a parcel on that carrier in one action — the card states *"18 customers get told when
   this changes"* before the button is pressed. This is the correct level: the delay is a
   property of the flight, not of each parcel.
2. **Lots.** Parcels are grouped into lots, lots attach to routes, and a lot card now
   states which route it rides or warns that it is stranded. Bulk selection on Packages
   can move many parcels into a lot at once.
