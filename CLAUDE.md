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

**Almuhallab Code (المهلب كود) is a software company.** `www.almuhallab-code.com`
is the *company* website. **Nokha1 (النوخذة) is one system the company built and
runs — a product inside the site, never the site itself.** Do not put Nokha1's
portal, registration, plans or dashboard on the root page.

Static HTML5 PWA, Arabic-first (RTL), no build step and no dependencies.

- `index.html` — the company site: services, work, how we work, contact. Links
  into the products; carries no account UI. Built from **one shared vocabulary**
  — hero, `h2.section` + `.sub`, then a `.grid` of uniform `.card`s with `.chip`s.
  Don't invent per-section components for it.
- `nokha1.html` — the Nokha1 portal · `nizam.html` (the unified system: المركز المالي · صافي ·
  XBRL · التوصيل in four tabs over one data core) · `editor.html` ·
  `admin.html` · `sw.js` · `manifest.webmanifest` (its `start_url` is
  `nokha1.html` — the installable app is Nokha1, not the company brochure)
- `safi.html`, `xbrl.html`, `delivery.html` are **redirect stubs** to
  `nizam.html#/<tab>`. There is one implementation of each unit — do not
  reintroduce standalone copies.
- The units are linked, not merely co-located: portfolio market value feeds XBRL
  non-current assets, delivered-order totals feed XBRL revenue.
- Every colour is a CSS custom property in `:root`, with a
  `@media (prefers-color-scheme: dark)` override. **All pages must carry the
  identical token set** — divergence between pages has been a real bug before.
- Colour values are **solved numerically against WCAG targets**, never picked by
  eye. Text ≥ 4.5:1 (body ≥ 7:1) against the *darkest* surface it can land on;
  essential UI boundaries ≥ 3:1; chart marks ≥ 2:1.
- The company mark is `logo.svg` — an Arabic mīm (م) between code brackets on an
  amber→brown gradient. Nokha1 keeps the ⚓ anchor (`icon.svg`); the company
  brochure and the product are marked differently on purpose.
- Arabic is set in bundled **IBM Plex Sans Arabic** (`almuhallab/fonts/`,
  Arabic subset, weights 400/600/700). Never link a webfont CDN — the CSP blocks
  it. Any new page must declare the three `@font-face` rules, carry
  `font-src 'self'`, and be added to the service-worker precache.
- Charts are hand-built inline SVG — the strict CSP forbids any chart library.
  Colour follows the encoding job: ordinal one-hue ramps where order carries
  meaning, a diverging pair for profit/loss where the sign is *also* shown by
  bar direction and a signed label.
- Data lives in `localStorage` under `nokhatha-*` keys. Treat it as untrusted
  input on read: escape all rendered strings, re-coerce and clamp all numbers.

## Working practice

- Verify in a real browser (Playwright + the preinstalled Chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` — pass it as
  `executable_path`, the pip package expects a newer build).
- `python3 design/test_suite.py` is the full system test — 116 checks covering
  token consistency and contrast, SAFI/XBRL/delivery arithmetic, generated
  artefacts, auth, hostile input, storage tampering, offline, and layout. Run it
  after any change to `almuhallab/`; it exits non-zero on failure.
- `design/capture.py` drives the site end to end and screenshots every page;
  `design/build_pdf.py` composes those into the PDF sample;
  `design/admin_test.py` exercises the admin console.
- **Dates in generated filings must be computed in UTC** and anchored to the
  first of the opening month. Local-midnight parsing shifts the date east of
  Greenwich, and subtracting months from a 31st overflows into the wrong month.
- Screenshots must be **looked at**, not just asserted on — layout defects
  (orphaned tiles, wrapped values) do not fail a test.
