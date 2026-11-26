# almuhallab-code.com: the site repair's deploy zips

These two zips are fetched by the almuhallab server at a pinned commit and applied by its
deployer (`/srv/deploy` on the VPS). The deployer takes a snapshot of the whole site folder
first and then copies the zip's files over the site. It does not delete anything.

| file | contents | sha256 |
|---|---|---|
| `almuhallab-repair-a-3a0f7c8c.zip` | `fonts/cairo-600.woff2`, `fonts/cairo-OFL.txt`, six stylesheets, `index.html` | `3a0f7c8c6ce6b78c046abd0f9757f5ffa52c8a1b9f5087a74edb7c6b4af8a53b` |
| `almuhallab-repair-b-f0833488.zip` | `sw.js` | `f08334883466aadc27297829a5b04e56715cd86670879a18e5fb520e2155e3e1` |

Apply A first, then B. A puts the font in place before the new service worker can ask for it.
After B is live, delete `manifest.webmanifest` from the site folder. No page links it; only
the old service worker's list named it.

Nothing here changes the wain site. No file under `src/` or `public/` is touched.

## Espresso Ink theme (black, white, grey, brown)

| file | contents | sha256 |
|---|---|---|
| `almuhallab-espresso-3d01f390.zip` | the eight recoloured stylesheets, `index.html`, the four service pages (at their Arabic folder names), `sw.js` (cache `almuhallab-v122-espresso1`) | `3d01f39034c703ace3d7be34c06734c2c59ab47846444e753804953c8d752cdf` |

One zip, one drop: it carries `sw.js` too, so no second apply is needed. Its files replace the
repair zips above. The deployer snapshots the site folder first, so a rollback is available.

## The rebuilt site (home and the four service pages)

| file | contents | sha256 |
|---|---|---|
| `almuhallab-rebuild-b3b113c6.zip` | `index.html`, the four service pages at their Arabic folder names, `site-v200.css` (one stylesheet for all five pages), `site-v200.js` (the home form and header), `sw.js` (cache `almuhallab-v200-rebuild1`) | `b3b113c69088aa0fab89bf3dbbb98ce6f61b66a244c7a7fa3de37037237fbad4` |

New structure and copy, approved by the owner from a preview. The old stylesheets stay on the server,
so restoring the deployer's snapshot taken before this zip brings the previous site back whole.


## A week's browser cache for stylesheets and scripts (26 November)

| file | contents | sha256 |
|---|---|---|
| `almuhallab-css-js-cache-24f1d36a.zip` | `.htaccess` (sha256 `f52e147d…c03b`, 232 lines) | `24f1d36a4b7656a67be12d55a84ca242967640a3f696b0f3ca7be2a3e40a4c60` |

The live `.htaccess` (sha256 `b3c8452c…4585`) with one rule added to its Caching block: every
`.css` and `.js` file gets `Cache-Control: public, max-age=604800`, the week fonts and images
already have. The admin scripts (`admin-*`, `mcp-admin-*`) are left out, and `sw.js` keeps
`no-cache`, because its own rule comes later in the file and wins. Every stylesheet and script
on the site carries a version in its name and the pages add a `?v=` token, so a change ships
under a new name or token. Checked on Apache 2.4.58 beside the live file: only `Cache-Control`
on the 32 public stylesheets and scripts changed; every status code and every other header
stayed the same.

## The JavaScript fixes from the 26 November scan

| file | contents | sha256 |
|---|---|---|
| `almuhallab-js-fixes-8320d33a.zip` | `index.html`, the four service pages, `404.html`, `site-v200.js`, `service-shared-v2.js`, `sw-update-v201.js` (new name), `sw.js` (cache `almuhallab-v201-js1`), `.htaccess` | `8320d33a0fc92e2bf2e8c0dba9479e98fb55b40a278c327db74d0dc57c217523` |

- **No reload on a first visit.** `sw-update-v201.js` replaces `sw-update-v87.js` on the five pages.
  A page the worker did not control when it loaded is already current, so it is not reloaded. A page
  with anything typed or chosen in a form is never reloaded. The new name matters: the previous
  worker served its cached copy of any listed script whatever its `?v=`, and it passes an unknown name
  to the network, so the last page it serves already carries the new code. `sw-update-v87.js` stays on
  the server, unused.
- **The quote form unlocks after a send.** Editing any field re-enables the button and removes the
  WhatsApp link that still held the old message. The message box stops at 2,000 characters.
- **`sw.js` answers a script or stylesheet only from the same version.** It used to match its cache
  while ignoring the query, so a change shipped with only a new `?v=` reached a worker-controlled
  visitor as the old file, and with the week-long cache from the previous entry, an open tab kept it.
  Correction to that entry: a new `?v=` alone was not enough for those visitors until this fix. Each
  file now has one cache entry; Apache's lowercase and the links' uppercase escapes count as one
  address. Offline, an address the worker does not hold gets the browser's offline error instead of
  the home page.
- **`404.html`** showed a logo that is not on the server (`logo-main-clean-v94.svg`); it now shows the
  rebuilt pages' text wordmark, in the 404 page's own colours.
- **`.htaccess`** answers 410 for six scripts no public page loads (`home-v7.js`, `main-menu-v98.js`,
  `nizam-v4.js`, `nizam-route-init-v87.js`, `nokhatha-app-v6.js`, `redirect-v87.js`). The files stay
  on disk, as the retired apps' pages do.
- `service-shared-v2.js` loses a reveal-on-scroll observer that had nothing left to reveal.

Checked before deploying, on Apache 2.4.58 with this `.htaccess` over HTTPS: 65 checks of the fixes
(first visits, deploys with and without typed text, offline, redirects, a `?v=`-only change, the
form, language, the 404 page, the 410s), the 146 checks from the rebuild, and the hand-over from the
current worker.
