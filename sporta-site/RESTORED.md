# Restored from SPORTA-GO-LIVE.zip — 20 August 2026

The web storefront, recovered from the go-live package the owner had kept.
Its previous container was reclaimed with ~130 local commits on it, and nothing
was ever pushed, so this zip is what survived.

## What this is

The **built and deployable** site, not the source tree:

- `public_html/` — the compiled front end (`assets/*.js`, `index.html`), the PHP
  backend at `api/`, the KNET and T-Pay drop-ins at `knet/` and `pay/`, and every
  shipped image: `cats/` (category artwork, 1216×706 desktop and 900×570 mobile),
  `hero/`, the logos and icons.
- `database-sql/` — schema, seed, brands, promo, and `IMPORT-THIS-ONE.sql`.
- `README-FIRST.txt`, `sporta-mac-check.sh`, `go-live.html` — the upload
  instructions that shipped with it.

## What it is NOT

The React source (`sporta-web/src`, the Vite config, the test suites, the
`brand/` masters and generators) is **not** in this package and is not
recoverable from it. `public_html/assets/*.js` is minified output.

Changes made after this package was cut — the 1920-wide AVIF re-cut of the
category artwork, and the commits that followed — were on the reclaimed
container only. Gone.

## Secrets

None are present, and none should ever be added here: `api/config.php`,
`knet/config.php` and `pay/config.php` live only on the server. The zip carries
`config.example.php` and a `config.js` whose values are all empty defaults.
