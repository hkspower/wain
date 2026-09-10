# scripts/live — the ones that only READ the live server

These answer questions about production and change nothing. They are separated
from `../publish/` so that "does this touch the shop?" is answerable from the
path.

They exist because reading this repository is not evidence about the server.
The server has been rolled back by a restore at least once, so a file here and
the file live can differ by 23 KB; `.htaccess` in the repo carried a cache rule
the live copy did not; and the sandbox's 608 orders are seed data against the
live shop's zero. **Ask the server.**

- `live-scan.php` — catalogue, orders, variants, photos, brand logos, missing tables.
- `live-file-check.php` — sizes and sha256 of docroot files, against the repo.
- `live-cache-check.php` — what headers LiteSpeed actually sends. LiteSpeed is
  not Apache and does not implement `Header edit`; the rig proves syntax, only
  production proves the directive is implemented.
- `live-config-url.php`, `live-image-check.php`, `live-seo-check.php` — config
  origin, product imagery, and the SEO shell.
- `live-tile-probe.php`, `live-tile-names.php` — the category tiles. The first
  asks whether the plain-name rewrite is gone; the second asks whether a
  leftover FILE keeps a tile bridged anyway, which is the same fault with no
  rule behind it. Both matter because the tile component only falls to its good
  `<picture>` — webp, and the `-rtl` Arabic composition — when the plain name
  ERRORS.
- `domain-check.sh` — DNS from the registry down. Written after
  "the server cannot resolve its own domain" was treated as a quirk for weeks
  when it was NXDOMAIN at the .com.kw registry.

**Read-only is a property to preserve, not a description.** They are fetched by
the server over a public URL; each says so in its own header. Verify results by
absolute path — reading back a relative name proves nothing, it reads the
home-directory copy just as happily.
