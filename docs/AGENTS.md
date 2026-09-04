# ShippingCo — Agent Memory

Durable context for any agent working in this repo. Read fully before editing.
Companion document: `DESIGN_BRIEF.md` (full audit, screen specs, market research).
Last verified: 2026-08-22 — `npx.cmd vitest run` = 21/21 green.

---

## 1. What this is

**ShippingCo** (renamed from "Setu Courier OS" — never reintroduce "Setu" in user-facing strings) is a React SPA: a customer-connection layer for small Indian courier/transport businesses (5–50 staff, owner-operator at a counter).

**Product thesis: customers stop calling.** Every business action silently fires a WhatsApp update, so the owner's phone stops ringing with "where is my parcel". The UI must make this automation visibly valuable or nobody buys it.

- Audience: Indian SME/SMB courier owners, **not highly literate in English** — design icon-led and number-led.
- Workflow model: customer walks in → paper receipt with docket → parcel booked → grouped into lots → lots ride routes (flight/train/truck) → delivery with OTP → money collected (Paid / To Pay).

## 2. Stack & commands

| Thing | Value |
|---|---|
| React 18 + react-router-dom 6 (`HashRouter`) | Vite 5, `vite-plugin-singlefile` |
| Tests | vitest + testing-library, `src/test/app.test.jsx` |
| Package manager | pnpm |
| Dev server | port 5173 |

```powershell
npx.cmd vitest run      # after every change — keep green
npx.cmd vite build      # must stay clean
```

Environment notes:
- This machine's shell here is **PowerShell 5.1**. Use full cmdlet names; no `&&` chaining; use `;` / `if ($?)`.
- Use **`npx.cmd`**, never bare `npx` (execution policy blocks `.ps1` shims).
- No ripgrep on PATH — use Grep/Glob tools instead.
- Build output is a **single inlined HTML file**: every dependency added ships inline. Raise size trade-offs before adding runtimes (this is why Lottie was declined — inline SVG + CSS instead).

## 3. Repo map

```
index.html                 title/meta: ShippingCo
vite.config.js             react + singleFile plugins, jsdom test config
DESIGN_BRIEF.md            product/design spec v1 + PM map + market research
prototype/                 DEAD html prototype — leave untouched
src/
  App.jsx                  routes: / (Launcher), /business/* (BusinessShell), /customer (CustomerWhatsApp), * → /
  components/m3/           Button, Controls, DataTable, Dialog, Icon, Input, Snackbar, Surface
  data/store.js            ~34KB localStorage store (key: shippingco_v1, migrates legacy setu_courier_v2)
  data/bot.js              customer-side intent engine (WhatsApp chat)
  data/messages.js         bilingual (en/hi) message templates
  pages/Launcher.jsx       entry chooser
  pages/CustomerWhatsApp.jsx  customer-side chat simulation
  pages/business/
    BusinessShell.jsx      appbar + drawer shell, nested routes
    Dashboard.jsx          console (see design law below)
    NewBookingPage.jsx     booking form (payment mode, tax, ETA estimate)
    PackagesPage.jsx       parcels table, OTP flows, bulk actions
    LotsPage.jsx           destination-first lot creation
    RoutesPage.jsx         dispatch routes, delay alerts
    ReportsPage.jsx        index of report cards → drill-in screens
    EwayPage.jsx           e-way bill tracking (separate from reports)
    MiscPages.jsx          Automation Feed, Receipts, Settings
  styles/tokens.css        ALL design tokens — only place hex values may live
  styles/base.css, components.css
```

Key store facts: `STATUS_FLOW = booked → checked_in → dispatched → in_transit → out_for_delivery → delivered`, plus `EXCEPTION_STATUSES = failed_attempt | rto`. Payment `{mode: paid|topay, settled}`. Tax computed **on booking** via `taxOn()` storing `{rate, taxable, gst, total}`. E-way threshold ₹50,000. OTP max 5 attempts with supervisor reveal. Recovery queue: 72h RTO window, 3 attempts. Escalations queue with resolve action. `reachSummary()` feeds dashboard proof metrics.

## 4. Hard rules (violations made the user angry — do not repeat)

1. **NO GIT. EVER.** Do not run `git init/add/commit/status`, do not create `.gitignore`, do not suggest version control. The user explicitly forbade git in this project after an agent did it unasked.
2. **Silence is not approval.** If you ask permission and get no answer, proceed with only what was authorized. Never re-justify an unapproved action as "additive/reversible".
3. **No tooling on your own initiative**: no CI, linters, formatters, pre-commit hooks, new dependencies, or scaffolding unless asked.
4. **Do the work yourself.** Current standing instruction: implement directly with file tools — do not delegate to an opencode session. (If the user ever re-enables delegation: continue an existing session via `opencode run --session <id>`, never start fresh.)
5. **Most recent instruction wins.** The user changes their mind often (delegation, Lottie, density); re-check before assuming an older arrangement still holds.
6. Verify every work package with tests + build. Report results honestly.

