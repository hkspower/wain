# Project notes

## Design preferences

- **No beige.** Never use beige, cream, sand-tinted or warm "paper" tones for
  backgrounds and surfaces. Use **white** for the page and cards, with
  near-neutral cool greys for recessed surfaces (inputs, hover) and borders.
  This applies to the website, the app, and any generated document or mockup.
  The brand amber (`--sand-vivid`, used in the logo gradient and for warning
  accents) and the brand **brown** (`--tint` / `--tint-strong`, the primary
  accent since the identity change) are deliberate inks on white surfaces and
  are not affected by this rule — it governs backgrounds and surfaces only.

## Almuhallab Code — `almuhallab/`

### 🔒 NAMING: the system is **النوخذة**, never "Nokha"

"Nokha" / "Nokha1" was the user's **private shorthand for النوخذة, for their own
use only**. It must never appear on the live site, in any published page, name,
title, filename, or artefact. Write **النوخذة** in Arabic; where a Latin
filename or key is unavoidable, use `nokhatha` (matching the `nokhatha-*`
storage keys). The portal lives at `nokhatha.html` (`/nokhatha`); `nokha1.html`
survives only as an unlinked redirect for links published before the rename.
`design/test_suite.py` fails if the shorthand reappears on any page.

### 🔒 THE ALMUHALLAB STYLE IS FINAL — NEVER CHANGE IT

This identity is the company's own, taken from the live site. It is **not** open
to redesign, refresh, "improvement", or substitution — not by me, not on my own
initiative, not as a side effect of another task. Change it **only** when the
user asks for that change in so many words, and change only what they name.

Locked, exactly as they are:

