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
- `live-db-audit.php` — the data audit (`npm run test:db`'s 95 checks) against the
  LIVE database. It is the only copy of those checks: `../db-audit.php` requires it
  and asks for every line. Compact by default (a start line, one FAIL/WARN line per
  finding, a `DBAUDIT checks= fails= warns= … verdict=` summary last); a missing
  table is `missing:<table>` and the run carries on. Prints no track id, discount
  code or customer value — `node scripts/live-db-audit-test.mjs` plants them and checks.
- `live-schema-full.php` — is any migration still to run on the LIVE database? Every
  table, column, type and index a fully-migrated install has, from a manifest that
  `node scripts/make-schema-manifest.mjs` GENERATES (and `--check` fails when it is
  behind), with the `migrate-*.php` that repairs each gap. It is the only schema
  checker: `live-schema-completeness.php` (seven hand-picked tables) and
  `../schema-check.php` (a typed list 27 tables behind) are thin wrappers of it now,
  kept because other files name them. Fetched alone over cron, a wrapper has nothing
  to require and says so in one line — fetch `live-schema-full.php` itself.
- `live-image-storage.php` — how big the pictures are, in each table and folder. A
  failed query is classified by its error number (`missing:<table>` only for a table
  that is really absent, `QUERY-BUG unknown-column:<name>` for a column this database
  lacks — almost always this script's mistake) and `IMG answered=N/8` comes before the
  verdict. `SCAN_ROOT=$PWD/scripts node scripts/schema-usage-audit.mjs` prepares its
  queries, and every other live script's, against a fresh install.
- `live-admin-check.php` — can anyone sign in to /backends: accounts, 2FA (an
  authenticator that has been CONFIRMED, or an emailed code — the sign-in's own rule),
  the last sign-in day (`admin_users.last_login_at`). No address, no hash.
- `live-file-check.php` — sizes and sha256 of docroot files, against the repo.
- `live-cache-check.php` — what headers LiteSpeed actually sends. LiteSpeed is
  not Apache and does not implement `Header edit`; the rig proves syntax, only
  production proves the directive is implemented.
- `live-asset-freshness.php` — is a SHOPPER served the asset the origin holds?
  Every other check here uses the loopback, which bypasses hcdn: a fixed-name
  stylesheet can be byte-perfect on disk and at the origin while the CDN serves
  the copy it cached before the publish. `live-edge-check.php` asks this of `/`
  and `/shop`; this asks it of the assets, which is where a fixed name gets
  pinned. It stores no expected hash — it compares the two live paths with each
  other, because the two checkers here that carried hardcoded manifests both
  went stale and then reported the repository's staleness as the server's.
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
