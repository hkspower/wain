# The storefront stylesheets, one file per feature

The numbered files ARE `public_html/assets/sporta-ui.css`, and `sporta-dark.css`
here IS `public_html/assets/sporta-dark.css` (the palette; it moved out of the
docroot on 2026-10-01). Edit them here, then:

```
npm run build:css
```

That joins them in filename order into the one file the site loads. Never edit
`assets/sporta-ui.css` directly — `npm test` fails when it no longer matches
these sources, and the next build overwrites the edit.

- **Order is cascade order.** Files are joined `01` → `34`, so a rule meant to
  override another must live in a higher-numbered file (or be more specific).
  A new feature goes in a new file at the end unless it deliberately needs to
  sit earlier.
- **`21-brand-tokens.generated.css` is written by
  `scripts/make-brand-tokens.mjs`.** Never hand-edit it; hand-written rules put
  inside it are deleted by the next run. That is exactly where the category-tile
  rules were found when this split was made.
- **This folder is outside `public_html` on purpose.** It is never served or
  published; the built `assets/sporta-ui.css` is.
- **`sporta-ui.css` is a fixed-name asset**, so any change here needs a
  `VERSION` bump in `sw.js` (`npm run test:sw-version` says when).
- **Comments are NOT shipped** (since 2026-10-01). The build removes them, so
  write as much explanation here as a rule needs: it costs a visitor nothing.
  Before this, 74% of `sporta-ui.css` was comment — 83 KB gzipped on the live
  server for about 11 KB of rules, on a file that blocks the first paint.
  Read a rule's reasoning HERE, not in the built file.