| | Locked value |
|---|---|
| Mark | the dhow's lateen sail over the water — `logo.svg` and `#i-sail` |
| Wordmark | **المهلب** in brand brown, `Almuhallab Code` on the line beneath |
| Brand ink | `--tint` `#7a4418` · `--tint-strong` `#6f3f1c` |
| Surfaces | **white on every device** — no dark theme; white page, white cards, cool near-neutral greys. Brown is ink, never paper — with one exception the owner asked for (2026-07-31): the **masthead bar is brown** (`--tint-strong`) with white ink on every page, and `theme-color` matches it. Everything below the bar stays white |
| Icons | the drawn `<symbol>` sprite — no emoji anywhere on the public page |
| Layout | full-height hero with real counters · **slide rails** (scroll-snap sliders with arrows + dots — the card grids became sliders at the owner's request, 2026-07-30) · the automation `ol.flow` · wide `.product` rows · commitments `.band` · `ol.steps` as a slider timeline · the technology cloud · the WhatsApp project form · «ما نبنيه لعملك» offers rail · contact channels as a bar · the four-column footer on a recessed grey base |
| Products | **النوخذة only.** The in-browser code editor was retired at the owner's request — do not reintroduce it |
| Contact | واتساب `+965 6589 4110` · انستغرام `@almuhallab.code` · `hello@almuhallab-code.com` |

`design/test_suite.py` pins every one of these (section `identity`). If a change
makes those checks fail, the change is wrong — fix the change, never the test.

**Almuhallab Code (المهلب كود) is a software company.** `www.almuhallab-code.com`
is the *company* website. **النوخذة is one system the company built and
runs — a product inside the site, never the site itself.** Do not put النوخذة's
portal, registration, plans or dashboard on the root page.

Static HTML5 PWA, Arabic-first (RTL), no build step and no dependencies.

- `index.html` — the company site: services, work, how we work, contact. Links
  into the products; carries no account UI. Built from **one shared vocabulary**
  — hero, `h2.section` + `.sub`, a `.grid` of uniform `.card`s with `.chip`s, plus
  the first version's own components: wide `.product` rows for the systems the
  company built, `ol.steps` for how we work, and the `.contact` bar.
- `nokhatha.html` — the النوخذة portal · `nizam.html` (the unified system: المركز المالي · صافي ·
  XBRL · التوصيل in four tabs over one data core) ·
  `admin.html` · `sw.js` · `manifest.webmanifest` (its `start_url` is
  `nokhatha.html` — the installable app is النوخذة, not the company brochure)
- `safi.html`, `xbrl.html`, `delivery.html` are **redirect stubs** to
  `nizam.html#/<tab>`. There is one implementation of each unit — do not
  reintroduce standalone copies.
- The units are linked, not merely co-located: portfolio market value feeds the
  XBRL investments line (rolling into non-current assets), delivered-order
  totals feed XBRL revenue.
- **النوخذة is free.** One plan, every unit open, no price and nothing to upgrade
  to — in the portal and in the admin console alike. Don't reintroduce tiers,
  prices or projected revenue.
- The XBRL unit is the **Kuwaiti annual filing**: subtotals are computed from
  line items (never typed), and an audit pass reports errors that block filing,
  companies-law warnings, and suggestions with amounts (statutory reserve 10%,
  zakat 1% for KSCC, labour support 2.5% + KFAS 1% for listed). The entity is
  identified by its commercial-registration number. Final submission is via the
  Ministry of Commerce portal — say so, never imply the file itself is the
  submission.
- **Spacing is one scale on every page**: 4 · 6 · 8 · 12 · 16 · 20 · 24 · 32 · 40 ·
  56. Interactive rows (`.btn`, nav links, table cells) sit at `12px 16px` so they
  measure ~44px — set by intent, not by snapping to the scale. Before this, the
  four pages carried 27 distinct values, 7 off any scale.
- **A computed total is a statement total, not another input.** Every readonly
  field in the XBRL filing carries `label.total` and owns a full-width row —
  label at the RTL start, amount at the end, `border-top` separator (heavier for
  the two roll-ups), stacking on mobile. Pinned by the suite.
- Every colour is a CSS custom property in one `:root` block. **All pages must
  carry the identical token set** — divergence between pages has been a real bug
  before.
- Colour values are **solved numerically against WCAG targets**, never picked by
  eye. Text ≥ 4.5:1 (body ≥ 7:1) against the darkest surface it can land on;
  essential UI boundaries ≥ 3:1; chart marks ≥ 2:1.
- **The company's real identity, from the live site**: the mark is a dhow's
  lateen sail over the water (`logo.svg`, and `#i-sail` in the page sprite), the
  wordmark is **المهلب** in brand brown, and the palette is brown on white.
  النوخذة keeps the ⚓ anchor (`icon.svg`) — the company and the product are
  marked differently on purpose.
- Contact channels are the real ones and must not be replaced with placeholders:
  واتساب `+965 6589 4110` · انستغرام `@almuhallab.code` · البريد
  `hello@almuhallab-code.com`.
- Arabic is set in bundled **Cairo** (SIL OFL, `almuhallab/fonts/`, Arabic
  subset, weights 400/500/700/800 — 500 also serves the 600 slot; 54 KB).
  Chosen at the owner's request for a modern face (2026-08-01) by rendering
  Cairo, Almarai, Readex Pro, Alexandria and IBM Plex Sans Arabic side by side
  in the page's own copy and looking at them. Plex is ruled out — that is the
  face the owner rejected when asking for a better Arabic font. Never link a
  webfont CDN — the CSP blocks it. Any new page must declare the five
  `@font-face` rules, carry `font-src 'self'`, and be precached. Arabic set in
  Cairo needs `line-height` ≥ 1.35 on display sizes, or a damma collides with
  the line above.
- **There is no dark theme.** The site is white whatever the device prefers:
  no `prefers-color-scheme: dark` block anywhere and `color-scheme: light` on
  `:root`. `theme-color` is the masthead brown `#6f3f1c` on every page so the
  browser chrome continues the bar — that is not a dark theme, and the page
  below the bar stays white. The suite fails if a dark override reappears.
- **The masthead is a sticky brown bar on all four pages** (owner's request,
  2026-07-31): the company page centres the mark above the wordmark and
  shrinks the bar once scrolled (two thresholds — 60px down, 24px up — or a
  bar that changes the page's height retriggers itself forever); the app
  screens keep their row layout so nav and tabs stay in reach. On brown the
  ink inverts: white links, a **white pill** for the one call to action, and
  outlined white for logout — the brand red measures **1.6:1** on this brown
  and must never appear there. Set `color:#fff` on `.brand` itself, not only
  on its children: two pages shipped a dark wordmark because their markup was
  a `<div>`/`<span>` the colour rule never named. The suite measures every
  masthead label on every page.
- The **footer is the site's map**, not a copyright line: four columns (the
  company and its channels written out in full · الشركة · الخدمات · النوخذة's
  units), on the one recessed grey surface, opened by the brand hairline. Do
  not put an icon-only channel row beside the written one — it repeats the
  same three links while hiding the values.
- **A sticky bar hides whatever an in-page link jumps to.** Every anchor
  target carries `scroll-margin-top` (148px desktop, 120px phone, clearing the
  compact bar's 130px) and `html` uses `scroll-behavior: smooth`, off under
  reduced motion. Tests that measure scroll positions must pass
  `behavior:'instant'` or they race the animation and read mid-flight values.
- **المهلب is the company; النوخذة is النظام الموحد it built and runs.** The
  masthead says «شركة برمجة وأنظمة», and the system is named «النوخذة — النظام
  الموحد» wherever it is introduced. Never let the product name stand in for
  the company's.
- **The النوخذة section carries a flow map**, not just prose: صافي · التوصيل →
  نواة بيانات واحدة → الميزانية السنوية → ملف XBRL, with current running along
  the wires. It is a labelled diagram first and an animation second — with
  motion off it still reads as the same explanation. Each source owns its wire
  (`.frow`); one stretched connector cannot know where two boxes of unknown
  height sit and drifted off them as soon as the copy changed.
- The company page is **short copy carried by icons**: one line per card, each
  headed by an icon in its own 38px tile. Motion is opacity/transform only —
  masthead and hero entrance, per-section reveal on scroll, hover lift, one
  sheen on the flagship row, a live dot. Two rules it must keep: the hidden
  state is applied *by* the script (`html.motion [data-reveal]`), never by
  default, so a blocked script or a non-scrolling renderer still shows
  everything; and a 1.5s failsafe reveals whatever the observer never reached.
  `prefers-reduced-motion` switches all of it off. Sections reveal as whole
  blocks — staggering siblings puts cards of one row on different baselines.
- **«من أعمالنا» is delivered work; «ما نبنيه لعملك» is offers.** النوخذة is a
  system the company built and runs, so it keeps the flagship row. The four
  offers (موظف ذكاء اصطناعي · برمجيات خاصة · برنامج مساعد داخل موقعك · تطوير
  موقعك الحالي) sit in their own rail beneath it. Do not merge the two: filing
  an offer under "our work" presents it as something already delivered.
- **One numeral system across the whole site**, not just the company page:
  placeholders read «٨ أحرف» and the not-found page was titled ٤٠٤ while every
  figure beside them was Latin. Pinned per page.
- **Every form control needs a name** (`label[for]`, a wrapping `<label>`, or
  `aria-label`) and **every interactive target clears 24px** (WCAG 2.2 AA).
  Five admin controls had no name; footer links measured 12px on three pages.
- **One numeral system per page.** Latin digits throughout, matching `+965`
  and the counters — an Arabic-Indic ٢٤/٧ chip beside them is the same defect
  that once printed ١٢٬٠٠٠ next to 850 in one table. Pinned by the suite.
- **Every number on the page is real and checkable.** The hero counters are the
  four النوخذة units, the suite's own check count, zero dependencies, and 100%
  offline — no invented "projects completed", "happy clients" or "years of
  experience", and no testimonials or client logos the company cannot show. If
  a counter's underlying fact changes, change the counter (the suite pins the
  settled values).
- The project form has **no server** and the CSP forbids `form-action`: a valid
  submission composes the message and hands it to WhatsApp, the same channel the
  bar below offers. It is JS-gated (`html.js .qwrap`) so a failed script leaves
  the channels as the contact surface rather than a dead form.
- **Framer Motion, Lottie and any CDN library are impossible here** — the CSP is
  `default-src 'none'` with no build step. Every effect (scroll reveal, counters,
  ripple, magnetic buttons, tilt, floating shapes, drawn SVG paths, the flow
  spine) is hand-written CSS/JS. Don't accept a request to "add Framer Motion"
  by adding a script tag; build the effect instead.
- The multi-card sections are **sliders ("rails"), not grids** (owner's request,
  2026-07-30): one scroll-snap track per section, native overflow scroll, with
  arrows + dots layered on by script. Rules: the arrows are gated behind
  `html.js` so a failed script leaves a clean swipeable row, never dead
  buttons; dots are decorative spans (`aria-hidden`) counting reachable scroll
  positions — never one per card, or the end of the rail leaves dots that can
  never light; arrows do navigation;
  RTL Chromium reports `scrollLeft` 0→negative so positions compare by
  absolute value and "next" scrolls by a negative delta; the rail's 4px inline
  padding means "at rest" ≈ 4px, so thresholds are 8px, never 0; on phones the
  arrows hide and the thumb does the work. "لماذا" is a `.band` of three
  `.fact`s, "كيف نعمل" a numbered timeline, the channels one bar of pills.
- Icons on the public site are a **drawn inline-SVG set** (`<symbol>` + `<use>`),
  not emoji: emoji are a different typeface, weight and colour on every platform.
  Three service icons (automation gear, AI-agent spark, design pen) are inlined
  rather than `<use>`-referenced so their parts can animate — spin, pulse and
  stroke-draw, all stopped by `prefers-reduced-motion`.
  النوخذة's own screens still use emoji in tab labels.
- Charts are hand-built inline SVG — the strict CSP forbids any chart library.
  Colour follows the encoding job: ordinal one-hue ramps where order carries
  meaning, a diverging pair for profit/loss where the sign is *also* shown by
  bar direction and a signed label.
- Data lives in `localStorage` under `nokhatha-*` keys (the admin console's own
  four are `almuhallab-admin-*`). Treat it as untrusted input on read: escape all
  rendered strings, re-coerce and **clamp every index** — a stored `plan` from a
  retired tier once crashed the dashboard because `PLANS[plan]` was undefined.
- Numbers are formatted with an **explicit `"en-US"` locale**. A bare
  `toLocaleString()` follows the visitor's device and printed Arabic-Indic digits
  beside Latin ones in the same table.
- `favicon.svg` (the company sail) is the tab icon for `index.html`; `icon.svg`
  (the ⚓ anchor) is النوخذة's. Don't cross them.
- The units print: `nizam.html` carries an `@media print` block that strips the
  chrome, forms and row actions so a statement prints as a document.

## Working practice

- Verify in a real browser (Playwright + the preinstalled Chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — pass it as
  `executable_path`, the pip package expects a newer build).
- `python3 design/test_suite.py` is the full system test — 348 checks covering
  token consistency and contrast, SAFI/XBRL/delivery arithmetic, generated
  artefacts, auth, hostile input, storage tampering, offline, layout, and the mobile shell
  (bottom tab bar, 16px inputs, 44px touch targets, [hidden] integrity). Run it
  after any change to `almuhallab/`; it exits non-zero on failure.
- `design/voice-agent/` is the Arabic ElevenLabs voice agent + n8n lead
  webhook: an importable n8n workflow (webhook → validate → `voice_leads`
  data table → Arabic JSON reply the agent speaks), and the full agent
  config whose prompt is locked to the company's real facts (real channels,
  النوخذة free, no invented prices/clients). The claude.ai ElevenLabs and n8n
  connectors need interactive authorization before Claude can apply these
  directly; until then the README's manual steps are the path. Do not embed
  the ElevenLabs widget in the site — the CSP stays `default-src 'none'`.
- `design/instagram_covers.py` draws the Instagram highlight covers from the
  page sprite (1080×1080, brown fill, white mark) — `design/instagram/`.
- `design/capture.py` drives the site end to end and screenshots every page;
  `design/build_pdf.py` composes those into the PDF sample;
  `design/admin_test.py` exercises the admin console.
- **Dates in generated filings must be computed in UTC** and anchored to the
  first of the opening month. Local-midnight parsing shifts the date east of
  Greenwich, and subtracting months from a 31st overflows into the wrong month.
- Screenshots must be **looked at**, not just asserted on — layout defects
  (orphaned tiles, wrapped values) do not fail a test.
