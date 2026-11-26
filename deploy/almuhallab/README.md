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

