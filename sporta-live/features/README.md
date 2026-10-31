# مميزات سبورتا — features band (live add-on)

`sporta-features.js` adds a "مميزات سبورتا / Sporta features" section directly
under the home-page slider: header between orange rules, four feature cards
(24-hour delivery for 1 KWD · free 14-day returns · 100% authentic · WhatsApp
22091914), a "تسوّق الآن" button (black on orange) and a WhatsApp button.
Arabic RTL by default, rebuilds in English on `?lang=en` or the toggle; only on `/`.

Why an add-on: the live storefront is a compiled bundle with no source in the
repo; rebuilding from the repo would downgrade the site. Same pattern as
`sporta-live/birthday/`.

Design: Sporta design system, campaign (dark) theme. Mockup:
https://claude.ai/artifact/JVa3BmDGzg5uxJzWUjuCkQ

## Install (hPanel → VPS → Browser terminal)
See the command in the chat / commit message; it downloads this file pinned to
a commit, adds `<script src="/sporta-features.js" defer>` before `</body>` in
`site/index.html`, and marks the file `no-cache` in `site/.htaccess`.

Undo: `cp index.html.bak-features index.html` in `/docker/sporta/site`.

## Test
`node test/browser-test.cjs` — 24 checks (mount position, RTL/LTR, 4/2 columns,
contrast, 44px targets, no horizontal scroll, re-render, language switch,
off-home removal, no JS errors) at 1280 px and 390 px.