## 5. Design law (all enforced by explicit user corrections)

**System**: Material Design 3 + Airbnb-tier component craft.

- **White is the ONLY background color.** Page canvas, cards, tiles, icon containers, table rows, dialogs — all `#ffffff`. Hierarchy from borders and spacing, never grey fills or tinted surfaces. Status pills keep tonal fills (color carries meaning); transient hover overlays are OK; nothing rests non-white.
- **One stroke everywhere**: every border is `1px solid var(--md-outline-variant)`. Emphasis comes from ink weight, size, whitespace — never a second border color/width. Only exception: selection controls (checkbox/switch) at 2px.
- **Few colors**: primary blue `#2563eb` on exactly (primary button, active drawer item, focus rings, links, selected states). Semantic error/warning/success strictly for status meaning — never decorative, never a full card background. Signal each state once (pill OR border OR button, not three). Zero hardcoded hex outside `tokens.css`.
- **Banned ("AI slop")**: gradient headers, glassmorphism/blur panels, colored circular icon chips per row, emoji as iconography, rainbow stat-card grids, decorative illustrations, sparkle flourishes, drop shadows on resting cards (shadows reserved for dialogs/menus/snackbars/mobile FAB).
- **Low-literacy audience**: lead with big numbers and recognizable icons; minimal prose; short noun phrases; money (₹, `en-IN`) and counts are the universal language; every section needs a visual anchor so it can be recognized by shape, not read.
- **Density discipline** (user corrected this three times): few blocks per screen with deliberate hierarchy (dashboard has four, first is loudest); charts live *inside* the statistic they explain, never standalone boxes; max two chart shapes per screen (bar rows = breakdown, columns = time); data-heavy areas become an index of report cards that open drill-in screens with chart + Excel-like filterable table + export of exactly the filtered rows.
- **Sparse text**: one line per row stating its whole meaning; no sub-captions restating titles; when tempted to add a caption, fold it into the headline or cut it.
- **One primary action per screen.** Secondary actions demoted or in overflow menus.
- **No greeting line** anywhere. No "Good morning/day, {name}".
- **Tabular numerals** (`font-variant-numeric: tabular-nums`) on every figure, money, count, date, numeric column.
- **Motion is purposeful only**: numbers counting up, bars growing to measured width, cards entering in sequence, state-change transitions. Always keep the `prefers-reduced-motion` guard. Ambient loops/floating shapes = banned. Lottie: raise the single-file-size trade-off instead of adding it silently.

## 6. Product rules

- The dashboard must **prove the software's value**, not just show operations. Always surface: bookings done · customers reached over WhatsApp · grateful replies · conversations escalated to human (escalations = actionable queue + proof the AI handled the rest). Data comes from bot outcome logging (`logBotTurn`, `reachSummary`, escalations).
- The console answers three questions in order: What is broken right now? What is moving? Where is docket X? Dashboard = work queue, not report.
- Compliance (e-way bills) stays **separate** from financial reports — distinct jobs, distinct nav entries.
- GST is calculated on booking creation, never back-derived in reports.
- Reports: index of cards → detail screen with chart + spreadsheet-style table (per-column filters, sort, live row count, totals row, export of exactly what's shown).
- Bilingual messages (en/hi) with STOP opt-out text; respect Meta's 24-hour reply window (`replyWindow` shows "Free reply · Nh left" vs "Needs a template").

## 7. Working style with this user

- **Lead with visible change.** The user judges progress by what they can see on screen. Sequence visible UI work first; if invisible foundation work must come first, say so explicitly upfront.
- Work in small shippable increments; after each, reload-and-look instructions beat abstract summaries.
- When correcting course, fix the root cause (e.g., GST moved into booking rather than patched in a report), then sweep call sites.
- The user's messages contain typos; interpret intent generously and confirm understanding of multi-part asks before large rebuilds.

## 8. Open threads (as of last session)

- Lottie/animations desire vs single-file build weight — reconciled as purposeful motion only; revisit if user insists on real Lottie assets.
- opencode session ids rotate (`opencode session list` before ever handing off — old documented id is dead).
- Potential next candidates from the PM map: craft pass leftovers (focus traps, skeletons, keyboard handlers on remaining screens), settings dirty-state guard polish, receipts date filters, launcher restyle confirmation.
