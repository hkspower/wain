# Project notes

## Design preferences

- **No beige.** Never use beige, cream, sand-tinted or warm "paper" tones for
  backgrounds and surfaces. Use **white** for the page and cards, with
  near-neutral cool greys for recessed surfaces (inputs, hover) and borders.
  This applies to the website, the app, and any generated document or mockup.
  The brand amber (`--sand-vivid`, used in the ⚓ logo gradient and for warning
  accents) is a deliberate accent and is not affected by this rule.

## Nokha1 (النوخذة) — `almuhallab/`

The Almuhallab unified services website: a static HTML5 PWA, Arabic-first (RTL),
no build step and no dependencies.

- `index.html` portal · `safi.html` · `xbrl.html` · `delivery.html` ·
  `editor.html` · `admin.html` · `sw.js` · `manifest.webmanifest`
- Every colour is a CSS custom property in `:root`, with a
  `@media (prefers-color-scheme: dark)` override. **All pages must carry the
  identical token set** — divergence between pages has been a real bug before.
- Colour values are **solved numerically against WCAG targets**, never picked by
  eye. Text ≥ 4.5:1 (body ≥ 7:1) against the *darkest* surface it can land on;
  essential UI boundaries ≥ 3:1; chart marks ≥ 2:1.
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
- `design/capture.py` drives the site end to end and screenshots every page;
  `design/build_pdf.py` composes those into the PDF sample;
  `design/admin_test.py` exercises the admin console.
- Screenshots must be **looked at**, not just asserted on — layout defects
  (orphaned tiles, wrapped values) do not fail a test.
