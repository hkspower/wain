# The storefront stylesheet, one file per feature

These files ARE `public_html/assets/sporta-ui.css`. Edit them here, then:

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
