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
| Surfaces | **white on every device** — no dark theme; white page, white cards, cool near-neutral greys. Brown is ink, never paper |
| Icons | the drawn `<symbol>` sprite — no emoji anywhere on the public page |
| Layout | hero · card grids · wide `.product` rows · `ol.steps` · contact channels |
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
- Arabic is set in bundled **Tajawal** (SIL OFL, `almuhallab/fonts/`, Arabic
  subset, weights 400/500/700/800 — 500 also serves the 600 slot). Never link a
  webfont CDN — the CSP blocks it. Any new page must declare the five
  `@font-face` rules, carry `font-src 'self'`, and be precached. Arabic set in
  Tajawal needs `line-height` ≥ 1.35 on display sizes, or a damma collides with
  the line above.
- **There is no dark theme.** The site is white whatever the device prefers:
  no `prefers-color-scheme: dark` block anywhere, `color-scheme: light` on
  `:root`, and one white `theme-color`. The suite fails if a dark override
  reappears.
- Icons on the public site are a **drawn inline-SVG set** (`<symbol>` + `<use>`),
  not emoji: emoji are a different typeface, weight and colour on every platform.
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
- `python3 design/test_suite.py` is the full system test — 224 checks covering
  token consistency and contrast, SAFI/XBRL/delivery arithmetic, generated
  artefacts, auth, hostile input, storage tampering, offline, layout, and the mobile shell
  (bottom tab bar, 16px inputs, 44px touch targets, [hidden] integrity). Run it
  after any change to `almuhallab/`; it exits non-zero on failure.
- `design/capture.py` drives the site end to end and screenshots every page;
  `design/build_pdf.py` composes those into the PDF sample;
  `design/admin_test.py` exercises the admin console.
- **Dates in generated filings must be computed in UTC** and anchored to the
  first of the opening month. Local-midnight parsing shifts the date east of
  Greenwich, and subtracting months from a 31st overflows into the wrong month.
- Screenshots must be **looked at**, not just asserted on — layout defects
  (orphaned tiles, wrapped values) do not fail a test.
