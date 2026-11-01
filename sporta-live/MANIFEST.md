# Live add-ons: what the server runs, and where each file lives in the repo

**Do not run `npm run publish` or upload `SPORTA-GO-LIVE.zip` yet.** The repo's
`sporta-web/` builds a different app from the one the live site runs (repo entry
`index-BI6iaqh9.js`, live `index-BtzlNXGI.js`), and its `index.html` has none of
the add-on tags below. Publishing would replace the live `index.html`, drop every
add-on link and swap in the older app. Reconcile first.

`/` on the server = `/docker/sporta/site`. Add-ons are linked from its `index.html`.

## Add-ons linked from the live index.html

| Served as | Repo copy | Note |
|---|---|---|
| `sporta-product-fix.css` | `sporta-live/product/` | |
| `sporta-brand-theme.css` | `sporta-live/theme/` | |
| `sporta-home-trim.css` | `sporta-live/home/` | |
| `sporta-cart-drawer.css` | `sporta-live/cart/` | |
| `sporta-grid.css` | `sporta-live/grid/` | |
| `sporta-bag-touch.css` | `sporta-live/bag/` | |
| `sporta-cat-tiles.css` | `sporta-live/cats/` | |
| `sporta-admin-knet.css` | `sporta-live/admin/` | |
| `sporta-returns-touch.css` | `sporta-live/policy/` | |
| `sporta-clock.css` / `.js` | `sporta-live/clock/` | |
| `sporta-ui-colours.css` | `sporta-live/ui/` | |
| `sporta-shadows.css` | `sporta-live/ui/` | |
| `sporta-images.css` (v3) | `sporta-live/ui/` | |
| `sporta-checkout-a11y.css` / `.js` (v2) | `sporta-live/checkout/` | |
| `sporta-gov-autopick.js` | `sporta-live/checkout/` | |
| `sporta-features.js` | `sporta-live/features/` | |
| `sporta-admin-brands.js` | `sporta-live/admin/` | |
| `sporta-footer-call.js` | `sporta-live/footer/` | |
| `birthday.js` | `sporta-live/birthday/` | |
| `config.js` | `sporta-web/public/config.js` | never overwritten (live values) |

## Server-only (no repo copy)

- `boot.js`: loaded first by the live index.html; not in the repo.
- `sw.js`: the repo has `sporta-web/public/sw.js`, but the live copy may differ.
- `backends-offline.css`, `backends-offline.html`, `backends-icon.svg`, `backends.webmanifest`
- `product-photo-unavailable.svg`
- `.htaccess` (live copy has the no-cache `FilesMatch` line the add-ons depend on)

## Backups

Before each change: `site/backups/claude-<timestamp>-<name>/`.

## Live `.htaccess` edits made directly on the server

- **2026-11-01, trailing slash on the admin:** added `RewriteRule ^backends/+$ - [R=404,L]`
  just above the `^backends(/.*)?$` rule. Backup: `site/backups/claude-20261101T0612Z-backends-slash/.htaccess`.
  Verified: `/backends/` → 404; `/backends`, `/backends?x=1`, `/backends/x`, `/shop`, `/` unchanged.
  The repo's `sporta-web/public/.htaccess` does not have this rule yet; add it when the repo is reconciled.
