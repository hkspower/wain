# The docroot: what is stored on wainkw.com

Read file by file through the `hosa` connector on 27 August 2026.
`npm run audit:htaccess` guards the rules this produced.

**147 files, 21.21 MB. 18.40 MB of it — 87% — is deletable with no judgement
call at all.** The live site is 733 KB of that, and 45 KB of the live site is
`index.html`.

## Do this first, before any tidying

`upload-ftp.sh` sits in the web root, world-readable at
`https://www.wainkw.com/upload-ftp.sh`, and contains:

```bash
FTP_HOST="ftp://…"          # the server's IP
FTP_USER="cvu130124229.wainkw.com"
FTP_PASS="…"                # in plaintext
```

Nothing in the live `.htaccess` denies `.sh`. That is a **write credential for
the entire document root**, readable by anyone who requests the filename — and
the filename is guessable, sits beside a file called `claude-upload-test.txt`,
and has been reachable for as long as it has existed.

**Rotate that password now**, in hPanel → Files → FTP Accounts. Deleting the
file does not undo the exposure; only rotation does. Deleting it is step two.

There is a small consolation: those three values, once rotated, are exactly
what `FTP_SERVER` / `FTP_USERNAME` / `FTP_PASSWORD` need in the repository's
Actions secrets. Rotating the credential and unblocking the deploy are the same
piece of work.

## Then: keys-out.txt, which defeats the API hardening in advance

`keys-out.txt` is a saved response from `api.php?a=list`, left in the web root
and readable by anyone. It is a complete index of every key in `wain.db`:

```
events:log · salem:config · admin-pin · queue:shezone · queue:toniguy ·
queue:soulstring · queue:hairlounge · queue:nesto · queue:alhama ·
queue:lagassa · stock:… · menu:… · salonidx · bizidx · ad:main
```

`api.php?a=get&k=` takes no authentication. So the chain is complete and needs
no cleverness: read the file, pick a key, fetch it. Including `admin-pin`.

This also matters for `server/api.php` v3. That design closes `list` and keeps
`get` public, on the reasoning that a key you cannot enumerate is a key you
cannot fetch. **This file hands over the enumeration**, so the hardening is
already defeated on the live server until it is deleted.

## What the 21 MB actually is

| | files | size |
| --- | ---: | ---: |
| `index.bak-*.html` / `.broken-*` backups | 33 | **12.81 MB** |
| `files.wain.zip`, `wain-hosting.zip` | 2 | **5.55 MB** |
| whole copies of the old single-file app | 9 | 1.63 MB |
| old CSS/JS and `.bak-342` variants | 7 | 181 KB |
| `wain.db` + `admin.token` | 2 | 92 KB |
| build config leaked from a repo | 6 | 55 KB |
| `admin.html` + its manifest | 2 | 54 KB |
| notes, dumps, checks | 13 | 48 KB |
| `*-out.txt` scratch | 52 | 41 KB |
| PHP back end | 7 | 40 KB |
| **the live site + icons** | **14** | **733 KB** |

The 33 backups are ~430 KB each and near-identical — the same file saved again
on every edit, at `index.bak-290.html` through `index.bak-343.html`. Every one
is publicly downloadable at a name you can guess by counting.

`sec-out.txt` looks alarming and is not: "sec" is *sections*, and it is a CSS
section-length audit. Checked, so nobody has to check it twice.

## Folders

Six directories, and only one is explained:

| | what it is |
| --- | --- |
| `lib/` | Leaflet 1.x + MarkerCluster, 195 KB. The old app's map. The Next site uses an OSM embed and does not need it. |
| `n8n-sync/` | not read — an n8n workflow directory; `admin.html` pings a `sportake.app.n8n.cloud` webhook, so something here may be live |
| `wain-cache/` | not read |
| `ppgg/` | not read |
| `testt/` | not read — the name suggests scratch |
| `404/` | not read |

`Options -Indexes` is set, so none of them can be browsed — but individual
files inside them can still be fetched by name.

## The deny rules, and the one that nearly broke the site

`public/.htaccess` now denies, beyond what it already covered: `.sh`/`.env`/
`.ini`/`.conf`/`.log`/`.sql`, the old PHP helpers (**not** `api.php` — the
admin panel calls it on every load), leaked build config, whole copies of the
old app, the stray dumps, and `.md`.

**None of it is in force until the site is deployed.** A deny rule in this
repository protects nothing while the server still serves its own `.htaccess`.
That is why the credential rotation is first and not last.

The first draft of those rules denied `index.txt`, to clear a 92 KB dump the
old app left behind. Next's App Router writes an `index.txt` beside *every*
`index.html` — the route's prefetch payload — so the rule matched **45 shipped
files** and would have broken client-side navigation on every route of the new
site, to tidy one stale file that the deploy overwrites anyway.

It was caught by testing the patterns against `out/` instead of reasoning about
them, which is now `npm run audit:htaccess`: every deny pattern is applied to
the real build output and any rule that matches something the site ships fails
the run. It also asserts the other direction — that nine named things, `wain.db`
and its `-wal` sibling among them, stay covered. Removing the `^wain\.db` rule
leaves `wain.db` itself matched by the `.db` extension rule but drops
`wain.db-wal`, which is where the newest orders live; the audit catches exactly
that.

## Deletion order

Reversible until the last line. **Back up first** — `wain.db`, `wain.db-wal`
and `wain.db-shm` together, never `wain.db` alone: the API opens it with
`PRAGMA journal_mode=WAL`, so copying one file can silently lose the newest
orders.

```
upload-ftp.sh             ← after rotating the password, not before
keys-out.txt              ← the key index
*-out.txt                 52 files
index.bak-*.html          33 files, 12.81 MB
index.broken-*.html, *.bak-*.css, *.bak-*.js
files.wain.zip, wain-hosting.zip          5.55 MB
wain-local-test.html, extracted_*, index.txt
wain-app-latest.html, qareeb.html, wain-admin-latest.html
package.json, package-lock.json, tsconfig.json,
  next.config.ts, next-env.d.ts, postcss.config.mjs
wain-inst.php, wain-restore.php, wain-fix.php,
  wain-ver.php, wain-search-cache.php, v.php
lib/                      once the old app is gone
```

**Not on this list, deliberately:** `api.php`, `wain.db`, `admin.html`,
`admin.token`. The old app is live — `admin.html` reads and writes the database
through `api.php` on every load — so those four stay until the business has
somewhere else to run its orders from. See `server/README.md`.
